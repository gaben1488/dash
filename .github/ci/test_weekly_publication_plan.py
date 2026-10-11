"""Use a real private catalog; no production data or VPS access."""
import importlib.util
import json
import sqlite3
import subprocess
import sys
import tempfile
import textwrap
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[2] / 'deploy' / 'plan-weekly-publications.py'


class WeeklyPublicationPlanTests(unittest.TestCase):
    def load_tool(self):
        self.assertTrue(SCRIPT.is_file(), 'Missing weekly publication planner')
        sys.path.insert(0, str(SCRIPT.parents[1] / 'packages/report-engine/src'))
        spec = importlib.util.spec_from_file_location('weekly_plan', SCRIPT)
        tool = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(tool)
        return tool

    def fixture(self, root):
        published = root / 'published'
        (published / 'releases').mkdir(parents=True)
        with sqlite3.connect(published / 'publications.sqlite') as db:
            db.execute('CREATE TABLE publications (release_id TEXT PRIMARY KEY, report_date TEXT, cutoff_at TEXT, receipt TEXT, files TEXT)')
        return published

    def add(self, published, n, day, *, archived=False):
        rid = 'REL-' + f'{n:064x}'
        folder = published / 'releases' / rid
        folder.mkdir()
        (folder / 'data.json').write_bytes(b'x' * 100)
        receipt = {'release_id': rid, 'report_date': '.'.join(reversed(day.split('-'))),
                   'cutoff_at': day + 'T08:00:00+00:00', 'snapshot_id': 'SNAP-' + str(n)}
        if archived:
            receipt['archive_origin'] = {'source': 'historical'}
        with sqlite3.connect(published / 'publications.sqlite') as db:
            db.execute('INSERT INTO publications VALUES (?,?,?,?,?)', (rid, day, receipt['cutoff_at'], json.dumps(receipt), '{}'))
        return rid

    def test_weekly_control_and_two_latest_are_retained_without_catalog_writes(self):
        tool = self.load_tool()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            published = self.fixture(root)
            daily = self.add(published, 1, '2026-09-28')
            thursday = self.add(published, 2, '2026-10-01')
            friday = self.add(published, 3, '2026-10-02')
            latest = self.add(published, 4, '2026-10-10')
            previous = self.add(published, 5, '2026-10-09')
            before = (published / 'publications.sqlite').read_bytes()
            result = tool.plan(root)
            self.assertEqual(result['retire_release_ids'], sorted([daily, thursday]))
            self.assertEqual(set(result['keep_release_ids']), {friday, latest, previous})
            self.assertEqual(result['bytes_reclaimable'], 200)
            self.assertEqual((published / 'publications.sqlite').read_bytes(), before)
            self.assertTrue((published / 'releases' / daily / 'data.json').exists())

    def test_archival_origin_and_status_selected_release_are_protected(self):
        tool = self.load_tool()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            published = self.fixture(root)
            older = self.add(published, 1, '2026-09-28')
            archive = self.add(published, 2, '2026-09-29', archived=True)
            for n in range(3, 8):
                self.add(published, n, f'2026-10-{n:02d}')
            (root / 'status.json').write_text(json.dumps({'publication': {'release_id': older}}))
            result = tool.plan(root)
            self.assertIn(older, result['keep_release_ids'])
            self.assertIn(archive, result['keep_release_ids'])

    def test_malformed_catalog_or_link_refuses_a_plan(self):
        tool = self.load_tool()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            published = self.fixture(root)
            rid = self.add(published, 1, '2026-10-01')
            (published / 'releases' / rid / 'escape').symlink_to(root)
            with self.assertRaises(ValueError):
                tool.plan(root)

    def test_exact_workflow_bootstrap_executes_candidate_and_emits_only_aggregates(self):
        workflow = SCRIPT.parents[1] / '.github/workflows/vps-cache-cleanup.yml'
        source = workflow.read_text().split("<<'PYPROBE'\n", 1)[1].split('            PYPROBE', 1)[0]
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            published = self.fixture(root)
            rid = self.add(published, 1, '2026-10-01')
            output = root / 'probe.py'
            subprocess.run([sys.executable, '-', str(SCRIPT.parents[1] / 'packages/report-engine/src/procurement_engine/readonly_catalog.py'), str(SCRIPT), str(output)],
                           input=textwrap.dedent(source), text=True, check=True, capture_output=True)
            result = subprocess.run([sys.executable, str(output), '--state', str(root)],
                                    text=True, capture_output=True, check=False)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(json.loads(result.stdout)['publication_count'], 1)
            self.assertNotIn(rid, result.stdout)
            self.assertNotIn('keep_release_ids', result.stdout)

    def test_multiple_releases_of_one_snapshot_do_not_duplicate_identity_defects(self):
        tool = self.load_tool()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            published = self.fixture(root)
            first = self.add(published, 1, '2026-09-28')
            second = self.add(published, 2, '2026-09-29')
            for n in range(3, 6):
                self.add(published, n, f'2026-10-{n-2:02d}')
            with sqlite3.connect(published / 'publications.sqlite') as db:
                receipt = json.loads(db.execute('SELECT receipt FROM publications WHERE release_id=?', (second,)).fetchone()[0])
                receipt['snapshot_id'] = 'SNAP-1'
                db.execute('UPDATE publications SET receipt=? WHERE release_id=?', (json.dumps(receipt), second))
            with sqlite3.connect(root / 'identity.sqlite') as db:
                db.execute('CREATE TABLE observations (snapshot_id TEXT, plan_signature TEXT, entity_signature TEXT)')
                db.executemany('INSERT INTO observations VALUES (?,?,?)', [('SNAP-1', None, None), ('SNAP-3', 'valid', 'valid')])
            result = tool.plan(root)
            self.assertIn(first, result['retire_release_ids'])
            self.assertIn(second, result['retire_release_ids'])
            self.assertEqual(result['identity_missing_signatures'], 1)

    def test_absent_identity_observations_cannot_be_reported_ready(self):
        tool = self.load_tool()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            published = self.fixture(root)
            for n in range(1, 5):
                self.add(published, n, f'2026-10-{n:02d}')
            with sqlite3.connect(root / 'identity.sqlite') as db:
                db.execute('CREATE TABLE observations (snapshot_id TEXT, plan_signature TEXT, entity_signature TEXT)')
            result = tool.plan(root)
            self.assertFalse(result['identity_ready'])
            self.assertGreater(result['identity_missing_snapshots'], 0)

    def test_live_wal_databases_do_not_gain_shared_memory_files(self):
        tool = self.load_tool()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            published = self.fixture(root)
            self.add(published, 1, '2026-10-01')
            path = published / 'publications.sqlite'
            writer = sqlite3.connect(path)
            writer.execute('PRAGMA journal_mode=WAL')
            writer.execute('PRAGMA wal_autocheckpoint=0')
            writer.execute("UPDATE publications SET files='{}'")
            writer.commit()
            wal = path.with_name(path.name + '-wal')
            frozen_db, frozen_wal = path.read_bytes(), wal.read_bytes()
            writer.close()
            path.write_bytes(frozen_db)
            wal.write_bytes(frozen_wal)
            shm = path.with_name(path.name + '-shm')
            self.assertFalse(shm.exists())
            tool.plan(root)
            self.assertFalse(shm.exists(), 'readonly census created production SHM')

    def test_missing_identity_signatures_are_exposed_as_deletion_blocker(self):
        tool = self.load_tool()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            published = self.fixture(root)
            for n in range(1, 5):
                self.add(published, n, f'2026-10-{n:02d}')
            with sqlite3.connect(root / 'identity.sqlite') as db:
                db.execute('CREATE TABLE observations (snapshot_id TEXT, plan_signature TEXT, entity_signature TEXT)')
                db.execute('INSERT INTO observations VALUES (?,?,?)', ('SNAP-1', None, None))
            result = tool.plan(root)
            self.assertGreater(result['identity_missing_signatures'], 0)
            self.assertFalse(result['identity_ready'])


if __name__ == '__main__':
    unittest.main()
