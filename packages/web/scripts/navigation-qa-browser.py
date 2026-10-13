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
            for preset in ['API недоступен', 'Журнал пуст', 'Неполный паспорт', 'Обсуждения']:
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

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--html', type=Path, default=Path(__file__).resolve().parents[1] / 'navigation-qa.html')
    parser.add_argument('--proof', type=Path, default=Path('/tmp/dash-navigation-qa-browser-proof.json'))
    parser.add_argument('--glow-only', action='store_true')
    args = parser.parse_args()
    asyncio.run(verify(args.html.resolve(), args.proof, args.glow_only))
