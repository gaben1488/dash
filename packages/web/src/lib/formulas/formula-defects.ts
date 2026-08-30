/**
 * formula-defects.ts — чтение замечаний формульной целостности книг на экранах.
 *
 * ЧТО ЭТО. Слой ядра `core/pipeline/formula-integrity.ts` судит НОСИТЕЛЬ —
 * саму ячейку формульной графы книги (K, O:P, R:T, Y:AC): затёрта ли формула
 * вбитым числом, разошлась ли с эталоном графы, не протянута ли вовсе. Он
 * рождает обычные замечания конвейера с паспортами `formula_overwritten`,
 * `formula_mutant`, `formula_hole` (@aemr/shared CHECK_REGISTRY, группа
 * `formula_consistency`). Здесь — только чтение этих замечаний тремя
 * поверхностями продукта: пятно Пульта, раздел Контроля, жетон строки Реестра.
 *
 * НИ ОДНОЙ СВОЕЙ ФОРМУЛИРОВКИ. Имена классов, механизм и рецепт починки
 * берутся из реестра проверок по идентификатору; адрес (книга, ячейка, номер
 * закупки) — из полей самого замечания. Из описания вынимаются только две
 * величины, которых в полях нет: что стоит в ячейке сейчас и каков эталон
 * графы. Порядок слов описания задаёт производитель, и страж
 * `formula-defects.test.ts` читает его исходник: поменяется фраза там —
 * упадёт тест здесь, а не молча опустеет карточка.
 *
 * ГЛАВНОЕ ПРАВИЛО ЧЕСТНОСТИ (то же, что у слоя-производителя). Пустой перечень
 * дефектов НЕ значит «дефектов нет». Формулы читаются не при каждом
 * обновлении — по уведомлению об изменении книги и в ночном обходе (решение
 * владельца §22 п.7). Пока формулы этой книги не читались или разбор их не
 * принял, продукт обязан говорить «не смотрели», а не «чисто»: за это отвечает
 * `formulaIntegritySpot`, и молчание он отличает от нуля.
 */
import { getCheckById } from '@aemr/shared';
import { pluralRu } from '../economy-copy';
import { toCanonicalDeptId } from '../dept-key';

/**
 * Три класса дефекта — РЕАЛЬНЫЕ идентификаторы паспортов из реестра проверок
 * (@aemr/shared check-registry.ts, группа `formula_consistency`). Список
 * закрытый и сверяется стражем: каждый идентификатор обязан найтись в реестре,
 * стоять в группе формульной согласованности и нести слагаемое доверия
 * `formula_integrity`. Придумывать имена классов на стороне экрана нельзя —
 * подпись разъедется с карточкой проверки, и читатель увидит два названия
 * одной вещи.
 */
export const FORMULA_DEFECT_CHECK_IDS = [
  'formula_overwritten',
  'formula_mutant',
  'formula_hole',
] as const;

export type FormulaDefectCheckId = (typeof FORMULA_DEFECT_CHECK_IDS)[number];

/** Группа реестра проверок, в которой живут три класса. */
export const FORMULA_DEFECT_GROUP = 'formula_consistency';

/** Заголовок поверхностей — один на все три экрана, чтобы не разъехался. */
export const FORMULA_INTEGRITY_TITLE = 'Целостность формул книг';

const CHECK_ID_SET: ReadonlySet<string> = new Set(FORMULA_DEFECT_CHECK_IDS);

/** Имя класса дословно из реестра проверок; неизвестный id — честная фраза. */
export function formulaDefectName(checkId: string): string {
  return getCheckById(checkId)?.name ?? 'Класс без паспорта в реестре проверок';
}

/** Рецепт починки дословно из реестра проверок. */
export function formulaDefectRecommendation(checkId: string): string {
  return getCheckById(checkId)?.recommendation ?? '';
}

/** Механизм дословно из реестра проверок. */
export function formulaDefectDescription(checkId: string): string {
  return getCheckById(checkId)?.description ?? '';
}

/** Замечание конвейера глазами этого слоя — берём только нужные поля. */
export interface FormulaIssueLike {
  id?: unknown;
  checkId?: unknown;
  sheet?: unknown;
  departmentId?: unknown;
  cell?: unknown;
  row?: unknown;
  rowSeq?: unknown;
  description?: unknown;
}

