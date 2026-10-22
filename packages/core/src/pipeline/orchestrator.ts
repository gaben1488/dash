import { nanoid } from 'nanoid';
import { productCalendarDay, PRODUCT_UTC_OFFSET_HOURS } from '@aemr/shared';
import { issueIdentity, nextOccurrence, SEP } from './issue-identity.js';
import type { TrustCheckCoverage, DataSnapshot, NormalizedMetric, Issue, ReportMapEntry, ValidationRule } from '@aemr/shared';
import { SVOD_SHEET_NAME, CHECK_REGISTRY, LEGACY_SIGNAL_TO_CHECK, issueSuppressedByRowClass, epRiskStrictnessOfReason, futureFactDateSeverity, isAnnualEpAggregate, EP_ANNUAL_AMOUNT_TITLE, EP_ANNUAL_AMOUNT_EXPLANATION, epRiskReviewDetails, DEPT_HEADER_ROWS, buildCellDict, checkDeptHeaderGeometry, collectRowsByDept, isMetaRow, parseSvodGrid, CYRILLIC_TO_LATIN, findDept, subordinateKey, formulaErrorCells, toNumber as sheetNumber, canonicalizeReasonEp, EP_REASON_SCAN_LIMIT } from '@aemr/shared';
import { ingestBatchGetResponse, ingestSheetRows } from './ingest.js';
import { normalizeMetrics } from './normalize.js';
import { classifyRows } from './classify.js';
import { validateData } from './validate.js';
import { computeDeltas } from './delta.js';
import { computeTrustScore } from '../trust/scorer.js';
import type { RecalculatedMetrics } from './recalculate.js';
import { CalcEngine, standardRowFilter } from './calc-engine.js';
import { adaptToRecalcMetrics } from './calc-engine-adapter.js';
import { projectDepartmentMetrics, projectDistrictMetrics, type DepartmentCalculation } from '../metrics/published-projection.js';
import { detectSignals, type RowSignals } from './signals.js';
import { formulaIntegrityIssues } from './formula-integrity.js';
import { analyzeDataset, type DatasetAnalysis } from './dataset-signals.js';

export interface PipelineInput {
  /** Explicit historical clock; live runs capture one clock at pipeline entry. */
  asOf?: Date;
  sourceBindings?: Record<string, { providerId: string | null; sheetName: string; version: string | null; readAt: string | null }>;
  /** Ответ batchGet для официальных ячеек */
  batchGetData: Array<{
    range: string;
    values: unknown[][];
    formulas?: unknown[][];
  }>;
  /** Построчные данные листов для пересчёта */
  sheetRows: Record<string, unknown[][]>;
  /**
   * Формулы формульных граф книг ГРБС по листам — сетка той же геометрии, что
   * `sheetRows` (`[строка][колонка листа]`, колонка 0 = A). Так её и отдаёт
   * чтение сервера (`getSheetFormulaColumns`).
   *
   * ОТСУТСТВИЕ КЛЮЧА И ПУСТАЯ СЕТКА ЗНАЧАТ ОДНО: формулы НЕ ЧИТАЛИ. Это не
   * «дефектов нет»: формулы читаются по вебхуку и в ночном обходе (решение
   * владельца §22 п.7), а быстрое плановое обновление за них не платит — и
   * не имеет права выдавать своё молчание за чистую книгу.
   */
  sheetFormulas?: Record<string, unknown[][]>;
  /** Карта метрик */
  reportMap: ReportMapEntry[];
  /** Правила валидации */
  rules: ValidationRule[];
  /** ID таблицы */
  spreadsheetId: string;
  /** Target year for recalculation (e.g. 2026). If set, only rows from this year are counted. */
  targetYear?: number;
  /**
   * Год, за который считает официальный лист СВОД. Нужен сверке: расчёт
   * без года суммирует все годы книги, лист — только свой, и вычитать их
   * друг из друга нельзя (Д21). Неизвестен — сверка ведёт себя как раньше.
   */
  officialYear?: number;
}

