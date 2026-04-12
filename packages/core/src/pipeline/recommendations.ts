/**
 * Recommendations Engine
 * Generates actionable management recommendations based on procurement data analysis.
 * Each recommendation has a type, severity, affected department, and human-readable description.
 */

export type RecommendationType = 'critical' | 'warning' | 'action' | 'decision' | 'info';

export interface Recommendation {
  id: string;
  type: RecommendationType;
  department: string;
  title: string;
  description: string;
  priority: number;  // 0 = highest, 5 = lowest
  metric?: string;   // related metric key
  value?: number;    // related numeric value
}

export interface RecommendationInput {
  department: string;

  // Execution metrics
  q1Total: number;
  q1Done: number;
  q1Pct: number;

  // Method breakdown
  totalCompetitive: number;
  totalEP: number;
  epSharePct: number;

  // Economy
  economyTotal: number;

  // Signals
  overdue: number;
  signedNoFact: number;
  factWithoutAmounts: number;
  financeDelay: number;
  disputedEco: number;

  // Data quality
  adRelevantRows: number;
  adRelevantEmpty: number;
  badMethodCount: number;      // non-standard values in L column
  formulaMissing: number;

  // Trust
  trustScore: number;

  // Delta (official vs calculated)
  deltaEcoMb?: number;
  deltaQ1Pct?: number;
}

let idCounter = 0;
function nextId(): string {
  return `rec_${++idCounter}`;
}

/**
 * Generate recommendations for a single department.
 */
