/**
 * Что экран «Сверка трёх источников» показывает и в каком порядке.
 *
 * Здесь нет разметки — только выводы из ответа сервера, и живут они отдельно
 * от компонента ровно потому, что их надо проверять тестом: «на какие деньги
 * разошлось» — число, которое читает начальница управления, и ошибка в нём
 * дороже любой ошибки вёрстки.
 *
 * ОДНА КАРТОЧКА НА КЛАСС, АДРЕСА ВНУТРИ (канон п.53). Россыпь из ста двадцати
 * карточек-расхождений нечитаема; класс же читается как одна новость («в
 * книгах ГРБС нет строки у восьмидесяти пяти закупок») и раскрывается
 * списком адресов по требованию. Поэтому группировка — здесь, а не в разметке.
 *
 * ДЕНЬГИ КЛАССА — ДВА РАЗНЫХ ЧИСЛА, И СМЕШИВАТЬ ИХ НЕЛЬЗЯ.
 *  • Разрыв — на сколько разошлись стороны. Он есть у классов про числа
 *    («начальные цены разошлись»): 33 закупки, разрыв в сумме столько-то.
 *  • Сумма закупок — сколько денег стоит за строками класса. Она есть у
 *    классов про отсутствие («нет строки в книгах ГРБС»): разрыва там нет
 *    вовсе, сравнивать не с чем, а размер вопроса измеряется начальной ценой
 *    самих закупок.
 * Назвать сумму закупок «расхождением на 400 миллионов» значило бы соврать
 * втрое: эти деньги не потеряны, они просто записаны в одной книге из трёх.
 */
import {
  FINDING_GUIDES, FINDING_LABELS, FINDING_ORDER,
  type FindingGuide, type TripleFinding, type TripleMoney, type TriplePayload, type TripleRow,
} from './triple-contract';
import { inDeptScope, type DeptScope } from '../selectors/dept-isolation';

// ── Деньги строки ────────────────────────────────────────────────────

/**
 * Начальная цена закупки по той стороне, что её знает: сначала лист
 * управления, затем переходящий реестр, затем книга ГРБС. Порядок не
 * произволен — он идёт от самой подробной записи к самой сводной.
 */
export function amountOf(row: TripleRow): number | null {
  return row.plan.sheetRub ?? row.plan.journalRub ?? row.plan.bookRub;
}

/** Класс говорит о разрыве чисел, а не об отсутствии записи. */
export function isMoneyKind(kind: string): boolean {
  return kind === 'plan-differs' || kind === 'fact-differs'
    || kind === 'savings-differ' || kind === 'savings-not-difference';
}

// ── Один пункт внутри карточки класса ────────────────────────────────

export interface TripleFindingItem {
  readonly finding: TripleFinding;
  readonly row: TripleRow;
  /** Разрыв, руб.; null — класс не про разрыв. */
  readonly deltaRub: number | null;
  /** Начальная цена закупки, руб.; null — её не знает ни одна сторона. */
  readonly amountRub: number | null;
}

export interface TripleFindingGroup {
  readonly kind: string;
  readonly label: string;
  readonly guide: FindingGuide | null;
  readonly items: readonly TripleFindingItem[];
  /** Сумма разрывов класса, руб.; null — разрывов в классе нет. */
  readonly deltaSumRub: number | null;
  /** Сумма начальных цен закупок класса, руб.; null — цен нет ни у одной. */
  readonly amountSumRub: number | null;
  /** Форма заполнения, а не ошибка: доли совместной закупки. */
  readonly expected: boolean;
}

function sumOrNull(values: ReadonlyArray<number | null>): number | null {
  const present = values.filter((v): v is number => v !== null);
  return present.length === 0 ? null : present.reduce((a, b) => a + b, 0);
}

/** Порядковый вес класса; незнакомый класс уезжает в конец, но не теряется. */
function orderOf(kind: string): number {
  const i = FINDING_ORDER.indexOf(kind);
  return i === -1 ? FINDING_ORDER.length : i;
}

