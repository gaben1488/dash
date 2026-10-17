"""Read-only real-domain browser acceptance; never prints page data or credentials."""
import asyncio
import hashlib
import io
import json
import math
import os
import re
import tempfile
import time
import zipfile
from datetime import datetime
from pathlib import Path
from urllib.parse import urlsplit
from zoneinfo import ZoneInfo

from playwright.async_api import async_playwright, expect

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


def record_release_transport(request, phase, proof, *, started_at=None):
    """Fixed lifetime fields only; never copy URL values, headers or failure text."""
    parsed, base = urlsplit(request.url), urlsplit(BASE)
    if ((parsed.scheme, parsed.netloc) != (base.scheme, base.netloc)
            or parsed.path != '/api/report-releases'):
        return False
    if phase not in {'started', 'finished', 'failed', 'pending'}:
        raise ValueError('RELEASE_TRANSPORT_PHASE_INVALID')
    rows = proof.setdefault('release_transport', [])
    if len(rows) >= 16:
        proof['release_transport_omitted'] = proof.get('release_transport_omitted', 0) + 1
        return True
    row = {'phase': phase, 'selected_context': bool(parsed.query),
           'method': request.method if request.method in {'GET', 'POST'} else 'OTHER'}
    try:
        timing = request.timing
        elapsed = timing.get('responseEnd', -1)
        if type(elapsed) not in {int, float} or elapsed < 0:
            elapsed = ((time.monotonic() - started_at) * 1000 if started_at is not None
                       else time.time() * 1000 - timing['startTime'])
        if type(elapsed) in {int, float} and math.isfinite(elapsed) and 0 <= elapsed <= 600_000:
            row['elapsed_ms'] = round(elapsed, 1)
    except Exception:  # noqa: BLE001 - teardown can make native timing unavailable.
        row['timing_available'] = False
    rows.append(row)
    return True


async def probe_selected_transport(context, url):
    """One independent read after UI failure; the failed UI criterion stays failed."""
    if not readonly_request(url, 'GET') or urlsplit(url).path != '/api/report-releases':
        raise ValueError('SELECTED_TRANSPORT_ORIGIN_INVALID')
    started = time.monotonic()
    result = {}
    response = None
    try:
        response = await context.request.get(url, max_redirects=0, timeout=10000)
        result['status'] = response.status
        body = await response.body()
        result['bytes'] = len(body)
        if len(body) <= 32 * 1024 * 1024:
            result['sha256'] = hashlib.sha256(body).hexdigest()
        else:
            result['error_code'] = 'RESPONSE_TOO_LARGE'
    except Exception:  # noqa: BLE001 - no native transport error text in public proof.
        result['error_code'] = 'TRANSPORT_FAILED'
    finally:
        if response is not None:
            await response.dispose()
    result['elapsed_ms'] = round((time.monotonic() - started) * 1000, 1)
    return result


async def activate(locator, profile, *, timeout=5000):
    if profile == 'iphone':
        await locator.tap(timeout=timeout)
    else:
        await locator.click(timeout=timeout)


async def hit_geometry(locator):
    """Fixed geometry and cover kinds only; no DOM text, selectors or attributes."""
    return await locator.evaluate('''el=>{
        const r=el.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);
        const main=document.querySelector('main');
        return {receives_pointer:!!hit&&(hit===el||el.contains(hit)),
            cover:hit?.closest('[role="dialog"]')?'DIALOG':hit?.closest('header')?'HEADER'
                :hit?.closest('button')?'BUTTON':hit?.closest('main')?'MAIN':'OTHER',
            rect:{x:r.x,y:r.y,width:r.width,height:r.height},
            viewport:{width:innerWidth,height:innerHeight},
            main:main?{top:main.getBoundingClientRect().top,height:main.clientHeight,
                scroll_top:main.scrollTop}:null};
    }''')


