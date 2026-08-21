/**
 * Договор экрана «Сверка трёх источников» с сервером (GET /api/monitoring/triple).
 *
 * ЗАЧЕМ ТРЕТЬЯ СТОРОНА. Сверка «наш расчёт против листа СВОД» умеет сказать
 * «не сходится», но не умеет сказать, КТО отстал. Одна и та же закупка живёт
 * трижды: строкой книги ГРБС (план управления, деньги в тысячах), строкой
 * листа управления в книге «Ежедневный мониторинг» и строкой переходящего
 * реестра «25-26» (деньги в рублях). Когда две записи держат одно число, а
 * третья — другое, ответ виден. Продукт при этом правой стороны не выбирает:
 * он показывает большинство и адреса всех трёх строк, а решает человек.
 *
 * ФОРМА ПОВТОРЯЕТ ЯДРО, НО ЧИТАЕТСЯ ОБОРОНИТЕЛЬНО. Типы ниже — зеркало
 * `@aemr/core/monitoring/triple-check`, однако вход разбора — `unknown`:
 * ответ приходит по сети, и переименованное поле обязано стоить одного
 * пустого раздела, а не всей вкладки.
 *
 * ЧЕСТНАЯ ПУСТОТА ТРЁХ РОДОВ (п.36) — она здесь не украшение, а тип.
 * «Расхождений нет», «книга не прочитана» и «сопоставлять нечего: у строк нет
 * номеров процедур» — три разные новости с тремя разными поступками читателя,
 * и различает их поле `state`, а не оттенок слов на экране.
 */
import { fetchJSON } from '../../api';
import type { MonitoringSource } from './contract';

// ── Стороны сверки ───────────────────────────────────────────────────

/** Три независимые записи одной закупки. */
export type TripleSide = 'book' | 'sheet' | 'journal';

/**
 * Подписи сторон для читателя. Дублируют словарь ядра намеренно: экран
 * обязан назвать сторону даже тогда, когда сервер прислал незнакомое слово,
 * а тянуть `@aemr/core` в браузер ради трёх строк — лишний вес бандла.
 */
export const SIDE_LABELS: Record<TripleSide, string> = {
  book: 'книга ГРБС',
  sheet: 'лист управления мониторинга',
  journal: 'переходящий реестр «25-26»',
};

/** Короткая подпись стороны — для тесных мест: заголовка колонки, чипа. */
export const SIDE_SHORT: Record<TripleSide, string> = {
  book: 'книга ГРБС',
  sheet: 'лист управления',
  journal: 'реестр «25-26»',
};

const SIDE_ORDER: readonly TripleSide[] = ['book', 'sheet', 'journal'];

function side(v: unknown): TripleSide | null {
  return v === 'book' || v === 'sheet' || v === 'journal' ? v : null;
}

// ── Классы расхождений ───────────────────────────────────────────────

/** Закрытый словарь исходов; строка на конце — запас на незнакомое слово. */
export type TripleFindingKind =
  | 'no-pair-in-monitoring'
  | 'no-pair-in-books'
  | 'no-journal-record'
  | 'no-sheet-record'
  | 'plan-differs'
  | 'fact-differs'
  | 'savings-differ'
  | 'savings-not-difference'
  | 'winner-price-missing'
  | 'code-distorted'
  | 'subject-mismatch'
  | 'duplicate-in-book'
  | 'joint-shares'
  | 'duplicate-in-monitoring'
  | string;

/** Заголовок карточки класса — литературный русский, без упрёка. */
export const FINDING_LABELS: Record<string, string> = {
  'no-pair-in-monitoring': 'Нет пары в книге мониторинга',
  'no-pair-in-books': 'Нет строки в книгах ГРБС',
  'no-journal-record': 'Нет записи в переходящем реестре',
  'no-sheet-record': 'Не перенесена на лист управления',
  'plan-differs': 'Начальные цены разошлись',
  'fact-differs': 'Факт и цена победителя разошлись',
  'savings-differ': 'Экономия разошлась',
  'savings-not-difference': 'Экономия не равна разности',
  'winner-price-missing': 'Цена победителя не проставлена',
  'code-distorted': 'Код процедуры с опечаткой',
  'subject-mismatch': 'Предметы сторон описаны по-разному',
  'duplicate-in-book': 'Код дважды в одной книге',
  'joint-shares': 'Доли совместной закупки',
  'duplicate-in-monitoring': 'Код дважды на одном листе мониторинга',
};

