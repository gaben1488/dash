/**
 * plan-provenance.ts — провенанс плановых сумм строки книги ГРБС.
 *
 * ЗАЧЕМ (канон п.102, реестр интервью 2026-08-14, дополнение 18.08). Владелец:
 * «провенанс плановых сумм будет очень полезной опцией». Замер 18.08 по полным
 * дампам восьми книг показал ТРИ разные семантики плановой суммы K:
 *   (1) НМЦК неизменная — УАГЗО, УКСиМП, УД; в основном УО и УЭР;
 *   (2) НМЦК минус изъятое перераспределением — культура (УКСиМП) правит K
 *       вниз задним числом на сумму изъятой экономии;
 *   (3) распределяемый лимит — УДТХ (дословно специалист: «расписываю все наши
 *       лимиты под планируемые закупки, при экономии снимаю лимиты с закупки и
 *       перераспределяю на следующую»).
 * Общий знаменатель семантик (2) и (3): экономия уходит ПРАВКОЙ ПЛАНА ЗАДНИМ
 * ЧИСЛОМ — она исчезает из разницы план−факт и становится невидимой. Продукт
 * обязан ловить это по журналу правок и показывать «экономию, растворённую в
 * плане». Этот модуль — ядро такой диагностики: он читает журнал и выдаёт по
 * каждой строке историю плановых ячеек H/I/J/K с классификацией правок.
 *
 * ДВА КЛАССА ПРАВОК различаются отношением было/стало (замер 18.08):
 *   ~1000 → ИСПРАВЛЕНИЕ ЕДИНИЦ: сумму ввели в рублях вместо тысяч. Живой
 *           пример УО, ячейка H28 (№ п/п 25, «Капитальный ремонт учебных
 *           классов») — ДВА шага одного дня 05.08.2026: 16:52:26 «34975.0» →
 *           «34975002.17» (ввели рубли), 17:17:20 «3.497500217E7» →
 *           «34975.00217» (вернули тысячи). Оба шага — unit-fix: коридор
 *           отношения симметричен, иначе первый шаг осел бы в «росте плана»,
 *           а второй — в «ретро-снижении», и строка дважды соврала бы;
 *   прочее → НАСТОЯЩЕЕ ретро-снижение плана (перераспределение, изъятие
 *           экономии; живой пример УКСиМП J96: 1 116,72 → 12,00, 08.04.2026).
 * Складывать их в одну сумму нельзя: исправление единиц плана не уменьшает.
 *
 * ФОРМА ЧИСЛА В ЖУРНАЛЕ произвольна — журнал пишет то, что отдал Apps Script:
 * «34975.0», «3.497500217E7» (экспонента), «1 234,56» (операторский формат),
 * «(пусто)». Читатель значений обязан понимать все формы: на живом УО H28
 * непонимание экспоненты стоило бы ровно того самого ретро-снижения, которое
 * модуль ищет.
 *
 * ЧЕСТНОСТЬ НАБЛЮДАЕМОСТИ (главное требование). Журнал правок ведётся крайне
 * неравномерно: УО 33 724 записи, УКСиМП 4 904, УД 568, УФБП 124, УАГЗО 70,
 * УДТХ 34, УЭР 31, УИО 13. Отсутствие следов у управления НЕ означает
 * отсутствия практики — это дыра наблюдаемости. Поэтому каждый ответ несёт
 * PlanObservability { journalEntries, coversRow }: интерфейс обязан отличать
 * «правок не было» от «журнал не ведётся» и никогда не выдавать второе за
 * первое.
 *
 * ПРО СВОБОДНЫЙ ТЕКСТ (канон п.27). Колонка C журнала («Столбец») и любые
 * пояснения операторов машинно НЕ интерпретируются: вид правки выводится
 * СТРУКТУРНО — из адреса ячейки и пары чисел было/стало, а не из слов.
 *
 * Чистый модуль: ни чтений БД, ни сети. Вызывающий сам достаёт записи листа
 * «_ChangeLog» и текущие строки листа.
 */

import { dayNumberOf } from '@aemr/shared';

// ── Плановые колонки ──────────────────────────────────────────────────

/**
 * Плановые денежные колонки книги ГРБС (канон DEPT_COLUMNS в @aemr/shared):
 * H — ФБ план, I — КБ план, J — МБ план, K — ИТОГО план. Правки прочих колонок
 * в провенанс плана не попадают: выдавать правку предмета за правку суммы
 * нечестно.
 */
export type PlanColumn = 'H' | 'I' | 'J' | 'K';

const PLAN_COLUMNS: readonly PlanColumn[] = ['H', 'I', 'J', 'K'];
const PLAN_COLUMN_SET: ReadonlySet<string> = new Set<string>(PLAN_COLUMNS);

/** Подписи плановых колонок для готовых фраз (совпадают с шапкой книги). */
const PLAN_COLUMN_LABEL: Readonly<Record<PlanColumn, string>> = {
  H: 'план ФБ',
  I: 'план КБ',
  J: 'план МБ',
  K: 'план ИТОГО',
};

/**
 * Границы отношения было/стало, при которых снижение читается как исправление
 * единиц (рубли вместо тысяч), а не как снижение плана. Ровно 1000 в живых
 * данных не встречается — операторы одновременно с переводом единиц округляют
 * копейки (УО H28: отношение 1000,0006), поэтому канон — коридор ±10 %.
 */
export const UNIT_FIX_RATIO_MIN = 900;
export const UNIT_FIX_RATIO_MAX = 1100;

/**
 * Полоса Google-serial, в которую попадают ДАТЫ 2020–2031 годов (44000 =
 * 26.06.2020, 48000 = 03.04.2031). Нужна затем, что в живых книгах дату
 * регулярно вводят в ДЕНЕЖНУЮ ячейку, а потом заменяют настоящей суммой:
 * прогон 18.08 по журналам показал у УКСиМП 17 таких правок, у УО — 11, и
 * «прежние значения» у них лежат в окне шириной 239 и 258 единиц
 * (46038…46277 и 46023…46281). Настоящие плановые суммы так не кучкуются —
 * это календарь, а не деньги. Без этой проверки такая правка читается как
 * снижение плана на 46 млн руб. и в сумме даёт ложную «растворённую экономию».
 */
export const DATE_SERIAL_BAND_MIN = 44000;
export const DATE_SERIAL_BAND_MAX = 48000;