def failure_location(error):
    """Publish only our fixed verifier frame, never exception text or locals."""
    location, frame = None, error.__traceback__
    while frame is not None:
        code = frame.tb_frame.f_code
        if (Path(code.co_filename).name == Path(__file__).name
                and code.co_name in {'run', 'select_page', 'verify_header_controls', 'verify_header_periods', 'verify_operations_status', 'verify_pulse_trust'}):
            location = {'function': code.co_name, 'line': frame.tb_lineno}
        frame = frame.tb_next
    return location


def actionability_flags(error):
    message = str(error)
    return {key: token in message for key, token in (
        ('unstable', 'element is not stable'), ('disabled', 'element is not enabled'),
        ('outside_viewport', 'outside of the viewport'), ('covered', 'intercepts pointer events'),
        ('detached', 'detached from the DOM'))}


async def verify_pulse_trust(page, profile, proof, observed):
    """Compare visible scores/weights with the initial real GET, never calculate them."""
    labels = {'data_quality': 'Качество данных', 'formula_integrity': 'Целостность формул',
              'rule_compliance': 'Соответствие правилам',
              'mapping_consistency': 'Согласованность сопоставлений',
              'operational_risk': 'Операционные риски'}
    assert isinstance(observed, dict) and isinstance(observed.get('components'), list)
    components = observed['components']
    assert len(components) == 5 and {item['name'] for item in components} == set(labels)
    card = page.get_by_role('button', name=re.compile('^Доверие к данным'))
    assert await card.count() == 1
    panel = page.get_by_role('region', name='Подробности показателя «Доверие к данным»', exact=True)
    opened = not await panel.is_visible()
    if opened:
        await activate(card, profile)
    await panel.wait_for(timeout=5000)
    for item in components:
        label = labels[item['name']]
        button = panel.get_by_role('button', name=re.compile('^' + re.escape(label) + ': '))
        assert await button.count() == 1
        aria = await button.get_attribute('aria-label')
        score = re.fullmatch(re.escape(label) + r': ([0-9\s,.]+) из 100\. Открыть замечания этого слагаемого', aria or '')
        assert score and float(re.sub(r'\s', '', score[1]).replace(',', '.')) == item['score']
        text = await button.inner_text()
        visible_score = re.search(r'([0-9]+(?:[.,][0-9]+)?)\s*$', text)
        visible_weight = re.search(r'\(([0-9]+(?:[.,][0-9]+)?) %\)', text)
        title_weight = re.search(r', вес ([0-9]+(?:[.,][0-9]+)?) %\.', await button.get_attribute('title') or '')
        assert visible_score and float(visible_score[1].replace(',', '.')) == item['score']
        assert visible_weight and title_weight
        assert float(visible_weight[1].replace(',', '.')) == float(title_weight[1].replace(',', '.')) == item['weight']
    if opened:
        await activate(card, profile)
        await expect(panel).to_be_hidden()
    proof['pulse_trust_ui'] = {'result': 'PASS', 'components_verified': 5, 'source': 'INITIAL_DASHBOARD_GET'}


async def observe_operations_response(response, observed):
    """Reuse the browser's own GET; retain only four small diagnostic observations."""
    if (response.request.method != 'GET' or not readonly_request(response.url, response.request.method)
            or urlsplit(response.url).path != '/api/report-releases'
            or response.status != 200):
        return
    try:
        body = await response.json()
    except Exception:  # noqa: BLE001 - a canceled response has no usable observation.
        return
    value = body.get('operations') if isinstance(body, dict) else None
    if isinstance(value, dict) and isinstance(value.get('checked_at'), str):
        observed[value['checked_at']] = {key: value.get(key) for key in (
            'checked_at', 'last_success_age_seconds', 'last_cycle_duration_seconds',
            'last_failure_at', 'last_failure_code', 'check_stale')}
        while len(observed) > 4:
            observed.pop(next(iter(observed)))


