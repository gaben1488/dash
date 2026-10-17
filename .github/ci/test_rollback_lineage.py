"""A reconstructed runtime is not a second OOM incident."""
import importlib.util
import json
import os
import sys
import unittest
from pathlib import Path

ROOT=Path(__file__).resolve().parents[2]

def load(name,path):
 spec=importlib.util.spec_from_file_location(name,path);value=importlib.util.module_from_spec(spec);spec.loader.exec_module(value);return value

@unittest.skipUnless(os.geteuid()==0,'namespace root exercises private metadata and EX lock')
class LineageTests(unittest.TestCase):
 def setUp(self):
  fixtures=load('lineage_fixtures',ROOT/'.github/ci/test_release_recovery.py')
  self.f=fixtures.ReleaseRecoveryTests();self.addCleanup(self.f.doCleanups);self.f.setUp()
  self.r=self.f.module;self.plan=self.f.plan
  self.plan['images']['report-worker']=self.plan['images']['server']
  self.plan['original_running']['report-worker']=False
  original={name:record['Id'] for name,record in self.f.records.items()}
  self.qdir=self.r.STATE_DIR/'worker-quarantine';self.qdir.mkdir(mode=0o700)
  self.q={'state':'WORKER_OOM_QUARANTINED','image':self.plan['images']['server'],'server':original['server'],'worker':original['report-worker'],'historical_oom_restarts':463}
  self.r.atomic_json(self.qdir/'quarantine.json',self.q)
  self.qbytes=(self.qdir/'quarantine.json').read_bytes()
  self.r.atomic_json(self.r.RUNTIME_DIR/'stage.json',{'release_sha':self.plan['release_sha'],'candidate_images':self.plan['candidate_images'],'config_sha256':self.plan['config_sha256'],'container_ids':original})
  restored=self.f.backup_tool.restore_state(self.f.backup,self.f.source,self.plan['manifest_sha256'])
  self.completed={'state':'RELEASE_RUNTIME_AND_STATE_RECOVERED','plan_sha256':self.r.digest(json.dumps(self.plan,sort_keys=True,separators=(',',':')).encode()),'release_sha':self.plan['release_sha'],'manifest_sha256':self.plan['manifest_sha256'],'restored':restored}
  self.r.atomic_json(self.r.STATE_DIR/'release-recovered.json',self.completed)
  for i,(role,record) in enumerate(self.f.records.items()):
   record['Id']=str(i+5)*64;record['Image']=self.plan['images'][role]
   record['State']['Status']='exited' if role=='report-worker' else 'running'
  self.f.persist_records()
  self.m=load('lineage',ROOT/'.github/ci/record_rollback_lineage.py')
 def record(self):return self.m.record_lineage(self.f.executor,self.r,self.plan)
 def test_exact_reconstructed_runtime_records_bridge_without_changing_oom_provenance(self):
  result=self.record();self.assertEqual(result['container_ids'],{s:r['Id'] for s,r in self.f.records.items()})
  self.assertEqual(result['quarantine_sha256'],self.r.digest(self.qbytes))
  self.assertEqual((self.qdir/'quarantine.json').read_bytes(),self.qbytes)
  self.assertEqual(self.record(),result)
 def test_pending_candidate_never_becomes_rollback_lineage(self):
  self.f.pending.touch()
  with self.assertRaises(AssertionError):self.record()
  self.assertFalse((self.qdir/'rollback-lineage.json').exists())
 def test_other_recovery_or_quarantine_identity_is_rejected(self):
  for target,changed in [('recovery',{'plan_sha256':'f'*64}),('recovery',{'manifest_sha256':'f'*64}),('quarantine',{'server':'f'*64}),('quarantine',{'image':'sha256:'+'f'*64})]:
   with self.subTest(target=target,changed=changed):
    self.r.atomic_json(self.r.STATE_DIR/'release-recovered.json',{**self.completed,**(changed if target=='recovery' else {})})
    self.r.atomic_json(self.qdir/'quarantine.json',{**self.q,**(changed if target=='quarantine' else {})})
    with self.assertRaises((AssertionError,self.r.RecoveryError)):self.record()
    self.assertFalse((self.qdir/'rollback-lineage.json').exists())
 def test_unquarantined_running_worker_is_not_labeled_as_controlled_recreation(self):
  self.f.records['report-worker']['State']['Status']='running';self.f.persist_records()
  with self.assertRaises(AssertionError):self.record()
 def test_changed_existing_bridge_is_not_overwritten(self):
  bridge=self.record();self.r.atomic_json(self.qdir/'rollback-lineage.json',{**bridge,'quarantine_sha256':'f'*64})
  with self.assertRaises(AssertionError):self.record()

if __name__=='__main__':
 if os.geteuid()!=0:
  import subprocess
  result=subprocess.run(['unshare','-Ur',sys.executable,str(Path(__file__).resolve()),'-q'],check=False)
  raise SystemExit(result.returncode)
 unittest.main()
