/**
 * buildReport — чистая проекция «снапшот → страница "Отчёт"» (фаза 1.4-1.5,
 * спека docs/superpowers/specs/2026-07-13-report-2-0-product-design.md §5).
 *
 * Никакой собственной счётной семантики: все числа идут каноническими путями —
 *   - исполнение квартала: quarterExecution (G = E/D, эталон отчёта 20.03.2026);
 *   - суммы/разрезы: CalcEngine.compute + standardRowFilter (тот же движок,
 *     который crossVerifyQuarterly сверяет со СВОД, сходимость 528/528);
 *   - экономия: метрики economy_* с гейтом AD='да' + дата факта (канон
 *     approvedEconomy);
 *   - официал: parseSvodGrid-блоки листа СВОД ТД-ПМ как есть (origin 'svod').
 *
 * Детерминизм: Date.now запрещён — срез задаётся opts (year/quarter/asOfDay).
 */

import {
  DEPARTMENT_REGISTRY,
  DEPT_COLUMNS,
  DEPT_HEADER_ROWS,
  type DepartmentEntry,
  canonicalizeDeviation,
  canonicalizeReasonEp,
  extractForecastDate,
  dayNumberOf,
  DEVIATION_DICT,
  EP_REASON_DICT,
  factCountsOn,
  findDept,
  svodCellRef,
  toNumber,
  type Issue,
  type IssueSeverity,
  type SvodGridBlock,
  type SvodSheetExtras,
} from '@aemr/shared';
import {
  CalcEngine,
  classifyMethodGroup,
  getValue,
  standardRowFilter,
  type GroupedResults,
  type RawRow,
} from '../pipeline/calc-engine.js';
import { quarterExecutionFromCounts } from '../metrics/quarter-execution.js';
import type {
  BudgetMoney,
  GrbsQuarterSlice,
  GrbsReportBlock,
  IntegralSummary,
  MethodSplit,
  PendingPosition,
  PendingRemainder,
  RecommendationPair,
  LifecycleBreakdown,
  LifecycleBucket,
  ReasonBreakdown,
  ReasonBucket,
  PlanFactCounts,
  Report,
  ReportOrigin,
  ReportSignal,
} from './types.js';

// ── Вход ─────────────────────────────────────────────────────────────

export interface BuildReportInput {
  /**
   * Строки-атомы ГРБС-книг (0-based колонки DEPT_COLUMNS, без шапки).
   * Ключ — идентификатор ГРБС: короткое имя («УЭР») или latinId («uer»)
   * из DEPARTMENT_REGISTRY.
   */
  rowsByDept: Record<string, RawRow[]>;
  /** Разобранный лист СВОД ТД-ПМ (parseSvodGrid) — официал для сверки-колонки. */
  svodGrid?: SvodGridBlock[];
  /** Итоговый ярус того же листа (parseSvodExtras) — остаток и расч. экономия. */
  svodExtras?: SvodSheetExtras;
  /** Замечания снапшота — источник топ-сигналов блоков ГРБС. */
  issues?: Issue[];
}

export interface BuildReportOptions {
  /** План-год среза (столбец P). */
  year: number;
  /** Отчётный квартал (столбец O). */
  quarter: 1 | 2 | 3 | 4;
  /**
   * Номер суток среза (dayNumberOf-совместимый) — вместо Date.now.
   *
   * НЕ ЗАДАН = ПРЯМОЙ ЭФИР, факт как есть «на сейчас» (канон пользователя
   * 27.07: отчётные даты — про хранение данных, живую ситуацию видим в
   * эфире). Задан = архивный срез недели: факт, заключённый позже, не
   * считается — снимок обязан оставаться неизменным.
   */
  asOfDay?: number;
}

// ── Внутренние помощники ─────────────────────────────────────────────

/** Stateless-движок (как в quarter-execution.ts): compute() без состояния. */
const ENGINE = new CalcEngine();

/** Порядок критичности для отбора топ-сигналов (меньше = важнее). */
const SEVERITY_RANK: Record<IssueSeverity, number> = {
  critical: 0,
  error: 1,
  significant: 2,
  warning: 3,
  info: 4,
};

function planFact(planCount: number, doneCount: number, origin: ReportOrigin): PlanFactCounts {
  // pct — та же формула G = E/D (канон quarterExecutionFromCounts: D=0 → null).
  return { planCount, doneCount, pct: quarterExecutionFromCounts(planCount, doneCount).pct, origin };
}

