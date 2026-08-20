/**
 * Детектор подозрительных закупок — две независимые шкалы над ручным вводом.
 *
 * Формулировка задачи (владелец, 18.08.2026): «выглядит ли конкретная закупка
 * и числа в ней ошибкой ввода или подгоном». Книги ГРБС заполняются руками, и
 * в них живут два РАЗНЫХ рода странностей, которые нельзя складывать в один
 * балл (ошибка прежнего «скоринга доверия» — он смешивал их и получал число,
 * которое ничего не значило):
 *
 *   • ПОХОЖЕ НА ОПЕЧАТКУ — рука дрогнула. Лишний ноль, рубли вместо тысяч,
 *     год соседний, сумма скопирована сверху. Лечится правкой ячейки.
 *   • ПОХОЖЕ НА ПОДГОН — числа подобраны. Суммы липнут к порогу снизу, одна
 *     закупка разложена на несколько, факт равен плану до копейки, суммы
 *     правились уже после появления факта. Лечится проверкой документов.
 *
 * Поэтому наружу выходят ДВА списка признаков, а не один балл. У каждого
 * признака: механизм (что именно сработало), адрес (книга, лист, строка листа,
 * № п/п, ячейка) и сумма под риском — карточка диагноста канона п.53.
 *
 * Тон (канон): ни одна формулировка не обвиняет. Признак говорит, что
 * наблюдается и что это МОЖЕТ означать, и зовёт проверить строку. Совпадение
 * признака — не нарушение; отсутствие признака — не чистота.
 *
 * Малые выборки помечаются честно: `smallSample: true` и оговорка в `note`.
 * Такой признак показывать можно, опираться на него как на вывод — нельзя.
 *
 * Что здесь НЕ делается и почему:
 *   • Нет обращения к ЕИС и ИНН поставщика — их нет в источнике, поэтому
 *     «один и тот же поставщик» подменён связкой «одно учреждение + один
 *     предмет» и назван в объяснении своим именем.
 *   • Нет вывода статусов из свободного текста (канон п.27): комментарии и
 *     обоснования детектор не читает.
 *
 * Соседи: `anticorruption.ts` (агрегатные индикаторы ГРБС без адресов),
 * `anomaly.ts` (кросс-департаментные Z и Бенфорд — его `benfordAnalysis`
 * переиспользуется здесь как есть, второй реализации закона нет).
 *
 * Единицы: ВСЕ денежные величины — тысячи рублей, как колонки книг ГРБС
 * (H/I/J/K, V/W/X/Y, Z/AA/AB/AC — канон @aemr/shared/report-map.ts).
 */

import { LAW_44FZ_THRESHOLDS, dayNumberOf } from '@aemr/shared';
import { benfordAnalysis, type BenfordResult } from './anomaly.js';

// ────────────────────────────────────────────────────────────
// 1. Вход
// ────────────────────────────────────────────────────────────

/** Строка книги ГРБС в том минимуме, который нужен детектору. */
export interface AnomalyRow {
  /** Книга — короткое имя управления («УКСиМП»). */
  book: string;
  /** Лист книги («ВСЕ», «УДТХ»). */
  sheet: string;
  /** Номер строки листа — первый адрес закупки. */
  sheetRow: number;
  /** № п/п (колонка A) — второй адрес, переживает сортировки и вставки. */
  rowSeq: string;
  /** Подведомственное учреждение (колонка C). */
  subordinate: string;
  /** Предмет закупки (колонка G). */
  subject: string;
  /** Способ определения поставщика (колонка L): «ЕП», «ЭА», «ЭК», «ЭЗК». */
  method: string;
  /** План итого, тыс. ₽ (колонка K). */
  planTotal: number | null;
  /** Факт итого, тыс. ₽ (колонка Y). */
  factTotal: number | null;
  /** Экономия итого, тыс. ₽ (колонка AC). */
  economy: number | null;
  /** Планируемая дата (колонка N) в любом виде, который понимает parseSheetDate. */
  planDate: unknown;
  /** Фактическая дата заключения (колонка Q). */
  factDate: unknown;
}

/**
 * Запись журнала правок книги (_ChangeLog) — вход двух признаков, которые без
 * истории не выводятся: правка «в тысячу раз» и правка суммы после факта.
 */
export interface AnomalyJournalEntry {
  book: string;
  sheet: string;
  /** Адрес ячейки листа: «K96». */
  cell: string;
  /** Прежнее значение как его записал журнал (число, текст или «(пусто)»). */
  was: unknown;
  /** Новое значение как его записал журнал. */
  became: unknown;
  /**
   * Момент правки как его пишет книга. Живых форм две: «06.08.2026 17:17:20»
   * и порядковый номер Google (46240,4971 — доли суток). Понимаются обе.
   */
  at: unknown;
  author?: string;
}

// ────────────────────────────────────────────────────────────
// 2. Выход
// ────────────────────────────────────────────────────────────

/** Две шкалы. Никогда не складываются в одно число — это разные вопросы. */
export type AnomalyScale = 'typo' | 'fitted';

/** Код признака. Человеку показывается `title`, код — для кода и тестов. */
export type AnomalySign =
  // шкала «похоже на опечатку»
  | 'magnitude-outlier'
  | 'round-among-fractional'
  | 'year-off-by-one'
  | 'decimal-shift'
  | 'repeat-of-neighbour'
  | 'thousandfold-edit'
  // шкала «похоже на подгон»
  | 'benford-deviation'
  | 'threshold-hugging'
  | 'splitting-window'
  | 'fact-equals-plan'
  | 'retro-edit-after-fact'
  | 'zero-economy-mass';

/** Адрес находки — п.53: механизм бесполезен без места. */
export interface AnomalyAddress {
  book: string;
  sheet: string;
  /** Номер строки листа; 0 — признак не про строку, а про группу строк. */
  sheetRow: number;
  /** № п/п (колонка A). Пусто — у признака нет одной строки. */
  rowSeq: string;
  /** Ячейка листа («K96») либо диапазон/область («учреждение целиком»). */
  cell: string;
}

export interface AnomalyFinding {
  sign: AnomalySign;
  scale: AnomalyScale;
  /** Короткое имя признака по-русски. */
  title: string;
  /** Объяснение механизма: что наблюдается и что это может означать. */
  explanation: string;
  /** Сумма под риском, тыс. ₽ — сколько денег стоит за признаком. */
  amountAtRisk: number;
  address: AnomalyAddress;
  subordinate?: string;
  subject?: string;
  /** Строк, попавших в признак (для групповых — размер группы). */
  rows: number;
  /** Данных мало — признак показывать можно, опираться нельзя. */
  smallSample: boolean;
  /** Оговорка методики: чего признак не знает. */
  note?: string;
  /** Адреса остальных строк группы (для групповых признаков). */
  members?: AnomalyAddress[];
}

export interface AnomalyReport {
  /** Шкала «похоже на опечатку». */
  typo: AnomalyFinding[];
  /** Шкала «похоже на подгон». */
  fitted: AnomalyFinding[];
  /** Сколько находок по каждому признаку. */
  counts: Record<AnomalySign, number>;
  /** Деньги под риском по шкалам, тыс. ₽. Складывать шкалы нельзя. */
  amountAtRisk: { typo: number; fitted: number };
  /** Сколько строк вообще просмотрено. */
  rowsScanned: number;
  /** Общие оговорки отчёта. */
  notes: string[];
}

