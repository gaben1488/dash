/**
 * journal.ts — лист «25-26»: переходящий реестр двух лет и РОДОСЛОВНАЯ
 * процедур (спека §1.3, §2.3).
 *
 * Лист несёт то, чего нет на листах управлений: победителя и ИНН по
 * процедурам, которых на листах ещё нет, и — главное — колонку A, в которой
 * живёт судьба процедуры. Пятьдесят три непустых ячейки, из них девятнадцать
 * прямо ссылаются на другой код: «Новая закупка ЭА91-26», «После доработки
 * ЭА52-26», «Повторный (ЭА54-26)», «Отмена по решению Заказчиков. Новый
 * ЭАС267-26». Это готовый граф переобъявлений, которого нет больше нигде.
 *
 * Форма листа отличается от листов управлений в четырёх местах, и каждое
 * отличие содержательно:
 *  - колонка H называется «Дата подведения итогов» (на листах — «Дата
 *    проведения торгов/переторжки»), это тот же этап под другим именем;
 *  - формула экономии — «=D−I» БЕЗ округления (203 шт.), у 164 ячеек формулы
 *    нет вовсе (число внесено руками);
 *  - контрольной колонки нет вовсе;
 *  - победитель стоит в колонке K, разбивка бюджетов — в L/M/N.
 *
 * Направление связи определяется НЕ типом строки, а маркером, стоящим перед
 * кодом в тексте: «после доработки X» / «повторный (X)» — X предшественница,
 * «новая закупка X» / «новый X» / «повторный аукцион X» — X преемница.
 */

import { extractProcedureRefs, type ProcedureFamily } from '@aemr/shared';
import {
  monitoringDate,
  monitoringNumber,
  monitoringText,
  type MonitoringDate,
} from './cells.js';
import { MONITORING_MASTER_SHEET, parseMonitoringProcedures, type MonitoringProcedure } from './procedures.js';
import { parseWinnerCell, type ParsedWinner } from './winner.js';

/** Колонки листа «25-26» (0-based). */
const JOURNAL_COLUMNS = {
  FATE: 0,
  CUSTOMER: 1,
  SUBJECT: 2,
  NMCK: 3,
  APPLICATION: 4,
  PUBLICATION: 5,
  DEADLINE: 6,
  /** «Дата подведения итогов» — тот же этап, что торги на листах управлений. */
  RESULT: 7,
  PRICE: 8,
  SAVINGS: 9,
  WINNER: 10,
  SAVINGS_MB: 11,
  SAVINGS_KB: 12,
  SAVINGS_FB: 13,
} as const;

/** Шапка листа — одна строка; данные со второй (спека §1.3). */
const JOURNAL_HEADER_ROWS = 1;

/**
 * Автофильтр книги объявлен на A1:AI375, а данные идут до 392-й строки:
 * последние семнадцать процедур человек при работе с фильтром не увидит.
 */
export const JOURNAL_FILTER_LAST_ROW = 375;

/**
 * Классы судьбы процедуры из колонки A — закрытый словарь (п.27: свободный
 * текст не становится статусом, но он и не выбрасывается: сырое написание
 * едет на экран рядом с классом).
 */
export type ProcedureFate =
  /** «2026», «2026 год» — маркер годового блока, не судьба. */
  | 'year-marker'
  /** «Новая закупка X» — процедура объявлена заново под другим кодом. */
  | 'new-purchase'
  /** «После доработки X» — эта строка и есть переобъявление. */
  | 'after-rework'
  /** «Повторный аукцион X», «Повторный (X)», «повторно». */
  | 'repeat'
  /** «Отмена по решению Заказчиков. Новый X». */
  | 'cancelled'
  /** «С отклонением участника» и десять его написаний. */
  | 'participant-rejected'
  /** «ФАС», «УФАС-жалоба», «С жалобой ФАС». */
  | 'fas-complaint'
  /** «На доработке у Заказчика», «Отклонена Заказчику на доработку». */
  | 'at-customer'
  /** «не прошло в казне». */
  | 'treasury'
  /** Пометка есть, но ни в один класс не попала — показывается как есть. */
  | 'other';

/** Подписи классов судьбы для читателя. */
export const PROCEDURE_FATE_LABELS: Record<ProcedureFate, string> = {
  'year-marker': 'Маркер года',
  'new-purchase': 'Объявлена новая закупка',
  'after-rework': 'После доработки',
  repeat: 'Повторная процедура',
  cancelled: 'Отменена заказчиком',
  'participant-rejected': 'С отклонением участника',
  'fas-complaint': 'Жалоба в ФАС',
  'at-customer': 'На доработке у заказчика',
  treasury: 'Не прошло в казначействе',
  other: 'Пометка книги',
};

