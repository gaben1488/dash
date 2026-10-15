"""The preservation exception never admits a live or state-mounted container."""
import copy
import importlib.util
import unittest
from pathlib import Path

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
if __name__=='__main__':unittest.main()
