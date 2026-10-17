"""Browser acceptance must detect inert controls using real pointer/touch input."""
import asyncio
import os
import re
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
from playwright.async_api import TimeoutError as PlaywrightTimeoutError
from playwright.async_api import async_playwright, expect

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


async def wait_for_drum_settle(nav):
    # Wait only for the real row movement, not unrelated decorative animations.
    # A broken animation must fail this gate instead of occupying the runner.
    await nav.page.wait_for_function('''el=>[...el.querySelectorAll('.np-group')]
        .every(row=>row.getAnimations().every(a=>!a.pending&&a.playState!=='running'))''',
        arg=await nav.element_handle(), timeout=5000)


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


class DrumReadinessTests(unittest.IsolatedAsyncioTestCase):
    async def test_nonterminating_row_motion_is_rejected_with_the_existing_five_second_budget(self):
        async with async_playwright() as driver:
            browser = await launch_browser(driver)
            try:
                page = await browser.new_page()
                await page.set_content('<nav aria-label="Навигация"><div class="np-group">group</div></nav>')
                await page.locator('.np-group').evaluate("el=>el.animate([{translate:'0 0'},{translate:'0 20px'}],{duration:1000,iterations:Infinity})")
                with self.assertRaises(PlaywrightTimeoutError):
                    await wait_for_drum_settle(page.get_by_role('navigation'))
            finally:
                await browser.close()


