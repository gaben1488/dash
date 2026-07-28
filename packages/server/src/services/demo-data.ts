import { REPORT_MAP, SVOD_SHEET_NAME } from '@aemr/shared';
import type {
  DataSnapshot,
  NormalizedMetric,
  DeltaResult,
  Issue,
  TrustScore,
  TrustComponent,
  PeriodScope,
} from '@aemr/shared';

// ============================================================
// Demo / Mock Data Generator
// ============================================================

const DEMO_SNAPSHOT_ID = 'demo-snapshot-001';
const DEMO_SPREADSHEET_ID = 'demo-spreadsheet-no-credentials';

/**
 * Realistic mock values for each metric key.
 * Currency values are in thousand_rubles (тыс. руб.) unless otherwise noted.
 */
const METRIC_VALUES: Record<string, { value: number; display: string }> = {
  // --- Competitive procedures ---
  'competitive.year.count':       { value: 347, display: '347' },
  'competitive.year.sum_total':   { value: 2_845_120.5, display: '2 845 120,50' },
  'competitive.year.sum_fb':      { value: 1_126_340.0, display: '1 126 340,00' },
  'competitive.year.sum_kb':      { value: 984_210.3, display: '984 210,30' },
  'competitive.year.sum_mb':      { value: 734_570.2, display: '734 570,20' },
  'competitive.year.economy':     { value: 312_480.7, display: '312 480,70' },

  // --- Execution ---
  'execution.q1.percent':         { value: 0.742, display: '74,2%' },
  'execution.q1.deviation':       { value: -48_320.0, display: '-48 320,00' },

  // --- GRBS: УФБП ---
  'grbs.ufbp.q1.percent':        { value: 0.813, display: '81,3%' },
  'grbs.ufbp.plan':              { value: 456_780.0, display: '456 780,00' },
  'grbs.ufbp.fact':              { value: 371_260.0, display: '371 260,00' },
  'grbs.ufbp.economy_mb':        { value: 28_450.3, display: '28 450,30' },

  // --- GRBS: УИО ---
  'grbs.uio.q1.percent':         { value: 0.687, display: '68,7%' },
  'grbs.uio.plan':               { value: 312_400.0, display: '312 400,00' },
  'grbs.uio.fact':               { value: 214_620.0, display: '214 620,00' },

  // --- GRBS: УО ---
  'grbs.uo.q1.percent':          { value: 0.791, display: '79,1%' },
  'grbs.uo.plan':                { value: 589_340.0, display: '589 340,00' },
  'grbs.uo.fact':                { value: 466_170.0, display: '466 170,00' },
  'grbs.uo.economy_mb':          { value: 41_230.6, display: '41 230,60' },

  // --- GRBS: УЭР ---
  'grbs.uer.q1.percent':         { value: 0.856, display: '85,6%' },
  'grbs.uer.economy_mb':         { value: 19_870.4, display: '19 870,40' },

  // --- GRBS: УДТХ ---
  'grbs.udtx.q1.percent':        { value: 0.623, display: '62,3%' },
  'grbs.udtx.economy_mb':        { value: 54_310.8, display: '54 310,80' },

  // --- GRBS: УКСиМП ---
  'grbs.uksimp.q1.percent':      { value: 0.718, display: '71,8%' },

  // --- GRBS: УАГЗО ---
  'grbs.uagzo.q1.percent':       { value: 0.894, display: '89,4%' },

  // --- GRBS: УД ---
  'grbs.ud.q1.percent':          { value: 0.765, display: '76,5%' },
};

function buildOfficialMetrics(): Record<string, NormalizedMetric> {
  const now = new Date().toISOString();
  const metrics: Record<string, NormalizedMetric> = {};

  for (const entry of REPORT_MAP) {
    const mock = METRIC_VALUES[entry.metricKey];
    if (!mock) continue;

    metrics[entry.metricKey] = {
      metricKey: entry.metricKey,
      value: mock.value,
      numericValue: mock.value,
      displayValue: mock.display,
      origin: entry.originType,
      period: entry.period,
      unit: entry.displayUnit,
      sourceSheet: entry.sourceSheet,
      sourceCell: entry.sourceCell,
      formula: null,
      confidence: 0.92 + Math.random() * 0.07, // 0.92–0.99
      readAt: now,
      warnings: [],
    };
  }

  return metrics;
}