/** Плановые кварталы: год считается ТОЛЬКО по ним (правила счёта §2). */
const QUARTERS = [1, 2, 3, 4] as const;

/**
 * Метрика за год = сумма четырёх плановых кварталов.
 *
 * Канон правил счёта §2: строка входит в план года, только если у неё задан
 * плановый квартал O ∈ 1..4, — ручной отчёт печатает год именно так
 * (140+125+107+24 = 396 конкурентных на 26.06.2026). Негруппированный итог
 * движка (`getValue(g, key)` без группы) сюда не годится: он тянет и строки
 * без квартала — на 26.06.2026 это 430 лишних строк, годовой план 475 вместо
 * 396, и вслед за завышенным знаменателем врало «исполнение годового плана».
 */
function sumOverQuarters(g: GroupedResults, metric: string, method?: 'competitive' | 'ep'): number {
  const suffix = method ? `.${method}` : '';
  return QUARTERS.reduce((s, q) => s + getValue(g, metric, `q${q}${suffix}`), 0);
}

/** План/факт года по счётчикам движка — тем же правилом, что и кварталы. */
function yearCountsOf(g: GroupedResults): PlanFactCounts {
  return planFact(sumOverQuarters(g, 'plan_count'), sumOverQuarters(g, 'fact_count'), 'calc');
}

/** Денежная тройка ФБ/КБ/МБ из метрик prefix_fb/kb/mb (+ total по сумме). */
function moneyOf(
  g: GroupedResults,
  prefix: 'plan' | 'fact' | 'economy',
  group?: string,
): BudgetMoney {
  const fb = getValue(g, `${prefix}_fb`, group);
  const kb = getValue(g, `${prefix}_kb`, group);
  const mb = getValue(g, `${prefix}_mb`, group);
  // total как сумма тройки — инвариант бюджета (§5.1) выполняется по построению;
  // канонические prefix_total у plan/fact включают K/Y-fallback и могут
  // расходиться с тройкой при кривых итогах листа — отчёт показывает сходящееся.
  return { fb, kb, mb, total: fb + kb + mb, origin: 'calc' };
}

/**
 * Деньги квартала в разрезе способа — те самые тройки ручного отчёта
 * («…на общую сумму X тыс. руб. (ФБ — …, КБ — …, МБ — …)» отдельно по
 * конкурентным и по ЕП). Движок раскладывает все метрики в группы
 * `qN.competitive`/`qN.ep` — выгрузка печатала плашку «продукт пока не
 * считает» ровно там, где числа уже считались.
 */
function methodMoneyOf(g: GroupedResults, qGroup: string): GrbsQuarterSlice['moneyByMethod'] {
  return {
    kp: {
      plan: moneyOf(g, 'plan', `${qGroup}.competitive`),
      fact: moneyOf(g, 'fact', `${qGroup}.competitive`),
    },
    ep: {
      plan: moneyOf(g, 'plan', `${qGroup}.ep`),
      fact: moneyOf(g, 'fact', `${qGroup}.ep`),
    },
  };
}

/**
 * Остаток группы: незаключённое в ПЛАНОВЫХ деньгах (правила счёта §4).
 * Метрики движка pending_* уже несут гейт GATE_NO_FACT — своего чтения
 * колонок здесь нет, иначе завелась бы вторая семантика остатка.
 */
function pendingOf(g: GroupedResults, group?: string): PendingRemainder {
  return {
    count: getValue(g, 'pending_count', group),
    fb: getValue(g, 'pending_fb', group),
    kb: getValue(g, 'pending_kb', group),
    mb: getValue(g, 'pending_mb', group),
    total: getValue(g, 'pending_total', group),
  };
}

/** Ключ ГРБС входа → запись реестра (короткое имя, latinId или имя листа). */
function resolveDept(key: string): DepartmentEntry | undefined {
  // findDept — канонический lookup id/latinId; sheetName добираем сканом.
  return findDept(key) ?? DEPARTMENT_REGISTRY.find((d) => d.sheetName === key);
}

/** Официальный КП/ЕП-срез квартала из блоков СВОД для данного scope. */
function svodSplit(
  grid: SvodGridBlock[],
  scope: string,
  quarter: number,
  year: number,
): MethodSplit | undefined {
  const pick = (method: 'КП' | 'ЕП'): PlanFactCounts | undefined => {
    const period = grid
      .find((b) => b.scope === scope && b.method === method)
      ?.periods.find((p) => p.quarter === quarter && p.year === year);
    return period ? planFact(period.planCount, period.factCount, 'svod') : undefined;
  };
  const kp = pick('КП');
  const ep = pick('ЕП');
  if (!kp && !ep) return undefined;
  return { kp: kp ?? planFact(0, 0, 'svod'), ep: ep ?? planFact(0, 0, 'svod') };
}