async def verify_operations_status(page, profile, proof, observed):
    """Compare visible values with the exact GET identified by its checked_at."""
    box = page.locator('details').filter(has=page.locator('summary', has_text='Генератор отчётов:'))
    summary = box.locator('summary')
    await summary.wait_for(timeout=5000)
    if await box.get_attribute('open') is None:
        await activate(summary, profile)
    checked_at = await box.locator('time').get_attribute('datetime')
    assert checked_at in observed
    value = observed[checked_at]
    rows = box.locator('dl > div')
    assert await rows.count() == 4
    assert await rows.locator('dt').all_text_contents() == [
        'Доступность API при последнем чтении', 'Возраст последней успешной проверки',
        'Длительность последнего завершённого цикла', 'Последний зафиксированный отказ']
    assert await rows.nth(0).locator('dd').inner_text() == 'Ответ получен'
    for index, key, missing in ((1, 'last_success_age_seconds', 'Успешная попытка не записана'),
                                (2, 'last_cycle_duration_seconds', 'Завершённый цикл не записан')):
        text = await rows.nth(index).locator('dd').inner_text()
        actual = value[key]
        if actual is None:
            assert text == missing
            continue
        assert type(actual) is int and actual >= 0
        # Invert the visible units independently. Hour display has minute precision.
        parts = re.findall(r'([0-9]+) (ч|мин|с)', text)
        assert parts and ' '.join(n + ' ' + unit for n, unit in parts) == text
        rendered = sum(int(n) * {'ч': 3600, 'мин': 60, 'с': 1}[unit] for n, unit in parts)
        precision = 1 if any(unit == 'с' for _, unit in parts) else 60
        assert rendered <= actual < rendered + precision
    failure = await rows.nth(3).locator('dd').inner_text()
    if value['last_failure_at'] is None:
        assert failure == 'В доступной диагностике отказ не записан'
    else:
        assert failure != 'В доступной диагностике отказ не записан'
        instant = datetime.fromisoformat(value['last_failure_at'])
        assert instant.tzinfo is not None
        expected = instant.astimezone(ZoneInfo('Asia/Kamchatka'))
        parts = [int(number) for number in re.findall(r'[0-9]+', failure)]
        assert len(parts) == 6 and parts[:2] == [expected.day, expected.month]
        assert parts[2] in (expected.year, expected.year % 100)
        assert parts[3:] == [expected.hour, expected.minute, expected.second]
        if value['last_failure_code']:
            assert await box.locator('code').inner_text() == value['last_failure_code']
    assert await box.get_by_text('Свежая успешная проверка не подтверждена.', exact=True).count() == int(value['check_stale'])
    proof['operations_ui'] = {'result': 'PASS', 'same_get': True, 'metrics_verified': 4}
    await activate(summary, profile)


async def verify_header_controls(page, profile, proof):
    """Exercise the real header without source writes; restore every selection."""
    header = page.locator('header[data-page-skin]')
    pressed = header.locator('button[aria-pressed]')
    initial = await pressed.evaluate_all("items=>items.map(b=>[b.getAttribute('aria-label'),b.getAttribute('aria-pressed')])")
    period_context = header.locator('.tg-row-active .tg-year, .wr-row-active .wr-label')
    initial_period_context = await period_context.all_text_contents()
    units = ['Показывать суммы в тысячах рублей', 'Показывать суммы в миллионах рублей']
    methods = ['Конкурентные способы, статья 24 44-ФЗ',
               'Единственный поставщик, статья 93 44-ФЗ', 'Все способы закупки']
    for names in (units, methods):
        original = next(label for label in names if [label, 'true'] in initial)
        for label in names:
            button = header.get_by_role('button', name=label, exact=True)
            await activate(button, profile)
            await expect(button).to_have_attribute('aria-pressed', 'true', timeout=5000)
        await activate(header.get_by_role('button', name=original, exact=True), profile)
    for label in ['Программные мероприятия', 'Текущая деятельность',
                  'Федеральный бюджет', 'Краевой бюджет', 'Муниципальный бюджет']:
        button = header.get_by_role('button', name=label, exact=True)
        before = await button.get_attribute('aria-pressed')
        await activate(button, profile)
        await expect(button).to_have_attribute('aria-pressed', 'false' if before == 'true' else 'true', timeout=5000)
        await activate(button, profile)
        await expect(button).to_have_attribute('aria-pressed', before, timeout=5000)
    theme = header.get_by_role('button', name=re.compile('^Включить (светлую|тёмную) тему$'))
    before = await theme.get_attribute('aria-label')
    await activate(theme, profile)
    await expect(theme).not_to_have_attribute('aria-label', before, timeout=5000)
    await activate(theme, profile)
    await expect(theme).to_have_attribute('aria-label', before, timeout=5000)
    search = header.get_by_role('textbox', name='Поиск по реестру закупок', exact=True)
    assert await search.input_value() == ''
    await search.fill('DASH_ACCEPTANCE_NO_MATCH_83')
    await activate(header.get_by_role('button', name='Очистить строку поиска', exact=True), profile)
    await expect(search).to_have_value('')
    corner = header.get_by_role('button', name=re.compile(r'^Фильтры линейки: \d+\. Открыть настройки$'))
    await activate(corner, profile)
    dialog = page.get_by_role('dialog', name='Фильтры линейки', exact=True)
    await expect(dialog).to_be_visible()
    await activate(corner, profile)
    await expect(dialog).to_be_hidden()
    # Coverage can update accessible explanations while these controls are used.
    # Restore every selection and its calendar context, not provider-readiness labels.
    assert await pressed.evaluate_all("items=>items.map(b=>b.getAttribute('aria-pressed'))") == [value for _, value in initial]
    assert await period_context.all_text_contents() == initial_period_context
    proof['header_controls'] = 'PASS'