/** Дефект формулы, как его показывают экраны. */
export interface FormulaDefectView {
  /** Идентификатор замечания — ключ отрисовки. */
  id: string;
  /** Класс дефекта (идентификатор паспорта). */
  checkId: FormulaDefectCheckId;
  /** Имя класса из реестра проверок. */
  className: string;
  /** Книга (лист управления). */
  book: string;
  /** Ключ управления замечания — для сшивки со строкой Реестра. */
  departmentId: string;
  /** Адрес ячейки целиком: «K34». */
  cell: string;
  /** Номер строки листа; null — в замечании его нет. */
  row: number | null;
  /** Номер закупки из графы A — устойчивый адрес строки. */
  rowSeq: string;
  /** Что стоит в ячейке сейчас; null — ячейка пуста (дыра протяжки). */
  actual: string | null;
  /** Эталон графы — модальная формула; null — из описания не прочитан. */
  etalon: string | null;
  /** Строка, из которой тянуть целую формулу; null — донора не назвали. */
  donorRow: number | null;
  /** Что делать — дословно из паспорта проверки. */
  recommendation: string;
}

const ACTUAL_OVERWRITTEN = /вместо формулы стоит «([^»]*)»/;
const ACTUAL_MUTANT = /формула «([^»]*)» расходится/;
const ETALON_LABEL = 'Эталон графы: ';
const ETALON_INLINE = 'расходится с эталоном графы ';
const DONOR_MARK = '; целая формула — в строке ';

function textOrEmpty(value: unknown): string {
  return value === null || value === undefined ? '' : String(value);
}

/**
 * Что стоит в ячейке сейчас. У дыры протяжки в ячейке пусто — и это `null`,
 * а не пустая строка: «пусто» здесь смысл, а не отсутствие данных.
 */
export function parseActual(description: string, checkId: FormulaDefectCheckId): string | null {
  if (checkId === 'formula_hole') return null;
  const re = checkId === 'formula_overwritten' ? ACTUAL_OVERWRITTEN : ACTUAL_MUTANT;
  const hit = re.exec(description);
  return hit === null ? null : hit[1] as string;
}

/**
 * Эталон графы. Две формы описания у производителя: «Эталон графы: X» у
 * затёртой ячейки и дыры, «расходится с эталоном графы X» у мутанта. Хвост
 * «; целая формула — в строке N» и завершающая точка в эталон не входят.
 */
export function parseEtalon(description: string): string | null {
  let start = description.indexOf(ETALON_LABEL);
  let offset = ETALON_LABEL.length;
  if (start === -1) {
    start = description.indexOf(ETALON_INLINE);
    offset = ETALON_INLINE.length;
  }
  if (start === -1) return null;
  let tail = description.slice(start + offset);
  const donor = tail.indexOf(DONOR_MARK);
  if (donor !== -1) tail = tail.slice(0, donor);
  tail = tail.trim().replace(/\.$/, '').trim();
  return tail === '' ? null : tail;
}

/** Строка-донор целой формулы; её может не быть — тогда null. */
export function parseDonorRow(description: string): number | null {
  const hit = /целая формула — в строке (\d+)/.exec(description);
  if (hit === null) return null;
  const n = Number(hit[1]);
  return Number.isFinite(n) ? n : null;
}

/** Это замечание формульной целостности? */
export function isFormulaDefectIssue(issue: FormulaIssueLike): boolean {
  return CHECK_ID_SET.has(textOrEmpty(issue.checkId));
}

/** Замечания конвейера → дефекты формул для экрана. Чужие замечания отсеяны. */
export function collectFormulaDefects(
  issues: readonly FormulaIssueLike[],
): FormulaDefectView[] {
  const out: FormulaDefectView[] = [];
  for (const issue of issues) {
    const checkId = textOrEmpty(issue.checkId);
    if (!CHECK_ID_SET.has(checkId)) continue;
    const kind = checkId as FormulaDefectCheckId;
    const description = textOrEmpty(issue.description);
    const rowRaw = Number(issue.row);
    out.push({
      id: textOrEmpty(issue.id),
      checkId: kind,
      className: formulaDefectName(kind),
      book: textOrEmpty(issue.sheet),
      departmentId: textOrEmpty(issue.departmentId),
      cell: textOrEmpty(issue.cell),
      row: Number.isFinite(rowRaw) && rowRaw > 0 ? rowRaw : null,
      rowSeq: textOrEmpty(issue.rowSeq),
      actual: parseActual(description, kind),
      etalon: parseEtalon(description),
      donorRow: parseDonorRow(description),
      recommendation: formulaDefectRecommendation(kind),
    });
  }
  // Порядок — как в открытой книге: сперва книга, потом строка, потом графа.
  out.sort((a, b) =>
    a.book.localeCompare(b.book, 'ru')
    || (a.row ?? 0) - (b.row ?? 0)
    || a.cell.localeCompare(b.cell, 'ru'));
  return out;
}