/**
 * Что означает класс и что с ним делать (канон п.135: у метрики карточка базы
 * знаний — механизм, скоуп, «почему может разойтись», поступок). Текст ведёт
 * читателя-начальницу управления, а не инженера: ни ключей, ни колонок в
 * первой фразе, ни слова «маппинг».
 */
export interface FindingGuide {
  /** Почему такое бывает — механизм, а не догадка. */
  readonly why: string;
  /** Что делать — один поступок, названный глаголом. */
  readonly todo: string;
}

export const FINDING_GUIDES: Record<string, FindingGuide> = {
  'no-pair-in-monitoring': {
    why: 'Номер процедуры проставлен в книге управления, а в книге «Ежедневный мониторинг» строки с таким номером нет: закупку либо ещё не завели в мониторинг, либо номер в одной из книг набран иначе.',
    todo: 'Сверить номер в книге управления с реестром мониторинга и завести недостающую строку.',
  },
  'no-pair-in-books': {
    why: 'Процедура ведётся в мониторинге, но ни в одной книге ГРБС строки с этим номером нет: план управления либо не заполнен, либо номер в колонке примечания не проставлен.',
    todo: 'Найти закупку в книге управления по предмету и проставить ей номер процедуры.',
  },
  'no-journal-record': {
    why: 'Закупка есть в книге управления и на листе мониторинга, а в переходящий реестр «25-26» не внесена — судьба процедуры на будущий год не прослеживается.',
    todo: 'Внести строку в переходящий реестр либо подтвердить, что закупка завершена в этом году.',
  },
  'no-sheet-record': {
    why: 'Закупка живёт в переходящем реестре, а на лист своего управления не перенесена: лист управления её не показывает и в свод она не попадает.',
    todo: 'Перенести строку на лист управления.',
  },
  'plan-differs': {
    why: 'Начальная цена в книге управления и начальная цена в мониторинге — разные числа. Книга управления держит план в тысячах рублей, мониторинг — в рублях; расхождение считается после перевода единиц, поэтому копейки округления оно уже терпит.',
    todo: 'Решить, какая из книг права, и выправить вторую.',
  },
  'fact-differs': {
    why: 'Итог книги управления и цена победителя в мониторинге разошлись. Обычная причина — торги прошли, а книга управления ещё держит прежнее число.',
    todo: 'Обновить итог в книге управления по цене победителя либо объяснить разницу в примечании.',
  },
  'savings-differ': {
    why: 'Экономия у сторон разная. Она — производная величина, и разойтись может как из-за начальной цены, так и из-за цены победителя.',
    todo: 'Сначала свести начальную цену и цену победителя, экономия сойдётся следом.',
  },
  'savings-not-difference': {
    why: 'Записанная экономия не равна разности «начальная цена минус цена победителя» — в строке правили одно число из трёх.',
    todo: 'Пересчитать экономию по своей же строке.',
  },
  'winner-price-missing': {
    why: 'Торги уже прошли (или книга управления показала итог), а цена победителя в мониторинге пустая. Ноль здесь — содержательное число: торги без результата; пустота — не заполнено.',
    todo: 'Проставить цену победителя либо отметить, что торги не состоялись.',
  },
  'code-distorted': {
    why: 'Номер процедуры набран с опечаткой — латинская буква вместо русской, лишний пробел, перепутанный разделитель. Пара по такому номеру не строится: продукт не соединяет строки по догадке.',
    todo: 'Исправить номер в книге — после этого закупка встанет в сверку сама.',
  },
  'subject-mismatch': {
    why: 'Номер совпал, а предметы закупки у сторон разные: либо номер поставлен не той строке, либо предмет переписали в одной книге и не переписали в другой.',
    todo: 'Перечитать обе строки и решить, одна это закупка или две.',
  },
  'duplicate-in-book': {
    why: 'Один номер процедуры стоит дважды в одной книге управления. Это не совместная закупка (та живёт в разных книгах), а повтор заполнения.',
    todo: 'Убрать лишнюю строку либо разделить закупку на две с разными номерами.',
  },
  'joint-shares': {
    why: 'Один номер в книгах нескольких управлений — штатная форма совместной закупки: каждое управление ведёт свою долю, и сумма долей сравнивается с целым в мониторинге.',
    todo: 'Ничего: это форма, а не ошибка. Проверить стоит только сумму долей.',
  },
  /**
   * Тот же класс, но без пометки о совместной закупке, — и это уже вопрос,
   * а не форма. На живых книгах таких случаев два, и подписать их «делать
   * ничего не надо» значило бы закрыть глаза ровно там, где номер мог уехать
   * в чужую книгу. Ключ с двоеточием — не ответ сервера, а различение экрана.
   */
  'joint-shares:unmarked': {
    why: 'Один номер процедуры стоит в книгах нескольких управлений, но признака совместной закупки нет ни на листе управления, ни в переходящем реестре. Либо пометку забыли поставить, либо номер попал в чужую книгу — и тогда доли складывать нельзя.',
    todo: 'Решить, совместная это закупка или номер уехал в чужую книгу, и проставить пометку либо исправить номер.',
  },
  'duplicate-in-monitoring': {
    why: 'Один номер дважды на одном листе книги мониторинга — строка задвоена.',
    todo: 'Оставить одну строку.',
  },
};