export function generateDepartmentRecommendations(input: RecommendationInput): Recommendation[] {
  const recs: Recommendation[] = [];
  const dept = input.department;

  // EP share too high (epSharePct is decimal: 0.60 = 60%)
  if (input.epSharePct > 0.60) {
    recs.push({
      id: nextId(), type: 'warning', department: dept, priority: 1,
      title: `Высокая доля единственного поставщика — ${(input.epSharePct * 100).toFixed(0)}%`,
      description: 'В своде высокая доля контрактации по ЕП. Требуется адресная проработка по укрупнению и переводу части позиций в конкурентные процедуры.',
      metric: 'epSharePct', value: input.epSharePct
    });
  }

  // AD column not filled
  if (input.adRelevantRows > 0 && input.adRelevantEmpty > input.adRelevantRows * 0.5) {
    recs.push({
      id: nextId(), type: 'critical', department: dept, priority: 0,
      title: `Финансовый орган не определил флаг экономии у ${input.adRelevantEmpty} из ${input.adRelevantRows} строк`,
      description: 'Столбец AD пуст на строках, где требуется флаг экономии. Финансовому органу необходимо установить флаг.',
      metric: 'adRelevantEmpty', value: input.adRelevantEmpty
    });
  }

  // Non-standard procurement method
  if (input.badMethodCount > 0) {
    recs.push({
      id: nextId(), type: 'critical', department: dept, priority: 0,
      title: `${input.badMethodCount} строк с нестандартным способом закупки`,
      description: 'Значения в столбце L выходят за принятый набор ЭА/ЕП/ЭК/ЭЗК.',
      metric: 'badMethodCount', value: input.badMethodCount
    });
  }

  // Low Q1 execution (q1Pct is decimal: 0.30 = 30%)
  if (input.q1Total > 0 && input.q1Pct < 0.30) {
    recs.push({
      id: nextId(), type: 'action', department: dept, priority: 2,
      title: `Низкое исполнение плана 1 квартала — ${(input.q1Pct * 100).toFixed(1)}%`,
      description: 'По своду исполнение ниже 30%. Нужен разбор задержек и перечень позиций до конца квартала.',
      metric: 'q1Pct', value: input.q1Pct
    });
  }

  // Overdue items
  if (input.overdue > 0) {
    recs.push({
      id: nextId(), type: 'critical', department: dept, priority: 0,
      title: `Есть просроченные без факта позиции: ${input.overdue}`,
      description: 'Плановая дата уже прошла, а фактическая дата и суммы не заполнены, при этом статус не объясняет перенос.',
      metric: 'overdue', value: input.overdue
    });
  }

  // Disputed economy
  if (input.disputedEco > 0) {
    recs.push({
      id: nextId(), type: 'decision', department: dept, priority: 1,
      title: `Спорная экономия по комментариям ГРБС — ${input.disputedEco} поз.`,
      description: 'Флаг/комментарий указывают на конфликт: экономия формально есть, но ГРБС просит её не учитывать либо перераспределить.',
      metric: 'disputedEco', value: input.disputedEco
    });
  }

  // Signed but no fact
  if (input.signedNoFact > 0) {
    recs.push({
      id: nextId(), type: 'warning', department: dept, priority: 1,
      title: `Заключено, но нет факта: ${input.signedNoFact} позиций`,
      description: 'Статус говорит, что договор заключён, но фактическая дата или суммы не заполнены.',
      metric: 'signedNoFact', value: input.signedNoFact
    });
  }

  // Fact without amounts
  if (input.factWithoutAmounts > 0) {
    recs.push({
      id: nextId(), type: 'warning', department: dept, priority: 1,
      title: `Факт без сумм: ${input.factWithoutAmounts} позиций`,
      description: 'Есть фактическая дата, но фактические суммы по бюджетам равны нулю.',
      metric: 'factWithoutAmounts', value: input.factWithoutAmounts
    });
  }

  // Formula missing
  if (input.formulaMissing > 3) {
    recs.push({
      id: nextId(), type: 'warning', department: dept, priority: 1,
      title: `Отсутствуют формулы в ${input.formulaMissing} расчётных ячейках`,
      description: 'В расчётных столбцах (K, Y, Z-AC) нет формул где ожидается расчёт. Возможно ручная правка сломала шаблон.',
      metric: 'formulaMissing', value: input.formulaMissing
    });
  }

  // Finance delay
  if (input.financeDelay > 3) {
    recs.push({
      id: nextId(), type: 'action', department: dept, priority: 2,
      title: `${input.financeDelay} позиций с задержкой финансирования`,
      description: 'Комментарии указывают на отсутствие финансирования, перенос сроков или ходатайства.',
      metric: 'financeDelay', value: input.financeDelay
    });
  }

  // Delta between official and calculated
  if (input.deltaEcoMb != null && (Math.abs(input.deltaEcoMb) > 0.1 || (input.deltaQ1Pct != null && Math.abs(input.deltaQ1Pct) > 0.1))) {
    const deltaEcoStr = input.deltaEcoMb.toFixed(1);
    const deltaQ1Str = input.deltaQ1Pct != null ? input.deltaQ1Pct.toFixed(1) : '\u2014';
    recs.push({
      id: nextId(), type: 'action', department: dept, priority: 1,
      title: '\u0420\u0430\u0441\u0445\u043e\u0436\u0434\u0435\u043d\u0438\u0435 \u043c\u0435\u0436\u0434\u0443 \u0441\u0442\u0440\u043e\u043a\u043e\u0432\u044b\u043c \u043f\u0435\u0440\u0435\u0441\u0447\u0451\u0442\u043e\u043c \u0438 \u043e\u0444\u0438\u0446\u0438\u0430\u043b\u044c\u043d\u044b\u043c \u0441\u0432\u043e\u0434\u043e\u043c',
      description: `\u041d\u0443\u0436\u043d\u043e \u043f\u0440\u043e\u0432\u0435\u0440\u0438\u0442\u044c \u043c\u0430\u043f\u043f\u0438\u043d\u0433/\u0444\u043e\u0440\u043c\u0443\u043b\u044b. \u0394\u044d\u043a\u043e\u043d\u043e\u043c\u0438\u044f=${deltaEcoStr}, \u03941\u043a\u0432=${deltaQ1Str} \u043f.\u043f.`,
      metric: 'delta'
    });
  }

  // Low trust score
  if (input.trustScore < 60) {
    recs.push({
      id: nextId(), type: 'critical', department: dept, priority: 0,
      title: `\u041a\u0440\u0438\u0442\u0438\u0447\u0435\u0441\u043a\u0438 \u043d\u0438\u0437\u043a\u0430\u044f \u043d\u0430\u0434\u0451\u0436\u043d\u043e\u0441\u0442\u044c \u0434\u0430\u043d\u043d\u044b\u0445 \u2014 ${input.trustScore.toFixed(0)} \u0431\u0430\u043b\u043b\u043e\u0432`,
      description: '\u0421\u043e\u0432\u043e\u043a\u0443\u043f\u043d\u043e\u0441\u0442\u044c \u043f\u0440\u043e\u0431\u043b\u0435\u043c \u0437\u0430\u043f\u043e\u043b\u043d\u0435\u043d\u0438\u044f, \u0444\u043e\u0440\u043c\u0443\u043b \u0438 \u043a\u043e\u043d\u0442\u0440\u043e\u043b\u044f \u043f\u0440\u0438\u0432\u0435\u043b\u0430 \u043a \u043d\u0438\u0437\u043a\u043e\u043c\u0443 \u0434\u043e\u0432\u0435\u0440\u0438\u044e. \u0420\u0435\u043a\u043e\u043c\u0435\u043d\u0434\u0443\u0435\u0442\u0441\u044f \u0430\u0443\u0434\u0438\u0442 \u0442\u0430\u0431\u043b\u0438\u0446\u044b.',
      metric: 'trustScore', value: input.trustScore
    });
  } else if (input.trustScore < 80) {
    recs.push({
      id: nextId(), type: 'warning', department: dept, priority: 2,
      title: `\u041d\u0430\u0434\u0451\u0436\u043d\u043e\u0441\u0442\u044c \u0434\u0430\u043d\u043d\u044b\u0445 \u043d\u0438\u0436\u0435 \u043f\u043e\u0440\u043e\u0433\u0430 \u2014 ${input.trustScore.toFixed(0)} \u0431\u0430\u043b\u043b\u043e\u0432`,
      description: '\u041d\u0443\u0436\u043d\u044b \u0442\u043e\u0447\u0435\u0447\u043d\u044b\u0435 \u0438\u0441\u043f\u0440\u0430\u0432\u043b\u0435\u043d\u0438\u044f \u0434\u043b\u044f \u043f\u043e\u0432\u044b\u0448\u0435\u043d\u0438\u044f \u0434\u043e\u0432\u0435\u0440\u0438\u044f \u043a \u0434\u0430\u043d\u043d\u044b\u043c.',
      metric: 'trustScore', value: input.trustScore
    });
  }

  return recs;
}

/**
 * Generate recommendations for all departments.
 */
export function generateAllRecommendations(inputs: RecommendationInput[]): Recommendation[] {
  idCounter = 0; // reset for deterministic IDs
  const all: Recommendation[] = [];

  for (const input of inputs) {
    all.push(...generateDepartmentRecommendations(input));
  }

  // Sort by priority (0 = most urgent first)
  all.sort((a, b) => a.priority - b.priority);

  return all;
}
