"""Tests for a full, off-volume report state copy and scratch recovery.

Only synthetic SQLite, JSON and DOCX are created; never contacts the VPS.
"""
import json
import sqlite3
import subprocess
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path


SCRIPT = Path(__file__).resolve().parents[2] / "deploy" / "stateful_backup.py"


class StatefulBackupTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        root = Path(self.temp.name)
        self.source = root / "live"
        self.backup = root / "backup"
        self.scratch = root / "scratch"
        self.scratch.mkdir()
        (self.source / "reports" / "inputs").mkdir(parents=True)
        release = self.source / "reports" / "published" / "releases" / "REL-synthetic"
        release.mkdir(parents=True)
        with sqlite3.connect(self.source / "aemr.db") as db:
            db.execute("create table receipt (id text primary key, value integer)")
            db.execute("insert into receipt values ('source-row', 17)")
        (self.source / "reports" / "inputs" / "registry.json").write_text(
            '{"sources": []}', encoding="utf-8")
        (self.source / "reports" / "inputs" / "ledger.json").write_text(
            '{"history": []}', encoding="utf-8")
        (self.source / "reports" / "attempts").mkdir()
        (self.source / "reports" / "attempts" / "binary.dat").write_bytes(b"\x00\xff\x01")
        with zipfile.ZipFile(release / "main_report.docx", "w") as word:
            word.writestr("word/document.xml", "<document><p>synthetic</p></document>")
        (self.source / "reports" / "published" / ".hidden").write_text("preserved")

    def run_cli(self, command, *args):
        return subprocess.run(
            [sys.executable, str(SCRIPT), command, *map(str, args)],
            text=True, capture_output=True, timeout=25, check=False)

    def test_complete_archive_and_independent_scratch_restore(self):
        before = sorted(str(p.relative_to(self.source))
                        for p in self.source.rglob("*") if p.is_file())
        done = self.run_cli("create", "--source", self.source, "--backup", self.backup)
        self.assertEqual(done.returncode, 0, done.stderr)
        receipt = json.loads(done.stdout)
        self.assertGreaterEqual(receipt["files"], len(before))
        self.assertGreater(receipt["bytes"], 0)
        self.assertTrue((self.backup / "manifest.json").is_file())
        self.assertTrue((self.backup / "state" / "aemr.db").is_file())
        self.assertFalse((self.source / "manifest.json").exists())
        restored = self.run_cli("verify", "--backup", self.backup,
                                "--scratch-parent", self.scratch)
        self.assertEqual(restored.returncode, 0, restored.stderr)
        verified = json.loads(restored.stdout)
        self.assertEqual(verified["state"], "VERIFIED_IN_SCRATCH")
        self.assertGreaterEqual(verified["sqlite_checked"], 1)
        self.assertGreaterEqual(verified["docx_checked"], 1)
        self.assertEqual(before, sorted(str(p.relative_to(self.source))
                        for p in self.source.rglob("*") if p.is_file()))
        self.assertEqual(list(self.scratch.iterdir()), [])  # Scratch auto-cleaned.

    def test_refuses_backup_destination_inside_live_state(self):
        target = self.source / "bad-backup"
        result = self.run_cli("create", "--source", self.source, "--backup", target)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("BACKUP_PATH_OVERLAP", result.stderr)
        self.assertFalse(target.exists())

    def test_refuses_missing_required_state(self):
        (self.source / "reports" / "inputs" / "ledger.json").unlink()
        result = self.run_cli("create", "--source", self.source, "--backup", self.backup)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("BACKUP_STATE_INCOMPLETE", result.stderr)
        self.assertFalse(self.backup.exists())

    def test_refuses_symlinks_and_unknown_files(self):
        (self.source / "escape").symlink_to(self.source / "aemr.db")
        result = self.run_cli("create", "--source", self.source, "--backup", self.backup)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("BACKUP_UNSAFE_FILE", result.stderr)

    def test_detects_modified_backup_data(self):
        done = self.run_cli("create", "--source", self.source, "--backup", self.backup)
        self.assertEqual(done.returncode, 0, done.stderr)
        (self.backup / "state" / "reports" / "inputs" / "ledger.json").write_text("{}")
        verify = self.run_cli("verify", "--backup", self.backup,
                              "--scratch-parent", self.scratch)
        self.assertNotEqual(verify.returncode, 0)
        self.assertIn("BACKUP_MISMATCH", verify.stderr)
        self.assertEqual(list(self.scratch.iterdir()), [])


if __name__ == "__main__":
    unittest.main()
