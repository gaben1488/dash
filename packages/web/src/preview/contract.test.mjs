import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
const rd=p=>readFileSync(p,'utf8');
const base='packages/web/src/';
const header=rd(base+'components/Header.tsx'), app=rd(base+'App.tsx');
const org=rd(base+'components/OrgStrip.tsx'),report=rd(base+'pages/Report.tsx');
const quality=rd(base+'pages/Quality.tsx'),settings=rd(base+'pages/Settings.tsx');
const monitoring=rd(base+'lib/monitoring/modes.ts'),data=rd(base+'pages/DataBrowser.tsx');
const palette=JSON.parse(rd(base+'components/source-drum/palettes.json'));
const sourceNav=rd(base+'components/source-drum/SourceNavigation.tsx');
const drumMarkup=rd(base+'components/source-drum/navigation.html');
const entry=rd(base+'preview/entry.ts'),mock=rd(base+'preview/synthetic-api.ts');
const overrides=rd(base+'preview/theme.css');

test('preview boots production main and preserves actual pages',()=>{
 assert.match(entry,/import\('\.\.\/main'\)/);
 for(const component of ['ReportPage','MonitoringPage','QualityPage','OrgStrip'])
   assert.ok(app.includes('<'+component),component);
 assert.match(entry,/installSyntheticApi\(\)/);
 assert.ok(header.includes('<SourceNavigation'), 'source cylinder is absent from Header');
 assert.ok(!header.includes('<NavPills activePage='), 'legacy compact pills still in live Header');
 assert.match(sourceNav,/input\[name="razdel"\]/);
 assert.match(sourceNav,/ArrowDown/);
 assert.match(sourceNav,/ResizeObserver/);
});
test('all 13 production navigation routes have original source palette pairs',()=>{
 const nav=header.split('export const NAV_ITEMS')[1]?.split('];')[0];
 assert.ok(nav);
 const labels=[...nav.matchAll(/id:\s*'[^']+',\s*label:\s*'([^']+)'/g)].map(m=>m[1]);
 const physicalTabs=(drumMarkup.match(/<input type="radio" name="razdel"/g)??[]).length;
 assert.equal(physicalTabs,13);
 assert.equal(labels.length,13);
 assert.equal(new Set(labels).size,13);
 assert.deepEqual(palette.map(p=>p.name),['Космос','Камчатка','Минералы']);
 for(const family of palette){assert.equal(family.tabs.length,13);
   assert.deepEqual(family.tabs.map(x=>x.name).sort(),[...labels].sort());}
});
test('reviewed production subtabs must survive',()=>{
 for(const s of ['Сверка','Качество заполнения','Замечания','Оценка управлений','Рекомендации','Журнал'])
   assert.ok(quality.includes("label: '"+s+"'"),s);
 for(const s of ['Источники данных','Соответствие ячеек','Подключение'])
   assert.ok(settings.includes("label: '"+s+"'"),s);
 for(const s of ['В работе','Реестр','Обзор','Связи','Справочники'])
   assert.ok(monitoring.includes("label: '"+s+"'"),s);
 for(const s of ["setViewMode('browse')","setViewMode('editor')",'Редактор таблиц'])
   assert.ok(data.includes(s),s);
 for(const s of ["setMode('live')","setMode('archive')",'Отчёт в Word','Доп. отчёт в Word','Оперативный в Word'])
   assert.ok(report.includes(s),s);
 assert.match(app,/page\s*!==\s*'report'\s*&&\s*<OrgStrip/);
 assert.match(org,/clearDeptOnly/);
});
test('read-only fixture blocks writes and never goes to external APIs',()=>{
 assert.match(mock,/if\(method!=='GET'\)/);
 assert.match(mock,/status:409/);
 assert.match(mock,/status:503/);
 assert.match(mock,/NOT-A-REAL-GOOGLE-ID/);
 assert.match(mock,/return originalFetch\(input,init\)/);
 assert.match(mock,/url\.origin!==window\.location\.origin/);
});
test('CSS changes tokens not OrgStrip, report or table layout',()=>{
 assert.match(overrides,/--surface-page:/);
 assert.match(overrides,/\.dash-source-navigation \.vkladka:has\(input:checked\)/);
 assert.ok(!/\.ob-strip\s*\{/.test(overrides));
 assert.ok(!/\.(report-layout|report-paper|work-layout|registry-table)\s*\{/.test(overrides));
});
test('standalone HTML contains the actual React app bundle',()=>{
 const p='docs/superpowers/mockups/dash-source-parity/Dash-source-bound-preview.html';
 assert.ok(existsSync(p));
 const html=rd(p);
 assert.ok(html.length>150000,'not a full React app');
 assert.match(html,/data-bundle="dash-real-pages"/);
 assert.ok(!/(?:src|href)="\.\/assets\//.test(html));
 assert.ok(html.includes('Dash · дизайн-гейт'));
});
