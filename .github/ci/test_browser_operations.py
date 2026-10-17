"""The live UI gate must reject missing or corrupted generator observations."""
import os
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock

import live_browser_readback as verifier
from playwright.async_api import async_playwright


class OperationsBrowserTests(unittest.IsolatedAsyncioTestCase):
    async def scenario(self, *, age='1 мин 1 с', duration='2 мин 5 с', observed=True,
                       failure_at=None, failure_text='В доступной диагностике отказ не записан'):
        async with async_playwright() as driver:
            browser = await getattr(driver, os.environ.get('BROWSER_ENGINE', 'chromium')).launch()
            try:
                page = await browser.new_page()
                await page.set_content(f'''<details><summary>Генератор отчётов: Нет активной попытки</summary>
                    <dl><div><dt>Доступность API при последнем чтении</dt><dd>Ответ получен</dd></div>
                    <div><dt>Возраст последней успешной проверки</dt><dd>{age}</dd></div>
                    <div><dt>Длительность последнего завершённого цикла</dt><dd>{duration}</dd></div>
                    <div><dt>Последний зафиксированный отказ</dt><dd>{failure_text}</dd></div></dl>
                    <time datetime="2026-10-16T23:00:00+00:00">17.10.2026</time></details>''')
                value = {'checked_at': '2026-10-16T23:00:00+00:00',
                         'last_success_age_seconds': 61, 'last_cycle_duration_seconds': 125,
                         'last_failure_at': failure_at, 'last_failure_code': None, 'check_stale': False}
                proof = {}
                await verifier.verify_operations_status(page, 'desktop', proof,
                    {value['checked_at']: value} if observed else {})
                self.assertEqual(proof['operations_ui'],
                                 {'result': 'PASS', 'same_get': True, 'metrics_verified': 4})
            finally:
                await browser.close()

    async def test_values_match_the_same_observed_get(self):
        await self.scenario()

    async def test_displayed_zero_cannot_replace_observed_age(self):
        with self.assertRaises(AssertionError):
            await self.scenario(age='0 с')

    async def test_other_duration_cannot_pass(self):
        with self.assertRaises(AssertionError):
            await self.scenario(duration='2 мин 4 с')

    async def test_unobserved_timestamp_cannot_pass(self):
        with self.assertRaises(AssertionError):
            await self.scenario(observed=False)

    async def test_failure_time_is_the_actual_observed_instant_in_kamchatka(self):
        await self.scenario(failure_at='2026-10-15T12:00:00+00:00', failure_text='16.10.2026, 00:00:00')

    async def test_other_failure_date_cannot_pass(self):
        with self.assertRaises(AssertionError):
            await self.scenario(failure_at='2026-10-15T12:00:00+00:00', failure_text='17.10.2026, 00:00:00')


class OperationsObservationTests(unittest.IsolatedAsyncioTestCase):
    async def test_only_the_same_origin_get_is_evidence(self):
        for url, method in ((verifier.BASE + '/api/report-releases', 'POST'),
                            ('https://example.com/api/report-releases', 'GET')):
            response = SimpleNamespace(url=url, request=SimpleNamespace(method=method),
                                       status=200, json=AsyncMock(return_value={}))
            observed = {}
            await verifier.observe_operations_response(response, observed)
            self.assertEqual(observed, {})
            response.json.assert_not_awaited()

    async def test_observations_are_bounded_and_exclude_private_payload(self):
        observed = {}
        for n in range(6):
            response = SimpleNamespace(url=verifier.BASE + '/api/report-releases?asOf=2026-10-16',
                request=SimpleNamespace(method='GET'), status=200,
                json=AsyncMock(return_value={'private_model': 'PRIVATE',
                    'operations': {'checked_at': str(n), 'private_field': 'PRIVATE'}}))
            await verifier.observe_operations_response(response, observed)
        self.assertEqual(list(observed), ['2', '3', '4', '5'])
        self.assertNotIn('PRIVATE', str(observed))


class PulseTrustBrowserTests(unittest.IsolatedAsyncioTestCase):
    async def scenario(self, defect=None):
        labels = [('data_quality', 'Качество данных', 95, 31),
                  ('formula_integrity', 'Целостность формул', 80, 25),
                  ('rule_compliance', 'Соответствие правилам', 70, 20),
                  ('mapping_consistency', 'Согласованность сопоставлений', 60, 14),
                  ('operational_risk', 'Операционные риски', 0, 10)]
        observed = {'components': [{'name': name, 'score': score, 'weight': weight}
                                   for name, _, score, weight in labels]}
        async with async_playwright() as driver:
            browser = await getattr(driver, os.environ.get('BROWSER_ENGINE', 'chromium')).launch()
            try:
                page = await browser.new_page()
                buttons = []
                for index, (_, label, score, weight) in enumerate(labels):
                    if defect == 'missing' and index == 0:
                        continue
                    score = 0 if defect == 'zero' and index == 0 else score
                    weight = 30 if defect == 'weight' and index == 0 else weight
                    buttons.append(f'<button aria-label="{label}: {score} из 100. Открыть замечания этого слагаемого" '
                                   f'title="{label}: {score} из 100, вес {weight} %. Открыть замечания">{label}({weight} %)<span>{score}</span></button>')
                await page.set_content('<button onclick="const p=document.querySelector(\'section\');p.hidden=!p.hidden">Доверие к данным</button>'
                    '<section role="region" aria-label="Подробности показателя «Доверие к данным»" hidden>'
                    + ''.join(buttons) + '</section>')
                proof = {}
                await verifier.verify_pulse_trust(page, 'desktop', proof, observed)
                self.assertEqual(proof['pulse_trust_ui'], {'result': 'PASS', 'components_verified': 5,
                                                          'source': 'INITIAL_DASHBOARD_GET'})
            finally:
                await browser.close()

    async def test_observed_component_values_and_a_real_zero_pass(self):
        await self.scenario()

    async def test_fabricated_zero_cannot_replace_api_value(self):
        with self.assertRaises(AssertionError):
            await self.scenario('zero')

    async def test_hardcoded_weight_cannot_replace_api_weight(self):
        with self.assertRaises(AssertionError):
            await self.scenario('weight')

    async def test_missing_component_is_not_a_complete_check(self):
        with self.assertRaises(AssertionError):
            await self.scenario('missing')


if __name__ == '__main__':
    unittest.main()