/**
 * Порядок классов на экране — от «пары нет вовсе» к «пара есть, числа врозь»
 * и дальше к разговору о самой связке. Это не алфавит и не размер группы:
 * читатель сначала узнаёт, чего не хватает целиком, и лишь потом — где числа
 * разъехались.
 */
export const FINDING_ORDER: readonly string[] = [
  'no-pair-in-monitoring',
  'no-pair-in-books',
  'no-sheet-record',
  'no-journal-record',
  'plan-differs',
  'fact-differs',
  'savings-differ',
  'savings-not-difference',
  'winner-price-missing',
  'code-distorted',
  'subject-mismatch',
  'duplicate-in-book',
  'duplicate-in-monitoring',
  'joint-shares',
];

// ── Строки ответа ────────────────────────────────────────────────────

export interface TriplePair {
  a: TripleSide;
  b: TripleSide;
  deltaRub: number | null;
  toleranceRub: number | null;
  agrees: boolean | null;
}

/** Одна величина закупки, увиденная тремя сторонами. */
export interface TripleMoney {
  bookRub: number | null;
  sheetRub: number | null;
  journalRub: number | null;
  sidesPresent: TripleSide[];
  pairs: TriplePair[];
  maxAbsDeltaRub: number | null;
  agrees: boolean | null;
  /** Кто отстал: две стороны согласны, третья — нет. null — ответа нет. */
  outlier: TripleSide | null;
}

/** Значение одной стороны по величине — для таблицы «три числа рядом». */
export function moneyOf(m: TripleMoney, s: TripleSide): number | null {
  return s === 'book' ? m.bookRub : s === 'sheet' ? m.sheetRub : m.journalRub;
}

export interface TripleBookRow {
  dept: string;
  sheet: string;
  row: number;
  subject: string | null;
  subordinate: string | null;
  planTotalThousands: number | null;
  factTotalThousands: number | null;
  economyTotalThousands: number | null;
}

