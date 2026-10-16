"""Browser acceptance must detect inert controls using real pointer/touch input."""
import os
import unittest
from pathlib import Path

import live_browser_readback as verifier
from playwright.async_api import async_playwright

LABELS = ['Показывать суммы в тысячах рублей', 'Показывать суммы в миллионах рублей',
          'Конкурентные способы, статья 24 44-ФЗ', 'Единственный поставщик, статья 93 44-ФЗ',
          'Все способы закупки', 'Программные мероприятия', 'Текущая деятельность',
          'Федеральный бюджет', 'Краевой бюджет', 'Муниципальный бюджет']


class HeaderControlsTests(unittest.IsolatedAsyncioTestCase):
    async def scenario(self, inert=False):
        async with async_playwright() as driver:
            browser = await getattr(driver, os.environ.get('BROWSER_ENGINE', 'chromium')).launch()
            try:
                _, options = verifier.browser_settings('iphone', driver.devices)
                page = await browser.new_page(**options)
                buttons = ''.join(f'<button aria-label="{label}" aria-pressed="{str(i in (0, 4)).lower()}">x</button>' for i, label in enumerate(LABELS))
                await page.set_content('''<meta name="viewport" content="width=device-width, initial-scale=1">
                    <style>button{min-height:44px;min-width:44px}</style><header data-page-skin="registry">'''
                    + buttons + '''<button id="theme" aria-label="Включить светлую тему">theme</button>
                    <input aria-label="Поиск по реестру закупок"><button id="clear" aria-label="Очистить строку поиска">clear</button>
                    <button id="corner" aria-label="Фильтры линейки: 0. Открыть настройки">filters</button></header>
                    <div role="dialog" aria-label="Фильтры линейки" hidden>filters</div>
                    <script>
                    window.touches=0;document.addEventListener('touchstart',()=>window.touches++);
                    const buttons=[...document.querySelectorAll('button[aria-pressed]')];
                    buttons.forEach((b,i)=>b.onclick=()=>{
                      if(window.inert&&i===1)return;
                      if(i<2){buttons[0].setAttribute('aria-pressed',i===0);buttons[1].setAttribute('aria-pressed',i===1);}
                      else if(i<5){buttons.slice(2,5).forEach((x,j)=>x.setAttribute('aria-pressed',j===i-2));}
                      else b.setAttribute('aria-pressed',b.getAttribute('aria-pressed')!=='true');
                    });
                    document.querySelector('#theme').onclick=e=>e.target.setAttribute('aria-label',e.target.getAttribute('aria-label').includes('светлую')?'Включить тёмную тему':'Включить светлую тему');
                    document.querySelector('#clear').onclick=()=>document.querySelector('input').value='';
                    document.querySelector('#corner').onclick=()=>{const d=document.querySelector('[role=dialog]');d.hidden=!d.hidden;};
                    </script>''')
                await page.evaluate('(value)=>window.inert=value', inert)
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
            browser = await getattr(driver, os.environ.get('BROWSER_ENGINE', 'chromium')).launch()
            try:
                _, options = verifier.browser_settings('iphone', driver.devices)
                page = await browser.new_page(**options)
                await page.goto(artifact.as_uri())
                await page.locator('.qa-palettes').get_by_role('button', name='Реестр', exact=True).tap()
                proof = {}
                await verifier.verify_header_periods(page, 'iphone', proof)
                self.assertEqual(proof['header_periods_and_undo'], 'PASS')
            finally:
                await browser.close()

    async def test_real_touch_controls_restore_initial_selection(self):
        await self.scenario()

    async def test_inert_unit_control_cannot_pass_acceptance(self):
        with self.assertRaises(AssertionError):
            await self.scenario(inert=True)


if __name__ == '__main__':
    unittest.main()
