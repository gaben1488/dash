/**
 * Centralization Recommendations Module
 * Identifies cross-ГРБС procurement consolidation opportunities.
 * Based on procurement_report.gs centralization analysis (ст. 25 44-ФЗ).
 */

import { classifySubject, type SubjectCategory } from './subject-classify.js';

export interface CentralizationOpportunity {
  category: SubjectCategory;
  departments: string[];         // ГРБС IDs that procure this category
  totalAmount: number;           // Combined procurement amount
  contractCount: number;         // Total number of contracts
  potentialSavings: number;      // Estimated savings (5-15% of volume)
  recommendation: string;
  priority: 'high' | 'medium' | 'low';
}

interface DeptRow {
  grbsId: string;
  subject: string;
  planTotal: number;
  method: string;
}

/**
 * Find centralization opportunities across departments.
 * Per ст. 25 44-ФЗ: if 3+ ГРБС procure same category with
 * combined volume > 3M, recommend centralized procurement.
 */
export function findCentralizationOpportunities(
  allRows: DeptRow[],
): CentralizationOpportunity[] {
  // Group by subject category × department
  const categoryMap = new Map<SubjectCategory, Map<string, { count: number; total: number }>>();

  for (const row of allRows) {
    if (row.method === 'ЕП') continue; // Only competitive procurement can be centralized
    const cat = classifySubject(row.subject);
    if (cat === 'Другое') continue;

    if (!categoryMap.has(cat)) categoryMap.set(cat, new Map());
    const deptMap = categoryMap.get(cat)!;
    const existing = deptMap.get(row.grbsId) ?? { count: 0, total: 0 };
    existing.count++;
    existing.total += row.planTotal;
    deptMap.set(row.grbsId, existing);
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

    if (totalAmount < 3_000_000) continue; // Minimum threshold

    // Savings estimate: 5-15% depending on volume
    const savingsRate = totalAmount > 50_000_000 ? 0.15 :
                        totalAmount > 10_000_000 ? 0.10 : 0.05;
    const potentialSavings = totalAmount * savingsRate;

    let priority: 'high' | 'medium' | 'low' = 'low';
    if (totalAmount > 20_000_000 && deptMap.size >= 5) priority = 'high';
    else if (totalAmount > 5_000_000 && deptMap.size >= 3) priority = 'medium';

    opportunities.push({
      category,
      departments,
      totalAmount,
      contractCount,
      potentialSavings,
      recommendation: `Централизация закупок "${category}" для ${deptMap.size} управлений. ` +
        `Объём: ${(totalAmount / 1_000_000).toFixed(1)} млн ₽, ` +
        `потенциальная экономия: ${(potentialSavings / 1_000_000).toFixed(1)} млн ₽`,
      priority,
    });
  }

  return opportunities.sort((a, b) => b.potentialSavings - a.potentialSavings);
}