/**
 * Официальные деньги плана-года скоупа: строка «ИТОГО 2026:» яруса листа
 * (parseSvodExtras). Итог у листа один на скоуп — КП и ЕП вместе, ровно то,
 * что печатает ручной отчёт как «Лимит средств, всего». Ячейки — колонки
 * ИТОГО той же строки: провенанс до ячейки, число проверяемо одним кликом.
 */
function svodYearMoneyOf(
  extras: SvodSheetExtras | undefined,
  scope: string,
): GrbsReportBlock['svodYearMoney'] {
  const t = extras?.scopes.find((s) => s.scope === scope)?.totalY2026;
  if (!t) return undefined;
  const money = (fb: number, kb: number, mb: number, total: number): BudgetMoney =>
    ({ fb, kb, mb, total, origin: 'svod' });
  return {
    plan: money(t.planFB, t.planKB, t.planMB, t.planTotal),
    fact: money(t.factFB, t.factKB, t.factMB, t.factTotal),
    economy: money(t.economyFB, t.economyKB, t.economyMB, t.economyTotal),
    cells: {
      plan: svodCellRef(t.row, 'planTotal'),
      fact: svodCellRef(t.row, 'factTotal'),
      economy: svodCellRef(t.row, 'economyTotal'),
    },
  };
}

/**
 * Счётные строки без года плана (P пусто, включая заглушки «Х»/«-»):
 * гейт тот же, что у сигнала planYearMissing — способ есть, плановые
 * деньги есть. Наш движок относит такие строки к отчётному году, формулы
 * СВОДа — нет; их сумма и есть расхождение лимита расчёт/лист.
 */
function noYearRowsOf(rows: RawRow[]): GrbsReportBlock['noYearRows'] {
  let count = 0;
  let total = 0;
  for (const row of rows) {
    if (!standardRowFilter(row)) continue;
    const yearText = String(row[DEPT_COLUMNS.PLAN_YEAR] ?? '').trim().toLowerCase();
    if (yearText !== '' && yearText !== 'х' && yearText !== 'x' && yearText !== '-') continue;
    const planTotal = rowPlanTotal(row);
    if (planTotal <= 0) continue;
    // Гейта по способу нет НАРОЧНО: и движок, и формулы листа считают
    // строки с пустым L (лист — в блоке КП через L<>"ЕП"), поэтому для
    // объяснения расхождения лимита важен только год.
    count += 1;
    total += planTotal;
  }
  return count > 0 ? { count, total } : undefined;
}

/** Адреса ячеек листа, из которых взят официальный срез — провенанс числа. */
function svodCellRefs(
  grid: SvodGridBlock[],
  scope: string,
  quarter: number,
  year: number,
): GrbsQuarterSlice['svodCells'] {
  const rowOf = (method: 'КП' | 'ЕП'): number | undefined =>
    grid
      .find((b) => b.scope === scope && b.method === method)
      ?.periods.find((p) => p.quarter === quarter && p.year === year)?.row;
  const kpRow = rowOf('КП');
  const epRow = rowOf('ЕП');
  if (kpRow === undefined || epRow === undefined) return undefined;
  return {
    kp: { plan: svodCellRef(kpRow, 'planCount'), fact: svodCellRef(kpRow, 'factCount') },
    ep: { plan: svodCellRef(epRow, 'planCount'), fact: svodCellRef(epRow, 'factCount') },
  };
}

/**
 * Сигналы ГРБС: только свои, по критичности, ЦЕЛИКОМ — обрезку до топ-N
 * делает UI (закон «топ-N раскрывается»), проекция выборку не режет.
 * Каждый сигнал несёт полный текст и адрес первички.
 */
function signalsFor(issues: Issue[], entry: DepartmentEntry | undefined, key: string): ReportSignal[] {
  const own = new Set([key, entry?.id, entry?.latinId].filter((v): v is string => Boolean(v)));
  return issues
    .filter((i) => i.departmentId !== undefined && own.has(i.departmentId))
    .sort((a, b) => (SEVERITY_RANK[a.severity] ?? 9) - (SEVERITY_RANK[b.severity] ?? 9))
    .map((i) => ({
      id: i.id,
      severity: i.severity,
      title: i.title,
      description: i.description,
      ...(i.sheet !== undefined ? { sheet: i.sheet } : {}),
      ...(i.cell !== undefined ? { cell: i.cell } : {}),
      ...(i.row !== undefined ? { row: i.row } : {}),
      ...(i.recommendation !== undefined ? { recommendation: i.recommendation } : {}),
    }));
}


