"""Browser acceptance must detect inert controls using real pointer/touch input."""
import os
import tempfile
import unittest
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.request import urlopen

import live_browser_readback as verifier
from playwright.async_api import async_playwright

LABELS = ['Показывать суммы в тысячах рублей', 'Показывать суммы в миллионах рублей',
          'Конкурентные способы, статья 24 44-ФЗ', 'Единственный поставщик, статья 93 44-ФЗ',
          'Все способы закупки', 'Программные мероприятия', 'Текущая деятельность',
          'Федеральный бюджет', 'Краевой бюджет', 'Муниципальный бюджет']


async def launch_browser(driver):
    # Linux headless selects WPE; CI uses the GTK renderer under Xvfb for this
    # full glass fixture. Same real input, effects and actionability assertions.
    return await getattr(driver, os.environ.get('BROWSER_ENGINE', 'chromium')).launch(
        headless=os.environ.get('BROWSER_HEADED') != '1')


@contextmanager
def header_fixture(artifact):
    """Serve exactly the compiled synthetic Header, with no directory access."""
    body = artifact.read_bytes()

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            if self.path != '/navigation-qa.html':
                self.send_error(404)
                return
            self.send_response(200)
            self.send_header('Content-Type', 'text/html; charset=utf-8')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *_args):
            pass

    server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f'http://127.0.0.1:{server.server_port}/navigation-qa.html'
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=1)


async def open_current_header(page, url):
    await page.goto(url)
    await page.bring_to_front()
    # Exercise an actual initial paint, including the unmodified glass effects.
    # WPE's offscreen fixture can run JS timers while withholding paint/RAF;
    # a native snapshot requests that paint without force-clicks or reduced motion.
    await page.screenshot(timeout=5000, animations='allow')
    # Do not add a second readiness contract based on idle RAF delivery. Native
    # screenshot already waits for fonts and paint; real click/tap below still
    # require Playwright visibility, stability and hit testing within 5 seconds.


