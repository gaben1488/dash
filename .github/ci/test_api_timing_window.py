"""Run the real bounded diagnostic client against synthetic HTTP responses."""
import ast
import contextlib
import hashlib
import io
import json
import os
import re
import sys
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]


class TimingWindowTests(unittest.TestCase):
    def run_client(self, fail=False):
        workflow = (ROOT / '.github/workflows/ci.yml').read_text()
        section = workflow.split('  api-timing:', 1)[1]
        source = ast.literal_eval(re.search(r'^            code=(.*)$', section, re.MULTILINE)[1])
        response = io.BytesIO(b'PRIVATE_SYNTHETIC_BODY')
        response.status = 200
        response.headers = {'x-aemr-data-state': 'ready'}
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

    def test_timeouts_keep_a_measured_failed_window(self):
        for row in self.run_client(fail=True):
            self.assertEqual(row['error_code'], 'TIMEOUT_40S')
            self.assertNotIn('http_status', row)


if __name__ == '__main__':
    unittest.main()
