"""Native namespace owner retains custody and does not inherit loader injection."""
import fcntl
import importlib.util
import os
import subprocess
import sys
import tempfile
import time
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

    def test_short_competing_lock_is_waited_for_and_inherited_ex_remains(self):
        code="import fcntl,os,sys,time;f=open(sys.argv[1],'r+');fcntl.flock(f,fcntl.LOCK_EX);print('READY',flush=True);time.sleep(.15)"
        with tempfile.TemporaryDirectory() as temporary:
            path=Path(temporary)/'lock';path.touch()
            holder=subprocess.Popen([sys.executable,'-IB','-c',code,str(path)],stdout=subprocess.PIPE,text=True)
            self.assertEqual(holder.stdout.readline().strip(),'READY')
            fd=os.open(path,os.O_RDWR)
            if fd!=9:os.dup2(fd,9,inheritable=True);os.close(fd)
            try:
                before=time.monotonic();module.wait_global_lock(wait_seconds=1)
                self.assertGreater(time.monotonic()-before,.05)
                with path.open('r+') as competitor, self.assertRaises(BlockingIOError):
                    fcntl.flock(competitor,fcntl.LOCK_EX|fcntl.LOCK_NB)
            finally:os.close(9);holder.wait(timeout=2);holder.stdout.close()



if __name__=='__main__':unittest.main()