/** Счёт ячеек: всего, по классам и по книгам. Считается ИЗ ДАННЫХ, не из памяти. */
export interface FormulaDefectCounts {
  /** Ячеек всего — число пятна Пульта. */
  total: number;
  /** По классам: ключ — идентификатор паспорта. */
  byClass: Record<FormulaDefectCheckId, number>;
  /** По книгам: ключ — имя книги. */
  byBook: Record<string, number>;
}

export function countFormulaDefects(
  defects: readonly FormulaDefectView[],
): FormulaDefectCounts {
  const byClass = {
    formula_overwritten: 0,
    formula_mutant: 0,
    formula_hole: 0,
  } as Record<FormulaDefectCheckId, number>;
  const byBook: Record<string, number> = {};
  for (const d of defects) {
    byClass[d.checkId] += 1;
    byBook[d.book] = (byBook[d.book] ?? 0) + 1;
  }
  return { total: defects.length, byClass, byBook };
}

/**
 * Ключ сшивки дефекта со строкой Реестра: канонический ключ управления плюс
 * номер закупки из графы A. Именно номер закупки, а не номер строки листа:
 * строки двигаются (канон п.98б), и привязка к позиции орфанилась бы при
 * каждой вставке выше — тем же доводом устроен и устойчивый id замечания.
 */
export function formulaRowKey(dept: unknown, rowSeq: unknown): string {
  const book = toCanonicalDeptId(textOrEmpty(dept).trim());
  const seq = textOrEmpty(rowSeq).trim();
  return `${book}|${seq}`;
}

/** Дефекты по строкам книги: ключ — formulaRowKey. Строка без номера не индексируется. */
export function indexFormulaDefectsByRow(
  defects: readonly FormulaDefectView[],
): Map<string, FormulaDefectView[]> {
  const index = new Map<string, FormulaDefectView[]>();
  for (const d of defects) {
    if (d.rowSeq === '') continue;
    // Книга замечания приходит именем листа («УО»), ключ строки Реестра —
    // ключом управления: обе формы канонизируются одной функцией.
    const key = formulaRowKey(d.book !== '' ? d.book : d.departmentId, d.rowSeq);
    const bucket = index.get(key);
    if (bucket) bucket.push(d);
    else index.set(key, [d]);
  }
  return index;
}

// ────────────────────────────────────────────────────────────
// Состояние чтения формул: «не смотрели» против «чисто»
// ────────────────────────────────────────────────────────────

/** След одной доставки формул (сервер: services/source-refresh.ts). */
export interface FormulaDeliveryNote {
  book: string;
  at: string;
  /** Сколько формульных ячеек привезено. */
  cells: number;
  /** Принял ли разбор эту посылку. */
  handled: boolean;
  /** Почему не принял, если не принял. */
  failedBecause?: string;
}

/** Ответ маршрута `/api/sources/integrity`, раздел формул. */
export interface FormulaReadState {
  /** Какие графы вообще читаются — граница «не найдено». */
  columns: string[];
  /** Подключён ли разбор формул. */
  sinkConnected: boolean;
  /** Книги, по которым формулы читались за жизнь службы. */
  books: FormulaDeliveryNote[];
  /** Книги, по которым формулы не читались НИ РАЗУ. */
  notRead: string[];
}