/**
 * A physical Sheets tab name has exactly one canonical department identity.
 * Metric formulas and legacy published-key translation are owned by
 * metrics/published-projection and the shared executable catalog.
 */
const SHEET_TO_DEPT_ID: Record<string, string> = { ...CYRILLIC_TO_LATIN };
function sheetDeptId(sheetName: string): string | null {
  return SHEET_TO_DEPT_ID[sheetName] ?? findDept(sheetName)?.latinId ?? null;
}

/**
 * Главный оркестратор пайплайна обработки данных.
 *
 * Последовательность:
 * 1. Ingest — приём сырых данных
 * 2. Normalize — нормализация типов и значений
 * 3. Classify — классификация строк
 * 4. Validate — проверка по правилам
 * 5. Delta — сравнение official vs calculated
 * 6. Trust — вычисление скоринга доверия
 */

/**
 * Снимок, каким его отдаёт ИМЕННО этот конвейер.
 *
 * В общем типе `DataSnapshot` поля `recalcResults` и `datasetAnalyses`
 * объявлены как «словарь чего-то неизвестного», и это не небрежность: пакет
 * `shared` лежит НИЖЕ ядра и о его расчётных типах знать не может — иначе
 * зависимость пойдёт по кругу. Раньше на этом месте стоял `any`, то есть
 * «проверять нечего»; теперь стоит `unknown` — «шаг наружу требует разбора».
 *
 * Здесь, внутри ядра, форма как раз известна, поэтому конвейер возвращает
 * уточнённый тип: читатель ядра работает с настоящими `DatasetAnalysis` и
 * `RecalculatedMetrics` без приведения типов, а внешний читатель по-прежнему
 * видит честное «разберись сам».
 */
export interface PipelineSnapshot extends DataSnapshot {
  recalcResults?: Record<string, RecalculatedMetrics>;
  datasetAnalyses?: Record<string, DatasetAnalysis>;
}

