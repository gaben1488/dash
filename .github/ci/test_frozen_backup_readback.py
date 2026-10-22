"""Archive diagnostics use disposable database families, never the live volume."""
import importlib.util
import sqlite3
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class FrozenBackupReadbackTests(unittest.TestCase):
    def setUp(self):
        script = ROOT / '.github/ci/frozen_backup_readback.py'
        self.assertTrue(script.is_file(), 'Missing bounded archive-only restore diagnostics')
        self.reader = load('frozen_readback', script)
        fixture = load('backup_fixture', ROOT / '.github/ci/test_stateful_backup.py').StatefulBackupTests('test_generated_archive_and_manifest_are_private_under_container_umasks')
        fixture.setUp()
        self.addCleanup(fixture.doCleanups)
        self.fixture = fixture

    def run_readback(self):
        f = self.fixture
        f.module.create(f.source, f.backup, compressed=True, compression_level=1)
        before = f.module.inventory(f.source)
        saved = {p.name: p.read_bytes() for p in f.backup.iterdir() if p.is_file()}
        progress = {}
        try:
            return self.reader.validate_archive(f.module, f.backup, f.scratch, progress), progress
        finally:
            self.assertEqual(before, f.module.inventory(f.source))
            self.assertEqual(saved, {p.name: p.read_bytes() for p in f.backup.iterdir() if p.is_file()})
            self.assertEqual(list(f.scratch.iterdir()), [])

    def test_valid_wal_family_is_checked_without_changing_frozen_bytes(self):
        path = self.fixture.source / 'reports/ledger.sqlite'
        with sqlite3.connect(path) as db:
            db.execute('pragma journal_mode=wal')
            db.execute('create table records(value text)')
            db.execute("insert into records values ('only in WAL')")
            db.commit()
            self.assertTrue(Path(str(path) + '-wal').is_file())
            result, _ = self.run_readback()
        self.assertEqual(result['sqlite_checked'], 2)
        self.assertEqual(result['docx_checked'], 1)
        self.assertGreater(result['files_checked'], 5)

    def test_valid_archive_with_invalid_sqlite_names_the_failed_boundary(self):
        (self.fixture.source / 'reports/broken.sqlite').write_bytes(b'not a SQLite file')
        with self.assertRaisesRegex(ValueError, '^BACKUP_SQLITE_INVALID$'):
            self.run_readback()

    def test_valid_archive_with_invalid_docx_names_the_failed_boundary(self):
        (self.fixture.source / 'reports/broken.docx').write_bytes(b'not a DOCX file')
        with self.assertRaisesRegex(ValueError, '^BACKUP_DOCX_INVALID$'):
            self.run_readback()


if __name__ == '__main__':
    unittest.main()
