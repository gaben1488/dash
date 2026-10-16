"""Read-only real-domain browser acceptance; never prints page data or credentials."""
import asyncio
import hashlib
import io
import json
import os
import re
import tempfile
import zipfile
from pathlib import Path
from urllib.parse import urlsplit

from playwright.async_api import async_playwright

BASE = 'https://dash-elizovo-uer.ru'
PAGES = ['Пульс', 'Отчёт', 'Свод', 'Реестр', 'Не обеспеченные', 'В течение года',
         'Мониторинг', 'Экономия', 'Конкуренция', 'Дисциплина', 'Контроль', 'Аналитика', 'Система']


def browser_settings(profile, devices):
    if profile == 'desktop':
        return 'chromium', {'viewport': {'width': 1600, 'height': 1000}}
    if profile == 'iphone':
        return 'webkit', {key: value for key, value in devices['iPhone 13'].items()
                          if key != 'default_browser_type'}
    raise ValueError('BROWSER_PROFILE_INVALID')


def readonly_request(url, method):
    parsed, base = urlsplit(url), urlsplit(BASE)
    return ((parsed.scheme, parsed.netloc) == (base.scheme, base.netloc)
            and method in {'GET', 'HEAD', 'OPTIONS'})


def browser_credentials(profile, username, password):
    if profile not in {'desktop', 'iphone'}:
        raise ValueError('BROWSER_PROFILE_INVALID')
    credentials = {'username': username, 'password': password}
    if profile == 'desktop':
        credentials['origin'] = BASE
    # Playwright 1.62 WebKit compares absent default URL port as 0 to TLS port 443
    # (bootstrap.diff: shouldSendAutomationCredentialsForProtectionSpace).
    # The mandatory route below enforces exact HTTPS origin before any page exists.
    return credentials


def record_response(response, proof):
    parsed = urlsplit(response.url)
    if parsed.netloc != urlsplit(BASE).netloc:
        return
    names = {'/api/dashboard': 'dashboard_http_statuses', '/api/change-story': 'journal_http_statuses',
             '/api/report-releases': 'release_status_http_statuses'}
    name = names.get(parsed.path)
    if parsed.path.startswith('/api/report-releases/') and parsed.path.endswith('.docx'):
        name = 'word_http_statuses'
    if name:
        statuses = proof.setdefault(name, [])
        if len(statuses) < 8:
            statuses.append(response.status)


async def select_page(page, nav, label, proof=None):
    def phase(value):
        if proof is not None:
            proof['navigation_phase'] = value
    phase('locate_button')
    button = nav.locator('.np-btn').filter(has=page.locator('.np-label', has_text=re.compile('^' + re.escape(label) + '$')))
    # Native keyboard navigation, never forced clicks through an overlay.
    group = int(await button.evaluate("e => e.closest('[data-nav-group]').dataset.navGroup"))
    phase('focus_navigation')
    await nav.focus()
    phase('home_group')
    await nav.press('Home')
    for _ in range(group):
        phase('move_group')
        await nav.press('ArrowDown')
    if proof is not None:
        proof['navigation_hit'] = await button.evaluate('''e => {
            const r=e.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);
            return {positive_size:r.width>0&&r.height>0,inside_viewport:r.left>=0&&r.right<=innerWidth,
                receives_pointer:hit!==null&&(hit===e||e.contains(hit)),
                covered_by_dialog:!!hit?.closest('[role="dialog"]')};
        }''')
    phase('click_button')
    await button.click(timeout=5000)
    phase('confirm_selection')
    assert await button.get_attribute('aria-current') == 'page'


