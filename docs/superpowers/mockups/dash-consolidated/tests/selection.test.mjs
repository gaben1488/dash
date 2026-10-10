import test from 'node:test';
import assert from 'node:assert/strict';
import { toggleSelection } from '../src/selection.mjs';
import { ROWS, selectRows } from '../src/model.mjs';

test('удаление последнего бюджета оставляет явную пустоту, не весь бюджет', () => {
  assert.deepEqual(toggleSelection(['КБ'], 'КБ'), []);
  assert.equal(selectRows(ROWS, { budgets: [] }).length, 0);
  assert.equal(selectRows(ROWS, { budgets: null }).length, ROWS.length);
});
test('удаление последнего управления оставляет пустой отбор', () => {
  assert.deepEqual(toggleSelection(['УО'], 'УО'), []);
  assert.equal(selectRows(ROWS, { depts: [] }).length, 0);
  assert.equal(selectRows(ROWS, { depts: null }).length, ROWS.length);
});
test('удаление последней организации оставляет пустой отбор', () => {
  assert.deepEqual(toggleSelection(['Школа · пример'], 'Школа · пример'), []);
  assert.equal(selectRows(ROWS, { orgs: [] }).length, 0);
  assert.equal(selectRows(ROWS, { orgs: null }).length, ROWS.length);
});
test('мультивыбор не меняет существующий массив и сохраняет остальные элементы', () => {
  const original = ['УО', 'УД'];
  const next = toggleSelection(original, 'УД');
  assert.deepEqual(next, ['УО']);
  assert.deepEqual(original, ['УО', 'УД']);
  assert.deepEqual(toggleSelection(next, 'УЭР'), ['УО', 'УЭР']);
});