export interface TripleMonitoringRow {
  side: 'sheet' | 'journal';
  sheet: string;
  row: number;
  /**
   * Управление, ведущее строку, и заказчик закупки. Нужны там, где стороны
   * книги ГРБС нет вовсе: фильтр по организации обязан работать и по закупке,
   * которая живёт только в книге мониторинга (п.127). У переходящего реестра
   * управление пусто — лист «25-26» общий для района.
   */
  dept: string | null;
  customer: string | null;
  code: string | null;
  subject: string;
  nmckRub: number | null;
  priceRub: number | null;
  savingsRub: number | null;
  stage: string | null;
  joint: boolean;
}

export interface TripleFinding {
  kind: TripleFindingKind;
  code: string | null;
  /** Адреса всех сторон расхождения: «УО!K412», «1. УЭР!G87». */
  addresses: string[];
  deltaRub: number | null;
  note: string;
  /** Форма, а не ошибка (доли совместной закупки). */
  expected: boolean;
}

export interface TripleRow {
  code: string;
  subject: string;
  bookRows: TripleBookRow[];
  sheetRows: TripleMonitoringRow[];
  journalRows: TripleMonitoringRow[];
  plan: TripleMoney;
  fact: TripleMoney;
  savings: TripleMoney;
  subjectSimilarity: number | null;
  departments: string[];
  subordinates: string[];
  findings: TripleFinding[];
}

/** Строка, чей номер процедуры не разобрался: пара предложена, не применена. */
export interface TripleOrphan {
  side: TripleSide;
  address: string;
  text: string;
  guess: string | null;
  note: string;
  subjectCandidate: { code: string; similarity: number } | null;
}

export interface TripleSummary {
  codesTotal: number;
  allThreeSides: number;
  twoSides: number;
  oneSide: number;
  clean: number;
  byKind: Record<string, number>;
}

export interface TriplePayload {
  source: MonitoringSource;
  /** Книги ГРБС, участвовавшие в сверке, — родословная третьей стороны (п.104). */
  books: { read: string[] };
  summary: TripleSummary;
  rows: TripleRow[];
  orphans: TripleOrphan[];
  notes: string[];
}

// ── Три пустоты и один ответ ─────────────────────────────────────────

/**
 * Состояние раздела. Развести эти случаи обязан ТИП, а не текст: «сверка
 * чиста», «книгу не прочитали» и «сопоставлять нечего» ведут читателя к трём
 * разным поступкам, и подсунуть не тот — значит отправить чинить целое.
 */
export type TripleState =
  /** Ответ есть, расхождения есть. */
  | { kind: 'ok'; payload: TriplePayload }
  /** Ответ есть, расхождений ни одного — сверка чиста. */
  | { kind: 'clean'; payload: TriplePayload }
  /** Ответ есть, но сопоставлять нечего: ни одного разобранного номера. */
  | { kind: 'no-codes'; payload: TriplePayload }
  /** Книга мониторинга не прочитана — сторон сверки нет. */
  | { kind: 'book-unread'; message: string }
  /** Роут сверки сервер ещё не отдаёт. */
  | { kind: 'not-wired'; message: string }
  /** Запрос не удался по иной причине — фраза сервера как есть. */
  | { kind: 'failed'; message: string };

// ── Чтение неизвестного ответа ───────────────────────────────────────

function rec(v: unknown): Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
}

function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

/** Число либо null. Ноль — значение, а не пустота: подмена запрещена. */
function num(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v.replace(/\s/gu, '').replace(',', '.'));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function count(v: unknown): number {
  return num(v) ?? 0;
}

function str(v: unknown): string | null {
  if (typeof v === 'string') {
    const s = v.trim();
    return s === '' ? null : s;
  }
  if (typeof v === 'number') return String(v);
  return null;
}

function text(v: unknown): string {
  return str(v) ?? '';
}

function strList(v: unknown): string[] {
  return arr(v).map(str).filter((s): s is string => s !== null);
}

function tri(v: unknown): boolean | null {
  return v === true ? true : v === false ? false : null;
}

