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
  svodCellRef,
  type Issue,
  type IssueSeverity,
  type SvodGridBlock,
  type SvodSheetExtras,
} from '@aemr/shared';
import {
  CalcEngine,
  getValue,
  standardRowFilter,
  type GroupedResults,
  type RawRow,
} from '../pipeline/calc-engine.js';
import {
  quarterExecution,
  quarterExecutionFromCounts,
} from '../metrics/quarter-execution.js';
import type {
  BudgetMoney,
  GrbsQuarterSlice,
  GrbsReportBlock,
  IntegralSummary,
  MethodSplit,
  PendingPosition,
  PendingRemainder,
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

/** Сколько топ-сигналов показывает шапка секции ГРБС. */

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
  return DEPARTMENT_REGISTRY.find(
    (d) => d.id === key || d.latinId === key || d.sheetName === key,
  );
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

const cellNum = (v: unknown): number => {
  const n = Number(String(v ?? '').replace(/\s| /g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
};

/**
 * Незаключённые позиции квартала с пояснениями из листа. Гейты — каноны
 * движка: строка проходит standardRowFilter, плановый квартал = отчётный,
 * год нестрогий (строки без года не теряются), дата факта пуста (эфир).
 * Номер строки листа = индекс атома + шапка (DEPT_HEADER_ROWS) + 1.
 */
function pendingPositionsFor(rows: RawRow[], quarter: number, year: number): PendingPosition[] {
  const out: PendingPosition[] = [];
  rows.forEach((row, i) => {
    if (!standardRowFilter(row)) return;
    if (cellNum(row[DEPT_COLUMNS.PLAN_QUARTER]) !== quarter) return;
    const rowYear = cellNum(row[DEPT_COLUMNS.PLAN_YEAR]);
    if (rowYear !== 0 && rowYear !== year) return;
    if (String(row[DEPT_COLUMNS.FACT_DATE] ?? '').trim() !== '') return;
    const planTotal = cellNum(row[DEPT_COLUMNS.TOTAL_PLAN])
      || cellNum(row[DEPT_COLUMNS.FB_PLAN]) + cellNum(row[DEPT_COLUMNS.KB_PLAN]) + cellNum(row[DEPT_COLUMNS.MB_PLAN]);
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
    });
  });
  // Дороже — выше: внимание читателя ведут деньги.
  return out.sort((a, b) => b.planTotal - a.planTotal);
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
    // Канонический путь квартального исполнения — переиспользуем метрику 1.3.
    const execution = quarterExecution(rows, { quarter, year, asOfDay: opts.asOfDay });
    // Тот же движок для разрезов (КП/ЕП, деньги, экономия) — год-срез не строгий
    // (канон дашборда: строки без года не теряются).
    const g = ENGINE.compute(rows, standardRowFilter, 0, year, { asOfDay: opts.asOfDay });

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
    // Второй проход без гейта среза — «как в СВОДе, на сейчас»: только так
    // сверка сравнивает сравнимое (см. GrbsQuarterSlice.live).
    const quarterLive = methodsOf(ENGINE.compute(rows, standardRowFilter, 0, year));
    const yearCounts = yearCountsOf(g);

    return {
      dept,
      deptLabel: entry?.fullName ?? dept,
      quarter: {
        execution,
        methods: quarterMethods,
        pendingCount: execution.planCount - execution.doneCount,
        pending: pendingOf(g, qGroup),
        pendingPositions: pendingPositionsFor(rows, quarter, year),
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
      money: { plan: moneyOf(g, 'plan'), fact: moneyOf(g, 'fact') },
      economy: moneyOf(g, 'economy'),
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

function sumPending(parts: PendingRemainder[]): PendingRemainder {
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
