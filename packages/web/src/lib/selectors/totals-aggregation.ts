import type { PeriodResolution } from './period-resolution';

/**
 * Агрегация тоталов (КП/ЕП, план/факт, счётчики, бюджет, экономия) со смешанной
 * логикой периодов: полные кварталы quarter-level + частичные месяцы
 * month-level + подвед-оверрайд короткого замыкания.
 *
 * Извлечено move-only из useFilteredData.ts §8 (:333–462), разрез E11-1.
 * «Выживший» по спеке filter-system-target-2026-07-16 §3.4 (смешанная агрегация
 * полных кварталов + частичных месяцев).
 *
 * 05.08.2026 — ядро вынесено на ОДИН узел (`aggregateNodeTotals`). Раньше
 * период применялся только к сумме по всем управлениям, а разрезы (управление,
 * подведомственная, укрупнённая сводка) читали годовые поля объекта напрямую:
 * при выборе квартала целое и части расходились. Теперь и итог, и каждый узел
 * считаются одной и той же функцией с одним и тем же периодом.
 */

export interface NodeBudget {
  planFB: number; planKB: number; planMB: number;
  factFB: number; factKB: number; factMB: number;
  economyFB: number; economyKB: number; economyMB: number;
}

export interface NodeTotals {
  kp: number;
  ep: number;
  planTotal: number;
  factTotal: number;
  planCount: number;
  factCount: number;
  economyTotal: number;
  budget: NodeBudget;
  /** false — у узла нет квартальной/месячной базы, значения взяты годовыми. */
  periodApplied: boolean;
}

export interface AggregatedTotals {
  totalKP: number;
  totalEP: number;
  totalPlan: number;
  totalFact: number;
  /** count-based исполнение: totalFactCount / totalPlanCount */
  totalPlanCount: number;
  totalFactCount: number;
}

export interface AggregateOpts {
  /** Способ (КП/ЕП): пустой selectedMethods = показывать оба */
  showKP: boolean;
  showEP: boolean;
  activeMonths: Set<number>;
  hasMonthData: boolean;
}

const EMPTY_BUDGET: NodeBudget = {
  planFB: 0, planKB: 0, planMB: 0,
  factFB: 0, factKB: 0, factMB: 0,
  economyFB: 0, economyKB: 0, economyMB: 0,
};

/** Порядок кварталов — общий массив: функция зовётся на каждый узел дерева. */
const QUARTER_KEYS = ['q1', 'q2', 'q3', 'q4'] as const;

/**
 * Есть ли у объекта хоть один ключ. `Object.keys(o).length > 0` строит массив
 * всех имён ради одного «да/нет», а проверка идёт по каждому узлу (управления и
 * все подведомственные) при каждом пересчёте фильтров.
 */
function hasAnyKey(obj: unknown): boolean {
  if (!obj || typeof obj !== 'object') return false;
  for (const _ in obj as Record<string, unknown>) return true;
  return false;
}

function addBudget(acc: NodeBudget, src: any): void {
  if (!src) return;
  acc.planFB += src.planFB ?? 0;
  acc.planKB += src.planKB ?? 0;
  acc.planMB += src.planMB ?? 0;
  acc.factFB += src.factFB ?? 0;
  acc.factKB += src.factKB ?? 0;
  acc.factMB += src.factMB ?? 0;
  acc.economyFB += src.economyFB ?? 0;
  acc.economyKB += src.economyKB ?? 0;
  acc.economyMB += src.economyMB ?? 0;
}

/**
 * Снять с периодных объектов оверрайднутого подвед-узла метод-поля (КП/ЕП),
 * протащенные спредом от управления (см. комментарий в ветви `_subFiltered`).
 * Баг #4 реестра охоты 08.08: без вычистки addMoney/addCommon читали бы
 * kpPlanTotal/kpCount УПРАВЛЕНИЯ там, где выбраны только его подведы.
 */
function stripMethodFields(
  byKey: Record<string, any> | undefined,
): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [key, src] of Object.entries(byKey ?? {})) {
    if (!src) continue;
    const rest = { ...src };
    delete rest.kpCount;
    delete rest.epCount;
    delete rest.kpFactCount;
    delete rest.epFactCount;
    delete rest.kpPlanTotal;
    delete rest.kpFactTotal;
    delete rest.epPlanTotal;
    delete rest.epFactTotal;
    out[key] = rest;
  }
  return out;
}

function emptyTotals(): NodeTotals {
  return {
    kp: 0, ep: 0, planTotal: 0, factTotal: 0, planCount: 0, factCount: 0,
    economyTotal: 0, budget: { ...EMPTY_BUDGET }, periodApplied: true,
  };
}