/**
 * Похоже ли значение на дату, записанную в денежную ячейку: целое число внутри
 * полосы Google-serial. Целость обязательна — суммы в тысячах почти всегда идут
 * с копейками (32 440,54795), а даты целые.
 *
 * ЧЕСТНАЯ ОГОВОРКА: плановая сумма ровно в 44–48 млн руб. без копеек попадёт под
 * это правило и будет показана как «дата в денежной ячейке», а не как снижение.
 * Цена ошибки в другую сторону выше (ложная «экономия» на десятки миллионов),
 * поэтому такие случаи выведены в отдельный счётчик, а не спрятаны: текст
 * сводки прямо зовёт проверить ячейку глазами.
 */
function looksLikeDateSerial(value: number): boolean {
  return Number.isInteger(value)
    && value >= DATE_SERIAL_BAND_MIN
    && value <= DATE_SERIAL_BAND_MAX;
}

/**
 * Отношение — ТОЧНАЯ степень десяти (100, 10 000, 100 000…), то есть у числа
 * лишь переехала запятая. Допуск жёсткий (одна миллионная): «примерно степень»
 * брать нельзя — живой УКСиМП J96 (1 116,72 → 12,00) даёт отношение 93,06, и
 * при допуске ±10 % он попал бы в «переезд запятой», хотя это НАСТОЯЩЕЕ
 * ретро-снижение, названное каноном п.102 поимённо.
 */
function isExactPowerOfTen(ratio: number): boolean {
  if (!(ratio > 1)) return false;
  const exponent = Math.round(Math.log10(ratio));
  if (exponent < 1) return false;
  const exact = 10 ** exponent;
  return Math.abs(ratio - exact) / exact < 1e-6;
}

// ── Виды событий ──────────────────────────────────────────────────────

/**
 * Вид правки плановой ячейки. Классификация ДЕТЕРМИНИРОВАННАЯ — только из пары
 * чисел было/стало, без обращения к тексту.
 *
 *   'unit-fix'  — отношение было/стало (или обратное) в коридоре 900..1100:
 *                 сумму вводили в рублях вместо тысяч. План по существу тот же.
 *   'scale-shift' — отношение ТОЧНО равно иной степени десяти (×100, ×100 000):
 *                 у числа переехала запятая. Тоже не движение плана, но и не
 *                 канонический «рубли вместо тысяч», поэтому вид отдельный.
 *   'date-in-money' — в денежной ячейке оказалась ДАТА (целое из полосы
 *                 Google-serial). Это дефект заполнения, а не снижение плана.
 *   'invalid-value' — плановая сумма ушла в МИНУС. План закупки не бывает
 *                 отрицательным: это заведомо испорченная ячейка, а не движение
 *                 денег. Живой УКСиМП J82: 1 291,22 → −268 939.
 *   'retro-cut' — снижение плановой ячейки не по единицам: перераспределение,
 *                 изъятие экономии. Это и есть «экономия, растворённая в плане».
 *   'raise'     — рост плановой ячейки.
 *   'fill'      — из пустоты в число (план впервые проставлен).
 *   'clear'     — в пустоту (план убран).
 *   'unknown'   — журнал сам не знает прежнего значения: пишет маркер
 *                 «(до массовой правки не отслежено)». Вид не выдумываем.
 *
 * ПОЧЕМУ ВИДОВ БОЛЬШЕ, ЧЕМ ПЯТЬ (прогон 18.08 по живым журналам всех книг).
 * Если оставить только коридор ×1000, то в «ушедший план» падают чужие явления
 * и число перестаёт быть правдой: у УО набегало 27 217 178 тыс. руб. «растворённой
 * экономии», из которых 21 817 255 — переезд запятой (×100 и ×100 000), а
 * 1 001 456 — даты в денежных ячейках. Настоящих снижений оставалось на два
 * порядка меньше. Такие явления нельзя ни складывать с ретро-снижениями, ни
 * прятать: у них другой АДРЕС и другое ДЕЙСТВИЕ (починить ячейку, а не искать
 * перераспределение), поэтому у каждого свой вид и свой счётчик.
 */
export type PlanEventKind =
  | 'unit-fix' | 'scale-shift' | 'date-in-money' | 'invalid-value'
  | 'retro-cut' | 'raise' | 'fill' | 'clear' | 'unknown';

/** Виды, которые НЕ являются движением плана, а являются порчей данных. */
export const DEFECT_KINDS: readonly PlanEventKind[] = ['scale-shift', 'date-in-money', 'invalid-value'];

/** Одна правка плановой ячейки строки. */
export interface PlanEvent {
  /** Адрес ячейки на листе книги («H28») — там правку видно глазами. */
  cell: string;
  /** Плановая колонка правки. */
  column: PlanColumn;
  /** Прежнее значение, тыс. руб.; null — пусто ИЛИ неизвестно (см. wasKnown). */
  was: number | null;
  /** Новое значение, тыс. руб.; null — пусто ИЛИ неизвестно (см. becameKnown). */
  became: number | null;
  /**
   * became − was, тыс. руб. Пустая ячейка читается как «плана нет» = 0, поэтому
   * у 'fill' delta = became, у 'clear' delta = −was. Если сторона НЕИЗВЕСТНА
   * (маркер журнала), delta = null — арифметику по незнанию не выдумываем.
   */
  delta: number | null;
  /**
   * Момент правки — время книги (часовой пояс книги, Asia/Kamchatka) в виде
   * «YYYY-MM-DDTHH:mm:ss» БЕЗ смещения. Смещение не приписываем: журнал хранит
   * Google-serial без зоны, и подпись «Z» выдала бы пересчёт за точный момент.
   */
  at: string;
  /** Номер календарных суток правки (дней от 1970-01-01) — для сравнений. */
  atDay: number;
  /** Автор правки, как записан журналом (почта оператора). Пусто → ''. */
  author: string;
  kind: PlanEventKind;
  /** false — журнал честно пишет, что прежнее значение не отслежено. */
  wasKnown: boolean;
  /** false — новое значение журналу неизвестно (встречается крайне редко). */
  becameKnown: boolean;
  /**
   * Был ли на момент правки факт (дата заключения Q уже проставлена и не позже
   * правки). null — дата факта не передана, судить не о чем. Правка плана ПОСЛЕ
   * заключения — самый сильный признак изъятия экономии.
   */
  factAtEdit: boolean | null;
}

// ── Ключ строки: поле «Строка» журнала ────────────────────────────────

/**
 * Разобранное поле «Строка» (колонка D журнала). В живых книгах встречаются
 * ДВА формата (замер 18.08): УФБП/УО пишут «№ 38 · Услуги почтовой связи»,
 * УД — голый номер «177». Номер — это № п/п (колонка A листа), а НЕ номер
 * строки листа: живой пример УД — ячейка J177 при № п/п 195.
 */