// ────────────────────────────────────────────────────────────
// 3. Пороги и допуски (с обоснованием — иначе это магические числа)
// ────────────────────────────────────────────────────────────

export const ANOMALY_LIMITS = {
  /**
   * Во сколько раз сумма должна превысить медиану своей группы, чтобы читаться
   * как выброс. 100 = два порядка: лишний ноль даёт ×10, рубли вместо тысяч —
   * ×1000. Два порядка — нижняя граница, ниже которой начинается обычный
   * разброс между «канцтовары» и «ремонт кровли».
   */
  magnitudeFactor: 100,
  /**
   * Медиана считается только по группе такого размера. На трёх строках медиана
   * — это просто средняя строка, и любой крупный контракт станет «выбросом».
   */
  minGroupForMedian: 8,
  /**
   * Доля соседей по группе с ДРОБНОЙ суммой, при которой ровная выделяется.
   *
   * Почему «дробная», а не «с копейками»: живой замер 18.08.2026 показал, что
   * копейки (нецелые рубли) есть лишь у 12 % строк — суммы в книги переносят
   * округлёнными до рубля. А вот дробная тысяча (1 210,59 тыс. ₽) встречается
   * у 65 % строк. Значит местный эквивалент «у соседей копейки» — это «у
   * соседей дробные тысячи».
   *
   * 0,6 — большинство: если две трети строк учреждения дробные, ровные
   * 500,00000 тыс. ₽ среди них выглядят прикидкой, а не ценой контракта.
   */
  fractionalNeighbourShare: 0.6,
  /**
   * «Ровная» сумма — кратная 100 тыс. ₽ (в единицах листа — кратная 100).
   * Шаг выбран по живому замеру 18.08.2026 на восьми книгах: среди строк
   * учреждений с преимущественно дробными суммами ровных по 1 тыс. ₽ — 688,
   * по 10 тыс. ₽ — 286, по 100 тыс. ₽ — 67. Первые два шага дают список,
   * который никто не станет проверять; сотня тысяч оставляет ровно те суммы,
   * которые выглядят прикидкой «на глаз».
   */
  roundStepThousandRub: 100,
  /**
   * Ширина коридора «липнет к порогу снизу»: последние 10 % порога.
   * Для ЕП 600 тыс. ₽ это 540–600 тыс. ₽.
   */
  thresholdCorridor: 0.10,
  /**
   * Опорная полоса, с которой сравнивается плотность коридора: 50–90 % порога.
   * Сравнение с СОСЕДНЕЙ полосой, а не с теоретическим распределением, —
   * потому что настоящее распределение цен нам никто не обещал.
   */
  thresholdReferenceFrom: 0.50,
  /** Во сколько раз плотность коридора должна превысить опорную, чтобы стать признаком. */
  thresholdDensityFactor: 2,
  /** Меньше стольких строк в коридоре — признак не выпускается. */
  thresholdMinRows: 5,
  /** Окно дробления в днях. Месяц — обычный горизонт одной потребности. */
  splittingWindowDays: 30,
  /** Меньше стольких однотипных закупок в окне — это не дробление, а совпадение. */
  splittingMinRows: 3,
  /** Минимум конкурентных закупок учреждения, чтобы говорить о массе «факт = план». */
  factEqualsPlanMinRows: 5,
  /** Доля «факт = план» среди конкурентных, выше которой это масса, а не случай. */
  factEqualsPlanShare: 0.5,
  /** Доля нулевой экономии среди конкурентных, выше которой выпускается признак. */
  zeroEconomyShare: 0.9,
  /** Экономия по модулю меньше этого (тыс. ₽) считается нулевой — округление листа. */
  economyEpsilonThousandRub: 0.001,
  /** Ниже этого размера выборки закон Бенфорда не применяется вовсе. */
  benfordMinSample: 30,
  /** Ниже этого размера выборки вывод Бенфорда помечается «данных мало». */
  benfordShakySample: 80,
  /** Уровень значимости хи-квадрат: p < 0,05 — отклонение считается заметным. */
  benfordAlpha: 0.05,
  /** Допуск сравнения сумм «до копейки» в тыс. ₽ (0,001 тыс. ₽ = 1 ₽). */
  moneyEpsilonThousandRub: 0.001,
  /**
   * Допуск при поиске правки «в кратное десяти число раз»: сравнивается
   * десятичный логарифм отношения, поэтому 0,005 — это примерно 1 % по самому
   * отношению. Живой случай, ради которого допуск не нулевой: правка
   * 34 975,0 → 34 975 002,17 даёт отношение 1000,0006, а не ровно 1000.
   */
  ratioTolerance: 0.005,
} as const;

/** Пороги 44-ФЗ, у которых имеет смысл искать «липнет снизу», тыс. ₽. */
const THRESHOLD_POINTS: ReadonlyArray<{ limit: number; label: string }> = [
  {
    limit: LAW_44FZ_THRESHOLDS.epSmallPurchaseSingleContractLimitThousandRub,
    label: 'предельный размер одного контракта с единственным поставщиком (600 тыс. ₽)',
  },
  {
    limit: LAW_44FZ_THRESHOLDS.eShopPurchaseLimitThousandRub,
    label: 'предел закупки через электронный магазин (5 млн ₽)',
  },
  {
    limit: LAW_44FZ_THRESHOLDS.quotationPurchaseLimitThousandRub,
    label: 'предел запроса котировок (10 млн ₽)',
  },
];

/** Денежные колонки книги ГРБС: план (H,I,J,K) и факт (V,W,X,Y). */
const PLAN_MONEY_COLUMNS = new Set(['H', 'I', 'J', 'K']);
const FACT_MONEY_COLUMNS = new Set(['V', 'W', 'X', 'Y']);
/** Колонка фактической даты — по ней видно, что факт у строки уже появился. */
const FACT_DATE_COLUMN = 'Q';

// ────────────────────────────────────────────────────────────
// 4. Мелкие чистые помощники
// ────────────────────────────────────────────────────────────

