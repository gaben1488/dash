import type { FastifyInstance } from 'fastify';
import { requestStage } from '../plugins/request-timing.js';
import { getSnapshot, invalidateCache, setSvodGridCache, getDeptLoadMeta, getDeptSheetCache } from '../services/snapshot.js';
import { getSheetData } from '../services/google-sheets.js';
import { overlayPersistedStatus, withPersistedDecisions } from '../services/issue-decisions.js';
import { refreshAllSources } from '../services/source-refresh.js';
import { DEPARTMENT_SPREADSHEETS } from '../config.js';
import { classifySheet, REPORT_MAP, DEPARTMENTS, DashboardDataSchema, SVOD_SHEET_NAME, formulaDiagnosticInapplicableReason } from '@aemr/shared';
import type { KPICard, DepartmentSummary, DepartmentPeriodBlock, DashboardData, DashboardPeriodSummary, Issue, DeltaResult, NormalizedMetric } from '@aemr/shared';
import { computeTrustScore, crossVerifyQuarterly, validateSHDYUConsistency } from '@aemr/core';
import { parseYearFilterParam } from '../services/period-params.js';

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

function snapshotUnavailable(error: unknown) {
  return error instanceof Error && 'code' in error && error.code === 'SNAPSHOT_NOT_READY'
    ? { code: 'SNAPSHOT_NOT_READY', error: 'Срез данных ещё готовится. Повторите чтение после обновления.' }
    : SNAPSHOT_UNAVAILABLE;
}

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
type PeriodBlock = DepartmentPeriodBlock;

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
    const targetYear = parseYearFilterParam(query.year);
    let snapshot;
    try {
      snapshot = await requestStage(request, 'model', () => getSnapshot(force, targetYear));
    } catch (err) {
      app.log.warn('dashboard: snapshot unavailable: %s', (err as Error).message);
      return reply.status(503).send(snapshotUnavailable(err));
    }

    // Decisions are read on every request; never mutate the historical snapshot.
    // Returning the previous accepted read-model is useful to GET readers,
    // but an explicit POST refresh must never advertise it as a new success.
    if (snapshot.metadata?.readModel?.state || snapshot.metadata?.sourceCoverage?.complete === false) {
      return reply.status(503).send({
        success: false,
        quick,
        error: 'SOURCE_FULL_BASE_NOT_UPDATED',
        lastAcceptedUnchanged: true,
      });
    }
    snapshot = withPersistedDecisions(snapshot);

    // Формируем KPI-карточки
    const kpiCards: KPICard[] = [];
    for (const entry of REPORT_MAP) {
      const metric = snapshot.officialMetrics[entry.metricKey];
      if (!metric) continue;

      const delta = snapshot.deltas?.find((d: DeltaResult) => d.metricKey === entry.metricKey);
      const issues = snapshot.issues?.filter((i: Issue) => i.status !== 'false_positive' && !formulaDiagnosticInapplicableReason(i) && i.metricKey === entry.metricKey) ?? [];
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
      if (i.status === 'false_positive' || formulaDiagnosticInapplicableReason(i) || !i.departmentId || !i.signal) continue;
      if (!deptSignalCounts[i.departmentId]) deptSignalCounts[i.departmentId] = {};
      deptSignalCounts[i.departmentId][i.signal] = (deptSignalCounts[i.departmentId][i.signal] ?? 0) + 1;
    }

    // Формируем сводки по ГРБС с quarterly data из calculatedMetrics
    const calc = snapshot.calculatedMetrics ?? {};
    const departmentSummaries: DepartmentSummary[] = DEPARTMENTS.map(dept => {
      const deptIssues = snapshot.issues?.filter((i: Issue) => i.departmentId === dept.id) ?? [];

      // Prefer calc-engine year-filtered totals (they respect targetYear).
      // Official SVOD is never substituted into the calculated result.
      const prefix = `grbs.${dept.id}`;
      const calcGet = (key: string) => calc[key]?.numericValue;

      // C04.01: one accepted master dataset feeds Dash and Word. Official
      // SVOD cells are comparison evidence, never a replacement for a missing
      // calculated year (particularly when the official sheet is for another year).
      const planTotalVal = calcGet(`${prefix}.year.plan_total`);
      const factTotalVal = calcGet(`${prefix}.year.fact_total`);
      const ecoTotal = calcGet(`${prefix}.year.economy_total`);
      const kpCount = calcGet(`${prefix}.kp.year.count`);
      const epCount = calcGet(`${prefix}.ep.year.count`);
      const countRatio = calcGet(`${prefix}.year.exec_count_pct`);
      const executionPct = countRatio == null ? null : +(countRatio * 100).toFixed(1);

      const activeDeptIssues = deptIssues.filter((i: Issue) => i.status !== 'false_positive' && !formulaDiagnosticInapplicableReason(i));
      const criticalCount = activeDeptIssues.filter((i: Issue) => i.severity === 'critical').length;

      // Per-department trust score via computeTrustScore
      const deptPrefix = `grbs.${dept.id}.`;
      const deptMetricsMap = new Map<string, NormalizedMetric>(
        Object.entries(snapshot.officialMetrics)
          .filter(([key]) => key.startsWith(deptPrefix))
          .map(([key, val]) => [key, val as NormalizedMetric]),
      );
      const deptDeltas = snapshot.deltas?.filter(
        (d: DeltaResult) => d.metricKey?.startsWith(deptPrefix),
      ) ?? [];
      const deptTrust = computeTrustScore(deptMetricsMap, deptIssues, deptDeltas, snapshot.id,
        snapshot.trust?.coverage?.filter(c => classifySheet(c.sheet).latinId === dept.id));
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
        status: criticalCount > 0 ? 'critical' as const : activeDeptIssues.length > 3 ? 'warning' as const : 'normal' as const,
        quarters,
        signalCounts: deptSignalCounts[dept.id] ?? {},
        byActivity: deptRecalc?.byActivity ?? {},
        subordinates: deptRecalc?.bySubordinate ?? [],
        economyConflicts: deptRecalc?.conflicts ?? 0,
      };
    });

    // The same calculated summary from master rows serves every period.
    // The independent official SVOD is retained in officialMetrics, kpiCards
    // and reconciliation so a disagreement remains visible, not silently mixed.
    const summaryByPeriod: Record<string, DashboardPeriodSummary> = {};
    // Count execution is positions concluded / positions planned (fraction).
    // Do not compute money execution or add up percentages in this HTTP route.
    for (const qk of ['q1', 'q2', 'q3', 'q4', 'year'] as const) {
      const get = (family: 'competitive' | 'sole', field: string): number | null =>
        calc[`${family}.${qk}.${field}`]?.numericValue ?? null;
      summaryByPeriod[qk] = {
        kpCount: get('competitive', 'count'),
        kpFactCount: get('competitive', 'fact_count'),
        kpPlan: get('competitive', 'total_plan'),
        kpFact: get('competitive', 'total_fact'),
        kpPercent: get('competitive', 'percent'),
        epCount: get('sole', 'count'),
        epFactCount: get('sole', 'fact_count'),
        epPlan: get('sole', 'total_plan'),
        epFact: get('sole', 'total_fact'),
        epPercent: get('sole', 'percent'),
        fbPlan: get('competitive', 'fb_plan'),
        kbPlan: get('competitive', 'kb_plan'),
        mbPlan: get('competitive', 'mb_plan'),
        fbFact: get('competitive', 'fb_fact'),
        kbFact: get('competitive', 'kb_fact'),
        mbFact: get('competitive', 'mb_fact'),
        epFbPlan: get('sole', 'fb_plan'),
        epKbPlan: get('sole', 'kb_plan'),
        epMbPlan: get('sole', 'mb_plan'),
        epFbFact: get('sole', 'fb_fact'),
        epKbFact: get('sole', 'kb_fact'),
        epMbFact: get('sole', 'mb_fact'),
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
      // Historical summaries remain complete; BlindSpots count active signals only.
      if (i.signal && i.status !== 'false_positive' && !formulaDiagnosticInapplicableReason(i)) {
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
      // HTTP-представление для экранов, а не полный архивный снимок.
      // Строки-атомы, расчётные таблицы и недельный контекст остаются на сервере
      // и в истории; реестр, отчёты и сверки получают их своими маршрутами.
      // Явный список не позволяет новым внутренним полям увеличивать загрузку.
      snapshot: {
        id: snapshot.id,
        spreadsheetId: snapshot.spreadsheetId,
        createdAt: snapshot.createdAt,
        officialMetrics: snapshot.officialMetrics,
        calculatedMetrics: snapshot.calculatedMetrics,
        deltas: snapshot.deltas,
        issues: snapshot.issues,
        trust: snapshot.trust,
        rowCount: snapshot.rowCount,
        metadata: snapshot.metadata,
        ...(snapshot.datasetAnalyses ? { datasetAnalyses: snapshot.datasetAnalyses } : {}),
      },
      kpiCards,
      departmentSummaries,
      summaryByPeriod,
      recentIssues: query.compact === '1' ? [] : allIssues,
      ...(query.compact === '1' ? { recentIssuesRef: 'snapshot.issues' as const } : {}),
      signalCounts,
      issueSummary,
      trust: snapshot.trust,
      lastRefreshed: snapshot.createdAt,
      year: dataYear,
    };

    const validated = await requestStage(request, 'contract', async () => DashboardDataSchema.safeParse(data));
    if (!validated.success) {
      app.log.error(
        { issues: validated.error.issues.slice(0, 5).map(issue => ({ path: issue.path, code: issue.code })) },
        'Dashboard response contract invalid',
      );
      return reply.status(500).send({
        code: 'DASHBOARD_CONTRACT_INVALID',
        error: 'Не удалось проверить данные сводки. Повторите загрузку; если ошибка сохраняется, сообщите администратору.',
      });
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
      return reply.status(503).send(snapshotUnavailable(err));
    }

    const deptPrefix = `grbs.${dept.id}.`;
    const deptMetricsMap = new Map<string, NormalizedMetric>(
      Object.entries(snapshot.officialMetrics)
        .filter(([key]) => key.startsWith(deptPrefix))
        .map(([key, val]) => [key, val as NormalizedMetric]),
    );
    const deptIssues = overlayPersistedStatus(snapshot.issues ?? [], snapshot).filter((i: Issue) => i.departmentId === dept.id);
    const deptDeltas = snapshot.deltas?.filter(
      (d: DeltaResult) => d.metricKey?.startsWith(deptPrefix),
    ) ?? [];
    const trust = computeTrustScore(deptMetricsMap, deptIssues, deptDeltas, snapshot.id,
        snapshot.trust?.coverage?.filter(c => classifySheet(c.sheet).latinId === dept.id));

    return reply.send({ trust, issues: deptIssues, deltas: deptDeltas });
  });

  /**
   * POST /api/refresh — единое обновление данных.
   * По умолчанию: полная загрузка (8 dept sheets + СВОД + pipeline).
   * ?quick=true — только СВОД (без перезагрузки dept sheets).
   * ?formulas=true — вместе со значениями прочитать формулы книг ГРБС.
   *
   * ЗАЧЕМ РУЧНОЙ ЗАПУСК ФОРМУЛ. Обычно формулы читаются бережно: по
   * уведомлению Drive о правке книги и ночным обходом (решение владельца
   * 30.08, §22 п.7) — за неизменные книги мы не платим вторым обращением.
   * Но у владельца должен быть жест «перечитать сейчас» — тот же, что он
   * попросил для комментариев: увидеть целостность формул сразу после
   * ручной починки ячейки, не дожидаясь ночи.
   */
  app.post('/api/refresh', async (request, reply) => {
    const query = request.query as Record<string, string>;
    const quick = query.quick === 'true';
    const withFormulas = query.formulas === 'true';

    interface SourceStatus {
      name: string;
      type: 'svod' | 'department';
      loaded: boolean;
      rowCount?: number;
      error?: string;
    }

    const sources: SourceStatus[] = [];
    const deptRows: Record<string, unknown[][]> = {};

    // Both manual modes retain the same COMPLETE source contract.
    // quick=true means economical Drive revision probes: unchanged master
    // books cost no grid fetch, while every changed book and derived SVOD
    // are reconciled against the durable full baseline. It never means
    // "read only SVOD and publish it with unrelated old master values".
    // Explicit formulas=true still forces a fresh formula examination.
    try {
      const acquisition = await refreshAllSources(
        { info: msg => app.log.info(msg), warn: msg => app.log.warn(msg) },
        'request',
        quick
          ? { fresh: true, withFormulas: true }
          : withFormulas ? { withFormulas: true, fresh: true, askDrive: false } : {},
      );
      if (acquisition.failed.length > 0 || !acquisition.svodOk) {
        const failed = new Set(acquisition.failed);
        const meta = getDeptLoadMeta();
        const declined: SourceStatus[] = Object.keys(DEPARTMENT_SPREADSHEETS).map(name => ({
          name, type: 'department', loaded: false,
          error: failed.has(name)
            ? meta[name]?.error ?? 'SOURCE_READ_FAILED'
            : 'SOURCE_FULL_BASE_NOT_UPDATED',
        }));
        declined.push({
          name: SVOD_SHEET_NAME, type: 'svod', loaded: false,
          error: acquisition.svodOk ? 'SOURCE_FULL_BASE_NOT_UPDATED' : 'SVOD_READ_FAILED',
        });
        return reply.status(503).send({
          success: false, sources: declined, quick,
          error: 'SOURCE_FULL_BASE_NOT_UPDATED', lastAcceptedUnchanged: true,
        });
      }
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      app.log.warn('Department sheets load failed: %s', reason);
      return reply.status(503).send({
        success: false, quick, error: 'SOURCE_FULL_BASE_NOT_UPDATED',
        reason: 'SOURCE_REFRESH_FAILED',
      });
    }

    const meta = getDeptLoadMeta();
    const cache = getDeptSheetCache();
    for (const deptName of Object.keys(DEPARTMENT_SPREADSHEETS)) {
      const m = meta[deptName];
      if (m && !m.error) {
        deptRows[deptName] = cache[deptName]?.values ?? [];
        sources.push({ name: deptName, type: 'department', loaded: true, rowCount: m.rowCount });
      } else {
        sources.push({
          name: deptName, type: 'department', loaded: false,
          error: m?.error ?? 'SOURCE_FULL_BASE_UNVERIFIED',
        });
      }
    }
    if (sources.some(source => !source.loaded)) {
      return reply.status(503).send({
        success: false, sources, quick,
        error: 'SOURCE_FULL_BASE_NOT_VERIFIED',
      });
    }
    let snapshot;
    try {
      // The economical command must not materialize another identical full
      // model when the accepted source generation has not changed. A truly
      // new generation or cold start still waits for the complete build.
      if (quick) {
        try {
          const existing = await getSnapshot(false);
          snapshot = existing.metadata?.readModel?.state ? await getSnapshot(true) : existing;
        } catch (error) {
          if ((error as { code?: string }).code !== 'SNAPSHOT_NOT_READY') throw error;
          snapshot = await getSnapshot(true);
        }
      } else {
        snapshot = await getSnapshot(true);
      }
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

    snapshot = withPersistedDecisions(snapshot);
    const deltaCount = snapshot.deltas?.length ?? 0;
    const calcCount = Object.keys(snapshot.calculatedMetrics ?? {}).length;

    return reply.send({
      success: sources.some(s => s.loaded),
      snapshotId: snapshot.id,
      sources,
      quick,
      trust: snapshot.trust?.overall ?? null,
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
      return reply.status(503).send(snapshotUnavailable(err));
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
    const targetYear = parseYearFilterParam((request.query as Record<string, unknown>).year);

    let snapshot;
    try {
      snapshot = await getSnapshot(false, targetYear);
    } catch (err) {
      app.log.warn('svod/unified: snapshot unavailable: %s', (err as Error).message);
      return reply.status(503).send(snapshotUnavailable(err));
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
