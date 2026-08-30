/**
 * formula-integrity.ts — слой формульной целостности книг ГРБС.
 *
 * ЗАЧЕМ. До 30.08.2026 продукт читал книги управлений только значениями, и
 * вбитое руками `6696,6075` было неотличимо от посчитанного `=SUM(H34:J34)`.
 * Перебитые формулы видел один-единственный ручной прогон приёмки эталона
 * (`scripts/etalon-sync/qa.cjs`), запускаемый вне конвейера. Матрица правил
 * 30.08 (`docs/superpowers/audits/2026-08-30-pravila-matrica.md`, §1 правило №1)
 * назвала это первой слепотой продукта: книга красит такую ячейку красным
 * условным форматом «Формула сломана (K, O:P, R:T, Y:AC)», а продукт молчит.
 * Решение владельца §22 п.7 (`docs/superpowers/specs/2026-08-22-pulse-feedback-2.md`)
 * — читать одиннадцать формульных колонок по вебхуку и в ночном обходе; этот
 * слой — потребитель того чтения.
 *
 * ПОЧЕМУ ОТДЕЛЬНЫЙ ФАЙЛ, А НЕ signals.ts. Признаки строки (`detectSignals`)
 * судят СМЫСЛ строки по её значениям. Здесь судится НОСИТЕЛЬ — сама ячейка:
 * чем она заполнена, формулой или её следом. Разные предметы, разные входы
 * (сетка формул, а не словарь значений строки) и разная жизнь: значения
 * читаются всегда, формулы — по решению §22 п.7 далеко не в каждом обновлении.
 *
 * ГЛАВНОЕ ПРАВИЛО ЧЕСТНОСТИ. Пустая сетка формул значит «НЕ ЧИТАЛИ», а не
 * «дефектов нет». Слой в этом случае молчит и не выдаёт ни одной дыры: цена
 * ошибки здесь — ложная тревога на всю книгу (урок дампов 30.08, где ручной
 * инструмент насчитал «дыры» на 58 пустых строках хвоста УО, за которыми не
 * стояло ни одного дефекта).
 */
import type { Issue } from '@aemr/shared';
import { CHECK_REGISTRY, DEPT_COLUMNS } from '@aemr/shared';
import { issueIdentity, nextOccurrence, SEP } from './issue-identity.js';

/**
 * Одиннадцать формульных колонок книги ГРБС — ровно те, что канон таблиц
 * защищает (`scripts/etalon-sync/canon.cjs`, `goldenProtections`: K, O:P, R:T,
 * Y:AC) и красит правилом №1, и ровно те, что читает сервер
 * (`FORMULA_COLUMNS` в `packages/server/src/services/google-sheets.ts`).
 * Список продублирован здесь намеренно: ядро не имеет права зависеть от
 * сервера. Расхождение двух списков ловит страж
 * `formula-integrity.test.ts` — «одиннадцать канонных граф, не весь лист».
 */
export const FORMULA_COLUMNS = ['K', 'O', 'P', 'R', 'S', 'T', 'Y', 'Z', 'AA', 'AB', 'AC'] as const;

export type FormulaColumn = (typeof FORMULA_COLUMNS)[number];

/**
 * Три класса дефекта — дословно по плану §5
 * (`docs/superpowers/audits/2026-08-30-obmotka-plan.md`):
 *  · `formula_overwritten` — в формульной графе стоит не формула (вбито число
 *    или текст) при непустом номере закупки в A;
 *  · `formula_mutant` — формула есть, но не та: нормализованная не совпала с
 *    эталоном графы (живой случай УО Y1894: `=SUM(V1894:W1894)` без X);
 *  · `formula_hole` — номер закупки есть, а формульная ячейка пуста
 *    (формулу не протянули).
 */
export type FormulaDefectKind = 'formula_overwritten' | 'formula_mutant' | 'formula_hole';

