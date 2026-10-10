import test from 'node:test';
import assert from 'node:assert/strict';
import { filterSession, initialFilterSession } from '../src/filter-session.mjs';

test('сброс и немедленный возврат сохраняют все прежние оси и режимы', () => {
  const custom = filterSession(initialFilterSession(), {
    type: 'change',
    next: f => ({ ...f, depts: ['УО', 'УД'], periods: ['2026-9', '2025-10'] }),
  });
  const reset = filterSession(custom, { type: 'reset', unit: 'млн', week: 40 });
  assert.equal(reset.filters.year, 2026);
  assert.equal(reset.filters.periods, null);
  assert.deepEqual(reset.undo, { filters: custom.filters, unit: 'млн', week: 40 });
  const restored = filterSession(reset, { type: 'restore' });
  assert.deepEqual(restored.filters, custom.filters);
  assert.equal(restored.undo, null);
});

test('после сброса новая правка отменяет старый возврат, не теряя отбор', () => {
  const initial = initialFilterSession();
  const reset = filterSession(initial, { type: 'reset', unit: 'тыс', week: 41 });
  const changed = filterSession(reset, {
    type: 'change',
    next: f => ({ ...f, orgs: ['Школа · пример'], search: '173/1' }),
  });
  assert.equal(changed.undo, null);
  assert.deepEqual(filterSession(changed, { type: 'restore' }), changed);
});

test('разные прямые правки через setFilters тоже отменяют старый возврат', () => {
  const reset = filterSession(initialFilterSession(), { type: 'reset', unit: 'тыс', week: 41 });
  const selected = filterSession(reset, { type: 'change', next: { ...reset.filters, periods: [] } });
  assert.equal(selected.undo, null);
  assert.deepEqual(selected.filters.periods, []);
  assert.equal(filterSession(selected, { type: 'unexpected' }), selected);
});