/** Строка переходящего реестра. */
export interface MonitoringJournalRow {
  readonly sheet: string;
  readonly row: number;
  /** Сырая колонка A — как записано в книге; null — ячейка пуста. */
  readonly fateText: string | null;
  readonly fate: ProcedureFate | null;
  readonly customer: string;
  readonly code: string | null;
  readonly method: ProcedureFamily | null;
  readonly year: number | null;
  readonly subject: string;
  readonly nmck: number | null;
  readonly applicationDate: MonitoringDate | null;
  readonly publicationDate: MonitoringDate | null;
  readonly deadlineDate: MonitoringDate | null;
  /** «Дата подведения итогов». */
  readonly resultDate: MonitoringDate | null;
  readonly price: number | null;
  readonly savings: number | null;
  readonly savingsMb: number | null;
  readonly savingsKb: number | null;
  readonly savingsFb: number | null;
  readonly winner: ParsedWinner;
  /** Строка ниже области автофильтра книги — в отбор книги не попадает. */
  readonly outsideBookFilter: boolean;
  /**
   * Скрыта ли строка в книге. Values-чтение таблицы этого слоя не отдаёт,
   * поэтому по умолчанию null — «не знаем», а не «нет» (п.36). Значение
   * приходит извне, если источник его сообщил.
   */
  readonly hiddenInBook: boolean | null;
  /** Коды, на которые ссылается колонка A этой строки. */
  readonly linkedCodes: readonly string[];
}

/** Ребро родословной: from → to (предшественница → преемница). */
export interface LineageEdge {
  readonly from: string;
  readonly to: string;
  /** Адрес строки книги, из которой связь вычитана. */
  readonly sourceRow: number;
  /** Сырое написание пометки — читатель видит формулировку книги. */
  readonly sourceText: string;
}

/** Цепочка переобъявлений целиком: ЭА52-26 → ЭА91-26 → ЭА119-26. */
export interface LineageChain {
  readonly codes: readonly string[];
  readonly edges: readonly LineageEdge[];
}

export interface MonitoringJournal {
  readonly rows: MonitoringJournalRow[];
  readonly edges: LineageEdge[];
  /** Цепочки длиной от двух кодов — то, что показывается в карточке. */
  readonly chains: LineageChain[];
  /** Сколько строк ниже области автофильтра книги. */
  readonly outsideFilterCount: number;
}

/** Explicit U / V links from the canonical source; comments never create edges. */
export function journalFromProcedures(procedures: readonly MonitoringProcedure[]): MonitoringJournal {
  const edges: LineageEdge[] = [];
  const seen = new Set<string>();
  const rows = procedures.map((p): MonitoringJournalRow => {
    const before = p.ancestorCodes ?? []; const after = p.successorCodes ?? [];
    const fateText = [p.result, before.length ? `Предок: ${before.join(', ')}` : null, after.length ? `Наследник: ${after.join(', ')}` : null].filter(Boolean).join('; ') || null;
    for (const [from, to, field] of [...before.map((code) => [code, p.code, 'Предок U']), ...after.map((code) => [p.code, code, 'Наследник V'])]) {
      if (!from || !to || seen.has(`${from}\n${to}`)) continue;
      seen.add(`${from}\n${to}`);
      edges.push({ from, to, sourceRow: p.row, sourceText: field ?? '' });
    }
    return { sheet: p.sheet, row: p.row, fateText,
      fate: p.result?.startsWith('Отмена') ? 'cancelled' : after.length ? 'new-purchase' : before.length ? 'after-rework' : null,
      customer: p.customer, code: p.code, method: p.method, year: p.year, subject: p.subject, nmck: p.nmck,
      applicationDate: p.applicationDate, publicationDate: p.publicationDate, deadlineDate: p.deadlineDate,
      resultDate: p.auctionDate, price: p.auctionPrice, savings: p.savingsTotal, savingsMb: p.savingsMb,
      savingsKb: p.savingsKb, savingsFb: p.savingsFb, winner: p.winner, outsideBookFilter: false,
      hiddenInBook: null, linkedCodes: [...before, ...after] };
  });
  return { rows, edges, chains: buildLineageChains(edges), outsideFilterCount: 0 };
}

/**
 * Маркеры направления связи. Порядок важен: длинные раньше коротких.
 *
 * ОКОНЧАНИЯ ПИШУТСЯ ЯВНЫМ КЛАССОМ «[а-яё]», а не «\w»: в JavaScript «\w» —
 * это латиница с цифрами и подчёркиванием, флаг «u» этого не меняет. С «\w»
 * шаблон «нов\w+ закупка» не находил «новая закупка» вовсе, и весь граф
 * переобъявлений оставался пустым.
 */