export function runPipeline(input: PipelineInput): PipelineSnapshot {
  const asOf = input.asOf === undefined ? new Date() : input.asOf;
  if (!(asOf instanceof Date) || !Number.isFinite(asOf.getTime())) throw new Error('INVALID_SNAPSHOT_AS_OF');
  const pipelineStart = Date.now();
  const snapshotId = nanoid();

  // 1. Ingest: официальные ячейки
  const ingestResult = ingestBatchGetResponse(input.batchGetData, input.reportMap);

  const ingestEnded = Date.now();

  // 2. Normalize: официальные метрики
  const officialMetrics = normalizeMetrics(ingestResult.cells, input.reportMap);

  const normalizeEnded = Date.now();

  // 3. Classify + Validate: построчно по листам
  const allIssues: Issue[] = [];
  const checkCoverage: TrustCheckCoverage[] = [];
  let totalRows = 0;
  const perSheetRowCount: Record<string, number> = {};
  const calculatedMetrics = new Map<string, NormalizedMetric>();
  const recalcResults: Record<string, RecalculatedMetrics> = {};
  const calculatedDepartments: DepartmentCalculation[] = [];
  let sourceRowOffset = 0;
  // Сигналы строк по ГРБС — один прогон detectSignals на лист (блок А п.3),
  // переиспользуются в dataset-анализе 4b.
  const sheetSignalsByDept: Record<string, ReturnType<typeof detectSheetSignals>> = {};
  const engine = new CalcEngine();

  for (const [sheetName, rows] of Object.entries(input.sheetRows)) {
    const deptId = sheetDeptId(sheetName); // null = не-ГРБС лист (СВОД/служебный)
    const ingested = ingestSheetRows(rows);
    const classified = classifyRows(sheetName, ingested);
    totalRows += classified.length;
    perSheetRowCount[sheetName] = classified.length;

    // Валидация строк
    const sheetIssues = validateData(officialMetrics, classified, input.rules, input.reportMap, asOf, checkCoverage);
    allIssues.push(...sheetIssues);

    // Signal detection + CalcEngine only for department sheets (СВОД has
    // different column layout). deptId === null — лист не из реестра ГРБС:
    // аналитика честно пропускается (канон attachUnifiedGrid), а не
    // вешается на фантомный lowercase-идентификатор.
    if (sheetName !== SVOD_SHEET_NAME && deptId !== null) {
      // Геометрия шапки проверяется ПЕРВОЙ: если столбцы съехали, все числа
      // ниже посчитаны не из тех колонок, и об этом надо сказать прежде,
      // чем показывать их как показатели управления (реестр багов
      // 09.07.2026, п.11).
      const headerIssue = headerGeometryIssue(sheetName, deptId, rows as unknown[][]);
      if (headerIssue) allIssues.push(headerIssue);

      // Сигналы строк считаются ОДИН раз на лист (блок А п.3): отсюда же
      // их берёт dataset-анализ 4b — второго прогона detectSignals нет.
      const signalFailures: number[] = [];
      const sheetSignals = detectSheetSignals(rows as unknown[][], asOf,
        sheetRow => signalFailures.push(sheetRow));
      sheetSignalsByDept[deptId] = sheetSignals;
      const signalIssues = detectSignalsToIssues(sheetName, sheetSignals, deptId);
      allIssues.push(...signalIssues);
      // A detector exception is an incomplete analysis, NOT a clean signal row.
      // One bounded issue per book keeps the original rows/other signals intact.
      if (signalFailures.length > 0) {
        allIssues.push({
          id: issueIdentity(['signal-detection-failed', sheetName]),
          severity: 'error',
          origin: 'runtime_error',
          category: 'signal_detection_failed',
          title: `Проверка сигналов книги «${sheetName}» выполнена не полностью`,
          description: `Детектор сигналов не смог проверить ${signalFailures.length} строк (первая: ${signalFailures[0]}). Отсутствие других замечаний по ним не означает успешную проверку.`,
          sheet: sheetName,
          row: signalFailures[0],
          departmentId: deptId,
          recommendation: 'Проверить ошибку разбора сигналов и повторить проверку; не изменять книгу автоматически.',
          status: 'open',
          detectedAt: asOf.toISOString(),
          detectedBy: 'pipeline:signals',
        });
      }

      // Целостность формул книги — судится НОСИТЕЛЬ (ячейка формульной графы),
      // а не смысл строки, поэтому отдельным слоем. Слой сам молчит, когда
      // формул не читали; `startRow: 1` — договор чтения: обе сетки начинаются
      // с первой строки листа (google-sheets.ts, DeptSheetResult.startRow).
      allIssues.push(...formulaIntegrityIssues({
        book: sheetName,
        values: rows as unknown[][],
        formulas: input.sheetFormulas?.[sheetName] ?? [],
        startRow: 1,
      }, deptId, checkCoverage));

      // Аналитический пересчёт из строк через CalcEngine (filter by target year to match СВОД scope)
      const grouped = engine.compute(rows as unknown[][], standardRowFilter, 3, input.targetYear, {
        asOfDay: productCalendarDay(asOf, PRODUCT_UTC_OFFSET_HOURS),
      });
      // Строки, не дошедшие до счёта, обязаны быть названы (реестр багов
      // 09.07.2026, п.6): счётчик droppedRows появился, но его никто не читал —
      // молчание осталось прежним.
      const dropIssue = droppedRowsIssue(
        sheetName,
        deptId,
        grouped.droppedRows,
        (rows as unknown[][]).length - DEPT_HEADER_ROWS - grouped.emptyRows,
        grouped.droppedRowNumbers,
      );
      if (dropIssue) allIssues.push(dropIssue);
      const recalc = adaptToRecalcMetrics(grouped, sheetName);
const calculation = { departmentId: deptId, grouped, rowOffset: sourceRowOffset };
       projectDepartmentMetrics(calculatedMetrics, calculation, asOf.toISOString());
       calculatedDepartments.push(calculation);
       sourceRowOffset += rows.length;
      recalcResults[deptId] = recalc;
    }
  }

  // Добавляем ошибки ингеста (стабильный id: ячейка + порядковый номер дубля)
  const ingestOcc = new Map<string, number>();
  for (const err of ingestResult.errors) {
    allIssues.push({
      id: issueIdentity(['ingest', err.cell, nextOccurrence(ingestOcc, String(err.cell))]),
      severity: 'significant',
      origin: 'runtime_error',
      category: 'ingest_error',
      title: `Ошибка чтения: ${err.cell}`,
      description: err.error,
      status: 'open',
      detectedAt: ingestResult.readAt,
      detectedBy: 'pipeline:ingest',
    });
  }

  // 4b. Dataset-level signal analysis (Benford, Z-score, composite score, noise map)
  const datasetAnalyses: Record<string, DatasetAnalysis> = {};
  for (const [sheetName, rows] of Object.entries(input.sheetRows)) {
    if (sheetName === SVOD_SHEET_NAME) continue;
    const deptId = sheetDeptId(sheetName);
    if (deptId === null) continue; // не-ГРБС лист — честный пропуск (п.4)
    const recalc = recalcResults[deptId];
    if (!recalc) continue;

    // Сигналы строк уже собраны в основном цикле (detectSheetSignals) —
    // здесь только проекция Map<row, signals> без второго прогона.
    const rowSignals = new Map<number, RowSignals>();
    for (const [r, v] of sheetSignalsByDept[deptId] ?? new Map()) {
      rowSignals.set(r, v.signals);
    }
    const sheetRows = rows as unknown[][];

    datasetAnalyses[deptId] = analyzeDataset({
      rows: sheetRows,
      rowSignals,
      execCountPct: recalc.year.execCountPct,
      epSharePct: recalc.epSharePct,
    });
  }

  // 4c. Aggregate summary-level calculated metrics (competitive.*, sole.*)
  // These sum across all departments to match REPORT_MAP summary keys.
  projectDistrictMetrics(calculatedMetrics, calculatedDepartments, asOf.toISOString());

  // 5. Delta — со знанием периметра обеих сторон (Д21): несравнимые пары
  // не превращаются в дельту, а объясняют, почему сверки нет.
  const deltaStarted = Date.now();
  const deltas = computeDeltas(officialMetrics, calculatedMetrics, input.reportMap, {
    calcYear: input.targetYear,
    officialYear: input.officialYear,
  });

  const deltaEnded = Date.now();

  // 6. Trust
  const trust = computeTrustScore(officialMetrics, allIssues, deltas, snapshotId, checkCoverage);

  const trustEnded = Date.now();

  // 7. Атомы для честной истории: снимок несёт строки книг ГРБС без шапки и
  // распарсенную официальную сетку СВОД — из УЖЕ прочитанных input.sheetRows,
  // без второго чтения. Отчёт прошлой недели строится из этих полей снимка.
  // Пусто (листы не читались) → поля честно отсутствуют, а не лежат пустышками.
  const rowsByDept = collectRowsByDept(input.sheetRows);
  const svodGrid = parseSvodGrid(input.sheetRows[SVOD_SHEET_NAME] ?? []);

  return {
    id: snapshotId,
    spreadsheetId: input.spreadsheetId,
    createdAt: asOf.toISOString(),
    officialMetrics: Object.fromEntries(officialMetrics),
    calculatedMetrics: Object.fromEntries(calculatedMetrics),
    deltas,
    issues: allIssues,
    trust,
    rowCount: totalRows,
    recalcResults,
    datasetAnalyses,
    ...(Object.keys(rowsByDept).length > 0 ? { rowsByDept } : {}),
    ...(svodGrid.length > 0 ? { svodGrid } : {}),
    metadata: {
      sheetsRead: ingestResult.sheets,
      cellsRead: ingestResult.cells.size,
      readDurationMs: ingestResult.durationMs,
      pipelineDurationMs: Math.max(0, Date.now() - pipelineStart),
      timings: { ingestMs: Math.max(0, ingestEnded - pipelineStart), officialNormalizeMs: Math.max(0, normalizeEnded - ingestEnded),
        checksAndCalculationMs: Math.max(0, deltaStarted - normalizeEnded), deltaMs: Math.max(0, deltaEnded - deltaStarted),
        trustMs: Math.max(0, trustEnded - deltaEnded) },
      targetYear: input.targetYear ?? null,
      perSheetRowCount,
    },
  };
}