/** Дефект несёт всё, что нужно, чтобы открыть книгу и починить, не переспрашивая. */
export interface FormulaDefect {
  /** Книга (лист управления), в которой найден дефект. */
  book: string;
  /** Буква формульной графы: K, O, … AC. */
  column: FormulaColumn;
  /** Номер строки ЛИСТА, как его видит человек. */
  row: number;
  /** Адрес ячейки целиком: «K34». */
  cell: string;
  /** Номер закупки из графы A — второй, устойчивый к сдвигу строк адрес. */
  rowSeq: string;
  /** Класс дефекта. */
  kind: FormulaDefectKind;
  /** Что стоит в ячейке сейчас (для дыры — пустая строка). */
  actual: string;
  /** Эталон графы — нормализованная модальная формула (номер строки → «#»). */
  etalon: string;
  /**
   * Ближайшая строка листа, где эталонная формула цела: из неё и тянуть.
   * `null` — донора не нашлось (эталон известен, но строка-носитель одна).
   */
  etalonRow: number | null;
}

/**
 * Вход слоя — одна книга.
 *
 * `values` и `formulas` — сетки ОДНОЙ геометрии: `[индекс строки][индекс
 * колонки листа]`, где колонка 0 = A. Именно такую сетку формул отдаёт
 * `getSheetFormulaColumns` на сервере: непрочитанные графы остаются пустыми.
 */
export interface FormulaIntegrityInput {
  /** Имя книги (листа управления) — первый уровень адреса дефекта. */
  book: string;
  /** Сетка значений листа. */
  values: ReadonlyArray<ReadonlyArray<unknown>>;
  /** Сетка формул тех же строк. Пустая = формулы не читались. */
  formulas: ReadonlyArray<ReadonlyArray<unknown>>;
  /** Номер строки листа, которой соответствует индекс 0 обеих сеток. По умолчанию 1. */
  startRow?: number;
  /**
   * Читались ли формулы. `false` — слой молчит безусловно. Не задано —
   * решает сама сетка: пустая значит «не читали».
   */
  formulasRead?: boolean;
}

/** Буква графы → индекс колонки листа (A = 0, AA = 26). */
function columnToIndex(letter: string): number {
  let n = 0;
  for (const ch of letter) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

const COLUMN_INDEX: ReadonlyMap<FormulaColumn, number> = new Map(
  FORMULA_COLUMNS.map((letter) => [letter, columnToIndex(letter)] as const),
);

/**
 * Метка номера строки в формуле: `H34` → `H#`. Знак доллара сохраняется
 * (`$H$34` → `$H$#`), чтобы абсолютная ссылка не выдавалась за относительную.
 */
function rowMarkRegExp(sheetRow: number): RegExp {
  return new RegExp('([A-Za-zА-Яа-я\\$])' + String(sheetRow) + '(?!\\d)', 'g');
}

function normalizeWith(raw: unknown, mark: RegExp): string {
  if (raw === null || raw === undefined || raw === '') return '';
  return String(raw).replace(mark, '$1#').replace(/\s+/g, '');
}

/**
 * Нормализация формулы — ДОСЛОВНО как в приёмке эталона
 * (`scripts/etalon-sync/qa.cjs`, `normFormula`): собственный номер строки
 * заменяется на «#», пробелы убираются. Второй способ нормализации завёл бы
 * второй канон, и «мутант» на двух сторонах считался бы по-разному.
 */
export function normalizeFormula(raw: unknown, sheetRow: number): string {
  return normalizeWith(raw, rowMarkRegExp(sheetRow));
}

/**
 * Номер закупки из графы A — и одновременно ГЕЙТ судимости строки.
 *
 * Канон валидации книги для A — «число больше нуля, строго». Поэтому шапка
 * («№ п/п») и пустые строки хвоста сюда не проходят, и это ровно тот урок
 * дампов 30.08: строки БЕЗ номера дырами не считаются, а формулы, протянутые
 * впрок на такие строки, дефектом не считаются тем более.
 */
function purchaseNumber(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  const text = String(raw).trim();
  if (text === '') return null;
  const n = Number(text.replace(',', '.'));
  if (!Number.isFinite(n) || n <= 0) return null;
  return text;
}

function isFormulaText(raw: unknown): boolean {
  return typeof raw === 'string' && raw.trimStart().startsWith('=');
}

function isEmptyCell(raw: unknown): boolean {
  return raw === null || raw === undefined || (typeof raw === 'string' && raw.trim() === '');
}

/** Ближайшая по расстоянию строка-донор из упорядоченного по возрастанию списка. */
function nearestDonor(donorRows: readonly number[], row: number): number | null {
  if (donorRows.length === 0) return null;
  let lo = 0;
  let hi = donorRows.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (donorRows[mid] === row) return donorRows[mid];
    if (donorRows[mid] < row) lo = mid + 1;
    else hi = mid - 1;
  }
  const before = hi >= 0 ? donorRows[hi] : null;
  const after = lo < donorRows.length ? donorRows[lo] : null;
  if (before === null) return after;
  if (after === null) return before;
  return row - before <= after - row ? before : after;
}