async def verify_header_periods(page, profile, proof):
    """Calendar and reset/undo use the production controls, without source writes."""
    header = page.locator('header[data-page-skin]')
    week = header.locator('.wr-row-active')
    await expect(week).to_have_attribute('aria-pressed', 'true')
    row = header.locator('.tg-row-active')
    for button in (row.locator('.tg-year'), row.locator('.tg-quarter-tab').last,
                   row.locator('.tg-month').first):
        await expect(button).to_have_attribute('aria-pressed', 'false')
        await activate(button, profile)
        await expect(button).to_have_attribute('aria-pressed', 'true')
        await expect(week).to_have_attribute('aria-pressed', 'false')
        await activate(button, profile)
        await expect(button).to_have_attribute('aria-pressed', 'false')
        await expect(week).to_have_attribute('aria-pressed', 'true')
    quarter = row.locator('.tg-quarter-tab').last
    await activate(quarter, profile)
    await activate(week, profile)
    await expect(quarter).to_have_attribute('aria-pressed', 'false')
    await expect(week).to_have_attribute('aria-pressed', 'true')
    thousands = header.get_by_role('button', name='Показывать суммы в тысячах рублей', exact=True)
    millions = header.get_by_role('button', name='Показывать суммы в миллионах рублей', exact=True)
    await expect(thousands).to_have_attribute('aria-pressed', 'true')
    await activate(millions, profile)
    corner = header.get_by_role('button', name=re.compile(r'^Фильтры линейки: \d+\. Открыть настройки$'))
    await activate(corner, profile)
    dialog = page.get_by_role('dialog', name='Фильтры линейки', exact=True)
    reset_started = time.monotonic()
    await activate(dialog.get_by_role('button', name='Снять фильтры линейки', exact=True), profile)
    await expect(thousands).to_have_attribute('aria-pressed', 'true')
    await activate(corner, profile)
    await expect(dialog).to_be_hidden()
    undo = page.get_by_role('button', name=re.compile('^Вернуть фильтры: '))
    undo_count = await undo.count()
    proof['undo_before'] = {'elapsed_ms': round((time.monotonic()-reset_started)*1000, 1),
                            'present': undo_count, 'disabled': await undo.is_disabled() if undo_count else None}
    await activate(undo, profile)
    proof['undo_after'] = {'elapsed_ms': round((time.monotonic()-reset_started)*1000, 1),
        'millions_pressed': await millions.get_attribute('aria-pressed'),
        'thousands_pressed': await thousands.get_attribute('aria-pressed')}
    await expect(millions).to_have_attribute('aria-pressed', 'true')
    await activate(thousands, profile)
    proof['header_periods_and_undo'] = 'PASS'


