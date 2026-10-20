"""Actual Vite app shell, synthetic API failures and oversized section content.

Run with a local web dev server:
  DASH_LAYOUT_URL=http://127.0.0.1:5178 python .github/ci/test_browser_shell_layout.py
No production or Google requests are made.
"""
import asyncio
import os
from urllib.parse import urlparse

from playwright.async_api import async_playwright


async def main():
    url = os.environ.get('DASH_LAYOUT_URL', 'http://127.0.0.1:5178')
    if urlparse(url).hostname not in {'localhost', '127.0.0.1'}:
        raise ValueError('Only a local test server is allowed')
    async with async_playwright() as driver:
        browser = await driver.chromium.launch()
        page = await browser.new_page()
        await page.route('**/api/**', lambda route: route.fulfill(
            status=503, content_type='application/json', body='{"error":"synthetic unavailable"}'))
        await page.goto(url, wait_until='domcontentloaded')
        await page.wait_for_selector('#main-content')
        cases = 0
        for width, height in [(1146, 667), (1031, 600), (1440, 900), (390, 844), (844, 390)]:
            await page.set_viewport_size({'width': width, 'height': height})
            for section in ['dashboard', 'report', 'svod', 'data', 'unfunded', 'yearlong',
                            'monitoring', 'economy', 'competition', 'discipline', 'analytics', 'quality', 'settings']:
                await page.evaluate("""async section => {
                    const {useStore} = await import('/src/store.ts');
                    useStore.getState().setPage(section);
                }""", section)
                await page.wait_for_selector(f'main[data-page="{section}"]')
                result = await page.evaluate("""async () => {
                    const main = document.querySelector('main');
                    const stress = document.createElement('div');
                    stress.style.cssText = 'height:2400px;overflow:auto;max-width:100%';
                    stress.innerHTML = '<div style="width:2400px;height:80px">Wide table</div>';
                    main.append(stress);
                    main.scrollTop = main.scrollHeight;
                    window.scrollTo(10000,10000);
                    await new Promise(requestAnimationFrame);
                    const rect = main.getBoundingClientRect();
                    const result = {x:window.scrollX,y:window.scrollY,
                        right:rect.right,bottom:rect.bottom,left:rect.left,top:rect.top,
                        width:innerWidth,height:innerHeight,scrolled:main.scrollTop,
                        boundaries:[document.documentElement,document.body,document.querySelector('#root'),document.querySelector('.app-shell')].map(e=>e && ({tag:e.tagName,overflow:getComputedStyle(e).overflow,height:e.clientHeight,scrollHeight:e.scrollHeight})),
                        outside:[...document.querySelectorAll('body *')].filter(e=>!main.contains(e)&&e.getBoundingClientRect().bottom>innerHeight+1).slice(0,12).map(e=>({tag:e.tagName,cls:String(e.className),bottom:e.getBoundingClientRect().bottom})),
                        tableOverflow:stress.scrollWidth > stress.clientWidth};
                    stress.remove(); main.scrollTop = 0;
                    return result;
                }""")
                assert result['x'] == result['y'] == 0, (section, result)
                assert 0 <= result['left'] < result['right'] <= result['width'] + 1, (section, result)
                assert 0 <= result['top'] < result['bottom'] <= result['height'] + 1, (section, result)
                assert result['scrolled'] > 0 and result['tableOverflow'], (section, result)
                cases += 1
        await browser.close()
        print(f'{cases} shell layout cases passed')


if __name__ == '__main__':
    asyncio.run(main())
