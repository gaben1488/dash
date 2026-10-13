"""Actual offline Header guards. Requires the existing Playwright Chromium runtime."""
import argparse
import asyncio
import json
import tempfile
import zipfile
from pathlib import Path
from playwright.async_api import async_playwright

async def verify(path, output, glow_only=False):
    async with async_playwright() as driver:
        browser = await driver.chromium.launch(headless=True)
        proof = []
        cases = [(1280, 900, 1), (320, 740, 1), (1280, 900, 2)] if not glow_only else [(1280, 900, 1)]
        for width, height, zoom in cases:
            page = await browser.new_page(viewport={"width": width, "height": height}, reduced_motion="reduce")
            errors, network = [], []
            page.on("pageerror", lambda error: errors.append(str(error)))
            await page.route("http*://**", lambda route: (network.append(route.request.url), route.abort())[1])
            await page.goto(path.as_uri())
            await page.get_by_role("navigation").wait_for()
            await page.wait_for_timeout(1700)
            await page.evaluate("z => document.body.style.zoom=z", zoom)
            if glow_only:
                shadows = []
                for name in ["Пульс", "Экономия"]:
                    await page.get_by_role("button", name=name, exact=True).last.click()
                    await page.wait_for_timeout(300)
                    shadows.append(await page.locator('[aria-label="Все способы закупки"]').evaluate("e => getComputedStyle(e).boxShadow"))
                assert shadows[0] != shadows[1], "selected mode glow remains static blue across page palettes"
                proof.append({"contextualGlow": True})
                await page.close()
                continue
            names = await page.locator('.qa-palettes button').all_text_contents()
            assert len(names) == 13
            for theme in ["dark", "light"]:
                if theme == "light":
                    await page.get_by_role("button", name="Включить светлую тему", exact=True).click()
                fills = []
                selected = []
                filters = []
                for name in names:
                    await page.locator('.qa-palettes button').filter(has_text=name).first.click()
                    await page.wait_for_timeout(80)
                    assert await page.locator('.np-btn-active .np-label').text_content() == name
                    filters.append(await page.locator('.header-glass').evaluate("e=>Array.from(e.querySelectorAll('button[aria-pressed=true],button[aria-selected=true],.p-period-active')).map(b=>{const s=getComputedStyle(b);return {label:b.getAttribute('aria-label')||b.textContent.trim(),background:s.backgroundImage,color:s.color,border:s.borderColor,shadow:s.boxShadow}})"))
                    selected.append(await page.locator('.np-btn-active .np-content').evaluate("e=>{const s=getComputedStyle(e);return {background:s.backgroundImage,color:s.color,border:s.borderColor,shadow:s.boxShadow}}"))
                    fills.append(await page.locator('.np-btn-active .np-content').evaluate("e=>getComputedStyle(e).backgroundImage"))
                assert len(set(fills)) >= 12  # Свод and Реестр share the existing cyan family.
                await page.locator('.qa-palettes button').filter(has_text='Пульс').click()
                await page.locator('.np-btn-active').focus()
                await page.keyboard.press('ArrowDown')
                assert await page.locator('.np-btn-active .np-label').text_content() == 'Пульс'
                await page.keyboard.press('Enter')
                assert await page.locator('.np-btn-active .np-label').text_content() != 'Пульс'
                await page.locator('.qa-palettes button').filter(has_text='Пульс').click()
                assert await page.locator('.uf-preview-row').count() == 2
                await page.locator('.qa-presets button').filter(has_text='Журнал').first.click()
                dialog = page.get_by_role('dialog')
                await dialog.wait_for()
                assert await page.locator('.uf-event:visible').count() == 2
                await page.get_by_role('tab', name='Изменения', exact=True).focus()
                await page.keyboard.press('ArrowRight')
                assert await page.get_by_role('tab', name='Комментарии', exact=True).get_attribute('aria-selected') == 'true'
                for tab in ['Комментарии', 'Источники', 'Изменения']:
                    await page.get_by_role('tab', name=tab, exact=True).click()
                    await page.wait_for_timeout(80)
                    assert await page.get_by_role('tab', name=tab, exact=True).get_attribute('aria-selected') == 'true'
                rect = await dialog.bounding_box()
                assert rect and rect['x'] >= 0 and rect['x'] + rect['width'] <= width + 1
                await page.keyboard.press('Escape')
                assert await dialog.count() == 0
                assert not await page.evaluate('document.documentElement.scrollWidth > document.documentElement.clientWidth')
                await page.screenshot(path=str(output.parent / f'navigation-qa-{width}-{zoom}-{theme}.png'))
                proof.append({'width': width, 'zoom': zoom, 'theme': theme, 'routes': 13, 'actualGradientFamilies': len(set(fills)), 'journal': True, 'popupInViewport': True, 'selectedComputed': selected, 'filterComputed': filters})
            for preset in ['API недоступен', 'Журнал пуст', 'Неполный паспорт', 'Обсуждения', 'Закрыто в Google']:
                await page.locator('.qa-presets button').filter(has_text=preset).first.click()
                await page.get_by_role('dialog').wait_for()
                await page.wait_for_timeout(250)
                if preset == 'API недоступен':
                    assert await page.get_by_text('Журнал изменений не прочитан — сервер не ответил. Это не «правок не было».', exact=True).is_visible()
                elif preset == 'Журнал пуст':
                    assert await page.locator('.uf-event:visible').count() == 0
                elif preset == 'Неполный паспорт':
                    assert await page.get_by_role('tab', name='Источники').get_attribute('aria-selected') == 'true'
                else:
                    assert await page.get_by_text('Учебная заметка. Автор не устанавливается по тексту.', exact=True).is_visible()
                    assert await page.get_by_text('Есть ответы · 1', exact=True).is_visible()
                    state = 'Закрыто' if preset == 'Закрыто в Google' else 'Открыто'
                    assert await page.get_by_text(f'{state} в сохранённом чтении Google', exact=True).is_visible()
                await page.keyboard.press('Escape')
            proof.append({'width': width, 'zoom': zoom, 'negativeApiAndEmptyJournal': True, 'commentsAndSourcePanels': True})
            assert not network, network
            assert not errors, errors
            if width == 1280 and zoom == 1:
                for kind in ['HTML', 'ZIP']:
                    async with page.expect_download() as event:
                        await page.get_by_role('button', name=f'Скачать {kind}', exact=True).click()
                    download = await event.value
                    with tempfile.TemporaryDirectory() as folder:
                        saved = Path(folder) / download.suggested_filename
                        await download.save_as(saved)
                        if kind == 'ZIP':
                            with zipfile.ZipFile(saved) as archive:
                                assert archive.testzip() is None
                                archive.extract('navigation-qa.html', folder)
                            saved = Path(folder) / 'navigation-qa.html'
                        reloaded = await browser.new_page(viewport={'width':1280, 'height':900})
                        reopen_errors = []
                        reloaded.on('pageerror', lambda error: reopen_errors.append(str(error)))
                        await reloaded.route('http*://**', lambda route: route.abort())
                        await reloaded.goto(saved.as_uri())
                        await reloaded.get_by_role('navigation').wait_for()
                        await reloaded.locator('.qa-palettes button').filter(has_text='Экономия').click()
                        assert await reloaded.locator('.np-btn-active .np-label').text_content() == 'Экономия'
                        assert not reopen_errors, reopen_errors
                        await reloaded.close()
                    proof.append({'selfDownload': kind, 'reopenedOffline': True})
            await page.close()
        await browser.close()
        output.write_text(json.dumps(proof, ensure_ascii=False, indent=2))
        print(json.dumps(proof, ensure_ascii=False))

