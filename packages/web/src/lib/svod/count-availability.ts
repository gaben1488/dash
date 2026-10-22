import type { SvodRow } from '@aemr/shared';
import { confirmedEmptyCounts, observedNumber } from '@aemr/shared';

type Counts = Pick<SvodRow, 'planCount' | 'factCount'>;

/** A missing source is neither a zero plan nor an empty filtered selection. */
export function svodCountsState(row: Counts): 'unread-plan' | 'unread-fact' | 'no-plan' | 'observed' {
  if (observedNumber(row.planCount) === null) return 'unread-plan';
  if (observedNumber(row.factCount) === null) return 'unread-fact';
  return row.planCount === 0 ? 'no-plan' : 'observed';
}

export function isConfirmedEmptySvod(row: Counts | null): boolean {
  return row !== null && confirmedEmptyCounts(row.planCount, row.factCount);
}