/** Медиана списка. Пустой список → null. */
export function median(values: readonly number[]): number | null {
  const sorted = values.filter(v => Number.isFinite(v)).slice().sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Есть ли у суммы копейки. Вход — тысячи рублей, поэтому рубли = v × 1000,
 * и копейки есть, когда рублёвая часть не целая.
 */
export function hasKopecks(thousandRub: number): boolean {
  const rub = thousandRub * 1000;
  return Math.abs(rub - Math.round(rub)) > 1e-6;
}

/**
 * Дробная ли сумма в тысячах рублей: 1 210,59 тыс. ₽ — да, 500 тыс. ₽ — нет.
 * Это местный признак «сумма взята из документа, а не прикинута» — см.
 * обоснование у ANOMALY_LIMITS.fractionalNeighbourShare.
 */
export function hasFractionalThousands(thousandRub: number): boolean {
  return Math.abs(thousandRub - Math.round(thousandRub)) > 1e-9;
}

/**
 * Показатель степени десяти, если отношение двух сумм — ровная степень десяти
 * от 10 до 1 000 000 в любую сторону; иначе null. Так отличается «уехал
 * разряд» от обычного изменения цены: 20 197 183 / 201 971,83 = 100, а
 * 201,97 / 20 197 183 = одна стотысячная — обе правки об одном и том же.
 */
export function powerOfTen(ratio: number): number | null {
  if (!Number.isFinite(ratio) || ratio <= 0) return null;
  const power = Math.log10(ratio);
  const rounded = Math.round(power);
  if (Math.abs(power - rounded) > ANOMALY_LIMITS.ratioTolerance) return null;
  if (rounded === 0 || Math.abs(rounded) > 6) return null;
  return rounded;
}

/** Ровная ли сумма: кратна шагу ANOMALY_LIMITS.roundStepThousandRub. */
export function isRoundAmount(thousandRub: number): boolean {
  const step = ANOMALY_LIMITS.roundStepThousandRub;
  if (thousandRub <= 0) return false;
  return Math.abs(thousandRub / step - Math.round(thousandRub / step)) < 1e-9;
}

/**
 * Подпись значащих цифр числа: 12430.5 → «124305», 124305 → «124305».
 * Совпадение подписей при разном порядке величины и есть «сдвиг разряда»:
 * цифры набраны те же, точка стоит не там (рубли вместо тысяч, лишний ноль).
 */
export function digitSignature(value: number): string {
  if (!Number.isFinite(value) || value === 0) return '';
  const fixed = Math.abs(value).toFixed(6);
  const digits = fixed.replace('.', '').replace(/0+$/u, '').replace(/^0+/u, '');
  return digits;
}

/** Нормализация предмета для группировки однотипных закупок. */
export function normalizeSubject(subject: string): string {
  return String(subject ?? '')
    .toLowerCase()
    .replace(/[^a-zа-яё0-9\s]/giu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, 60);
}

/** Номер колонки из адреса ячейки: «AC96» → «AC». */
export function columnOfCell(cell: string): string {
  const m = /^([A-Z]+)\d+$/u.exec(String(cell ?? '').trim().toUpperCase());
  return m ? m[1] : '';
}

/** Номер строки из адреса ячейки: «AC96» → 96. */
export function sheetRowOfCell(cell: string): number | null {
  const m = /^[A-Z]+(\d+)$/u.exec(String(cell ?? '').trim().toUpperCase());
  return m ? Number(m[1]) : null;
}

/** Порядковый номер Google-даты: 25569 = 01.01.1970, доля = время суток. */
const SERIAL_EPOCH_OFFSET = 25569;
const MS_PER_DAY = 86400000;

/**
 * Момент правки как сравнимое число миллисекунд. Понимает обе живые формы
 * журнала: «06.08.2026 17:17:20» и порядковый номер Google (46240,4971).
 * Нечитаемый момент → null.
 */
export function editMoment(at: unknown): number | null {
  if (typeof at === 'number' && at > 40000 && at < 60000) {
    return Math.round((at - SERIAL_EPOCH_OFFSET) * MS_PER_DAY);
  }
  const s = String(at ?? '').trim();
  const m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})(?:[ ,]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/u.exec(s);
  if (m) {
    const [, dd, mm, yyyy, hh, mi, ss] = m;
    return Date.UTC(
      Number(yyyy), Number(mm) - 1, Number(dd),
      Number(hh ?? 0), Number(mi ?? 0), Number(ss ?? 0),
    );
  }
  const serial = Number(s.replace(',', '.'));
  if (Number.isFinite(serial) && serial > 40000 && serial < 60000) {
    return Math.round((serial - SERIAL_EPOCH_OFFSET) * MS_PER_DAY);
  }
  return null;
}

/** Момент правки человеку: «06.08.2026 17:17». Нечитаемый → «момент неизвестен». */
export function formatMoment(at: unknown): string {
  const ms = editMoment(at);
  if (ms === null) return 'момент неизвестен';
  const d = new Date(ms);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${pad(d.getUTCDate())}.${pad(d.getUTCMonth() + 1)}.${d.getUTCFullYear()} ` +
    `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

/**
 * Значение ячейки журнала как число. Журнал пишет и числом (684), и текстом —
 * причём в двух соседних записях по-разному («684.0» и 684), и с русским
 * разделителем («1 234,50»). Пусто и «(пусто)» → null.
 */
export function journalNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const s = String(value ?? '')
    .trim()
    .replace(/\s/gu, '')
    .replace(',', '.');
  if (s === '' || s === '(пусто)') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}


const isCompetitive = (method: string): boolean => {
  const m = String(method ?? '').trim().toUpperCase();
  return m !== '' && m !== 'ЕП' && m !== 'EП' && m !== 'EP';
};

const isSinglePurchase = (method: string): boolean => {
  const m = String(method ?? '').trim().toUpperCase();
  return m === 'ЕП' || m === 'EП' || m === 'EP';
};

const money = (v: number | null | undefined): number =>
  Number.isFinite(v as number) ? (v as number) : 0;

const addressOf = (row: AnomalyRow, cell: string): AnomalyAddress => ({
  book: row.book,
  sheet: row.sheet,
  sheetRow: row.sheetRow,
  rowSeq: row.rowSeq,
  cell,
});

const fmt = (thousandRub: number): string =>
  new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(thousandRub);

/**
 * Ключ группы «учреждение». Книги ГРБС без подведомственных ставят в колонке C
 * букву «Х» — это не учреждение, а «закупка самого управления», поэтому такие
 * строки собираются в группу с именем книги, а не в группу с именем «Х».
 */
export function subordinateKey(row: AnomalyRow): string {
  const raw = String(row.subordinate ?? '').trim();
  if (raw === '' || /^[ХхXx]$/u.test(raw)) return `${row.book} (само управление)`;
  return raw;
}

/**
 * Указатель «книга|лист|строка → строка реестра». Журнал знает только адрес
 * ячейки, а карточка диагноста требует ещё № п/п, учреждение и предмет
 * (канон п.53) — их даёт этот указатель.
 */
export function indexRowsByAddress(
  rows: readonly AnomalyRow[],
): Map<string, AnomalyRow> {
  const index = new Map<string, AnomalyRow>();
  for (const row of rows) index.set(`${row.book}|${row.sheet}|${row.sheetRow}`, row);
  return index;
}

/** Группировка строк по учреждению. Пустое учреждение → своя группа «без учреждения». */
function groupBySubordinate(rows: readonly AnomalyRow[]): Map<string, AnomalyRow[]> {
  const groups = new Map<string, AnomalyRow[]>();
  for (const row of rows) {
    const key = subordinateKey(row);
    const bucket = groups.get(key);
    if (bucket) bucket.push(row);
    else groups.set(key, [row]);
  }
  return groups;
}

// ────────────────────────────────────────────────────────────
// 5. Шкала «похоже на опечатку»
// ────────────────────────────────────────────────────────────

/**
 * Признак 1 — сумма на два-три порядка выше медианы своей группы.
 *
 * Группа — учреждение: разброс цен внутри одного учреждения куда уже, чем
 * между школой и дорожным хозяйством. Медиана, а не среднее: один выброс
 * утягивает среднее за собой и прячется в нём.
 */
