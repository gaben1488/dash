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
  type DepartmentEntry,
  type Issue,
  type IssueSeverity,
  type SvodGridBlock,
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
  GrbsReportBlock,
  IntegralSummary,
  MethodSplit,
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
const TOP_SIGNALS_LIMIT = 3;

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

/** План/факт по счётчикам CalcEngine (plan_count / fact_count) для группы. */
function countsOf(g: GroupedResults, group?: string): PlanFactCounts {
  return planFact(getValue(g, 'plan_count', group), getValue(g, 'fact_count', group), 'calc');
}

/** Денежная тройка ФБ/КБ/МБ из метрик prefix_fb/kb/mb (+ total по сумме). */
function moneyOf(g: GroupedResults, prefix: 'plan' | 'fact' | 'economy'): BudgetMoney {
  const fb = getValue(g, `${prefix}_fb`);
  const kb = getValue(g, `${prefix}_kb`);
  const mb = getValue(g, `${prefix}_mb`);
  // total как сумма тройки — инвариант бюджета (§5.1) выполняется по построению;
  // канонические prefix_total у plan/fact включают K/Y-fallback и могут
  // расходиться с тройкой при кривых итогах листа — отчёт показывает сходящееся.
  return { fb, kb, mb, total: fb + kb + mb, origin: 'calc' };
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

/** Топ-сигналы ГРБС: только свои, по критичности, не больше лимита. */
function topSignalsFor(issues: Issue[], entry: DepartmentEntry | undefined, key: string): ReportSignal[] {
  const own = new Set([key, entry?.id, entry?.latinId].filter((v): v is string => Boolean(v)));
  return issues
    .filter((i) => i.departmentId !== undefined && own.has(i.departmentId))
    .sort((a, b) => (SEVERITY_RANK[a.severity] ?? 9) - (SEVERITY_RANK[b.severity] ?? 9))
    .slice(0, TOP_SIGNALS_LIMIT)
    .map((i) => ({ id: i.id, severity: i.severity, title: i.title }));
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
    const yearCounts = countsOf(g);

    return {
      dept,
      deptLabel: entry?.fullName ?? dept,
      quarter: {
        execution,
        methods: quarterMethods,
        pendingCount: execution.planCount - execution.doneCount,
        live: quarterLive,
        svod: input.svodGrid
          ? svodSplit(input.svodGrid, entry?.shortName ?? dept, quarter, year)
          : undefined,
      },
      year: {
        counts: yearCounts,
        methods: {
          kp: planFact(getValue(g, 'competitive_count'), getValue(g, 'comp_fact_count'), 'calc'),
          ep: planFact(getValue(g, 'ep_count'), getValue(g, 'ep_fact_count'), 'calc'),
        },
        pendingCount: yearCounts.planCount - yearCounts.doneCount,
      },
      money: { plan: moneyOf(g, 'plan'), fact: moneyOf(g, 'fact') },
      economy: moneyOf(g, 'economy'),
      topSignals: topSignalsFor(issues, entry, dept),
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
    notes,
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
    // Официальный интеграл — блоки scope «ВСЕ» листа СВОД.
    svodQuarter: svodGrid ? svodSplit(svodGrid, 'ВСЕ', quarter, year) : undefined,
  };
}
