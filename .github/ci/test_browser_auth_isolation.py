"""Real browser transport must prevent credential delivery outside the read-only origin."""
import asyncio
import base64
import os
import ssl
import subprocess
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import live_browser_readback as verifier
from playwright.async_api import Error as PlaywrightError
from playwright.async_api import async_playwright


class ReleaseTransportProjectionTests(unittest.TestCase):
    def test_pending_request_without_native_start_time_uses_our_monotonic_clock(self):
        request = SimpleNamespace(url=verifier.BASE + '/api/report-releases?date=PRIVATE',
                                  method='GET', timing={'startTime': 0, 'responseEnd': -1})
        proof = {}
        with patch('time.monotonic', return_value=42):
            verifier.record_release_transport(request, 'pending', proof, started_at=12)
        self.assertEqual(proof['release_transport'][0]['elapsed_ms'], 30000)
        self.assertNotIn('PRIVATE', str(proof))

    def test_projects_request_lifetime_without_url_query_failure_or_headers(self):
        request = SimpleNamespace(url=verifier.BASE + '/api/report-releases?date=PRIVATE&token=SECRET',
                                  method='GET', timing={'startTime': 1000, 'responseEnd': -1},
                                  failure='PRIVATE_FAILURE')
        proof = {}
        with patch('time.time', return_value=2):
            self.assertTrue(verifier.record_release_transport(request, 'pending', proof))
        self.assertEqual(proof, {'release_transport': [
            {'phase': 'pending', 'selected_context': True, 'method': 'GET', 'elapsed_ms': 1000}]})
        self.assertNotIn('PRIVATE', str(proof))
        self.assertNotIn('SECRET', str(proof))
        request.url = 'https://foreign.invalid/api/report-releases'
        self.assertFalse(verifier.record_release_transport(request, 'failed', proof))
        self.assertEqual(len(proof['release_transport']), 1)
        request.url = verifier.BASE + '/api/report-releases'
        request.timing['responseEnd'] = 123.5
        for _ in range(30):
            verifier.record_release_transport(request, 'finished', proof)
        self.assertEqual(len(proof['release_transport']), 16)
        self.assertEqual(proof['release_transport'][1]['elapsed_ms'], 123.5)


class SelectedTransportProbeTests(unittest.IsolatedAsyncioTestCase):
    async def test_probe_keeps_only_status_size_timing_and_hash(self):
        response = SimpleNamespace(status=200, body=AsyncMock(return_value=b'{"private":"PRIVATE"}'),
                                   dispose=AsyncMock())
        context = SimpleNamespace(request=SimpleNamespace(get=AsyncMock(return_value=response)))
        proof = await verifier.probe_selected_transport(context, verifier.BASE + '/api/report-releases?date=SECRET')
        self.assertEqual(proof['status'], 200)
        self.assertEqual(proof['bytes'], 21)
        self.assertNotIn('PRIVATE', str(proof))
        self.assertNotIn('SECRET', str(proof))
        self.assertEqual(context.request.get.call_args.kwargs, {'max_redirects': 0, 'timeout': 10000})
        response.dispose.assert_awaited_once()

    async def test_foreign_origin_and_other_paths_are_rejected_before_transport(self):
        context = SimpleNamespace(request=SimpleNamespace(get=AsyncMock()))
        for url in ('https://foreign.invalid/api/report-releases', verifier.BASE + '/api/private'):
            with self.assertRaises(ValueError):
                await verifier.probe_selected_transport(context, url)
        context.request.get.assert_not_awaited()