/**
 * Расхождения, разложенные по классам. Внутри класса — сначала крупные:
 * читателю с двадцатью минутами времени нужны первые пять строк, и они
 * обязаны быть теми самыми пятью.
 */
export function groupFindings(rows: readonly TripleRow[]): TripleFindingGroup[] {
  const buckets = new Map<string, TripleFindingItem[]>();
  for (const row of rows) {
    const amountRub = amountOf(row);
    for (const finding of row.findings) {
      const bucket = buckets.get(finding.kind);
      const item: TripleFindingItem = {
        finding, row, deltaRub: finding.deltaRub, amountRub,
      };
      if (bucket === undefined) buckets.set(finding.kind, [item]);
      else bucket.push(item);
    }
  }

  const groups: TripleFindingGroup[] = [];
  for (const [kind, items] of buckets) {
    items.sort((a, b) => {
      const av = Math.abs(a.deltaRub ?? a.amountRub ?? 0);
      const bv = Math.abs(b.deltaRub ?? b.amountRub ?? 0);
      if (av !== bv) return bv - av;
      return a.row.code.localeCompare(b.row.code, 'ru');
    });
    // Один и тот же класс бывает формой и вопросом: «доли совместной
    // закупки» с пометкой — форма, без пометки — номер, возможно уехавший в
    // чужую книгу. Совет читателю обязан различать эти два случая, иначе
    // второй закрывался бы фразой «делать ничего не надо».
    const expected = items.every((i) => i.finding.expected);
    const guide = (!expected && FINDING_GUIDES[`${kind}:unmarked`] !== undefined)
      ? FINDING_GUIDES[`${kind}:unmarked`]
      : FINDING_GUIDES[kind] ?? null;

    groups.push({
      kind,
      label: FINDING_LABELS[kind] ?? kind,
      guide,
      items,
      deltaSumRub: sumOrNull(items.map((i) => (i.deltaRub === null ? null : Math.abs(i.deltaRub)))),
      amountSumRub: sumOrNull(items.map((i) => i.amountRub)),
      expected,
    });
  }
  groups.sort((a, b) => {
    // Форма («доли совместной закупки») всегда ниже ошибок, даже если она
    // многочисленнее: смешать её с расхождениями значит поднять ложную тревогу.
    if (a.expected !== b.expected) return a.expected ? 1 : -1;
    const d = orderOf(a.kind) - orderOf(b.kind);
    return d !== 0 ? d : b.items.length - a.items.length;
  });
  return groups;
}

// ── Какая из трёх величин обсуждается ────────────────────────────────

/** Величина закупки, о которой идёт речь в классе, и её подпись. */
export interface TripleSubject {
  readonly money: TripleMoney;
  /** Подпись величины в шапке столбца: «начальная цена». */
  readonly label: string;
}

/**
 * Класс называет одну из трёх величин, и показывать рядом надо именно её.
 * Классы про отсутствие записи величины не называют — им отдаётся начальная
 * цена: она отвечает на вопрос «о каких деньгах речь», не притворяясь разрывом.
 */
export function subjectOf(kind: string, row: TripleRow): TripleSubject {
  if (kind === 'fact-differs' || kind === 'winner-price-missing') {
    return { money: row.fact, label: 'факт и цена победителя' };
  }
  if (kind === 'savings-differ' || kind === 'savings-not-difference') {
    return { money: row.savings, label: 'экономия' };
  }
  return { money: row.plan, label: 'начальная цена' };
}

/** Адреса строк каждой стороны: «УО!2414», «8. УО!102», «25-26!370». */
export function sideAddresses(row: TripleRow): Record<'book' | 'sheet' | 'journal', string[]> {
  return {
    book: row.bookRows.map((b) => `${b.sheet}!${b.row}`),
    sheet: row.sheetRows.map((s) => `${s.sheet}!${s.row}`),
    journal: row.journalRows.map((j) => `${j.sheet}!${j.row}`),
  };
}

