import type { FastifyInstance } from 'fastify';
import { getSnapshot } from '../services/snapshot.js';
import {
  buildGRBSProfiles,
  checkEPContractLimits,
  checkAntiDumping,
  checkEPShareLimits,
  analyzeEPReasons,
  benfordAnalysis,
  zScoreAnalysis,
  buildScenarios,
  buildSubjectAnalysis,
  findCentralizationOpportunities,
  GRBS_BASELINES,
  type ComplianceIssue,
} from '@aemr/core';
import { DEPARTMENTS, DEPT_COLUMNS, DEPT_HEADER_ROWS } from '@aemr/shared';
import { getDeptSheetCache } from '../services/snapshot.js';

export async function analyticsRoutes(app: FastifyInstance): Promise<void> {

  /** GET /api/analytics/profiles — ГРБС profiles with role/baseline assessment */
  app.get('/api/analytics/profiles', async (_request, _reply) => {
    const snapshot = await getSnapshot();
    const recalcResults = snapshot.recalcResults ?? {};
    const profiles = buildGRBSProfiles(recalcResults);
    return { profiles };
  });

  /** GET /api/analytics/compliance — 44-ФЗ compliance violations */
  app.get('/api/analytics/compliance', async (_request, _reply) => {
    const snapshot = await getSnapshot();
    const recalcResults = snapshot.recalcResults ?? {};
    const deptCache = getDeptSheetCache();
    const allIssues: ComplianceIssue[] = [];

    for (const dept of DEPARTMENTS) {
      const rows = deptCache[dept.nameShort];
      if (!rows || rows.length === 0) continue;

      const recalc = recalcResults[dept.id];
      const baseline = GRBS_BASELINES.find(b => b.grbsId === dept.id);

      // Extract row data for compliance checks
      const rowData = rows.slice(DEPT_HEADER_ROWS).map((row: any, i: number) => ({
        rowIndex: i + 3,
        method: String(row?.[DEPT_COLUMNS.METHOD] ?? '').trim(),
        planTotal: parseFloat(String(row?.[DEPT_COLUMNS.TOTAL_PLAN] ?? 0)) || 0,
        factTotal: parseFloat(String(row?.[DEPT_COLUMNS.TOTAL_FACT] ?? 0)) || 0,
        economy: Math.max(0,
          (parseFloat(String(row?.[DEPT_COLUMNS.MB_PLAN] ?? 0)) || 0) -
          (parseFloat(String(row?.[DEPT_COLUMNS.MB_FACT] ?? 0)) || 0)
        ),
        subject: String(row?.[DEPT_COLUMNS.SUBJECT] ?? '').trim(),
      })).filter((r: any) => r.method === 'ЕП' || r.method === 'ЭА' || r.method === 'ЭК' || r.method === 'ЭЗК');

      // Run checks
      allIssues.push(...checkEPContractLimits(rowData, dept.id));
      allIssues.push(...checkAntiDumping(rowData, dept.id));

      if (recalc && baseline) {
        allIssues.push(...checkEPShareLimits(
          recalc.totalEP,
          recalc.totalCompetitive + recalc.totalEP,
          recalc.quarters.q1.ep.planSum + recalc.quarters.q2.ep.planSum +
          recalc.quarters.q3.ep.planSum + recalc.quarters.q4.ep.planSum,
          recalc.year.planTotal,
          baseline.role,
          dept.id,
        ));
      }
    }

    return {
      totalIssues: allIssues.length,
      critical: allIssues.filter(i => i.severity === 'critical').length,
      warnings: allIssues.filter(i => i.severity === 'warning').length,
      issues: allIssues,
    };
  });

  /** GET /api/analytics/ep-reasons — EP reason breakdown per department */
  app.get('/api/analytics/ep-reasons', async (_request, _reply) => {
    const deptCache = getDeptSheetCache();
    const result: Record<string, any> = {};

    for (const dept of DEPARTMENTS) {
      const rows = deptCache[dept.nameShort];
      if (!rows || rows.length === 0) continue;

      const rowData = rows.slice(DEPT_HEADER_ROWS).map((row: any, i: number) => ({
        rowIndex: i + 3,
        method: String(row?.[DEPT_COLUMNS.METHOD] ?? '').trim(),
        planTotal: parseFloat(String(row?.[DEPT_COLUMNS.TOTAL_PLAN] ?? 0)) || 0,
        factTotal: 0,
        economy: 0,
        subject: String(row?.[DEPT_COLUMNS.SUBJECT] ?? '').trim(),
      }));

      result[dept.id] = analyzeEPReasons(rowData);
    }

    return result;
  });

  /** GET /api/analytics/anomalies — Benford + Z-score analysis */
  app.get('/api/analytics/anomalies', async (_request, _reply) => {
    const snapshot = await getSnapshot();
    const recalcResults = snapshot.recalcResults ?? {};
    const deptCache = getDeptSheetCache();

    // Benford analysis per department
    const benfordResults: Record<string, any> = {};
    for (const dept of DEPARTMENTS) {
      const rows = deptCache[dept.nameShort];
      if (!rows || rows.length === 0) continue;

      const amounts = rows.slice(DEPT_HEADER_ROWS)
        .map((row: any) => parseFloat(String(row?.[DEPT_COLUMNS.TOTAL_PLAN] ?? 0)) || 0)
        .filter((v: number) => v > 0);

      benfordResults[dept.id] = benfordAnalysis(amounts);
    }

    // Z-score analysis: execution % across departments
    const execValues: Record<string, number> = {};
    for (const [deptId, recalc] of Object.entries(recalcResults)) {
      if ((recalc as any).quarters?.q1?.executionPct != null) {
        execValues[deptId] = (recalc as any).quarters.q1.executionPct;
      }
    }
    const executionOutliers = zScoreAnalysis(execValues);

    // Z-score: EP share across departments
    const epShareValues: Record<string, number> = {};
    for (const [deptId, recalc] of Object.entries(recalcResults)) {
      if ((recalc as any).epSharePct != null) {
        epShareValues[deptId] = (recalc as any).epSharePct;
      }
    }
    const epShareOutliers = zScoreAnalysis(epShareValues);

    return {
      benford: benfordResults,
      executionOutliers,
      epShareOutliers,
    };
  });

  /** GET /api/analytics/forecast/:deptId — Forecast scenarios for a department */
  app.get('/api/analytics/forecast/:deptId', async (request, _reply) => {
    const { deptId } = request.params as { deptId: string };
    const snapshot = await getSnapshot();
    const recalcResults = snapshot.recalcResults ?? {};
    const recalc = recalcResults[deptId] as any;

    if (!recalc) {
      return { error: `No data for department ${deptId}` };
    }

    const monthlyFacts: number[] = [];
    for (let m = 1; m <= 12; m++) {
      monthlyFacts.push(recalc.months?.[m]?.factTotal ?? 0);
    }

    const baseline = GRBS_BASELINES.find(b => b.grbsId === deptId);
    const forecast = buildScenarios(monthlyFacts, recalc.year.planTotal, baseline);

    return forecast;
  });

  /** GET /api/analytics/subjects — Subject category analysis */
  app.get('/api/analytics/subjects', async (_request, _reply) => {
    const deptCache = getDeptSheetCache();
    const result: Record<string, any> = {};

    for (const dept of DEPARTMENTS) {
      const rows = deptCache[dept.nameShort];
      if (!rows || rows.length === 0) continue;

      const rowData = rows.slice(DEPT_HEADER_ROWS)
        .map((row: any) => ({
          subject: String(row?.[DEPT_COLUMNS.SUBJECT] ?? '').trim(),
          planTotal: parseFloat(String(row?.[DEPT_COLUMNS.TOTAL_PLAN] ?? 0)) || 0,
        }))
        .filter((r: any) => r.subject.length > 0);

      result[dept.id] = buildSubjectAnalysis(rowData);
    }

    return result;
  });

  /** GET /api/analytics/centralization — Cross-ГРБС consolidation opportunities */
  app.get('/api/analytics/centralization', async (_request, _reply) => {
    const deptCache = getDeptSheetCache();
    const allRows: Array<{ grbsId: string; subject: string; planTotal: number; method: string }> = [];

    for (const dept of DEPARTMENTS) {
      const rows = deptCache[dept.nameShort];
      if (!rows || rows.length === 0) continue;

      for (let i = DEPT_HEADER_ROWS; i < rows.length; i++) {
        const row = rows[i] as any[];
        if (!row) continue;
        const method = String(row[DEPT_COLUMNS.METHOD] ?? '').trim();
        if (!method) continue;
        allRows.push({
          grbsId: dept.id,
          subject: String(row[DEPT_COLUMNS.SUBJECT] ?? '').trim(),
          planTotal: parseFloat(String(row[DEPT_COLUMNS.TOTAL_PLAN] ?? 0)) || 0,
          method,
        });
      }
    }

    const opportunities = findCentralizationOpportunities(allRows);
    const totalSavings = opportunities.reduce((s, o) => s + o.potentialSavings, 0);

    return {
      opportunities,
      totalOpportunities: opportunities.length,
      totalPotentialSavings: totalSavings,
    };
  });

  /** GET /api/cell-refs — Cell coordinate reference table */
  app.get('/api/cell-refs', async (request, _reply) => {
    const { dept: deptFilter } = request.query as { dept?: string };
    const snapshot = await getSnapshot();
    const { REPORT_MAP } = await import('@aemr/shared');

    const spreadsheetId = snapshot.spreadsheetId;
    const refs = REPORT_MAP
      .filter((entry: any) => !deptFilter || entry.metricKey.includes(deptFilter))
      .map((entry: any) => {
        const official = snapshot.officialMetrics[entry.metricKey];
        const calculated = snapshot.calculatedMetrics?.[entry.metricKey];
        const delta = snapshot.deltas.find((d: any) => d.metricKey === entry.metricKey);
        const issues = snapshot.issues.filter((i: any) => i.metricKey === entry.metricKey);

        let status: 'ok' | 'warning' | 'error' | 'missing' = 'ok';
        if (!official) status = 'missing';
        else if (delta && !delta.withinTolerance) status = Math.abs(delta.deltaPercent ?? 0) > 10 ? 'error' : 'warning';
        else if (issues.length > 0) status = 'warning';

        const sheetUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit#gid=0&range=${entry.sourceCell}`;

        return {
          metricKey: entry.metricKey,
          label: entry.label,
          sourceSheet: entry.sourceSheet,
          sourceCell: entry.sourceCell,
          googleSheetsUrl: sheetUrl,
          officialValue: official?.numericValue ?? null,
          calculatedValue: calculated?.numericValue ?? null,
          delta: delta?.delta ?? null,
          deltaPercent: delta?.deltaPercent ?? null,
          status,
          issueCount: issues.length,
          problem: delta && !delta.withinTolerance
            ? `Расхождение: пересчёт ${calculated?.displayValue ?? '—'}, в ячейке ${official?.displayValue ?? '—'} (${delta.deltaPercent?.toFixed(1)}%)`
            : null,
        };
      });

    return { refs, total: refs.length };
  });
}