class BrowserAuthIsolationTests(unittest.IsolatedAsyncioTestCase):
    async def test_hit_geometry_identifies_cover_without_copying_dom_text(self):
        async with async_playwright() as driver:
            browser = await driver.chromium.launch()
            try:
                page = await browser.new_page()
                await page.set_content('<button style="position:fixed;top:40px;left:40px">PRIVATE</button>'
                    '<header style="position:fixed;inset:0 0 auto;height:100px;z-index:9">SECRET</header>')
                geometry = await verifier.hit_geometry(page.locator('button'))
                self.assertFalse(geometry['receives_pointer'])
                self.assertEqual(geometry['cover'], 'HEADER')
                self.assertNotIn('PRIVATE', str(geometry))
                self.assertNotIn('SECRET', str(geometry))
            finally:
                await browser.close()

    async def test_iphone_navigation_uses_touch_controls_and_no_keyboard_shortcut(self):
        async with async_playwright() as driver:
            browser = await getattr(driver, os.environ.get('BROWSER_ENGINE', 'webkit')).launch(headless=True)
            try:
                _, options = verifier.browser_settings('iphone', driver.devices)
                page = await browser.new_page(**options)
                await page.set_content('''
                <meta name="viewport" content="width=device-width, initial-scale=1">
                <style>button{min-width:44px;min-height:44px}</style>
                <nav aria-label="Навигация" tabindex="0">
                  <div data-nav-group="0" class="np-group-center"><button class="np-btn" aria-current="page"><span class="np-label">Пульс</span></button></div>
                  <div data-nav-group="1"><button class="np-btn"><span class="np-label">Реестр</span></button></div>
                  <div data-nav-group="2"><button class="np-btn"><span class="np-label">Экономия</span></button></div>
                  <div data-nav-group="3"><button class="np-btn"><span class="np-label">Система</span></button></div>
                  <button aria-label="Предыдущая группа разделов" id="previous">↑</button>
                  <button aria-label="Следующая группа разделов" id="next">↓</button>
                </nav>
                <script>
                window.keyEvents=0;window.touchEvents=0;window.touchSelections=0;let center=0;
                const nav=document.querySelector('nav'),groups=[...document.querySelectorAll('[data-nav-group]')];
                function move(index){center=Math.max(0,Math.min(3,index));groups.forEach((g,i)=>g.classList.toggle('np-group-center',i===center));}
                nav.addEventListener('keydown',e=>{window.keyEvents++;if(e.key==='Home')move(0);if(e.key==='ArrowDown')move(center+1);});
                nav.addEventListener('touchstart',e=>{window.touchEvents++;if(e.target.closest('.np-btn'))window.touchSelections++;});
                document.querySelector('#next').onclick=()=>move(center+1);
                document.querySelector('#previous').onclick=()=>move(center-1);
                document.querySelectorAll('.np-btn').forEach(b=>b.onclick=()=>{
                  document.querySelector('[aria-current]')?.removeAttribute('aria-current');b.setAttribute('aria-current','page');
                });
                </script>
                ''')
                nav = page.get_by_role('navigation', name='Навигация', exact=True)
                proof = {'browser_profile': 'iphone'}
                for label in ('Система', 'Пульс', 'Экономия', 'Реестр'):
                    await verifier.select_page(page, nav, label, proof)
                self.assertEqual(await page.evaluate('window.keyEvents'), 0)
                self.assertGreaterEqual(await page.evaluate('window.touchEvents'), 4)
                self.assertEqual(await page.evaluate('window.touchSelections'), 4)
                self.assertEqual(proof['navigation_input'], 'touch')
            finally:
                await browser.close()

    async def test_real_transport_blocks_foreign_origin_and_post_before_delivery(self):
        calls = {'allowed': [], 'foreign': []}
        expected = 'Basic ' + base64.b64encode(b'synthetic-user:synthetic-password').decode()

        def handler(kind):
            class Handler(BaseHTTPRequestHandler):
                def do_GET(self):
                    calls[kind].append((self.command, self.headers.get('Authorization') == expected))
                    authenticated = self.headers.get('Authorization') == expected
                    self.send_response(200 if authenticated else 401)
                    if not authenticated:
                        self.send_header('WWW-Authenticate', 'Basic realm="synthetic"')
                    self.end_headers()
                    self.wfile.write(b'synthetic')

                do_POST = do_GET

                def log_message(self, *_args):
                    pass
            return Handler

        servers = [ThreadingHTTPServer(('127.0.0.1', 0), handler(kind)) for kind in calls]
        temporary = tempfile.TemporaryDirectory()
        certificate, key = (str(Path(temporary.name) / name) for name in ('cert.pem', 'key.pem'))
        await asyncio.to_thread(subprocess.run, ['openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
                        '-keyout', key, '-out', certificate, '-subj', '/CN=127.0.0.1', '-days', '1'],
                       check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=15)
        tls = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        tls.load_cert_chain(certificate, key)
        servers[0].socket = tls.wrap_socket(servers[0].socket, server_side=True)
        for server in servers:
            threading.Thread(target=server.serve_forever, daemon=True).start()
        origin = 'https://127.0.0.1:' + str(servers[0].server_port)
        foreign = 'http://127.0.0.1:' + str(servers[1].server_port)
        blocked = []
        try:
            async with async_playwright() as driver:
                engine = os.environ.get('BROWSER_ENGINE', 'webkit')
                browser = await getattr(driver, engine).launch(headless=True)
                try:
                    with patch.object(verifier, 'BASE', origin):
                        context = await browser.new_context(ignore_https_errors=True, http_credentials=verifier.browser_credentials(
                            'iphone' if engine == 'webkit' else 'desktop', 'synthetic-user', 'synthetic-password'))

                        async def readonly(route):
                            if verifier.readonly_request(route.request.url, route.request.method):
                                await route.continue_()
                            else:
                                blocked.append((route.request.url, route.request.method))
                                await route.abort()

                        await context.route('http*://**', readonly)
                        page = await context.new_page()
                        response = await page.goto(origin)
                        self.assertEqual(response.status, 200)
                        self.assertTrue(any(authenticated for _, authenticated in calls['allowed']))
                        # Both origins challenge for Basic Auth; foreign requests must never arrive.
                        downgrade = origin.replace('https:', 'http:')
                        for destination in (foreign, downgrade):
                            denied = await context.new_page()
                            try:
                                with self.assertRaises(PlaywrightError):
                                    await denied.goto(destination, timeout=5000)
                                self.assertIn((destination + '/', 'GET'), blocked)
                            finally:
                                await denied.close()
                        self.assertEqual(calls['foreign'], [])
                        before = len(calls['allowed'])
                        sent = await page.evaluate("url => fetch(url, {method:'POST'}).then(() => true, () => false)", origin)
                        self.assertFalse(sent)
                        self.assertEqual(len(calls['allowed']), before)
                        self.assertIn((origin + '/', 'POST'), blocked)
                        await context.close()
                        for password in (None, 'wrong-synthetic-password'):
                            settings = {'ignore_https_errors': True}
                            if password is not None:
                                settings['http_credentials'] = verifier.browser_credentials(
                                    'iphone' if engine == 'webkit' else 'desktop', 'synthetic-user', password)
                            rejected = await browser.new_context(**settings)
                            await rejected.route('http*://**', readonly)
                            rejected_page = await rejected.new_page()
                            response = await rejected_page.goto(origin)
                            self.assertEqual(response.status, 401)
                            await rejected.close()
                finally:
                    await browser.close()
        finally:
            for server in servers:
                await asyncio.to_thread(server.shutdown)
                server.server_close()
            temporary.cleanup()


if __name__ == '__main__':
    unittest.main()