/**
 * Метрики ОДНОГО узла (управление, подведомственная) за выбранный период.
 * Узел обязан нести `quarters` и/или `months`; если базы нет — возвращаются
 * годовые поля с `periodApplied: false`, чтобы вызывающий мог сказать правду.
 */
export function aggregateNodeTotals(
  node: any,
  resolution: PeriodResolution,
  opts: AggregateOpts,
): NodeTotals {
  const { periodKey, coveredQuarters, fullQuarters, partialMonths, useMonthLevel, hasActiveMonths } = resolution;
  const { showKP, showEP, activeMonths, hasMonthData } = opts;
  const t = emptyTotals();

  // ── Подвед-оверрайд: значения на узле уже являются срезом подведа ──
  //
  // Баг #4 реестра охоты 08.08 (интервью пп. 5, 6, 11, 12): раньше эта ветвь
  // коротко замыкалась на ГОДОВЫХ значениях узла независимо от resolution —
  // фильтр по подведам отменял выбранный период, и под заголовком квартала
  // стояли годовые числа. Теперь собранные оверрайдом quarters/months подведов
  // (subordinate-override.ts суммирует их из SubPeriodMetrics) идут через ту же
  // общую периодную ветвь, что и обычные узлы, — один экран, один периметр.
  if (node?._subFiltered) {
    if (!hasActiveMonths && periodKey === 'year') {
      // Год целиком: годовые поля узла — уже срез подведов, короткое замыкание
      // корректно (годового ключа в quarters{} у оверрайднутого узла нет,
      // поэтому общая ветвь здесь дала бы фолбэк на те же поля).
      if (showKP) t.kp += node.competitiveCount ?? 0;
      if (showEP) t.ep += node.soleCount ?? 0;
      t.planTotal += node.planTotal ?? 0;
      t.factTotal += node.factTotal ?? 0;
      t.economyTotal += node.economyTotal ?? 0;
      for (const qk of QUARTER_KEYS) {
        const sq = node.quarters?.[qk];
        if (sq) { t.planCount += sq.planCount ?? 0; t.factCount += sq.factCount ?? 0; addBudget(t.budget, sq); }
      }
      return t;
    }
    // Период сужен. ОСТОРОЖНО: спред `...(d.quarters?.[qk] ?? {})` в
    // subordinate-override.ts оставляет в оверрайднутых кварталах/месяцах
    // МЕТОД-поля управления (kpCount/epCount/kpPlanTotal/epPlanTotal/…):
    // у SubPeriodMetrics подведов разбивки по способу нет, и спред протаскивает
    // их от депта целиком. Читать их здесь нельзя — деньги и счётчики
    // управления подменили бы срез подведа. Вычищаем их и гоним узел через
    // общую ветвь; счётчики-суммы-бюджет-экономия в этих объектах подведовские.
    const sanitized = {
      ...node,
      _subFiltered: false,
      quarters: stripMethodFields(node.quarters),
      months: stripMethodFields(node.months),
    };
    const st = aggregateNodeTotals(sanitized, resolution, opts);
    // КП/ЕП: поквартальной/помесячной разбивки по способу у подведов в данных
    // НЕТ — единственная существующая база годовая (competitiveCount/soleCount
    // узла = сумма выбранных подведов за год). Показываем её, а не ноль:
    // это тот же честный годовой фолбэк, что и у узла без периодной базы.
    st.kp = showKP ? (node.competitiveCount ?? 0) : 0;
    st.ep = showEP ? (node.soleCount ?? 0) : 0;
    return st;
  }

  const hasQuarters = hasAnyKey(node?.quarters);
  const hasMonths = hasAnyKey(node?.months);
  if (!hasQuarters && !hasMonths) {
    // Базы периодов нет — отдаём годовое и честно помечаем.
    if (showKP) t.kp += node?.competitiveCount ?? 0;
    if (showEP) t.ep += node?.epCount ?? node?.soleCount ?? 0;
    t.planTotal += node?.planTotal ?? 0;
    t.factTotal += node?.factTotal ?? 0;
    t.planCount += node?.planCount ?? node?.rowCount ?? 0;
    t.factCount += node?.factCount ?? 0;
    t.economyTotal += node?.economyTotal ?? 0;
    addBudget(t.budget, node);
    t.periodApplied = false;
    return t;
  }

  const addMoney = (src: any): void => {
    const kpPlan = src?.kpPlanTotal ?? 0;
    const epPlan = src?.epPlanTotal ?? 0;
    if (kpPlan > 0 || epPlan > 0) {
      if (showKP) { t.planTotal += kpPlan; t.factTotal += src?.kpFactTotal ?? 0; }
      if (showEP) { t.planTotal += epPlan; t.factTotal += src?.epFactTotal ?? 0; }
    } else {
      t.planTotal += src?.planTotal ?? 0;
      t.factTotal += src?.factTotal ?? 0;
    }
  };

  const addCommon = (src: any): void => {
    if (showKP) t.kp += src?.kpCount ?? 0;
    if (showEP) t.ep += src?.epCount ?? 0;
    t.planCount += src?.planCount ?? 0;
    t.factCount += src?.factCount ?? 0;
    t.economyTotal += src?.economyTotal ?? 0;
    addBudget(t.budget, src);
  };

  // ── Смешанный выбор: полные кварталы quarter-level + частичные месяцы month-level ──
  const hasMixed = hasActiveMonths && (fullQuarters.length > 0 || partialMonths.length > 0);

  if (hasMixed && hasMonthData && partialMonths.length > 0) {
    for (const monthNum of partialMonths) {
      const m = node.months?.[monthNum];
      if (!m) continue;
      addCommon(m);
      addMoney(m);
    }
    for (const qKey of fullQuarters) {
      const q = node.quarters?.[qKey];
      if (!q) continue;
      addCommon(q);
      addMoney(q);
    }
    return t;
  }

  if (useMonthLevel) {
    for (const monthNum of activeMonths) {
      const m = node.months?.[monthNum];
      if (!m) continue;
      addCommon(m);
      addMoney(m);
    }
    return t;
  }

  // ── Кварталы (или год как один ключ) ──
  const aggregateQuarters = hasActiveMonths && coveredQuarters.length > 0 ? coveredQuarters : [periodKey];
  for (const qKey of aggregateQuarters) {
    const q = node.quarters?.[qKey];
    // Один ключ и нет квартального среза — падаем на годовые поля узла
    // (иначе управление показало бы нули там, где движок отдал только год).
    const single = aggregateQuarters.length === 1;
    if (!q) {
      if (single) {
        if (showKP) t.kp += node.competitiveCount ?? 0;
        if (showEP) t.ep += node.epCount ?? node.soleCount ?? 0;
        t.planTotal += node.planTotal ?? 0;
        t.factTotal += node.factTotal ?? 0;
        t.planCount += node.planCount ?? node.rowCount ?? 0;
        t.factCount += node.factCount ?? 0;
        t.economyTotal += node.economyTotal ?? 0;
        addBudget(t.budget, node);
        t.periodApplied = false;
      }
      continue;
    }
    if (showKP) t.kp += q.kpCount ?? (single ? (node.competitiveCount ?? 0) : 0);
    if (showEP) t.ep += q.epCount ?? (single ? (node.soleCount ?? 0) : 0);
    t.planCount += q.planCount ?? 0;
    t.factCount += q.factCount ?? 0;
    t.economyTotal += q.economyTotal ?? 0;
    addBudget(t.budget, q);
    const kpPlan = q.kpPlanTotal ?? 0;
    const epPlan = q.epPlanTotal ?? 0;
    if (kpPlan > 0 || epPlan > 0) {
      if (showKP) { t.planTotal += kpPlan; t.factTotal += q.kpFactTotal ?? 0; }
      if (showEP) { t.planTotal += epPlan; t.factTotal += q.epFactTotal ?? 0; }
    } else {
      t.planTotal += q.planTotal ?? (single ? (node.planTotal ?? 0) : 0);
      t.factTotal += q.factTotal ?? (single ? (node.factTotal ?? 0) : 0);
    }
  }

  return t;
}

/** Итог по всем управлениям = сумма узлов, посчитанных тем же правилом периода. */
export function aggregateTotals(
  depts: any[],
  resolution: PeriodResolution,
  opts: AggregateOpts,
): AggregatedTotals {
  let totalKP = 0, totalEP = 0;
  let totalPlan = 0, totalFact = 0;
  let totalPlanCount = 0, totalFactCount = 0;

  for (const d of depts) {
    const n = aggregateNodeTotals(d, resolution, opts);
    totalKP += n.kp;
    totalEP += n.ep;
    totalPlan += n.planTotal;
    totalFact += n.factTotal;
    totalPlanCount += n.planCount;
    totalFactCount += n.factCount;
  }

  return { totalKP, totalEP, totalPlan, totalFact, totalPlanCount, totalFactCount };
}
