import json
import unittest

from paired_read_timing import attach_proxy_timing, stages, summarize


class PairedTimingTest(unittest.TestCase):
    def test_only_declared_assessment_clocks_are_ignored(self):
        data = {'snapshot': {'id': 's1', 'createdAt': '2026-10-21T00:00:00Z',
                             'trust': {'computedAt': 'first', 'overall': None}},
                'trust': {'computedAt': 'first'}, 'value': 12}
        def proof():
            return summarize(json.dumps(data).encode(), 'app;dur=1', 2, 3, 1)
        first = proof()
        data['trust']['computedAt'] = data['snapshot']['trust']['computedAt'] = 'second'
        second = proof()
        self.assertNotEqual(first['bodySha256'], second['bodySha256'])
        self.assertEqual(first['semanticSha256'], second['semanticSha256'])
        data['value'] = 13
        self.assertNotEqual(first['semanticSha256'], proof()['semanticSha256'])
        data['value'] = 12
        data['snapshot']['createdAt'] = '2026-10-22T00:00:00Z'
        self.assertNotEqual(first['semanticSha256'], proof()['semanticSha256'])

    def test_proxy_join_requires_one_exact_response_not_nearby_request(self):
        proof = {'edge': {'requestId': 'req-7'}}
        record = json.dumps({'resp_headers': {'X-Request-Id': ['req-7']}, 'status': 200, 'duration': .2})
        self.assertEqual(attach_proxy_timing(proof, [record])['edge']['proxyInclusiveMs'], 200)
        self.assertIsNone(attach_proxy_timing(proof, [record, record])['edge']['proxyInclusiveMs'])
        self.assertFalse(attach_proxy_timing(proof, [record.replace('req-7', 'req-8')])['proxyIsolated'])

    def test_budget_uses_app_not_sum_of_overlapping_stages(self):
        body = json.dumps({'snapshot': {'id': 's1', 'createdAt': '2026-10-21T00:00:00Z'}}).encode()
        proof = summarize(body, 'app;dur=2900, model;dur=2800, reader;dur=2700', 3100, 3200, 5)
        self.assertTrue(proof['appBudgetPassed'])
        self.assertEqual(proof['transportAndProxyResidualMs'], 300)
        self.assertEqual(proof['bytes'], len(body))
        self.assertFalse(summarize(body, 'app;dur=3000.01', 3100, 3200, 5)['appBudgetPassed'])

    def test_missing_or_duplicate_evidence_cannot_pass(self):
        for header in ['', 'reader;dur=5', 'app;dur=1, app;dur=2']:
            with self.subTest(header=header), self.assertRaises(ValueError):
                stages(header)
        for data in [{}, {'snapshot': {'id': 's1'}}]:
            with self.subTest(data=data), self.assertRaises(ValueError):
                summarize(json.dumps(data).encode(), 'app;dur=1', 2, 3, 1)


if __name__ == '__main__':
    unittest.main()