/** Что стоит в ячейке — в коротком виде для карточки замечания. */
function shortText(raw: unknown): string {
  const text = String(raw).trim();
  return text.length > 120 ? `${text.slice(0, 120)}…` : text;
}

/**
 * Дефекты формульной целостности одной книги.
 *
 * ЭТАЛОН ГРАФЫ — МОДА, А НЕ ПЕРВАЯ СТРОКА. Приёмка эталона берёт формулу
 * строки 4 и сверяет с ней всю графу; в живых книгах (УО) первые строки
 * бывают особыми, и тогда «эталоном» становится исключение, а вся здоровая
 * графа объявляется мутантом. Здесь эталон — самая частая нормализованная
 * формула графы среди судимых строк.
 *
 * ГРАФА БЕЗ ЭТАЛОНА НЕ СУДИТСЯ ВОВСЕ. Ни одной формулы в графе — значит либо
 * её не читали (сервер читает четырьмя диапазонами, и один мог не вернуться),
 * либо на вход подали не ту сетку. Сравнивать не с чем: слой молчит, а не
 * объявляет всю графу перебитой. Ложная тревога на тысячи ячеек дороже
 * пропуска вырожденного случая «графа уничтожена целиком».
 */
export function detectFormulaIntegrity(input: FormulaIntegrityInput): FormulaDefect[] {
  if (input.formulasRead === false) return [];
  const formulas = input.formulas ?? [];
  const values = input.values ?? [];
  // Пустая сетка = «не читали». Молчание здесь — обещание слоя.
  if (formulas.length === 0) return [];

  const startRow = input.startRow ?? 1;
  const height = Math.max(values.length, formulas.length);

  // Судимые строки: только те, у кого в A стоит настоящий номер закупки.
  const judged: Array<{ index: number; row: number; seq: string }> = [];
  for (let i = 0; i < height; i++) {
    const seq = purchaseNumber((values[i] ?? [])[DEPT_COLUMNS.ID]);
    if (seq === null) continue;
    judged.push({ index: i, row: startRow + i, seq });
  }
  if (judged.length === 0) return [];

  // Метка номера строки — одна на строку, а не на каждую из одиннадцати граф.
  const marks = new Map<number, RegExp>();
  for (const j of judged) marks.set(j.row, rowMarkRegExp(j.row));

  const defects: FormulaDefect[] = [];

  for (const column of FORMULA_COLUMNS) {
    const columnIndex = COLUMN_INDEX.get(column) as number;
    const cells = judged.map((j) => (formulas[j.index] ?? [])[columnIndex]);

    // Эталон графы: мода нормализованных формул. Порядок обхода — по строкам,
    // сравнение строгое (>), поэтому при равенстве счётчиков побеждает та
    // формула, что встретилась выше: правило детерминировано.
    const counts = new Map<string, number>();
    let etalon = '';
    let etalonCount = 0;
    for (let k = 0; k < judged.length; k++) {
      const cell = cells[k];
      if (!isFormulaText(cell)) continue;
      const norm = normalizeWith(cell, marks.get(judged[k].row) as RegExp);
      if (norm === '') continue;
      const next = (counts.get(norm) ?? 0) + 1;
      counts.set(norm, next);
      if (next > etalonCount) {
        etalonCount = next;
        etalon = norm;
      }
    }
    if (etalon === '') continue; // графу не читали либо сравнивать не с чем

    const donorRows: number[] = [];
    for (let k = 0; k < judged.length; k++) {
      const cell = cells[k];
      if (!isFormulaText(cell)) continue;
      if (normalizeWith(cell, marks.get(judged[k].row) as RegExp) === etalon) {
        donorRows.push(judged[k].row);
      }
    }

    for (let k = 0; k < judged.length; k++) {
      const { row, seq } = judged[k];
      const cell = cells[k];
      let kind: FormulaDefectKind | null = null;
      if (isEmptyCell(cell)) kind = 'formula_hole';
      else if (!isFormulaText(cell)) kind = 'formula_overwritten';
      else if (normalizeWith(cell, marks.get(row) as RegExp) !== etalon) kind = 'formula_mutant';
      if (kind === null) continue;

      defects.push({
        book: input.book,
        column,
        row,
        cell: `${column}${row}`,
        rowSeq: seq,
        kind,
        actual: kind === 'formula_hole' ? '' : shortText(cell),
        etalon,
        etalonRow: nearestDonor(donorRows, row),
      });
    }
  }

  // Порядок вывода — по строке, затем по графе: перечень читается сверху вниз
  // так же, как открытая книга, а не пачками по одиннадцати колонкам.
  defects.sort((a, b) => (a.row - b.row) || a.cell.localeCompare(b.cell, 'ru'));
  return defects;
}

