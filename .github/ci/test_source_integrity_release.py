"""Production SQLite-backup release gate: no live VPS or Google access."""
from __future__ import annotations

import importlib.util
from pathlib import Path
import sqlite3
from tempfile import TemporaryDirectory
import unittest

MODULE = Path(__file__).resolve().parents[2] / "deploy" / "source-integrity-release.py"
spec = importlib.util.spec_from_file_location("source_integrity_release", MODULE)
assert spec is not None and spec.loader is not None
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)
SHA = "a" * 40


class IntegrityReleaseBackupTests(unittest.TestCase):
    def test_live_wal_backup_preserves_committed_rows_without_stopping_writer(self):
        with TemporaryDirectory() as directory:
            root = Path(directory)
            path = root / "aemr.db"
            with sqlite3.connect(path) as writer:
                writer.execute("PRAGMA journal_mode = WAL")
                writer.execute("CREATE TABLE snapshots (id TEXT PRIMARY KEY)")
                writer.execute("INSERT INTO snapshots VALUES ('first')")
                writer.commit()
                # Keep the source connection open throughout the online backup.
                copy = release.online_backup(path, root / "backups", SHA)
                self.assertTrue(copy.is_file())
                self.assertEqual(copy.stat().st_mode & 0o777, 0o600)
                with sqlite3.connect(copy) as checkpoint:
                    self.assertEqual(
                        checkpoint.execute("PRAGMA quick_check").fetchone(), ("ok",)
                    )
                    self.assertEqual(
                        checkpoint.execute("SELECT id FROM snapshots").fetchall(),
                        [("first",)],
                    )
                writer.execute("INSERT INTO snapshots VALUES ('after')")
                writer.commit()
                with sqlite3.connect(copy) as checkpoint:
                    self.assertEqual(
                        checkpoint.execute("SELECT count(*) FROM snapshots").fetchone(),
                        (1,),
                    )

    def test_fails_before_mutating_disk_when_space_is_insufficient(self):
        with TemporaryDirectory() as directory:
            root = Path(directory)
            db = root / "aemr.db"
            with sqlite3.connect(db) as conn:
                conn.execute("CREATE TABLE snapshots (id TEXT)")
            with self.assertRaisesRegex(release.ReleaseGateError, "insufficient free space"):
                release.online_backup(db, root / "backups", SHA, free_bytes=0)
            self.assertFalse((root / "backups").exists())

    def test_never_backups_wrong_database_or_invalid_commit(self):
        with TemporaryDirectory() as directory:
            root = Path(directory)
            db = root / "wrong.db"
            with sqlite3.connect(db) as conn:
                conn.execute("CREATE TABLE random_table (id TEXT)")
            with self.assertRaisesRegex(release.ReleaseGateError, "Dash database"):
                release.online_backup(db, root / "backups", SHA)
            with self.assertRaisesRegex(release.ReleaseGateError, "invalid release commit"):
                release.online_backup(db, root / "backups", "invalid")
            self.assertEqual(list((root / "backups").glob("*")), [])

    def test_missing_source_is_fail_closed(self):
        with TemporaryDirectory() as directory:
            root = Path(directory)
            with self.assertRaisesRegex(release.ReleaseGateError, "not found"):
                release.online_backup(root / "missing.db", root / "backup", SHA)


if __name__ == "__main__":
    unittest.main()