export interface ParsedJournalRowKey {
  /** № п/п строки (колонка A), целое ≥ 1; null — поле не разобрано. */
  ordinal: number | null;
  /** Предмет из поля, если он там был; null — формат без предмета. */
  subject: string | null;
  /** true — предмет обрезан журналом (оканчивается многоточием «…»). */
  truncated: boolean;
  /** Исходное поле как пришло (нормализованы только пробелы) — для показа. */
  raw: string;
}

/** Разделитель «номер · предмет» в поле «Строка» (U+00B7 MIDDLE DOT). */
const ROW_KEY_SEPARATOR = '·';

/**
 * Разбирает поле «Строка» журнала правок. Терпим к обоим живым форматам и к
 * мусору: номер обязан быть целым положительным, иначе ordinal = null и строка
 * честно остаётся несопоставленной (молча приписывать правку соседней строке
 * хуже, чем признать, что ключ не читается).
 */
export function parseJournalRowKey(raw: unknown): ParsedJournalRowKey {
  // Неразрывные пробелы приходят из Google-ячеек и ломают любые regexp.
  const text = String(raw ?? '')
    .replace(/ /g, ' ')
    .trim();

  const empty: ParsedJournalRowKey = { ordinal: null, subject: null, truncated: false, raw: text };
  if (text === '') return empty;

  // Формат 2: голый номер («177»). Google отдаёт числа и как «177», и как «177.0».
  const bare = text.match(/^(\d+)(?:[.,]0+)?$/);
  if (bare) {
    const ordinal = parseInt(bare[1], 10);
    return ordinal >= 1 ? { ordinal, subject: null, truncated: false, raw: text } : empty;
  }

  // Формат 1: «№ 38 · Услуги почтовой связи». Предмет может содержать переводы
  // строк (операторы вставляют многострочные наименования) — флаг /s обязателен.
  const withSubject = text.match(
    new RegExp(`^(?:№|N|#)\\s*(\\d+)\\s*(?:${ROW_KEY_SEPARATOR}\\s*(.*))?$`, 's'),
  );
  if (!withSubject) return empty;

  const ordinal = parseInt(withSubject[1], 10);
  if (!(ordinal >= 1)) return empty;

  const rest = (withSubject[2] ?? '').replace(/\s+/g, ' ').trim();
  const truncated = rest.endsWith('…');
  const subject = rest === '' ? null : truncated ? rest.slice(0, -1).trim() : rest;

  return { ordinal, subject: subject === '' ? null : subject, truncated, raw: text };
}

// ── Чтение значений журнала ───────────────────────────────────────────

/**
 * Маркеры ПУСТОТЫ в колонках «Было»/«Стало». «(пусто)» пишет сам скрипт
 * журнала; «Х» — канон книги («в случае отсутствия проставляется Х»).
 */
const EMPTY_MARKERS: ReadonlySet<string> = new Set([
  '(пусто)',
  '(empty)',
  'х',
  'x',
  '-',
  '–',
  '—',
]);

/**
 * Маркеры НЕЗНАНИЯ: журнал признаёт, что прежнее значение не отслежено (живой
 * маркер УКСиМП «(до массовой правки не отслежено)»). Отличать от пустоты
 * обязательно — иначе незнание превратится в «плана не было».
 */
const UNKNOWN_MARKER_RE = /^\(.*не\s+отслежен.*\)$/i;

/** Состояние ячейки по журналу: число, честная пустота или честное незнание. */
type CellState =
  | { known: true; value: number }
  | { known: true; value: null }
  | { known: false; value: null };

const UNKNOWN_STATE: CellState = { known: false, value: null };
const EMPTY_STATE: CellState = { known: true, value: null };

/**
 * Число целиком, во всех формах, которые живьём пишет журнал: «34975.0»,
 * «3.497500217E7» (экспонента — живой УО H28), «-12», «.5». Регулярка нужна
 * вместо голого parseFloat, потому что parseFloat('12 рублей') вернёт 12 и
 * выдаст обрывок текста за сумму.
 */
const NUMERIC_RE = /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/;

/**
 * Читает значение денежной ячейки из журнала. Формат журнала — машинный
 * («32440.54795», «3.497500217E7»), но операторский («1 234,56») тоже
 * допускаем: журнал пишет то, что видел, а видел он ячейку листа.
 */
function readCellState(raw: unknown): CellState {
  if (typeof raw === 'number') {
    return Number.isFinite(raw) ? { known: true, value: raw } : UNKNOWN_STATE;
  }
  const s = String(raw ?? '')
    .replace(/ /g, ' ')
    .trim();
  if (s === '') return EMPTY_STATE;
  if (EMPTY_MARKERS.has(s.toLowerCase())) return EMPTY_STATE;
  if (UNKNOWN_MARKER_RE.test(s)) return UNKNOWN_STATE;

  // Пробелы-разделители тысяч и запятая-десятичная — операторский формат листа.
  const cleaned = s.replace(/\s/g, '').replace(/,/g, '.');
  if (NUMERIC_RE.test(cleaned)) {
    const n = Number(cleaned);
    if (Number.isFinite(n)) return { known: true, value: n };
  }

  // Непонятный текст в денежной ячейке — это не ноль и не пустота, а незнание.
  return UNKNOWN_STATE;
}

// ── Момент правки ─────────────────────────────────────────────────────

/** Смещение Google-serial относительно Unix-эпохи (совпадает с parse-sheet-date). */
const SERIAL_EPOCH_OFFSET = 25569;
const MS_PER_DAY = 86400000;

/** Разобранный момент правки: подпись времени книги + номер суток. */
interface ParsedInstant {
  at: string;
  atDay: number;
}

const pad2 = (n: number): string => String(n).padStart(2, '0');

function instantOf(y: number, mo: number, d: number, h: number, mi: number, s: number): ParsedInstant {
  return {
    at: `${y}-${pad2(mo)}-${pad2(d)}T${pad2(h)}:${pad2(mi)}:${pad2(s)}`,
    atDay: Date.UTC(y, mo - 1, d) / MS_PER_DAY,
  };
}

/**
 * Разбирает колонку «Время» журнала. Живые формы (замер 18.08): Google-serial с
 * дробью (46248.6623103 = 14.08.2026 15:53:44), «дд.мм.гггг чч:мм:сс»,
 * «дд.мм.гггг». Дополнительно принимаем ISO и Date — так роут может отдать уже
 * разобранное время, не подгоняя его обратно под формат листа.
 */