/** Пояснительные колонки листа с человеческими подписями (порядок показа). */
const EXPLANATION_COLS: ReadonlyArray<{ col: number; label: string }> = [
  { col: DEPT_COLUMNS.DEVIATION_REASON, label: 'Причина отклонения' },
  { col: DEPT_COLUMNS.JUSTIFICATION, label: 'Обоснование необходимости' },
  { col: DEPT_COLUMNS.EP_REASON, label: 'Основание выбора ЕП' },
  { col: DEPT_COLUMNS.COMMENT_GRBS, label: 'Комментарий ГРБСа' },
  { col: DEPT_COLUMNS.COMMENT_UER, label: 'Комментарий УЭР' },
  { col: DEPT_COLUMNS.COMMENT_UFBP, label: 'Комментарий УФБП' },
];

/** Число листа по канону shared (toNumber), пусто/мусор — 0. */
const cellNum = (v: unknown): number => toNumber(v) ?? 0;

/** Плановая сумма строки: ИТОГО, либо ФБ+КБ+МБ при пустом итоге. */
const rowPlanTotal = (row: RawRow): number =>
  cellNum(row[DEPT_COLUMNS.TOTAL_PLAN])
  || cellNum(row[DEPT_COLUMNS.FB_PLAN]) + cellNum(row[DEPT_COLUMNS.KB_PLAN]) + cellNum(row[DEPT_COLUMNS.MB_PLAN]);

/**
 * Незаключённые позиции квартала с пояснениями из листа. Гейты — каноны
 * движка: строка проходит standardRowFilter, плановый квартал = отчётный,
 * год нестрогий (строки без года не теряются), дата факта пуста (эфир).
 * Номер строки листа = индекс атома + шапка (DEPT_HEADER_ROWS) + 1.
 */
function pendingPositionsFor(rows: RawRow[], quarter: number, year: number, asOfDay?: number): PendingPosition[] {
  const out: PendingPosition[] = [];
  rows.forEach((row, i) => {
    if (!standardRowFilter(row)) return;
    if (cellNum(row[DEPT_COLUMNS.PLAN_QUARTER]) !== quarter) return;
    const rowYear = cellNum(row[DEPT_COLUMNS.PLAN_YEAR]);
    if (rowYear !== 0 && rowYear !== year) return;
    // Гейт факта — КАНОН ДВИЖКА (factCountsOn), не «пустая ячейка»: при
    // отсутствии даты лист держит заглушку «Х» (так велит сама шапка),
    // и дата позже среза — тоже «не заключено». Свой гейт здесь молча
    // отсеивал ВСЕ незаключённые строки (второй дом канона, урок 03.08).
    if (factCountsOn(row[DEPT_COLUMNS.FACT_DATE], asOfDay)) return;
    const planTotal = rowPlanTotal(row);
    const explanations = EXPLANATION_COLS
      .map(({ col, label }) => ({ label, text: String(row[col] ?? '').trim() }))
      .filter((e) => e.text !== '');
    out.push({
      sheetRow: i + DEPT_HEADER_ROWS + 1,
      subject: String(row[DEPT_COLUMNS.SUBJECT] ?? '').trim(),
      method: String(row[DEPT_COLUMNS.METHOD] ?? '').trim(),
      planDate: String(row[DEPT_COLUMNS.PLAN_DATE] ?? '').trim(),
      planTotal,
      explanations,
      // Ожидаемая дата ищется по всем пояснениям строки: исполнитель может
      // написать её в любой из колонок комментариев.
      forecastDate: explanations
        .map((e) => extractForecastDate(e.text, asOfDay))
        .find((d): d is string => d !== null) ?? null,
    });
  });
  // Дороже — выше: внимание читателя ведут деньги.
  return out.sort((a, b) => b.planTotal - a.planTotal);
}

/**
 * Пары «рекомендация УЭР → ответ ГРБСа» по строкам года. Рекомендация —
 * непустой «Комментарий УЭР АЕМР»; ответ — «Комментарий ГРБСа» той же
 * строки (пустой ответ — тоже информация: обратной связи в листе нет).
 * Год нестрогий, как всюду в отчёте: строки без года не теряются.
 */
