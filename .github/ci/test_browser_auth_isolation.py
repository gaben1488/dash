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
from unittest.mock import patch

import live_browser_readback as verifier
from playwright.async_api import Error as PlaywrightError
from playwright.async_api import async_playwright


class BrowserAuthIsolationTests(unittest.IsolatedAsyncioTestCase):
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