export function detectMagnitudeOutliers(rows: readonly AnomalyRow[]): AnomalyFinding[] {
  const findings: AnomalyFinding[] = [];
  for (const [subordinate, group] of groupBySubordinate(rows)) {
    const amounts = group.map(r => money(r.planTotal)).filter(v => v > 0);
    if (amounts.length < ANOMALY_LIMITS.minGroupForMedian) continue;
    const med = median(amounts);
    if (med === null || med <= 0) continue;
    for (const row of group) {
      const plan = money(row.planTotal);
      if (plan <= 0) continue;
      const factor = plan / med;
      if (factor < ANOMALY_LIMITS.magnitudeFactor) continue;
      const orders = Math.floor(Math.log10(factor));
      findings.push({
        sign: 'magnitude-outlier',
        scale: 'typo',
        title: 'Сумма на порядки выше обычной для учреждения',
        explanation:
          `Плановая сумма строки — ${fmt(plan)} тыс. ₽, а средняя (медианная) плановая сумма ` +
          `учреждения «${subordinate}» по ${amounts.length} строкам — ${fmt(med)} тыс. ₽. ` +
          `Разница в ${orders} порядка. Так выглядит лишний ноль или сумма, введённая в рублях ` +
          `вместо тысяч, — но так же выглядит и настоящая крупная закупка. Сверьте ячейку K с контрактом.`,
        amountAtRisk: plan,
        address: addressOf(row, `K${row.sheetRow}`),
        subordinate,
        subject: row.subject,
        rows: 1,
        smallSample: amounts.length < ANOMALY_LIMITS.minGroupForMedian * 2,
        note: 'Медиана считается по плановым суммам того же учреждения; крупные разовые объекты дают такой же вид.',
      });
    }
  }
  return findings;
}

/**
 * Признак 2 — ровная сумма там, где у соседей копейки.
 *
 * Механизм: если учреждение вводит суммы из контрактов, у большинства строк
 * есть копейки. Ровные 500 тыс. ₽ среди них — либо прикидка «на глаз», либо
 * плановая цифра, поставленная вместо фактической.
 */
export function detectRoundAmongFractional(rows: readonly AnomalyRow[]): AnomalyFinding[] {
  const findings: AnomalyFinding[] = [];
  for (const [subordinate, group] of groupBySubordinate(rows)) {
    const withFact = group.filter(r => money(r.factTotal) > 0);
    if (withFact.length < ANOMALY_LIMITS.minGroupForMedian) continue;
    const fractionalRows = withFact.filter(r => hasFractionalThousands(money(r.factTotal)));
    const share = fractionalRows.length / withFact.length;
    if (share < ANOMALY_LIMITS.fractionalNeighbourShare) continue;
    for (const row of withFact) {
      const fact = money(row.factTotal);
      if (hasFractionalThousands(fact) || !isRoundAmount(fact)) continue;
      findings.push({
        sign: 'round-among-fractional',
        scale: 'typo',
        title: 'Ровная сумма среди дробных',
        explanation:
          `Фактическая сумма строки ровная — ${fmt(fact)} тыс. ₽ без дробной части, тогда как у ` +
          `${fractionalRows.length} из ${withFact.length} строк учреждения «${subordinate}» суммы ` +
          `дробные (${Math.round(share * 100)} %). Это может означать, что сумма поставлена на глаз ` +
          `или перенесена из плана вместо цены контракта. Сверьте ячейку Y с контрактом.`,
        amountAtRisk: fact,
        address: addressOf(row, `Y${row.sheetRow}`),
        subordinate,
        subject: row.subject,
        rows: 1,
        smallSample: withFact.length < ANOMALY_LIMITS.minGroupForMedian * 2,
        note: 'Ровная цена бывает настоящей — так заключают договоры с фиксированной ценой.',
      });
    }
  }
  return findings;
}

/**
 * Признак 3 — год сдвинут на единицу при совпадении дня и месяца.
 *
 * Классика ручного ввода в январе и при копировании прошлогодней строки:
 * «12.03.2025» вместо «12.03.2026». Ловится сравнением плановой и фактической
 * дат одной строки: день и месяц те же, год отличается ровно на один.
 */
export function detectYearOffByOne(rows: readonly AnomalyRow[]): AnomalyFinding[] {
  const findings: AnomalyFinding[] = [];
  for (const row of rows) {
    const plan = dayNumberOf(row.planDate);
    const fact = dayNumberOf(row.factDate);
    if (plan === null || fact === null) continue;
    const planDate = new Date(plan * 86400000);
    const factDate = new Date(fact * 86400000);
    const sameDay =
      planDate.getUTCDate() === factDate.getUTCDate() &&
      planDate.getUTCMonth() === factDate.getUTCMonth();
    const yearGap = factDate.getUTCFullYear() - planDate.getUTCFullYear();
    if (!sameDay || Math.abs(yearGap) !== 1) continue;
    findings.push({
      sign: 'year-off-by-one',
      scale: 'typo',
      title: 'Год отличается на единицу при том же дне и месяце',
      explanation:
        `План — ${planDate.getUTCDate()}.${planDate.getUTCMonth() + 1}.${planDate.getUTCFullYear()}, ` +
        `факт — ${factDate.getUTCDate()}.${factDate.getUTCMonth() + 1}.${factDate.getUTCFullYear()}: ` +
        `день и месяц совпадают, год расходится на ${Math.abs(yearGap)}. Ровно так выглядит опечатка в ` +
        `годе при копировании прошлогодней строки. Сверьте ячейки N и Q с документами.`,
      amountAtRisk: money(row.factTotal) || money(row.planTotal),
      address: addressOf(row, `Q${row.sheetRow}`),
      subordinate: row.subordinate,
      subject: row.subject,
      rows: 1,
      smallSample: false,
      note: 'Контракт действительно может быть заключён ровно через год — признак зовёт проверить, а не утверждает.',
    });
  }
  return findings;
}

/**
 * Признак 4 — сдвиг разряда: те же цифры, другой порядок.
 *
 * У двух строк одного учреждения совпадает подпись значащих цифр, а суммы
 * отличаются ровно в 10, 100 или 1000 раз. Так выглядят рубли, введённые
 * вместо тысяч, и потерянная при вводе цифра разряда: 12 430,50 против
 * 124 305,00 у соседа — цифры «124305» одни и те же.
 */
export function detectDecimalShift(rows: readonly AnomalyRow[]): AnomalyFinding[] {
  const findings: AnomalyFinding[] = [];
  for (const [subordinate, group] of groupBySubordinate(rows)) {
    const bySignature = new Map<string, AnomalyRow[]>();
    for (const row of group) {
      const plan = money(row.planTotal);
      if (plan <= 0) continue;
      const sig = digitSignature(plan);
      if (sig.length < 3) continue;
      const bucket = bySignature.get(sig);
      if (bucket) bucket.push(row);
      else bySignature.set(sig, [row]);
    }
    for (const [sig, bucket] of bySignature) {
      if (bucket.length < 2) continue;
      const sorted = bucket.slice().sort((a, b) => money(a.planTotal) - money(b.planTotal));
      const small = sorted[0];
      const large = sorted[sorted.length - 1];
      const ratio = money(large.planTotal) / money(small.planTotal);
      const isPowerOfTen = [10, 100, 1000].some(
        p => Math.abs(ratio / p - 1) < ANOMALY_LIMITS.ratioTolerance,
      );
      if (!isPowerOfTen) continue;
      findings.push({
        sign: 'decimal-shift',
        scale: 'typo',
        title: 'Те же цифры, другой порядок величины',
        explanation:
          `У учреждения «${subordinate}» две строки набраны одними и теми же цифрами (${sig}), ` +
          `но суммы отличаются в ${Math.round(ratio)} раз: ${fmt(money(small.planTotal))} тыс. ₽ в строке ` +
          `${small.sheetRow} и ${fmt(money(large.planTotal))} тыс. ₽ в строке ${large.sheetRow}. ` +
          `Так выглядит сумма, введённая в рублях вместо тысяч, или потерянный при вводе разряд. ` +
          `Сверьте обе ячейки K с контрактами.`,
        amountAtRisk: money(large.planTotal) - money(small.planTotal),
        address: addressOf(small, `K${small.sheetRow}`),
        subordinate,
        subject: small.subject,
        rows: bucket.length,
        smallSample: false,
        note: 'Совпадение цифр бывает случайным — особенно у коротких сумм; подпись короче трёх цифр не рассматривается.',
        members: bucket.map(r => addressOf(r, `K${r.sheetRow}`)),
      });
    }
  }
  return findings;
}