async def run():
    proof = {'kind': 'actual_domain_browser', 'source_sha': os.environ['EXPECTED_SOURCE_SHA'],
             'stage': 'credentials', 'result': 'FAILED'}
    target = Path(os.environ['BROWSER_PRIVATE_PROOF'])
    try:
        password = os.environ.get('DASH_BROWSER_BASIC_PASSWORD', '')
        if not password:
            raise ValueError('OWNER_BROWSER_PASSWORD_SECRET_REQUIRED')
        metadata = json.loads(Path(os.environ['BROWSER_AUTH_METADATA']).read_text())
        assert metadata['release_sha'] == proof['source_sha']
        async with async_playwright() as driver:
            profile = os.environ.get('BROWSER_PROFILE', 'desktop')
            engine, options = browser_settings(profile, driver.devices)
            proof['browser_profile'] = profile
            proof['stage'] = 'unauthenticated_edge'
            unauthenticated = await driver.request.new_context()
            response = await unauthenticated.get(BASE + '/api/report-releases', max_redirects=0)
            assert response.status == 401
            await unauthenticated.dispose()
            browser = await getattr(driver, engine).launch(headless=True)
            context = await browser.new_context(**options,
                accept_downloads=True, http_credentials=browser_credentials(profile, metadata['username'], password))
            blocked = []

            async def readonly(route):
                request = route.request
                if not readonly_request(request.url, request.method):
                    blocked.append(True)
                    await route.abort()
                else:
                    await route.continue_()

            await context.route('http*://**', readonly)
            proof['stage'] = 'authenticated_edge'
            basic_response = await context.request.get(BASE, max_redirects=0, timeout=30000)
            proof['basic_http_status'] = basic_response.status
            page = await context.new_page()
            errors = []
            word_requests = []
            page.on('pageerror', lambda _: errors.append(True))
            page.on('response', lambda response: record_response(response, proof))
            def word_request(request):
                match = re.fullmatch(re.escape(BASE) + r'/api/report-releases/(REL-[a-f0-9]{64})/(main|supplement|operational)\.docx', request.url)
                if match:
                    word_requests.append(match.groups())
                    proof['word_requests'] = len(word_requests)
            page.on('request', word_request)
            proof['stage'] = 'document_navigation'
            async with page.expect_response(lambda r: urlsplit(r.url).path == '/api/dashboard' and r.status == 200, timeout=40000) as dashboard:
                response = await page.goto(BASE, wait_until='domcontentloaded', timeout=30000)
                proof['document_http_status'] = response.status
                if response.status == 401:
                    challenge = response.headers.get('www-authenticate', '')
                    proof['browser_auth_diagnostic'] = {
                        'basic_challenge': challenge.lower().startswith('basic '),
                        'challenge_utf8': 'charset="utf-8"' in challenge.lower(),
                        'same_origin': readonly_request(response.url, 'GET'),
                    }
                    for name, origin in [('explicit_port', BASE + ':443'), ('guarded_origin', None)]:
                        credentials = {'username': metadata['username'], 'password': password}
                        if origin is not None:
                            credentials['origin'] = origin
                        diagnostic = await browser.new_context(**options, http_credentials=credentials)
                        # The same guard prevents any credential-bearing off-origin request.
                        await diagnostic.route('http*://**', readonly)
                        probe = await diagnostic.new_page()
                        try:
                            observed = await probe.goto(BASE, wait_until='commit', timeout=15000)
                            proof['browser_auth_diagnostic'][name] = observed.status
                        except Exception:  # noqa: BLE001 - diagnostic emits no page data or credentials.
                            proof['browser_auth_diagnostic'][name] = 'FAILED'
                        finally:
                            await diagnostic.close()
                assert response.status == 200
                proof['stage'] = 'dashboard_response'
            await (await dashboard.value).finished()
            proof['stage'] = 'initial_render'
            nav = page.get_by_role('navigation', name='Навигация', exact=True)
            await nav.wait_for(timeout=30000)
            visited = []

            scenario = os.environ.get('BROWSER_SCENARIO', 'full')
            if scenario not in {'full', 'word-readiness'}:
                raise ValueError('BROWSER_SCENARIO_INVALID')
            proof['scenario'] = scenario
            for label in (PAGES if scenario == 'full' else ['Отчёт']):
                proof['stage'] = 'page_' + str(len(visited) + 1)
                proof['page_phase'] = 'select'
                await select_page(page, nav, label, proof)
                proof['page_phase'] = 'read_page_context'
                page_id = await page.locator('header[data-page-skin]').get_attribute('data-page-skin')
                main = page.locator('main[data-page="' + page_id + '"]')
                proof['page_phase'] = 'wait_main'
                await main.wait_for()
                proof['page_phase'] = 'wait_content'
                await main.get_by_text('Раздел загружается', exact=True).wait_for(state='hidden', timeout=30000)
                proof['page_phase'] = 'assert_content'
                assert await main.get_by_text('Этот раздел не открылся — числа в нём показать не удалось', exact=True).count() == 0
                assert await page.get_by_text('Приложение не отрисовалось — числа на экране показать не удалось', exact=True).count() == 0
                assert len((await main.inner_text()).strip()) > 10
                assert not errors
                visited.append(label)
                proof['pages_visited'] = len(visited)
            proof['pages_visited'] = len(visited)
            proof['stage'] = 'report_navigation'
            await select_page(page, nav, 'Отчёт', proof)
            await page.get_by_role('button', name='Отчёт в Word', exact=True).wait_for(timeout=30000)
            downloads = []
            release_ids = set()
            for label, view in [('Отчёт в Word', 'main'), ('Доп. отчёт в Word', 'supplement'), ('Оперативный в Word', 'operational')]:
                proof['stage'] = 'word_' + str(len(downloads) + 1)
                proof['word_phase'] = 'wait_enabled'
                button = page.get_by_role('button', name=label, exact=True)
                try:
                    await page.wait_for_function('label => [...document.querySelectorAll("button")].some(b => b.textContent.trim() === label && !b.disabled)', arg=label, timeout=30000)
                except Exception:
                    # Fixed product states only: never copy report text or source payload.
                    proof['word_disabled'] = await button.is_disabled()
                    proof['word_exact_text'] = await button.evaluate('(b,label)=>b.textContent.trim()===label', label)
                    proof['word_readiness'] = await page.locator('#report-word-status').evaluate('''e=>{
                        const s=e.textContent;
                        for(const [prefix,code] of [
                            ['Word:','READY'],['Проверяем готовность','CHECKING'],
                            ['Несовместимый формат','SCHEMA'],['Вход на сайте','AUTH'],
                            ['Проверка готовности Word превысила','TIMEOUT'],['Сервис отчётов','SERVICE'],
                            ['Для выбранной даты','NO_RELEASE'],['Word станет доступен','NO_CONTEXT']])
                            if(s.startsWith(prefix))return code;
                        return 'OTHER';
                    }''')
                    raise
                before = len(word_requests)
                async with page.expect_download(timeout=30000) as event:
                    proof['word_phase'] = 'click'
                    await button.click()
                    proof['word_phase'] = 'wait_download'
                download = await event.value
                proof['word_phase'] = 'save_download'
                with tempfile.TemporaryDirectory() as temporary:
                    saved = Path(temporary) / 'document.docx'
                    await download.save_as(saved)
                    content = saved.read_bytes()
                    with zipfile.ZipFile(io.BytesIO(content)) as archive:
                        assert archive.testzip() is None and 'word/document.xml' in archive.namelist()
                    observed = word_requests[before:]
                    assert observed and all(kind == view for _, kind in observed)
                    release_ids.update(rid for rid, _ in observed)
                    assert len(release_ids) == 1
                    expected = metadata['word_hashes_by_release'][next(iter(release_ids))]
                    assert len(set(expected.values())) == 3
                    digest = hashlib.sha256(content).hexdigest()
                    assert digest == expected[view]
                    downloads.append({'view': view, 'bytes': len(content), 'sha256': digest})
            proof['stage'] = 'journal'
            await page.get_by_role('button', name=re.compile(r'^Журнал обновлений\.')).click()
            dialog = page.get_by_role('dialog', name='Провенанс: откуда числа и что изменилось', exact=True)
            await dialog.wait_for()
            for label in ['Изменения', 'Комментарии', 'Источники']:
                tab = dialog.get_by_role('tab', name=label, exact=True)
                await tab.click()
                assert await tab.get_attribute('aria-selected') == 'true'
            await page.keyboard.press('Escape')
            await dialog.wait_for(state='hidden')
            proof.update(result='PASS', stage='complete', basic_edge='PASS',
                         three_word_downloads=downloads, journal_tabs='PASS', page_errors=len(errors), blocked_requests=len(blocked))
            assert not errors and not blocked
            await browser.close()
    except Exception as error:  # noqa: BLE001 — never expose page text or credentials in public logs.
        proof['result'] = 'FAILED'
        proof['failure_class'] = type(error).__name__
        if isinstance(error, ValueError) and str(error) == 'OWNER_BROWSER_PASSWORD_SECRET_REQUIRED':
            proof['error_code'] = str(error)
    finally:
        target.write_text(json.dumps(proof))
        target.chmod(0o600)
    print(json.dumps(proof))
    return 0 if proof['result'] == 'PASS' else 2


if __name__ == '__main__':
    raise SystemExit(asyncio.run(run()))