// ────────────────────────────────────────────────────────────
// Геометрия шапки книги ГРБС
// ────────────────────────────────────────────────────────────

/**
 * Замечание о съехавшей раскладке столбцов, либо null, если якоря шапки на
 * месте (реестр багов 09.07.2026, п.11 «позиционное чтение колонок без
 * проверки геометрии»).
 *
 * Механизм: весь расчёт читает ячейки по номеру колонки. Вставили столбец —
 * и план берётся из способа закупки, дата из бюджета, а числа при этом
 * остаются числами, поэтому ни одна арифметическая проверка сдвига не видит.
 * Единственный признак — подписи шапки (третья строка книги), сверенные с
 * каноном раскладки.
 */
function headerGeometryIssue(
  sheetName: string,
  deptId: string,
  rows: unknown[][],
): Issue | null {
  const mismatches = checkDeptHeaderGeometry(rows);
  if (mismatches.length === 0) return null;
  const shown = mismatches
    .map(m => `«${m.expected}» ожидается в столбце ${m.column}, а стоит в ${m.foundAt}`)
    .join('; ');
  return {
    id: issueIdentity(['header-geometry', sheetName]),
    severity: 'critical',
    origin: 'runtime_error',
    category: 'header_geometry',
    group: 'data_quality',
    title: `Столбцы листа «${sheetName}» съехали: опорных подписей не на своём месте — ${mismatches.length}`,
    description:
      `В третьей строке листа опорные подписи стоят не в своих столбцах: ${shown}. ` +
      'Так выглядит вставленный или удалённый столбец. Расчёт читает ячейки по номеру ' +
      'столбца, поэтому после сдвига суммы плана берутся из соседней графы, а даты — из ' +
      'бюджетов; числа при этом остаются правдоподобными, и арифметика подмены не замечает.',
    sheet: sheetName,
    departmentId: deptId,
    recommendation:
      'Открыть лист и вернуть столбцы в эталонный порядок (A — № п/п, C — подведомственное учреждение, ' +
      'G — предмет контракта, K — итого плана, L — способ определения поставщика, O и P — квартал и год плана, ' +
      'Y — итого факта, AD — учитывать в расчёте экономии). Пока раскладка не восстановлена, показатели ' +
      'этого управления считать нельзя.',
    status: 'open',
    detectedAt: new Date().toISOString(),
    detectedBy: 'pipeline:header-geometry',
  };
}

