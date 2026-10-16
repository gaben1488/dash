"""Native namespace owner retains custody and does not inherit loader injection."""
import importlib.util
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

PATH=Path(__file__).with_name('monitoring_registry_operator.py')
spec=importlib.util.spec_from_file_location('registry_operator',PATH);module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)


class RegistryOperatorTests(unittest.TestCase):
    def test_namespace_enters_pid_and_network_with_target_cwd(self):
        command=module.namespace_command({'State':{'Pid':99}},'proof',(1,2),11,12)
        self.assertIn('--pid',command)
        self.assertIn('--net',command)
        self.assertIn('--wd',command)
        self.assertNotIn('--no-fork',command)
        self.assertNotIn('--wd=/app/packages/server',command)

    def test_root_loader_cannot_consume_container_ld_variables(self):
        env=module.native_environment(['PATH=/usr/bin','AEMR_API_KEY=private','LD_PRELOAD=/tmp/inject.so','LD_AUDIT=/tmp/audit.so','LD_LIBRARY_PATH=/tmp','PYTHONHOME=/tmp'])
        self.assertEqual(env['AEMR_API_KEY'],'private')
        self.assertFalse(any(name.startswith('LD_') for name in env))
        self.assertNotIn('PYTHONHOME',env)

    def test_real_parent_sigkill_keeps_child_lock_until_release(self):
        code="import os,sys;os.fstat(9);os.write(int(sys.argv[1]),b'R');assert os.read(int(sys.argv[2]),1)==b'1'"
        def local_child(record,mode,identity,ready,release):
            return [sys.executable,'-IB','-c',code,str(ready),str(release)]
        with tempfile.TemporaryDirectory() as temporary, mock.patch.object(module,'namespace_command',local_child):
            module.prove_owner_loss({},os.environ.copy(),temporary)



if __name__=='__main__':unittest.main()