// ── Сводка над карточками ────────────────────────────────────────────

export interface TripleOverview {
  /** Закупок в сверке — уникальных номеров процедур. */
  readonly codesTotal: number;
  /** Сошлись: ни одного расхождения. */
  readonly agreed: number;
  /** Разошлись: хотя бы одно расхождение, кроме формы совместных долей. */
  readonly diverged: number;
  /** Все три записи на месте / две из трёх / одна. */
  readonly allThreeSides: number;
  readonly twoSides: number;
  readonly oneSide: number;
  /** Сумма разрывов там, где стороны сравнимы, руб. */
  readonly deltaSumRub: number | null;
  /** Начальная цена разошедшихся закупок, руб. — размер вопроса, не потеря. */
  readonly divergedAmountRub: number | null;
  /** Закупок, где расхождение — форма (доли совместной закупки). */
  readonly expectedOnly: number;
}

export function overviewOf(payload: TriplePayload, rows: readonly TripleRow[]): TripleOverview {
  let agreed = 0;
  let diverged = 0;
  let expectedOnly = 0;
  let allThreeSides = 0;
  let twoSides = 0;
  let oneSide = 0;
  const deltas: Array<number | null> = [];
  const amounts: Array<number | null> = [];

  for (const row of rows) {
    const real = row.findings.filter((f) => !f.expected);
    if (row.findings.length === 0) agreed += 1;
    else if (real.length === 0) { agreed += 1; expectedOnly += 1; }
    else {
      diverged += 1;
      amounts.push(amountOf(row));
      for (const f of real) if (f.deltaRub !== null) deltas.push(Math.abs(f.deltaRub));
    }

    const sides = (row.bookRows.length > 0 ? 1 : 0)
      + (row.sheetRows.length > 0 ? 1 : 0)
      + (row.journalRows.length > 0 ? 1 : 0);
    if (sides >= 3) allThreeSides += 1;
    else if (sides === 2) twoSides += 1;
    else if (sides === 1) oneSide += 1;
  }

  return {
    // Счётчик закупок берётся у самих строк, а не у сводки сервера: под
    // фильтром управления сводка сервера считала бы весь район и лгала.
    codesTotal: rows.length === payload.rows.length ? payload.summary.codesTotal : rows.length,
    agreed, diverged, expectedOnly,
    allThreeSides, twoSides, oneSide,
    deltaSumRub: sumOrNull(deltas),
    divergedAmountRub: sumOrNull(amounts),
  };
}

// ── Изоляция по организации (п.127) ──────────────────────────────────

/**
 * Строки сверки в периметре выбранных управлений. Управление берётся у
 * стороны книги ГРБС, а если её нет — у листа управления мониторинга: иначе
 * самый интересный класс («нет строки в книгах ГРБС») пропадал бы из среза
 * ровно потому, что книги ГРБС у него и нет.
 *
 * Переходящий реестр «25-26» общий для района и управления не несёт: закупка,
 * живущая ТОЛЬКО там, ни в один срез управления не попадает, и это честно —
 * приписать её управлению не на чем.
 */
export function scopeTripleRows(rows: readonly TripleRow[], scope: DeptScope): TripleRow[] {
  if (scope === null) return [...rows];
  return rows.filter((row) => {
    if (row.departments.some((d) => inDeptScope(scope, d))) return true;
    return row.sheetRows.some((s) => s.dept !== null && inDeptScope(scope, s.dept));
  });
}

/** Организации строки одной фразой: ГРБС и учреждение внутри него (п.127). */
export function orgPhrase(row: TripleRow): string {
  const parts: string[] = [];
  if (row.departments.length > 0) parts.push(row.departments.join(', '));
  const subs = row.subordinates.filter((s) => s !== '' && s !== 'Х' && s !== 'х');
  if (subs.length > 0) parts.push(subs.slice(0, 2).join('; ') + (subs.length > 2 ? ' и ещё…' : ''));
  return parts.join(' · ');
}
