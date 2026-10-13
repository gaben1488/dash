"""Exercise maintenance failure recovery using synthetic Docker, never production."""
import json
import os
import subprocess
import tempfile
import time
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[2] / 'deploy/report-backup-window.sh'


class BackupWindowTests(unittest.TestCase):
    def run_window(self, scenario, mode='prepare', flag=None, via_stdin=False):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            repo, base = root / 'repo', root / 'private'
            (repo / 'deploy').mkdir(parents=True)
            (repo / '.git').mkdir()
            trace = root / 'trace'
            docker = root / 'docker'
            docker.write_text('''#!/usr/bin/env python3
import json, os, sys
from pathlib import Path
args=sys.argv[1:]
trace=Path(os.environ['WINDOW_TRACE'])
old=trace.read_text() if trace.exists() else ''
with trace.open('a') as f: f.write(json.dumps(args)+'\\n')
scenario=os.environ['WINDOW_SCENARIO']
server,worker='a'*64,'b'*64
if args[0]=='compose': print(server if args[-1]=='server' else worker)
elif args[0]=='inspect':
    fmt=args[2]
    if '.State.Health' in fmt: print('unhealthy' if 'unhealthy' in scenario else 'healthy')
    elif '.State.Status' in fmt:
        if args[-1]==worker and scenario=='worker-running-drain-timeout' and old.count('"TERM"')<2: print('running'); sys.exit(0)
        if args[-1]==worker and scenario=='worker-unknown': print('restarting'); sys.exit(0)
        print(('running' if scenario.startswith('worker-running') and (old.rfind(json.dumps(['start',worker])) > old.rfind('"TERM"') or '"TERM"' not in old) else 'exited') if args[-1]==worker else ('exited' if old.rfind(json.dumps(['stop','--time','75',server])) > old.rfind(json.dumps(['start',server])) or os.environ['WINDOW_MODE']=='match-source' else 'running'))
    elif '.State.ExitCode' in fmt: print('137' if scenario=='worker-running-forced' else '0')
    elif '.Image' in fmt: print('sha256:'+('f' if scenario=='worker-running-changed' and old.count('.Image')>1 and args[-1]==worker else 'e' if args[-1]==worker else 'c')*64)
    else: print('synthetic_data')
elif args[0]=='kill': pass
elif args[0]=='run':
    if 'BACKUP_PREFLIGHT_OK' in ' '.join(args): sys.exit(2 if scenario=='worker-running-capacity' else 0)
    if scenario=='match-watchdog':
        Path(os.environ['WINDOW_MARKER']).unlink()
        sys.exit(0)
    if scenario=='worker-running-owner-loss': os.kill(os.getppid(),9); sys.exit(0)
    sys.exit(2)
elif args[0] in {'stop','start'}:
    if scenario=='worker-running-restart-failed' and args==['start',worker]: sys.exit(2)
else: sys.exit(3)
''')
            docker.chmod(0o700)
            if scenario == 'lock-denied':
                lock = root / 'denied.lock'
                lock.touch(); lock.chmod(0o400)
            if scenario in {'root-git-owner', 'root-owned-repo'}:
                (root / 'id').write_text('#!/bin/sh\nif [ "$1" = -u ]; then echo 0; else exec /usr/bin/id "$@"; fi\n')
                (root / 'id').chmod(0o700)
                (root / 'runuser').write_text('#!/bin/sh\necho "$*" >> "$WINDOW_GIT_TRACE"\nshift 3\nexec "$@"\n')
                (root / 'runuser').chmod(0o700)
            if scenario == 'root-owned-repo':
                (root / 'stat').write_text('#!/bin/sh\necho 0\n')
                (root / 'stat').chmod(0o700)
            git = root / 'git'
            git.write_text('#!/bin/sh\ncase "$*" in *deploy/maintenance-lock.sh*) cat "$WINDOW_HELPER";; *deploy/report-backup-window.sh*) cat "$WINDOW_SCRIPT";; esac\nexit 0\n')
            git.chmod(0o700)
            for name in ('sleep',):
                command = root / name
                command.write_text('#!/bin/sh\nexit 0\n')
                command.chmod(0o700)
            seq = root / 'seq'
            seq.write_text('#!/bin/sh\nif [ "$WINDOW_SCENARIO" = worker-running-drain-timeout ] && [ "$2" = 450 ]; then echo 1; else exec /usr/bin/seq "$@"; fi\n')
            seq.chmod(0o700)
            guardian = None
            session = base / 'worker-1'
            if mode != 'prepare' and not scenario.startswith('never-entered'):
                session = base / 'worker-1'
                session.mkdir(parents=True)
                (session / 'quiescent').touch()
                (session / 'maintenance-lock.sh').write_text((SCRIPT.parent / 'maintenance-lock.sh').read_text())
                # Real cross-process EX ownership; never stub the lock or ready proof.
                guardian = subprocess.Popen(['bash', '-c', '''
. "$1/maintenance-lock.sh"
maintenance_lock_acquire || exit 1
echo "$$" > "$1/guardian-ready"
while [ -f "$1/quiescent" ]; do /bin/sleep .02; done
''', 'fixture-guardian', str(session)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                for _ in range(100):
                    if (session / 'guardian-ready').exists():
                        break
                    if guardian.poll() is not None:
                        self.fail('Synthetic guardian could not acquire the actual kernel lock')
                    time.sleep(.01)
                self.assertTrue((session / 'guardian-ready').exists())
                (session / 'runtime.json').write_text(json.dumps({'server': 'a' * 64, 'worker': 'b' * 64,
                    'volume': 'synthetic_data', 'image': 'sha256:' + 'c' * 64, 'candidate': 'd' * 40,
                    'worker_image':'sha256:'+'e'*64,'worker_was_running':scenario.startswith('worker-running'),
                    'authorized_quiesce':flag=='--quiesce-worker'}))
            if mode!='prepare' and scenario=='invalid-record-image':
                x=json.loads((session/'runtime.json').read_text()); x['worker_image']=None
                (session/'runtime.json').write_text(json.dumps(x))
            if scenario.startswith('never-entered'):
                base.mkdir(parents=True, exist_ok=True)
                if scenario == 'never-entered-absent':
                    pass
                elif scenario == 'never-entered-symlink':
                    session.symlink_to(root / 'missing-target')
                else:
                    session.mkdir()
                    if scenario == 'never-entered':
                        (session / 'runtime.json').write_text('{}')
                    else:
                        (session / scenario.removeprefix('never-entered-')).touch()
            script_text = SCRIPT.read_text()
            if scenario == 'lock-denied':
                script_text = script_text.replace('/run/lock/aemr-maintenance.lock', str(lock))
                via_stdin = True
            result = subprocess.run((['bash', '-s', '--'] if via_stdin else ['bash', str(SCRIPT)]) + [mode, 'd' * 40, '1', str(repo), str(base)] + ([flag] if flag is not None else []),
                                    input=script_text if via_stdin else None,
                                    capture_output=True, text=True, timeout=15, check=False,
                                    env={**os.environ, 'PATH': tmp + os.pathsep + os.environ['PATH'],
                                         'WINDOW_TRACE': str(trace), 'WINDOW_GIT_TRACE':str(root/'git-trace'), 'WINDOW_SCENARIO': scenario, 'WINDOW_MODE': mode,
                                         'WINDOW_MARKER': str(base / 'worker-1/quiescent'),
                                         'WINDOW_HELPER': str(SCRIPT.parent / 'maintenance-lock.sh'), 'WINDOW_SCRIPT':str(SCRIPT),
                                         'worker_was_running':'true','authorized_quiesce':'true','quiesce':'true'})
            result.git_calls=(root/'git-trace').read_text().splitlines() if (root/'git-trace').exists() else []
            result.runtime=json.loads((session/'runtime.json').read_text()) if (session/'runtime.json').exists() else None
            # A failed health check intentionally retains quiescence. Clean up only
            # the synthetic window after assertions can inspect its command trace.
            if scenario=='worker-running-owner-loss':
                for _ in range(200):
                    if trace.exists() and json.dumps(['start','b'*64]) in trace.read_text(): break
                    time.sleep(.01)
            (session / 'quiescent').unlink(missing_ok=True)
            if guardian is not None:
                self.assertEqual(guardian.wait(timeout=3), 0)
            elif (session / 'guardian-ready').exists():
                for _ in range(100):
                    released = subprocess.run(['flock', '-n', '/run/lock/aemr-maintenance.lock', 'true'], check=False).returncode == 0
                    if released:
                        break
                    time.sleep(.01)
                self.assertTrue(released, 'Backup guardian leaked its kernel lock')
            calls = [json.loads(x) for x in trace.read_text().splitlines()] if trace.exists() else []
            return result, calls

    def test_lock_permission_denial_precedes_docker_and_session(self):
        result, calls = self.run_window('lock-denied')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('BACKUP_MAINTENANCE_PERMISSION_DENIED', result.stderr)
        self.assertEqual(calls, [])
        self.assertIsNone(result.runtime)

    def test_resume_never_entered_window_is_explicit_noop(self):
        result, calls = self.run_window('never-entered', 'resume')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('BACKUP_WINDOW_NOT_ENTERED', result.stdout)
        self.assertNotIn('RESUMED', result.stdout)
        self.assertEqual(calls, [])

    def test_missing_session_noop_requires_accessible_base_not_a_session_symlink(self):
        result, calls = self.run_window('never-entered-absent', 'resume')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('BACKUP_WINDOW_NOT_ENTERED', result.stdout)
        self.assertNotIn('HEALTHY', result.stdout)
        self.assertEqual(calls, [])
        result, calls = self.run_window('never-entered-symlink', 'resume')
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn('BACKUP_WINDOW_NOT_ENTERED', result.stdout)
        self.assertEqual(calls, [])

    def test_root_git_delegates_every_operation_to_verified_repo_owner(self):
        result, _ = self.run_window('root-git-owner')
        self.assertTrue(result.git_calls)
        self.assertEqual(len(result.git_calls), 4)
        owner = __import__('pwd').getpwuid(os.stat(SCRIPT.parents[1]).st_uid).pw_name
        self.assertTrue(all(c.startswith('-u ' + owner + ' -- git -C ') for c in result.git_calls))
        self.assertTrue(any(' fetch ' in c for c in result.git_calls))

    def test_root_owned_repo_needs_no_delegation(self):
        result, calls = self.run_window('root-owned-repo')
        self.assertEqual(result.git_calls, [])
        self.assertTrue(any(c[0] == 'stop' for c in calls))

    def test_missing_guardian_never_masks_started_window_markers(self):
        for marker in ('prepared', 'worker-draining', 'quiescent', 'guardian-ready'):
            with self.subTest(marker=marker):
                result, calls = self.run_window('never-entered-' + marker, 'resume')
                self.assertNotEqual(result.returncode, 0)
                self.assertNotIn('BACKUP_WINDOW_NOT_ENTERED', result.stdout)
                self.assertEqual(calls, [])

    def test_backup_failure_resumes_exact_original_server_and_never_worker(self):
        result, calls = self.run_window('backup-failed')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn(['stop', '--time', '75', 'a' * 64], calls)
        self.assertEqual([c for c in calls if c[0] == 'start'], [['start', 'a' * 64]])
        self.assertNotIn('BACKUP_SERVER_NOT_HEALTHY', result.stderr)
        self.assertNotIn('BACKUP_SERVER_RESTART_FAILED', result.stderr)
        self.assertFalse(any('up' in c or 'worker' in c and c[0] == 'start' for c in calls))

    def test_running_worker_blocks_backup_before_server_stop(self):
        result, calls = self.run_window('worker-running')
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(any(c[0] in {'stop', 'start', 'run'} for c in calls))

    def test_resume_starts_only_original_server(self):
        result, calls = self.run_window('normal', 'resume')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual([c for c in calls if c[0] == 'start'], [['start', 'a' * 64]])

    def test_watchdog_resume_during_source_match_blocks_result(self):
        result, _ = self.run_window('match-watchdog', 'match-source')
        self.assertNotEqual(result.returncode, 0)

    def test_unhealthy_server_is_not_reported_resumed(self):
        result, calls = self.run_window('unhealthy', 'resume')
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn('ORIGINAL_SERVER_RESUMED', result.stdout)
        self.assertEqual([c for c in calls if c[0] == 'start'], [['start', 'a' * 64]])

    def test_authorized_running_worker_failure_restores_api_healthy_before_worker(self):
        result, calls = self.run_window('worker-running-backup-failed', flag='--quiesce-worker')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn(['kill','--signal','TERM','b'*64], calls)
        self.assertEqual([c for c in calls if c[0]=='start'], [['start','a'*64],['start','b'*64]])
        health = next(i for i,c in enumerate(calls) if c[0]=='inspect' and '.State.Health' in c[2])
        self.assertLess(health, calls.index(['start','b'*64]))

    def test_authorized_resume_of_running_worker_uses_private_record(self):
        result,calls=self.run_window('worker-running', 'resume', '--quiesce-worker')
        self.assertEqual(result.returncode,0,result.stderr)
        self.assertEqual([c for c in calls if c[0]=='start'],[['start','a'*64],['start','b'*64]])

    def test_new_flag_never_starts_originally_stopped_worker(self):
        result,calls=self.run_window('normal','resume','--quiesce-worker')
        self.assertEqual(result.returncode,0,result.stderr)
        self.assertEqual([c for c in calls if c[0]=='start'],[['start','a'*64]])

    def test_unhealthy_api_prevents_worker_restore(self):
        result,calls=self.run_window('worker-running-unhealthy','resume','--quiesce-worker')
        self.assertNotEqual(result.returncode,0)
        self.assertEqual([c for c in calls if c[0]=='start'],[['start','a'*64]])

    def test_invalid_flag_fails_before_docker(self):
        result,calls=self.run_window('worker-running',flag='--quiesce-all')
        self.assertNotEqual(result.returncode,0)
        self.assertEqual(calls,[])

    def test_capacity_preview_failure_precedes_any_stop(self):
        result,calls=self.run_window('worker-running-capacity',flag='--quiesce-worker')
        self.assertNotEqual(result.returncode,0)
        self.assertTrue(any(c[0]=='run' and 'BACKUP_PREFLIGHT_OK' in ' '.join(c) for c in calls))
        self.assertFalse(any(c[0] in {'kill','stop','start'} for c in calls))

    def test_changed_worker_image_never_quiesced(self):
        result,calls=self.run_window('worker-running-changed',flag='--quiesce-worker')
        self.assertNotEqual(result.returncode,0)
        self.assertFalse(any(c[0] in {'kill','stop','start'} for c in calls))

    def test_forced_worker_exit_is_not_accepted_as_graceful_backup(self):
        result,calls=self.run_window('worker-running-forced',flag='--quiesce-worker')
        self.assertNotEqual(result.returncode,0)
        self.assertIn('BACKUP_WORKER_NOT_GRACEFUL',result.stderr)
        self.assertFalse(any(c[0]=='stop' for c in calls))

    def test_worker_start_failure_is_not_claimed_as_resumed(self):
        result,calls=self.run_window('worker-running-restart-failed','resume','--quiesce-worker')
        self.assertNotEqual(result.returncode,0)
        self.assertNotIn('ORIGINAL_SERVER_RESUMED',result.stdout)
        self.assertEqual([c for c in calls if c[0]=='start'],[['start','a'*64],['start','b'*64]])

    def test_real_counter_preview_is_read_only_and_enforces_compressed_bound(self):
        _,calls=self.run_window('worker-running-capacity',flag='--quiesce-worker')
        code=next(c[c.index('-c')+1] for c in calls if c[0]=='run' and 'BACKUP_PREFLIGHT_OK' in ' '.join(c))
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp); source=root/'source'; source.mkdir(); destination=root/'backups'; destination.mkdir()
            data=os.urandom(4096); (source/'state.bin').write_bytes(data)
            (source/'aemr.db').write_bytes(b'synthetic')
            (source/'reports/inputs').mkdir(parents=True); (source/'reports/published').mkdir()
            (source/'reports/inputs/registry.json').write_text('{}'); (source/'reports/inputs/ledger.json').write_text('{}')
            (source/'reports/published/report.docx').write_bytes(b'synthetic')
            actual=code.replace('"/source"',repr(str(source))).replace('"/backups"',repr(str(destination))).replace('"/tool.py"',repr(str(SCRIPT.parent/'stateful_backup.py')))
            for free,expected in [(128*1024*1024+1,2),(128*1024*1024+100000,0)]:
                prefix=f'import shutil; from types import SimpleNamespace; shutil.disk_usage=lambda _:SimpleNamespace(free={free})\n'
                result=subprocess.run(['python3','-c',prefix+actual],capture_output=True,text=True,check=False)
                self.assertEqual(result.returncode,expected,result.stderr)
                self.assertNotIn('Traceback',result.stderr)
                self.assertEqual((source/'state.bin').read_bytes(),data)
                self.assertEqual(list(destination.iterdir()),[])

    def test_unknown_worker_state_rejects_before_mutations(self):
        result,calls=self.run_window('worker-unknown',flag='--quiesce-worker')
        self.assertNotEqual(result.returncode,0)
        self.assertFalse(any(c[0] in {'kill','stop','start','run'} for c in calls))

    def test_owner_loss_guardian_restores_original_api_then_authorized_worker(self):
        result,calls=self.run_window('worker-running-owner-loss',flag='--quiesce-worker')
        self.assertNotEqual(result.returncode,0)
        self.assertIn(['stop','--time','75','a'*64],calls)
        self.assertEqual([c for c in calls if c[0]=='start'],[['start','a'*64],['start','b'*64]])

    def test_drain_timeout_never_claims_a_term_pending_worker_as_restored(self):
        result,calls=self.run_window('worker-running-drain-timeout',flag='--quiesce-worker')
        self.assertNotEqual(result.returncode,0)
        self.assertIn('BACKUP_WORKER_DRAIN_TIMEOUT',result.stderr)
        self.assertEqual(sum(c==['kill','--signal','TERM','b'*64] for c in calls),2)
        self.assertFalse(any(c[0]=='stop' for c in calls))
        self.assertEqual([c for c in calls if c[0]=='start'],[['start','a'*64],['start','b'*64]])

    def test_workflow_stdin_prepare_recovers_from_exact_candidate_script(self):
        result,calls=self.run_window('worker-running-backup-failed',flag='--quiesce-worker',via_stdin=True)
        self.assertNotEqual(result.returncode,0)
        self.assertIn(['kill','--signal','TERM','b'*64],calls)
        self.assertEqual([c for c in calls if c[0]=='start'],[['start','a'*64],['start','b'*64]])

    def test_private_record_captures_actual_was_running_not_forged_environment(self):
        result,calls=self.run_window('normal',flag='--quiesce-worker')
        self.assertIs(result.runtime['worker_was_running'],False)
        self.assertIs(result.runtime['authorized_quiesce'],True)
        self.assertEqual(result.runtime['worker_image'],'sha256:'+'e'*64)
        self.assertEqual([c for c in calls if c[0]=='start'],[['start','a'*64]])

    def test_invalid_optional_worker_image_has_private_error_boundary(self):
        result,calls=self.run_window('invalid-record-image','resume')
        self.assertNotEqual(result.returncode,0)
        self.assertIn('BACKUP_RUNTIME_RECORD_UNAVAILABLE',result.stderr)
        self.assertNotIn('Traceback',result.stderr)
        self.assertEqual(calls,[])

    def test_foreign_exclusive_maintenance_owner_prevents_quiescence(self):
        with tempfile.TemporaryDirectory() as tmp:
            marker=Path(tmp)/'owned'
            owner=subprocess.Popen(['bash','-c', '. "$1"; maintenance_lock_acquire || exit 1; touch "$2"; while [ -f "$2" ]; do /bin/sleep .02; done', 'foreign-owner', str(SCRIPT.parent/'maintenance-lock.sh'),str(marker)],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
            try:
                for _ in range(100):
                    if marker.exists(): break
                    time.sleep(.01)
                self.assertTrue(marker.exists())
                result,calls=self.run_window('worker-running',flag='--quiesce-worker')
                self.assertNotEqual(result.returncode,0)
                self.assertFalse(any(c[0] in {'kill','stop','start','run'} for c in calls))
            finally:
                marker.unlink(missing_ok=True); owner.wait(timeout=3)

    def test_missing_runtime_record_has_private_error_boundary(self):
        result = subprocess.run(['bash', str(SCRIPT), 'resume', 'd' * 40, '1', str(SCRIPT.parents[1]),
                                 '/tmp/nonexistent-private-window'], capture_output=True, text=True, check=False)
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn('/tmp/nonexistent-private-window', result.stderr)
        self.assertNotIn('Traceback', result.stderr)


if __name__ == '__main__':
    unittest.main()