// ────────────────────────────────────────────────────────────
// Строки, не дошедшие до счёта
// ────────────────────────────────────────────────────────────

/**
 * Порог, за которым отсев строк перестаёт быть бытовым и становится поводом
 * для разговора: доля отсеянных от числа строк данных листа.
 *
 * Реестр багов 09.07.2026, п.6 «CalcEngine молча дропает строки при провале
 * классификации»: счётчик `droppedRows` в движок добавили, но за пределами
 * его собственного теста к нему никто не обращался — сдвиг колонок или
 * сломанный разбор по-прежнему не подавали голоса. Ниже — тот самый
 * «порог-сигнал», которого не хватало.
 *
 * Разделители и пустые вставки между блоками листа — обычное дело, поэтому
 * замечание не выносится, пока отсев не набрал разом и заметную долю, и
 * ощутимое число строк: одна пустая строка на маленьком листе — не событие.
 */
const DROPPED_ROWS_SHARE_THRESHOLD = 0.1;
const DROPPED_ROWS_MIN_COUNT = 5;
/** Доля, при которой речь идёт уже не о мусоре в данных, а о сломанном разборе. */
const DROPPED_ROWS_BROKEN_SHARE = 0.5;

/**
 * Замечание о строках, отсеянных до накопления метрик, либо null, если отсев
 * укладывается в житейскую норму.
 *
 * Считаются только строки, отвергнутые классификацией (или пустые слоты);
 * строки чужого года движок в этот счётчик не пишет — там отбор по сроку, а
 * не поломка (см. GroupedResults.droppedRows).
 */
