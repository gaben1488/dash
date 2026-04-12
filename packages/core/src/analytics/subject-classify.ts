/**
 * Subject Classification Module
 * Categorizes procurement subjects using regex patterns.
 * Based on procurement_report.gs subject categorization.
 */

export type SubjectCategory =
  | 'Канцелярия'
  | 'Мебель'
  | 'Оргтехника'
  | 'Транспорт'
  | 'Строительство'
  | 'Ремонт'
  | 'ГСМ'
  | 'Питание'
  | 'Коммуналка'
  | 'Охрана'
  | 'Медицина'
  | 'Образование'
  | 'Спецодежда'
  | 'Связь'
  | 'Клининг'
  | 'Проектирование'
  | 'Другое';

const CATEGORY_PATTERNS: [SubjectCategory, RegExp][] = [
  ['Канцелярия', /канцел|бумаг|тонер|картридж|ручк|скрепк/i],
  ['Мебель', /мебел|стол|стул|шкаф|кресл|диван|полк/i],
  ['Оргтехника', /компьютер|принтер|мфу|ноутбук|монитор|сервер|сканер/i],
  ['Транспорт', /автомоб|транспорт|автобус|машин|грузов/i],
  ['ГСМ', /гсм|бензин|топлив|дизельн|масл.*мотор/i],
  ['Строительство', /строител|реконструк|фасад|кровл|фундамент|возведен/i],
  ['Ремонт', /ремонт|восстановлен|обновлен/i],
  ['Питание', /питани|продукт|продовольств|обед|завтрак|полуфабрик/i],
  ['Коммуналка', /коммунал|электроэнерг|теплоснабж|водоснабж|водоотвед|отоплен/i],
  ['Охрана', /охран|видеонаблюд|пожар|безопас|сигнализ|тревожн/i],
  ['Медицина', /медиц|лекарств|фармацевт|санитар|дезинфек/i],
  ['Образование', /учебн|образоват|методич|пособи|литератур/i],
  ['Спецодежда', /спецодежд|форм.*одежд|обув|перчат|каск/i],
  ['Связь', /связ|интернет|телефон|сим.*карт|хостинг/i],
  ['Клининг', /уборк|клинин|моющ|чист.*средств/i],
  ['Проектирование', /проект.*документ|смет|экспертиз|обследован/i],
];

/**
 * Classify a procurement subject into a category.
 */
export function classifySubject(subject: string): SubjectCategory {
  if (!subject || subject.trim().length === 0) return 'Другое';
  for (const [category, pattern] of CATEGORY_PATTERNS) {
    if (pattern.test(subject)) return category;
  }
  return 'Другое';
}

export interface SubjectAnalysisReport {
  totalRows: number;
  categories: Record<SubjectCategory, { count: number; totalAmount: number; avgAmount: number }>;
  topSubjects: Array<{ subject: string; count: number; totalAmount: number }>;
}

/**
 * Build a subject analysis report from procurement rows.
 */
export function buildSubjectAnalysis(
  rows: Array<{ subject: string; planTotal: number }>,
): SubjectAnalysisReport {
  const categories: Record<string, { count: number; totalAmount: number }> = {};
  const subjectMap = new Map<string, { count: number; totalAmount: number }>();

  for (const row of rows) {
    const cat = classifySubject(row.subject);
    if (!categories[cat]) categories[cat] = { count: 0, totalAmount: 0 };
    categories[cat].count++;
    categories[cat].totalAmount += row.planTotal;

    // Normalize subject for grouping
    const normalized = row.subject.trim().substring(0, 100).toLowerCase();
    if (normalized) {
      const existing = subjectMap.get(normalized) ?? { count: 0, totalAmount: 0 };
      existing.count++;
      existing.totalAmount += row.planTotal;
      subjectMap.set(normalized, existing);
    }
  }

  // Build result with avgAmount
  const catResult: SubjectAnalysisReport['categories'] = {} as any;
  for (const [cat, data] of Object.entries(categories)) {
    catResult[cat as SubjectCategory] = {
      ...data,
      avgAmount: data.count > 0 ? data.totalAmount / data.count : 0,
    };
  }

  // Top subjects by count
  const topSubjects = Array.from(subjectMap.entries())
    .map(([subject, data]) => ({ subject, ...data }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 20);

  return {
    totalRows: rows.length,
    categories: catResult,
    topSubjects,
  };
}