export function parseJournalInstant(raw: unknown): ParsedInstant | null {
  if (raw instanceof Date) {
    if (Number.isNaN(raw.getTime())) return null;
    return instantOf(
      raw.getFullYear(), raw.getMonth() + 1, raw.getDate(),
      raw.getHours(), raw.getMinutes(), raw.getSeconds(),
    );
  }

  const s = String(raw ?? '').trim();
  if (s === '') return null;

  // «дд.мм.гггг» и «дд.мм.гггг чч:мм[:сс]»
  const ru = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})(?:[\sT]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (ru) {
    return instantOf(
      parseInt(ru[3], 10), parseInt(ru[2], 10), parseInt(ru[1], 10),
      parseInt(ru[4] ?? '0', 10), parseInt(ru[5] ?? '0', 10), parseInt(ru[6] ?? '0', 10),
    );
  }

  // Google-serial: целая часть — сутки, дробная — доля суток по часам книги.
  const serial = Number(s);
  if (Number.isFinite(serial) && serial > 40000 && serial < 60000) {
    const day = Math.floor(serial) - SERIAL_EPOCH_OFFSET;
    // Дробь считаем в секундах и округляем: Google хранит её с плавающей
    // ошибкой (…39613097222), и без округления получаются 15:53:43.9999.
    let secs = Math.round((serial - Math.floor(serial)) * 86400);
    let dayShift = 0;
    if (secs >= 86400) { secs -= 86400; dayShift = 1; }
    const base = new Date((day + dayShift) * MS_PER_DAY);
    return instantOf(
      base.getUTCFullYear(), base.getUTCMonth() + 1, base.getUTCDate(),
      Math.floor(secs / 3600), Math.floor((secs % 3600) / 60), secs % 60,
    );
  }

  // ISO «YYYY-MM-DD[THH:mm:ss]» — берём компоненты из строки, зону игнорируем.
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s](\d{2}):(\d{2})(?::(\d{2}))?)?/);
  if (iso) {
    return instantOf(
      parseInt(iso[1], 10), parseInt(iso[2], 10), parseInt(iso[3], 10),
      parseInt(iso[4] ?? '0', 10), parseInt(iso[5] ?? '0', 10), parseInt(iso[6] ?? '0', 10),
    );
  }

  return null;
}

/** Адрес ячейки «H28» → { letter, row }; мусор → null. */
function parseCellAddress(raw: unknown): { letter: string; row: number } | null {
  const m = String(raw ?? '').trim().toUpperCase().match(/^([A-Z]{1,2})(\d+)$/);
  if (!m) return null;
  return { letter: m[1], row: parseInt(m[2], 10) };
}

// ── Вход модуля ───────────────────────────────────────────────────────

/**
 * Одна запись листа «_ChangeLog» книги. Поля названы по живой шапке:
 * A Лист | B Ячейка | C Столбец | D Строка | E Было | F Стало | G Время |
 * H Автор | I Приоритет | J Статус. Приоритет и статус модулю не нужны:
 * это служебные поля рассылки, к плану отношения не имеют.
 */
export interface JournalRecord {
  /**
   * A «Лист» — имя листа книги. ВНИМАНИЕ: имя не совпадает с именем управления
   * во всех книгах — УФБП пишет «УФБП», а УО пишет «ВСЕ» (замер 18.08). Поэтому
   * фильтр по листу необязателен и по умолчанию выключен: включать его надо,
   * зная имя конкретной книги, иначе он вырежет всю историю.
   */
  sheet?: unknown;
  /** B «Ячейка» — адрес правки («H28»). */
  cell: unknown;
  /** C «Столбец» — подпись колонки. Свободный текст (п.27), в вывод НЕ идёт. */
  column?: unknown;
  /** D «Строка» — «№ 38 · Услуги почтовой связи» либо «177». */
  row: unknown;
  /** E «Было». */
  was: unknown;
  /** F «Стало». */
  became: unknown;
  /** G «Время» — Google-serial, «дд.мм.гггг чч:мм:сс» или ISO. */
  at: unknown;
  /** H «Автор». */
  author?: unknown;
}

/** Текущее состояние строки листа — то, к чему приклеивается история. */
export interface PlanRowInput {
  /** № п/п строки (колонка A) — ключ сопоставления с полем «Строка» журнала. */
  ordinal: number;
  /** Текущее «ИТОГО план» (K), тыс. руб.; null — пусто либо нечитаемо. */
  planNow: number | null;
  /**
   * Дата заключения (Q). Любая форма, понятная dayNumberOf: serial, «дд.мм.гггг»,
   * ISO, Date. Отсутствие/«Х» → факта нет, признак factAtEdit останется null.
   */
  factDate?: unknown;
  /** Номер строки на листе (1-based) — только для подписей, необязателен. */
  sheetRow?: number;
  /** Предмет закупки — только для подписей, необязателен. */
  subject?: string;
}

export interface PlanProvenanceOptions {
  /**
   * Имя листа книги для ФИЛЬТРА журнала. Если задано — берутся только записи с
   * этим листом. Живые имена различаются («УФБП» против «ВСЕ» у УО), поэтому
   * без уверенности в имени поле лучше не задавать: пустой фильтр честнее
   * фильтра, который молча съест всю историю.
   */
  sheetName?: string;
  /**
   * Подпись книги/листа для готовых фраз («УКСиМП»). На фильтрацию не влияет —
   * нужна затем, чтобы у каждого текста проверки был адрес (канон п.3,
   * кластер В: «имя листа в каждый текст проверки»).
   */
  bookLabel?: string;
}

// ── Выход модуля ──────────────────────────────────────────────────────

/**
 * Честный признак наблюдаемости. Существует ради одного запрета: интерфейс НЕ
 * имеет права сказать «правок не было», когда журнал просто не ведётся.
 * Разброс живой: УО 33 724 записи против УИО 13 — молчание УИО ничего не
 * доказывает.
 */
export interface PlanObservability {
  /** Сколько записей журнала книги пришло на вход (после фильтра по листу). */
  journalEntries: number;
  /** Есть ли в журнале хоть одна запись про ЭТУ строку (по любой колонке). */
  coversRow: boolean;
  /** Сколько записей по этой строке касаются плановых ячеек H/I/J/K. */
  planEntries: number;
  /** Сколько записей журнала пришлось отбросить: не читается ключ строки. */
  unparsedRowKeys: number;
  /** Сколько записей журнала пришлось отбросить: не читается адрес ячейки. */
  unparsedCells: number;
  /** Готовая честная подпись для интерфейса. */
  note: string;
}

