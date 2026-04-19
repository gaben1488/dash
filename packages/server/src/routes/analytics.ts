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
import { getDeptSheetValues } from '../services/snapshot.js';

export async function analyticsRoutes(app: FastifyInstance): Promise<void> {

  /** GET /api/analytics/profiles — ГРБС profiles with role/baseline assessment */
  app.get('/api/analytics/profiles', async (_request, reply) => {
    try {
      const snapshot = await getSnapshot();
      const recalcResults = snapshot.recalcResults ?? {};
      const profiles = buildGRBSProfiles(recalcResults);
      return { profiles };
    } catch (err) {
      app.log.error({ err }, 'Analytics profiles unavailable');
      return reply.status(503).send({ error: 'Analytics unavailable - data source error' });
    }
  });

  /** GET /api/analytics/compliance — 44-ФЗ compliance violations */
  app.get('/api/analytics/compliance', async (_request, reply) => {
    try {
      const snapshot = await getSnapshot();
      const recalcResults = snapshot.recalcResults ?? {};
      const deptCache = getDeptSheetValues();
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
            (parseFloat(String(row?.[DEPT_COLUMNS.ECONOMY_FB] ?? 0)) || 0) +
            (parseFloat(String(row?.[DEPT_COLUMNS.ECONOMY_KB] ?? 0)) || 0) +
            (parseFloat(String(row?.[DEPT_COLUMNS.ECONOMY_MB] ?? 0)) || 0)
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
    } catch (err) {
      app.log.error({ err }, 'Analytics compliance unavailable');
      return reply.status(503).send({ error: 'Analytics unavailable - data source error' });
    }
  });

  /** GET /api/analytics/ep-reasons — EP reason breakdown per department */
  app.get('/api/analytics/ep-reasons', async (_request, reply) => {
    try {
      const deptCache = getDeptSheetValues();
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
    } catch (err) {
      app.log.error({ err }, 'Analytics ep-reasons unavailable');
      return reply.status(503).send({ error: 'Analytics unavailable - data source error' });
    }
  });

  /** GET /api/analytics/anomalies — Benford + Z-score analysis */
  app.get('/api/analytics/anomalies', async (_request, reply) => {
    try {
      const snapshot = await getSnapshot();
      const recalcResults = snapshot.recalcResults ?? {};
      const deptCache = getDeptSheetValues();

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
    } catch (err) {
      app.log.error({ err }, 'Analytics anomalies unavailable');
      return reply.status(503).send({ error: 'Analytics unavailable - data source error' });
    }
  });

  /** GET /api/analytics/forecast/:deptId — Forecast scenarios for a department */
  app.get('/api/analytics/forecast/:deptId', async (request, reply) => {
    try {
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
    } catch (err) {
      app.log.error({ err }, 'Analytics forecast unavailable');
      return reply.status(503).send({ error: 'Analytics unavailable - data source error' });
    }
  });

  /** GET /api/analytics/subjects — Subject category analysis */
  app.get('/api/analytics/subjects', async (_request, reply) => {
    try {
      const deptCache = getDeptSheetValues();
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
    } catch (err) {
      app.log.error({ err }, 'Analytics subjects unavailable');
      return reply.status(503).send({ error: 'Analytics unavailable - data source error' });
    }
  });

  /** GET /api/analytics/centralization — Cross-ГРБС consolidation opportunities */
  app.get('/api/analytics/centralization', async (_request, reply) => {
    try {
      const deptCache = getDeptSheetValues();
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
    } catch (err) {
      app.log.error({ err }, 'Analytics centralization unavailable');
      return reply.status(503).send({ error: 'Analytics unavailable - data source error' });
    }
  });

  /** GET /api/cell-refs — Cell coordinate reference table */
  app.get('/api/cell-refs', async (request, reply) => {
    try {
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
    } catch (err) {
      app.log.error({ err }, 'Cell refs unavailable');
      return reply.status(503).send({ error: 'Analytics unavailable - data source error' });
    }
  });
}