function recommendationsFor(rows: RawRow[], year: number): RecommendationPair[] {
  const out: RecommendationPair[] = [];
  rows.forEach((row, i) => {
    if (!standardRowFilter(row)) return;
    const rowYear = cellNum(row[DEPT_COLUMNS.PLAN_YEAR]);
    if (rowYear !== 0 && rowYear !== year) return;
    const recommendation = String(row[DEPT_COLUMNS.COMMENT_UER] ?? '').trim();
    if (recommendation === '') return;
    const planTotal = rowPlanTotal(row);
    out.push({
      sheetRow: i + DEPT_HEADER_ROWS + 1,
      subject: String(row[DEPT_COLUMNS.SUBJECT] ?? '').trim(),
      planTotal,
      recommendation,
      reply: String(row[DEPT_COLUMNS.COMMENT_GRBS] ?? '').trim(),
    });
  });
  return out.sort((a, b) => b.planTotal - a.planTotal);
}

/** Строка листа → вид деятельности (колонка F, живые значения книг). */
function activityKeyOf(row: RawRow): string {
  const raw = String(row[DEPT_COLUMNS.TYPE] ?? '').trim().toLowerCase();
  if (raw === '') return 'lifecycle_type_unknown';
  if (raw.startsWith('программ')) return 'lifecycle_type_program';
  if (raw.startsWith('текущ')) return 'lifecycle_type_current';
  return 'lifecycle_type_other';
}

/**
 * Строка листа → стадия жизненного цикла.
 *
 * Гейт факта — канон движка (factCountsOn): заглушка «Х» и дата позже среза
 * значат «ещё не заключено». Просрочка считается только когда плановая дата
 * читается: пустая дата — не повод объявлять срыв.
 */
function stageKeyOf(row: RawRow, asOfDay: number | undefined): string {
  if (factCountsOn(row[DEPT_COLUMNS.FACT_DATE], asOfDay)) return 'lifecycle_stage_concluded';
  if (rowPlanTotal(row) <= 0) return 'lifecycle_stage_unfunded';
  const planDay = dayNumberOf(String(row[DEPT_COLUMNS.PLAN_DATE] ?? '').trim());
  const today = asOfDay ?? dayNumberOf(new Date());
  if (planDay !== null && today !== null && planDay < today) return 'lifecycle_stage_overdue';
  return 'lifecycle_stage_in_work';
}

/** Раскладка строк по ключу с деньгами; порядок долей задан списком keys. */
function bucketize(rows: RawRow[], keyOf: (r: RawRow) => string, keys: string[]): LifecycleBucket[] {
  const acc = new Map<string, LifecycleBucket>();
  for (const row of rows) {
    const key = keyOf(row);
    const b = acc.get(key) ?? { metricKey: key, count: 0, planTotal: 0 };
    b.count += 1;
    b.planTotal += rowPlanTotal(row);
    acc.set(key, b);
  }
  // Порядок — канонический; доли, которых нет, не рисуются (пустая доля —
  // это ноль, которого никто не считал).
  const ordered = keys.map((k) => acc.get(k)).filter((b): b is LifecycleBucket => b !== undefined);
  const rest = [...acc.values()].filter((b) => !keys.includes(b.metricKey));
  return [...ordered, ...rest];
}

/**
 * Этапность года ГРБС. Периметр — строки плана этого года (standardRowFilter
 * плюс нестрогий год, как всюду в отчёте): именно они и есть «вся закупочная
 * деятельность управления», о которой спрашивает читатель.
 */
function lifecycleOf(rows: RawRow[], year: number, asOfDay: number | undefined): LifecycleBreakdown {
  const inYear = rows.filter((row) => {
    if (!standardRowFilter(row)) return false;
    const rowYear = cellNum(row[DEPT_COLUMNS.PLAN_YEAR]);
    return rowYear === 0 || rowYear === year;
  });
  return {
    byType: bucketize(inYear, activityKeyOf, [
      'lifecycle_type_current', 'lifecycle_type_program', 'lifecycle_type_other', 'lifecycle_type_unknown',
    ]),
    byStage: bucketize(inYear, (r) => stageKeyOf(r, asOfDay), [
      'lifecycle_stage_concluded', 'lifecycle_stage_in_work',
      'lifecycle_stage_overdue', 'lifecycle_stage_unfunded',
    ]),
  };
}

/**
 * Свод формулировок одной колонки: строка → кластер словаря → доля.
 *
 * Нераспознанное НЕ прячется: словарь честно говорит «формулировка не
 * распознана», и читатель видит, сколько текста осталось за пределами
 * нормализации — это и есть мера пригодности свободного ввода.
 */