function droppedRowsIssue(
  sheetName: string,
  deptId: string,
  droppedRows: number,
  dataRowCount: number,
  droppedRowNumbers: readonly number[] = [],
): Issue | null {
  if (dataRowCount <= 0 || droppedRows < DROPPED_ROWS_MIN_COUNT) return null;
  const share = droppedRows / dataRowCount;
  if (share < DROPPED_ROWS_SHARE_THRESHOLD) return null;

  const broken = share >= DROPPED_ROWS_BROKEN_SHARE;
  const percent = (share * 100).toFixed(1).replace('.', ',');
  // Ответ «какие именно строчки» обязан быть в самой карточке (п.119, вопрос
  // владельца 20.08 по УАГЗО): адреса первых отвергнутых строк листа.
  const addresses = droppedRowNumbers.length > 0
    ? ` Первые из них — строки листа ${droppedRowNumbers.join(', ')}${droppedRows > droppedRowNumbers.length ? ` и ещё ${droppedRows - droppedRowNumbers.length}` : ''}.`
    : '';
  return {
    id: issueIdentity(['dropped-rows', sheetName]),
    severity: broken ? 'significant' : 'warning',
    origin: 'runtime_error',
    category: 'dropped_rows',
    group: 'data_quality',
    title: `Строки листа «${sheetName}» не попали в расчёт: ${droppedRows} из ${dataRowCount}`,
    description: (broken
      ? `Расчёт отверг ${percent} % заполненных строк листа — столько сразу отсеивается, когда колонки сдвинуты (вставили или убрали столбец) либо лист прочитан не с той вкладки. Показатели управления в таком виде считать нельзя.`
      : `Расчёт отверг ${percent} % заполненных строк листа: в них не хватает опознавательных признаков закупки (номер, предмет, способ, суммы). В показатели эти строки не вошли. Пустые строки листа отсевом не считаются.`)
      + addresses,
    sheet: sheetName,
    departmentId: deptId,
    recommendation: broken
      ? 'Сверить шапку листа с эталонной раскладкой столбцов (A — № п/п, G — предмет, K — итого плана, L — способ) и убедиться, что читается нужная вкладка книги.'
      : 'Открыть перечисленные строки листа: это записи без номера, предмета и способа закупки — либо дозаполнить, либо убрать, если это остатки разметки.',
    status: 'open',
    detectedAt: new Date().toISOString(),
    detectedBy: 'pipeline:calc-engine',
  };
}

// ────────────────────────────────────────────────────────────
// Signal → Issue conversion
// ────────────────────────────────────────────────────────────

