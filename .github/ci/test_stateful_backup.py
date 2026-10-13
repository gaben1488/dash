"""Tests for a full, off-volume report state copy and scratch recovery.

Only synthetic SQLite, JSON and DOCX are created; never contacts the VPS.
"""
import importlib.util
import json
import sqlite3
import subprocess
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch

SCRIPT = Path(__file__).resolve().parents[2] / "deploy" / "stateful_backup.py"


class StatefulBackupTests(unittest.TestCase):
    def setUp(self):
        spec = importlib.util.spec_from_file_location("release_capacity_tool", SCRIPT)
        self.module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.module)
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

    def full_backup(self, compressed=True):
        import hashlib
        self.module.create(self.source,self.backup,compressed=compressed)
        self.module.verify(self.backup,self.scratch)
        return hashlib.sha256((self.backup/'manifest.json').read_bytes()).hexdigest()

    def test_full_in_place_restore_matches_every_file_and_leaves_backup_immutable(self):
        for compressed in (True,False):
            if self.backup.exists():
                import shutil
                shutil.rmtree(self.backup)
            digest=self.full_backup(compressed)
            expected=self.module.inventory(self.source)
            frozen={str(p.relative_to(self.backup)):p.read_bytes() for p in self.backup.rglob('*') if p.is_file()}
            with sqlite3.connect(self.source/'aemr.db') as db: db.execute('update receipt set value=99')
            (self.source/'extra').write_bytes(b'failed deploy')
            result=self.run_cli('restore-state','--backup',self.backup,'--source',self.source,'--verified-manifest-sha256',digest)
            self.assertEqual(result.returncode,0,result.stderr)
            self.assertEqual(json.loads(result.stdout)['state'],'STATE_RESTORED')
            self.assertEqual(self.module.inventory(self.source),expected)
            self.assertEqual({str(p.relative_to(self.backup)):p.read_bytes() for p in self.backup.rglob('*') if p.is_file()},frozen)
            with sqlite3.connect(self.source/'aemr.db') as db: self.assertEqual(db.execute('select value from receipt').fetchone()[0],17)

    def test_bad_verified_manifest_never_mutates_source(self):
        self.full_backup(); before=self.module.inventory(self.source)
        result=self.run_cli('restore-state','--backup',self.backup,'--source',self.source,'--verified-manifest-sha256','f'*64)
        self.assertNotEqual(result.returncode,0)
        self.assertIn('BACKUP_VERIFIED_MANIFEST_MISMATCH',result.stderr)
        self.assertEqual(self.module.inventory(self.source),before)

    def test_full_restore_rejects_bad_archive_before_delete(self):
        digest=self.full_backup(); before=self.module.inventory(self.source)
        archive=self.backup/'state.tar.gz'; archive.write_bytes(archive.read_bytes()[:-10])
        result=self.run_cli('restore-state','--backup',self.backup,'--source',self.source,'--verified-manifest-sha256',digest)
        self.assertNotEqual(result.returncode,0)
        self.assertEqual(self.module.inventory(self.source),before)

    def test_full_restore_rejects_source_symlinks_and_overlap(self):
        digest=self.full_backup(); (self.source/'link').symlink_to(self.backup)
        frozen=(self.backup/'manifest.json').read_bytes()
        for source in (self.source,self.backup,self.backup/'state'):
            result=self.run_cli('restore-state','--backup',self.backup,'--source',source,'--verified-manifest-sha256',digest)
            self.assertNotEqual(result.returncode,0)
        self.assertTrue((self.source/'link').is_symlink())
        self.assertEqual((self.backup/'manifest.json').read_bytes(),frozen)

    def test_interrupted_restore_is_repeatable_without_second_full_copy(self):
        digest=self.full_backup(); expected=self.module.inventory(self.source)
        original=self.module.shutil.copyfileobj
        calls=[0]
        def interrupt(*args,**kwargs):
            original(*args,**kwargs); calls[0]+=1
            if calls[0]==2: raise OSError('synthetic interrupted write')
        with patch.object(self.module.shutil,'copyfileobj',side_effect=interrupt), self.assertRaises(OSError):
            self.module.restore_state(self.backup,self.source,digest)
        self.assertNotEqual(self.module.inventory(self.source,require_complete=False),expected)
        self.module.restore_state(self.backup,self.source,digest)
        self.assertEqual(self.module.inventory(self.source),expected)

    def test_full_restore_preserves_uncheckpointed_wal_and_exact_sidecars(self):
        connection=sqlite3.connect(self.source/'aemr.db')
        connection.execute('pragma journal_mode=wal'); connection.execute('pragma wal_autocheckpoint=0')
        connection.execute('update receipt set value=33'); connection.commit()
        try: digest=self.full_backup(); expected=self.module.inventory(self.source)
        finally: connection.close()
        self.assertIn('aemr.db-wal',expected)
        self.module.restore_state(self.backup,self.source,digest)
        self.assertEqual(self.module.inventory(self.source),expected)
        with sqlite3.connect((self.source/'aemr.db').as_uri()+'?mode=ro',uri=True) as db:
            self.assertEqual(db.execute('select value from receipt').fetchone()[0],33)

    def test_full_restore_preserves_modes_and_owner(self):
        import os
        target=self.source/'reports/attempts/binary.dat'; target.chmod(0o2755)
        if os.geteuid()==0: os.chown(target,1000,1000); target.chmod(0o2755)
        digest=self.full_backup(); expected=self.module.inventory(self.source)
        with patch.object(self.module.os,'geteuid',return_value=0):
            self.module.restore_state(self.backup,self.source,digest)
        self.assertEqual(self.module.inventory(self.source),expected)

    def test_full_restore_checks_net_capacity_before_deleting(self):
        from types import SimpleNamespace
        digest=self.full_backup(); expected=self.module.inventory(self.source)
        with patch.object(self.module.shutil,'disk_usage',return_value=SimpleNamespace(free=0)), self.assertRaisesRegex(self.module.BackupError,'BACKUP_STORAGE_INSUFFICIENT'):
            self.module.restore_state(self.backup,self.source,digest)
        self.assertEqual(self.module.inventory(self.source),expected)
        # Reclaiming existing state permits in-place recovery without another complete copy.
        with patch.object(self.module.shutil,'disk_usage',return_value=SimpleNamespace(free=128*1024*1024)):
            self.module.restore_state(self.backup,self.source,digest)
        self.assertEqual(self.module.inventory(self.source),expected)

    def test_unsafe_full_archive_paths_rejected_even_with_recomputed_hashes(self):
        import hashlib
        import io
        import tarfile
        self.full_backup(); before=self.module.inventory(self.source)
        archive=self.backup/'state.tar.gz'
        with tarfile.open(archive,'w:gz') as stream:
            member=tarfile.TarInfo('../escape'); member.size=3; stream.addfile(member,io.BytesIO(b'bad'))
        manifest=self.backup/'manifest.json'; x=json.loads(manifest.read_bytes())
        x.update(archive_sha256=hashlib.sha256(archive.read_bytes()).hexdigest(),archive_bytes=archive.stat().st_size)
        manifest.write_text(json.dumps(x)); digest=hashlib.sha256(manifest.read_bytes()).hexdigest()
        with self.assertRaisesRegex(self.module.BackupError,'BACKUP_UNSAFE_FILE'):
            self.module.restore_state(self.backup,self.source,digest)
        self.assertEqual(self.module.inventory(self.source),before)

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

    def test_report_only_recovery_preserves_new_core_data_and_removes_failed_attempt(self):
        import hashlib
        with sqlite3.connect(self.source / 'reports/identity.sqlite') as db:
            db.execute('create table identity (id integer)')
        made = self.run_cli('create', '--compressed', '--source', self.source, '--backup', self.backup)
        self.assertEqual(made.returncode, 0, made.stderr)
        verified = hashlib.sha256((self.backup / 'manifest.json').read_bytes()).hexdigest()
        with sqlite3.connect(self.source / 'aemr.db') as db:
            db.execute('update receipt set value=31')
        protected = (self.source / 'aemr.db').read_bytes()
        matched = self.run_cli('match-reports', '--source', self.source, '--backup', self.backup)
        self.assertEqual(matched.returncode, 0, matched.stderr)
        (self.source / 'reports/inputs/ledger.json').write_text('changed')
        failed = self.source / 'reports/failed-new'
        failed.mkdir()
        (failed / 'status.json').write_text('{"status":"NOT_ISSUED"}')
        stale = self.run_cli('match-reports', '--source', self.source, '--backup', self.backup)
        self.assertNotEqual(stale.returncode, 0)
        restored = self.run_cli('restore-reports', '--source', self.source, '--backup', self.backup,
                                '--verified-manifest-sha256', verified)
        self.assertEqual(restored.returncode, 0, restored.stderr)
        self.assertEqual((self.source / 'aemr.db').read_bytes(), protected)
        self.assertFalse(failed.exists())
        self.assertEqual((self.source / 'reports/inputs/ledger.json').read_text(), '{"history": []}')
        matched = self.run_cli('match-reports', '--source', self.source, '--backup', self.backup)
        self.assertEqual(matched.returncode, 0, matched.stderr)

    def test_report_restore_refuses_unverified_or_corrupt_backup_before_deleting(self):
        made = self.run_cli('create', '--compressed', '--source', self.source, '--backup', self.backup)
        self.assertEqual(made.returncode, 0, made.stderr)
        original = (self.source / 'reports/inputs/ledger.json').read_bytes()
        invalid = self.run_cli('restore-reports', '--source', self.source, '--backup', self.backup,
                              '--verified-manifest-sha256', '0' * 64)
        self.assertNotEqual(invalid.returncode, 0)
        self.assertIn('BACKUP_VERIFIED_MANIFEST_MISMATCH', invalid.stderr)
        import hashlib
        verified = hashlib.sha256((self.backup / 'manifest.json').read_bytes()).hexdigest()
        with (self.backup / 'state.tar.gz').open('ab') as stream:
            stream.write(b'corrupt')
        invalid = self.run_cli('restore-reports', '--source', self.source, '--backup', self.backup,
                              '--verified-manifest-sha256', verified)
        self.assertNotEqual(invalid.returncode, 0)
        self.assertEqual((self.source / 'reports/inputs/ledger.json').read_bytes(), original)

    def test_full_backup_has_independent_worker_scope_rollback_drill(self):
        with sqlite3.connect(self.source / 'reports/identity.sqlite') as db:
            db.execute('create table identity (id integer)')
        made = self.run_cli('create', '--compressed', '--source', self.source, '--backup', self.backup)
        self.assertEqual(made.returncode, 0, made.stderr)
        checked = self.run_cli('verify', '--backup', self.backup, '--scratch-parent', self.scratch,
                               '--trial-report-restore')
        self.assertEqual(checked.returncode, 0, checked.stderr)
        proof = json.loads(checked.stdout)
        self.assertEqual(proof['worker_scope_rollback'], 'PASS')
        self.assertEqual(proof['state'], 'VERIFIED_IN_SCRATCH')
        self.assertEqual(len(proof['manifest_sha256']), 64)
        self.assertEqual(list(self.scratch.iterdir()), [])

    def test_source_match_for_external_restore_is_not_a_restore_claim(self):
        created = self.run_cli('create', '--compressed', '--source', self.source, '--backup', self.backup)
        self.assertEqual(created.returncode, 0, created.stderr)
        result = self.run_cli('match-source', '--source', self.source, '--backup', self.backup)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout)['state'], 'SOURCE_MATCHED_ONLY')
        self.assertNotIn('VERIFIED_IN_SCRATCH', result.stdout)
        self.assertEqual(list(self.scratch.iterdir()), [])

    def test_source_match_blocks_changed_live_state_and_corrupt_backup(self):
        created = self.run_cli('create', '--compressed', '--source', self.source, '--backup', self.backup)
        self.assertEqual(created.returncode, 0, created.stderr)
        original = (self.source / 'reports/inputs/ledger.json').read_bytes()
        (self.source / 'reports/inputs/ledger.json').write_text('changed')
        result = self.run_cli('match-source', '--source', self.source, '--backup', self.backup)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('BACKUP_SOURCE_MISMATCH', result.stderr)
        (self.source / 'reports/inputs/ledger.json').write_bytes(original)
        with (self.backup / 'state.tar.gz').open('ab') as stream:
            stream.write(b'corrupt')
        result = self.run_cli('match-source', '--source', self.source, '--backup', self.backup)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('BACKUP_MISMATCH', result.stderr)

    def test_compressed_full_backup_restores_exact_state_and_metadata(self):
        (self.source / "reports" / "empty").mkdir()
        (self.source / "aemr.db").chmod(0o600)
        (self.source / "reports" / "attempts" / "large.json").write_text(
            json.dumps({"rows": [[i, "сохранённый оригинал"] for i in range(10000)]}),
            encoding="utf-8")
        done = self.run_cli("create", "--compressed", "--source", self.source,
                            "--backup", self.backup)
        self.assertEqual(done.returncode, 0, done.stderr)
        manifest = json.loads((self.backup / "manifest.json").read_text())
        self.assertEqual(manifest["format"], 2)
        self.assertFalse((self.backup / "state").exists())
        self.assertLess(manifest["archive_bytes"], manifest["bytes"] // 2)
        verified = self.run_cli("verify", "--backup", self.backup,
                                "--scratch-parent", self.scratch, "--source", self.source)
        self.assertEqual(verified.returncode, 0, verified.stderr)
        self.assertTrue(json.loads(verified.stdout)["source_matched"])
        self.assertEqual(list(self.scratch.iterdir()), [])

    def test_compressed_backup_corruption_does_not_authorize_restore(self):
        done = self.run_cli("create", "--compressed", "--source", self.source,
                            "--backup", self.backup)
        self.assertEqual(done.returncode, 0, done.stderr)
        archive = self.backup / "state.tar.gz"
        archive.write_bytes(archive.read_bytes()[:-8] + b"CORRUPT!")
        verified = self.run_cli("verify", "--backup", self.backup,
                                "--scratch-parent", self.scratch)
        self.assertNotEqual(verified.returncode, 0)
        self.assertIn("BACKUP_MISMATCH", verified.stderr)
        self.assertEqual(list(self.scratch.iterdir()), [])

    def test_restore_checks_uncompressed_capacity_before_writing_scratch(self):
        spec = importlib.util.spec_from_file_location("stateful_backup", SCRIPT)
        tool = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(tool)
        tool.create(self.source, self.backup, compressed=True)
        before = tool.inventory(self.source)
        with (patch.object(tool.shutil, "disk_usage",
                           return_value=type("Disk", (), {"free": 1})()),
              patch.object(tool, "_restore_compressed", wraps=tool._restore_compressed) as restore,
              self.assertRaisesRegex(tool.BackupError, "BACKUP_STORAGE_INSUFFICIENT")):
            tool.verify(self.backup, self.scratch, self.source)
        restore.assert_not_called()
        self.assertEqual(tool.inventory(self.source), before)
        self.assertEqual(list(self.scratch.iterdir()), [])

    def test_compressed_restore_refuses_archive_traversal_even_with_matching_hash(self):
        import hashlib
        import io
        import tarfile
        done = self.run_cli("create", "--compressed", "--source", self.source,
                            "--backup", self.backup)
        self.assertEqual(done.returncode, 0, done.stderr)
        archive = self.backup / "state.tar.gz"
        with tarfile.open(archive, "w:gz") as stream:
            member = tarfile.TarInfo("../escape")
            member.size = 3
            stream.addfile(member, io.BytesIO(b"bad"))
        manifest_path = self.backup / "manifest.json"
        manifest = json.loads(manifest_path.read_text())
        manifest.update(archive_sha256=hashlib.sha256(archive.read_bytes()).hexdigest(),
                        archive_bytes=archive.stat().st_size)
        manifest_path.write_text(json.dumps(manifest))
        verified = self.run_cli("verify", "--backup", self.backup,
                                "--scratch-parent", self.scratch)
        self.assertNotEqual(verified.returncode, 0)
        self.assertIn("BACKUP_UNSAFE_FILE", verified.stderr)
        self.assertFalse((self.scratch / "escape").exists())
        self.assertEqual(list(self.scratch.iterdir()), [])

    def test_refuses_backup_destination_inside_live_state(self):
        target = self.source / "bad-backup"
        result = self.run_cli("create", "--source", self.source, "--backup", target)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("BACKUP_PATH_OVERLAP", result.stderr)
        self.assertFalse(target.exists())

    def test_compressed_writer_respects_free_space_reserve_and_cleans_partial_archive(self):
        import os
        spec = importlib.util.spec_from_file_location("stateful_backup", SCRIPT)
        tool = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(tool)
        (self.source / "reports" / "attempts" / "noise").write_bytes(os.urandom(100000))
        before = tool.inventory(self.source)
        with (patch.object(tool.shutil, "disk_usage",
                           return_value=type("Disk", (), {"free": 128 * 1024 * 1024 + 1000})()),
              self.assertRaisesRegex(tool.BackupError, "BACKUP_STORAGE_INSUFFICIENT")):
            tool.create(self.source, self.backup, compressed=True)
        self.assertEqual(tool.inventory(self.source), before)
        self.assertFalse(self.backup.exists())
        self.assertEqual(list(self.backup.parent.glob(".aemr-backup-*")), [])

    def test_compressed_source_change_invalidates_the_complete_archive(self):
        spec = importlib.util.spec_from_file_location("stateful_backup", SCRIPT)
        tool = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(tool)
        compress = tool._compress_state
        def concurrent_change(*args):
            compress(*args)
            (self.source / "reports" / "inputs" / "ledger.json").write_text('{"changed":true}')
        with (patch.object(tool, "_compress_state", side_effect=concurrent_change),
              self.assertRaisesRegex(tool.BackupError, "SOURCE_CHANGED_DURING_BACKUP")):
            tool.create(self.source, self.backup, compressed=True)
        self.assertFalse(self.backup.exists())
        self.assertEqual(list(self.backup.parent.glob(".aemr-backup-*")), [])

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

    def test_release_verification_matches_current_source_without_writing_it(self):
        done = self.run_cli("create", "--source", self.source, "--backup", self.backup)
        self.assertEqual(done.returncode, 0, done.stderr)
        before = {p.relative_to(self.source): p.read_bytes()
                  for p in self.source.rglob("*") if p.is_file()}
        verified = self.run_cli("verify", "--backup", self.backup,
                                "--scratch-parent", self.scratch, "--source", self.source)
        self.assertEqual(verified.returncode, 0, verified.stderr)
        self.assertTrue(json.loads(verified.stdout)["source_matched"])
        self.assertEqual(before, {p.relative_to(self.source): p.read_bytes()
                                 for p in self.source.rglob("*") if p.is_file()})

    def test_release_rejects_intact_backup_of_older_source(self):
        done = self.run_cli("create", "--source", self.source, "--backup", self.backup)
        self.assertEqual(done.returncode, 0, done.stderr)
        # An intact historical backup remains usable for recovery, but must
        # not authorize a release after new ledger history has been recorded.
        (self.source / "reports" / "inputs" / "ledger.json").write_text(
            '{"history": [{"id": "new-decision"}]}', encoding="utf-8")
        historical = self.run_cli("verify", "--backup", self.backup,
                                  "--scratch-parent", self.scratch)
        self.assertEqual(historical.returncode, 0, historical.stderr)
        release = self.run_cli("verify", "--backup", self.backup,
                              "--scratch-parent", self.scratch, "--source", self.source)
        self.assertNotEqual(release.returncode, 0)
        self.assertIn("BACKUP_SOURCE_MISMATCH", release.stderr)
        self.assertEqual(list(self.scratch.iterdir()), [])

    def test_release_refuses_scratch_inside_current_source(self):
        done = self.run_cli("create", "--source", self.source, "--backup", self.backup)
        self.assertEqual(done.returncode, 0, done.stderr)
        release = self.run_cli("verify", "--backup", self.backup,
                              "--scratch-parent", self.source, "--source", self.source)
        self.assertNotEqual(release.returncode, 0)
        self.assertIn("BACKUP_PATH_OVERLAP", release.stderr)
        self.assertFalse(any(self.source.glob("aemr-restore-*")))

    def test_release_detects_source_change_during_scratch_recovery(self):
        done = self.run_cli("create", "--source", self.source, "--backup", self.backup)
        self.assertEqual(done.returncode, 0, done.stderr)
        spec = importlib.util.spec_from_file_location("stateful_backup", SCRIPT)
        tool = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(tool)
        copy = tool.copy_with_ownership

        def concurrent_change(source, destination):
            copy(source, destination)
            (self.source / "reports" / "inputs" / "ledger.json").write_text(
                '{"history": [{"id": "concurrent-decision"}]}', encoding="utf-8")

        # Simulate another writer after the initial source comparison. The
        # scratch restore remains intact, so only the final recheck can fail.
        with (
            patch.object(tool, "copy_with_ownership", side_effect=concurrent_change),
            self.assertRaisesRegex(tool.BackupError, "SOURCE_CHANGED_DURING_BACKUP_VERIFICATION"),
        ):
            tool.verify(self.backup, self.scratch, self.source)
        self.assertEqual(list(self.scratch.iterdir()), [])
        historical = self.run_cli("verify", "--backup", self.backup,
                                  "--scratch-parent", self.scratch)
        self.assertEqual(historical.returncode, 0, historical.stderr)


    def test_manifest_preserves_owner_mode_and_empty_directories(self):
        import os
        target = self.source / "reports" / "empty"
        target.mkdir()
        (self.source / "aemr.db").chmod(0o600)
        made = self.run_cli("create", "--source", self.source, "--backup", self.backup)
        self.assertEqual(made.returncode, 0, made.stderr)
        metadata = json.loads((self.backup / "manifest.json").read_text())["files"]
        self.assertIn("reports/empty/", metadata)
        self.assertEqual(metadata["aemr.db"]["mode"], 0o600)
        self.assertEqual(metadata["aemr.db"]["uid"], os.stat(self.source / "aemr.db").st_uid)
        restored = self.run_cli("verify", "--backup", self.backup,
                                "--scratch-parent", self.scratch)
        self.assertEqual(restored.returncode, 0, restored.stderr)

    def test_wrapper_rejects_running_service_without_touching_volume(self):
        import os
        import textwrap
        wrapper = SCRIPT.with_name("verify-state-backup.sh")
        self.assertEqual(subprocess.run(
            ["bash", "-n", str(wrapper)], capture_output=True, check=False).returncode, 0)
        root = Path(self.temp.name)
        fake = root / "bin"
        fake.mkdir()
        docker = fake / "docker"
        docker.write_text(textwrap.dedent("""\
            #!/usr/bin/env python3
            import sys
            args = sys.argv[1:]
            if "compose" in args and "ps" in args and "server" in args:
                print("server-id")
            elif args and args[0] == "inspect":
                print("running")
            """))
        docker.chmod(0o755)
        output = root / "private-backups"
        output.mkdir()
        env = os.environ.copy()
        env["PATH"] = str(fake) + os.pathsep + env.get("PATH", "")
        result = subprocess.run(
            ["bash", str(wrapper), str(output), "REL-test"],
            text=True, capture_output=True, timeout=10, check=False, env=env)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("BACKUP_REQUIRES_SERVER_QUIESCENCE", result.stderr)
        self.assertFalse((output / "REL-test").exists())


    def test_release_capacity_reserves_one_full_scratch_and_compressed_checkpoint(self):
        self.module.create(self.source, self.backup, compressed=True)
        result = self.module.release_capacity(self.source, self.backup.parent, self.backup)
        self.assertEqual(result['state'], 'RELEASE_STORAGE_PREFLIGHT')
        self.assertGreater(result['archive_preview_bytes'], 0)
        self.assertEqual(result['required_bytes'], max(result['source_bytes'], result['prior_backup_bytes']) + result['archive_preview_bytes'] + 128*1024*1024)
        self.assertFalse((self.backup.parent / 'preview.tar.gz').exists())

    def test_release_capacity_low_storage_fails_without_creating_checkpoint(self):
        self.module.create(self.source, self.backup, compressed=True)
        with patch.object(self.module.shutil, 'disk_usage') as usage:
            usage.return_value.free = 128*1024*1024
            with self.assertRaisesRegex(self.module.BackupError, 'BACKUP_STORAGE_INSUFFICIENT'):
                self.module.release_capacity(self.source, self.backup.parent, self.backup)

    def test_release_compression_cannot_consume_reserved_scratch_space(self):
        total = sum(int(row['bytes']) for row in self.module.inventory(self.source).values())
        with patch.object(self.module.shutil, 'disk_usage') as usage:
            usage.return_value.free = total + 128*1024*1024
            with self.assertRaisesRegex(self.module.BackupError, 'BACKUP_STORAGE_INSUFFICIENT'):
                self.module.create(self.source, self.backup, compressed=True, reserve_scratch=True)
        self.assertFalse(self.backup.exists())

    def test_release_preview_and_fast_capture_use_same_codec_and_full_restore(self):
        self.module.create(self.source, self.backup, compressed=True)
        capacity=self.module.release_capacity(self.source,self.backup.parent,self.backup)
        fresh=self.backup.parent/'release-fresh'
        capture=self.module.create(self.source,fresh,compressed=True,reserve_scratch=True,compression_level=1)
        self.assertEqual(capture['archive_bytes'],capacity['archive_preview_bytes'])
        verified=self.module.verify(fresh,self.scratch,self.source)
        self.assertTrue(verified['source_matched'])
        self.assertGreater(verified['sqlite_checked'],0)
        self.assertGreater(verified['docx_checked'],0)
        self.assertTrue(self.backup.exists())


if __name__ == "__main__":
    unittest.main()
