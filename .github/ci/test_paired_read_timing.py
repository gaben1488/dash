import json
import os
import sys
import tempfile
import unittest
from io import BytesIO
from pathlib import Path
from unittest.mock import patch
from zipfile import ZipFile

from paired_read_timing import (attach_proxy_timing, field_census, main,
                                stages, summarize, summarize_docx, DOCX_CONTENT_TYPE,
                                read_proxy_lines, MAX_PROXY_LOG_BYTES)


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


    def test_field_census_is_fixed_and_never_emits_values(self):
        data = {
            'snapshot': {
                'id': 'PRIVATE_ID_DO_NOT_LOG',
                'issues': [{'private': 'PRIVATE_VALUE_DO_NOT_LOG'}],
                'metadata': None,
                'officialMetrics': {'SECRET_KEY': 5},
            },
            'recentIssues': [],
            'unlistedSecret': 'PRIVATE_EXTRA_DO_NOT_LOG',
        }
        census = field_census(data)
        self.assertEqual(census['snapshot.issues']['entries'], 1)
        self.assertEqual(census['recentIssues'], {'present': True, 'bytes': 2, 'entries': 0})
        self.assertEqual(census['snapshot.metadata'], {'present': True, 'bytes': 4, 'entries': None})
        self.assertEqual(census['snapshot.datasetAnalyses'],
                         {'present': False, 'bytes': None, 'entries': None})
        self.assertEqual(set(census), {
            'snapshot.issues', 'recentIssues', 'snapshot.officialMetrics',
            'snapshot.calculatedMetrics', 'snapshot.metadata', 'snapshot.datasetAnalyses',
            'departmentSummaries', 'summaryByPeriod', 'trust', 'issueSummary',
        })
        self.assertNotIn('PRIVATE', json.dumps(census))
        self.assertNotIn('SECRET_KEY', json.dumps(census))

    def test_pinned_docx_get_accepts_only_actual_word_zip(self):
        stream = BytesIO()
        with ZipFile(stream, 'w') as archive:
            archive.writestr('[Content_Types].xml', '<Types/>')
            archive.writestr('word/document.xml', '<document/>')
        good = summarize_docx(stream.getvalue(), 'app;dur=7, reader;dur=4',
                              DOCX_CONTENT_TYPE, 8, 10)
        self.assertEqual(good['bytes'], len(stream.getvalue()))
        self.assertTrue(good['appBudgetPassed'])
        self.assertEqual(good['transportAndProxyResidualMs'], 3)
        self.assertNotIn('<document/>', json.dumps(good))
        with self.assertRaisesRegex(ValueError, 'MEDIA_TYPE'):
            summarize_docx(stream.getvalue(), 'app;dur=1', 'application/json', 1, 2)
        with self.assertRaisesRegex(ValueError, 'DOCX_STRUCTURE'):
            summarize_docx(b'not a word file', 'app;dur=1', DOCX_CONTENT_TYPE, 1, 2)
        invalid = BytesIO()
        with ZipFile(invalid, 'w') as archive:
            archive.writestr('word/other.xml', '<document/>')
        with self.assertRaisesRegex(ValueError, 'DOCX_STRUCTURE'):
            summarize_docx(invalid.getvalue(), 'app;dur=1', DOCX_CONTENT_TYPE, 1, 2)

    def test_proxy_correlation_keeps_dashboard_and_word_separate(self):
        proof = {'edge': {'requestId': 'req-dash'},
                 'selectedReport': {'edge': {'requestId': 'req-word'}}}
        lines = [
            json.dumps({'resp_headers': {'X-Request-Id': [request_id]}, 'status': 200,
                        'duration': seconds})
            for request_id, seconds in [('req-dash', .15), ('req-word', .22)]
        ]
        joined = attach_proxy_timing(proof, lines)
        self.assertEqual(joined['edge']['proxyInclusiveMs'], 150)
        self.assertEqual(joined['selectedReport']['edge']['proxyInclusiveMs'], 220)
        self.assertTrue(joined['selectedReport']['proxyIsolated'])
        self.assertIsNone(attach_proxy_timing(proof, lines + [lines[1]])
                          ['selectedReport']['edge']['proxyInclusiveMs'])

    def test_cli_pins_selected_word_without_post_or_fallback(self):
        dashboard = {'snapshotId': 's1', 'asOf': '2026-10-22T00:00:00Z',
                     'bodySha256': 'dashboard', 'semanticSha256': 'dashboard',
                     'appBudgetPassed': True, 'requestId': 'req-dash'}
        word = {'bodySha256': 'word', 'appBudgetPassed': True, 'requestId': 'req-word'}
        release_id = 'REL-' + 'a' * 64
        with tempfile.TemporaryDirectory() as directory:
            output = str(Path(directory) / 'proof.json')
            proxy_log = str(Path(directory) / 'caddy.jsonl')
            Path(proxy_log).write_text('\n'.join([
                json.dumps({'resp_headers': {'X-Request-Id': ['req-dash']},
                            'status': 200, 'duration': .15}),
                json.dumps({'resp_headers': {'X-Request-Id': ['req-word']},
                            'status': 200, 'duration': .22}),
            ]))
            argv = ['paired_read_timing.py', '--native', 'http://127.0.0.1:3000',
                    '--edge', 'http://127.0.0.1:8080', '--sha', 'b' * 40,
                    '--scenario', 'warm', '--year', '2026', '--output', output,
                    '--selected-release', release_id, '--selected-view', 'operational',
                    '--proxy-log', proxy_log]
            with patch.object(sys, 'argv', argv), patch.dict(os.environ, {
                'DASH_BASIC_USER': 'fixture', 'DASH_BASIC_PASSWORD': 'secret',
                'AEMR_API_KEY': 'private',
            }), patch('paired_read_timing.measure',
                      side_effect=[dashboard, dashboard, word, word]) as measured:
                self.assertEqual(main(), 0)
            proof = json.loads(Path(output).read_text())
            self.assertTrue(proof['selectedReportMeasured'])
            self.assertTrue(proof['selectedReport']['sameBody'])
            self.assertTrue(proof['proxyEvidenceComplete'])
            self.assertTrue(proof['proxyIsolated'])
            self.assertEqual(proof['selectedReport']['edge']['proxyInclusiveMs'], 220)
            self.assertFalse(proof['acceptanceReady'])
            self.assertFalse(proof['scenarioSetupVerifiedByProbe'])
            self.assertFalse(proof['browserMeasured'])
            self.assertEqual(measured.call_count, 4)
            self.assertEqual(measured.call_args_list[0].args[1],
                             '/api/dashboard?compact=1&year=2026')
            self.assertEqual(measured.call_args_list[2].args[1],
                             f'/api/report-releases/{release_id}/operational.docx')
            self.assertEqual(measured.call_args_list[2].kwargs, {'media': 'docx'})
            self.assertNotIn('secret', json.dumps(proof))
            self.assertNotIn('private', json.dumps(proof))
            with patch.object(sys, 'argv', argv[:argv.index('--selected-release')] + ['--selected-release', 'latest']):
                with self.assertRaises(ValueError):
                    main()



    def test_proxy_probe_rejects_oversize_capture_without_copying_private_logs(self):
        with tempfile.TemporaryDirectory() as directory:
            capture = Path(directory) / 'private-proxy.log'
            capture.write_bytes(b'X' * (MAX_PROXY_LOG_BYTES + 1))
            with self.assertRaisesRegex(ValueError, 'PROXY_LOG_TOO_LARGE'):
                read_proxy_lines(capture)



if __name__ == '__main__':
    unittest.main()