async def verify_motion(path, output):
    """Normal motion is a separate admission from reduced-motion and live data."""
    async with async_playwright() as driver:
        browser = await driver.chromium.launch(headless=True)
        proof = {'artifact': str(path), 'states': [], 'productionVerified': False,
                 'gaps': ['OPEN/RESOLVED/OPEN fixture readings do not prove a native REOPEN event or real Google mutation.']}
        for motion in ['no-preference', 'reduce']:
            page = await browser.new_page(viewport={'width':1280,'height':900}, reduced_motion=motion)
            errors, network = [], []
            page.on('pageerror', lambda error: errors.append(str(error)))
            await page.route('http*://**', lambda route: (network.append(route.request.url), route.abort())[1])
            await page.goto(path.as_uri())
            await page.get_by_role('navigation').wait_for()
            await page.wait_for_timeout(1700)
            proof['sourceSha'] = await page.locator('meta[name=dash-source-sha]').get_attribute('content')
            proof['sourceDigest'] = await page.locator('meta[name=dash-source-digest]').get_attribute('content')
            names = await page.locator('.qa-palettes button').all_text_contents()
            assert len(names) == 13
            for theme in ['dark','light']:
                if theme == 'light':
                    await page.get_by_role('button', name='Включить светлую тему', exact=True).click()
                for name in names:
                    await page.locator('.qa-palettes button').filter(has_text=name).first.click()
                    await page.wait_for_timeout(180)
                    state = await page.locator('.header-glass').evaluate("""e=>{
                      const read=b=>{if(!b)return null;const s=getComputedStyle(b),p=getComputedStyle(b,'::before'),r=b.getBoundingClientRect();return {fill:s.backgroundImage,border:s.borderColor,glow:s.boxShadow,clip:s.overflow,isolation:s.isolation,animation:p.animationName,duration:p.animationDuration,transform:p.transform,rect:{x:r.x,y:r.y,w:r.width,h:r.height}}};
                      return {active:read(e.querySelector('.np-btn-active .np-content')),week:read(e.querySelector('.wr-row-driving:not(.wr-row-future):not(.wr-row-empty)')),surface:read(e.querySelector('.hdr-liquid-surface')),method:read(e.querySelector('.vf-btn-active')),filter:read(e.querySelector('.filter-instrument')),themeControl:read(e.querySelector('.hf-icon-btn'))};
                    }""")
                    assert 'gradient' in state['active']['fill']
                    assert state['active']['clip']=='hidden' and state['active']['isolation']=='isolate'
                    assert state['active']['animation']==('none' if motion=='reduce' else 'hdr-button-dawn')
                    if state['week']:
                        assert state['week']['clip']=='hidden' and state['week']['isolation']=='isolate'
                        assert state['week']['animation']==('none' if motion=='reduce' else 'hdr-week-reflection')
                    proof['states'].append({'motion':motion,'theme':theme,'page':name,**state})
                await page.locator('.qa-palettes button').filter(has_text='Пульс').click()
                await page.wait_for_timeout(350)  # allow the intentional drum group transition to settle
                active=page.locator('.np-btn-active .np-content')
                before=await active.bounding_box()
                first=await active.evaluate("e=>getComputedStyle(e,'::before').transform")
                await page.wait_for_timeout(650)
                second=await active.evaluate("e=>getComputedStyle(e,'::before').transform")
                after=await active.bounding_box()
                assert before==after, 'animation changes active button geometry'
                assert (first!=second) if motion=='no-preference' else (first==second=='none')
                assert await page.locator('.uf-preview-row').count()==2
                assert await page.get_by_role('button',name='Показывать суммы в миллионах рублей',exact=True).is_visible()
                positions=await page.locator('.hdr-selection-tools').evaluate("e=>{const t=e.querySelector('.hf-icon-btn').getBoundingClientRect(),f=e.querySelector('.filter-instrument').getBoundingClientRect(),m=document.querySelector('.hbar-secondary').getBoundingClientRect();return {themeX:t.x,filterX:f.x,y:t.y,filterY:f.y,bottomRowY:m.y}}")
                assert positions['themeX']<positions['filterX'] and positions['y']>=positions['bottomRowY']
                await page.locator('.qa-presets button').filter(has_text='Обсуждения').first.click()
                await page.get_by_role('dialog').wait_for()
                await page.get_by_text('Открыто в сохранённом чтении Google',exact=True).wait_for()
                assert await page.get_by_text('Открыто в сохранённом чтении Google',exact=True).is_visible()
                await page.get_by_text('Исходные сообщения и ответы · 1',exact=True).click()
                assert await page.get_by_text('Учебный ответ',exact=True).is_visible()
                await page.get_by_text('Ревизия источника не доказана. Решение Dash и состояние обсуждения Google независимы.',exact=True).first.wait_for()
                await page.keyboard.press('Escape')
                await page.locator('.qa-presets button').filter(has_text='Закрыто в Google').first.click()
                await page.get_by_text('Закрыто в сохранённом чтении Google',exact=True).wait_for()
                assert await page.get_by_text('Открыто в сохранённом чтении Google',exact=True).count()==0
                await page.get_by_text('Исходные сообщения и ответы · 1',exact=True).click()
                assert await page.get_by_text('Учебный ответ',exact=True).is_visible()
                assert await page.get_by_text('Закрыто в сохранённом чтении Google',exact=True).is_visible()
                await page.keyboard.press('Escape')
                await page.locator('.qa-presets button').filter(has_text='Обсуждения').first.click()
                await page.get_by_text('Открыто в сохранённом чтении Google',exact=True).wait_for()
                assert await page.get_by_text('Закрыто в сохранённом чтении Google',exact=True).count()==0
                await page.get_by_role('tab',name='Источники',exact=True).click()
                await page.get_by_role('tab',name='Изменения',exact=True).click()
                await page.keyboard.press('Escape')
                assert await page.get_by_role('dialog').count()==0
                assert await active.bounding_box()==after
            assert not errors and not network, (errors,network)
            await page.close()
        assert len(proof['states'])==52
        for motion in ['no-preference','reduce']:
            for theme in ['dark','light']:
                states=[r for r in proof['states'] if r['motion']==motion and r['theme']==theme]
                assert len(states)==13 and len({r['active']['fill'] for r in states})>=12
        proof.update({'zeroExternalRequests':True,'zeroPageErrors':True,'normalAndReducedMotionDistinct':True,'geometryStable':True,'journalAndCommentsReply':True,'googleStatusOpenClosedOpenIndependentOfReply':True,'googleStatusIndependentOfDashDecision':True,'bottomFilterAndMillions':True})
        output.write_text(json.dumps(proof,ensure_ascii=False,indent=2))
        print(json.dumps({k:v for k,v in proof.items() if k!='states'},ensure_ascii=False))
        await browser.close()

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--html', type=Path, default=Path(__file__).resolve().parents[1] / 'navigation-qa.html')
    parser.add_argument('--proof', type=Path, default=Path('/tmp/dash-navigation-qa-browser-proof.json'))
    parser.add_argument('--glow-only', action='store_true')
    parser.add_argument('--motion-only', action='store_true')
    args = parser.parse_args()
    asyncio.run(verify_motion(args.html.resolve(), args.proof) if args.motion_only else verify(args.html.resolve(), args.proof, args.glow_only))
