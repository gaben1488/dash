import { describe, expect, it } from 'vitest';
import { isConfirmedEmptySvod, svodCountsState } from './count-availability';

describe('C05.02: Свод empty vs unread counts', () => {
  it('only labels a fully observed 0/0 slice empty', () => {
    expect(isConfirmedEmptySvod({ planCount: 0, factCount: 0 })).toBe(true);
    expect(isConfirmedEmptySvod({ planCount: null, factCount: 0 })).toBe(false);
    expect(isConfirmedEmptySvod({ planCount: 0, factCount: null })).toBe(false);
    expect(isConfirmedEmptySvod(null)).toBe(false);
  });
  it('does not call an unread plan/fact a known zero', () => {
    expect(svodCountsState({ planCount: null, factCount: 0 })).toBe('unread-plan');
    expect(svodCountsState({ planCount: 4, factCount: null })).toBe('unread-fact');
    expect(svodCountsState({ planCount: 0, factCount: 1 })).toBe('no-plan');
    expect(svodCountsState({ planCount: 4, factCount: 0 })).toBe('observed');
  });
});
