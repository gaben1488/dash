import type { FastifyInstance } from 'fastify';
import { getSnapshot, invalidateCache, setSvodGridCache, getDeptLoadMeta, getDeptSheetCache } from '../services/snapshot.js';
import { getSheetData } from '../services/google-sheets.js';
import { refreshAllSources } from '../services/source-refresh.js';
import { DEPARTMENT_SPREADSHEETS } from '../config.js';
import { REPORT_MAP, DEPARTMENTS, DashboardDataSchema, SVOD_SHEET_NAME } from '@aemr/shared';
import type { KPICard, DepartmentSummary, DashboardData, DashboardPeriodSummary, Issue, DeltaResult, NormalizedMetric } from '@aemr/shared';
import { computeTrustScore, crossVerifyQuarterly, validateSHDYUConsistency } from '@aemr/core';

/**
 * Ответ на недоступность снимка. Демо-политика живёт в ОДНОЙ точке — getSnapshot:
 * демо-снимок возвращается только при ненастроенных Google-кредах, при настроенных
 * сбой источника даёт последний сохранённый снимок из SQL либо ошибку. Здесь
 * createDemoSnapshot не зовётся: роуты без баннера «Демо» (trust, refresh, сверки)
 * отдавали выдуманные числа по реальным управлениям без единого маркера.
 */
const SNAPSHOT_UNAVAILABLE = {
  error: 'Данные недоступны: не удалось получить снимок из источника. Повторите позже.',
} as const;

/**
 * Блок чисел одного периода (квартал, год или месяц) в сводке ГРБС.
 *
 * Один тип и один строитель на все три случая: раньше список полей был выписан
 * отдельно для кварталов, отдельно для месяцев и отдельно для годового среза,
 * а сами блоки объявлялись как `Record<string, any>` — состав приходилось
 * держать совпадающим вручную, и типизация расхождения не ловила
 * (SIMPLIFY_REGISTER_2026-06-05 §S3 и §S6).
 * Замок: routes/dashboard-period-block.test.ts.
 */
type PeriodBlock = {
  planCount: number | null;
  factCount: number | null;
  planTotal: number | null;
  factTotal: number | null;
  planFB: number | null;
  planKB: number | null;
  planMB: number | null;
  factFB: number | null;
  factKB: number | null;
  factMB: number | null;
  economyTotal: number | null;
  economyFB: number | null;
  economyKB: number | null;
  economyMB: number | null;
  executionPct: number | null;
  execCountPct: number | null;
  compExecCountPct: number | null;
  epExecCountPct: number | null;
  kpCount: number | null;
  kpFactCount: number | null;
  kpPlanTotal: number | null;
  kpFactTotal: number | null;
  epCount: number | null;
  epFactCount: number | null;
  epPlanTotal: number | null;
  epFactTotal: number | null;
};

/**
 * Собирает блок периода из рассчитанных метрик снимка.
 *
 * @param calc   рассчитанные метрики снимка
 * @param prefix ярус ГРБС, например `grbs.uo`
 * @param period ключ периода: `q1`…`q4`, `year` или `m1`…`m12`
 *
 * Доли ядро хранит долями единицы, наружу они уходят процентами с одним знаком
 * после запятой. Отсутствие метрики остаётся пустотой, а не нулём: ноль значит
 * «посчитано и вышло ноль», пустота — «считать было нечего».
 */