function readMoney(v: unknown): TripleMoney {
  const m = rec(v);
  const sidesPresent = arr(m.sidesPresent)
    .map(side)
    .filter((s): s is TripleSide => s !== null);
  const pairs = arr(m.pairs)
    .map((x): TriplePair | null => {
      const p = rec(x);
      const a = side(p.a);
      const b = side(p.b);
      if (a === null || b === null) return null;
      return {
        a, b,
        deltaRub: num(p.deltaRub),
        toleranceRub: num(p.toleranceRub),
        agrees: tri(p.agrees),
      };
    })
    .filter((p): p is TriplePair => p !== null);
  return {
    bookRub: num(m.bookRub),
    sheetRub: num(m.sheetRub),
    journalRub: num(m.journalRub),
    sidesPresent: sidesPresent.length > 0
      ? sidesPresent
      // Сервер поле не прислал — вывести стороны по самим числам честнее,
      // чем показать «сторон нет» там, где числа на экране уже стоят.
      : SIDE_ORDER.filter((s) => num((m as Record<string, unknown>)[`${s}Rub`]) !== null),
    pairs,
    maxAbsDeltaRub: num(m.maxAbsDeltaRub),
    agrees: tri(m.agrees),
    outlier: side(m.outlier),
  };
}

function readBookRow(v: unknown): TripleBookRow {
  const b = rec(v);
  return {
    dept: text(b.dept),
    sheet: text(b.sheet) || text(b.dept),
    row: count(b.row),
    subject: str(b.subject),
    subordinate: str(b.subordinate),
    planTotalThousands: num(b.planTotalThousands),
    factTotalThousands: num(b.factTotalThousands),
    economyTotalThousands: num(b.economyTotalThousands),
  };
}

function readMonRow(v: unknown, fallback: 'sheet' | 'journal'): TripleMonitoringRow {
  const m = rec(v);
  const s = side(m.side);
  return {
    side: s === 'sheet' || s === 'journal' ? s : fallback,
    sheet: text(m.sheet),
    row: count(m.row),
    dept: str(m.dept),
    customer: str(m.customer),
    code: str(m.code),
    subject: text(m.subject),
    nmckRub: num(m.nmckRub),
    priceRub: num(m.priceRub),
    savingsRub: num(m.savingsRub),
    stage: str(m.stage),
    joint: m.joint === true,
  };
}

function readFinding(v: unknown): TripleFinding {
  const f = rec(v);
  return {
    kind: text(f.kind),
    code: str(f.code),
    addresses: strList(f.addresses),
    deltaRub: num(f.deltaRub),
    note: text(f.note),
    expected: f.expected === true,
  };
}

function readRow(v: unknown): TripleRow {
  const r = rec(v);
  return {
    code: text(r.code),
    subject: text(r.subject),
    bookRows: arr(r.bookRows).map(readBookRow),
    sheetRows: arr(r.sheetRows).map((x) => readMonRow(x, 'sheet')),
    journalRows: arr(r.journalRows).map((x) => readMonRow(x, 'journal')),
    plan: readMoney(r.plan),
    fact: readMoney(r.fact),
    savings: readMoney(r.savings),
    subjectSimilarity: num(r.subjectSimilarity),
    departments: strList(r.departments),
    subordinates: strList(r.subordinates),
    findings: arr(r.findings).map(readFinding).filter((f) => f.kind !== ''),
  };
}

