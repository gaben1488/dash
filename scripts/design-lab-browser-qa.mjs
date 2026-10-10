/**
 * Browser QA of the DEV-ONLY design studio and original-source comparison.
 * Run in CI with puppeteer-core installed outside the repo, not a product dependency.
 *
 * This checks real Chromium layout, scene behavior and produces reviewable screenshots.
 * It is NOT approval of all 13 product pages, nor pixel equivalence to original HTML.
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const require = createRequire(import.meta.url);
const root = process.env.RUNNER_TEMP;
if (!root) throw new Error('RUNNER_TEMP is required to isolate browser QA dependencies');
const puppeteer = require(path.join(root, 'dash-browser-qa', 'node_modules', 'puppeteer-core'));
const chrome = process.env.CHROME_PATH;
if (!chrome) throw new Error('CHROME_PATH was not resolved: real Chromium cannot be verified');
const out = path.resolve('artifacts/design-lab-browser-qa');
await mkdir(out, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: chrome,
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
});
const report = { run: 'real-chromium', screenshots: [], widths: [], scenarios: [], limitations: [
  'Source HTML executes in a sandbox without network access; historical mockup calculations are not production logic',
  'Actual Chrome screenshots need a human aesthetic review against source HTML',
  'Dev Kit is excluded from production build; these checks do not test live procurement pages',
] };

const url = 'http://127.0.0.1:5173/?kit#/kit/lab';

async function tab(page, text) {
  const triggers = await page.$$('[role="tab"]');
  for (const trigger of triggers) {
    if ((await trigger.evaluate(el => el.textContent?.trim())) === text) {
      await trigger.click();
      await page.waitForFunction(label =>
        [...document.querySelectorAll('[role="tab"]')].some(el => el.textContent?.trim() === label && el.getAttribute('data-state') === 'active'),
      {}, text);
      return;
    }
  }
  throw new Error('Tab is missing: ' + text);
}

async function capture(page, name) {
  const filepath = path.join(out, name + '.png');
  await page.screenshot({ path: filepath, fullPage: false });
  report.screenshots.push(name + '.png');
}

try {
  for (const viewport of [
    { width: 1280, height: 900 },
    { width: 768, height: 900 },
    { width: 390, height: 844 },
  ]) {
    const page = await browser.newPage();
    await page.setViewport({ ...viewport, deviceScaleFactor: 1 });
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForSelector('.dash-design-preview', { timeout: 30000 });
    await page.evaluate(() => document.fonts.ready);
    if (viewport.width === 390) {
      const collapsed = await page.$eval('.dl-controls', el => getComputedStyle(el).display);
      assert.equal(collapsed, 'none', 'Mobile layout must not bury the real preview under seven screens of controls');
      const toggle = await page.$('.dl-mobile-controls-toggle');
      assert.ok(toggle);
      await toggle.click();
      assert.equal(await page.$eval('.dl-controls', el => getComputedStyle(el).display), 'grid');
      assert.equal(await toggle.evaluate(el => el.getAttribute('aria-expanded')), 'true');
      await toggle.click();
      assert.equal(await page.$eval('.dl-controls', el => getComputedStyle(el).display), 'none');
      report.scenarios.push('mobile-palette-disclosure');
    }
    const tabGeometry = await page.evaluate(() => {
      const list = document.querySelector('.dl-tabs');
      const rect = list.getBoundingClientRect();
      return [...list.querySelectorAll('[role="tab"]')].map(el => {
        const t = el.getBoundingClientRect();
        return { name: el.textContent?.trim(), left: t.left, right: t.right, containerLeft: rect.left, containerRight: rect.right };
      });
    });
    assert.ok(tabGeometry.every(t => t.left >= t.containerLeft - 2 && t.right <= t.containerRight + 2),
      'Tabs are clipped: ' + JSON.stringify(tabGeometry));
    await capture(page, '01-palette-' + viewport.width);
    const width = await page.evaluate(() => ({
      inner: window.innerWidth,
      doc: document.documentElement.scrollWidth,
      body: document.body.scrollWidth,
    }));
    report.widths.push({ viewport: viewport.width, ...width });
    assert.ok(width.doc <= width.inner + 2, 'Entire page overflows by ' + (width.doc - width.inner) + 'px at ' + viewport.width);

    // Actual reactivity: the summary and row count must use the same source.
    await page.select('select[aria-label="Фильтр демо-организаций"]', 'УКСиМП');
    const filtered = await page.evaluate(() => ({
      total: document.querySelector('.dl-big-number')?.textContent,
      issues: [...document.querySelectorAll('.dl-summary-metrics strong')].map(el => el.textContent),
      rows: [...document.querySelectorAll('.dl-demo-table tbody tr')].map(el => el.textContent),
    }));
    assert.match(filtered.total ?? '', /1/);
    assert.deepEqual(filtered.issues, ['0', '1']);
    assert.equal(filtered.rows.length, 1);
    assert.match(filtered.rows[0], /173\/2/);
    report.scenarios.push('organization-filter-' + viewport.width);

    await tab(page, 'Сравнение');
    const previews = await page.evaluate(() => [...document.querySelectorAll('.dash-design-preview')]
      .map(root => [...root.querySelectorAll('.dl-demo-table tbody tr')].map(el => el.textContent)));
    assert.equal(previews.length, 2);
    assert.deepEqual(previews[0], previews[1], 'A/B comparison loses shared filters');
    await capture(page, '02-comparison-' + viewport.width);
    report.scenarios.push('comparison-same-data-' + viewport.width);

    await tab(page, 'Компоненты и практики');
    await page.waitForSelector('.dl-pattern-gallery');
    await capture(page, '03-recipes-' + viewport.width);
    const patternCount = await page.$eval('.dl-pat-links', el => el.querySelectorAll('button').length);
    assert.equal(patternCount, 14);
    report.scenarios.push('recipe-gallery-' + viewport.width);


    // Newly researched historical azure, saved original geometry and Pulse hero.
    await tab(page, 'Мастерская продукта');
    await page.waitForSelector('.dr-aurora-stage', { timeout: 30000 });
    const auroraBaseline = await page.evaluate(() => ({
      variants: document.querySelectorAll('.dr-variant-grid button').length,
      familyPairs: document.querySelectorAll('.dr-family-grid button').length,
      contrast: document.querySelector('.dr-readable')?.getAttribute('data-valid'),
      exactTop: document.querySelector('.dr-aurora-stage')?.style.getPropertyValue('--dr-top'),
    }));
    assert.equal(auroraBaseline.variants, 5);
    assert.equal(auroraBaseline.familyPairs, 39);
    assert.equal(auroraBaseline.contrast, 'true');
    assert.equal(auroraBaseline.exactTop, '#5b99f8');
    // Audit every documented family color across all seven UI states and six
    // physical finishes. Computed CSS is tested; pixel contrast remains manual.
    if (viewport.width === 1280) {
      const matrix = await page.evaluate(() => {
        const cells = [...document.querySelectorAll('.dr-family-grid button > span')];
        function channels(str) {
          return [...str.matchAll(/rgba?\(\s*([\d.]+),\s*([\d.]+),\s*([\d.]+)/g)]
            .map(m => [Number(m[1]), Number(m[2]), Number(m[3])]);
        }
        function luminance(rgb) {
          const [r,g,b]=rgb.map(value=>{
            const c=value/255;
            return c<=0.04045?c/12.92:Math.pow((c+0.055)/1.055,2.4);
          });
          return 0.2126*r+0.7152*g+0.0722*b;
        }
        function contrast(a,b) {
          const l=luminance(a),r=luminance(b);
          return (Math.max(l,r)+.05)/(Math.min(l,r)+.05);
        }
        const parsed=cells.map(el=>{
          const colors=channels(el.style.backgroundImage);
          const ink=channels(getComputedStyle(el).color)[0];
          const sample=Array.from({length:11},(_,i)=>{
            const t=i/10;
            return colors.length===2?colors[0].map((v,n)=>v+(colors[1][n]-v)*t):null;
          });
          return { colors,ink,minimum:ink&&sample.every(Boolean)?
            Math.min(...sample.map(c=>contrast(ink,c))):0 };
        });
        const fails=parsed.map((x,i)=>({i,min:x.minimum})).filter(x=>x.min<4.5);
        const finishes=['matte','candy','metallic','pearl','xirallic','glass'];
        const states=['idle','selected','hover','focus','partial','disabled','danger'];
        const stage=document.querySelector('.dr-aurora-stage');
        const oldFinish=stage.getAttribute('data-finish');
        const control=stage.querySelector('.dr-hardware-control');
        const oldState=control.getAttribute('data-state');
        const seen=[];
        for(const finish of finishes)for(const state of states){
          stage.setAttribute('data-finish',finish);
          control.setAttribute('data-state',state);
          const css=getComputedStyle(control);
          seen.push({finish,state,color:css.color,background:css.backgroundImage,
            border:css.borderColor});
        }
        stage.setAttribute('data-finish',oldFinish);
        control.setAttribute('data-state',oldState);
        return {familyCount:cells.length,failedIntermediateContrasts:fails,
          finishes:finishes.length,states:states.length,materialStates:seen.length,
          missingPaint:seen.filter(x=>x.color==='transparent'||x.color==='').length,
          dangerousStates:seen.filter(x=>x.state==='danger'&&!x.color.includes('255')).length};
      });
      assert.equal(matrix.familyCount,39);
      assert.deepEqual(matrix.failedIntermediateContrasts,[],'An original family swatch fails intermediate gradient contrast');
      assert.equal(matrix.materialStates,42);
      assert.equal(matrix.missingPaint,0);
      assert.equal(matrix.dangerousStates,0);
      report.scenarios.push('39-families-intermediate-contrast');
      report.scenarios.push('42-finish-state-computed-css');
      report.paletteMatrix=matrix;
    }
    await capture(page, '06-azure-recovered-' + viewport.width);
    report.scenarios.push('historical-azure-and-39-source-pairs-' + viewport.width);

    await page.evaluate(() => {
      const buttons = [...document.querySelectorAll('.dr-variant-grid button')];
      const history = buttons.find(b => b.textContent?.includes('7 августа'));
      if (!history) throw new Error('Historical blue/cream proof missing');
      history.click();
    });
    assert.equal(await page.$eval('.dr-readable', el => el.getAttribute('data-valid')), 'false',
      'Historical white-on-blue must NOT silently be accepted');
    await page.evaluate(() => {
      const recovered = [...document.querySelectorAll('.dr-variant-grid button')]
        .find(b => b.textContent?.includes('Восстановленная лазурь'));
      recovered.click();
    });
    assert.equal(await page.$eval('.dr-readable', el => el.getAttribute('data-valid')), 'true');
    report.scenarios.push('inaccessible-history-rejected-' + viewport.width);

    await page.evaluate(() => {
      const target = [...document.querySelectorAll('.dr-view-tabs button')]
        .find(b => b.textContent?.includes('Большой круг'));
      if (!target) throw Error('Missing Pulse experiment');
      target.click();
    });
    await page.waitForSelector('.dr-pulse-composition[data-layout="hero"] .recharts-wrapper', { timeout: 30000 });
    await page.waitForFunction(() =>
      document.querySelectorAll('.dr-pulse-chart .recharts-pie path').length > 0,
      { timeout: 15000 });
    const pulseBefore = await page.evaluate(() => ({
      sum: document.querySelector('.dr-pulse-center strong')?.textContent,
      layout: document.querySelector('.dr-pulse-composition')?.getAttribute('data-layout'),
      segments: document.querySelectorAll('.dr-pulse-legend button[aria-label^="Открыть состав"]').length,
    }));
    assert.equal(pulseBefore.layout, 'hero');
    assert.ok(pulseBefore.sum?.includes('13'));
    assert.equal(pulseBefore.segments, 2);
    const arcGeometry = await page.evaluate(() => {
      const outer = document.querySelector('.dr-pulse-chart').getBoundingClientRect();
      const sectors = [...document.querySelectorAll('.dr-pulse-chart .recharts-pie path')];
      return {sectors:sectors.length, clipped:sectors.map(el=>{
        const r=el.getBoundingClientRect();
        return {l:r.left-outer.left,r:r.right-outer.right,t:r.top-outer.top,b:r.bottom-outer.bottom};
      }).filter(r=>r.l < -2 || r.r > outer.width+2 || r.t < -2 || r.b > outer.height+2)};
    });
    assert.ok(arcGeometry.sectors>0,'The big circle drew no sectors');
    assert.deepEqual(arcGeometry.clipped,[],'Focused circle sectors spill outside chart viewport');
    report.scenarios.push('big-circle-uncropped-'+viewport.width);
    await capture(page, '07-pulse-hero-' + viewport.width);
    await page.evaluate(() => {
      const button = document.querySelector('button[aria-label="Открыть состав УО"]');
      if (!button) throw Error('Department drill missing');
      button.click();
    });
    await page.waitForFunction(() => document.querySelector('.dr-pulse-heading h3')?.textContent === 'Состав УО');
    const deepTotal = await page.$eval('.dr-pulse-center strong', el => el.textContent);
    assert.ok(deepTotal.includes('5') && deepTotal.includes('820'));
    const back = await page.$('.dr-back');
    assert.ok(back);
    await back.click();
    await page.waitForFunction(() => document.querySelector('.dr-pulse-heading h3')?.textContent === 'Доли по управлениям');
    await page.evaluate(() => {
      const btn = [...document.querySelectorAll('.dr-pulse-units button')].find(b => b.textContent === 'млн ₽');
      btn.click();
    });
    const millions = await page.$eval('.dr-pulse-center strong', el => el.textContent);
    assert.ok(millions?.includes('13,62'));
    report.scenarios.push('pulse-large-drill-and-units-' + viewport.width);

    await page.keyboard.down('Control');
    await page.keyboard.press('KeyK');
    await page.keyboard.up('Control');
    await page.waitForSelector('[role="dialog"][aria-label="Поиск действий"]', { timeout: 10000 });
    await page.evaluate(() => {
      const command = [...document.querySelectorAll('[cmdk-item]')]
        .find(el => el.textContent?.includes('Изучить механики'));
      if (!command) throw Error('No keyboard-reachable workflow action');
      command.click();
    });
    await page.waitForFunction(() => document.querySelector('.dr-workflow-grid') !== null);
    const dialogGone = await page.$('[role="dialog"][aria-label="Поиск действий"]');
    assert.equal(dialogGone, null, 'Command dialog must close after selection');
    await capture(page, '08-product-mechanics-' + viewport.width);
    report.scenarios.push('keyboard-command-palette-' + viewport.width);
    const noWholeOverflow = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 2);
    assert.ok(noWholeOverflow, 'Product research creates whole page horizontal overflow at ' + viewport.width);

    // The source-facing inspector is a navigable contract map, not a new
    // datastore. All 13 routes must stay selectable, with exact source links.
    await page.evaluate(() => {
      const item=[...document.querySelectorAll('.dr-view-tabs button')]
        .find(b=>b.textContent?.includes('Атомы и связи'));
      if(!item)throw Error('Missing source dependency inspector');
      item.click();
    });
    await page.waitForSelector('.dr-atlas-list', {timeout:10000});
    const routes=await page.$eval('.dr-atlas-list button',els=>els.length);
    assert.equal(routes,13,'The atom viewer hides a real Dash route');
    await capture(page,'09-atom-contracts-'+viewport.width);
    report.scenarios.push('13-interactive-atom-contracts-'+viewport.width);

    if (viewport.width === 1280 || viewport.width === 390) {
      await tab(page, 'Исходные HTML');
      await page.waitForSelector('iframe[title^="Архивный оригинал"]', { timeout: 30000 });
      const initial = await page.$eval('iframe[title^="Архивный оригинал"]', el => ({
        title: el.title, src: el.getAttribute('srcdoc'), sandbox: el.getAttribute('sandbox'),
      }));
      assert.match(initial.src ?? '', /Отделки Пульса/);
      assert.equal(initial.sandbox, 'allow-scripts');
      await capture(page, '04-original-finish-' + viewport.width);

      await page.select('select[aria-label="Оригинальный макет"]', 'pulse');
      await page.waitForFunction(() => {
        const iframe = document.querySelector('iframe[title^="Архивный оригинал"]');
        return iframe?.getAttribute('srcdoc')?.includes('Пульс — макет экрана');
      }, { timeout: 30000 });
      await capture(page, '05-original-pulse-' + viewport.width);
      report.scenarios.push('real-original-html-' + viewport.width);

      await page.select('select[aria-label="Оригинальный макет"]', 'ether');
      await page.waitForSelector('pre[aria-label="Исходный HTML-фрагмент"]', { timeout: 30000 });
      const frameCount = await page.$$eval('iframe[title^="Архивный оригинал"]', els => els.length);
      assert.equal(frameCount, 0, 'Ether fragment falsely displayed as complete independent page');
      report.scenarios.push('fragment-is-not-a-page-' + viewport.width);
    }
    await page.close();
  }
} catch (error) {
  report.failure = error instanceof Error ? error.stack : String(error);
  await writeFile(path.join(out, 'results.json'), JSON.stringify(report, null, 2), 'utf8');
  throw error;
} finally {
  await browser.close();
}
await writeFile(path.join(out, 'results.json'), JSON.stringify(report, null, 2), 'utf8');
console.log(JSON.stringify({ status: 'PASS', widths: report.widths, scenarios: report.scenarios, screenshotCount: report.screenshots.length }, null, 2));