function buildPeriodBlock(
  calc: Record<string, NormalizedMetric>,
  prefix: string,
  period: string,
): PeriodBlock {
  const get = (key: string): number | null => calc[key]?.numericValue ?? null;
  const pct = (key: string): number | null => {
    const raw = get(key);
    return raw != null ? +(raw * 100).toFixed(1) : null;
  };
  return {
    planCount: get(`${prefix}.${period}.plan_count`),
    factCount: get(`${prefix}.${period}.fact_count`),
    planTotal: get(`${prefix}.${period}.plan_total`),
    factTotal: get(`${prefix}.${period}.fact_total`),
    planFB: get(`${prefix}.${period}.fb_plan`),
    planKB: get(`${prefix}.${period}.kb_plan`),
    planMB: get(`${prefix}.${period}.mb_plan`),
    factFB: get(`${prefix}.${period}.fb_fact`),
    factKB: get(`${prefix}.${period}.kb_fact`),
    factMB: get(`${prefix}.${period}.mb_fact`),
    economyTotal: get(`${prefix}.${period}.economy_total`),
    economyFB: get(`${prefix}.${period}.economy_fb`),
    economyKB: get(`${prefix}.${period}.economy_kb`),
    economyMB: get(`${prefix}.${period}.economy_mb`),
    executionPct: pct(`${prefix}.${period}.execution_pct`),
    execCountPct: pct(`${prefix}.${period}.exec_count_pct`),
    compExecCountPct: pct(`${prefix}.${period}.comp_exec_count_pct`),
    epExecCountPct: pct(`${prefix}.${period}.ep_exec_count_pct`),
    kpCount: get(`${prefix}.kp.${period}.count`),
    kpFactCount: get(`${prefix}.kp.${period}.fact`),
    kpPlanTotal: get(`${prefix}.kp.${period}.total_plan`),
    kpFactTotal: get(`${prefix}.kp.${period}.total_fact`),
    epCount: get(`${prefix}.ep.${period}.count`),
    epFactCount: get(`${prefix}.ep.${period}.fact`),
    epPlanTotal: get(`${prefix}.ep.${period}.total_plan`),
    epFactTotal: get(`${prefix}.ep.${period}.total_fact`),
  };
}