class FailureEvidenceTests(unittest.TestCase):
    def test_http_fixture_serves_only_the_compiled_synthetic_file(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            artifact = root / 'navigation-qa.html'
            artifact.write_bytes(b'<p>synthetic Header</p>')
            (root / 'private.txt').write_text('MUST_NOT_BE_SERVED')
            with header_fixture(artifact) as url:
                with urlopen(url, timeout=2) as response:
                    self.assertEqual(response.read(), artifact.read_bytes())
                for path in ('/', '/private.txt', '/navigation-qa.html?file=private.txt'):
                    with self.assertRaises(HTTPError) as error:
                        urlopen(url.removesuffix('/navigation-qa.html') + path, timeout=2)
                    self.assertEqual(error.exception.code, 404)

    def test_failure_location_exposes_only_known_code_frame_without_private_message(self):
        def verify_header_controls():
            raise AssertionError('PRIVATE_PAGE_TEXT')
        with patch.object(verifier, '__file__', __file__):
            try:
                verify_header_controls()
            except AssertionError as error:
                result = verifier.failure_location(error)
        self.assertEqual(result, {'function': 'verify_header_controls',
                                  'line': verify_header_controls.__code__.co_firstlineno + 1})
        self.assertNotIn('PRIVATE', str(result))

    def test_foreign_frames_are_not_published_as_product_source(self):
        try:
            raise AssertionError('PRIVATE_PAGE_TEXT')
        except AssertionError as error:
            self.assertIsNone(verifier.failure_location(error))


class HeaderControlsTests(unittest.IsolatedAsyncioTestCase):
    async def scenario(self, inert=False, corrupt_period=False, corrupt_context=False):
        async with async_playwright() as driver:
            browser = await launch_browser(driver)
            try:
                _, options = verifier.browser_settings('iphone', driver.devices)
                page = await browser.new_page(**options)
                buttons = ''.join(f'<button aria-label="{label}" aria-pressed="{str(i in (0, 4)).lower()}">x</button>' for i, label in enumerate(LABELS))
                await page.set_content('''<meta name="viewport" content="width=device-width, initial-scale=1">
                    <style>button{min-height:44px;min-width:44px}</style><header data-page-skin="registry">'''
                    + buttons + '<button id="calendar" aria-pressed="false" aria-label="Январь 2026">Янв</button><button class="wr-row-active" aria-pressed="true"><span class="wr-label">Неделя42</span></button>' + '''<button id="theme" aria-label="Включить светлую тему">theme</button>
                    <input aria-label="Поиск по реестру закупок"><button id="clear" aria-label="Очистить строку поиска">clear</button>
                    <button id="corner" aria-label="Фильтры линейки: 0. Открыть настройки">filters</button></header>
                    <div role="dialog" aria-label="Фильтры линейки" hidden>filters</div>
                    <script>
                    window.touches=0;document.addEventListener('touchstart',()=>window.touches++);
                    const buttons=[...document.querySelectorAll('button[aria-pressed]')];
                    buttons.forEach((b,i)=>b.onclick=()=>{
                      if(window.inert&&i===1)return;
                      if(i===1&&window.corruptPeriod)document.querySelector('#calendar').setAttribute('aria-pressed','true');
                      if(i===1&&window.corruptContext)document.querySelector('.wr-label').textContent='Неделя43';
                      if(i<2){buttons[0].setAttribute('aria-pressed',i===0);buttons[1].setAttribute('aria-pressed',i===1);}
                      else if(i<5){buttons.slice(2,5).forEach((x,j)=>x.setAttribute('aria-pressed',j===i-2));}
                      else b.setAttribute('aria-pressed',b.getAttribute('aria-pressed')!=='true');
                    });
                    document.querySelector('#theme').onclick=e=>{e.target.setAttribute('aria-label',e.target.getAttribute('aria-label').includes('светлую')?'Включить тёмную тему':'Включить светлую тему');document.querySelector('#calendar').setAttribute('aria-label','Январь 2026 — данных нет');};
                    document.querySelector('#clear').onclick=()=>document.querySelector('input').value='';
                    document.querySelector('#corner').onclick=()=>{const d=document.querySelector('[role=dialog]');d.hidden=!d.hidden;};
                    </script>''')
                await page.evaluate('(value)=>Object.assign(window,value)', {'inert': inert, 'corruptPeriod': corrupt_period, 'corruptContext': corrupt_context})
                proof = {}
                await verifier.verify_header_controls(page, 'iphone', proof)
                self.assertEqual(proof['header_controls'], 'PASS')
                self.assertGreater(await page.evaluate('window.touches'), 15)
                self.assertEqual(await page.get_by_role('button', name=LABELS[0], exact=True).get_attribute('aria-pressed'), 'true')
                self.assertEqual(await page.get_by_role('button', name=LABELS[4], exact=True).get_attribute('aria-pressed'), 'true')
                self.assertEqual(await page.get_by_role('textbox').input_value(), '')
                self.assertFalse(await page.get_by_role('dialog').is_visible())
            finally:
                await browser.close()

    async def test_current_header_periods_and_undo_use_real_touch(self):
        artifact = Path(os.environ['DASH_HEADER_QA_HTML']).resolve(strict=True)
        async with async_playwright() as driver:
            browser = await launch_browser(driver)
            try:
                _, options = verifier.browser_settings('iphone', driver.devices)
                page = await browser.new_page(**options)
                await open_current_header(page, artifact.as_uri())
                await page.locator('.qa-palettes').get_by_role('button', name='Реестр', exact=True).tap()
                proof = {}
                await verifier.verify_header_periods(page, 'iphone', proof)
                self.assertEqual(proof['header_periods_and_undo'], 'PASS')
            finally:
                await browser.close()

    async def test_current_header_controls_restore_selection_on_desktop_and_touch(self):
        artifact = Path(os.environ['DASH_HEADER_QA_HTML']).resolve(strict=True)
        async with async_playwright() as driver:
            browser = await launch_browser(driver)
            try:
                with header_fixture(artifact) as url:
                    for profile in ('desktop', 'iphone'):
                        with self.subTest(profile=profile):
                            _, options = verifier.browser_settings(profile, driver.devices)
                            page = await browser.new_page(**options)
                            try:
                                await open_current_header(page, url)
                                await verifier.activate(page.locator('.qa-palettes').get_by_role('button', name='Реестр', exact=True), profile)
                                proof = {}
                                await verifier.verify_header_controls(page, profile, proof)
                                self.assertEqual(proof['header_controls'], 'PASS')
                            finally:
                                await page.close()
            finally:
                await browser.close()

    async def test_real_touch_controls_restore_initial_selection(self):
        await self.scenario()

    async def test_unrelated_calendar_selection_change_cannot_pass_acceptance(self):
        with self.assertRaises(AssertionError):
            await self.scenario(corrupt_period=True)

    async def test_same_selection_with_different_week_cannot_pass_acceptance(self):
        with self.assertRaises(AssertionError):
            await self.scenario(corrupt_context=True)

    async def test_inert_unit_control_cannot_pass_acceptance(self):
        with self.assertRaises(AssertionError):
            await self.scenario(inert=True)


if __name__ == '__main__':
    unittest.main()