function buildCalculatedMetrics(
  official: Record<string, NormalizedMetric>,
): Record<string, NormalizedMetric> {
  const calculated: Record<string, NormalizedMetric> = {};

  for (const [key, metric] of Object.entries(official)) {
    if (metric.numericValue === null) continue;

    // Introduce small deviations for some metrics to make deltas interesting
    const deviationFactors: Record<string, number> = {
      'competitive.year.sum_total': 1.012,   // +1.2%
      'grbs.ufbp.fact':            0.987,    // -1.3%
      'grbs.uio.fact':             1.034,    // +3.4% — will be outside tolerance
      'execution.q1.percent':      0.998,    // -0.2%
    };

    const factor = deviationFactors[key] ?? 1.0;

    calculated[key] = {
      ...metric,
      origin: 'calculated',
      numericValue: Math.round(metric.numericValue * factor * 100) / 100,
      displayValue: metric.displayValue, // keep the same format for simplicity
      confidence: Math.max(0.7, metric.confidence - 0.05),
    };
  }

  return calculated;
}

function buildDeltas(
  official: Record<string, NormalizedMetric>,
  calculated: Record<string, NormalizedMetric>,
): DeltaResult[] {
  const deltas: DeltaResult[] = [];

  for (const entry of REPORT_MAP) {
    const off = official[entry.metricKey];
    const calc = calculated[entry.metricKey];
    if (!off || !calc || off.numericValue === null || calc.numericValue === null) continue;

    const delta = calc.numericValue - off.numericValue;
    const deltaPercent =
      off.numericValue !== 0
        ? (delta / Math.abs(off.numericValue)) * 100
        : null;

    const tolerance = entry.tolerance ?? 0.01;
    const withinTolerance = deltaPercent !== null ? Math.abs(deltaPercent) <= tolerance * 100 : true;

    deltas.push({
      metricKey: entry.metricKey,
      label: entry.label,
      officialValue: off.numericValue,
      calculatedValue: calc.numericValue,
      delta: Math.round(delta * 100) / 100,
      deltaPercent: deltaPercent !== null ? Math.round(deltaPercent * 10) / 10 : null,
      withinTolerance,
      explanation: withinTolerance
        ? 'Значения в пределах допуска'
        : `Расхождение ${deltaPercent !== null ? deltaPercent.toFixed(1) : '?'}% превышает допуск ${(tolerance * 100).toFixed(0)}%`,
    });
  }

  return deltas;
}

