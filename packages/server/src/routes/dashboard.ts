import type { FastifyInstance } from 'fastify';
import { getSnapshot, invalidateCache, setDeptSheetCache, setDeptLoadMeta } from '../services/snapshot.js';
import { createDemoSnapshot } from '../services/demo-data.js';
import { fetchDepartmentSpreadsheets } from '../services/google-sheets.js';
import { DEPARTMENT_SPREADSHEETS, config } from '../config.js';
import { REPORT_MAP, DEPARTMENTS, getMetricsByDepartment } from '@aemr/shared';
import type { KPICard, DepartmentSummary, DashboardData, Issue, DeltaResult, NormalizedMetric } from '@aemr/shared';
import { computeTrustScore, reconcile, reconcileMonthly, crossVerifyQuarterly } from '@aemr/core';

export async function dashboardRoutes(app: FastifyInstance): Promise<void> {

  /** GET /api/dashboard — полные данные для дашборда */
  app.get('/api/dashboard', async (request, reply) => {
    const query = request.query as Record<string, string>;
    const force = query.refresh === 'true';
    const yearParam = query.year; // e.g. '2026' or 'all'
    const targetYear = yearParam && yearParam !== 'all' ? parseInt(yearParam, 10) || undefined : undefined;
    let snapshot;
    try {
      snapshot = await getSnapshot(force, targetYear);
    } catch (err) {
      app.log.warn('Google Sheets unavailable, serving demo data: %s', (err as Error).message);
      snapshot = createDemoSnapshot();
    }

    // Формируем KPI-карточки
    const kpiCards: KPICard[] = [];
    for (const entry of REPORT_MAP) {
      const metric = snapshot.officialMetrics[entry.metricKey];
      if (!metric) continue;

      const delta = snapshot.deltas.find((d: DeltaResult) => d.metricKey === entry.metricKey);
      const issues = snapshot.issues.filter((i: Issue) => i.metricKey === entry.metricKey);
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
    for (const iss of snapshot.issues) {
      const i = iss as Issue;
      if (!i.departmentId || !i.signal) continue;
      if (!deptSignalCounts[i.departmentId]) deptSignalCounts[i.departmentId] = {};
      deptSignalCounts[i.departmentId][i.signal] = (deptSignalCounts[i.departmentId][i.signal] ?? 0) + 1;
    }

    // Формируем сводки по ГРБС с quarterly data из calculatedMetrics
    const calc = snapshot.calculatedMetrics ?? {};
    const departmentSummaries: DepartmentSummary[] = DEPARTMENTS.map(dept => {
      const _deptMetrics = getMetricsByDepartment(dept.id);
      const deptIssues = snapshot.issues.filter((i: Issue) => i.departmentId === dept.id);

      const planMetric = snapshot.officialMetrics[`grbs.${dept.id}.kp.year.total_plan`]
        ?? snapshot.officialMetrics[`grbs.${dept.id}.kp.q1.total_plan`];
      const factMetric = snapshot.officialMetrics[`grbs.${dept.id}.kp.year.total_fact`]
        ?? snapshot.officialMetrics[`grbs.${dept.id}.kp.q1.total_fact`];
      const q1Metric = snapshot.officialMetrics[`grbs.${dept.id}.kp.q1.percent`];
      const ecoKP = snapshot.officialMetrics[`grbs.${dept.id}.economy.kp`]?.numericValue ?? 0;
      const ecoEP = snapshot.officialMetrics[`grbs.${dept.id}.economy.ep`]?.numericValue ?? 0;
      const ecoTotal = ecoKP + ecoEP;

      const criticalCount = deptIssues.filter((i: Issue) => i.severity === 'critical').length;
      const rawPct = q1Metric?.numericValue ?? null;
      const executionPct = rawPct != null ? +(rawPct * 100).toFixed(1) : null;

      const kpCount = snapshot.officialMetrics[`grbs.${dept.id}.kp.q1.count`]?.numericValue ?? null;
      const epCount = snapshot.officialMetrics[`grbs.${dept.id}.ep.q1.count`]?.numericValue ?? null;

      // Per-department trust score via computeTrustScore
      const deptPrefix = `grbs.${dept.id}`;
      const deptMetricsMap = new Map<string, NormalizedMetric>(
        Object.entries(snapshot.officialMetrics)
          .filter(([key]) => key.startsWith(deptPrefix))
          .map(([key, val]) => [key, val as NormalizedMetric]),
      );
      const deptDeltas = snapshot.deltas.filter(
        (d: DeltaResult) => d.metricKey?.startsWith(deptPrefix),
      );
      const deptTrust = computeTrustScore(deptMetricsMap, deptIssues, deptDeltas, snapshot.id);
      const trustScore = deptTrust.overall;

      // Build quarterly data from calculated metrics
      const quarters: Record<string, any> = {};
      for (const qk of ['q1', 'q2', 'q3', 'q4', 'year'] as const) {
        const prefix = `grbs.${dept.id}`;
        const cGet = (key: string) => calc[key]?.numericValue ?? null;
        quarters[qk] = {
          planCount: cGet(`${prefix}.${qk}.plan_count`),
          factCount: cGet(`${prefix}.${qk}.fact_count`),
          planTotal: cGet(`${prefix}.${qk}.plan_total`),
          factTotal: cGet(`${prefix}.${qk}.fact_total`),
          planFB: cGet(`${prefix}.${qk}.fb_plan`),
          planKB: cGet(`${prefix}.${qk}.kb_plan`),
          planMB: cGet(`${prefix}.${qk}.mb_plan`),
          factFB: cGet(`${prefix}.${qk}.fb_fact`),
          factKB: cGet(`${prefix}.${qk}.kb_fact`),
          factMB: cGet(`${prefix}.${qk}.mb_fact`),
          economyTotal: cGet(`${prefix}.${qk}.economy_total`),
          economyFB: cGet(`${prefix}.${qk}.economy_fb`),
          economyKB: cGet(`${prefix}.${qk}.economy_kb`),
          economyMB: cGet(`${prefix}.${qk}.economy_mb`),
          executionPct: cGet(`${prefix}.${qk}.execution_pct`) != null
            ? +((cGet(`${prefix}.${qk}.execution_pct`) as number) * 100).toFixed(1)
            : null,
          execCountPct: cGet(`${prefix}.${qk}.exec_count_pct`) != null
            ? +((cGet(`${prefix}.${qk}.exec_count_pct`) as number) * 100).toFixed(1)
            : null,
          compExecCountPct: cGet(`${prefix}.${qk}.comp_exec_count_pct`) != null
            ? +((cGet(`${prefix}.${qk}.comp_exec_count_pct`) as number) * 100).toFixed(1)
            : null,
          epExecCountPct: cGet(`${prefix}.${qk}.ep_exec_count_pct`) != null
            ? +((cGet(`${prefix}.${qk}.ep_exec_count_pct`) as number) * 100).toFixed(1)
            : null,
          kpCount: cGet(`${prefix}.kp.${qk}.count`),
          kpFactCount: cGet(`${prefix}.kp.${qk}.fact`),
          kpPlanTotal: cGet(`${prefix}.kp.${qk}.total_plan`),
          kpFactTotal: cGet(`${prefix}.kp.${qk}.total_fact`),
          epCount: cGet(`${prefix}.ep.${qk}.count`),
          epFactCount: cGet(`${prefix}.ep.${qk}.fact`),
          epPlanTotal: cGet(`${prefix}.ep.${qk}.total_plan`),
          epFactTotal: cGet(`${prefix}.ep.${qk}.total_fact`),
        };
      }

      // Build monthly data (m1-m12) from calculated metrics
      const months: Record<number, any> = {};
      const prefix = `grbs.${dept.id}`;
      const cGetM = (key: string) => calc[key]?.numericValue ?? null;
      for (let mi = 1; mi <= 12; mi++) {
        const mk = `m${mi}`;
        const hasPlan = cGetM(`${prefix}.${mk}.plan_count`);
        const hasFact = cGetM(`${prefix}.${mk}.fact_count`);
        if (hasPlan != null || hasFact != null) {
          months[mi] = {
            planCount: cGetM(`${prefix}.${mk}.plan_count`),
            factCount: cGetM(`${prefix}.${mk}.fact_count`),
            planTotal: cGetM(`${prefix}.${mk}.plan_total`),
            factTotal: cGetM(`${prefix}.${mk}.fact_total`),
            planFB: cGetM(`${prefix}.${mk}.fb_plan`),
            planKB: cGetM(`${prefix}.${mk}.kb_plan`),
            planMB: cGetM(`${prefix}.${mk}.mb_plan`),
            factFB: cGetM(`${prefix}.${mk}.fb_fact`),
            factKB: cGetM(`${prefix}.${mk}.kb_fact`),
            factMB: cGetM(`${prefix}.${mk}.mb_fact`),
            economyTotal: cGetM(`${prefix}.${mk}.economy_total`),
            economyFB: cGetM(`${prefix}.${mk}.economy_fb`),
            economyKB: cGetM(`${prefix}.${mk}.economy_kb`),
            economyMB: cGetM(`${prefix}.${mk}.economy_mb`),
            executionPct: cGetM(`${prefix}.${mk}.execution_pct`) != null
              ? +((cGetM(`${prefix}.${mk}.execution_pct`) as number) * 100).toFixed(1)
              : null,
            execCountPct: cGetM(`${prefix}.${mk}.exec_count_pct`) != null
              ? +((cGetM(`${prefix}.${mk}.exec_count_pct`) as number) * 100).toFixed(1)
              : null,
            compExecCountPct: cGetM(`${prefix}.${mk}.comp_exec_count_pct`) != null
              ? +((cGetM(`${prefix}.${mk}.comp_exec_count_pct`) as number) * 100).toFixed(1)
              : null,
            epExecCountPct: cGetM(`${prefix}.${mk}.ep_exec_count_pct`) != null
              ? +((cGetM(`${prefix}.${mk}.ep_exec_count_pct`) as number) * 100).toFixed(1)
              : null,
            kpCount: cGetM(`${prefix}.kp.${mk}.count`),
            kpFactCount: cGetM(`${prefix}.kp.${mk}.fact`),
            kpPlanTotal: cGetM(`${prefix}.kp.${mk}.total_plan`),
            kpFactTotal: cGetM(`${prefix}.kp.${mk}.total_fact`),
            epCount: cGetM(`${prefix}.ep.${mk}.count`),
            epFactCount: cGetM(`${prefix}.ep.${mk}.fact`),
            epPlanTotal: cGetM(`${prefix}.ep.${mk}.total_plan`),
            epFactTotal: cGetM(`${prefix}.ep.${mk}.total_fact`),
          };
        }
      }

      // Per-department recalculation data (byActivity, subordinates, conflicts)
      const deptRecalc = snapshot.recalcResults?.[dept.id];

      return {
        department: dept,
        months,
        planTotal: planMetric?.numericValue ?? null,
        factTotal: factMetric?.numericValue ?? null,
        executionPercent: executionPct,
        economyTotal: ecoTotal || null,
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
      } as DepartmentSummary;
    });

    // Summary-level aggregates by period (Q1 + Year from СВОД, Q2-Q4 from calculated)
    const summaryByPeriod: Record<string, any> = {};

    // Q1 + Year from official СВОД metrics
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

    // Determine the data year from the year query param or default to current year
    const dataYear = yearParam && yearParam !== 'all' ? parseInt(yearParam, 10) || new Date().getFullYear() : new Date().getFullYear();

    // ── Full issue aggregation (ALL issues, not truncated) ──
    const signalCounts: Record<string, number> = {};
    const issueSummary = {
      total: snapshot.issues.length,
      bySeverity: {} as Record<string, number>,
      byCategory: {} as Record<string, number>,
      byDepartment: {} as Record<string, number>,
      byOrigin: {} as Record<string, number>,
      signalCounts: {} as Record<string, number>,
    };
    for (const iss of snapshot.issues) {
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
      recentIssues: snapshot.issues,
      signalCounts,
      issueSummary,
      trust: snapshot.trust,
      lastRefreshed: snapshot.createdAt,
      year: dataYear,
    } as any;

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
      app.log.warn({ err }, 'Google Sheets unavailable for trust detail, serving demo data');
      snapshot = createDemoSnapshot();
    }

    const deptPrefix = `grbs.${dept.id}`;
    const deptMetricsMap = new Map<string, NormalizedMetric>(
      Object.entries(snapshot.officialMetrics)
        .filter(([key]) => key.startsWith(deptPrefix))
        .map(([key, val]) => [key, val as NormalizedMetric]),
    );
    const deptIssues = snapshot.issues.filter((i: Issue) => i.departmentId === dept.id);
    const deptDeltas = snapshot.deltas.filter(
      (d: DeltaResult) => d.metricKey?.startsWith(deptPrefix),
    );
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

    // Full refresh: load department spreadsheets first (they feed into pipeline recalculation)
    if (!quick) {
      try {
        const { data, errors } = await fetchDepartmentSpreadsheets(DEPARTMENT_SPREADSHEETS);
        setDeptSheetCache(data);

        const loadMeta: Record<string, { loadedAt: string; rowCount: number; sheetName: string; error?: string }> = {};
        const now = new Date().toISOString();
        for (const [deptName, rows] of Object.entries(data)) {
          deptRows[deptName] = rows;
          loadMeta[deptName] = { loadedAt: now, rowCount: rows.length, sheetName: deptName };
          sources.push({ name: deptName, type: 'department', loaded: true, rowCount: rows.length });
        }
        for (const [deptName, errMsg] of Object.entries(errors)) {
          loadMeta[deptName] = { loadedAt: now, rowCount: 0, sheetName: deptName, error: errMsg };
          sources.push({ name: deptName, type: 'department', loaded: false, error: errMsg });
        }
        setDeptLoadMeta(loadMeta);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        app.log.warn('Department sheets load failed: %s', msg);
        for (const deptName of Object.keys(DEPARTMENT_SPREADSHEETS)) {
          sources.push({ name: deptName, type: 'department', loaded: false, error: msg });
        }
      }
    }

    // Load SVOD snapshot (pipeline uses cached dept data for recalculation + deltas)
    invalidateCache();
    let snapshot;
    try {
      snapshot = await getSnapshot(true);
      sources.push({
        name: 'СВОД ТД-ПМ',
        type: 'svod',
        loaded: true,
        rowCount: Object.keys(snapshot.officialMetrics ?? {}).length,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      app.log.warn('SVOD unavailable: %s', msg);
      snapshot = createDemoSnapshot();
      sources.push({ name: 'СВОД ТД-ПМ', type: 'svod', loaded: false, error: msg });
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

  /** POST /api/load-all — alias для /api/refresh (обратная совместимость) */
  app.post('/api/load-all', async (request, reply) => {
    // Forward to /api/refresh (full mode)
    const result = await app.inject({ method: 'POST', url: '/api/refresh' });
    reply.status(result.statusCode).send(result.json());
  });

  /** GET /api/reconciliation — сверка СВОД vs пересчёт по управлениям */
  app.get('/api/reconciliation', async (_request, reply) => {
    let snapshot;
    try {
      snapshot = await getSnapshot();
    } catch {
      snapshot = createDemoSnapshot();
    }

    const calc = snapshot.calculatedMetrics ?? {};

    // Build per-department official and calculated aggregates
    type ReconMetrics = { planTotal: number; factTotal: number; economyTotal: number };
    const officialMap = new Map<string, ReconMetrics>();
    const calculatedMap = new Map<string, ReconMetrics>();

    for (const dept of DEPARTMENTS) {
      const prefix = `grbs.${dept.id}`;
      const oGet = (key: string) => snapshot.officialMetrics[key]?.numericValue ?? 0;
      const cGet = (key: string) => calc[key]?.numericValue ?? 0;

      // Official: КП + ЕП from СВОД cells (both methods combined)
      const offPlan = oGet(`${prefix}.kp.year.total_plan`) + oGet(`${prefix}.ep.year.total_plan`);
      const offFact = oGet(`${prefix}.kp.year.total_fact`) + oGet(`${prefix}.ep.year.total_fact`);
      const offEco = oGet(`${prefix}.economy.kp`) + oGet(`${prefix}.economy.ep`);
      officialMap.set(dept.nameShort, {
        planTotal: offPlan,
        factTotal: offFact,
        economyTotal: offEco,
      });

      // Calculated: year totals (КП + ЕП combined)
      const calcPlan = cGet(`${prefix}.year.plan_total`);
      const calcFact = cGet(`${prefix}.year.fact_total`);
      const calcEco = cGet(`${prefix}.year.economy_total`);
      calculatedMap.set(dept.nameShort, {
        planTotal: calcPlan,
        factTotal: calcFact,
        economyTotal: calcEco,
      });
    }

    const reconSummary = reconcile(officialMap, calculatedMap);

    return reply.send({
      reconciliation: reconSummary,
      snapshotId: snapshot.id,
      createdAt: snapshot.createdAt,
      deltaCount: snapshot.deltas?.length ?? 0,
      calculatedMetricCount: Object.keys(calc).length,
    });
  });

  /**
   * GET /api/export/reconciliation
   * Экспорт сверки в CSV (UTF-8 с BOM для Excel).
   */
  app.get('/api/export/reconciliation', async (_request, reply) => {
    let snapshot;
    try {
      snapshot = await getSnapshot();
    } catch (err) {
      app.log.warn({ err }, 'export/recon: failed to get snapshot');
      return reply.status(503).send({ error: 'Snapshot unavailable' });
    }

    const deltas = snapshot.deltas ?? [];

    const headers = ['Метрика', 'Официальное', 'Расчётное', 'Δ', 'Δ%', 'В допуске', 'Пояснение'];
    const rows = deltas.map((d: any) => [
      d.metricKey ?? d.label ?? '',
      d.officialValue != null ? String(d.officialValue) : '',
      d.calculatedValue != null ? String(d.calculatedValue) : '',
      d.delta != null ? String(d.delta) : '',
      d.deltaPercent != null ? d.deltaPercent.toFixed(1) + '%' : '',
      d.withinTolerance ? 'Да' : 'Нет',
      d.explanation ?? '',
    ]);

    const escapeCsv = (val: string) => {
      if (val.includes(',') || val.includes('"') || val.includes('\n')) {
        return '"' + val.replace(/"/g, '""') + '"';
      }
      return val;
    };

    const csvContent = [
      headers.map(escapeCsv).join(','),
      ...rows.map((row: string[]) => row.map(escapeCsv).join(',')),
    ].join('\r\n');

    const BOM = '\uFEFF';
    reply.header('Content-Type', 'text/csv; charset=utf-8');
    reply.header('Content-Disposition', `attachment; filename="reconciliation_${new Date().toISOString().slice(0, 10)}.csv"`);
    return reply.send(BOM + csvContent);
  });

  /** GET /api/reconciliation/monthly — помесячная сверка расчёта vs ШДЮ */
  app.get('/api/reconciliation/monthly', async (request, reply) => {
    const { dept: filterDept } = request.query as Record<string, string>;

    let snapshot;
    try {
      snapshot = await getSnapshot();
    } catch {
      snapshot = createDemoSnapshot();
    }

    const recalcResults = snapshot.recalcResults ?? {};
    const shdyuData = snapshot.shdyuData ?? {};

    if (Object.keys(shdyuData).length === 0) {
      return reply.send({
        error: null,
        warning: 'ШДЮ данные не загружены. Нажмите «Обновить» для загрузки.',
        rows: [],
        counts: { ok: 0, warning: 0, high: 0, empty: 0 },
        overallStatus: 'Нет данных ШДЮ',
      });
    }

    const deptNames: Record<string, string> = {};
    for (const d of DEPARTMENTS) deptNames[d.id] = d.nameShort;

    const result = reconcileMonthly(recalcResults, shdyuData, deptNames);

    // Optional dept filter
    if (filterDept) {
      result.rows = result.rows.filter(r => r.deptId === filterDept);
    }

    return reply.send(result);
  });

  /** GET /api/reconciliation/quarterly — перекрёстная сверка ШДЮ(Σ3мес) vs СВОД(квартал) */
  app.get('/api/reconciliation/quarterly', async (request, reply) => {
    let snapshot;
    try {
      snapshot = await getSnapshot();
    } catch {
      snapshot = createDemoSnapshot();
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

    return reply.send(crossVerifyQuarterly(shdyuData, recalcResults, deptNames));
  });

}