/** Сводка по плановой истории строки. */
export interface PlanProvenanceSummary {
  /**
   * Сколько плана УШЛО ретро-снижениями, тыс. руб. Положительное число: сумма
   * |delta| по событиям 'retro-cut'. Исправления единиц ('unit-fix') сюда НЕ
   * входят — они плана не уменьшают. Это и есть «экономия, растворённая в плане».
   */
  retroCutTotal: number;
  retroCutCount: number;
  /**
   * Часть ретро-снижений, случившаяся уже ПОСЛЕ даты заключения, тыс. руб.
   * null — дата факта строки не передана, судить не о чем.
   */
  retroCutAfterFactTotal: number | null;
  retroCutAfterFactCount: number | null;
  /** Сколько плана убрано в пустоту ('clear'), тыс. руб.; отдельно от снижений. */
  clearedTotal: number;
  /** Сколько исправлений единиц найдено — их надо показывать, но не суммировать. */
  unitFixCount: number;
  /**
   * Переездов запятой (×100, ×100 000 и прочие точные степени десяти). В
   * «ушедший план» не входят: сумма не менялась, менялся масштаб записи.
   */
  scaleShiftCount: number;
  /**
   * Правок, где в денежной ячейке оказалась ДАТА. Не снижение плана, а дефект
   * заполнения: адрес тот же, но действие другое — починить ячейку.
   */
  dateInMoneyCount: number;
  /** Правок, где плановая сумма ушла в минус — заведомо испорченная ячейка. */
  invalidValueCount: number;
  /**
   * Сколько «плана» насчиталось бы, если сложить дефекты (переезд запятой,
   * даты, минусы) вместе с настоящими снижениями, тыс. руб. Нужно ровно затем,
   * чтобы было чем ответить на вопрос «а почему у вас число меньше, чем в лоб».
   */
  defectMassExcluded: number;
  /** Первое известное значение плана по наблюдаемой колонке, тыс. руб. */
  firstKnownPlan: number | null;
  /** Момент первого известного значения (время книги) — null, если неизвестен. */
  firstKnownAt: string | null;
  /** Последнее известное значение плана по наблюдаемой колонке, тыс. руб. */
  lastKnownPlan: number | null;
  /** Момент последнего известного значения; null — значение взято «на сейчас». */
  lastKnownAt: string | null;
  /** По какой колонке выведены first/last (K предпочтительна); null — журнал молчит. */
  planColumnObserved: PlanColumn | null;
  /** Готовая фраза диагноста: механизм + адрес + действие (канон п.53). */
  note: string;
}

/** Провенанс плановых сумм одной строки. */
export interface PlanProvenance {
  /** № п/п строки (колонка A) — тот же ключ, что в поле «Строка» журнала. */
  ordinal: number;
  /** Текущее «ИТОГО план» (K) из строки листа, тыс. руб. */
  planNow: number | null;
  /** События по времени; дедуп по (ячейка, момент, было, стало). */
  events: PlanEvent[];
  summary: PlanProvenanceSummary;
  observability: PlanObservability;
}

// ── Классификация ─────────────────────────────────────────────────────

/**
 * Вид правки из пары состояний. ПОРЯДОК ПРОВЕРОК — канон, и он не произволен:
 *
 *   1) незнание — о нём судить нельзя;
 *   2) появление/исчезновение — пустота не число, отношения с ней не считаются;
 *   3) единицы (коридор ×1000) и переезд запятой (точная степень десяти) —
 *      РАНЬШЕ полосы дат, потому что законная правка «46,2 тыс. → 46 200 руб.»
 *      даёт «Стало» целым внутри полосы дат и иначе была бы принята за дату;
 *   4) дата в денежной ячейке;
 *   5) и только потом направление изменения.
 *
 * Если масштаб проверять после направления, переезд запятой навсегда осядет в
 * сумме ретро-снижений — ровно это и давало у УО 27 млрд «ушедшего плана».
 */
function classifyStates(was: CellState, became: CellState): PlanEventKind {
  if (!was.known || !became.known) return 'unknown';
  if (was.value === null && became.value !== null) return 'fill';
  if (was.value !== null && became.value === null) return 'clear';
  if (was.value === null || became.value === null) return 'unknown'; // пусто→пусто: не правка

  const a = was.value;
  const b = became.value;
  if (a === b) return 'unknown'; // значение не изменилось — вызывающий такие отсеивает

  if (a !== 0 && b !== 0) {
    const ratio = Math.abs(a) > Math.abs(b) ? Math.abs(a / b) : Math.abs(b / a);
    if (ratio >= UNIT_FIX_RATIO_MIN && ratio <= UNIT_FIX_RATIO_MAX) return 'unit-fix';
    if (isExactPowerOfTen(ratio)) return 'scale-shift';
  }

  if (looksLikeDateSerial(a) || looksLikeDateSerial(b)) return 'date-in-money';

  // Отрицательная плановая сумма невозможна по существу: закупку нельзя
  // запланировать на минус. Такую пару выводим из «ушедшего плана» — иначе один
  // испорченный минус тянет за собой всю витрину (живой УКСиМП J82: минус
  // 268 939 давал 270 230 тыс. руб. «растворённой экономии», то есть 98 % всего
  // остатка книги).
  if (a < 0 || b < 0) return 'invalid-value';

  return b < a ? 'retro-cut' : 'raise';
}

/**
 * Классификация правки из СЫРЫХ значений журнала — публичный вход в тот же
 * канон. Существует, чтобы вызывающему не приходилось знать внутреннее
 * представление состояния ячейки, а тесты били по той же логике, что и сборка.
 */
export function classifyPlanEdit(was: unknown, became: unknown): PlanEventKind {
  return classifyStates(readCellState(was), readCellState(became));
}

// ── Подписи ───────────────────────────────────────────────────────────

/**
 * Тысячи рублей до копеек, по-русски: «1 104,72». Канон кластера В п.3 —
 * никаких голых float на 15 знаков в текстах проверок. Разряды разделяет
 * НЕРАЗРЫВНЫЙ пробел (U+00A0): иначе перенос строки рвёт сумму пополам и
 * «1 104,72» читается как два числа.
 */
