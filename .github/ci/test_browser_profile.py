"""Mobile acceptance must actually select WebKit and the complete touch profile."""
import ast
import unittest
from pathlib import Path


class BrowserProfileTests(unittest.TestCase):
    def settings(self, profile):
        source = Path(__file__).with_name('live_browser_readback.py').read_text()
        node = next((item for item in ast.parse(source).body
                     if isinstance(item, ast.FunctionDef) and item.name == 'browser_settings'), None)
        self.assertIsNotNone(node, 'The existing desktop verifier cannot prove an iPhone browser')
        context = {}
        exec(compile(ast.Module(body=[node], type_ignores=[]), '<browser-profile>', 'exec'), context)  # noqa: S102 - trusted local function, no page/source input
        device = {'viewport': {'width': 390, 'height': 664}, 'is_mobile': True,
                  'has_touch': True, 'user_agent': 'iPhone fixture', 'default_browser_type': 'webkit'}
        return context['browser_settings'](profile, {'iPhone 13': device})

    def test_iphone_uses_webkit_and_touch_without_unsupported_context_key(self):
        engine, options = self.settings('iphone')
        self.assertEqual(engine, 'webkit')
        self.assertEqual(options['viewport']['width'], 390)
        self.assertTrue(options['is_mobile'])
        self.assertTrue(options['has_touch'])
        self.assertNotIn('default_browser_type', options)

    def test_desktop_keeps_existing_context(self):
        self.assertEqual(self.settings('desktop'), ('chromium', {'viewport': {'width': 1600, 'height': 1000}}))

    def test_unknown_profile_cannot_silently_pass_as_desktop(self):
        with self.assertRaises(ValueError):
            self.settings('unknown')


class ReadonlyOriginTests(unittest.TestCase):
    def test_credentials_never_follow_http_downgrade_or_foreign_origin(self):
        from urllib.parse import urlsplit
        source = Path(__file__).with_name('live_browser_readback.py').read_text()
        node = next((item for item in ast.parse(source).body
                     if isinstance(item, ast.FunctionDef) and item.name == 'readonly_request'), None)
        self.assertIsNotNone(node, 'Comparing only netloc permits a credential-bearing HTTPS downgrade')
        context = {'urlsplit': urlsplit, 'BASE': 'https://dash-elizovo-uer.ru'}
        exec(compile(ast.Module(body=[node], type_ignores=[]), '<readonly-origin>', 'exec'), context)  # noqa: S102 - trusted local predicate only
        allowed = context['readonly_request']
        self.assertTrue(allowed('https://dash-elizovo-uer.ru/api/health', 'GET'))
        self.assertTrue(allowed('https://dash-elizovo-uer.ru/', 'HEAD'))
        for url, method in [('http://dash-elizovo-uer.ru/', 'GET'),
                            ('https://external.invalid/', 'GET'),
                            ('https://dash-elizovo-uer.ru/', 'POST'),
                            ('https://dash-elizovo-uer.ru:444/', 'GET')]:
            with self.subTest(url=url, method=method):
                self.assertFalse(allowed(url, method))


if __name__ == '__main__':
    unittest.main()