/**
 * Признак 5 — повтор суммы строки-соседа.
 *
 * Соседние по листу строки одного учреждения с ОДИНАКОВОЙ некруглой суммой и
 * разным предметом — след протяжки ячейки вниз. Требование «некруглая» здесь
 * не украшение: одинаковые ровные суммы (100 тыс., 500 тыс.) встречаются
 * законно сплошь и рядом, а вот совпадение до копейки при разных предметах —
 * почти всегда копия.
 */
export function detectRepeatOfNeighbour(rows: readonly AnomalyRow[]): AnomalyFinding[] {
  const findings: AnomalyFinding[] = [];
  const ordered = rows.slice().sort((a, b) => a.sheetRow - b.sheetRow);
  for (let i = 1; i < ordered.length; i++) {
    const prev = ordered[i - 1];
    const row = ordered[i];
    if (row.sheetRow !== prev.sheetRow + 1) continue;
    if (String(row.subordinate ?? '') !== String(prev.subordinate ?? '')) continue;
    const a = money(prev.planTotal);
    const b = money(row.planTotal);
    if (a <= 0 || b <= 0) continue;
    if (Math.abs(a - b) > ANOMALY_LIMITS.moneyEpsilonThousandRub) continue;
    if (!hasFractionalThousands(b)) continue;
    if (normalizeSubject(row.subject) === normalizeSubject(prev.subject)) continue;
    findings.push({
      sign: 'repeat-of-neighbour',
      scale: 'typo',
      title: 'Сумма повторяет соседнюю строку в точности',
      explanation:
        `Строка ${row.sheetRow} и строка ${prev.sheetRow} того же учреждения несут одну и ту же ` +
        `дробную сумму ${fmt(b)} тыс. ₽ при разных предметах закупки. Точное совпадение дробной ` +
        `суммы у разных предметов обычно означает протянутую вниз ячейку, а не совпадение цен. ` +
        `Сверьте ячейку K${row.sheetRow} с контрактом.`,
      amountAtRisk: b,
      address: addressOf(row, `K${row.sheetRow}`),
      subordinate: row.subordinate,
      subject: row.subject,
      rows: 2,
      smallSample: false,
      note: 'Одна и та же цена у разных предметов возможна — например, при закупках у одного поставщика по прайсу. Ровные суммы (10, 100, 500 тыс. ₽) у соседей законны сплошь и рядом и в признак не идут: живой замер 18.08.2026 дал 55 соседних пар с равной плановой суммой и разным предметом, дробных среди них 4.',
      members: [addressOf(prev, `K${prev.sheetRow}`), addressOf(row, `K${row.sheetRow}`)],
    });
  }
  return findings;
}

/**
 * Признак 6 — правка суммы ровно в тысячу (сто, десять) раз.
 *
 * Живой класс из журналов книг: оператор ввёл сумму в рублях, увидел цвет
 * условного форматирования и переписал в тысячах. Признак ловит саму правку,
 * а значит показывает и те строки, где обратную правку сделать забыли.
 */
export function detectThousandfoldEdits(
  entries: readonly AnomalyJournalEntry[],
  rows: readonly AnomalyRow[] = [],
): AnomalyFinding[] {
  const index = indexRowsByAddress(rows);
  const findings: AnomalyFinding[] = [];
  for (const entry of entries) {
    const column = columnOfCell(entry.cell);
    const sheetRow = sheetRowOfCell(entry.cell);
    if (sheetRow === null) continue;
    if (!PLAN_MONEY_COLUMNS.has(column) && !FACT_MONEY_COLUMNS.has(column)) continue;
    const was = journalNumber(entry.was);
    const became = journalNumber(entry.became);
    if (was === null || became === null || was === 0 || became === 0) continue;
    const power = powerOfTen(became / was);
    if (power === null) continue;
    const factor = Math.pow(10, Math.abs(power));
    const direction = power > 0 ? 'вверх' : 'вниз';
    const row = index.get(`${entry.book}|${entry.sheet}|${sheetRow}`);
    findings.push({
      sign: 'thousandfold-edit',
      scale: 'typo',
      title: 'Сумма правилась ровно в кратное десяти число раз',
      explanation:
        `В журнале книги ячейка ${entry.cell} менялась с ${fmt(was)} на ${fmt(became)} — ровно в ` +
        `${fmt(factor)} раз ${direction}. Такая правка означает, что сумма была ` +
        `введена не в тех единицах (рубли вместо тысяч) и потом исправлена. Проверьте соседние строки ` +
        `того же дня — там та же ошибка могла остаться неисправленной.`,
      // Под риском — не разность (у ошибки в единицах она бессмысленно велика),
      // а меньшая из двух величин: именно она похожа на настоящую сумму строки.
      amountAtRisk: Math.min(Math.abs(was), Math.abs(became)),
      address: {
        book: entry.book,
        sheet: entry.sheet,
        sheetRow,
        rowSeq: row?.rowSeq ?? '',
        cell: entry.cell,
      },
      subordinate: row ? subordinateKey(row) : undefined,
      subject: row?.subject,
      rows: 1,
      smallSample: false,
      note: `Момент правки — ${formatMoment(entry.at)}${entry.author ? `, автор ${entry.author}` : ''}. Журнал видит только правки ячеек: удаление строки в нём не отражается.`,
    });
  }
  return findings;
}

// ────────────────────────────────────────────────────────────
// 6. Шкала «похоже на подгон»
// ────────────────────────────────────────────────────────────

/**
 * Признак 7 — распределение первых значащих цифр отклоняется от естественного.
 *
 * Закон Бенфорда: в наборах сумм, растущих сами по себе, единица стоит первой
 * примерно в 30 % случаев, девятка — примерно в 5 %. Когда суммы назначают
 * «от головы» или подгоняют под порог, первые цифры распределяются ровнее.
 *
 * Оговорка, которую нельзя опускать: закон говорит о НАБОРЕ, а не о строке.
 * Отклонение — повод посмотреть строки учреждения, а не обвинение. На выборке
 * меньше 30 сумм закон не применяется вовсе; до 80 сумм вывод помечается
 * «данных мало».
 */
