/**
 * Нагрузка управлений — канон п.103 (идея владельца 18.08.2026).
 *
 * Повод: замер журналов правок показал разброс в сотни раз — у одного
 * управления 33 724 записи, у другого 13. Само по себе это число ничего не
 * говорит: у управления образования 44 подведомственных учреждения и тысячи
 * строк, у управления имущества — одна организация и семь десятков строк.
 * Нагрузка становится сравнимой только в отношениях: правок на строку,
 * строк на учреждение, правок на учреждение.
 *
 * Тон (канон п.53): это ИЗМЕРЕНИЕ ТРУДОЁМКОСТИ, а не рейтинг вины. Много
 * правок — признак живой работы, а не беспорядка; мало правок при живых
 * закупках — чаще признак того, что журнал не ведётся, а не того, что работы
 * нет. Поэтому каждая мера сопровождается признаком наблюдаемости, и модуль
 * НИКОГДА не выдаёт «нет правок» за «нет работы».
 */

/** Сырьё по одному управлению: что удалось прочитать из книги. */
export interface DeptWorkloadInput {
  /** Канонический ид управления (латиница), например 'uo'. */
  deptId: string;
  /** Строк закупок в книге (лист «ВСЕ»). */
  rows: number;
  /** Различных учреждений в колонке C (включая само управление). */
  subordinates: number;
  /** Записей журнала правок (_ChangeLog) книги. */
  journalEntries: number;
  /**
   * Строки прочитаны не целиком (например, ответ обрезан лимитом страницы).
   * Тогда производные меры считаются, но помечаются как заниженные.
   */
  rowsTruncated?: boolean;
}

/** Насколько журналу этой книги можно верить как источнику истории. */
export type JournalObservability = 'rich' | 'thin' | 'blind';

export interface DeptWorkload {
  deptId: string;
  rows: number;
  subordinates: number;
  journalEntries: number;
  /** Правок на строку закупки. null — строк нет, делить не на что. */
  editsPerRow: number | null;
  /** Строк на учреждение — сколько закупок ведёт одно учреждение. */
  rowsPerSubordinate: number | null;
  /** Правок на учреждение — сколько ручной работы приходится на организацию. */
  editsPerSubordinate: number | null;
  /** Наблюдаемость журнала: rich — история полна, blind — почти пуст. */
  observability: JournalObservability;
  /** Меры занижены: строки прочитаны частично. */
  truncated: boolean;
  /** Человеческое пояснение к строке — почему меры такие. */
  note: string;
}

/**
 * Пороги наблюдаемости. Отсечка не в абсолютных записях, а в отношении к
 * числу строк: журнал на 124 записи при 46 строках (УФБП) — живой, журнал на
 * 34 записи при 67 строках (УДТХ) — почти слепой, хотя абсолютные числа
 * близки.
 */
const RICH_EDITS_PER_ROW = 2;
const BLIND_EDITS_PER_ROW = 0.5;

function ratio(a: number, b: number): number | null {
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= 0) return null;
  return Math.round((a / b) * 100) / 100;
}

function observabilityOf(editsPerRow: number | null): JournalObservability {
  if (editsPerRow === null) return 'blind';
  if (editsPerRow < BLIND_EDITS_PER_ROW) return 'blind';
  if (editsPerRow < RICH_EDITS_PER_ROW) return 'thin';
  return 'rich';
}

const OBSERVABILITY_NOTE: Readonly<Record<JournalObservability, string>> = {
  rich: 'История правок ведётся: по каждой строке видно, что и когда меняли.',
  thin: 'Журнал правок редкий — часть истории не записана, меры ниже реальных.',
  blind:
    'Журнал правок почти не ведётся: отсутствие записей здесь не означает ' +
    'отсутствие работы — историю по этой книге восстановить нечем.',
};

/** Меры нагрузки одного управления. */
export function deptWorkload(input: DeptWorkloadInput): DeptWorkload {
  const editsPerRow = ratio(input.journalEntries, input.rows);
  const observability = observabilityOf(editsPerRow);
  const truncated = input.rowsTruncated === true;
  const notes = [OBSERVABILITY_NOTE[observability]];
  if (truncated) {
    notes.push('Строки книги прочитаны не полностью — отношения занижены.');
  }
  return {
    deptId: input.deptId,
    rows: input.rows,
    subordinates: input.subordinates,
    journalEntries: input.journalEntries,
    editsPerRow,
    rowsPerSubordinate: ratio(input.rows, input.subordinates),
    editsPerSubordinate: ratio(input.journalEntries, input.subordinates),
    observability,
    truncated,
    note: notes.join(' '),
  };
}

export interface WorkloadReport {
  depts: DeptWorkload[];
  /** Итоги района: строки, учреждения, записи журнала. */
  totals: { rows: number; subordinates: number; journalEntries: number };
  /** Управления, чей журнал слеп — по ним история недоступна. */
  blindDepts: string[];
  /**
   * Во сколько раз самая нагруженная книга тяжелее самой лёгкой по строкам на
   * учреждение. null — сравнивать не с чем.
   */
  rowsPerSubordinateSpread: number | null;
}

/**
 * Сводка по району. Порядок — по строкам на учреждение убыванием: первым
 * идёт то управление, где на одну организацию приходится больше всего
 * закупок, а не то, где больше всего строк вообще.
 */
export function workloadReport(inputs: readonly DeptWorkloadInput[]): WorkloadReport {
  const depts = inputs.map(deptWorkload).sort((a, b) => {
    const av = a.rowsPerSubordinate ?? -1;
    const bv = b.rowsPerSubordinate ?? -1;
    return bv - av;
  });
  const spreadValues = depts
    .map((d) => d.rowsPerSubordinate)
    .filter((v): v is number => v !== null && v > 0);
  return {
    depts,
    totals: {
      rows: depts.reduce((s, d) => s + d.rows, 0),
      subordinates: depts.reduce((s, d) => s + d.subordinates, 0),
      journalEntries: depts.reduce((s, d) => s + d.journalEntries, 0),
    },
    blindDepts: depts.filter((d) => d.observability === 'blind').map((d) => d.deptId),
    rowsPerSubordinateSpread:
      spreadValues.length >= 2
        ? Math.round((Math.max(...spreadValues) / Math.min(...spreadValues)) * 10) / 10
        : null,
  };
}