export function normalizeTriple(raw: unknown): TriplePayload | null {
  if (raw === null || raw === undefined) return null;
  const r = rec(raw);
  const rows = arr(r.rows).map(readRow).filter((x) => x.code !== '');
  const orphans = arr(r.orphans).map((x): TripleOrphan => {
    const o = rec(x);
    const cand = rec(o.subjectCandidate);
    const candCode = str(cand.code);
    return {
      side: side(o.side) ?? 'book',
      address: text(o.address),
      text: text(o.text),
      guess: str(o.guess),
      note: text(o.note),
      subjectCandidate: candCode === null
        ? null
        : { code: candCode, similarity: num(cand.similarity) ?? 0 },
    };
  }).filter((o) => o.address !== '');

  const s = rec(r.summary);
  const byKind: Record<string, number> = {};
  for (const [k, val] of Object.entries(rec(s.byKind))) {
    const n = num(val);
    if (n !== null) byKind[k] = n;
  }
  // Раздела нет вовсе — это не «сверка чиста», а отсутствие ответа.
  if (rows.length === 0 && orphans.length === 0 && Object.keys(byKind).length === 0
    && count(s.codesTotal) === 0) return null;

  const src = rec(r.source);
  return {
    source: {
      bookName: text(src.bookName) || 'Ежедневный мониторинг',
      readAt: text(src.readAt),
      moneyUnit: text(src.moneyUnit) || 'руб',
      sheetsRead: strList(src.sheetsRead),
      sheetsFailed: Object.fromEntries(
        Object.entries(rec(src.sheetsFailed))
          .map(([k, val]) => [k, str(val)])
          .filter((e): e is [string, string] => e[1] !== null),
      ),
      // Знаменатель полноты чтения называет сервер; считать его здесь значило
      // бы завести второй ответ на вопрос «сколько всего листов в книге».
      sheetsExpected: num(src.sheetsExpected),
    },
    books: { read: strList(rec(r.books).read) },
    summary: {
      codesTotal: count(s.codesTotal),
      allThreeSides: count(s.allThreeSides),
      twoSides: count(s.twoSides),
      oneSide: count(s.oneSide),
      clean: count(s.clean),
      byKind,
    },
    rows,
    orphans,
    notes: strList(r.notes),
  };
}

/** Расхождений всего — сумма по классам, без «ожидаемых» долей совместных. */
export function findingsTotal(payload: TriplePayload): number {
  let total = 0;
  for (const row of payload.rows) {
    for (const f of row.findings) if (!f.expected) total += 1;
  }
  return total;
}

/**
 * Код ответа сервера из пойманной ошибки. Читается ПОЛЕМ, а не проверкой
 * `instanceof ApiError`, и причина не в педантизме: под подменённым модулем
 * `api` (так устроены страничные тесты) обращение к классу-заглушке само
 * бросает исключение — прямо в обработчике ошибки, то есть там, где падать
 * нельзя ни при каких условиях. Поле `status` переживает и подмену модуля,
 * и вторую копию класса в бандле.
 */
function statusOf(e: unknown): number | null {
  if (e === null || typeof e !== 'object') return null;
  const status = (e as { status?: unknown }).status;
  return typeof status === 'number' ? status : null;
}

/**
 * Сверка трёх источников. Три пустоты разводятся здесь, а не на экране:
 * отказ чтения книги приходит кодом 503, отсутствие роута — 404, и путать их
 * с «расхождений нет» нельзя.
 */
export async function fetchMonitoringTriple(refresh = false): Promise<TripleState> {
  try {
    const raw = await fetchJSON<unknown>(`/monitoring/triple${refresh ? '?refresh=true' : ''}`);
    const payload = normalizeTriple(raw);
    if (payload === null) {
      return {
        kind: 'not-wired',
        message: 'Сервер ответил на запрос сверки, но раздела с закупками в ответе нет.',
      };
    }
    if (payload.summary.codesTotal === 0) return { kind: 'no-codes', payload };
    if (findingsTotal(payload) === 0) return { kind: 'clean', payload };
    return { kind: 'ok', payload };
  } catch (e: unknown) {
    const status = statusOf(e);
    if (status === 503) {
      return {
        kind: 'book-unread',
        message: 'Книга «Ежедневный мониторинг» не прочитана: ни один лист не ответил.',
      };
    }
    if (status === 404) {
      return {
        kind: 'not-wired',
        message: 'Сверка трёх источников на сервере ещё не поднята.',
      };
    }
    return {
      kind: 'failed',
      message: e instanceof Error ? e.message : 'Сверка трёх источников не ответила.',
    };
  }
}
