import { subordinateNameMatchKey } from '@aemr/shared';

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
  /** Способ закупки: дополнительный признак вероятной преемственности. */
  method?: string;
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

/** Не доказанная смена № п/п, а уникальное предметное совпадение для проверки. */
export interface IdentityCandidate {
  beforeRowSeq: string;
  afterRowSeq: string;
  beforeSheetRow: number;
  afterSheetRow: number;
  subject: string;
  subordinate: string;
  planSum: number;
  /** Какие факты послужили основанием (не автоматическое подтверждение личности). */
  evidence: 'subject+subordinate+plan+method';
  status: 'needs-review';
}

/**
 * Прежний № остался, но описывает другой предмет или учреждение.
 * Это наблюдение о перемене контекста, не доказательство подмены закупки:
 * возможны и обычные правки содержания.
 */
export interface NumberContextChange {
  rowSeq: string;
  beforeSheetRow: number;
  afterSheetRow: number;
  beforeSubject: string;
  afterSubject: string;
  beforeSubordinate: string;
  afterSubordinate: string;
  status: 'needs-review';
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
  /** Повторяющиеся номера нельзя сравнить однозначно. */
  ambiguousKeys?: { before: string[]; after: string[] };
  /** Возможная смена № п/п: только уникальное совпадение содержимого с доказательством. */
  identityCandidates?: IdentityCandidate[];
  /** Тот же № стал описывать другое содержание: не приравнивать к сохранённой идентичности. */
  contextChanged?: NumberContextChange[];
  note: string;
}

/** Карта № п/п → все строки: молчаливый first-wins при дублях недопустим. */
function groupByNumber(rows: readonly SnapshotRow[]): Map<string, SnapshotRow[]> {
  const groups = new Map<string, SnapshotRow[]>();
  for (const row of rows) {
    const key = String(row.rowSeq ?? '').trim();
    if (!key) continue;
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  }
  return groups;
}

function normalized(value: string | undefined): string {
  return String(value ?? '').replace(/\s+/gu, ' ').trim().toLocaleLowerCase('ru-RU');
}

/**
 * Консервативный предметный отпечаток, НЕ первичный ключ.
 * Одного одинакового названия закупки недостаточно. Изменение суммы или
 * учреждения не доказывает новую закупку, но запрещает автоматическое
 * предположение о смене номера. Факт не подменяется эвристикой.
 */
function subjectFingerprint(row: SnapshotRow): string | null {
  const subject = normalized(row.subject);
  // Историческое и действующее имя одной организации — один ключ сопоставления.
  const subordinate = subordinateNameMatchKey(row.subordinate);
  const amount = row.planSum;
  const method = normalized(row.method);
  if (!subject || !subordinate || !method || !Number.isFinite(amount) || (amount as number) <= 0) return null;
  return JSON.stringify([subject, subordinate, Math.round((amount as number) * 100), method]);
}

/** Уникальность содержимого проверяется по ВСЕМ строкам, а не только пропавшим. */
function uniqueContent(rows: readonly SnapshotRow[]): Map<string, SnapshotRow> {
  const groups = new Map<string, SnapshotRow[]>();
  for (const row of rows) {
    const fingerprint = subjectFingerprint(row);
    if (!fingerprint) continue;
    const group = groups.get(fingerprint) ?? [];
    group.push(row);
    groups.set(fingerprint, group);
  }
  const unique = new Map<string, SnapshotRow>();
  for (const [fingerprint, group] of groups) {
    if (group.length === 1) unique.set(fingerprint, group[0]);
  }
  return unique;
}

function countUnkeyed(rows: readonly SnapshotRow[]): number {
  return rows.filter((r) => !String(r.rowSeq ?? '').trim()).length;
}