/** Build signal→metadata map from CHECK_REGISTRY (single source of truth) */
const SIGNAL_ISSUE_MAP: Record<string, {
  severity: Issue['severity']; title: string; recommendation: string;
  checkId: string; group: string; kbHint: string;
}> = (() => {
  const map: Record<string, { severity: Issue['severity']; title: string; recommendation: string; checkId: string; group: string; kbHint: string }> = {};
  // Map legacy signal keys → CHECK_REGISTRY entries
  for (const [signalKey, checkId] of Object.entries(LEGACY_SIGNAL_TO_CHECK)) {
    const check = CHECK_REGISTRY.find(c => c.id === checkId);
    if (check) {
      map[signalKey] = {
        severity: check.severity as Issue['severity'],
        title: check.name,
        recommendation: check.recommendation,
        checkId: check.id,
        group: check.group,
        kbHint: check.kbHint,
      };
    }
  }
  // financeDelay теперь в CHECK_REGISTRY → маппится автоматически через LEGACY_SIGNAL_TO_CHECK
  return map;
})();

/**
 * Один прогон detectSignals на лист (блок А п.3 пирамиды): раньше сигналы
 * считались дважды — здесь для замечаний и второй раз в 4b для
 * dataset-анализа. Семантика сбора — как у 4b (все парсабельные строки);
 * фильтр мета-/пустых строк остаётся на стороне замечаний.
 */
export function detectSheetSignals(
  rows: unknown[][],
  asOf: Date,
  onFailure: (physicalRow: number) => void = () => undefined,
  detector: typeof detectSignals = detectSignals,
): Map<number, { cells: Record<string, unknown>; signals: RowSignals }> {
  const out = new Map<number, { cells: Record<string, unknown>; signals: RowSignals }>();
  for (let r = DEPT_HEADER_ROWS; r < rows.length; r++) {
    const row = rows[r];
    // Intentional service/header/short note rows are outside the detector's
    // scope; don't report them as failed purchases.
    if (!Array.isArray(row) || row.length < 5) continue;
    const cells = buildCellDict(row);
    try {
      out.set(r, { cells, signals: detector(cells, asOf) });
    } catch {
      // Preserve the physical 1-based Sheets row; dataset analysis must not
      // silently treat the missing signal entry as 'no signals'.
      onFailure(r + 1);
    }
  }
  return out;
}

