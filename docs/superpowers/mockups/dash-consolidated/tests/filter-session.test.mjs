import test from 'node:test';
import assert from 'node:assert/strict';
import { filterSession, initialFilterSession } from '../src/filter-session.mjs';

test('сброс/возврат атомарно восстанавливает отбор, единицы и неделю', () => {
  let state = initialFilterSession();
  state = filterSession(state, { type: 'change', next: f => ({ ...f, depts: ['УО','УД'], periods: ['2025-10','2026-9'] }) });
  state = filterSession(state, { type: 'unit', next: 'млн' });
  state = filterSession(state, { type: 'week', next: 40 });
  const before = state;
  const reset = filterSession(state, { type: 'reset' });
  assert.equal(reset.filters.year, 2026);
  assert.equal(reset.filters.periods, null);
  assert.equal(reset.unit, 'тыс');
  assert.equal(reset.week, 41);
  assert.deepEqual(reset.undo, { filters: before.filters, unit: 'млн', week: 40 });
  assert.deepEqual(filterSession(reset, { type: 'restore' }), { ...before, undo: null });
});

test('новый выбор после сброса делает прежний возврат недоступным', () => {
  const reset = filterSession(initialFilterSession(), { type: 'reset' });
  const changed = filterSession(reset, { type: 'change', next: f => ({ ...f, orgs: ['Школа · пример'], periods: [] }) });
  assert.equal(changed.undo, null);
  assert.deepEqual(changed.filters.periods, []);
  assert.equal(filterSession(changed, { type: 'restore' }), changed);
});

test('после сброса изменение недели либо единиц отменяет устаревший возврат', () => {
  const base = filterSession(initialFilterSession(), { type: 'reset' });
  const week = filterSession(base, { type: 'week', next: w => w - 1 });
  assert.equal(week.week, 40);
  assert.equal(week.undo, null);
  const unit = filterSession(base, { type: 'unit', next: 'млн' });
  assert.equal(unit.unit, 'млн');
  assert.equal(unit.undo, null);
  assert.equal(filterSession(unit, { type: 'restore' }), unit);
});

test('последовательные изменения React-style updater не теряют предыдущие изменения', () => {
  let current = initialFilterSession();
  current = filterSession(current, { type: 'change', next: f => ({ ...f, search: '173/1' }) });
  current = filterSession(current, { type: 'change', next: f => ({ ...f, depts: ['УО'] }) });
  assert.equal(current.filters.search, '173/1');
  assert.deepEqual(current.filters.depts, ['УО']);
  assert.equal(filterSession(current, { type: 'other' }), current);
});