/** Сравнение двух снимков одной книги. `before` — прежний, `after` — новый. */
export function diffSnapshots(
  before: readonly SnapshotRow[],
  after: readonly SnapshotRow[],
): RowDiff {
  const beforeGroups = groupByNumber(before);
  const afterGroups = groupByNumber(after);
  const ambiguousKeys = {
    before: [...beforeGroups].filter(([, rows]) => rows.length > 1).map(([key]) => key).sort(),
    after: [...afterGroups].filter(([, rows]) => rows.length > 1).map(([key]) => key).sort(),
  };
  const ambiguous = new Set([...ambiguousKeys.before, ...ambiguousKeys.after]);
  const was = new Map<string, SnapshotRow>([...beforeGroups]
    .filter(([key]) => !ambiguous.has(key))
    .map(([key, rows]) => [key, rows[0]] as const));
  const now = new Map<string, SnapshotRow>([...afterGroups]
    .filter(([key]) => !ambiguous.has(key))
    .map(([key, rows]) => [key, rows[0]] as const));

  const vanished: VanishedRow[] = [];
  const moved: MovedRow[] = [];
  const contextChanged: NumberContextChange[] = [];
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
    // Совпавший номер не гарантирует совпавшую закупку: сравниваем
    // предметную принадлежность, но не выдаём правку текста за подмену.
    const beforeSubject = normalized(row.subject);
    const afterSubject = normalized(still.subject);
    const beforeOrg = subordinateNameMatchKey(row.subordinate);
    const afterOrg = subordinateNameMatchKey(still.subordinate);
    if ((beforeSubject && afterSubject && beforeSubject !== afterSubject) ||
        (beforeOrg && afterOrg && beforeOrg !== afterOrg)) {
      contextChanged.push({
        rowSeq: key,
        beforeSheetRow: row.sheetRow,
        afterSheetRow: still.sheetRow,
        beforeSubject: row.subject ?? '',
        afterSubject: still.subject ?? '',
        beforeSubordinate: row.subordinate ?? '',
        afterSubordinate: still.subordinate ?? '',
        status: 'needs-review',
      });
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

  // Совпадение предмета, учреждения, суммы и способа — лишь гипотеза о
  // перенумерации. Даже уникальный отпечаток не даёт права автоматически
  // объединять строки или удалять событие отсутствия прежнего номера.
  const uniqueBefore = uniqueContent(before);
  const uniqueAfter = uniqueContent(after);
  const identityCandidates: IdentityCandidate[] = [];
  for (const missing of vanished) {
    const old = was.get(missing.rowSeq);
    if (!old) continue;
    const fingerprint = subjectFingerprint(old);
    if (!fingerprint || uniqueBefore.get(fingerprint) !== old) continue;
    const candidate = uniqueAfter.get(fingerprint);
    if (!candidate || candidate.rowSeq === missing.rowSeq) continue;
    if (now.get(candidate.rowSeq) !== candidate || was.has(candidate.rowSeq)) continue;
    identityCandidates.push({
      beforeRowSeq: missing.rowSeq,
      afterRowSeq: candidate.rowSeq,
      beforeSheetRow: missing.wasAtSheetRow,
      afterSheetRow: candidate.sheetRow,
      subject: old.subject ?? '',
      subordinate: old.subordinate ?? '',
      planSum: old.planSum as number,
      evidence: 'subject+subordinate+plan+method',
      status: 'needs-review',
    });
  }


  // Два закупочных номера могут поменяться местами, а прежний № — быть
  // использован для другой закупки. Обычный set-diff номеров пропустит такую
  // замену ЦЕЛИКОМ. Ищем прежнее содержимое под другим номером даже тогда,
  // когда прежний номер остался занят. Это тоже только проверяемая гипотеза:
  // изменение описания может быть законным редактированием, а не заменой.
  for (const [beforeSeq, old] of was) {
    const atOldNumber = now.get(beforeSeq);
    if (!atOldNumber) continue; // отсутствующий номер уже обработан выше
    const fingerprint = subjectFingerprint(old);
    if (!fingerprint || subjectFingerprint(atOldNumber) === fingerprint) continue;
    if (uniqueBefore.get(fingerprint) !== old) continue;
    const candidate = uniqueAfter.get(fingerprint);
    if (!candidate || candidate.rowSeq === beforeSeq ||
        now.get(candidate.rowSeq) !== candidate) continue;
    identityCandidates.push({
      beforeRowSeq: beforeSeq,
      afterRowSeq: candidate.rowSeq,
      beforeSheetRow: old.sheetRow,
      afterSheetRow: candidate.sheetRow,
      subject: old.subject ?? '',
      subordinate: old.subordinate ?? '',
      planSum: old.planSum as number,
      evidence: 'subject+subordinate+plan+method',
      status: 'needs-review',
    });
  }

  const sum = (rows: VanishedRow[], field: 'planSum' | 'factSum'): number =>
    rows.reduce((s, r) => s + (Number.isFinite(r[field]) ? (r[field] as number) : 0), 0);

  const unkeyed = { before: countUnkeyed(before), after: countUnkeyed(after) };
  const notes: string[] = [];
  if (vanished.length > 0) {
    notes.push(
      `Прежний № п/п не найден: ${vanished.length}. Журнал книги удаление строки не ` +
      `записывает — основание исчезновения номера по снимкам не установлено.`,
    );
  }
  if (unkeyed.before > 0 || unkeyed.after > 0) {
    notes.push(
      `Строк без № п/п: было ${unkeyed.before}, стало ${unkeyed.after} — ` +
      `их судьбу сравнение проследить не может, нумерацию нужно восстановить.`,
    );
  }
  if (identityCandidates.length > 0) {
    notes.push(
      'Возможных смен номера по уникальному совпадению предмета, учреждения, суммы и способа: ' +
      identityCandidates.length + '. Требуется проверка, перенумерация не доказана.',
    );
  }
  if (ambiguous.size > 0) {
    notes.push('Повторяющиеся № п/п не сопоставлялись: ' + [...ambiguous].sort().join(', ') + '.');
  }
  if (contextChanged.length > 0) {
    notes.push('Контекст при прежнем № изменён: ' + contextChanged.length +
      '. Это может быть редакторская правка или другая закупка — связь требует проверки.');
  }
  if (notes.length === 0) notes.push('Все закупки прежнего снимка на месте.');

  return {
    vanished: vanished.sort((a, b) => (b.planSum ?? 0) - (a.planSum ?? 0)),
    appeared,
    moved,
    vanishedPlanSum: Math.round(sum(vanished, 'planSum') * 100) / 100,
    vanishedFactSum: Math.round(sum(vanished, 'factSum') * 100) / 100,
    unkeyed,
    ambiguousKeys,
    identityCandidates,
    contextChanged,
    note: notes.join(' '),
  };
}