function reasonBuckets(
  rows: RawRow[],
  column: number,
  classify: (raw: unknown) => { cluster: string },
  labelOf: (cluster: string) => { label: string; owner?: string; actionable?: boolean; legitimate?: boolean } | null,
): ReasonBucket[] {
  const acc = new Map<string, { count: number; texts: Map<string, number> }>();
  for (const row of rows) {
    const raw = String(row[column] ?? '').trim();
    const { cluster } = classify(raw);
    if (cluster === 'EMPTY') continue;
    const b = acc.get(cluster) ?? { count: 0, texts: new Map<string, number>() };
    b.count += 1;
    b.texts.set(raw, (b.texts.get(raw) ?? 0) + 1);
    acc.set(cluster, b);
  }
  const out: ReasonBucket[] = [];
  for (const [cluster, b] of acc) {
    const meta = labelOf(cluster);
    // Самая частая живая формулировка кластера — образец для читателя.
    const sample = [...b.texts.entries()].sort((x, y) => y[1] - x[1])[0]?.[0] ?? '';
    out.push({
      cluster,
      label: meta?.label ?? 'Формулировка не распознана',
      count: b.count,
      sample,
      ...(meta?.owner !== undefined ? { owner: meta.owner } : {}),
      ...(meta?.actionable !== undefined ? { actionable: meta.actionable } : {}),
      ...(meta?.legitimate !== undefined ? { legitimate: meta.legitimate } : {}),
    });
  }
  return out.sort((a, b) => b.count - a.count);
}

/** Своды объяснений ГРБС за год: основания ЕП и причины просрочек. */
function reasonsOf(rows: RawRow[], year: number): ReasonBreakdown {
  const inYear = rows.filter((row) => {
    if (!standardRowFilter(row)) return false;
    const rowYear = cellNum(row[DEPT_COLUMNS.PLAN_YEAR]);
    return rowYear === 0 || rowYear === year;
  });
  // Основания ЕП спрашиваются только у ЕП-строк: у конкурентных процедур
  // колонка либо пуста, либо несёт чужой текст.
  const epRows = inYear.filter((row) => classifyMethodGroup(row[DEPT_COLUMNS.METHOD]) === 'ep');
  return {
    epReasons: reasonBuckets(epRows, DEPT_COLUMNS.EP_REASON, canonicalizeReasonEp, (c) => {
      const e = EP_REASON_DICT[c as keyof typeof EP_REASON_DICT];
      return e ? { label: e.label_ru, legitimate: e.is_legitimate } : null;
    }),
    deviations: reasonBuckets(inYear, DEPT_COLUMNS.DEVIATION_REASON, canonicalizeDeviation, (c) => {
      const e = DEVIATION_DICT[c as keyof typeof DEVIATION_DICT];
      return e ? { label: e.label_ru, owner: e.owner, actionable: e.actionable } : null;
    }),
  };
}

/** Порядок блоков: канонический порядок реестра, незнакомые ключи — в конец. */
function deptOrder(keys: string[]): string[] {
  const rank = (key: string): number => {
    const entry = resolveDept(key);
    return entry ? DEPARTMENT_REGISTRY.indexOf(entry) : DEPARTMENT_REGISTRY.length;
  };
  return [...keys].sort((a, b) => rank(a) - rank(b));
}

// ── Проекция ─────────────────────────────────────────────────────────

/**
 * Построить проекцию отчёта из строк-атомов (+ официал СВОД, + сигналы).
 * Чистая функция: одинаковый вход → одинаковый выход, без побочных эффектов.
 */
