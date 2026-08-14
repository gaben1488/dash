/**
 * Кандидаты на объединение закупок (централизация, ст. 25 44-ФЗ).
 *
 * Находит категории предметов, которые порознь закупают несколько управлений:
 * такая группа — кандидат на совместную закупку.
 *
 * Два правила честности (бриф переплавки §5.2, волна 2026-08-14):
 *
 * 1. ЕП ВКЛЮЧЕНЫ. Раньше строки «у единственного поставщика» отсеивались с
 *    комментарием «централизуются только конкурентные» — то есть из поиска
 *    выпадали ровно те закупки, ради которых исход «меньше ЕП» существует:
 *    одинаковые предметы, купленные разными заказчиками без торгов, — первый
 *    кандидат на один общий конкурс. Фильтр снят; прежнее поведение доступно
 *    режимом `includeEP: false`.
 *
 * 2. ЭКОНОМИЯ НЕ ОБЕЩАЕТСЯ ЧИСЛОМ. Прежний расчёт «5–15 % от объёма» был
 *    выдуманным коэффициентом без методики (Д13: вымышленные формулы в базе
 *    знаний запрещены). Вместо него группа честно показывает свой объём в
 *    деньгах и число заказчиков — а оценку эффекта читатель делает по
 *    собственной статистике торгов, не по нашему обещанию.
 */

import { classifySubject, type SubjectCategory } from './subject-classify.js';

/** Строка-участник группы: адрес для раскрытия кандидата до строк. */
export interface CentralizationMember {
  grbsId: string;
  subject: string;
  /** План итого в ТЫСЯЧАХ ₽ (канон колонки K). */
  planTotal: number;
  method: string;
}

export interface CentralizationOpportunity {
  category: SubjectCategory;
  /** ГРБС, закупающие категорию, — «число заказчиков» группы. */
  departments: string[];
  /** Суммарный объём группы, тыс. ₽. */
  totalAmount: number;
  /** Всего строк-закупок в группе. */
  contractCount: number;
  /** Из них у единственного поставщика: объём (тыс. ₽) и число строк. */
  epAmount: number;
  epCount: number;
  /** Строки группы — раскрытие «до строк с адресами» на экране. */
  members: CentralizationMember[];
  recommendation: string;
  priority: 'high' | 'medium' | 'low';
}

interface DeptRow {
  grbsId: string;
  subject: string;
  /** План итого в ТЫСЯЧАХ ₽ (канон колонки K). Была ошибка единиц: пороги в рублях → всё отсеивалось. */
  planTotal: number;
  method: string;
}

export interface CentralizationOptions {
  /**
   * Считать ли строки ЕП кандидатами на объединение. По умолчанию — ДА:
   * одинаковые предметы у разных заказчиков без торгов — главный кандидат
   * на общий конкурс. `false` возвращает старый периметр «только конкурентные».
   */
  includeEP?: boolean;
}

/** Способ «у единственного поставщика» в канонической записи листа. */
const EP_METHOD = 'ЕП';

/**
 * Find centralization opportunities across departments.
 * Per ст. 25 44-ФЗ: if 3+ ГРБС procure same category with
 * combined volume > 3M, recommend centralized procurement.
 */
export function findCentralizationOpportunities(
  allRows: DeptRow[],
  options: CentralizationOptions = {},
): CentralizationOpportunity[] {
  const includeEP = options.includeEP ?? true;

  // Group by subject category × department
  const categoryMap = new Map<SubjectCategory, Map<string, { count: number; total: number }>>();
  const membersByCategory = new Map<SubjectCategory, CentralizationMember[]>();

  for (const row of allRows) {
    if (!includeEP && row.method === EP_METHOD) continue;
    const cat = classifySubject(row.subject);
    if (cat === 'Другое') continue;

    if (!categoryMap.has(cat)) categoryMap.set(cat, new Map());
    const deptMap = categoryMap.get(cat)!;
    const existing = deptMap.get(row.grbsId) ?? { count: 0, total: 0 };
    existing.count++;
    existing.total += row.planTotal;
    deptMap.set(row.grbsId, existing);

    const members = membersByCategory.get(cat) ?? [];
    members.push({
      grbsId: row.grbsId,
      subject: row.subject,
      planTotal: row.planTotal,
      method: row.method,
    });
    membersByCategory.set(cat, members);
  }

  const opportunities: CentralizationOpportunity[] = [];

  for (const [category, deptMap] of categoryMap) {
    if (deptMap.size < 3) continue; // Need 3+ departments

    let totalAmount = 0;
    let contractCount = 0;
    const departments: string[] = [];

    for (const [deptId, data] of deptMap) {
      departments.push(deptId);
      totalAmount += data.total;
      contractCount += data.count;
    }

    if (totalAmount < 3_000) continue; // Минимум 3 млн ₽ (суммы в тыс. ₽ — канон колонки K)

    const members = membersByCategory.get(category) ?? [];
    let epAmount = 0;
    let epCount = 0;
    for (const m of members) {
      if (m.method === EP_METHOD) {
        epAmount += m.planTotal;
        epCount++;
      }
    }

    let priority: 'high' | 'medium' | 'low' = 'low';
    if (totalAmount > 20_000 && deptMap.size >= 5) priority = 'high';
    else if (totalAmount > 5_000 && deptMap.size >= 3) priority = 'medium';

    opportunities.push({
      category,
      departments,
      totalAmount,
      contractCount,
      epAmount,
      epCount,
      members,
      // Объём и число заказчиков — факты из строк. Экономию числом группа не
      // обещает: коэффициента с методикой у продукта нет (Д13).
      recommendation: `Категорию «${category}» закупают ${deptMap.size} управлений по отдельности. ` +
        `Объём: ${(totalAmount / 1_000).toFixed(1)} млн ₽` +
        (epCount > 0
          ? `, из них без торгов (ЕП): ${(epAmount / 1_000).toFixed(1)} млн ₽ в ${epCount} закупках.`
          : '.'),
      priority,
    });
  }

  // Крупнейшие группы — первыми: сортировка по фактическому объёму, а не по
  // выдуманной «потенциальной экономии».
  return opportunities.sort((a, b) => b.totalAmount - a.totalAmount);
}