const CHECKS_BY_KIND: ReadonlyMap<FormulaDefectKind, (typeof CHECK_REGISTRY)[number]> = new Map(
  (['formula_overwritten', 'formula_mutant', 'formula_hole'] as const)
    .map((kind) => [kind, CHECK_REGISTRY.find((c) => c.id === kind)] as const)
    .filter((pair): pair is [FormulaDefectKind, (typeof CHECK_REGISTRY)[number]] => pair[1] !== undefined),
);

/** Человеческое описание дефекта — адрес, номер закупки, что стоит, каков эталон. */
function describe(defect: FormulaDefect): string {
  const where = `${defect.book}, ячейка ${defect.cell} (закупка № ${defect.rowSeq})`;
  const donor = defect.etalonRow === null ? '' : `; целая формула — в строке ${defect.etalonRow}`;
  if (defect.kind === 'formula_hole') {
    return `${where}: формула не протянута, ячейка пуста. Эталон графы: ${defect.etalon}${donor}.`;
  }
  if (defect.kind === 'formula_overwritten') {
    return `${where}: вместо формулы стоит «${defect.actual}». Эталон графы: ${defect.etalon}${donor}.`;
  }
  return `${where}: формула «${defect.actual}» расходится с эталоном графы ${defect.etalon}${donor}.`;
}

/**
 * Дефекты → замечания конвейера.
 *
 * Состав устойчивого id — класс, книга, графа и НОМЕР ЗАКУПКИ, а не номер
 * строки: строки листа двигаются (п.98б), и замечание, привязанное к позиции,
 * орфанилось бы при каждой вставке выше.
 */
export function formulaIntegrityIssues(
  input: FormulaIntegrityInput,
  departmentId: string,
): Issue[] {
  const defects = detectFormulaIntegrity(input);
  if (defects.length === 0) return [];

  const now = new Date().toISOString();
  const occurrences = new Map<string, number>();
  const issues: Issue[] = [];

  for (const defect of defects) {
    const check = CHECKS_BY_KIND.get(defect.kind);
    // Паспорта нет — замечание не рождается (тот же закон, что у SIGNAL_ISSUE_MAP:
    // класс без паспорта не доезжает ни до Контроля, ни до Отчёта). Страж
    // «три паспорта заведены» держит эту ветку недостижимой.
    if (!check) continue;
    const idBase = ['formula', defect.kind, defect.book, defect.column, defect.rowSeq] as const;
    issues.push({
      id: issueIdentity([...idBase, nextOccurrence(occurrences, idBase.join(SEP))]),
      severity: check.severity as Issue['severity'],
      origin: 'spreadsheet_rule',
      category: `formula_integrity:${defect.kind}`,
      group: check.group,
      checkId: check.id,
      kbHint: check.kbHint,
      title: `${check.name}: ${defect.cell}`,
      description: describe(defect),
      sheet: defect.book,
      cell: defect.cell,
      row: defect.row,
      rowSeq: defect.rowSeq,
      departmentId,
      recommendation: check.recommendation,
      status: 'open',
      detectedAt: now,
      detectedBy: `pipeline:formula-integrity:${defect.kind}`,
    });
  }

  return issues;
}
