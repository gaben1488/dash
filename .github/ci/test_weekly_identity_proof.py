"""Verify retention recovery on scratch SQLite; production is never a write target."""
import importlib.util
import io
import sqlite3
import sys
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path[:0] = [str(ROOT / 'packages/report-engine/src'), str(ROOT / 'packages/report-engine/tests')]
from procurement_engine.identity_store import IdentityStore
from test_identity_and_metrics import row
from test_weekly_publication_plan import WeeklyPublicationPlanTests


class WeeklyIdentityProofTests(unittest.TestCase):
    def tool(self):
        path = ROOT / 'deploy/prove-weekly-identity-recovery.py'
        self.assertTrue(path.exists(), 'Missing scratch identity proof')
        spec = importlib.util.spec_from_file_location('identity_proof', path)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module

    def test_cli_failure_never_exposes_private_locator(self):
        tool = self.tool()
        def unavailable(_):
            raise ValueError('PRIVATE_LOCATOR/payload-secret.json')
        tool.prove = unavailable
        out, err = io.StringIO(), io.StringIO()
        with redirect_stdout(out), redirect_stderr(err):
            status = tool.main(['--state', 'synthetic'])
        self.assertEqual(status, 2)
        self.assertNotIn('PRIVATE_LOCATOR', out.getvalue() + err.getvalue())
        self.assertEqual(err.getvalue(), '')

    def fixture(self, root):
        helper = WeeklyPublicationPlanTests()
        published = helper.fixture(root)
        identity = IdentityStore(root / 'identity.sqlite')
        for n in range(1, 5):
            helper.add(published, n, f'2026-10-{n:02d}')
            identity.ingest([row(snapshot_id='SNAP-' + str(n))], snapshot_id='SNAP-' + str(n), captured_at=f'2026-10-{n:02d}T00:00:00Z')
        return identity

    def test_complete_identity_proof_preserves_live_database_bytes(self):
        tool = self.tool()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            identity = self.fixture(root)
            before = identity.path.read_bytes()
            result = tool.prove(root)
            self.assertEqual(result['status'], 'SCRATCH_IDENTITY_PASS')
            self.assertEqual(result['unrecovered_snapshots'], 0)
            self.assertEqual(identity.path.read_bytes(), before)
            self.assertFalse(any(root.glob('retention-proof-*')))

    def test_missing_historical_donor_never_passes_or_updates_live_identity(self):
        tool = self.tool()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            identity = self.fixture(root)
            with sqlite3.connect(identity.path) as db:
                db.execute("UPDATE observations SET plan_signature=NULL WHERE snapshot_id='SNAP-1'")
            before = identity.path.read_bytes()
            result = tool.prove(root)
            self.assertEqual(result['status'], 'SCRATCH_IDENTITY_BLOCKED')
            self.assertGreater(result['unrecovered_snapshots'], 0)
            self.assertEqual(identity.path.read_bytes(), before)


if __name__ == '__main__':
    unittest.main()
