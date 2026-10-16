"""The receipt repair cannot race a production maintenance owner."""
import fcntl
import importlib.util
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


class ProofRepairCustodyTests(unittest.TestCase):
    def setUp(self):
        path = Path(__file__).with_name('recover_trial_proof.py')
        spec = importlib.util.spec_from_file_location('recover_trial_proof', path)
        self.module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.module)

    def test_existing_inode_is_excluded_for_the_entire_transaction(self):
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / 'lock';target.write_bytes(b'original')
            before = target.stat()
            called = []
            def transaction(fd):
                self.assertEqual(os.fstat(fd).st_ino, before.st_ino)
                result = subprocess.run([sys.executable, '-c',
                    'import fcntl,sys;f=open(sys.argv[1],"r+");fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB)', str(target)], capture_output=True, check=False)
                self.assertNotEqual(result.returncode, 0, 'Competing process acquired the lock during receipt replacement')
                called.append(True)
            with patch.object(self.module, 'Path', return_value=target), patch.object(self.module.os, 'geteuid', return_value=0), patch.object(self.module, 'recover_under_lock', transaction):
                self.module.main()
            self.assertEqual(called, [True])
            self.assertEqual(target.read_bytes(), b'original')
            self.assertEqual(target.stat().st_ino, before.st_ino)

    def test_a_live_maintenance_owner_prevents_any_receipt_replacement(self):
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / 'lock';target.touch()
            with target.open('r+') as holder:
                fcntl.flock(holder, fcntl.LOCK_EX | fcntl.LOCK_NB)
                with patch.object(self.module, 'Path', return_value=target), patch.object(self.module.os, 'geteuid', return_value=0), patch.object(self.module, 'recover_under_lock') as transaction:
                    with self.assertRaises(BlockingIOError):self.module.main()
                    transaction.assert_not_called()

    def test_absent_or_symlink_lock_never_creates_a_new_maintenance_inode(self):
        with tempfile.TemporaryDirectory() as directory:
            missing = Path(directory) / 'missing'
            link = Path(directory) / 'symlink';link.symlink_to(missing)
            for target in (missing, link):
                with self.subTest(path=target.name), patch.object(self.module, 'Path', return_value=target), patch.object(self.module.os, 'geteuid', return_value=0), patch.object(self.module, 'recover_under_lock') as transaction:
                    with self.assertRaises(OSError):self.module.main()
                    transaction.assert_not_called()
                    self.assertFalse(missing.exists())


if __name__ == '__main__':
    unittest.main()
