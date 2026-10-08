import { describe, expect, it } from 'vitest';
import { decodeWorkspace, encodeWorkspace } from './workspace-state';
import { emptySlices } from './slices';
it('restores a filtered, sorted working view', () => {
 const state = { modeId: 'all', slices: { ...emptySlices(), customer: 'Заказчик', periodYear: 2026 }, sortKey: 'nmck' as const, sortDir: 'desc' as const };
 expect(decodeWorkspace(encodeWorkspace(state))).toEqual(state);
});
describe('untrusted stored view', () => {
 it.each(['bad json', '{"version":99}', '{"version":1,"modeId":"bogus"}', '{"version":1,"modeId":"all","slices":{"query":42}}'])('ignores invalid persisted input %s', raw => expect(decodeWorkspace(raw)).toBeNull());
});
