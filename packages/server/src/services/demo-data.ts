import { REPORT_MAP, DEPARTMENTS } from '@aemr/shared';
import type {
  DataSnapshot,
  NormalizedMetric,
  DeltaResult,
  Issue,
  TrustScore,
  TrustComponent,
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
      sheet: 'СВОД ТД-ПМ',
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
      sheet: 'СВОД ТД-ПМ',
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
      sheet: 'СВОД ТД-ПМ',
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
      sheet: 'СВОД ТД-ПМ',
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
      title: 'Общее отклонение Q1 отрицательное',
      description:
        'Отклонение исполнения за 1 квартал составляет -48 320 тыс. руб. Это означает недовыполнение общего плана закупок.',
      sheet: 'СВОД ТД-ПМ',
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
        'УАГЗО показывает наилучший процент исполнения Q1 — 89,4%. Можно использовать как эталон.',
      sheet: 'СВОД ТД-ПМ',
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

/**
 * Creates a complete DataSnapshot with realistic demo/mock data.
 * Used as fallback when Google Sheets credentials are unavailable.
 */
export function createDemoSnapshot(): DataSnapshot {
  const now = new Date().toISOString();

  const officialMetrics = buildOfficialMetrics();
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
      sheetsRead: ['СВОД ТД-ПМ', 'УЭР', 'УИО', 'УАГЗО', 'УФБП', 'УД', 'УДТХ', 'УКСиМП', 'УО'],
      cellsRead: 27,
      readDurationMs: 0,
      pipelineDurationMs: 0,
    },
  };
}
