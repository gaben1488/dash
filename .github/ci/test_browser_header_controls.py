"""Browser acceptance must detect inert controls using real pointer/touch input."""
import os
import unittest
from unittest.mock import patch

import live_browser_readback as verifier
from playwright.async_api import async_playwright

LABELS = ['Показывать суммы в тысячах рублей', 'Показывать суммы в миллионах рублей',
          'Конкурентные способы, статья 24 44-ФЗ', 'Единственный поставщик, статья 93 44-ФЗ',
          'Все способы закупки', 'Программные мероприятия', 'Текущая деятельность',
          'Федеральный бюджет', 'Краевой бюджет', 'Муниципальный бюджет']


class FailureEvidenceTests(unittest.TestCase):
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
            browser = await getattr(driver, os.environ.get('BROWSER_ENGINE', 'chromium')).launch()
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