function formatThousands(value: number): string {
  const fixed = Math.abs(value).toFixed(2);
  const [whole, frac] = fixed.split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${value < 0 ? '−' : ''}${grouped},${frac}`;
}

/** «2026-08-05T15:53:44» → «05.08.2026». */
function humanDate(at: string): string {
  const m = at.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : at;
}

// ── Сборка ────────────────────────────────────────────────────────────

interface PreparedRecord {
  ordinal: number;
  event: PlanEvent | null;
  isPlanCell: boolean;
}

/**
 * Готовит записи журнала: разбирает ключ строки, адрес, значения и момент.
 * Нечитаемые записи не выбрасываются молча — они считаются в счётчиках
 * наблюдаемости, чтобы дыра в данных была видна, а не замазана.
 */
function prepareJournal(
  journal: readonly JournalRecord[],
  options: PlanProvenanceOptions,
): {
  byOrdinal: Map<number, PreparedRecord[]>;
  entries: number;
  unparsedRowKeys: number;
  unparsedCells: number;
} {
  const wantSheet = options.sheetName?.trim().toLowerCase();
  const byOrdinal = new Map<number, PreparedRecord[]>();
  let entries = 0;
  let unparsedRowKeys = 0;
  let unparsedCells = 0;

  for (const rec of journal) {
    if (wantSheet !== undefined && wantSheet !== '') {
      const sheet = String(rec.sheet ?? '').trim().toLowerCase();
      if (sheet !== wantSheet) continue;
    }
    entries += 1;

    const key = parseJournalRowKey(rec.row);
    if (key.ordinal === null) {
      unparsedRowKeys += 1;
      continue;
    }

    const addr = parseCellAddress(rec.cell);
    if (!addr) {
      unparsedCells += 1;
      // Строку журнал всё же видит — регистрируем её без события.
      pushPrepared(byOrdinal, { ordinal: key.ordinal, event: null, isPlanCell: false });
      continue;
    }

    if (!PLAN_COLUMN_SET.has(addr.letter)) {
      pushPrepared(byOrdinal, { ordinal: key.ordinal, event: null, isPlanCell: false });
      continue;
    }

    const moment = parseJournalInstant(rec.at);
    if (!moment) {
      // Правка плана без читаемого момента: в ленту событий её ставить некуда,
      // но строку журнал видит — иначе она уйдёт в «правок не было».
      pushPrepared(byOrdinal, { ordinal: key.ordinal, event: null, isPlanCell: false });
      continue;
    }

    const was = readCellState(rec.was);
    const became = readCellState(rec.became);
    const kind = classifyStates(was, became);

    // Правка без изменения значения (журнал пишет и «5.0 → 5») планом не двигает.
    if (was.known && became.known && was.value === became.value) {
      pushPrepared(byOrdinal, { ordinal: key.ordinal, event: null, isPlanCell: true });
      continue;
    }

    const delta =
      was.known && became.known ? (became.value ?? 0) - (was.value ?? 0) : null;

    pushPrepared(byOrdinal, {
      ordinal: key.ordinal,
      isPlanCell: true,
      event: {
        cell: `${addr.letter}${addr.row}`,
        column: addr.letter as PlanColumn,
        was: was.value,
        became: became.value,
        delta,
        at: moment.at,
        atDay: moment.atDay,
        author: String(rec.author ?? '').trim(),
        kind,
        wasKnown: was.known,
        becameKnown: became.known,
        factAtEdit: null, // проставляется на сборке строки — там известна дата факта
      },
    });
  }

  return { byOrdinal, entries, unparsedRowKeys, unparsedCells };
}

function pushPrepared(map: Map<number, PreparedRecord[]>, rec: PreparedRecord): void {
  const list = map.get(rec.ordinal);
  if (list) list.push(rec);
  else map.set(rec.ordinal, [rec]);
}

/** Колонка, по которой ведём «первое/последнее значение плана»: K приоритетна. */
function pickObservedColumn(events: readonly PlanEvent[]): PlanColumn | null {
  const counts = new Map<PlanColumn, number>();
  for (const e of events) counts.set(e.column, (counts.get(e.column) ?? 0) + 1);
  if (counts.size === 0) return null;
  if (counts.has('K')) return 'K';
  let best: PlanColumn | null = null;
  let bestCount = -1;
  for (const col of PLAN_COLUMNS) {
    const c = counts.get(col) ?? 0;
    if (c > bestCount) { bestCount = c; best = col; }
  }
  return bestCount > 0 ? best : null;
}

function buildObservabilityNote(o: Omit<PlanObservability, 'note'>): string {
  if (o.journalEntries === 0) {
    return 'Журнал правок книги пуст. Это не значит, что правок не было: '
      + 'журнал ведётся неравномерно (от 33 724 записей у одного управления до '
      + '13 у другого), и здесь он просто молчит. Провенанс плана по этой строке '
      + 'недоступен — включить журнал в книге.';
  }
  // Журнал есть, но НИ ОДНА запись не привязывается к строке. Живой случай —
  // УАГЗО: там журнал ведут по укороченной шапке «Ячейка | Было | Стало | Время |
  // Автор | Статус», без колонки «Строка» вовсе (замер 18.08: 69 записей, ключ
  // не читается у всех 69). Сказать про такую книгу «правок по строке нет» —
  // выдать отсутствие КЛЮЧА за отсутствие ПРАВОК; это ровно та подмена, против
  // которой заведён признак наблюдаемости.
  if (o.unparsedRowKeys === o.journalEntries && o.journalEntries > 0) {
    return `Журнал правок книги ведётся (${o.journalEntries} записей), но НИ ОДНА запись не `
      + 'несёт номера строки: в этой книге журнал заполняется по укороченной шапке, без '
      + 'колонки «Строка». Правки видны только целиком по книге и к закупкам не привязываются — '
      + 'судить о провенансе плана этой строки нельзя. Добавить колонку «Строка» в журнал книги.';
  }

  if (!o.coversRow) {
    const caveat = o.unparsedRowKeys > 0
      ? ` У ${o.unparsedRowKeys} записей номер строки не читается — они могли относиться и к этой строке.`
      : '';
    return `Журнал правок книги ведётся (${o.journalEntries} записей), `
      + 'но правок по этой строке в нём нет.' + caveat;
  }
  if (o.planEntries === 0) {
    return `Журнал правок книги ведётся (${o.journalEntries} записей); `
      + 'по этой строке правки есть, но плановых ячеек H/I/J/K они не касались.';
  }
  return `Журнал правок книги ведётся (${o.journalEntries} записей); `
    + `по плановым ячейкам этой строки — ${o.planEntries}.`;
}

function buildSummaryNote(
  summary: Omit<PlanProvenanceSummary, 'note'>,
  events: readonly PlanEvent[],
  observability: Omit<PlanObservability, 'note'>,
  ordinal: number,
  sheetName: string | undefined,
): string {
  const where = sheetName ? `${sheetName}, строка № ${ordinal}` : `строка № ${ordinal}`;

  if (observability.journalEntries === 0) {
    return `${where}: провенанс плана неизвестен — журнал правок книги не ведётся. `
      + 'Судить о «растворённой экономии» по этой строке нельзя ни в одну сторону.';
  }
  if (events.length === 0) {
    return `${where}: плановые суммы по журналу не правились.`;
  }

  const parts: string[] = [];

  if (summary.retroCutCount > 0) {
    const cuts = events.filter((e) => e.kind === 'retro-cut');
    const addresses = [...new Set(cuts.map((e) => e.cell))].join(', ');
    const last = cuts[cuts.length - 1];
    parts.push(
      `${where}: план снижали задним числом ${summary.retroCutCount} раз(а) `
      + `на ${formatThousands(summary.retroCutTotal)} тыс. руб. `
      + `(${addresses}; последняя правка ${humanDate(last.at)}). `
      + 'Такое снижение убирает экономию из разницы план−факт — она перестаёт быть видимой. '
      + 'Сверить план с НМЦК процедуры в реестре определения поставщика.',
    );
    if (summary.retroCutAfterFactCount !== null && summary.retroCutAfterFactCount > 0) {
      parts.push(
        `Из них ${summary.retroCutAfterFactCount} правка(и) на `
        + `${formatThousands(summary.retroCutAfterFactTotal ?? 0)} тыс. руб. сделаны уже ПОСЛЕ `
        + 'заключения — это прямой признак изъятия экономии перераспределением.',
      );
    }
  }

  if (summary.unitFixCount > 0) {
    const fixes = events.filter((e) => e.kind === 'unit-fix');
    const addresses = [...new Set(fixes.map((e) => e.cell))].join(', ');
    parts.push(
      `Исправлений единиц — ${summary.unitFixCount} (${addresses}): сумму вводили в рублях `
      + 'вместо тысяч и привели к канону книги. План при этом не менялся, в «ушедший план» '
      + 'такие правки не входят.',
    );
  }

  if (summary.clearedTotal > 0) {
    parts.push(
      `Плановые ячейки очищали в пустоту на ${formatThousands(summary.clearedTotal)} тыс. руб. — `
      + 'проверить, перенесён ли план на другую строку.',
    );
  }

  if (summary.scaleShiftCount > 0) {
    const shifts = events.filter((e) => e.kind === 'scale-shift');
    const addresses = [...new Set(shifts.map((e) => e.cell))].join(', ');
    parts.push(
      `Переездов запятой — ${summary.scaleShiftCount} (${addresses}): у числа менялся масштаб `
      + '(в сто, в сто тысяч раз), сама сумма прежняя. В «ушедший план» не входят.',
    );
  }

  if (summary.dateInMoneyCount > 0) {
    const dates = events.filter((e) => e.kind === 'date-in-money');
    const addresses = [...new Set(dates.map((e) => e.cell))].join(', ');
    parts.push(
      `В денежную ячейку попадала дата — ${summary.dateInMoneyCount} раз(а) (${addresses}): `
      + 'целое число из календарной полосы вместо суммы. Это дефект заполнения, а не снижение '
      + 'плана, поэтому в «ушедший план» он не входит — но ячейку надо проверить глазами: '
      + 'если там действительно была сумма в 44–48 млн руб. без копеек, правило ошиблось.',
    );
  }

  if (summary.invalidValueCount > 0) {
    const bad = events.filter((e) => e.kind === 'invalid-value');
    const addresses = [...new Set(bad.map((e) => e.cell))].join(', ');
    parts.push(
      `Плановая сумма уходила в минус — ${summary.invalidValueCount} раз(а) (${addresses}). `
      + 'Отрицательного плана не бывает: ячейку испортили. В «ушедший план» не входит, '
      + 'исправить значение в книге.',
    );
  }

  if (parts.length === 0) {
    parts.push(
      `${where}: плановые суммы правились ${events.length} раз(а), снижений задним числом нет.`,
    );
  }

  return parts.join(' ');
}

/**
 * Собирает провенанс плановых сумм по каждой переданной строке.
 *
 * Возвращает ровно столько элементов, сколько строк на входе, и в том же
 * порядке — строка без единой записи в журнале тоже получает ответ, но с
 * честным observability, а не с пустотой, которую интерфейс прочитает как
 * «правок не было» (канон п.102: дыра наблюдаемости ≠ отсутствие практики).
 */
export function buildPlanProvenance(
  journal: readonly JournalRecord[],
  rows: readonly PlanRowInput[],
  options: PlanProvenanceOptions = {},
): PlanProvenance[] {
  const prepared = prepareJournal(journal, options);

  return rows.map((row) => {
    const records = prepared.byOrdinal.get(row.ordinal) ?? [];
    const factDay = dayNumberOf(row.factDate);

    const events = records
      .map((r) => r.event)
      .filter((e): e is PlanEvent => e !== null)
      .map((e) => ({
        ...e,
        // Факт «был на момент правки», если дата заключения известна и не позже правки.
        factAtEdit: factDay === null ? null : factDay <= e.atDay,
      }))
      .sort((a, b) => (a.at === b.at ? a.cell.localeCompare(b.cell) : a.at.localeCompare(b.at)));

    // Дедуп: журнал живьём пишет один и тот же триплет по нескольку раз
    // (живой пример УД J177 — три идентичные записи одной правки).
    const seen = new Set<string>();
    const deduped = events.filter((e) => {
      const key = `${e.cell}|${e.at}|${e.was}|${e.became}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    const observabilityBase = {
      journalEntries: prepared.entries,
      coversRow: records.length > 0,
      planEntries: records.filter((r) => r.isPlanCell).length,
      unparsedRowKeys: prepared.unparsedRowKeys,
      unparsedCells: prepared.unparsedCells,
    };

    const label = options.bookLabel ?? options.sheetName;
    const summaryBase = buildSummaryBase(deduped, row);
    const summary: PlanProvenanceSummary = {
      ...summaryBase,
      note: buildSummaryNote(summaryBase, deduped, observabilityBase, row.ordinal, label),
    };

    return {
      ordinal: row.ordinal,
      planNow: row.planNow,
      events: deduped,
      summary,
      observability: { ...observabilityBase, note: buildObservabilityNote(observabilityBase) },
    };
  });
}

