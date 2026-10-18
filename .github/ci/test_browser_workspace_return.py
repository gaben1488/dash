"""Exercise the real browser check against a synthetic SPA, including an inert Back handler."""
import importlib.util
import json
import os
import unittest
from pathlib import Path

from playwright.async_api import TimeoutError as BrowserTimeoutError
from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('browser_workspace_verifier', ROOT / '.github/ci/live_browser_readback.py')
verifier = importlib.util.module_from_spec(spec)
spec.loader.exec_module(verifier)


class WorkspaceReturnTests(unittest.IsolatedAsyncioTestCase):
    async def scenario(self, *, inert_back=False, wrong_receipt=False):
        self.assertTrue(hasattr(verifier, 'verify_workspace_return'), 'Workspace return check is missing')
        release = 'REL-' + 'a' * 64
        async with async_playwright() as driver:
            browser = await getattr(driver, os.environ.get('BROWSER_ENGINE', 'chromium')).launch()
            try:
                page = await browser.new_page(viewport={'width': 1600, 'height': 1000})
                page.set_default_timeout(1200)
                async def route(request):
                    if '/api/' in request.request.url:
                        await request.fulfill(json={'selected': {'release_id': 'wrong' if wrong_receipt else release}})
                        return
                    await request.fulfill(content_type='text/html; charset=utf-8', body='''<meta charset="utf-8"><nav aria-label="Навигация" tabindex="0" data-nav-group="0">
                      <button class="np-btn" data-page="data"><span class="np-label">Реестр</span></button>
                      <button class="np-btn" data-page="analytics"><span class="np-label">Аналитика</span></button>
                      <button class="np-btn" data-page="report"><span class="np-label">Отчёт</span></button></nav>
                      <button>Отчёт в Word</button><button>Снять фиксацию Word-выпуска</button><script>
                      function render(){for(const b of document.querySelectorAll('.np-btn')) b.setAttribute('aria-current',b.dataset.page===new URL(location.href).searchParams.get('page')?'page':'false');}
                      for(const b of document.querySelectorAll('.np-btn'))b.onclick=()=>{const u=new URL(location.href);u.searchParams.set('page',b.dataset.page);history.pushState(null,'',u);render();if(b.dataset.page==='report')fetch('/api/report-releases/'''+release+'''/status');};
                      window.addEventListener('popstate',()=>{if(!'''+json.dumps(inert_back)+''')render();});render();</script>''')
                await page.route('https://fixture.test/**', route)
                await page.goto('https://fixture.test/?page=report&year=2026&period=q3&word=' + release + '&word_ctx=synthetic&depts=SYNTHETIC')
                proof = {'browser_profile': 'desktop'}
                await verifier.verify_workspace_return(page, page.get_by_role('navigation', name='Навигация'), 'desktop', proof, timeout=1200)
                self.assertEqual(proof['workspace_return']['result'], 'PASS')
                self.assertNotIn('SYNTHETIC', str(proof))
            finally:
                await browser.close()

    async def test_back_reload_and_exact_word_return(self):
        await self.scenario()

    async def test_inert_back_and_substituted_receipt_cannot_pass(self):
        for inputs in ({'inert_back': True}, {'wrong_receipt': True}):
            with self.subTest(inputs=inputs), self.assertRaises((AssertionError, BrowserTimeoutError)):
                await self.scenario(**inputs)


if __name__ == '__main__':
    unittest.main()