export function buildReport(input: BuildReportInput, opts: BuildReportOptions): Report {
  const { year, quarter } = opts;
  const issues = input.issues ?? [];
  const notes: string[] = [];
  const qGroup = `q${quarter}`;

  const blocks: GrbsReportBlock[] = deptOrder(Object.keys(input.rowsByDept)).map((dept) => {
    const rows = input.rowsByDept[dept] ?? [];
    const entry = resolveDept(dept);
    // Один проход движка на блок: разрезы (КП/ЕП, деньги, экономия) и
    // исполнение квартала — из одного g (quarterExecution гонял бы второй
    // идентичный compute; горячий путь /api/report, simplify 03.08).
    const g = ENGINE.compute(rows, standardRowFilter, 0, year, { asOfDay: opts.asOfDay });
    const execution = quarterExecutionFromCounts(
      getValue(g, 'plan_count', qGroup),
      getValue(g, 'fact_count', qGroup),
    );

    // Незаключённые = план − факт (D − E): канон — колонка F листа СВОД
    // («отклонение»). Прямое правило вместо построчного detectSignals: сигнальная
    // семантика notConcluded построчная и здесь избыточна — счётчики уже есть.
    const methodsOf = (grouped: ReturnType<typeof ENGINE.compute>): MethodSplit => ({
      kp: planFact(
        getValue(grouped, 'competitive_count', `${qGroup}.competitive`),
        getValue(grouped, 'comp_fact_count', `${qGroup}.competitive`),
        'calc',
      ),
      ep: planFact(
        getValue(grouped, 'ep_count', `${qGroup}.ep`),
        getValue(grouped, 'ep_fact_count', `${qGroup}.ep`),
        'calc',
      ),
    });
    const quarterMethods = methodsOf(g);
    // «Как в СВОДе, на сейчас» — сверка сравнивает сравнимое (см.
    // GrbsQuarterSlice.live). В эфире g уже без гейта среза — второй
    // проход движка нужен только архивному срезу.
    const quarterLive = opts.asOfDay === undefined
      ? quarterMethods
      : methodsOf(ENGINE.compute(rows, standardRowFilter, 0, year));
    const yearCounts = yearCountsOf(g);

    return {
      dept,
      deptLabel: entry?.fullName ?? dept,
      quarter: {
        execution,
        methods: quarterMethods,
        pendingCount: execution.planCount - execution.doneCount,
        pending: pendingOf(g, qGroup),
        pendingPositions: pendingPositionsFor(rows, quarter, year, opts.asOfDay),
        pendingByMethod: {
          kp: pendingOf(g, `${qGroup}.competitive`),
          ep: pendingOf(g, `${qGroup}.ep`),
        },
        moneyByMethod: methodMoneyOf(g, qGroup),
        live: quarterLive,
        svod: input.svodGrid
          ? svodSplit(input.svodGrid, entry?.shortName ?? dept, quarter, year)
          : undefined,
        svodCells: input.svodGrid
          ? svodCellRefs(input.svodGrid, entry?.shortName ?? dept, quarter, year)
          : undefined,
      },
      year: {
        counts: yearCounts,
        // Годовой ярус — по тому же правилу, что и кварталы (§2): сумма
        // четырёх кварталов, а не негруппированный итог движка.
        methods: {
          kp: planFact(
            sumOverQuarters(g, 'competitive_count', 'competitive'),
            sumOverQuarters(g, 'comp_fact_count', 'competitive'),
            'calc',
          ),
          ep: planFact(
            sumOverQuarters(g, 'ep_count', 'ep'),
            sumOverQuarters(g, 'ep_fact_count', 'ep'),
            'calc',
          ),
        },
        pendingCount: yearCounts.planCount - yearCounts.doneCount,
        pending: sumPending(QUARTERS.map((q) => pendingOf(g, `q${q}`))),
      },
      recommendations: recommendationsFor(rows, year),
      lifecycle: lifecycleOf(rows, year, opts.asOfDay),
      reasons: reasonsOf(rows, year),
      money: { plan: moneyOf(g, 'plan'), fact: moneyOf(g, 'fact') },
      economy: moneyOf(g, 'economy'),
      ...(() => {
        const svodYearMoney = svodYearMoneyOf(input.svodExtras, entry?.shortName ?? dept);
        return svodYearMoney ? { svodYearMoney } : {};
      })(),
      ...(() => {
        const noYearRows = noYearRowsOf(rows);
        return noYearRows ? { noYearRows } : {};
      })(),
      signals: signalsFor(issues, entry, dept),
    };
  });

  if (!input.svodGrid) {
    // Честная плашка вместо пустоты (спека §4.1): чего нет и почему.
    notes.push('Лист СВОД не передан — официальная сверка-колонка недоступна.');
  }

  // Заключённое ПОСЛЕ среза объясняет расхождение с официалом: формулы СВОДа
  // дату факта не сравнивают ни с чем и всегда считают «на сейчас».
  const afterSlice = blocks.reduce(
    (sum, b) =>
      sum +
      (b.quarter.live.kp.doneCount - b.quarter.methods.kp.doneCount) +
      (b.quarter.live.ep.doneCount - b.quarter.methods.ep.doneCount),
    0,
  );
  if (afterSlice > 0) {
    notes.push(
      `После даты среза заключено процедур: ${afterSlice}. В отчётные числа они не входят, ` +
      'но видны в СВОДе — он всегда считает на текущий момент.',
    );
  }

  return {
    period: { year, quarter, ...(opts.asOfDay === undefined ? {} : { asOfDay: opts.asOfDay }) },
    integralSummary: integralOf(blocks, input.svodGrid, quarter, year),
    grbsBlocks: blocks,
    ...(input.svodExtras ? { official: officialOf(input.svodExtras) } : {}),
    notes,
  };
}