function buildSummaryBase(
  events: readonly PlanEvent[],
  row: PlanRowInput,
): Omit<PlanProvenanceSummary, 'note'> {
  const cuts = events.filter((e) => e.kind === 'retro-cut');
  const retroCutTotal = cuts.reduce((acc, e) => acc + Math.abs(e.delta ?? 0), 0);

  const factKnown = events.some((e) => e.factAtEdit !== null);
  const afterFact = cuts.filter((e) => e.factAtEdit === true);

  const cleared = events.filter((e) => e.kind === 'clear');
  const clearedTotal = cleared.reduce((acc, e) => acc + Math.abs(e.delta ?? 0), 0);

  const scaleShifts = events.filter((e) => e.kind === 'scale-shift');
  const datesInMoney = events.filter((e) => e.kind === 'date-in-money');
  const invalidValues = events.filter((e) => e.kind === 'invalid-value');
  const defectMassExcluded = events
    .filter((e) => DEFECT_KINDS.includes(e.kind) && (e.delta ?? 0) < 0)
    .reduce((acc, e) => acc + Math.abs(e.delta ?? 0), 0);

  const observedColumn = pickObservedColumn(events);
  const columnEvents = observedColumn === null
    ? []
    : events.filter((e) => e.column === observedColumn);

  // Ряд известных значений колонки в порядке времени: до первой правки и после
  // каждой. Пустота и незнание в ряд не входят — «значение плана» это число.
  let firstKnownPlan: number | null = null;
  let firstKnownAt: string | null = null;
  let lastKnownPlan: number | null = null;
  let lastKnownAt: string | null = null;

  for (const e of columnEvents) {
    if (firstKnownPlan === null && e.wasKnown && e.was !== null) {
      firstKnownPlan = e.was;
      firstKnownAt = e.at;
    }
    if (firstKnownPlan === null && e.becameKnown && e.became !== null) {
      firstKnownPlan = e.became;
      firstKnownAt = e.at;
    }
    if (e.becameKnown && e.became !== null) {
      lastKnownPlan = e.became;
      lastKnownAt = e.at;
    }
  }

  // Текущее состояние листа свежее любой записи журнала: если наблюдаемая
  // колонка — ИТОГО (K), последнее известное берём из самой строки.
  if (observedColumn === 'K' && row.planNow !== null) {
    lastKnownPlan = row.planNow;
    lastKnownAt = null; // null здесь значит «на сейчас», а не «неизвестно когда»
  }

  return {
    retroCutTotal,
    retroCutCount: cuts.length,
    retroCutAfterFactTotal: factKnown
      ? afterFact.reduce((acc, e) => acc + Math.abs(e.delta ?? 0), 0)
      : null,
    retroCutAfterFactCount: factKnown ? afterFact.length : null,
    clearedTotal,
    unitFixCount: events.filter((e) => e.kind === 'unit-fix').length,
    scaleShiftCount: scaleShifts.length,
    dateInMoneyCount: datesInMoney.length,
    invalidValueCount: invalidValues.length,
    defectMassExcluded,
    firstKnownPlan,
    firstKnownAt,
    lastKnownPlan,
    lastKnownAt,
    planColumnObserved: observedColumn,
  };
}