function buildIssues(): Issue[] {
  const now = new Date().toISOString();

  return [
    {
      id: 'demo-issue-001',
      severity: 'critical',
      origin: 'delta_mismatch',
      category: 'Расхождение данных',
      title: 'Существенное расхождение факта УИО',
      description:
        'Значение факта по УИО из сводного листа расходится с построчным пересчётом на 3,4%. Возможна ошибка в формуле ячейки E72.',
      sheet: SVOD_SHEET_NAME,
      cell: 'E72',
      metricKey: 'grbs.uio.fact',
      departmentId: 'uio',
      recommendation: 'Проверить формулу суммирования в ячейке E72 и сопоставить с детальными строками листа УИО.',
      status: 'open',
      detectedAt: now,
      detectedBy: 'delta-checker',
    },
    {
      id: 'demo-issue-002',
      severity: 'significant',
      origin: 'spreadsheet_rule',
      category: 'Нарушение правила таблицы',
      title: 'Нарушена формула суммирования в УДТХ',
      description:
        'Контрольная сумма итоговой строки УДТХ не совпадает с суммой детальных строк. Разница составляет 127,5 тыс. руб.',
      sheet: 'УДТХ',
      cell: 'K210',
      departmentId: 'udtx',
      recommendation: 'Восстановить формулу =SUM(K195:K209) в ячейке K210.',
      status: 'open',
      detectedAt: now,
      detectedBy: 'rule-validator',
    },
    {
      id: 'demo-issue-003',
      severity: 'warning',
      origin: 'bi_heuristic',
      category: 'Аналитическое наблюдение',
      title: 'Низкий процент исполнения УДТХ (62,3%)',
      description:
        'Процент исполнения плана закупок УДТХ за 1 квартал составляет 62,3%, что ниже порога 70%. Рекомендуется усилить контроль за размещением процедур.',
      sheet: SVOD_SHEET_NAME,
      cell: 'G195',
      metricKey: 'grbs.udtx.q1.percent',
      departmentId: 'udtx',
      recommendation: 'Запросить у УДТХ пояснение о причинах отставания и план-график оставшихся процедур.',
      status: 'open',
      detectedAt: now,
      detectedBy: 'heuristic-engine',
    },
    {
      id: 'demo-issue-004',
      severity: 'warning',
      origin: 'bi_heuristic',
      category: 'Аналитическое наблюдение',
      title: 'Низкий процент исполнения УИО (68,7%)',
      description:
        'Процент исполнения плана закупок УИО за 1 квартал составляет 68,7%, что ниже порога 70%.',
      sheet: SVOD_SHEET_NAME,
      cell: 'G72',
      metricKey: 'grbs.uio.q1.percent',
      departmentId: 'uio',
      recommendation: 'Обратить внимание на отставание УИО и уточнить статус отложенных процедур.',
      status: 'open',
      detectedAt: now,
      detectedBy: 'heuristic-engine',
    },
    {
      id: 'demo-issue-005',
      severity: 'significant',
      origin: 'mapping_error',
      category: 'Ошибка привязки данных',
      title: 'Пустое значение экономии МБ для УИО',
      description:
        'Ячейка U77 (экономия МБ по УИО) содержит пустое значение. В маппинге метрика grbs.uio.economy_mb ожидает числовое значение.',
      sheet: SVOD_SHEET_NAME,
      cell: 'U77',
      departmentId: 'uio',
      recommendation: 'Проверить, заполнена ли ячейка U77 или экономия МБ по УИО действительно нулевая.',
      status: 'open',
      detectedAt: now,
      detectedBy: 'mapper',
    },
    {
      id: 'demo-issue-006',
      severity: 'info',
      origin: 'bi_heuristic',
      category: 'Аналитическое наблюдение',
      title: 'Общее отклонение 1 кв отрицательное',
      description:
        'Отклонение исполнения за 1 квартал составляет -48 320 тыс. руб. Это означает недовыполнение общего плана закупок.',
      sheet: SVOD_SHEET_NAME,
      cell: 'F9',
      metricKey: 'execution.q1.deviation',
      recommendation: 'Информационное. Мониторить динамику отклонения во 2 квартале.',
      status: 'acknowledged',
      detectedAt: now,
      detectedBy: 'heuristic-engine',
    },
    {
      id: 'demo-issue-007',
      severity: 'info',
      origin: 'bi_heuristic',
      category: 'Аналитическое наблюдение',
      title: 'Высокий процент УАГЗО (89,4%)',
      description:
        'УАГЗО показывает наилучший процент исполнения 1 кв — 89,4%. Можно использовать как эталон.',
      sheet: SVOD_SHEET_NAME,
      cell: 'G102',
      metricKey: 'grbs.uagzo.q1.percent',
      departmentId: 'uagzo',
      recommendation: 'Информационное. Положительный пример для совещания.',
      status: 'acknowledged',
      detectedAt: now,
      detectedBy: 'heuristic-engine',
    },
  ];
}