function detectSignalsToIssues(
  sheetName: string,
  sheetSignals: Map<number, { cells: Record<string, unknown>; signals: RowSignals }>,
  deptId: string,
): Issue[] {
  const signalOcc = new Map<string, number>();
  const issues: Issue[] = [];
  const now = new Date().toISOString();

  for (const [r, { cells, signals }] of sheetSignals) {
    // Skip non-data rows: summaries ("Итого"/"Всего"), separators
    const nameCell = String(cells['C'] ?? cells['D'] ?? '').trim();
    if (isMetaRow(nameCell)) continue;
    // Skip rows where all cells are empty (separators)
    const allEmpty = Object.values(cells).every(v => v === null || v === undefined || v === '');
    if (allEmpty) continue;

    const subject = String(cells['G'] ?? cells['D'] ?? '').slice(0, 80);
    // Column C = subordinate org; пусто/плейсхолдер = само управление (канон @aemr/shared)
    const subordinateId = subordinateKey(cells['C']);

    for (const [signalKey, meta] of Object.entries(SIGNAL_ISSUE_MAP)) {
      if (signals[signalKey as keyof RowSignals] !== true) continue;
      // Класс самой строки может гасить претензию по другому её признаку —
      // канон живёт в @aemr/shared (issueSuppressedByRowClass), а не здесь:
      // замечания рождаются ещё и на сервере, и второе место обязано судить
      // тем же правилом. Сегодня правило одно — инициативная заявка не идёт
      // в риск-списки (решение владельца п.137(3) от 21.08.2026).
      if (issueSuppressedByRowClass(signalKey, signals as unknown as Record<string, boolean>)) continue;

      // Стабильный id: содержимое строки-якоря (A/B/G/K + подвед C), не её номер.
      const idBase = ['signal', meta.checkId, sheetName, String(cells['C'] ?? ''), String(cells['A'] ?? ''), String(cells['B'] ?? ''), String(cells['G'] ?? ''), String(cells['K'] ?? '')] as const;
      // Строгость ЕП-риска — свойство СТРОКИ, а не ключа: развилка по степени
      // обоснованности (решение владельца п.137(2) от 21.08.2026). Дом правила
      // один и лежит в @aemr/shared: замечание конвейера, чип Реестра и
      // проверка источника на сервере обязаны звать одну функцию, иначе список
      // критических разойдётся с цветом чипов на экране.
      const epContext = { dept: deptId, id: cells['A'], subject: cells['G'], method: cells['L'],
        factDateRaw: cells['Q'], planDateRaw: cells['N'], factSum: sheetNumber(cells['Y']) ?? undefined, amountBasis: 'position-total' as const, planYear: sheetNumber(cells.P) ?? undefined,
        necessityJustification: cells.AE, commentGRBS: cells.AF };
      const annualAggregate = signalKey === 'epRisk' && isAnnualEpAggregate(epContext);
      // Nonempty UNMAPPED is a proven dictionary limitation, not employee misconduct.
      // Reuse the existing diagnostic classification while preserving this case's stable ID.
      const dictionaryUncertainty = signalKey === 'epRisk' && typeof cells.M === 'string'
        && cells.M.trim().length > 0
        && canonicalizeReasonEp(cells.M.slice(0, EP_REASON_SCAN_LIMIT)).cluster === 'UNMAPPED';
      const amountUncertainty = signalKey === 'epRisk' && epContext.amountBasis === 'position-total' && !annualAggregate;
      const classification = dictionaryUncertainty ? SIGNAL_ISSUE_MAP.unmappedReasonEP
        : amountUncertainty ? { ...meta, group: 'completeness' as const } : meta;
      const severity: Issue['severity'] = signalKey === 'epRisk'
        ? epRiskStrictnessOfReason(cells['M'], epContext)
        : signalKey === 'futureFactDate' ? futureFactDateSeverity(epContext) : meta.severity;
      issues.push({
        id: issueIdentity([...idBase, nextOccurrence(signalOcc, idBase.join(SEP))]),
        severity,
        origin: dictionaryUncertainty || amountUncertainty ? 'mapping_error' : 'bi_heuristic',
        category: `signal:${signalKey}`,
        signal: signalKey,
        group: classification.group,
        checkId: classification.checkId,
        kbHint: amountUncertainty ? epRiskReviewDetails(cells.M, epContext).explanation : classification.kbHint,
        title: `${annualAggregate ? EP_ANNUAL_AMOUNT_TITLE : signalKey === 'epRisk' && severity === 'warning' ? epRiskReviewDetails(cells.M, epContext).title : meta.title}: ${subject || `строка ${r + 1}`}`,
        // Ошибка формулы адресуется до ячейки: «в строке где-то #REF» не
        // проверить, «K12 = #ЗНАЧ!» — открыл и увидел (страж 29.08.2026).
        description: `${sheetName}, строка ${r + 1}${subject ? `: ${subject}` : ''}${
          signalKey === 'formulaBroken'
            ? ` — ${formulaErrorCells(cells).map(c => `${c.column}${r + 1} = ${c.value.length > 40 ? `${c.value.slice(0, 40)}…` : c.value}`).join(', ')}`
            : ''
        }`,
        sheet: sheetName,
        row: r + 1,
        // «№ п/п» (колонка A) — стабильный второй адрес: строки листа
        // двигаются, позиционный row на момент сборки устаревает (п.98б).
        rowSeq: String(cells['A'] ?? '').trim() || undefined,
        departmentId: deptId,
        subordinateId,
        recommendation: annualAggregate ? EP_ANNUAL_AMOUNT_EXPLANATION : signalKey === 'epRisk' && severity === 'warning' ? epRiskReviewDetails(cells.M, epContext).explanation : meta.recommendation,
        status: 'open',
        detectedAt: now,
        detectedBy: `pipeline:signal:${signalKey}`,
      });
    }
  }

  return issues;
}