const DIRECTION_MARKERS: ReadonlyArray<{ re: RegExp; referencedIsPredecessor: boolean }> = [
  { re: /после\s+доработки/giu, referencedIsPredecessor: true },
  { re: /повторн[а-яё]*\s*\(/giu, referencedIsPredecessor: true },
  { re: /нов[а-яё]+\s+закупка/giu, referencedIsPredecessor: false },
  { re: /новый|новая(?!\s+закупка)/giu, referencedIsPredecessor: false },
  { re: /повторн[а-яё]*\s+аукцион/giu, referencedIsPredecessor: false },
];

/** Класс судьбы по тексту колонки A. Словарь закрытый, «прочее» — честный класс. */
export function classifyFate(text: string): ProcedureFate {
  const t = text.toLowerCase();
  if (/^\s*20\d{2}(\s*год)?\s*$/u.test(t)) return 'year-marker';
  if (/отмена/u.test(t)) return 'cancelled';
  if (/после\s+доработки/u.test(t)) return 'after-rework';
  if (/нов[а-яё]+\s+закупка|новый\s+э/u.test(t)) return 'new-purchase';
  if (/повторн/u.test(t)) return 'repeat';
  if (/отклонени[а-яё]*\s+участник|с\s+отклонением/u.test(t)) return 'participant-rejected';
  if (/фас/u.test(t)) return 'fas-complaint';
  if (/доработк[а-яё]+\s+у\s+заказчик|отклонена\s+заказчику/u.test(t)) return 'at-customer';
  if (/казн/u.test(t)) return 'treasury';
  return 'other';
}

/**
 * Направление связи для каждого кода в тексте: ищется ближайший маркер СЛЕВА
 * от кода. «После доработки ЭА52-26, новая закупка 119-26» — у ЭА52-26 слева
 * стоит «после доработки», значит ЭА52-26 предшественница этой строки.
 */
function directionForCodeAt(text: string, codeIndex: number): boolean {
  let best = -1;
  let predecessor = false;
  for (const { re, referencedIsPredecessor } of DIRECTION_MARKERS) {
    re.lastIndex = 0;
    for (const m of text.matchAll(re)) {
      const at = m.index ?? -1;
      if (at >= 0 && at < codeIndex && at > best) {
        best = at;
        predecessor = referencedIsPredecessor;
      }
    }
  }
  // Маркера слева нет — по умолчанию упомянутый код считается преемницей:
  // так записаны «Новая закупка …» без предлога и одиночные ссылки.
  return best >= 0 ? predecessor : false;
}

/** Коды процедур в тексте вместе с позицией — нужна для выбора направления. */
const CODE_IN_TEXT_RE = /(Э\s*А\s*С|Э\s*З\s*К|Э\s*Е\s*П|Э\s*А)\s*\d+\s*-\s*\d{2}/giu;

function locateCodes(text: string): Array<{ code: string; at: number }> {
  const out: Array<{ code: string; at: number }> = [];
  for (const m of text.matchAll(CODE_IN_TEXT_RE)) {
    const refs = extractProcedureRefs(m[0]);
    if (refs.length === 1) out.push({ code: refs[0].code, at: m.index ?? 0 });
  }
  return out;
}

/** Разобрать лист «25-26». Лист не прочитан → пустой разбор, не выдумка. */
export function parseMonitoringJournal(
  grid: unknown[][] | undefined,
  options: { readonly hiddenRows?: readonly number[] } = {},
): MonitoringJournal {
  const rows: MonitoringJournalRow[] = [];
  const edges: LineageEdge[] = [];
  if (!grid) return { rows, edges, chains: [], outsideFilterCount: 0 };
  if (grid[1]?.[0] === 'Код процедуры') {
    return journalFromProcedures(parseMonitoringProcedures({ [MONITORING_MASTER_SHEET]: grid }).procedures);
  }

  const hidden = options.hiddenRows === undefined ? null : new Set(options.hiddenRows);
  const C = JOURNAL_COLUMNS;
  let outsideFilterCount = 0;

  for (let i = JOURNAL_HEADER_ROWS; i < grid.length; i++) {
    const raw = grid[i] ?? [];
    const customer = monitoringText(raw[C.CUSTOMER]);
    const subjectCell = monitoringText(raw[C.SUBJECT]);
    if (customer === null && subjectCell === null) continue;

    const row = i + 1;
    const fateCell = raw[C.FATE];
    const fateText = monitoringText(fateCell);
    const fate = fateText === null ? null : classifyFate(fateText);

    const refs = extractProcedureRefs(subjectCell);
    const ref = refs.length > 0 ? refs[0] : null;
    let subject = subjectCell ?? '';
    if (ref !== null) {
      const head = /^\s*\S+\s+/u.exec(subject);
      if (head && extractProcedureRefs(head[0]).length > 0) subject = subject.slice(head[0].length).trim();
    }

    // Родословная: коды из колонки A, каждый со своим направлением связи.
    const linkedCodes: string[] = [];
    if (fateText !== null && fate !== 'year-marker' && ref !== null) {
      const lower = fateText.toLowerCase();
      for (const { code, at } of locateCodes(fateText)) {
        if (code === ref.code || linkedCodes.includes(code)) continue;
        linkedCodes.push(code);
        const referencedIsPredecessor = directionForCodeAt(lower, at);
        edges.push(
          referencedIsPredecessor
            ? { from: code, to: ref.code, sourceRow: row, sourceText: fateText }
            : { from: ref.code, to: code, sourceRow: row, sourceText: fateText },
        );
      }
    }

    const outsideBookFilter = row > JOURNAL_FILTER_LAST_ROW;
    if (outsideBookFilter) outsideFilterCount += 1;

    rows.push({
      sheet: '25-26',
      row,
      fateText,
      fate,
      customer: customer ?? '',
      code: ref?.code ?? null,
      method: ref?.family ?? null,
      year: ref?.yy ?? null,
      subject,
      nmck: monitoringNumber(raw[C.NMCK]),
      applicationDate: monitoringDate(raw[C.APPLICATION]),
      publicationDate: monitoringDate(raw[C.PUBLICATION]),
      deadlineDate: monitoringDate(raw[C.DEADLINE]),
      resultDate: monitoringDate(raw[C.RESULT]),
      price: monitoringNumber(raw[C.PRICE]),
      savings: monitoringNumber(raw[C.SAVINGS]),
      savingsMb: monitoringNumber(raw[C.SAVINGS_MB]),
      savingsKb: monitoringNumber(raw[C.SAVINGS_KB]),
      savingsFb: monitoringNumber(raw[C.SAVINGS_FB]),
      winner: parseWinnerCell(raw[C.WINNER]),
      outsideBookFilter,
      hiddenInBook: hidden === null ? null : hidden.has(row),
      linkedCodes,
    });
  }

  return { rows, edges, chains: buildLineageChains(edges), outsideFilterCount };
}

/**
 * Собрать цепочки переобъявлений из рёбер. Каждая цепочка начинается с кода,
 * в который никто не ведёт, и идёт по преемницам до конца. Циклы («ЭА54-26 ↔
 * ЭА214-26», обе стороны записали друг друга) обрываются на повторе кода —
 * бесконечной цепочки на экране быть не должно.
 */
export function buildLineageChains(edges: readonly LineageEdge[]): LineageChain[] {
  const unique = new Map<string, LineageEdge>();
  for (const edge of edges) {
    const key = `${edge.from}→${edge.to}`;
    if (!unique.has(key)) unique.set(key, edge);
  }
  const out = new Map<string, LineageEdge[]>();
  const incoming = new Set<string>();
  for (const edge of unique.values()) {
    const bucket = out.get(edge.from) ?? [];
    bucket.push(edge); out.set(edge.from, bucket); incoming.add(edge.to);
  }
  const chains: LineageChain[] = [];
  const covered = new Set<LineageEdge>();
  const positions = new Map<string, number>();
  const walk = (root: string): void => {
    const codes = [root]; const used: LineageEdge[] = [];
    const visited = new Set([root]);
    let current = root;
    for (;;) {
      const bucket = out.get(current) ?? [];
      let position = positions.get(current) ?? 0;
      while (position < bucket.length && covered.has(bucket[position])) position += 1;
      const next = bucket[position];
      positions.set(current, position + 1);
      if (next === undefined) break;
      covered.add(next); used.push(next); codes.push(next.to);
      // Сохраняем замыкающее ребро цикла, затем прекращаем обход.
      if (visited.has(next.to)) break;
      visited.add(next.to); current = next.to;
    }
    if (used.length > 0) chains.push({ codes, edges: used });
  };
  for (const root of out.keys()) {
    if (!incoming.has(root)) walk(root);
  }
  // Покрытие рёбер, а не узлов: внутренние ветви и циклы тоже доступны.
  // Каждое ребро показывается один раз, без экспоненциального перебора путей.
  for (const edge of unique.values()) {
    if (!covered.has(edge)) walk(edge.from);
  }
  return chains;
}
