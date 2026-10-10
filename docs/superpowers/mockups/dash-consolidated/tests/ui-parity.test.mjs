import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { UI_PARITY_PAGES, UI_PARITY_READY, hashForPage, pageFromHash } from '../src/ui-parity.mjs';
const root = new URL('../../../../../', import.meta.url);
const preview = new URL('../', import.meta.url);
const file = path => readFileSync(new URL(path, root), 'utf8');

test('13 authentic pages and original navigation are accounted for', () => {
  const ids = UI_PARITY_PAGES.map(p => p.id);
  assert.equal(new Set(ids).size, 13);
  const app = readFileSync(new URL('src/App.jsx', preview), 'utf8');
  const navSource = app.match(/const NAV = \[([\s\S]*?)\];/)?.[1];
  assert.ok(navSource, 'The original demo nav must remain');
  const navIds = [...navSource.matchAll(/\['([a-z]+)',\s*'([^']+)'/g)].map(m => m[1]);
  assert.deepEqual(navIds, ids);
  const sourceHtml = readFileSync(new URL('src/source-shell/navigation.html', preview), 'utf8');
  assert.equal((sourceHtml.match(/name="razdel"/g) ?? []).length, 13);
  const store = file('packages/web/src/store.ts');
  for (const id of ids) assert.ok(store.includes("| '" + id + "'"), 'Missing real Dash route ' + id);
});

test('each nested mode and output is grounded in the corresponding real component', () => {
  for (const page of UI_PARITY_PAGES) {
    assert.ok(existsSync(new URL(page.source, root)), 'Source absent: ' + page.source);
    assert.ok(page.note.length >= 35, 'Unexplained parity status: ' + page.id);
    const modeIds = new Set();
    for (const mode of page.modes) {
      assert.ok(!modeIds.has(mode.id), 'Duplicate mode: ' + page.id + '/' + mode.id);
      modeIds.add(mode.id);
      const source = file(mode.markerSource || page.source);
      assert.ok(source.includes(mode.marker), 'Real source lost ' + page.id + '/' + mode.label);
    }
  }
  assert.deepEqual(UI_PARITY_PAGES.find(p => p.id === 'monitoring').modes.map(x => x.label), ['В работе','Реестр','Обзор','Связи','Справочники']);
  assert.equal(UI_PARITY_PAGES.find(p => p.id === 'quality').modes.length, 6);
  assert.equal(UI_PARITY_PAGES.find(p => p.id === 'settings').modes.length, 3);
});

test('only explicit evidence can authorize a future 1:1 claim', () => {
  assert.equal(UI_PARITY_READY, false);
  assert.equal(UI_PARITY_PAGES.find(p => p.id === 'dashboard').status, 'excluded');
  for (const p of UI_PARITY_PAGES.filter(p => p.id !== 'dashboard')) assert.equal(p.status, 'blocked');
  const html = readFileSync(new URL('public/qa-parity.html', preview), 'utf8');
  const json = html.match(/<script type="application\/json" id="ui-parity-source">([\s\S]*?)<\/script>/)?.[1];
  assert.ok(json, 'The interactive QA inventory is absent');
  assert.deepEqual(JSON.parse(json), UI_PARITY_PAGES);
});

test('QA links preserve the correct outer page and reject unknown routes', () => {
  assert.equal(hashForPage('quality'), '#/page/quality');
  assert.equal(pageFromHash('#/page/report'), 'report');
  assert.equal(pageFromHash('#/page/quality'), 'quality');
  assert.equal(pageFromHash('#/page/monitoring'), 'monitoring');
  assert.equal(pageFromHash('#/page/unknown'), 'data');
  assert.equal(pageFromHash('#/page/report/extra'), 'data');
  assert.equal(pageFromHash(''), 'data');
});