export function detectBenfordDeviation(
  rows: readonly AnomalyRow[],
): Array<AnomalyFinding & { benford: BenfordResult }> {
  const findings: Array<AnomalyFinding & { benford: BenfordResult }> = [];
  for (const [subordinate, group] of groupBySubordinate(rows)) {
    const amounts = group.map(r => money(r.planTotal)).filter(v => v > 0);
    if (amounts.length < ANOMALY_LIMITS.benfordMinSample) continue;
    const benford = benfordAnalysis(amounts);
    if (benford.sampleSize < ANOMALY_LIMITS.benfordMinSample) continue;
    if (benford.pValue >= ANOMALY_LIMITS.benfordAlpha) continue;
    const worst = benford.observed
      .map((share, i) => ({ digit: i + 1, share, expected: benford.expected[i] }))
      .sort((a, b) => Math.abs(b.share - b.expected) - Math.abs(a.share - a.expected))[0];
    const sample = group[0];
    findings.push({
      sign: 'benford-deviation',
      scale: 'fitted',
      title: 'Распределение первых цифр сумм отклоняется от естественного',
      explanation:
        `У учреждения «${subordinate}» ${benford.sampleSize} плановых сумм. Первая цифра ` +
        `${worst.digit} встречается в ${(worst.share * 100).toFixed(0)} % строк, а в естественно ` +
        `растущих наборах сумм ожидается около ${(worst.expected * 100).toFixed(0)} %. ` +
        `Хи-квадрат ${benford.chiSquare.toFixed(1)}, вероятность случайного такого отклонения ` +
        `${(benford.pValue * 100).toFixed(1)} %. Это может означать округление при вводе либо подгон сумм — ` +
        `посмотрите строки учреждения ниже.`,
      amountAtRisk: amounts.reduce((s, v) => s + v, 0),
      address: {
        book: sample.book,
        sheet: sample.sheet,
        sheetRow: 0,
        rowSeq: '',
        cell: `учреждение «${subordinate}», колонка K целиком`,
      },
      subordinate,
      rows: benford.sampleSize,
      smallSample: benford.sampleSize < ANOMALY_LIMITS.benfordShakySample,
      note:
        benford.sampleSize < ANOMALY_LIMITS.benfordShakySample
          ? 'Данных мало: на выборке меньше 80 сумм хи-квадрат неустойчив, вывод ненадёжен.'
          : 'Закон описывает набор сумм, а не отдельную закупку: отклонение не указывает на конкретную строку.',
      benford,
    });
  }
  return findings;
}

/**
 * Признак 8 — суммы липнут к порогу 44-ФЗ снизу.
 *
 * Механизм проверки: сравниваем ПЛОТНОСТЬ сумм в последних 10 % под порогом
 * с плотностью в опорной полосе 50–90 % того же порога. Сравнение с соседней
 * полосой честнее сравнения с теоретическим распределением — никакого закона
 * о том, как должны быть распределены цены закупок, не существует.
 */
export function detectThresholdHugging(rows: readonly AnomalyRow[]): AnomalyFinding[] {
  const findings: AnomalyFinding[] = [];
  for (const [subordinate, group] of groupBySubordinate(rows)) {
    for (const point of THRESHOLD_POINTS) {
      const relevant =
        point.limit === LAW_44FZ_THRESHOLDS.epSmallPurchaseSingleContractLimitThousandRub
          ? group.filter(r => isSinglePurchase(r.method))
          : group.filter(r => isCompetitive(r.method));
      const corridorFrom = point.limit * (1 - ANOMALY_LIMITS.thresholdCorridor);
      const referenceFrom = point.limit * ANOMALY_LIMITS.thresholdReferenceFrom;
      const inCorridor = relevant.filter(r => {
        const v = money(r.planTotal);
        return v >= corridorFrom && v <= point.limit;
      });
      const inReference = relevant.filter(r => {
        const v = money(r.planTotal);
        return v >= referenceFrom && v < corridorFrom;
      });
      if (inCorridor.length < ANOMALY_LIMITS.thresholdMinRows) continue;
      const corridorWidth = point.limit - corridorFrom;
      const referenceWidth = corridorFrom - referenceFrom;
      if (referenceWidth <= 0) continue;
      const expected = (inReference.length / referenceWidth) * corridorWidth;
      const ratio = expected > 0 ? inCorridor.length / expected : Infinity;
      if (ratio < ANOMALY_LIMITS.thresholdDensityFactor) continue;
      const sum = inCorridor.reduce((s, r) => s + money(r.planTotal), 0);
      const sample = inCorridor[0];
      findings.push({
        sign: 'threshold-hugging',
        scale: 'fitted',
        title: 'Суммы липнут к порогу закона снизу',
        explanation:
          `У учреждения «${subordinate}» ${inCorridor.length} закупок стоят в последних 10 % под ` +
          `порогом «${point.label}» — от ${fmt(corridorFrom)} до ${fmt(point.limit)} тыс. ₽. ` +
          `В соседней полосе ${fmt(referenceFrom)}–${fmt(corridorFrom)} тыс. ₽ ` +
          `${inReference.length} закупок, то есть в коридоре у порога плотность выше в ` +
          `${Number.isFinite(ratio) ? ratio.toFixed(1) : '∞'} раз. Это может означать, что цены ` +
          `подгоняли под порог, чтобы не менять способ закупки, — а может означать, что таковы ` +
          `цены на рынке. Посмотрите перечисленные строки.`,
        amountAtRisk: sum,
        address: {
          book: sample.book,
          sheet: sample.sheet,
          sheetRow: 0,
          rowSeq: '',
          cell: `учреждение «${subordinate}», коридор ${fmt(corridorFrom)}–${fmt(point.limit)} тыс. ₽`,
        },
        subordinate,
        rows: inCorridor.length,
        smallSample: inReference.length < ANOMALY_LIMITS.thresholdMinRows,
        note:
          inReference.length < ANOMALY_LIMITS.thresholdMinRows
            ? 'Данных мало: опорная полоса почти пуста, поэтому отношение плотностей неустойчиво.'
            : 'Порог сам по себе не нарушен: речь о концентрации сумм под ним, а не о превышении.',
        members: inCorridor.map(r => addressOf(r, `K${r.sheetRow}`)),
      });
    }
  }
  return findings;
}

/**
 * Признак 9 — дробление: несколько однотипных закупок одного учреждения в
 * коротком окне, вместе перешагивающих порог.
 *
 * Однотипность — совпадение нормализованного предмета. Окно — 30 дней по
 * плановой (при её отсутствии — фактической) дате. Поставщик в данных не
 * указан, поэтому «у одного поставщика» здесь подменено «одно учреждение, один
 * предмет» — и это сказано вслух в оговорке.
 */
