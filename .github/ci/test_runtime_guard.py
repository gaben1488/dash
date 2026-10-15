"""Fault recovery remains isolated from report data and other services."""
import contextlib
import importlib.util
import io
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

SCRIPT = Path(__file__).resolve().parents[2] / 'deploy/runtime_guard.py'


class MaintenanceLockWaitTests(unittest.TestCase):
    def exercise(self, release):
        import fcntl
        import subprocess
        import time
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary);lock=root/'lock';lock.touch()
            helper=root/'maintenance-lock.sh'
            helper.write_text((SCRIPT.parent/'maintenance-lock.sh').read_text().replace('/run/lock/aemr-maintenance.lock',str(lock)))
            marker=root/'entered';inode=lock.stat().st_ino
            with lock.open('r+') as owner:
                fcntl.flock(owner,fcntl.LOCK_EX)
                command=['bash','-c','. "$1"; maintenance_lock_acquire 1 || exit 2; touch "$2"; maintenance_lock_owned_by $$',
                         'bounded-wait',str(helper),str(marker)]
                start=time.monotonic()
                child=subprocess.Popen(command,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
                try:
                    time.sleep(.2)
                    self.assertFalse(marker.exists(),'Contender entered while another owner held kernel EX')
                    if release:fcntl.flock(owner,fcntl.LOCK_UN)
                    _out,err=child.communicate(timeout=3)
                finally:
                    if child.poll() is None:child.kill();child.communicate()
            self.assertEqual(lock.stat().st_ino,inode)
            if release:
                self.assertEqual(child.returncode,0,err)
                self.assertTrue(marker.exists())
            else:
                self.assertNotEqual(child.returncode,0)
                self.assertIn('AEMR_MAINTENANCE_BUSY',err)
                self.assertFalse(marker.exists())
                self.assertLess(time.monotonic()-start,3)

    def test_short_supervisor_lock_is_waited_for_without_stealing_it(self):
        self.exercise(True)

    def test_long_maintenance_remains_excluded_after_bounded_wait(self):
        self.exercise(False)

    def test_actual_prepare_wrapper_passes_arguments_and_kernel_ownership_to_guardian(self):
        import os
        import subprocess
        import textwrap
        workflow=(SCRIPT.parents[1]/'.github/workflows/vps-cache-cleanup.yml').read_text().split('  controlled-candidate-release:',1)[1]
        shell=textwrap.dedent(workflow.split('cat > "$RUNNER_TEMP/release/ssh.sh" <<\'SH\'\n',1)[1].split('\n          SH',1)[0])
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary);deploy=root/'code/release-42/deploy';deploy.mkdir(parents=True)
            lock=root/'lock';lock.touch()
            helper=deploy/'maintenance-lock.sh'
            helper.write_text((SCRIPT.parent/'maintenance-lock.sh').read_text().replace('/run/lock/aemr-maintenance.lock',str(lock)))
            (root/'bin').mkdir();sudo=root/'bin/sudo'
            sudo.write_text('#!/bin/sh\n[ "$1" = -n ] && shift\nexec "$@"\n');sudo.chmod(0o700)
            (root/'deploy').mkdir()
            (root/'deploy/report-backup-window.sh').write_text('set -eu\n. "$HELPER"\nmaintenance_lock_owned_by $$ || exit 73\n[ "$#" = 7 ] && [ "$1" = prepare ] && [ "$2" = "$RECOVERY_SHA" ] && [ "$3" = 42 ]\nbash -c \'. "$HELPER"; maintenance_lock_acquire || exit 74; maintenance_lock_owned_by $$\'\ntouch "$ENTERED"\n')
            shell=shell.replace('/root/codex-fixes',str(root/'code'))
            shell+='\nremote() { bash -c "$*"; }\nwindow prepare\n'
            env={**os.environ,'PATH':str(root/'bin')+os.pathsep+os.environ['PATH'],
                 'RECOVERY_RUN':'42','RECOVERY_SHA':'a'*40,'HELPER':str(helper),'ENTERED':str(root/'entered')}
            result=subprocess.run(['bash','-c',shell],cwd=root,env=env,text=True,capture_output=True,timeout=5,check=False)
            self.assertEqual(result.returncode,0,result.stderr)
            self.assertTrue((root/'entered').exists())

    def test_installer_and_stage_both_opt_into_bounded_supervisor_wait(self):
        self.assertIn('maintenance_lock_acquire 45', (SCRIPT.parent/'install-runtime-guard.sh').read_text())
        workflow=(SCRIPT.parents[1]/'.github/workflows/vps-cache-cleanup.yml').read_text()
        self.assertIn('maintenance_lock_acquire 45 && exec python3 -Es /usr/local/libexec/aemr/release-controller.py stage',workflow)