// ── Книжная сводка ────────────────────────────────────────────────────

/**
 * Сводка провенанса по всей книге — то, чем подписывается «экономия,
 * растворённая в плане» на витрине управления (канон п.102). Отдельно несёт
 * долю строк, вообще покрытых журналом: без неё число ретро-снижений читается
 * как характеристика управления, тогда как оно характеристика журнала.
 */
export interface BookProvenanceSummary {
  rows: number;
  /** Строк, по которым журнал хоть что-то знает. */
  rowsCovered: number;
  /** Строк с хотя бы одним ретро-снижением плана. */
  rowsWithRetroCut: number;
  /** Всего ретро-снижений и сколько плана они унесли, тыс. руб. */
  retroCutCount: number;
  retroCutTotal: number;
  /** Из них после заключения (там, где дата факта известна). */
  retroCutAfterFactCount: number;
  retroCutAfterFactTotal: number;
  /** Исправлений единиц — показываем отдельно, в «ушедший план» не входят. */
  unitFixCount: number;
  /** Переездов запятой, дат в денежных ячейках и минусов — дефекты заполнения. */
  scaleShiftCount: number;
  dateInMoneyCount: number;
  invalidValueCount: number;
  /** Сколько тыс. руб. эти дефекты добавили бы в «ушедший план», считай их в лоб. */
  defectMassExcluded: number;
  journalEntries: number;
  /** Готовая честная подпись витрины. */
  note: string;
}

export function summarizeBookProvenance(
  list: readonly PlanProvenance[],
  sheetName?: string,
): BookProvenanceSummary {
  const journalEntries = list.length > 0 ? list[0].observability.journalEntries : 0;
  const rowsCovered = list.filter((p) => p.observability.coversRow).length;
  const withCut = list.filter((p) => p.summary.retroCutCount > 0);

  const retroCutCount = list.reduce((a, p) => a + p.summary.retroCutCount, 0);
  const retroCutTotal = list.reduce((a, p) => a + p.summary.retroCutTotal, 0);
  const retroCutAfterFactCount = list.reduce((a, p) => a + (p.summary.retroCutAfterFactCount ?? 0), 0);
  const retroCutAfterFactTotal = list.reduce((a, p) => a + (p.summary.retroCutAfterFactTotal ?? 0), 0);
  const unitFixCount = list.reduce((a, p) => a + p.summary.unitFixCount, 0);
  const scaleShiftCount = list.reduce((a, p) => a + p.summary.scaleShiftCount, 0);
  const dateInMoneyCount = list.reduce((a, p) => a + p.summary.dateInMoneyCount, 0);
  const invalidValueCount = list.reduce((a, p) => a + p.summary.invalidValueCount, 0);
  const defectMassExcluded = list.reduce((a, p) => a + p.summary.defectMassExcluded, 0);

  const where = sheetName ? `${sheetName}: ` : '';
  const coverage = list.length === 0
    ? '0'
    : Math.round((rowsCovered / list.length) * 100).toString();

  const note = journalEntries === 0
    ? `${where}журнал правок не ведётся — провенанс плановых сумм по книге недоступен. `
      + 'Отсутствие следов здесь ничего не доказывает: это дыра наблюдаемости, а не чистые данные.'
    : `${where}журнал покрывает ${rowsCovered} строк(и) из ${list.length} (${coverage} %). `
      + `Ретро-снижений плана — ${retroCutCount} на ${formatThousands(retroCutTotal)} тыс. руб. `
      + `в ${withCut.length} строк(ах); из них после заключения — ${retroCutAfterFactCount}. `
      + `Исправлений единиц (рубли вместо тысяч) — ${unitFixCount}, в «ушедший план» они не входят. `
      + (defectMassExcluded > 0
        ? `Отдельно отложены дефекты заполнения: переездов запятой ${scaleShiftCount}, `
          + `дат в денежных ячейках ${dateInMoneyCount}, отрицательных сумм ${invalidValueCount}; `
          + `считай их снижениями в лоб — «ушедший план» `
          + `вырос бы на ${formatThousands(defectMassExcluded)} тыс. руб. Это не экономия, а грязь в данных. `
        : '')
      + 'По непокрытым строкам судить о правках плана нельзя.';

  return {
    rows: list.length,
    rowsCovered,
    rowsWithRetroCut: withCut.length,
    retroCutCount,
    retroCutTotal,
    retroCutAfterFactCount,
    retroCutAfterFactTotal,
    unitFixCount,
    scaleShiftCount,
    dateInMoneyCount,
    invalidValueCount,
    defectMassExcluded,
    journalEntries,
    note,
  };
}

/** Подписи плановых колонок наружу — интерфейсу нужны они, а не буквы. */
export function planColumnLabel(column: PlanColumn): string {
  return PLAN_COLUMN_LABEL[column];
}