/**
 * Официальный ярус листа — как есть. Расч. экономию лист считает только
 * району (у управлений её нет вовсе, см. parseSvodExtras), поэтому берём
 * скоуп «ВСЕ» и ничего не досчитываем за лист.
 */
function officialOf(extras: SvodSheetExtras): Report['official'] {
  const district = extras.scopes.find((s) => s.scope === 'ВСЕ');
  return {
    ...(extras.remainderToConclude ? { remainderToConclude: extras.remainderToConclude } : {}),
    ...(district?.calcEconomy ? { calcEconomy: district.calcEconomy } : {}),
  };
}

// ── Интегральная сводка ──────────────────────────────────────────────

/** Сумма план/факт-счётчиков (инвариант агрегации §5.1: интеграл = Σ блоков). */
function sumCounts(parts: PlanFactCounts[]): PlanFactCounts {
  return planFact(
    parts.reduce((s, p) => s + p.planCount, 0),
    parts.reduce((s, p) => s + p.doneCount, 0),
    'calc',
  );
}

/** Сумма остатков по частям — экспорт: web-выгрузка звала свои копии. */
export function sumPending(parts: PendingRemainder[]): PendingRemainder {
  const add = (pick: (p: PendingRemainder) => number): number =>
    parts.reduce((s, p) => s + pick(p), 0);
  return {
    count: add((p) => p.count),
    fb: add((p) => p.fb),
    kb: add((p) => p.kb),
    mb: add((p) => p.mb),
    total: add((p) => p.total),
  };
}

function sumMoney(parts: BudgetMoney[]): BudgetMoney {
  const fb = parts.reduce((s, p) => s + p.fb, 0);
  const kb = parts.reduce((s, p) => s + p.kb, 0);
  const mb = parts.reduce((s, p) => s + p.mb, 0);
  return { fb, kb, mb, total: fb + kb + mb, origin: 'calc' };
}

function integralOf(
  blocks: GrbsReportBlock[],
  svodGrid: SvodGridBlock[] | undefined,
  quarter: number,
  year: number,
): IntegralSummary {
  const qKp = sumCounts(blocks.map((b) => b.quarter.methods.kp));
  const qEp = sumCounts(blocks.map((b) => b.quarter.methods.ep));
  return {
    year: {
      kp: sumCounts(blocks.map((b) => b.year.methods.kp)),
      ep: sumCounts(blocks.map((b) => b.year.methods.ep)),
      total: sumCounts(blocks.map((b) => b.year.counts)),
    },
    quarter: {
      kp: qKp,
      ep: qEp,
      // Квартальный итог — из канонической метрики блока (G = E/D), не из
      // КП+ЕП-разреза: строки с нераспознанным способом не должны теряться.
      total: sumCounts(blocks.map((b) =>
        planFact(b.quarter.execution.planCount, b.quarter.execution.doneCount, 'calc'),
      )),
    },
    money: {
      plan: sumMoney(blocks.map((b) => b.money.plan)),
      fact: sumMoney(blocks.map((b) => b.money.fact)),
      economy: sumMoney(blocks.map((b) => b.economy)),
    },
    pending: {
      quarter: sumPending(blocks.map((b) => b.quarter.pending)),
      year: sumPending(blocks.map((b) => b.year.pending)),
    },
    // Районные деньги квартала по способам = сумма блоков — то же правило
    // агрегации, что у остальных полей сводки (Σ блоков = интеграл, §5.1).
    moneyByMethod: {
      kp: {
        plan: sumMoney(blocks.map((b) => b.quarter.moneyByMethod.kp.plan)),
        fact: sumMoney(blocks.map((b) => b.quarter.moneyByMethod.kp.fact)),
      },
      ep: {
        plan: sumMoney(blocks.map((b) => b.quarter.moneyByMethod.ep.plan)),
        fact: sumMoney(blocks.map((b) => b.quarter.moneyByMethod.ep.fact)),
      },
    },
    // Официальный интеграл — блоки scope «ВСЕ» листа СВОД.
    svodQuarter: svodGrid ? svodSplit(svodGrid, 'ВСЕ', quarter, year) : undefined,
  };
}
