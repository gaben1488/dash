/**
 * splitting.ts — детектор дробления закупок (вынесено из dataset-signals.ts, чанк G-3, шаг 2).
 *
 * Ответственность: поиск групп однородных закупок у одного заказчика, каждая ниже
 * порога малой закупки по п.4 ч.1 ст.93, но в сумме порог превышающих. Классический
 * антикоррупционный индикатор (split-PO).
 *
 * Порог берётся из канона @aemr/shared, не литералом. Обратных зависимостей нет.
 */
import { DEPT_COLUMNS, LAW_44FZ_THRESHOLDS, subordinateKey } from '@aemr/shared';
import { numFromRow } from '../utils/row-cells.js';

/** Result of suspicious splitting detection (44-ФЗ anti-splitting) */
export interface SplittingGroup {
  /** Department / subordinate grouping key */
  groupKey: string;
  /** Row indices of suspected split rows */
  rowIndices: number[];
  /** Common subject substring */
  commonSubject: string;
  /** Total amount across all rows in group */
  totalAmount: number;
  /** Number of rows in the group */
  count: number;
}

/** Минимальный размер группы, при котором дробление считается подозрительным. */
const SPLITTING_MIN_GROUP_SIZE = 3;

const EP_SPLITTING_THRESHOLD = LAW_44FZ_THRESHOLDS.epSmallPurchaseSingleContractLimit;

export function detectSuspiciousSplitting(rows: unknown[][]): SplittingGroup[] {
  interface EpCandidate {
    rowIndex: number;
    subject: string;
    subordinate: string;
    planTotal: number;
  }

  const candidates: EpCandidate[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.length < 25) continue;

    const method = String(row[DEPT_COLUMNS.METHOD] ?? '').trim().toLowerCase();
    if (!method.includes('еп') && !method.includes('единствен')) continue;

    const planTotal = numFromRow(row, DEPT_COLUMNS.TOTAL_PLAN);
    if (planTotal <= 0 || planTotal >= EP_SPLITTING_THRESHOLD) continue;

    const subject = String(row[DEPT_COLUMNS.SUBJECT] ?? row[DEPT_COLUMNS.PROGRAM_NAME] ?? '').trim().toLowerCase();
    if (subject.length < 3) continue;

    const subordinate = subordinateKey(String(row[DEPT_COLUMNS.SUBORDINATE] ?? ''));

    candidates.push({ rowIndex: i, subject, subordinate, planTotal });
  }

  if (candidates.length < SPLITTING_MIN_GROUP_SIZE) return [];

  // Group by subordinate (or '_org' if empty)
  const bySubordinate = new Map<string, EpCandidate[]>();
  for (const c of candidates) {
    const key = c.subordinate || '_org';
    if (!bySubordinate.has(key)) bySubordinate.set(key, []);
    bySubordinate.get(key)!.push(c);
  }

  const results: SplittingGroup[] = [];

  for (const [groupKey, group] of bySubordinate) {
    if (group.length < SPLITTING_MIN_GROUP_SIZE) continue;

    const visited = new Set<number>();

    for (let i = 0; i < group.length; i++) {
      if (visited.has(i)) continue;

      const cluster: EpCandidate[] = [group[i]];
      visited.add(i);

      for (let j = i + 1; j < group.length; j++) {
        if (visited.has(j)) continue;

        if (subjectsAreSimilar(group[i].subject, group[j].subject)) {
          cluster.push(group[j]);
          visited.add(j);
        }
      }

      if (cluster.length >= SPLITTING_MIN_GROUP_SIZE) {
        const totalAmount = cluster.reduce((sum, c) => sum + c.planTotal, 0);
        if (totalAmount >= EP_SPLITTING_THRESHOLD) {
          results.push({
            groupKey,
            rowIndices: cluster.map(c => c.rowIndex),
            commonSubject: cluster[0].subject.slice(0, 80),
            totalAmount,
            count: cluster.length,
          });
        }
      }
    }
  }

  return results;
}

/**
 * Check if two subject strings are similar enough to suspect splitting.
 * Uses longest common substring: if LCS >= 8 chars, they're similar.
 */
function subjectsAreSimilar(a: string, b: string): boolean {
  if (a === b) return true;
  const minLen = Math.min(a.length, b.length);
  if (minLen < 8) return false;

  let maxLen = 0;
  for (let i = 0; i < a.length && maxLen < minLen; i++) {
    for (let j = 0; j < b.length; j++) {
      let k = 0;
      while (i + k < a.length && j + k < b.length && a[i + k] === b[j + k]) {
        k++;
      }
      if (k > maxLen) maxLen = k;
    }
  }

  return maxLen >= 8;
}

/**
 * Runs full dataset-level analysis: Benford, Z-score, 3-level anomaly, composite score, noise map.
 * This is the main entry point — call after CalcEngine and row-level detectSignals().
 */