export function detectSplittingWindow(rows: readonly AnomalyRow[]): AnomalyFinding[] {
  const findings: AnomalyFinding[] = [];
  const limit = LAW_44FZ_THRESHOLDS.epSmallPurchaseSingleContractLimitThousandRub;
  for (const [subordinate, group] of groupBySubordinate(rows)) {
    const bySubject = new Map<string, AnomalyRow[]>();
    for (const row of group) {
      if (!isSinglePurchase(row.method)) continue;
      if (money(row.planTotal) <= 0) continue;
      const key = normalizeSubject(row.subject);
      if (!key) continue;
      const bucket = bySubject.get(key);
      if (bucket) bucket.push(row);
      else bySubject.set(key, [row]);
    }
    for (const [subject, bucket] of bySubject) {
      const dated = bucket
        .map(row => ({ row, day: dayNumberOf(row.planDate) ?? dayNumberOf(row.factDate) }))
        .filter((x): x is { row: AnomalyRow; day: number } => x.day !== null)
        .sort((a, b) => a.day - b.day);
      if (dated.length < ANOMALY_LIMITS.splittingMinRows) continue;
      let start = 0;
      const reported = new Set<number>();
      for (let end = 0; end < dated.length; end++) {
        while (dated[end].day - dated[start].day > ANOMALY_LIMITS.splittingWindowDays) start++;
        const window = dated.slice(start, end + 1);
        if (window.length < ANOMALY_LIMITS.splittingMinRows) continue;
        const sum = window.reduce((s, x) => s + money(x.row.planTotal), 0);
        if (sum <= limit) continue;
        if (reported.has(dated[start].row.sheetRow)) continue;
        reported.add(dated[start].row.sheetRow);
        const sample = window[0].row;
        findings.push({
          sign: 'splitting-window',
          scale: 'fitted',
          title: 'Несколько однотипных закупок в коротком окне переходят порог вместе',
          explanation:
            `Учреждение «${subordinate}» за ${dated[end].day - dated[start].day} дней провело ` +
            `${window.length} закупок у единственного поставщика на один предмет «${subject}» ` +
            `на общую сумму ${fmt(sum)} тыс. ₽ — это больше порога ${fmt(limit)} тыс. ₽, выше которого ` +
            `единственный поставщик уже не подходит. Это может означать разбиение одной потребности на ` +
            `части, а может означать несколько независимых мелких нужд. Проверьте перечисленные строки.`,
          amountAtRisk: sum,
          address: addressOf(sample, `K${sample.sheetRow}`),
          subordinate,
          subject,
          rows: window.length,
          smallSample: window.length === ANOMALY_LIMITS.splittingMinRows,
          note: 'Поставщика в источнике нет: однотипность выведена из предмета закупки и учреждения, а не из реквизитов контрагента.',
          members: window.map(x => addressOf(x.row, `K${x.row.sheetRow}`)),
        });
      }
    }
  }
  return findings;
}

/**
 * Признак 10 — факт равен плану до копейки при конкурентном способе.
 *
 * Торги без снижения цены законны и случаются. Признак выпускается не на
 * отдельную строку, а на УЧРЕЖДЕНИЕ, у которого таких строк масса: половина и
 * больше конкурентных закупок при минимум пяти конкурентных.
 */
export function detectFactEqualsPlan(rows: readonly AnomalyRow[]): AnomalyFinding[] {
  const findings: AnomalyFinding[] = [];
  for (const [subordinate, group] of groupBySubordinate(rows)) {
    const competitive = group.filter(
      r => isCompetitive(r.method) && money(r.factTotal) > 0 && money(r.planTotal) > 0,
    );
    if (competitive.length < ANOMALY_LIMITS.factEqualsPlanMinRows) continue;
    const equal = competitive.filter(
      r => Math.abs(money(r.factTotal) - money(r.planTotal)) <= ANOMALY_LIMITS.moneyEpsilonThousandRub,
    );
    const share = equal.length / competitive.length;
    if (share < ANOMALY_LIMITS.factEqualsPlanShare) continue;
    const sum = equal.reduce((s, r) => s + money(r.factTotal), 0);
    const sample = equal[0];
    findings.push({
      sign: 'fact-equals-plan',
      scale: 'fitted',
      title: 'Факт совпадает с планом до копейки в большинстве конкурентных закупок',
      explanation:
        `У учреждения «${subordinate}» ${equal.length} из ${competitive.length} конкурентных закупок ` +
        `(${Math.round(share * 100)} %) заключены ровно на плановую сумму — без снижения даже на копейку, ` +
        `итого ${fmt(sum)} тыс. ₽. Отдельная такая процедура законна: снижения может не быть. Масса таких ` +
        `процедур у одного учреждения чаще означает, что плановую сумму писали после факта либо торги шли ` +
        `с единственной заявкой. Проверьте перечисленные строки.`,
      amountAtRisk: sum,
      address: addressOf(sample, `Y${sample.sheetRow}`),
      subordinate,
      rows: equal.length,
      smallSample: competitive.length < ANOMALY_LIMITS.factEqualsPlanMinRows * 2,
      note: 'Число участников процедуры в источнике отсутствует — отличить «одна заявка» от «план дописан после факта» данные не позволяют.',
      members: equal.map(r => addressOf(r, `Y${r.sheetRow}`)),
    });
  }
  return findings;
}

/**
 * Признак 11 — плановая сумма правилась уже после появления факта.
 *
 * Выводится целиком из журнала книги: сначала в строке заполнилась
 * фактическая дата (колонка Q), потом — позже по времени — правилась плановая
 * сумма (H, I, J или K). План, догоняющий факт, снимает саму возможность
 * посчитать отклонение.
 */
export function detectRetroEdits(
  entries: readonly AnomalyJournalEntry[],
  rows: readonly AnomalyRow[] = [],
): AnomalyFinding[] {
  const index = indexRowsByAddress(rows);
  const factMomentByRow = new Map<string, number>();
  for (const entry of entries) {
    if (columnOfCell(entry.cell) !== FACT_DATE_COLUMN) continue;
    const sheetRow = sheetRowOfCell(entry.cell);
    const at = editMoment(entry.at);
    if (sheetRow === null || at === null) continue;
    const became = String(entry.became ?? '').trim();
    if (became === '' || became === '(пусто)' || /^[ХXх x]$/u.test(became)) continue;
    const key = `${entry.book}|${entry.sheet}|${sheetRow}`;
    const known = factMomentByRow.get(key);
    if (known === undefined || at < known) factMomentByRow.set(key, at);
  }

  interface RetroEdit {
    entry: AnomalyJournalEntry;
    at: number;
    was: number | null;
    became: number | null;
  }
  const byRow = new Map<string, { sheetRow: number; edits: RetroEdit[] }>();

  for (const entry of entries) {
    const column = columnOfCell(entry.cell);
    if (!PLAN_MONEY_COLUMNS.has(column)) continue;
    const sheetRow = sheetRowOfCell(entry.cell);
    const at = editMoment(entry.at);
    if (sheetRow === null || at === null) continue;
    const key = `${entry.book}|${entry.sheet}|${sheetRow}`;
    const factAt = factMomentByRow.get(key);
    if (factAt === undefined || at <= factAt) continue;
    const was = journalNumber(entry.was);
    const became = journalNumber(entry.became);
    if (was === null && became === null) continue;
    if (Math.abs((became ?? 0) - (was ?? 0)) <= ANOMALY_LIMITS.moneyEpsilonThousandRub) continue;
    const bucket = byRow.get(key);
    if (bucket) bucket.edits.push({ entry, at, was, became });
    else byRow.set(key, { sheetRow, edits: [{ entry, at, was, became }] });
  }

  const findings: AnomalyFinding[] = [];
  for (const [key, bucket] of byRow) {
    const edits = bucket.edits.slice().sort((a, b) => a.at - b.at);
    const last = edits[edits.length - 1];
    const row = index.get(key);
    const [book, sheet] = key.split('|');
    // Под риском — плановая сумма, которая СЕЙЧАС стоит в строке реестра.
    // Ни разность, ни промежуточное значение не годятся: одна и та же правка
    // «201 971,83 → 20 197 183» была ошибкой единиц и через минуту откачена,
    // и обе величины на риск не тянут — тянет то, что осталось в книге.
    const atRisk = row ? Math.abs(money(row.planTotal)) : Math.abs(last.became ?? last.was ?? 0);
    findings.push({
      sign: 'retro-edit-after-fact',
      scale: 'fitted',
      title: 'Плановая сумма правилась после появления факта',
      explanation:
        `В строке ${bucket.sheetRow} сначала заполнилась фактическая дата, а потом плановую сумму ` +
        `правили ${edits.length === 1 ? 'один раз' : `${edits.length} раз`}: последняя правка — ` +
        `${formatMoment(last.entry.at)}, ячейка ${last.entry.cell}, ` +
        `${last.was === null ? 'пусто' : fmt(last.was)} → ${last.became === null ? 'пусто' : fmt(last.became)} тыс. ₽. ` +
        `План, изменённый после факта, делает отклонение плана от факта непроверяемым. Это может быть ` +
        `исправлением ошибки ввода, а может — подгонкой плана под уже заключённый контракт. ` +
        `Сверьте строку с планом-графиком.`,
      amountAtRisk: atRisk,
      address: {
        book,
        sheet,
        sheetRow: bucket.sheetRow,
        rowSeq: row?.rowSeq ?? '',
        cell: last.entry.cell,
      },
      subordinate: row ? subordinateKey(row) : undefined,
      subject: row?.subject,
      rows: 1,
      smallSample: false,
      note:
        `Правок плановой суммы после факта в этой строке — ${edits.length}` +
        `${last.entry.author ? `, последняя от ${last.entry.author}` : ''}. ` +
        'Журнал видит только правки ячеек: удаление строки в нём не отражается.',
      members: edits.map(e => ({
        book,
        sheet,
        sheetRow: bucket.sheetRow,
        rowSeq: row?.rowSeq ?? '',
        cell: e.entry.cell,
      })),
    });
  }
  return findings;
}

