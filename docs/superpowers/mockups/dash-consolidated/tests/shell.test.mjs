import test from 'node:test';
import assert from 'node:assert/strict';
import { selectionAxes, weekWindow, initialUpdate, updateState, needsNotice } from '../src/shell-model.mjs';
import { ROWS, DEFAULT_FILTERS, selectRows } from '../src/model.mjs';

test('угол сохраняет адреса осей: бюджет не зажигает клетку года', () => {
  const axes = selectionAxes({ ...DEFAULT_FILTERS, budget: 'КБ' }, 'тыс', 41);
  assert.deepEqual(axes.map(a => a.key), ['year','period','week','department','organization','category','method','activity','budget','rate','unit','search']);
  assert.deepEqual(axes.filter(a => a.active).map(a => a.key), ['budget']);
});
test('полный 2026 год тихий; явный пустой период виден; миллионы — режим', () => {
  assert.equal(selectionAxes(DEFAULT_FILTERS, 'тыс', 41).filter(a => a.active).length, 0);
  const axes = selectionAxes({ ...DEFAULT_FILTERS, year: null, periods: [] }, 'млн', 41);
  assert.equal(axes.find(a => a.key === 'period').active, true);
  assert.equal(axes.find(a => a.key === 'unit').kind, 'mode');
});
test('пятничный цикл показывает обе календарные границы, включая переход года', () => {
  assert.deepEqual(weekWindow(41), { start: '2026-10-09', end: '2026-10-16', days: '9–16', month: 'октября', label: '9–16 октября 2026' });
  assert.equal(weekWindow(52).label, '25 декабря 2026 — 1 января 2027');
});
test('вебхук и чтение не означают, что версия на экране обновилась', () => {
  const seen = updateState(initialUpdate, { type: 'seen' });
  const reading = updateState(seen, { type: 'read' });
  const waiting = updateState(reading, { type: 'complete', blocked: true });
  assert.equal(seen.phase, 'seen');
  assert.equal(waiting.phase, 'waiting');
  assert.equal(waiting.version, 1);
  assert.equal(needsNotice(waiting), true);
  const dismissed = updateState(waiting, { type: 'dismiss' });
  assert.equal(dismissed.version, 1);
  assert.equal(dismissed.phase, 'waiting');
  assert.equal(needsNotice(dismissed), false);
  assert.deepEqual(updateState(dismissed, { type: 'apply' }), { phase: 'ready', version: 2, hidden: false });
});
test('ошибка сохраняет прежнюю версию; успешное безопасное применение молчит', () => {
  const failed = updateState(initialUpdate, { type: 'fail' });
  assert.equal(failed.version, 1);
  assert.equal(needsNotice(failed), true);
  const ready = updateState(initialUpdate, { type: 'complete', blocked: false });
  assert.equal(ready.version, 2);
  assert.equal(needsNotice(ready), false);
});
test('несколько учреждений сужают выбор без примеси остальных, бюджеты объединяются', () => {
  const rows = selectRows(ROWS, { orgs: ['Школа · пример', 'Дом культуры · пример'] });
  assert.ok(rows.length > 1);
  assert.ok(rows.every(r => ['Школа · пример', 'Дом культуры · пример'].includes(r.org)));
  const twoBudgets = selectRows(ROWS, { budgets: ['ФБ', 'КБ'] });
  assert.ok(twoBudgets.length > 0);
  assert.ok(twoBudgets.every(r => r.budget !== 'МБ'));
  assert.equal(selectRows(ROWS, { orgs: [] }).length, 0);
});
