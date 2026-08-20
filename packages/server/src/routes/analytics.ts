import type { FastifyInstance } from 'fastify';
import { getSnapshot } from '../services/snapshot.js';
import {
  approvedEconomy,
  buildGRBSProfiles,
  checkEPContractLimits,
  checkAntiDumping,
  checkEPShareLimits,
  analyzeEPReasons,
  buildEpJustificationDept,
  epPlanQuarter,
  type EpJustificationDept,
  benfordAnalysis,
  zScoreAnalysis,
  buildScenarios,
  buildSubjectAnalysis,
  findCentralizationOpportunities,
  GRBS_BASELINES,
  EP_SHARE_BY_ROLE,
  detectAntiCorruption,
  gradeGRBS,
  disciplineIndex,
  type ComplianceIssue,
  type AntiCorruptionRow,
  type AntiCorruptionResult,
} from '@aemr/core';
import { DEPARTMENTS, DEPT_COLUMNS, DEPT_HEADER_ROWS } from '@aemr/shared';
import { getDeptSheetValues } from '../services/snapshot.js';

/**
 * Качество данных управления — доля строк БЕЗ замечаний качества.
 *
 * Раньше здесь стояла константа 0,8 с пометкой «когда появится»: индекс
 * дисциплины на пятую часть состоял из числа, которое никто не считал,
 * и у всех управлений эта пятая часть была одинаковой. Считаем из того,
 * что уже есть в снимке: замечания группы «качество данных» несут адрес
 * управления и номер строки.
 *
 * Строк нет (лист не прочитан) — возвращаем null-эквивалент 1: штрафовать
 * управление за то, что его книга недоступна, значит смешать поломку
 * источника с дисциплиной исполнителя. Это видно отдельным сигналом.
 */
function dataQualityScore(
  issues: readonly { departmentId?: string; group?: string; row?: number }[],
  grbsId: string,
  grbsShort: string,
  rowCount: number,
): number {
  if (rowCount <= 0) return 1;
  const dirtyRows = new Set<number>();
  for (const issue of issues) {
    if (issue.group !== 'data_quality') continue;
    const dept = issue.departmentId;
    if (dept !== grbsId && dept !== grbsShort) continue;
    // Замечание без номера строки относится к листу целиком: считаем его
    // одной проблемной строкой, а не игнорируем — иначе лист с одним
    // общим дефектом выглядел бы безупречным.
    dirtyRows.add(issue.row ?? -1);
  }
  return Math.min(1, Math.max(0, 1 - dirtyRows.size / rowCount));
}

/**
 * Плановые ДЕНЬГИ ЕП за год = Σ ep.planSum по четырём кварталам (тыс. руб.).
 *
 * Одно место на все вызовы: /compliance, /anticorruption и /scorecard передают
 * этот объём в проверки годового лимита и доли ЕП. До свипа БАГ #1 (bug-hunt
 * 2026-08-08) два из трёх вызовов подставляли recalc.totalEP — СЧЁТЧИК процедур,
 * не деньги, и «доля ЕП» считалась как счётчик/деньги.
 */