/**
 * Признак 12 — конкурентных закупок масса, а экономии нет вовсе.
 *
 * Живой замер 18.08.2026: у УДТХ 93 % закупок конкурентные и ноль экономии.
 * Признак смотрит на учреждение целиком: доля строк с нулевой экономией среди
 * конкурентных выше 90 % при минимум пяти конкурентных.
 */
export function detectZeroEconomyMass(rows: readonly AnomalyRow[]): AnomalyFinding[] {
  const findings: AnomalyFinding[] = [];
  for (const [subordinate, group] of groupBySubordinate(rows)) {
    const competitive = group.filter(r => isCompetitive(r.method) && money(r.factTotal) > 0);
    if (competitive.length < ANOMALY_LIMITS.factEqualsPlanMinRows) continue;
    const zero = competitive.filter(
      r => Math.abs(money(r.economy)) <= ANOMALY_LIMITS.economyEpsilonThousandRub,
    );
    const share = zero.length / competitive.length;
    if (share < ANOMALY_LIMITS.zeroEconomyShare) continue;
    const sum = zero.reduce((s, r) => s + money(r.planTotal), 0);
    const sample = zero[0];
    findings.push({
      sign: 'zero-economy-mass',
      scale: 'fitted',
      title: 'Конкурентные закупки не дали экономии вовсе',
      explanation:
        `У учреждения «${subordinate}» ${zero.length} из ${competitive.length} конкурентных закупок ` +
        `(${Math.round(share * 100)} %) показали экономию ровно ноль, объём этих закупок — ${fmt(sum)} тыс. ₽. ` +
        `Конкурентная процедура без снижения цены законна, но когда таких процедур почти все, обычно это ` +
        `означает одно из двух: экономию не заполняли в книге, либо конкуренции фактически не было. ` +
        `Проверьте колонку AC у перечисленных строк.`,
      amountAtRisk: sum,
      address: {
        book: sample.book,
        sheet: sample.sheet,
        sheetRow: 0,
        rowSeq: '',
        cell: `учреждение «${subordinate}», колонка AC`,
      },
      subordinate,
      rows: zero.length,
      smallSample: competitive.length < ANOMALY_LIMITS.factEqualsPlanMinRows * 2,
      note: 'Нулевая экономия в книге не отличима от незаполненной: колонка AC считается формулой от факта, а факт может быть не внесён.',
      members: zero.slice(0, 50).map(r => addressOf(r, `AC${r.sheetRow}`)),
    });
  }
  return findings;
}

// ────────────────────────────────────────────────────────────
// 7. Сборка отчёта
// ────────────────────────────────────────────────────────────

const ALL_SIGNS: readonly AnomalySign[] = [
  'magnitude-outlier',
  'round-among-fractional',
  'year-off-by-one',
  'decimal-shift',
  'repeat-of-neighbour',
  'thousandfold-edit',
  'benford-deviation',
  'threshold-hugging',
  'splitting-window',
  'fact-equals-plan',
  'retro-edit-after-fact',
  'zero-economy-mass',
];

export interface AnomalyInput {
  rows: readonly AnomalyRow[];
  /** Журнал правок книги. Без него два признака из двенадцати не выводятся. */
  journal?: readonly AnomalyJournalEntry[];
}

/**
 * Полный проход детектора. Возвращает ДВА списка признаков — по шкале на
 * каждый род странности — и никогда не сводит их в один балл.
 */
export function detectAnomalies(input: AnomalyInput): AnomalyReport {
  const { rows, journal = [] } = input;

  const typo: AnomalyFinding[] = [
    ...detectMagnitudeOutliers(rows),
    ...detectRoundAmongFractional(rows),
    ...detectYearOffByOne(rows),
    ...detectDecimalShift(rows),
    ...detectRepeatOfNeighbour(rows),
    ...detectThousandfoldEdits(journal, rows),
  ];

  const fitted: AnomalyFinding[] = [
    ...detectBenfordDeviation(rows),
    ...detectThresholdHugging(rows),
    ...detectSplittingWindow(rows),
    ...detectFactEqualsPlan(rows),
    ...detectRetroEdits(journal, rows),
    ...detectZeroEconomyMass(rows),
  ];

  const counts = Object.fromEntries(ALL_SIGNS.map(s => [s, 0])) as Record<AnomalySign, number>;
  for (const f of [...typo, ...fitted]) counts[f.sign] += 1;

  const notes = [
    'Две шкалы независимы: «похоже на опечатку» и «похоже на подгон» отвечают на разные вопросы и в один балл не складываются.',
    'Признак — повод проверить строку, а не вывод о нарушении. Отсутствие признаков не означает, что данные верны.',
  ];
  if (journal.length === 0) {
    notes.push('Журнал правок не передан: признаки «правка в кратное десяти число раз» и «правка плана после факта» не проверялись.');
  }

  return {
    typo: typo.slice().sort((a, b) => b.amountAtRisk - a.amountAtRisk),
    fitted: fitted.slice().sort((a, b) => b.amountAtRisk - a.amountAtRisk),
    counts,
    amountAtRisk: {
      typo: typo.reduce((s, f) => s + f.amountAtRisk, 0),
      fitted: fitted.reduce((s, f) => s + f.amountAtRisk, 0),
    },
    rowsScanned: rows.length,
    notes,
  };
}