function buildTrustScore(issues: Issue[]): TrustScore {
  const now = new Date().toISOString();
  const criticalCount = issues.filter(i => i.severity === 'critical').length;
  const significantCount = issues.filter(i => i.severity === 'significant').length;

  const components: TrustComponent[] = [
    {
      name: 'data_quality',
      label: 'Качество данных',
      score: 82,
      weight: 0.30,
      issues: 2,
      criticalIssues: 0,
      details: 'Большинство ячеек заполнены корректно. Обнаружены 2 пустых значения в ожидаемых полях.',
    },
    {
      name: 'formula_integrity',
      label: 'Целостность формул',
      score: 71,
      weight: 0.25,
      issues: 1,
      criticalIssues: 0,
      details: 'Обнаружено нарушение формулы суммирования в листе УДТХ.',
    },
    {
      name: 'rule_compliance',
      label: 'Соответствие правилам',
      score: 78,
      weight: 0.20,
      issues: 1,
      criticalIssues: 0,
      details: 'Одно нарушение правила таблицы (контрольная сумма УДТХ).',
    },
    {
      name: 'mapping_consistency',
      label: 'Согласованность привязок',
      score: 74,
      weight: 0.15,
      issues: significantCount,
      criticalIssues: 0,
      details: 'Расхождение в маппинге для 1 метрики. Пустое значение экономии МБ по УИО.',
    },
    {
      name: 'operational_risk',
      label: 'Операционные риски',
      score: 85,
      weight: 0.10,
      issues: criticalCount,
      criticalIssues: criticalCount,
      details: criticalCount > 0
        ? 'Обнаружено критическое расхождение: факт УИО не сходится с пересчётом.'
        : 'Критических проблем не обнаружено.',
    },
  ];

  const overall = Math.round(
    components.reduce((sum, c) => sum + c.score * c.weight, 0),
  );

  const grade = overall >= 90 ? 'A'
    : overall >= 75 ? 'B'
    : overall >= 60 ? 'C'
    : overall >= 40 ? 'D'
    : 'F';

  return {
    overall,
    grade: grade as TrustScore['grade'],
    components,
    computedAt: now,
    basedOnSnapshot: DEMO_SNAPSHOT_ID,
  };
}

// ── Полная демо-сетка СВОД ТД-ПМ (ключи REPORT_MAP) ───────────────────
// Делает демо-режим (и VPS без Google-кредов) полноценным: страница «СВОД
// ТД-ПМ» и сводки дашборда показывают согласованные числа вместо пустых ячеек.

interface DemoRow {
  planCount: number; factCount: number; deviationCount: number; executionPct: number;
  planFB: number; planKB: number; planMB: number; planTotal: number;
  factFB: number; factKB: number; factMB: number; factTotal: number;
  amountDeviation: number; savingsPct: number;
  economyFB: number; economyKB: number; economyMB: number; economyTotal: number;
}

const DEMO_DEPTS = [
  { id: 'uer',    kpPlan: 70,   kpExec: 0.70, epPlan: 16,   epExec: 0.80, price: 520, econ: 0.12, fb: 0.30, kb: 0.50 },
  { id: 'uio',    kpPlan: 50,   kpExec: 0.66, epPlan: 22,   epExec: 0.75, price: 410, econ: 0.10, fb: 0.10, kb: 0.70 },
  { id: 'uagzo',  kpPlan: 30,   kpExec: 0.74, epPlan: 15,   epExec: 0.82, price: 380, econ: 0.15, fb: 0.05, kb: 0.75 },
  { id: 'ufbp',   kpPlan: 28,   kpExec: 0.81, epPlan: 22,   epExec: 0.78, price: 600, econ: 0.09, fb: 0.40, kb: 0.45 },
  { id: 'ud',     kpPlan: 95,   kpExec: 0.65, epPlan: 77,   epExec: 0.72, price: 350, econ: 0.11, fb: 0.20, kb: 0.60 },
  { id: 'udtx',   kpPlan: 40,   kpExec: 0.62, epPlan: 27,   epExec: 0.70, price: 700, econ: 0.14, fb: 0.15, kb: 0.65 },
  { id: 'uksimp', kpPlan: 360,  kpExec: 0.71, epPlan: 308,  epExec: 0.74, price: 280, econ: 0.13, fb: 0.10, kb: 0.70 },
  { id: 'uo',     kpPlan: 1300, kpExec: 0.79, epPlan: 1068, epExec: 0.77, price: 230, econ: 0.16, fb: 0.25, kb: 0.60 },
] as const;

