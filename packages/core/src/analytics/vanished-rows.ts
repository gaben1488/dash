/**
 * Пропавшие и появившиеся закупки — канон п.105.
 *
 * Журнал книги удаление строки не видит: через меню таблицы строка уходит
 * без единой правки ячейки (замер 18.08.2026 — у УКСиМП 43 добавления и ноль
 * удалений на 3 702 записи). Значит единственный честный способ заметить
 * пропажу — сравнить два снимка книги и посмотреть, чего в новом не стало.
 *
 * Сравнение идёт по № п/п (колонка A), а не по номеру строки листа: строки
 * двигаются от вставок и сортировок, и «строка 155» вчера и сегодня — разные
 * закупки (живой случай п.98б). № п/п живёт вместе со своей закупкой.
 *
 * Модуль отвечает на три вопроса: какие закупки исчезли (с последним
 * известным содержимым — предмет и деньги пропавшего), какие появились, и
 * какие остались на месте, но переехали на другую строку листа.
 */

/** Строка книги в том виде, в каком её видит снимок. */
export interface SnapshotRow {
  /** № п/п из колонки A — ключ сравнения. Пустой означает «ключа нет». */
  rowSeq: string;
  /** Номер строки листа на момент снимка. */
  sheetRow: number;
  /** Предмет закупки (колонка G) — чтобы пропажу было видно человеку. */
  subject?: string;
  /** Плановая сумма, тыс. руб. */
  planSum?: number;
  /** Фактическая сумма, тыс. руб. */
  factSum?: number;
  /** Учреждение (колонка C). */
  subordinate?: string;
}

export interface VanishedRow {
  rowSeq: string;
  /** Где строка стояла в прежнем снимке. */
  wasAtSheetRow: number;
  subject?: string;
  subordinate?: string;
  /** Деньги, ушедшие вместе со строкой. */
  planSum?: number;
  factSum?: number;
}

export interface MovedRow {
  rowSeq: string;
  fromSheetRow: number;
  toSheetRow: number;
  subject?: string;
}

export interface RowDiff {
  /** Были в прежнем снимке, в новом их нет. */
  vanished: VanishedRow[];
  /** Появились в новом снимке. */
  appeared: SnapshotRow[];
  /** Остались, но переехали на другую строку листа. */
  moved: MovedRow[];
  /** Плановые деньги пропавших строк — цена вопроса. */
  vanishedPlanSum: number;
  /** Фактические деньги пропавших строк. */
  vanishedFactSum: number;
  /**
   * Строк без № п/п в снимках: сравнить их не с чем, и они не попадают ни в
   * одну из трёх групп. Молчать об этом нельзя — иначе пропажа строки без
   * номера выглядит как «ничего не случилось».
   */
  unkeyed: { before: number; after: number };
  note: string;
}

function keyed(rows: readonly SnapshotRow[]): Map<string, SnapshotRow> {
  const map = new Map<string, SnapshotRow>();
  for (const r of rows) {
    const key = String(r.rowSeq ?? '').trim();
    if (!key) continue;
    // Дубль № п/п — болезнь нумерации (правило row_numbering). Для сравнения
    // берём первое вхождение: две строки под одним номером и так подсвечены
    // отдельным сигналом, здесь нельзя терять факт пропажи обеих.
    if (!map.has(key)) map.set(key, r);
  }
  return map;
}

function countUnkeyed(rows: readonly SnapshotRow[]): number {
  return rows.filter((r) => !String(r.rowSeq ?? '').trim()).length;
}

/** Сравнение двух снимков одной книги. `before` — прежний, `after` — новый. */
export function diffSnapshots(
  before: readonly SnapshotRow[],
  after: readonly SnapshotRow[],
): RowDiff {
  const was = keyed(before);
  const now = keyed(after);

  const vanished: VanishedRow[] = [];
  const moved: MovedRow[] = [];
  for (const [key, row] of was) {
    const still = now.get(key);
    if (!still) {
      vanished.push({
        rowSeq: key,
        wasAtSheetRow: row.sheetRow,
        subject: row.subject,
        subordinate: row.subordinate,
        planSum: row.planSum,
        factSum: row.factSum,
      });
      continue;
    }
    if (still.sheetRow !== row.sheetRow) {
      moved.push({
        rowSeq: key,
        fromSheetRow: row.sheetRow,
        toSheetRow: still.sheetRow,
        subject: still.subject ?? row.subject,
      });
    }
  }

  const appeared: SnapshotRow[] = [];
  for (const [key, row] of now) {
    if (!was.has(key)) appeared.push(row);
  }

  const sum = (rows: VanishedRow[], field: 'planSum' | 'factSum'): number =>
    rows.reduce((s, r) => s + (Number.isFinite(r[field]) ? (r[field] as number) : 0), 0);

  const unkeyed = { before: countUnkeyed(before), after: countUnkeyed(after) };
  const notes: string[] = [];
  if (vanished.length > 0) {
    notes.push(
      `Закупок исчезло: ${vanished.length}. Журнал книги удаление строки не ` +
      `записывает — пропажа видна только сравнением снимков.`,
    );
  }
  if (unkeyed.before > 0 || unkeyed.after > 0) {
    notes.push(
      `Строк без № п/п: было ${unkeyed.before}, стало ${unkeyed.after} — ` +
      `их судьбу сравнение проследить не может, нумерацию нужно восстановить.`,
    );
  }
  if (notes.length === 0) notes.push('Все закупки прежнего снимка на месте.');

  return {
    vanished: vanished.sort((a, b) => (b.planSum ?? 0) - (a.planSum ?? 0)),
    appeared,
    moved,
    vanishedPlanSum: Math.round(sum(vanished, 'planSum') * 100) / 100,
    vanishedFactSum: Math.round(sum(vanished, 'factSum') * 100) / 100,
    unkeyed,
    note: notes.join(' '),
  };
}