/** Пятно Пульта «Целостность формул книг». */
export interface FormulaSpotLine {
  /** Заголовок пятна. */
  title: string;
  /**
   * Счёт ячеек трёх классов. `null` — счёта НЕТ: формулы не читались либо
   * разбор их не принял. Ноль и `null` — разные вещи, и путать их запрещено.
   */
  cells: number | null;
  /** Что именно смотрели — фраза под числом. */
  text: string;
  /** Разбивка по классам; пуста, когда счёта нет. */
  breakdown: Array<{ checkId: FormulaDefectCheckId; name: string; count: number }>;
  /** Открывать ли дверь на «Контроль». */
  hasDoor: boolean;
}

function booksWord(n: number): string {
  return pluralRu(n, 'книге', 'книгам', 'книгам');
}

function booksNominative(n: number): string {
  return pluralRu(n, 'книга', 'книги', 'книг');
}

function cellsWord(n: number): string {
  return pluralRu(n, 'ячейка', 'ячейки', 'ячеек');
}

/** Оговорка про книги, чьи формулы не читались. Пусто — оговаривать нечего. */
function notReadClause(notRead: readonly string[]): string {
  if (notRead.length === 0) return '';
  return ` По ${notRead.length} ${booksWord(notRead.length)} формулы не читались вовсе`
    + ` (${notRead.join(', ')}) — их ячейки не проверены.`;
}

/**
 * Пятно «Целостность формул книг» — счёт ячеек трёх классов и честное
 * молчание вместо нуля.
 *
 * Разбор состояний (порядок важен, каждое следующее строже предыдущего):
 *   • состояния нет вовсе (сервер не ответил) → `null`: пятно не рисуется,
 *     отсутствие ответа не выдаётся ни за ноль, ни за тревогу;
 *   • ни одной книги не читали → счёта нет, сказано «формулы не читались»;
 *   • читали, но разбор не подключён либо ни одной посылки не принял → счёта
 *     нет, сказано почему;
 *   • читали и разобрали → счёт ячеек, разбивка по классам и оговорка о
 *     книгах, до которых чтение не дошло.
 */
export function formulaIntegritySpot(
  state: FormulaReadState | null,
  counts: FormulaDefectCounts,
): FormulaSpotLine | null {
  if (state === null) return null;

  const read = state.books ?? [];
  const notRead = state.notRead ?? [];

  if (read.length === 0) {
    return {
      title: FORMULA_INTEGRITY_TITLE,
      cells: null,
      text: 'Формулы книг не читались — сказать о дефектах формул нечего.'
        + ' Пустой перечень здесь не значит «дефектов нет».'
        + ` Формулы читаются по уведомлению об изменении книги и в ночном обходе${
          notRead.length > 0 ? ` (ждут ${notRead.length} ${booksNominative(notRead.length)})` : ''}.`,
      breakdown: [],
      hasDoor: false,
    };
  }

  const handled = read.filter((b) => b.handled);
  if (handled.length === 0) {
    const why = state.sinkConnected
      ? read.find((b) => b.failedBecause)?.failedBecause ?? 'разбор посылку не принял'
      : 'разбор формул не подключён';
    return {
      title: FORMULA_INTEGRITY_TITLE,
      cells: null,
      text: `Формулы ${read.length} ${booksNominative(read.length)} прочитаны, но не разобраны: ${why}.`
        + ' Это не «дефектов нет» — дефекты просто не считались.',
      breakdown: [],
      hasDoor: false,
    };
  }

  const breakdown = FORMULA_DEFECT_CHECK_IDS.map((checkId) => ({
    checkId,
    name: formulaDefectName(checkId),
    count: counts.byClass[checkId] ?? 0,
  }));

  const scope = `Разобраны формулы ${handled.length} ${booksNominative(handled.length)}`
    + ` (графы ${(state.columns ?? []).join(', ')}).`;

  if (counts.total === 0) {
    return {
      title: FORMULA_INTEGRITY_TITLE,
      cells: 0,
      text: `${scope} Дефектов формул не найдено.${notReadClause(notRead)}`,
      breakdown,
      hasDoor: false,
    };
  }

  const parts = breakdown
    .filter((b) => b.count > 0)
    .map((b) => `${b.name} — ${b.count}`)
    .join('; ');

  return {
    title: FORMULA_INTEGRITY_TITLE,
    cells: counts.total,
    text: `${counts.total} ${cellsWord(counts.total)} с дефектом формулы: ${parts}. ${scope}`
      + notReadClause(notRead),
    breakdown,
    hasDoor: true,
  };
}