function demoGenRow(planCount: number, execFrac: number, price: number, econRate: number, fbShare: number, kbShare: number): DemoRow {
  const factCount = Math.round(planCount * execFrac);
  const planTotal = Math.round(planCount * price);
  const factTotal = Math.round(factCount * price * 0.96);
  const planFB = Math.round(planTotal * fbShare);
  const planKB = Math.round(planTotal * kbShare);
  const factFB = Math.round(factTotal * fbShare);
  const factKB = Math.round(factTotal * kbShare);
  const economyTotal = Math.round(factTotal * econRate);
  const economyFB = Math.round(economyTotal * fbShare);
  const economyKB = Math.round(economyTotal * kbShare);
  return {
    planCount, factCount,
    deviationCount: factCount - planCount,
    executionPct: planCount > 0 ? factCount / planCount : 0,
    planFB, planKB, planMB: planTotal - planFB - planKB, planTotal,
    factFB, factKB, factMB: factTotal - factFB - factKB, factTotal,
    amountDeviation: factTotal - planTotal,
    savingsPct: planTotal > 0 ? (planTotal - factTotal) / planTotal : 0,
    economyFB, economyKB, economyMB: economyTotal - economyFB - economyKB, economyTotal,
  };
}

function demoBlankRow(): DemoRow {
  return {
    planCount: 0, factCount: 0, deviationCount: 0, executionPct: 0,
    planFB: 0, planKB: 0, planMB: 0, planTotal: 0,
    factFB: 0, factKB: 0, factMB: 0, factTotal: 0,
    amountDeviation: 0, savingsPct: 0,
    economyFB: 0, economyKB: 0, economyMB: 0, economyTotal: 0,
  };
}

function demoAccumulate(acc: DemoRow, r: DemoRow): void {
  acc.planCount += r.planCount; acc.factCount += r.factCount;
  acc.planFB += r.planFB; acc.planKB += r.planKB; acc.planMB += r.planMB; acc.planTotal += r.planTotal;
  acc.factFB += r.factFB; acc.factKB += r.factKB; acc.factMB += r.factMB; acc.factTotal += r.factTotal;
  acc.economyFB += r.economyFB; acc.economyKB += r.economyKB; acc.economyMB += r.economyMB; acc.economyTotal += r.economyTotal;
}

function demoFinalize(acc: DemoRow): DemoRow {
  acc.deviationCount = acc.factCount - acc.planCount;
  acc.executionPct = acc.planCount > 0 ? acc.factCount / acc.planCount : 0;
  acc.amountDeviation = acc.factTotal - acc.planTotal;
  acc.savingsPct = acc.planTotal > 0 ? (acc.planTotal - acc.factTotal) / acc.planTotal : 0;
  return acc;
}

function demoEmitRow(out: Record<string, NormalizedMetric>, prefix: string, row: DemoRow, eKey: 'fact' | 'fact_count'): void {
  const now = new Date().toISOString();
  const period: PeriodScope = prefix.includes('.q1') ? 'q1' : 'annual';
  const put = (suffix: string, v: number, kind: 'count' | 'currency' | 'percent') => {
    const key = `${prefix}.${suffix}`;
    const metric: NormalizedMetric = {
      metricKey: key, value: v, numericValue: v,
      displayValue: kind === 'percent' ? `${(v * 100).toFixed(1)}%` : v.toLocaleString('ru-RU'),
      origin: 'official', period,
      unit: kind === 'percent' ? 'percent' : kind === 'count' ? 'count' : 'thousand_rubles',
      sourceSheet: SVOD_SHEET_NAME, sourceCell: '', formula: null,
      confidence: 0.95, readAt: now, warnings: [],
    };
    out[key] = metric;
  };
  put('count', row.planCount, 'count');
  put(eKey, row.factCount, 'count');
  put('deviation', row.deviationCount, 'count');
  put('percent', row.executionPct, 'percent');
  put('fb_plan', row.planFB, 'currency'); put('kb_plan', row.planKB, 'currency'); put('mb_plan', row.planMB, 'currency'); put('total_plan', row.planTotal, 'currency');
  put('fb_fact', row.factFB, 'currency'); put('kb_fact', row.factKB, 'currency'); put('mb_fact', row.factMB, 'currency'); put('total_fact', row.factTotal, 'currency');
  put('amount_dev', row.amountDeviation, 'currency'); put('savings_pct', row.savingsPct, 'percent');
  put('economy_fb', row.economyFB, 'currency'); put('economy_kb', row.economyKB, 'currency'); put('economy_mb', row.economyMB, 'currency'); put('economy_total', row.economyTotal, 'currency');
}