export async function dashboardRoutes(app: FastifyInstance): Promise<void> {

  /** GET /api/dashboard — полные данные для дашборда */
  app.get('/api/dashboard', async (request, reply) => {
    const query = request.query as Record<string, string>;
    const force = query.refresh === 'true';
    const yearParam = query.year; // e.g. '2026' or 'all'
    // Strict validation: only 4-digit year in plausible range is accepted.
    // 'all', missing, or invalid → undefined (snapshot falls back to current year).
    let targetYear: number | undefined;
    if (yearParam && yearParam !== 'all') {
      const parsed = parseInt(yearParam, 10);
      if (Number.isInteger(parsed) && parsed >= 2020 && parsed <= 2100) {
        targetYear = parsed;
      }
    }
    let snapshot;
    try {
      snapshot = await getSnapshot(force, targetYear);
    } catch (err) {
      app.log.warn('dashboard: snapshot unavailable: %s', (err as Error).message);
      return reply.status(503).send(SNAPSHOT_UNAVAILABLE);
    }

    // Формируем KPI-карточки
    const kpiCards: KPICard[] = [];
    for (const entry of REPORT_MAP) {
      const metric = snapshot.officialMetrics[entry.metricKey];
      if (!metric) continue;

      const delta = snapshot.deltas?.find((d: DeltaResult) => d.metricKey === entry.metricKey);
      const issues = snapshot.issues?.filter((i: Issue) => i.metricKey === entry.metricKey) ?? [];
      const hasCritical = issues.some((i: Issue) => i.severity === 'critical');
      const hasWarning = issues.some((i: Issue) => i.severity === 'warning' || i.severity === 'significant');

      kpiCards.push({
        metricKey: entry.metricKey,
        label: entry.label,
        value: metric.displayValue,
        numericValue: metric.numericValue,
        unit: entry.displayUnit as string,
        period: entry.period as string,
        origin: metric.origin,
        sourceCell: `${entry.sourceSheet}!${entry.sourceCell}`,
        status: hasCritical ? 'critical' : hasWarning ? 'warning' : 'normal',
        delta: delta ? {
          calculatedValue: delta.calculatedValue !== null ? String(delta.calculatedValue) : '—',
          deltaPercent: delta.deltaPercent !== null ? `${delta.deltaPercent.toFixed(1)}%` : '—',
          withinTolerance: delta.withinTolerance,
        } : undefined,
      });
    }

    // Aggregate signal counts per department from pipeline issues (single source of truth)
    const deptSignalCounts: Record<string, Record<string, number>> = {};
    for (const iss of (snapshot.issues ?? [])) {
      const i = iss as Issue;
      if (!i.departmentId || !i.signal) continue;
      if (!deptSignalCounts[i.departmentId]) deptSignalCounts[i.departmentId] = {};
      deptSignalCounts[i.departmentId][i.signal] = (deptSignalCounts[i.departmentId][i.signal] ?? 0) + 1;
    }

    // Формируем сводки по ГРБС с quarterly data из calculatedMetrics
    const calc = snapshot.calculatedMetrics ?? {};
    const departmentSummaries: DepartmentSummary[] = DEPARTMENTS.map(dept => {
      const deptIssues = snapshot.issues?.filter((i: Issue) => i.departmentId === dept.id) ?? [];

      // Prefer calc-engine year-filtered totals (they respect targetYear).
      // SVOD cells are static and not year-filtered — use only as fallback.
      const prefix = `grbs.${dept.id}`;
      const calcGet = (key: string) => calc[key]?.numericValue;
      const svodGet = (key: string) => snapshot.officialMetrics[key]?.numericValue;

      const calcPlanYear = calcGet(`${prefix}.year.plan_total`);
      const calcFactYear = calcGet(`${prefix}.year.fact_total`);
      const calcEcoYear = calcGet(`${prefix}.year.economy_total`);
      const calcKpYear = calcGet(`${prefix}.kp.year.count`);
      const calcEpYear = calcGet(`${prefix}.ep.year.count`);
      const calcExecYear = calcGet(`${prefix}.year.execution_pct`); // fraction 0..1

      const planTotalVal = calcPlanYear != null
        ? calcPlanYear
        : svodGet(`${prefix}.kp.year.total_plan`) ?? svodGet(`${prefix}.kp.q1.total_plan`) ?? null;
      const factTotalVal = calcFactYear != null
        ? calcFactYear
        : svodGet(`${prefix}.kp.year.total_fact`) ?? svodGet(`${prefix}.kp.q1.total_fact`) ?? null;
      const ecoTotal = calcEcoYear != null
        ? calcEcoYear
        : ((svodGet(`${prefix}.economy.kp`) ?? 0) + (svodGet(`${prefix}.economy.ep`) ?? 0)) || null;

      const criticalCount = deptIssues.filter((i: Issue) => i.severity === 'critical').length;
      const executionPct = calcExecYear != null
        ? +(calcExecYear * 100).toFixed(1)
        : (() => {
            const p = svodGet(`${prefix}.kp.q1.percent`);
            return p != null ? +(p * 100).toFixed(1) : null;
          })();

      const kpCount = calcKpYear != null
        ? calcKpYear
        : svodGet(`${prefix}.kp.q1.count`) ?? null;
      const epCount = calcEpYear != null
        ? calcEpYear
        : svodGet(`${prefix}.ep.q1.count`) ?? null;

      // Per-department trust score via computeTrustScore
      const deptPrefix = `grbs.${dept.id}`;
      const deptMetricsMap = new Map<string, NormalizedMetric>(
        Object.entries(snapshot.officialMetrics)
          .filter(([key]) => key.startsWith(deptPrefix))
          .map(([key, val]) => [key, val as NormalizedMetric]),
      );
      const deptDeltas = snapshot.deltas?.filter(
        (d: DeltaResult) => d.metricKey?.startsWith(deptPrefix),
      ) ?? [];
      const deptTrust = computeTrustScore(deptMetricsMap, deptIssues, deptDeltas, snapshot.id);
      const trustScore = deptTrust.overall;

      // Кварталы, год и месяцы собираются ОДНИМ строителем (buildPeriodBlock):
      // до 18.08.2026 список из двадцати шести полей был переписан здесь трижды,
      // и состав месяца с кварталом приходилось держать совпадающим вручную
      // (SIMPLIFY_REGISTER_2026-06-05 §S3).
      const quarters: Record<string, PeriodBlock> = {};
      for (const qk of ['q1', 'q2', 'q3', 'q4', 'year'] as const) {
        quarters[qk] = buildPeriodBlock(calc, prefix, qk);
      }

      // Месяц без плана и без факта не материализуется: пустой блок читался бы
      // как «месяц посчитан, вышли нули», а не «строк этого месяца нет».
      const months: Record<number, PeriodBlock> = {};
      for (let mi = 1; mi <= 12; mi++) {
        const mk = `m${mi}`;
        const hasPlan = calc[`${prefix}.${mk}.plan_count`]?.numericValue ?? null;
        const hasFact = calc[`${prefix}.${mk}.fact_count`]?.numericValue ?? null;
        if (hasPlan != null || hasFact != null) {
          months[mi] = buildPeriodBlock(calc, prefix, mk);
        }
      }

      // Per-department recalculation data (byActivity, subordinates, conflicts)
      const deptRecalc = snapshot.recalcResults?.[dept.id];

      return {
        department: dept,
        months,
        planTotal: planTotalVal,
        factTotal: factTotalVal,
        executionPercent: executionPct,
        economyTotal: ecoTotal,
        competitiveCount: kpCount,
        soleCount: epCount,
        issueCount: deptIssues.length,
        criticalIssueCount: criticalCount,
        trustScore,
        trustComponents: deptTrust.components,
        status: criticalCount > 0 ? 'critical' as const : deptIssues.length > 3 ? 'warning' as const : 'normal' as const,
        quarters,
        signalCounts: deptSignalCounts[dept.id] ?? {},
        byActivity: deptRecalc?.byActivity ?? {},
        subordinates: deptRecalc?.bySubordinate ?? [],
        economyConflicts: deptRecalc?.conflicts ?? 0,
      };
    });

    // Summary-level aggregates by period (1 кв + Year from СВОД, 2 кв-4 кв from calculated)
    const summaryByPeriod: Record<string, DashboardPeriodSummary> = {};

    // 1 кв + Year from official СВОД metrics
    for (const p of ['q1', 'year'] as const) {
      const kpCount = snapshot.officialMetrics[`competitive.${p}.count`]?.numericValue ?? null;
      const kpFactCount = snapshot.officialMetrics[`competitive.${p}.fact_count`]?.numericValue ?? null;
      const kpPlan = snapshot.officialMetrics[`competitive.${p}.total_plan`]?.numericValue ?? null;
      const kpFact = snapshot.officialMetrics[`competitive.${p}.total_fact`]?.numericValue ?? null;
      const kpPct = snapshot.officialMetrics[`competitive.${p}.percent`]?.numericValue ?? null;
      const epCount = snapshot.officialMetrics[`sole.${p}.count`]?.numericValue ?? null;
      const epFactCount = snapshot.officialMetrics[`sole.${p}.fact_count`]?.numericValue ?? null;
      const epPlan = snapshot.officialMetrics[`sole.${p}.total_plan`]?.numericValue ?? null;
      const epFact = snapshot.officialMetrics[`sole.${p}.total_fact`]?.numericValue ?? null;
      const epPct = snapshot.officialMetrics[`sole.${p}.percent`]?.numericValue ?? null;
      const fbPlan = snapshot.officialMetrics[`competitive.${p}.fb_plan`]?.numericValue ?? null;
      const kbPlan = snapshot.officialMetrics[`competitive.${p}.kb_plan`]?.numericValue ?? null;
      const mbPlan = snapshot.officialMetrics[`competitive.${p}.mb_plan`]?.numericValue ?? null;
      const fbFact = snapshot.officialMetrics[`competitive.${p}.fb_fact`]?.numericValue ?? null;
      const kbFact = snapshot.officialMetrics[`competitive.${p}.kb_fact`]?.numericValue ?? null;
      const mbFact = snapshot.officialMetrics[`competitive.${p}.mb_fact`]?.numericValue ?? null;
      summaryByPeriod[p] = {
        kpCount, kpFactCount, kpPlan, kpFact, kpPercent: kpPct,
        epCount, epFactCount, epPlan, epFact, epPercent: epPct,
        fbPlan, kbPlan, mbPlan, fbFact, kbFact, mbFact,
        source: 'official',
      };
    }

    // Q2-Q4 aggregated from calculated metrics across all departments
    for (const qk of ['q2', 'q3', 'q4'] as const) {
      let kpCount = 0, kpFactCount = 0, kpPlan = 0, kpFact = 0;
      let epCount = 0, epFactCount = 0, epPlan = 0, epFact = 0;
      let fbPlan = 0, kbPlan = 0, mbPlan = 0, fbFact = 0, kbFact = 0, mbFact = 0;
      let epFbPlan = 0, epKbPlan = 0, epMbPlan = 0, epFbFact = 0, epKbFact = 0, epMbFact = 0;
      let hasData = false;

      for (const dept of DEPARTMENTS) {
        const prefix = `grbs.${dept.id}`;
        const cv = (key: string) => calc[key]?.numericValue ?? 0;

        const dKp = cv(`${prefix}.kp.${qk}.count`);
        const dEp = cv(`${prefix}.ep.${qk}.count`);
        if (dKp > 0 || dEp > 0) hasData = true;

        kpCount += dKp;
        kpFactCount += cv(`${prefix}.kp.${qk}.fact`);
        kpPlan += cv(`${prefix}.kp.${qk}.total_plan`);
        kpFact += cv(`${prefix}.kp.${qk}.total_fact`);
        epCount += dEp;
        epFactCount += cv(`${prefix}.ep.${qk}.fact`);
        epPlan += cv(`${prefix}.ep.${qk}.total_plan`);
        epFact += cv(`${prefix}.ep.${qk}.total_fact`);
        // КП budget by source (ФБ/КБ/МБ)
        fbPlan += cv(`${prefix}.kp.${qk}.fb_plan`);
        kbPlan += cv(`${prefix}.kp.${qk}.kb_plan`);
        mbPlan += cv(`${prefix}.kp.${qk}.mb_plan`);
        fbFact += cv(`${prefix}.kp.${qk}.fb_fact`);
        kbFact += cv(`${prefix}.kp.${qk}.kb_fact`);
        mbFact += cv(`${prefix}.kp.${qk}.mb_fact`);
        // ЕП budget by source (ФБ/КБ/МБ)
        epFbPlan += cv(`${prefix}.ep.${qk}.fb_plan`);
        epKbPlan += cv(`${prefix}.ep.${qk}.kb_plan`);
        epMbPlan += cv(`${prefix}.ep.${qk}.mb_plan`);
        epFbFact += cv(`${prefix}.ep.${qk}.fb_fact`);
        epKbFact += cv(`${prefix}.ep.${qk}.kb_fact`);
        epMbFact += cv(`${prefix}.ep.${qk}.mb_fact`);
      }

      const kpPct = kpPlan > 0 ? +((kpFact / kpPlan) * 100).toFixed(1) : null;
      const epPct = epPlan > 0 ? +((epFact / epPlan) * 100).toFixed(1) : null;

      summaryByPeriod[qk] = {
        kpCount: hasData ? kpCount : null,
        kpFactCount: hasData ? kpFactCount : null,
        kpPlan: hasData ? kpPlan : null,
        kpFact: hasData ? kpFact : null,
        kpPercent: hasData ? kpPct : null,
        epCount: hasData ? epCount : null,
        epFactCount: hasData ? epFactCount : null,
        epPlan: hasData ? epPlan : null,
        epFact: hasData ? epFact : null,
        epPercent: hasData ? epPct : null,
        fbPlan: hasData ? fbPlan : null,
        kbPlan: hasData ? kbPlan : null,
        mbPlan: hasData ? mbPlan : null,
        fbFact: hasData ? fbFact : null,
        kbFact: hasData ? kbFact : null,
        mbFact: hasData ? mbFact : null,
        epFbPlan: hasData ? epFbPlan : null,
        epKbPlan: hasData ? epKbPlan : null,
        epMbPlan: hasData ? epMbPlan : null,
        epFbFact: hasData ? epFbFact : null,
        epKbFact: hasData ? epKbFact : null,
        epMbFact: hasData ? epMbFact : null,
        source: 'calculated',
      };
    }

    // Data year returned to client: targetYear if valid, else current year.
    const dataYear = targetYear ?? new Date().getFullYear();

    // ── Full issue aggregation (ALL issues, not truncated) ──
    const signalCounts: Record<string, number> = {};
    const allIssues = snapshot.issues ?? [];
    const issueSummary = {
      total: allIssues.length,
      bySeverity: {} as Record<string, number>,
      byCategory: {} as Record<string, number>,
      byDepartment: {} as Record<string, number>,
      byOrigin: {} as Record<string, number>,
      signalCounts: {} as Record<string, number>,
    };
    for (const iss of allIssues) {
      const i = iss as Issue;
      // Signal counts for BlindSpots
      if (i.signal) {
        signalCounts[i.signal] = (signalCounts[i.signal] || 0) + 1;
        issueSummary.signalCounts[i.signal] = (issueSummary.signalCounts[i.signal] || 0) + 1;
      }
      // Severity breakdown
      issueSummary.bySeverity[i.severity] = (issueSummary.bySeverity[i.severity] || 0) + 1;
      // Category breakdown (rule ID or signal:xxx)
      if (i.category) {
        issueSummary.byCategory[i.category] = (issueSummary.byCategory[i.category] || 0) + 1;
      }
      // Department breakdown
      const dept = i.departmentId || i.sheet || 'unknown';
      issueSummary.byDepartment[dept] = (issueSummary.byDepartment[dept] || 0) + 1;
      // Origin breakdown
      if (i.origin) {
        issueSummary.byOrigin[i.origin] = (issueSummary.byOrigin[i.origin] || 0) + 1;
      }
    }

    const data: DashboardData = {
      snapshot,
      kpiCards,
      departmentSummaries,
      summaryByPeriod,
      recentIssues: allIssues,
      signalCounts,
      issueSummary,
      trust: snapshot.trust,
      lastRefreshed: snapshot.createdAt,
      year: dataYear,
    };

    // Runtime contract validation (ADR-0002, Phase 0 Hygiene): assure server↔web
    // boundary. In development: warn on drift (surface the bug in logs).
    // In production: ship anyway — we don't want to break user experience on a
    // schema mismatch, but we do want to see it in logs.
    if (process.env.NODE_ENV !== 'production') {
      const validated = DashboardDataSchema.safeParse(data);
      if (!validated.success) {
        app.log.warn(
          { zodIssues: validated.error.issues.slice(0, 5) },
          'DashboardData contract drift: response does not match zod schema (top 5 issues logged)',
        );
      }
    }

    return reply.send(data);
  });

  /** GET /api/trust/:deptId — детальный trust score по управлению */
  app.get('/api/trust/:deptId', async (request, reply) => {
    const { deptId } = request.params as { deptId: string };
    const dept = DEPARTMENTS.find(d => d.id === deptId);
    if (!dept) {
      return reply.status(404).send({ error: `Department '${deptId}' not found` });
    }

    let snapshot;
    try {
      snapshot = await getSnapshot(false);
    } catch (err) {
      app.log.warn({ err }, 'trust: snapshot unavailable');
      return reply.status(503).send(SNAPSHOT_UNAVAILABLE);
    }

    const deptPrefix = `grbs.${dept.id}`;
    const deptMetricsMap = new Map<string, NormalizedMetric>(
      Object.entries(snapshot.officialMetrics)
        .filter(([key]) => key.startsWith(deptPrefix))
        .map(([key, val]) => [key, val as NormalizedMetric]),
    );
    const deptIssues = snapshot.issues?.filter((i: Issue) => i.departmentId === dept.id) ?? [];
    const deptDeltas = snapshot.deltas?.filter(
      (d: DeltaResult) => d.metricKey?.startsWith(deptPrefix),
    ) ?? [];
    const trust = computeTrustScore(deptMetricsMap, deptIssues, deptDeltas, snapshot.id);

    return reply.send({ trust, issues: deptIssues, deltas: deptDeltas });
  });

  /**
   * POST /api/refresh — единое обновление данных.
   * По умолчанию: полная загрузка (8 dept sheets + СВОД + pipeline).
   * ?quick=true — только СВОД (без перезагрузки dept sheets).
   */
  app.post('/api/refresh', async (request, reply) => {
    const quick = (request.query as Record<string, string>).quick === 'true';

    interface SourceStatus {
      name: string;
      type: 'svod' | 'department';
      loaded: boolean;
      rowCount?: number;
      error?: string;
    }

    const sources: SourceStatus[] = [];
    const deptRows: Record<string, unknown[][]> = {};

    if (!quick) {
      // Полная перечитка идёт через ЕДИНЫЙ цикл чтения источников
      // (services/source-refresh), а не собственной копией. Раньше маршрут
      // читал книги, ПОТОМ лист СВОД, всё подряд и в обход общего цикла:
      //   • лист СВОД ждал окончания восьми книг (замер на заглушках по
      //     150 мс: ~330 мс на цикл против ~160 мс параллельного);
      //   • ручное «Обновить» во время автоцикла или вебхука читало все
      //     девять книг ВТОРОЙ раз одновременно — ровно тот залп, на который
      //     Google отвечает «слишком часто» (реестр багов 09.07.2026).
      // Единый цикл читает книги и СВОД параллельно, склеивает одновременные
      // вызовы (inFlight), публикует живые события и пишет итог в журнал с
      // числами — вторую правду о чтении источников держать нельзя (п.112).
      // Страж: routes/dashboard-refresh.test.ts.
      try {
        await refreshAllSources(
          {
            info: (msg) => app.log.info(msg),
            warn: (msg) => app.log.warn(msg),
          },
          'request',
        );
      } catch (err) {
        // Цикл сам не валится от отказа отдельной книги; сюда попадает только
        // неожиданная поломка. Ответ строится из меты — что успело, то видно.
        app.log.warn('Department sheets load failed: %s', err instanceof Error ? err.message : String(err));
      }

      // Ответ маршрута строится из меты цикла: та же правда, что у /api/health.
      const meta = getDeptLoadMeta();
      const cache = getDeptSheetCache();
      for (const deptName of Object.keys(DEPARTMENT_SPREADSHEETS)) {
        const m = meta[deptName];
        if (m && !m.error) {
          deptRows[deptName] = cache[deptName]?.values ?? [];
          sources.push({ name: deptName, type: 'department', loaded: true, rowCount: m.rowCount });
        } else {
          sources.push({
            name: deptName,
            type: 'department',
            loaded: false,
            error: m?.error ?? 'книга не читалась в этом цикле',
          });
        }
      }
      // Кэш снимка и СВОД-грид обновлены циклом; отдельное чтение СВОДа здесь
      // было бы вторым обращением к тому же листу за один щелчок.
    } else {
      // Быстрый путь — явная просьба «обнови только СВОД», книги не трогаем.
      invalidateCache();
      try {
        setSvodGridCache(await getSheetData(SVOD_SHEET_NAME));
      } catch (err) {
        app.log.warn('SVOD grid refresh failed: %s', (err as Error).message);
      }
    }
    let snapshot;
    try {
      snapshot = await getSnapshot(true);
      sources.push({
        name: SVOD_SHEET_NAME,
        type: 'svod',
        loaded: true,
        rowCount: Object.keys(snapshot.officialMetrics ?? {}).length,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      app.log.warn('SVOD unavailable: %s', msg);
      sources.push({ name: SVOD_SHEET_NAME, type: 'svod', loaded: false, error: msg });
      // Снимок не собран — честный 503 со статусом источников вместо демо-чисел.
      return reply.status(503).send({
        success: false,
        sources,
        quick,
        error: 'Обновление не выполнено: снимок из источника не собран. Повторите позже.',
      });
    }

    const deltaCount = snapshot.deltas?.length ?? 0;
    const calcCount = Object.keys(snapshot.calculatedMetrics ?? {}).length;

    return reply.send({
      success: sources.some(s => s.loaded),
      snapshotId: snapshot.id,
      sources,
      quick,
      trust: snapshot.trust?.overall ?? 0,
      issueCount: snapshot.issues?.length ?? 0,
      deltaCount,
      calculatedMetricCount: calcCount,
      departmentRowCounts: Object.fromEntries(
        Object.entries(deptRows).map(([k, v]) => [k, v.length]),
      ),
    });
  });

  // POST /api/load-all удалён (пирамида агрегации §6, п.15): байт-в-байт
  // алиас /api/refresh без единого потребителя — ни в web, ни в скриптах.
  // Обратная совместимость сохранялась ради вызовов, которых не существует.

  // GET /api/reconciliation — перенесён в routes/reconciliation.ts (единый владелец роута,
  // расширенная сверка). Старый per-dept обработчик удалён: дублирующая регистрация GET
  // ломала старт Fastify ("Method 'GET' already declared for route '/api/reconciliation'").

  // GET /api/export/reconciliation — перенесён в routes/reconciliation.ts (единый владелец).
  // Дублирующая регистрация ломала старт Fastify.

  // GET /api/reconciliation/monthly — перенесён в routes/reconciliation.ts (единый владелец,
  // мигрирован на «СВОД с месяцами»). Дублирующая регистрация ломала старт Fastify.

  /** GET /api/reconciliation/quarterly — перекрёстная сверка ШДЮ(Σ3мес) vs СВОД(квартал) */
  app.get('/api/reconciliation/quarterly', async (request, reply) => {
    let snapshot;
    try {
      snapshot = await getSnapshot();
    } catch (err) {
      // Раньше ошибка глоталась без лога, а сверка наполнялась демо-числами.
      app.log.warn({ err }, 'reconciliation/quarterly: snapshot unavailable');
      return reply.status(503).send(SNAPSHOT_UNAVAILABLE);
    }

    const recalcResults = snapshot.recalcResults ?? {};
    const shdyuData = snapshot.shdyuData ?? {};

    if (Object.keys(shdyuData).length === 0) {
      return reply.send({
        rows: [],
        counts: { ok: 0, warning: 0, high: 0, empty: 0 },
        overallStatus: 'Нет данных ШДЮ',
      });
    }

    const deptNames: Record<string, string> = {};
    for (const d of DEPARTMENTS) deptNames[d.id] = d.nameShort;

    // Сначала проверяем сходимость самого источника: блок «ВСЕ» листа ШДЮ
    // обязан равняться сумме блоков ГРБС. Пока не сходится лист, спорить о
    // разнице листа и расчёта бессмысленно (слепая зона №21: валидатор
    // существовал, но не вызывался ни разу — ручной прогон давал ноль).
    const consistencyErrors = validateSHDYUConsistency(shdyuData);
    const summary = crossVerifyQuarterly(shdyuData, recalcResults, deptNames);
    return reply.send({
      ...summary,
      sourceConsistency: { checked: true, errors: consistencyErrors },
    });
  });

  /**
   * GET /api/svod/unified — единая сетка СВОД + сверка против листа СВОД ТД-ПМ.
   * grid: ГРБС × активность(3: all/td/pm — канон п.30, срез ТД-ПМ упразднён) × метод(КП/ЕП) × период(мес/кв/год).
   * reconciliation: срез ВСЕ vs ячейки СВОД ТД-ПМ (ok/warning/high по Δ%).
   * Считается в snapshot (CalcEngine из атомов); ?year= уважается через getSnapshot.
   */
  app.get('/api/svod/unified', async (request, reply) => {
    const yearParam = (request.query as Record<string, string>).year;
    let targetYear: number | undefined;
    if (yearParam && yearParam !== 'all') {
      const parsed = parseInt(yearParam, 10);
      if (Number.isInteger(parsed) && parsed >= 2020 && parsed <= 2100) {
        targetYear = parsed;
      }
    }

    let snapshot;
    try {
      snapshot = await getSnapshot(false, targetYear);
    } catch (err) {
      app.log.warn('svod/unified: snapshot unavailable: %s', (err as Error).message);
      return reply.status(503).send(SNAPSHOT_UNAVAILABLE);
    }

    const grid = snapshot.unifiedGrid ?? { cells: {}, grbsIds: [], scopes: [] };
    const reconciliation = snapshot.unifiedReconciliation ?? [];

    return reply.send({
      grid,
      reconciliation,
      snapshotId: snapshot.id,
      createdAt: snapshot.createdAt,
      year: targetYear ?? new Date().getFullYear(),
    });
  });

}