async def select_page(page, nav, label, proof=None):
    def phase(value):
        if proof is not None:
            proof['navigation_phase'] = value
    phase('locate_button')
    if proof is not None:
        proof.pop('navigation_hit', None)
        proof.pop('navigation_control', None)
    button = nav.locator('.np-btn').filter(has=page.locator('.np-label', has_text=re.compile('^' + re.escape(label) + '$')))
    profile = (proof or {}).get('browser_profile', 'desktop')
    group = int(await button.evaluate("e => e.closest('[data-nav-group]').dataset.navGroup"))
    if profile == 'iphone':
        # Test the controls a phone user has, never keyboard-only shortcuts.
        phase('touch_group')
        current = int(await nav.locator('.np-group-center').get_attribute('data-nav-group'))
        name = 'Следующая группа разделов' if group > current else 'Предыдущая группа разделов'
        for _ in range(abs(group - current)):
            control = nav.get_by_role('button', name=name, exact=True)
            if proof is not None:
                proof['navigation_control'] = await control.evaluate('''e=>{
                    const r=e.getBoundingClientRect(),rail=e.closest('.hbar-drumline');
                    return {disabled:e.disabled,rect:{x:r.x,y:r.y,width:r.width,height:r.height},
                        rail_scroll_left:rail?.scrollLeft??null,rail_width:rail?.clientWidth??null,
                        viewport_width:innerWidth};
                }''')
                proof['navigation_groups'] = {'target': group, 'current': current}
            await activate(control, profile)
        assert int(await nav.locator('.np-group-center').get_attribute('data-nav-group')) == group
        await button.scroll_into_view_if_needed(timeout=5000)
    else:
        phase('focus_navigation')
        await nav.focus()
        phase('home_group')
        await nav.press('Home')
        for _ in range(group):
            phase('move_group')
            await nav.press('ArrowDown')
    if proof is not None:
        proof['navigation_input'] = 'touch' if profile == 'iphone' else 'keyboard'
        proof['navigation_hit'] = await button.evaluate('''e => {
            const r=e.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);
            return {positive_size:r.width>0&&r.height>0,inside_viewport:r.left>=0&&r.right<=innerWidth,
                receives_pointer:hit!==null&&(hit===e||e.contains(hit)),
                covered_by_dialog:!!hit?.closest('[role="dialog"]')};
        }''')
    phase('click_button')
    await activate(button, profile)
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
            headed = os.environ.get('BROWSER_HEADED') == '1'
            proof['browser_renderer'] = ('GTK' if headed else 'WPE') if engine == 'webkit' else 'CHROMIUM'
            browser = await getattr(driver, engine).launch(headless=not headed)
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
            release_pending = {}
            operations_observed = {}

            def release_transport(request, phase):
                started = release_pending.get(id(request), (None, None))[1]
                if record_release_transport(request, phase, proof, started_at=started):
                    if phase == 'started' and len(release_pending) < 16:
                        release_pending[id(request)] = (request, time.monotonic())
                    elif phase != 'started':
                        release_pending.pop(id(request), None)

            page.on('pageerror', lambda _: errors.append(True))
            page.on('response', lambda response: record_response(response, proof))
            if os.environ.get('EXPECT_OPERATIONS_UI') == 'yes':
                page.on('response', lambda response: observe_operations_response(response, operations_observed))
            page.on('request', lambda request: release_transport(request, 'started'))
            page.on('requestfinished', lambda request: release_transport(request, 'finished'))
            page.on('requestfailed', lambda request: release_transport(request, 'failed'))
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
            dashboard_response = await dashboard.value
            await dashboard_response.finished()
            initial_trust = (await dashboard_response.json()).get('trust') if os.environ.get('EXPECT_PULSE_TRUST_UI') == 'yes' else None
            proof['stage'] = 'initial_render'
            nav = page.get_by_role('navigation', name='Навигация', exact=True)
            await nav.wait_for(timeout=30000)
            visited = []

            scenario = os.environ.get('BROWSER_SCENARIO', 'full')
            if scenario not in {'full', 'navigation', 'filters', 'word-readiness'}:
                raise ValueError('BROWSER_SCENARIO_INVALID')
            proof['scenario'] = scenario
            for label in (PAGES if scenario in {'full', 'navigation'} else ['Реестр'] if scenario == 'filters' else ['Отчёт']):
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
                if label == 'Пульс' and scenario == 'full' and os.environ.get('EXPECT_PULSE_TRUST_UI') == 'yes':
                    proof['stage'] = 'pulse_trust'
                    await verify_pulse_trust(page, profile, proof, initial_trust)
                visited.append(label)
                proof['pages_visited'] = len(visited)
            proof['pages_visited'] = len(visited)
            if scenario == 'navigation':
                assert not errors and not blocked
                proof.update(result='PASS', stage='complete', scope='NAVIGATION_ONLY', page_errors=0, blocked_requests=0)
                await browser.close()
                print(json.dumps(proof))
                return 0
            if scenario in {'full', 'filters'}:
                proof['stage'] = 'header_controls'
                await select_page(page, nav, 'Реестр', proof)
                await verify_header_controls(page, profile, proof)
                await verify_header_periods(page, profile, proof)
            if scenario == 'filters':
                assert not errors and not blocked
                proof.update(result='PASS', stage='complete', scope='FILTERS_ONLY', page_errors=0, blocked_requests=0)
                await browser.close()
                print(json.dumps(proof))
                return 0
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
                    for request, started in release_pending.values():
                        record_release_transport(request, 'pending', proof, started_at=started)
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
                    if release_pending:
                        last_request = next(reversed(release_pending.values()))[0]
                        proof['independent_selected_transport'] = await probe_selected_transport(context, last_request.url)
                    raise
                before = len(word_requests)
                async with page.expect_download(timeout=30000) as event:
                    proof['word_phase'] = 'click'
                    try:
                        await activate(button, profile)
                    except Exception:
                        proof['word_hit_geometry'] = await hit_geometry(button)
                        raise
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
            if os.environ.get('EXPECT_OPERATIONS_UI') == 'yes':
                proof['stage'] = 'operations'
                await verify_operations_status(page, profile, proof, operations_observed)
            proof['stage'] = 'journal'
            journal_toggle = page.get_by_role('button', name=re.compile(r'^Журнал обновлений\.'))
            await activate(journal_toggle, profile)
            dialog = page.get_by_role('dialog', name='Провенанс: откуда числа и что изменилось', exact=True)
            await dialog.wait_for()
            for label in ['Изменения', 'Комментарии', 'Источники']:
                tab = dialog.get_by_role('tab', name=label, exact=True)
                await activate(tab, profile)
                assert await tab.get_attribute('aria-selected') == 'true'
            if profile == 'iphone':
                await activate(journal_toggle, profile)
            else:
                await page.keyboard.press('Escape')
            await dialog.wait_for(state='hidden')
            proof.update(result='PASS', stage='complete', basic_edge='PASS',
                         three_word_downloads=downloads, journal_tabs='PASS', page_errors=len(errors), blocked_requests=len(blocked))
            assert not errors and not blocked
            await browser.close()
    except Exception as error:  # noqa: BLE001 — never expose page text or credentials in public logs.
        proof['result'] = 'FAILED'
        proof['failure_class'] = type(error).__name__
        proof['failure_location'] = failure_location(error)
        proof['failure_actionability'] = actionability_flags(error)
        if isinstance(error, ValueError) and str(error) == 'OWNER_BROWSER_PASSWORD_SECRET_REQUIRED':
            proof['error_code'] = str(error)
    finally:
        target.write_text(json.dumps(proof))
        target.chmod(0o600)
    print(json.dumps(proof))
    return 0 if proof['result'] == 'PASS' else 2


if __name__ == '__main__':
    raise SystemExit(asyncio.run(run()))
