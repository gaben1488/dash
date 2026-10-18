"""Run the real bounded diagnostic client against synthetic HTTP responses."""
import ast
import contextlib
import hashlib
import io
import json
import os
import re
import sys
import textwrap
import unittest
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]


class TimingWindowTests(unittest.TestCase):
    def validate_window(self, rows):
        source = (ROOT / '.github/workflows/ci.yml').read_text().split('  api-timing:', 1)[1]
        block = source[source.index('             rows=[json.loads'):source.index("            if resource=='report' and not latest:")]
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            exec(compile(textwrap.dedent(block), '<actual-window-envelope>', 'exec'), {  # noqa: S102
                'result': SimpleNamespace(stdout='\n'.join(json.dumps(row) for row in rows)),
                'window': True, 'resource': 'dashboard', 'json': json, 're': re, 'datetime': datetime,
            })
        return [json.loads(line) for line in output.getvalue().splitlines()]

    def test_actual_operator_accepts_window_envelope_and_rejects_private_summary_fields(self):
        rows = self.run_window()
        self.assertEqual(self.validate_window(rows), rows)
        rows[-1]['PRIVATE'] = 'SECRET'
        with self.assertRaises(AssertionError):
            self.validate_window(rows)

    def run_window(self, fail_one=False):
        source = ast.literal_eval(re.search(r'^            code=(.*)$',
            (ROOT / '.github/workflows/ci.yml').read_text().split('  api-timing:', 1)[1], re.MULTILINE)[1])
        calls = []
        def reply(*args, **kwargs):
            calls.append(kwargs['timeout'])
            if fail_one and len(calls) == 2:
                raise TimeoutError
            stream = io.BytesIO(b'PRIVATE_SYNTHETIC_BODY')
            stream.status = 200
            stream.headers = {'x-aemr-data-state': 'ready'}
            return stream
        output = io.StringIO()
        with patch.object(sys, 'argv', ['probe', 'dashboard', 'window']), \
                patch.dict(os.environ, {'AEMR_API_KEY': 'SYNTHETIC_SECRET'}), \
                patch('urllib.request.urlopen', side_effect=reply), patch('time.sleep') as pause, \
                contextlib.redirect_stdout(output):
            exec(compile(source, '<reviewed-api-timing-window>', 'exec'), {})  # noqa: S102
        rows = [json.loads(line) for line in output.getvalue().splitlines()]
        self.assertNotIn('PRIVATE_SYNTHETIC_BODY', output.getvalue())
        self.assertNotIn('SYNTHETIC_SECRET', output.getvalue())
        self.assertTrue(all(0 < value <= 5 for value in calls))
        self.assertTrue(all(0 <= call.args[0] <= 1 for call in pause.call_args_list))
        return rows

    def test_latency_window_counts_twenty_reads_and_declares_sample_method(self):
        rows = self.run_window()
        self.assertEqual(len(rows), 21)
        summary = rows[-1]
        self.assertEqual(summary['attempted'], 20)
        self.assertEqual(summary['successful'], 20)
        self.assertEqual(summary['failed'], 0)
        self.assertEqual(summary['quantile_method'], 'nearest_rank')
        self.assertIsInstance(summary['p95_within_sample_seconds'], float)
        durations = sorted(row['elapsed_seconds'] for row in rows[:-1])
        self.assertEqual(summary['p95_within_sample_seconds'], durations[18])
        self.assertEqual(summary['p50_within_sample_seconds'], durations[9])
        self.assertFalse(summary['production_slo_accepted'])

    def test_failed_window_sample_is_kept_and_cannot_get_a_success_only_p95(self):
        rows = self.run_window(fail_one=True)
        self.assertEqual(rows[-1]['attempted'], 20)
        self.assertEqual(rows[-1]['successful'], 19)
        self.assertEqual(rows[-1]['failed'], 1)
        self.assertIsNone(rows[-1]['p95_within_sample_seconds'])
        self.assertEqual(sum(rows[-1]['data_states'].values()), 20)

    def test_window_deadline_stops_before_another_read_and_has_no_quantile(self):
        source = ast.literal_eval(re.search(r'^            code=(.*)$',
            (ROOT / '.github/workflows/ci.yml').read_text().split('  api-timing:', 1)[1], re.MULTILINE)[1])
        output = io.StringIO()
        with patch.object(sys, 'argv', ['probe', 'dashboard', 'window']), \
                patch('time.monotonic', side_effect=[0, 61, 61]), \
                patch('urllib.request.urlopen') as request, contextlib.redirect_stdout(output):
            exec(compile(source, '<reviewed-api-timing-deadline>', 'exec'), {})  # noqa: S102
        request.assert_not_called()
        summary = json.loads(output.getvalue())
        self.assertEqual(summary['attempted'], 0)
        self.assertIsNone(summary['p95_within_sample_seconds'])

    def run_client(self, fail=False):
        workflow = (ROOT / '.github/workflows/ci.yml').read_text()
        section = workflow.split('  api-timing:', 1)[1]
        source = ast.literal_eval(re.search(r'^            code=(.*)$', section, re.MULTILINE)[1])
        response = io.BytesIO(b'PRIVATE_SYNTHETIC_BODY')
        response.status = 200
        response.headers = {'x-aemr-data-state': 'ready', 'Server-Timing': 'app;dur=120.5, reader;dur=90, loop;dur=4, private;dur=PRIVATE_SYNTHETIC_BODY'}
        output = io.StringIO()
        before = datetime.now(timezone.utc)
        with patch.object(sys, 'argv', ['probe', 'report']), patch.dict(os.environ, {'AEMR_API_KEY': 'SYNTHETIC_SECRET'}), \
                patch('urllib.request.urlopen', side_effect=TimeoutError if fail else lambda *a, **kw: response), \
                contextlib.redirect_stdout(output):
            # Each successful request needs an independently readable/closable stream.
            if not fail:
                def reply(*args, **kwargs):
                    stream = io.BytesIO(b'PRIVATE_SYNTHETIC_BODY')
                    stream.status = response.status
                    stream.headers = response.headers
                    return stream
                with patch('urllib.request.urlopen', side_effect=reply):
                    exec(compile(source, '<reviewed-api-timing-client>', 'exec'), {})  # noqa: S102 — repository-owned client, synthetic transport.
            else:
                exec(compile(source, '<reviewed-api-timing-client>', 'exec'), {})  # noqa: S102 — repository-owned client, synthetic transport.
        after = datetime.now(timezone.utc)
        rows = [json.loads(line) for line in output.getvalue().splitlines()]
        self.assertEqual(len(rows), 2)
        for row in rows:
            self.assertLessEqual(before, datetime.fromisoformat(row['started_at']))
            self.assertLessEqual(datetime.fromisoformat(row['started_at']), datetime.fromisoformat(row['ended_at']))
            self.assertLessEqual(datetime.fromisoformat(row['ended_at']), after)
            self.assertGreaterEqual(row['elapsed_seconds'], 0)
            self.assertEqual(row['endpoint'], 'report')
        self.assertNotIn('SYNTHETIC_SECRET', output.getvalue())
        self.assertNotIn('PRIVATE_SYNTHETIC_BODY', output.getvalue())
        return rows

    def test_each_success_has_its_own_real_window_and_content_digest(self):
        for row in self.run_client():
            self.assertEqual(row['response_sha256'], hashlib.sha256(b'PRIVATE_SYNTHETIC_BODY').hexdigest())
            self.assertEqual(row['bytes'], 22)
            self.assertEqual(row['server_timing_ms'], {'app': 120.5, 'reader': 90.0, 'loop': 4.0})

    def test_timeouts_keep_a_measured_failed_window(self):
        for row in self.run_client(fail=True):
            self.assertEqual(row['error_code'], 'TIMEOUT_40S')
            self.assertNotIn('http_status', row)


if __name__ == '__main__':
    unittest.main()
