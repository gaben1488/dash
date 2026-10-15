"""The preservation exception never admits a live or state-mounted container."""
import copy
import importlib.util
import os
import tempfile
import types
import unittest
from pathlib import Path
from unittest.mock import patch

p=Path(__file__).with_name('restore_existing_release.py')
spec=importlib.util.spec_from_file_location('restore',p);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class Admission(unittest.TestCase):
 def setUp(self):
  self.record={'Id':m.LEGACY,'Image':m.LEGACY_IMAGE,'Name':'/retired-helper','State':{'Status':'exited','Pid':0},'Config':{'Labels':{'com.docker.compose.project':'aemr','com.docker.compose.service':'server'}},'Mounts':[],'SizeRw':13402112}
 def test_observed_exact_stopped_helper_is_admitted(self):m.validate_legacy(self.record)
 def test_other_identity_runtime_or_any_mount_is_rejected(self):
  variants=[{'Id':'a'*64},{'Image':'sha256:'+'b'*64},{'Name':'/aemr-server-1'},{'Name':'/aemr-web-1'},{'Name':'/aemr-caddy-1'},{'Name':'/aemr-report-worker-1'},{'State':{'Status':'running','Pid':42}},{'Mounts':[{'Type':'volume','Name':'aemr_server_data'}]},{'Mounts':[{'Type':'bind','RW':False}]},{'SizeRw':257*1024*1024},{'SizeRw':-1},{'SizeRw':True},{'Config':{'Labels':{'com.docker.compose.project':'other','com.docker.compose.service':'server'}}}]
  for changed in variants:
   with self.subTest(changed=changed),self.assertRaises(AssertionError):m.validate_legacy({**copy.deepcopy(self.record),**changed})

@unittest.skipUnless(os.geteuid()==0,'real private-file ownership exercised by namespace root')
class ArchiveRetirement(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
  self.base=Path(self.tmp.name)
  self.fresh=self.base/'worker-38792810076'/'backup';self.old=self.base/'worker-38349415596'/'backup'
  self.fresh.mkdir(parents=True,mode=0o700);self.old.mkdir(parents=True,mode=0o700)
  self.fresh.parent.chmod(0o700);self.old.parent.chmod(0o700)
  for module,file in [('tool','deploy/stateful_backup.py'),('recovery','deploy/release_recovery.py')]:
   spec=importlib.util.spec_from_file_location(module,Path(__file__).resolve().parents[2]/file)
   value=importlib.util.module_from_spec(spec);spec.loader.exec_module(value);setattr(self,module,value)
  self.recovery.BACKUP_BASE=self.base
  for directory,body in [(self.fresh,b'fresh independently checked payload'),(self.old,b'old superseded payload')]:
   archive=directory/'state.tar.gz';archive.write_bytes(body);archive.chmod(0o600)
   manifest={'format':2,'files':{'aemr.db':{'bytes':1}},'bytes':1,'archive_bytes':len(body),'archive_sha256':m.hashlib.sha256(body).hexdigest()}
   self.recovery.atomic_json(directory/'manifest.json',manifest)
  for constant,directory in [('FRESH_ARCHIVE_BYTES',self.fresh),('OLD_ARCHIVE_BYTES',self.old)]:
   item=patch.object(m,constant,(directory/'state.tar.gz').stat().st_size);item.start();self.addCleanup(item.stop)
  self.executor=types.SimpleNamespace(_files=lambda plan:(self.fresh,{}),backup_tool=self.tool)
  self.plan={'backup_reference':'worker-38792810076/backup','manifest_sha256':self.recovery.digest((self.fresh/'manifest.json').read_bytes())}
 def run_retirement(self):m.retire_superseded_backup(self.executor,self.recovery,self.plan)
 def test_verified_fresh_archive_is_preserved_and_retry_is_idempotent(self):
  before=(self.fresh/'state.tar.gz').read_bytes()
  self.run_retirement();self.assertFalse((self.old/'state.tar.gz').exists())
  self.assertTrue((self.old/'manifest.json').is_file());self.assertTrue((self.old/'superseded-retirement.json').is_file())
  self.run_retirement();self.assertEqual((self.fresh/'state.tar.gz').read_bytes(),before)
 def test_historical644_inside_root_private_tree_is_compatible(self):
  (self.old/'manifest.json').chmod(0o644);(self.old/'state.tar.gz').chmod(0o644)
  self.run_retirement();self.assertFalse((self.old/'state.tar.gz').exists())
 def test_writable_historical_archive_is_rejected(self):
  (self.old/'state.tar.gz').chmod(0o666)
  with self.assertRaises(AssertionError):self.run_retirement()
  self.assertTrue((self.old/'state.tar.gz').is_file())
 def test_corrupt_fresh_archive_never_retires_old(self):
  (self.fresh/'state.tar.gz').write_bytes(b'corrupt')
  with self.assertRaises(self.tool.BackupError):self.run_retirement()
  self.assertTrue((self.old/'state.tar.gz').is_file())
 def test_corrupt_old_archive_is_never_deleted(self):
  path=self.old/'state.tar.gz';data=path.read_bytes();path.write_bytes(b'X'+data[1:])
  with self.assertRaises(AssertionError):self.run_retirement()
  self.assertTrue(path.is_file())
 def test_missing_old_archive_without_bound_receipt_is_rejected(self):
  (self.old/'state.tar.gz').unlink()
  with self.assertRaises(FileNotFoundError):self.run_retirement()
 def test_old_archive_change_after_hash_is_detected_before_unlink(self):
  path=self.old/'state.tar.gz';original=m.hashlib.file_digest
  def digest(file,*args,**kwargs):
   value=original(file,*args,**kwargs)
   if os.fstat(file.fileno()).st_ino==path.stat().st_ino:
    with path.open('ab') as destination:destination.write(b'changed')
   return value
  with patch.object(m.hashlib,'file_digest',side_effect=digest),self.assertRaises(AssertionError):self.run_retirement()
  self.assertTrue(path.is_file())

if __name__=='__main__':unittest.main()
