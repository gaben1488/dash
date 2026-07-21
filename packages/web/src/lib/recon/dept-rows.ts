// ── Фильтр и счёты строк сверки «По управлениям».
//    Извлечено move-only из pages/Recon.tsx (разрез E11-4).

import type { ReconDeptRow } from './types';

/** Фильтр строк сверки по выбранным ГРБС; пустой выбор = все проходят */
export function filterReconRowsByDepartments(
  rows: ReconDeptRow[] | undefined,
  selectedDepartments: ReadonlySet<string>,
): ReconDeptRow[] {
  if (!rows) return [];
  if (selectedDepartments.size === 0) return rows;
  return rows.filter(r => selectedDepartments.has(r.department));
}

/** Счёт строк по видам оценки (бейджи-саммари над таблицей) */
export function countReconKinds(rows: ReconDeptRow[]): { ok: number; neutral: number; warning: number; high: number } {
  const counts = { ok: 0, neutral: 0, warning: 0, high: 0 };
  for (const r of rows) counts[r.assessment.kind]++;
  return counts;
}