class RuntimeGuardTests(unittest.TestCase):
    def setUp(self):
        self.assertTrue(SCRIPT.is_file(), 'Host process supervision is missing')
        spec = importlib.util.spec_from_file_location('runtime_guard', SCRIPT)
        self.module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.module)
        self.policy = {'project': 'aemr', 'worker_enabled': True, 'cooldown_seconds': 300,
                       'failure_threshold': 3, 'services': {
                           'server': {'container': 'aemr-server-1'},
                           'report-worker': {'container': 'aemr-report-worker-1'}}}
        self.records = {name: {'Name': '/' + cfg['container'], 'Image': 'sha256:verified',
                              'Config': {'Labels': {'com.docker.compose.project': 'aemr',
                                                   'com.docker.compose.service': name}},
                              'State': {'Status': 'running'}}
                        for name, cfg in self.policy['services'].items()}
        self.calls = []
        self.state = {'failures': {}, 'last_recovery': {}}
        self.healthy = True

    def docker(self, args):
        self.calls.append(args)
        if args[0] == 'inspect':
            return json.dumps([next(r for r in self.records.values() if r['Name'] == '/' + args[1])])
        if args[0] == 'exec' and not self.healthy:
            raise RuntimeError('Probe failure; private stderr must not escape')
        return ''

    def check(self, now=1000, **kwargs):
        return self.module.supervise(self.policy, self.state, self.docker, now=now, **kwargs)

    def test_stopped_api_is_started_without_touching_report_data(self):
        self.records['server']['State']['Status'] = 'exited'
        self.check()
        self.assertIn(['start', 'aemr-server-1'], self.calls)
        self.assertFalse(any('restore-reports' in arg for cmd in self.calls for arg in cmd))

    def test_three_failed_process_probes_restart_only_api(self):
        self.healthy = False
        for t in [1000, 1030, 1060]:
            self.check(now=t)
        self.assertIn(['restart', '--time', '20', 'aemr-server-1'], self.calls)
        self.assertNotIn(['restart', '--time', '20', 'aemr-report-worker-1'], self.calls)

    def test_different_worker_image_is_never_started_blindly(self):
        self.records['report-worker']['Image'] = 'sha256:unreviewed'
        self.records['report-worker']['State']['Status'] = 'created'
        self.check()
        self.assertNotIn(['start', 'aemr-report-worker-1'], self.calls)

    def test_matching_worker_is_recovered_independently(self):
        self.records['report-worker']['State']['Status'] = 'exited'
        self.check()
        self.assertIn(['start', 'aemr-report-worker-1'], self.calls)
        self.assertNotIn(['restart', '--time', '20', 'aemr-server-1'], self.calls)

    def test_maintenance_and_recovery_cooldown_are_respected(self):
        self.records['server']['State']['Status'] = 'exited'
        self.check(maintenance=True)
        self.assertEqual(self.calls, [])
        self.state['last_recovery']['server'] = 950
        self.check()
        self.assertNotIn(['start', 'aemr-server-1'], self.calls)

    def test_foreign_container_labels_cannot_trigger_recovery(self):
        self.records['server']['State']['Status'] = 'exited'
        self.records['server']['Config']['Labels']['com.docker.compose.project'] = 'other'
        self.check()
        self.assertNotIn(['start', 'aemr-server-1'], self.calls)

    def test_worker_maintenance_disables_recovery_but_keeps_resource_protection(self):
        self.policy['worker_enabled'] = False
        self.policy['services']['report-worker']['limits'] = {'mem_limit': 2304 * 1024 * 1024}
        self.records['report-worker']['State']['Status'] = 'exited'
        for image in ('sha256:verified', 'sha256:worker-only-hotfix'):
            with self.subTest(image=image):
                self.records['report-worker']['Image'] = image
                self.calls.clear()
                self.check()
                self.assertIn(['update', '--memory', str(2304 * 1024 * 1024), 'aemr-report-worker-1'], self.calls)
                self.assertNotIn(['start', 'aemr-report-worker-1'], self.calls)

    def run_main(self, kind=None, *, failure=False):
        import fcntl
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder); policy=root/'policy.json'; state=root/'state.json'; lock=root/'lock'
            policy.write_text(json.dumps(self.policy)); lock.touch()
            pending=root/'pending-release.json'; progress=root/'release-recovery-progress.json'
            if kind=='pending': pending.write_text('{}')
            elif kind=='progress': progress.write_text('{}')
            elif kind=='symlink': pending.symlink_to(root/'absent')
            captured=[]
            def recovery(fd):
                self.assertEqual(__import__('os').fstat(fd).st_ino,lock.stat().st_ino)
                with lock.open('a') as rival,self.assertRaises(BlockingIOError):
                    fcntl.flock(rival,fcntl.LOCK_EX|fcntl.LOCK_NB)
                captured.append('release')
                if failure: raise RuntimeError('PRIVATE_CONFIG_MUST_NOT_ESCAPE')
                return {'state':'RELEASE_RUNTIME_AND_STATE_RECOVERED'}
            out=io.StringIO();err=io.StringIO();original_supervise=self.module.supervise
            with patch.object(self.module,'RELEASE_MARKERS',(pending,progress),create=True), \
                 patch.object(self.module,'recover_release',side_effect=recovery,create=True), \
                 patch.object(self.module,'supervise',side_effect=lambda p,s:original_supervise(p,s,self.docker,now=1000)), \
                 patch('sys.argv',['runtime_guard','--policy',str(policy),'--state',str(state),'--lock',str(lock)]), \
                 contextlib.redirect_stdout(out),contextlib.redirect_stderr(err):
                result=self.module.main()
            return result,captured,out.getvalue(),err.getvalue()

    @unittest.skipUnless(sys.platform=='linux','Real release exclusion requires Linux flock')
    def test_pending_release_prevents_ordinary_api_start_and_owns_kernel_lock(self):
        self.records['server']['State']['Status']='exited'
        result,events,out,err=self.run_main('pending')
        self.assertEqual(events,['release'])
        self.assertEqual(result,0,err)
        self.assertIn('RELEASE_RUNTIME_AND_STATE_RECOVERED',out)
        self.assertEqual(self.calls,[])

    @unittest.skipUnless(sys.platform=='linux','Real release exclusion requires Linux flock')
    def test_failed_release_recovery_never_falls_through_to_api_or_leaks_config(self):
        self.records['server']['State']['Status']='exited'
        result,events,out,err=self.run_main('pending',failure=True)
        self.assertEqual(events,['release'])
        self.assertEqual(result,2)
        self.assertIn('RELEASE_RECOVERY_UNAVAILABLE',err)
        self.assertNotIn('PRIVATE_CONFIG',out+err)
        self.assertEqual(self.calls,[])

    @unittest.skipUnless(sys.platform=='linux','Real release exclusion requires Linux flock')
    def test_orphan_progress_and_dangling_pending_are_checked_before_supervision(self):
        for kind in ('progress','symlink'):
            with self.subTest(kind=kind):
                self.calls.clear()
                result,events,_,err=self.run_main(kind)
                self.assertEqual(events,['release'])
                self.assertEqual(result,0,err)
                self.assertEqual(self.calls,[])

    @unittest.skipUnless(sys.platform=='linux','Real release exclusion requires Linux flock')
    def test_no_release_marker_preserves_existing_independent_process_recovery(self):
        self.records['server']['State']['Status']='exited'
        result,events,_,err=self.run_main()
        self.assertEqual(result,0,err)
        self.assertEqual(events,[])
        self.assertIn(['start','aemr-server-1'],self.calls)


if __name__ == '__main__':
    unittest.main()