function epPlanSumOverQuarters(recalc: {
  quarters: Record<'q1' | 'q2' | 'q3' | 'q4', { ep: { planSum: number } }>;
}): number {
  return recalc.quarters.q1.ep.planSum + recalc.quarters.q2.ep.planSum
    + recalc.quarters.q3.ep.planSum + recalc.quarters.q4.ep.planSum;
}

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
          rowIndex: i + DEPT_HEADER_ROWS + 1,
          method: String(row?.[DEPT_COLUMNS.METHOD] ?? '').trim(),
          planTotal: parseFloat(String(row?.[DEPT_COLUMNS.TOTAL_PLAN] ?? 0)) || 0,
          factTotal: parseFloat(String(row?.[DEPT_COLUMNS.TOTAL_FACT] ?? 0)) || 0,
          economy: approvedEconomy(row),
          subject: String(row?.[DEPT_COLUMNS.SUBJECT] ?? '').trim(),
        })).filter((r: any) => r.method === 'ЕП' || r.method === 'ЭА' || r.method === 'ЭК' || r.method === 'ЭЗК');

        // Run checks
        allIssues.push(...checkEPContractLimits(rowData, dept.id));
        allIssues.push(...checkAntiDumping(rowData, dept.id));

        if (recalc && baseline) {
          allIssues.push(...checkEPShareLimits(
            recalc.totalEP,
            recalc.totalCompetitive + recalc.totalEP,
            epPlanSumOverQuarters(recalc),
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

  /**
   * GET /api/analytics/ep-reasons — обоснование закупок у единственного поставщика.
   *
   * Ответ несёт ДВА разбора одних и тех же строк, и это намеренно:
   *   • `byDept` — прежняя рубрикация по предмету закупки (analyzeEPReasons,
   *     колонка G): «что покупали у ЕП»;
   *   • `justification` — степени обоснованности по колонке M через словарь
   *     причин (канон п.98ж): «имел ли заказчик право так закупать». Здесь же
   *     кварталы плана — из них вкладка «Конкуренция» строит динамику
   *     снижения ЕП и особенно НЕобоснованного ЕП.
   *
   * Отдельного роута ради второго разбора не заводим: источник строк один и
   * тот же лист, а два запроса за одним и тем же кэшем — лишняя работа.
   */
  app.get('/api/analytics/ep-reasons', async (_request, reply) => {
    try {
      const deptCache = getDeptSheetValues();
      const result: Record<string, any> = {};
      const justificationByDept: Record<string, EpJustificationDept> = {};
      let rowsScanned = 0;

      for (const dept of DEPARTMENTS) {
        const rows = deptCache[dept.nameShort];
        if (!rows || rows.length === 0) continue;

        const body = rows.slice(DEPT_HEADER_ROWS);
        const rowData = body.map((row: any, i: number) => ({
          rowIndex: i + DEPT_HEADER_ROWS + 1,
          method: String(row?.[DEPT_COLUMNS.METHOD] ?? '').trim(),
          planTotal: parseFloat(String(row?.[DEPT_COLUMNS.TOTAL_PLAN] ?? 0)) || 0,
          factTotal: 0,
          economy: 0,
          subject: String(row?.[DEPT_COLUMNS.SUBJECT] ?? '').trim(),
        }));

        result[dept.id] = analyzeEPReasons(rowData);

        // Причина ЕП читается СЫРОЙ: словарь ep-reason-clusters нормализует
        // текст сам, а обрезка/приведение здесь скрыли бы часть совпадений.
        justificationByDept[dept.id] = buildEpJustificationDept(
          body.map((row: any) => ({
            method: row?.[DEPT_COLUMNS.METHOD],
            reason: row?.[DEPT_COLUMNS.EP_REASON],
            planTotal: parseFloat(String(row?.[DEPT_COLUMNS.TOTAL_PLAN] ?? 0)) || 0,
            quarter: epPlanQuarter(row?.[DEPT_COLUMNS.PLAN_QUARTER]),
          })),
        );
        rowsScanned += body.length;
      }

      return {
        byDept: result,
        justification: {
          byDept: justificationByDept,
          rowsScanned,
          /** Момент чтения книг (канон п.58): число обязано называть свой срок. */
          readAt: new Date().toISOString(),
        },
      };
    } catch (err) {
      app.log.error({ err }, 'Analytics ep-reasons unavailable');
      return reply.status(503).send({ error: 'Analytics unavailable - data source error' });
    }
  });

  /** GET /api/analytics/anticorruption — антикор-индикаторы (Layer C decision-engine) per ГРБС */
  app.get('/api/analytics/anticorruption', async (_request, reply) => {
    try {
      const snapshot = await getSnapshot();
      const recalcResults = snapshot.recalcResults ?? {};
      const deptCache = getDeptSheetValues();
      const result: Record<string, AntiCorruptionResult> = {};
      for (const dept of DEPARTMENTS) {
        const rows = deptCache[dept.nameShort];
        if (!rows || rows.length === 0) continue;
        const rowData: AntiCorruptionRow[] = rows.slice(DEPT_HEADER_ROWS).map((row: any, i: number) => ({
          rowIndex: i + DEPT_HEADER_ROWS + 1,
          method: String(row?.[DEPT_COLUMNS.METHOD] ?? '').trim(),
          planTotal: parseFloat(String(row?.[DEPT_COLUMNS.TOTAL_PLAN] ?? 0)) || 0,
          factTotal: parseFloat(String(row?.[DEPT_COLUMNS.TOTAL_FACT] ?? 0)) || 0,
          economy: approvedEconomy(row),
          subject: String(row?.[DEPT_COLUMNS.SUBJECT] ?? '').trim(),
        }));
        const recalc = recalcResults[dept.id] as any;
        const baseline = GRBS_BASELINES.find(b => b.grbsId === dept.id);
        const epShareLimit = baseline ? EP_SHARE_BY_ROLE[baseline.role] : 0.5;
        // Свип БАГ #1 (bug-hunt 2026-08-08, гейты денег): в epTotal передавался
        // recalc.totalEP — это СЧЁТЧИК процедур ЕП, а totalPlan — деньги (тыс. руб.).
        // Доля «счётчик/деньги» — бессмыслица: индикатор #9 (годовая доля ЕП)
        // молчал или срабатывал случайно. Деньги ЕП = Σ ep.planSum по кварталам
        // (тот же источник, что в /compliance выше).
        result[dept.id] = detectAntiCorruption(dept.id, {
          rows: rowData,
          epTotal: recalc ? epPlanSumOverQuarters(recalc) : 0,
          totalPlan: recalc?.year?.planTotal ?? 0,
          epShareLimit,
        });
      }
      return result;
    } catch (err) {
      app.log.error({ err }, 'Anticorruption analysis unavailable');
      return reply.status(503).send({ error: 'Analytics unavailable - data source error' });
    }
  });

  /** GET /api/analytics/scorecard — единая карточка ГРБС: грейд A-B-C-D + дисциплина 0-100 + антикор (Layers A+B+C) */
  app.get('/api/analytics/scorecard', async (_request, reply) => {
    try {
      const snapshot = await getSnapshot();
      const recalcResults = snapshot.recalcResults ?? {};
      const deptCache = getDeptSheetValues();
      const profiles = buildGRBSProfiles(recalcResults);
      const c01 = (v: number) => Math.min(1, Math.max(0, v));
      const result: Record<string, unknown> = {};

      for (const profile of profiles) {
        const rows = deptCache[profile.grbsShort] ?? [];
        const rowData: AntiCorruptionRow[] = rows.slice(DEPT_HEADER_ROWS).map((row: any, i: number) => ({
          rowIndex: i + DEPT_HEADER_ROWS + 1,
          method: String(row?.[DEPT_COLUMNS.METHOD] ?? '').trim(),
          planTotal: parseFloat(String(row?.[DEPT_COLUMNS.TOTAL_PLAN] ?? 0)) || 0,
          factTotal: parseFloat(String(row?.[DEPT_COLUMNS.TOTAL_FACT] ?? 0)) || 0,
          economy: approvedEconomy(row),
          subject: String(row?.[DEPT_COLUMNS.SUBJECT] ?? '').trim(),
        }));

        const recalc = recalcResults[profile.grbsId] as any;
        const epShareLimit = EP_SHARE_BY_ROLE[profile.role];

        // нарушения 44-ФЗ (для грейда + complianceScore)
        const violations =
          checkEPContractLimits(rowData.filter(r => r.method === 'ЕП'), profile.grbsId).length +
          checkAntiDumping(rowData.filter(r => r.method !== 'ЕП'), profile.grbsId).length;

        // аномалии (Бенфорд по суммам, p<0.05 = значимое отклонение)
        const amounts = rowData.map(r => r.planTotal).filter(v => v > 0);
        const benford = amounts.length >= 30 ? benfordAnalysis(amounts) : null;
        const anomalyCount = benford && benford.pValue < 0.05 ? 1 : 0;

        // Layer C — антикор. epTotal — ДЕНЬГИ ЕП (тыс. руб.), не счётчик:
        // см. комментарий у /api/analytics/anticorruption (свип БАГ #1).
        const anticorruption = detectAntiCorruption(profile.grbsId, {
          rows: rowData,
          epTotal: recalc ? epPlanSumOverQuarters(recalc) : 0,
          totalPlan: recalc?.year?.planTotal ?? 0,
          epShareLimit,
        });

        // Волна 0: профиль честно отдаёт null, когда счётной базы нет
        // («нет плана» ≠ «исполнение 0 %»). Оценивать управление без базы
        // нельзя — вместо вымышленного грейда отдаём честную пустоту.
        if (
          profile.actualExecQ1 === null ||
          profile.actualEpShare === null ||
          profile.execDeviation === null
        ) {
          result[profile.grbsId] = {
            grbsShort: profile.grbsShort,
            role: profile.role,
            noData: true,
            noDataReason: 'Счётных строк за период нет — оценка не выдаётся.',
          };
          continue;
        }

        // Layer A — грейд
        const grade = gradeGRBS({
          execPct: profile.actualExecQ1,
          expectedExecPct: profile.expectedExecQ1,
          anomalyCount,
          epShare: profile.actualEpShare,
          epShareLimit,
          complianceViolations: violations,
        });

        // Layer B — индекс дисциплины (метрики → 0-1 scores)
        const discipline = disciplineIndex({
          execScore: c01(profile.actualExecQ1 / Math.max(profile.expectedExecQ1, 0.01)),
          dynamicsScore: c01(0.6 + profile.execDeviation),
          epScore: profile.actualEpShare <= epShareLimit ? 1 : c01(1 - (profile.actualEpShare - epShareLimit) / epShareLimit),
          dataScore: dataQualityScore(snapshot.issues, profile.grbsId, profile.grbsShort, rowData.length),
          anomalyScore: c01(1 - anomalyCount * 0.3),
          complianceScore: c01(1 - violations * 0.15),
          anticorruptionPenalty: anticorruption.disciplinaryPenalty,
        });

        result[profile.grbsId] = {
          grbsShort: profile.grbsShort,
          role: profile.role,
          grade: grade.grade,
          gradeScore: grade.score,
          gradeReasons: grade.reasons,
          discipline: discipline.index,
          mode: discipline.mode,
          dominantFactor: discipline.dominantFactor,
          narrative: discipline.narrative,
          anticorruptionFlags: anticorruption.flags.length,
          topFlags: anticorruption.flags.slice(0, 3),
          execPct: profile.actualExecQ1,
          epShare: profile.actualEpShare,
          riskLevel: profile.riskLevel,
        };
      }
      return result;
    } catch (err) {
      app.log.error({ err }, 'Scorecard unavailable');
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

      const allMonths: number[] = [];
      for (let m = 1; m <= 12; m++) {
        allMonths.push(recalc.months?.[m]?.factTotal ?? 0);
      }
      // forecast.* проецируют ХВОСТ (месяцы ПОСЛЕ данных) циклом from monthlyFacts.length to 12.
      // Если передать padded-12 массив, цикл не выполняется и прогноз вырождается в текущий YTD
      // (особенно seasonalForecast). Обрезаем хвостовые нули → передаём только истёкшие месяцы.
      const lastData = allMonths.reduce((last, v, i) => (v > 0 ? i : last), -1);
      const monthlyFacts = lastData >= 0 ? allMonths.slice(0, lastData + 1) : allMonths;

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

      // ЕП включены по умолчанию (страж §5.2): одинаковые предметы у разных
      // заказчиков без торгов — главный кандидат на общий конкурс.
      const opportunities = findCentralizationOpportunities(allRows);
      const totalAmount = opportunities.reduce((s, o) => s + o.totalAmount, 0);
      const totalEpAmount = opportunities.reduce((s, o) => s + o.epAmount, 0);

      return {
        opportunities,
        totalOpportunities: opportunities.length,
        /** Суммарный объём всех групп, тыс. ₽ — факт из строк, не оценка. */
        totalAmount,
        /** Из него без торгов (ЕП), тыс. ₽. */
        totalEpAmount,
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