class HeaderControlsTests(unittest.IsolatedAsyncioTestCase):
    async def test_navigation_wraps_real_wheel_keyboard_and_touch_without_duplicate_routes(self):
        artifact = Path(os.environ['DASH_HEADER_QA_HTML']).resolve(strict=True)
        async with async_playwright() as driver:
            browser = await launch_browser(driver)
            try:
                for profile in ('desktop', 'iphone'):
                    _, options = verifier.browser_settings(profile, driver.devices)
                    page = await browser.new_page(**options)
                    await open_current_header(page, artifact.as_uri())
                    await page.locator('.qa-palettes').get_by_role('button', name='Пульс', exact=True).click()
                    nav = page.get_by_role('navigation', name='Навигация', exact=True)
                    current = nav.locator('.np-btn[aria-current="page"]')
                    await expect(current).to_have_text('Пульс')

                    async def check(name, nav=nav):
                        await expect(nav.locator('.np-group-center')).to_have_attribute('aria-label', name)
                        await wait_for_drum_settle(nav)
                        # One renderer read preserves the same geometry assertions;
                        # serial WebKit IPC used to dominate every turn.
                        state = await nav.evaluate("""el=>{
                            const rect=e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};};
                            return {visible_count:el.querySelectorAll('.np-group-top,.np-group-center,.np-group-bottom').length,
                                routes:el.querySelectorAll('.np-btn').length,
                                current:el.querySelector('.np-btn[aria-current="page"] .np-label')?.textContent,
                                window:rect(el.querySelector('.np-drum-window')),
                                positions:['top','center','bottom'].map(kind=>{
                                    const row=el.querySelector('.np-group-'+kind);
                                    return row?{...rect(row),visible:getComputedStyle(row).visibility!=='hidden'}:null;
                                })};
                        }""")
                        self.assertEqual(state['visible_count'], 3)
                        self.assertEqual(state['routes'], 13)
                        self.assertEqual(state['current'], 'Пульс')
                        window, positions = state['window'], state['positions']
                        self.assertTrue(all(box is not None and box['visible'] and box['width'] > 0 and box['height'] > 0
                                            for box in positions))
                        self.assertLess(positions[0]['y'], positions[1]['y'])
                        self.assertLess(positions[1]['y'], positions[2]['y'])
                        for box in positions:
                            self.assertGreaterEqual(box['y'], window['y'] - 2)
                            self.assertLessEqual(box['y'] + box['height'], window['y'] + window['height'] + 2)

                    previous = nav.get_by_role('button', name='Предыдущая группа разделов', exact=True)
                    next_group = nav.get_by_role('button', name='Следующая группа разделов', exact=True)
                    await expect(previous).to_be_enabled()
                    for _ in range(2):
                        for name in ('Надзор', 'Разборы', 'Реестры', 'Обзор'):
                            if profile == 'iphone':
                                await previous.tap()
                            else:
                                await previous.click()
                            await check(name)
                        for name in ('Реестры', 'Разборы', 'Надзор', 'Обзор'):
                            if profile == 'iphone':
                                await next_group.tap()
                            else:
                                await next_group.click()
                            await check(name)
                    if profile == 'desktop':
                        await nav.focus()
                        for key, name in (('ArrowUp', 'Надзор'), ('PageDown', 'Обзор'),
                                          ('End', 'Надзор'), ('ArrowDown', 'Обзор'), ('Home', 'Обзор')):
                            await nav.press(key)
                            await check(name)
                        bounds = await nav.bounding_box()
                        await page.mouse.move(bounds['x'] + bounds['width']/2, bounds['y'] + bounds['height']/2)
                        await page.mouse.wheel(0, -80)
                        await check('Надзор')
                        await page.mouse.wheel(0, 80)
                        await check('Обзор')
                    await page.close()
            finally:
                await browser.close()

    async def test_page_foreground_reaches_week_labels_and_palette_samples(self):
        artifact = Path(os.environ['DASH_HEADER_QA_HTML']).resolve(strict=True)
        async with async_playwright() as driver:
            browser = await launch_browser(driver)
            try:
                page = await browser.new_page(viewport={'width': 1440, 'height': 1000})
                await open_current_header(page, artifact.as_uri())
                for theme in ('dark', 'light'):
                    if theme == 'light':
                        await page.get_by_role('button', name='Включить светлую тему', exact=True).click()
                    for button in await page.locator('.qa-palettes button').all():
                        await button.click()
                        ink = await button.evaluate("el=>el.style.getPropertyValue('--hdr-ink')")
                        self.assertRegex(ink, r'^#[a-f0-9]{6}$')
                        expected = 'rgb(' + ', '.join(str(int(ink[i:i+2], 16)) for i in (1, 3, 5)) + ')'
                        await expect(button).to_have_css('color', expected)
                        for label in await page.locator('.wr-row-driving:not(.wr-row-future):not(.wr-row-empty) :is(.wr-range,.wr-month,.wr-wnum)').all():
                            await expect(label).to_have_css('color', expected)
            finally:
                await browser.close()

    async def test_long_reset_summary_keeps_touch_actions_inside_narrow_viewport(self):
        artifact = Path(os.environ['DASH_HEADER_QA_HTML']).resolve(strict=True)
        async with async_playwright() as driver:
            browser = await launch_browser(driver)
            try:
                for length in (36, 256, 2048):
                    with self.subTest(search_length=length):
                        _, options = verifier.browser_settings('iphone', driver.devices)
                        options['viewport'] = {'width': 320, 'height': 568}
                        page = await browser.new_page(**options)
                        await open_current_header(page, artifact.as_uri())
                        await page.locator('.qa-palettes').get_by_role('button', name='Реестр', exact=True).tap()
                        header = page.locator('header[data-page-skin]')
                        await header.get_by_role('textbox', name='Поиск по реестру закупок', exact=True).fill('1' * length)
                        await header.get_by_role('button', name=re.compile(r'^Фильтры линейки: \d+\. Открыть настройки$')).tap()
                        dialog = page.get_by_role('dialog', name='Фильтры линейки', exact=True)
                        await dialog.get_by_role('button', name='Снять фильтры линейки', exact=True).tap()
                        for button in await page.locator('.fi-undo button').all():
                            bounds = await button.bounding_box()
                            self.assertIsNotNone(bounds)
                            self.assertGreaterEqual(bounds['x'], 0)
                            self.assertLessEqual(bounds['x']+bounds['width'], 320)
                            self.assertGreaterEqual(bounds['y'], 0)
                            self.assertLessEqual(bounds['y']+bounds['height'], 568)
                        await page.get_by_role('button', name='Закрыть отмену сброса фильтров', exact=True).tap()
                        await page.close()
            finally:
                await browser.close()

    async def test_reset_undo_survives_reading_delay_and_can_be_dismissed_by_touch(self):
        artifact = Path(os.environ['DASH_HEADER_QA_HTML']).resolve(strict=True)
        async with async_playwright() as driver:
            browser = await launch_browser(driver)
            try:
                _, options = verifier.browser_settings('iphone', driver.devices)
                page = await browser.new_page(**options)
                await open_current_header(page, artifact.as_uri())
                await page.locator('.qa-palettes').get_by_role('button', name='Реестр', exact=True).tap()
                header = page.locator('header[data-page-skin]')
                millions = header.get_by_role('button', name='Показывать суммы в миллионах рублей', exact=True)
                await millions.tap()
                await expect(millions).to_have_attribute('aria-pressed', 'true')
                corner = header.get_by_role('button', name=re.compile(r'^Фильтры линейки: \d+\. Открыть настройки$'))
                await corner.tap()
                dialog = page.get_by_role('dialog', name='Фильтры линейки', exact=True)
                await dialog.get_by_role('button', name='Снять фильтры линейки', exact=True).tap()
                # Real elapsed reading time exceeds the old six-second expiry.
                await asyncio.sleep(6.5)
                await page.get_by_role('button', name=re.compile('^Вернуть фильтры:')).tap(timeout=5000)
                await expect(millions).to_have_attribute('aria-pressed', 'true')
                if not await dialog.is_visible():
                    await corner.tap()
                await dialog.get_by_role('button', name='Снять фильтры линейки', exact=True).tap()
                await page.get_by_role('button', name='Закрыть отмену сброса фильтров', exact=True).tap()
                await expect(page.get_by_role('button', name=re.compile('^Вернуть фильтры:'))).to_have_count(0)
                await expect(millions).to_have_attribute('aria-pressed', 'false')
            finally:
                await browser.close()

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
