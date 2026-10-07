import type { RegistryProcedure } from './contract';

export const MONEY_CATEGORY_LABELS = {
  realized: 'Учтённые результаты',
  work: 'В работе и ожидании даты',
  unrealized: 'Не состоялись и отменены',
  reissued: 'Переоформлены · история',
  unknown: 'Стадия требует уточнения',
} as const;
export type MoneyCategory = keyof typeof MONEY_CATEGORY_LABELS;

/** Accounting category does not change the source stage or the daily work queue. */
export function moneyCategoryOf(row: RegistryProcedure): MoneyCategory {
  if (row.stage === 'reissued') return 'reissued';
  if (row.stage === 'no_result') return 'unrealized';
  if (row.stage === 'awarded') return row.factsEligible === false ? 'work' : 'realized';
  if (['application', 'published', 'bidding'].includes(row.stage)) return 'work';
  return 'unknown';
}

export function moneyFlowFrom(rows: readonly RegistryProcedure[]) {
  const categories = Object.fromEntries(Object.keys(MONEY_CATEGORY_LABELS).map((key) =>
    [key, { count: 0, nmck: 0, missing: 0 }])) as Record<MoneyCategory, { count: number; nmck: number; missing: number }>;
  let awaitingDate = 0;
  for (const row of rows) {
    const bucket = categories[moneyCategoryOf(row)];
    bucket.count += 1;
    if (row.nmck === null || !Number.isFinite(row.nmck)) bucket.missing += 1;
    else bucket.nmck += row.nmck;
    if (row.stage === 'awarded' && row.factsEligible === false) awaitingDate += 1;
  }
  const currentPlan = categories.realized.nmck + categories.work.nmck + categories.unrealized.nmck + categories.unknown.nmck;
  return { categories, currentPlan, awaitingDate };
}