/** Полная демо-сетка СВОД ТД-ПМ по ключам REPORT_MAP (сводный + 8 ГРБС × КП/ЕП × 1 кв/Год). */
function buildSvodDemoCells(): Record<string, NormalizedMetric> {
  const out: Record<string, NormalizedMetric> = {};
  const sumKpY = demoBlankRow(), sumEpY = demoBlankRow();
  const sumKpQ1 = demoBlankRow(), sumEpQ1 = demoBlankRow();

  for (const d of DEMO_DEPTS) {
    const kpY = demoGenRow(d.kpPlan, d.kpExec, d.price, d.econ, d.fb, d.kb);
    const epY = demoGenRow(d.epPlan, d.epExec, d.price * 0.9, d.econ * 0.7, d.fb, d.kb);
    const kpQ1 = demoGenRow(Math.round(d.kpPlan * 0.45), Math.min(1, d.kpExec * 1.1), d.price, d.econ, d.fb, d.kb);
    const epQ1 = demoGenRow(Math.round(d.epPlan * 0.45), Math.min(1, d.epExec * 1.08), d.price * 0.9, d.econ * 0.7, d.fb, d.kb);
    demoEmitRow(out, `grbs.${d.id}.kp.year`, kpY, 'fact');
    demoEmitRow(out, `grbs.${d.id}.ep.year`, epY, 'fact');
    demoEmitRow(out, `grbs.${d.id}.kp.q1`, kpQ1, 'fact');
    demoEmitRow(out, `grbs.${d.id}.ep.q1`, epQ1, 'fact');
    demoAccumulate(sumKpY, kpY); demoAccumulate(sumEpY, epY);
    demoAccumulate(sumKpQ1, kpQ1); demoAccumulate(sumEpQ1, epQ1);
  }

  demoEmitRow(out, 'competitive.year', demoFinalize(sumKpY), 'fact_count');
  demoEmitRow(out, 'sole.year', demoFinalize(sumEpY), 'fact_count');
  demoEmitRow(out, 'competitive.q1', demoFinalize(sumKpQ1), 'fact_count');
  demoEmitRow(out, 'sole.q1', demoFinalize(sumEpQ1), 'fact_count');
  return out;
}

/**
 * Creates a complete DataSnapshot with realistic demo/mock data.
 * Used as fallback when Google Sheets credentials are unavailable.
 */
export function createDemoSnapshot(): DataSnapshot {
  const now = new Date().toISOString();

  // Полная сетка СВОД (наш генератор) + точечные legacy-значения сверху.
  const officialMetrics = { ...buildOfficialMetrics(), ...buildSvodDemoCells() };
  const calculatedMetrics = buildCalculatedMetrics(officialMetrics);
  const deltas = buildDeltas(officialMetrics, calculatedMetrics);
  const issues = buildIssues();
  const trust = buildTrustScore(issues);

  return {
    id: DEMO_SNAPSHOT_ID,
    spreadsheetId: DEMO_SPREADSHEET_ID,
    createdAt: now,
    officialMetrics,
    calculatedMetrics,
    deltas,
    issues,
    trust,
    rowCount: 284,
    metadata: {
      sheetsRead: [SVOD_SHEET_NAME, 'УЭР', 'УИО', 'УАГЗО', 'УФБП', 'УД', 'УДТХ', 'УКСиМП', 'УО'],
      cellsRead: 27,
      readDurationMs: 0,
      pipelineDurationMs: 0,
    },
  };
}
