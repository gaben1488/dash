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
