"""Exercise maintenance failure recovery using synthetic Docker, never production."""
import hashlib
import json
import os
import subprocess
import sys
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
    if 'BACKUP_SPACE_BUDGET_ADMITTED' in ' '.join(args) or 'BACKUP_PREFLIGHT_OK' in ' '.join(args): sys.exit(2 if scenario=='worker-running-capacity' else 0)
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
                    if scenario.startswith('never-entered-declined'):
                        (session / 'guardian-ready').write_text('999999999')
                        marker=session/'not-entered'
                        marker.write_text('d'*40+':1\n')
                        if scenario.endswith('-guardian-symlink'):
                            ready=session/'guardian-ready'; ready.unlink(); ready.symlink_to(root/'missing')
                        if scenario.endswith('-wrong'): marker.write_text('e'*40+':1\n')
                        if scenario.endswith('-prepared'): (session/'prepared').touch()
                        if scenario=='never-entered-declined-symlink':
                            marker.unlink(); marker.symlink_to(root/'missing')
                    elif scenario == 'never-entered':
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
            result.not_entered=(session/'not-entered').read_text() if (session/'not-entered').is_file() else None
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
        self.assertTrue(any(c[0]=='run' and 'BACKUP_SPACE_BUDGET_ADMITTED' in ' '.join(c) for c in calls))
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

    def test_space_admission_does_not_read_or_compress_the_live_volume(self):
        _,calls=self.run_window('worker-running-capacity',flag='--quiesce-worker')
        call=next(c for c in calls if c[0]=='run' and any(token in ' '.join(c) for token in ('BACKUP_SPACE_BUDGET_ADMITTED','BACKUP_PREFLIGHT_OK')))
        self.assertFalse(any('dst=/source' in a or 'dst=/tool.py' in a for a in call))
        code=call[call.index('-c')+1]
        self.assertNotIn('inventory',code)
        self.assertNotIn('_stream_compressed',code)
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)
            actual=code.replace('"/backups"',repr(str(root)))
            for free,expected in [(4*1024**3-1,2),(4*1024**3,0)]:
                prefix=f'import shutil; from types import SimpleNamespace; shutil.disk_usage=lambda _:SimpleNamespace(free={free})\n'
                result=subprocess.run(['python3','-c',prefix+actual],capture_output=True,text=True,check=False)
                self.assertEqual(result.returncode,expected,result.stderr)
                self.assertNotIn('Traceback',result.stderr)
                self.assertEqual(list(root.iterdir()),[])

    def test_single_frozen_capture_uses_fast_compression_and_one_gib_reserve(self):
        _,calls=self.run_window('worker-running-backup-failed',flag='--quiesce-worker')
        captures=[c for c in calls if c[0]=='run' and '/tool.py' in c and 'create' in c]
        self.assertEqual(len(captures),1)
        capture=captures[0]
        self.assertIn('--compression-level',capture)
        self.assertEqual(capture[capture.index('--compression-level')+1],'1')
        self.assertEqual(capture[capture.index('--reserve-bytes')+1],str(1024**3))
        self.assertLess(calls.index(['stop','--time','75','a'*64]),calls.index(capture))

    def test_declined_budget_records_no_runtime_transition(self):
        result,calls=self.run_window('worker-running-capacity',flag='--quiesce-worker')
        self.assertEqual(result.not_entered,'d'*40+':1\n')
        self.assertFalse(any(c[0] in {'kill','stop','start'} for c in calls))

    def test_declined_window_resume_after_guardian_exit_is_noop(self):
        result,calls=self.run_window('never-entered-declined','resume')
        self.assertEqual(result.returncode,0,result.stderr)
        self.assertIn('BACKUP_WINDOW_NOT_ENTERED',result.stdout)
        self.assertEqual(calls,[])
        for suffix in ('wrong','prepared','symlink','guardian-symlink'):
            with self.subTest(suffix=suffix):
                result,calls=self.run_window('never-entered-declined-'+suffix,'resume')
                self.assertNotEqual(result.returncode,0)
                self.assertNotIn('BACKUP_WINDOW_NOT_ENTERED',result.stdout)
                self.assertEqual(calls,[])

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


class ReleaseGuardianTests(unittest.TestCase):
    def test_request_resume_without_session_does_not_require_migrated_backup_base(self):
        self.run_unopened_release_resume(session_exists=False)

    def test_request_resume_existing_session_still_rejects_untrusted_backup_base(self):
        self.run_unopened_release_resume(session_exists=True)

    def test_request_resume_missing_session_does_not_hide_unsafe_paths(self):
        for unsafe in ('base-file', 'session-dangling-symlink'):
            with self.subTest(unsafe=unsafe), tempfile.TemporaryDirectory() as folder:
                root = Path(folder)
                repo, base = root / 'repo', root / 'backups'
                (repo / 'deploy').mkdir(parents=True)
                if unsafe == 'base-file':
                    base.touch(mode=0o600)
                else:
                    base.mkdir(mode=0o700)
                    (base / 'worker-1').symlink_to(root / 'absent')
                (root / 'id').write_text('#!/bin/sh\nprintf "0\\n"\n')
                (root / 'id').chmod(0o700)
                script = root / 'window.sh'
                script.write_text(SCRIPT.read_text().replace('/home/aemr/.dash-private-backups', str(base)))
                result = subprocess.run(['bash', str(script), 'request-resume', 'd' * 40, '1',
                                         str(repo), str(base), '--quiesce-worker', '--release-controller'],
                                        capture_output=True, text=True, timeout=5, check=False,
                                        env={**os.environ, 'PATH': str(root) + os.pathsep + os.environ['PATH']})
                self.assertNotEqual(result.returncode, 0)
                self.assertEqual(result.stderr.strip(), 'RELEASE_CANCEL_INVALID')
                self.assertNotIn('NO_OPEN_WINDOW', result.stdout)

    def run_unopened_release_resume(self, *, session_exists):
        # Preflight can fail before the installer migrates the legacy operator
        # backup directory. Exercise real ownership/mode checks without Docker,
        # a system lock, or trusting any record from that directory.
        for legacy in ('operator-owned', 'mode-0750'):
            with self.subTest(legacy=legacy), tempfile.TemporaryDirectory() as folder:
                root = Path(folder)
                repo, base = root / 'repo', root / 'backups'
                (repo / 'deploy').mkdir(parents=True)
                base.mkdir(mode=0o700)
                session = base / 'worker-1'
                if session_exists:
                    session.mkdir(mode=0o700)
                    (session / 'quiescent').touch(mode=0o600)
                if legacy == 'operator-owned' and os.geteuid() == 0:
                    os.chown(base, 1000, 1000)
                elif legacy == 'mode-0750':
                    base.chmod(0o750)
                # Only the entrypoint's id command is adapted for an unprivileged
                # runner; PYOPEN uses actual lstat ownership, never a fake stat.
                (root / 'id').write_text('#!/bin/sh\nprintf "0\\n"\n')
                (root / 'id').chmod(0o700)
                trace = root / 'unexpected-runtime-call'
                for name in ('docker', 'git'):
                    (root / name).write_text('#!/bin/sh\ntouch "' + str(trace) + '"\nexit 97\n')
                    (root / name).chmod(0o700)
                script = root / 'window.sh'
                script.write_text(SCRIPT.read_text().replace('/home/aemr/.dash-private-backups', str(base)))
                result = subprocess.run(['bash', str(script), 'request-resume', 'd' * 40, '1',
                                         str(repo), str(base), '--quiesce-worker', '--release-controller'],
                                        capture_output=True, text=True, timeout=5, check=False,
                                        env={**os.environ, 'PATH': str(root) + os.pathsep + os.environ['PATH']})
                self.assertFalse(trace.exists(), 'Unopened/invalid window invoked runtime or Git')
                self.assertEqual(session.exists(), session_exists)
                if session_exists:
                    self.assertNotEqual(result.returncode, 0)
                    self.assertEqual(result.stderr.strip(), 'RELEASE_CANCEL_INVALID')
                    self.assertTrue((session / 'quiescent').exists())
                    self.assertFalse((session / 'cancel-request.json').exists())
                else:
                    self.assertEqual(result.returncode, 0, result.stderr)
                    self.assertEqual(result.stdout.strip(), 'NO_OPEN_WINDOW')
                    self.assertEqual(result.stderr, '')

    def test_operator_cwd_module_cannot_execute_in_privileged_record_parser(self):
        if os.geteuid() != 0:
            result = subprocess.run(['unshare', '-Ur', sys.executable, str(Path(__file__).resolve()),
                                     'ReleaseGuardianTests.test_operator_cwd_module_cannot_execute_in_privileged_record_parser', '-q'],
                                    capture_output=True, text=True, timeout=10, check=False)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            return
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);repo=root/'repo';(repo/'deploy').mkdir(parents=True)
            base=root/'backups';session=base/'worker-1';session.mkdir(parents=True)
            for name in ('prepared','quiescent'):(session/name).touch()
            (session/'runtime.json').write_text('{}')
            marker=root/'unreviewed-root-execution'
            (repo/'deploy/json.py').write_text('from pathlib import Path\nPath('+repr(str(marker))+').write_text("executed")\n')
            result=subprocess.run(['bash',str(SCRIPT),'resume','d'*40,'1',str(repo),str(base)],
                                  capture_output=True,text=True,timeout=5,check=False,
                                  env={**os.environ,'PYTHONPATH':str(repo/'deploy')})
            self.assertFalse(marker.exists(), 'Unreviewed operator CWD/PYTHONPATH executed before the root record gate')
            self.assertNotEqual(result.returncode,0)
            self.assertIn('BACKUP_RUNTIME_RECORD_UNAVAILABLE',result.stderr)
            self.assertNotIn('Traceback',result.stderr)

    def test_real_root_namespace_cancellation_contract(self):
        if os.geteuid() != 0:
            result = subprocess.run(['unshare', '-Ur', sys.executable, str(Path(__file__).resolve()),
                                     'ReleaseGuardianTests.test_real_root_namespace_cancellation_contract', '-q'],
                                    capture_output=True, text=True, timeout=40, check=False)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            return
        for scenario in ('cancel-before-plan', 'cancel-armed', 'cancel-accepted', 'cancel-wrong-binding', 'cancel-late', 'cancel-stale-plan', 'cancel-dead-guardian', 'cancel-no-window', 'cancel-symlink', 'cancel-accepted-missing-plan', 'cancel-blocks-deploy'):
            with self.subTest(scenario=scenario):
                self.run_handoff(scenario)

    def test_real_root_namespace_handoff_contract(self):
        if os.geteuid() != 0:
            result = subprocess.run(['unshare', '-Ur', sys.executable, str(Path(__file__).resolve()),
                                     'ReleaseGuardianTests.test_real_root_namespace_handoff_contract', '-q'],
                                    capture_output=True, text=True, timeout=40, check=False)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            return
        for scenario in ('accepted', 'pre-arm-failure', 'armed-failure', 'wrong-plan', 'expired', 'changed-module', 'wrong-origin-status', 'prepare-plan', 'prepare-failure', 'prepare-plan-changed', 'prepare-untrusted-env'):
            with self.subTest(scenario=scenario):
                self.run_handoff(scenario)

    def run_handoff(self, scenario):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            repo, base = root / 'repo', root / 'backups'
            (repo / 'deploy').mkdir(parents=True)
            session = base / 'worker-1'
            session.mkdir(parents=True)
            state = root / 'state'
            state.mkdir(mode=0o700)
            runtime = state / 'release-runtime'
            runtime.mkdir(mode=0o700)
            tools = root / 'tools'
            tools.mkdir(mode=0o700)
            lock = root / 'lock'
            lock.touch(mode=0o600)
            trace = root / 'trace'
            for directory in (session, base):
                directory.chmod(0o700)
            source = SCRIPT.read_text().replace('/run/lock/aemr-maintenance.lock', str(lock))
            source = source.replace('/home/aemr/.dash-private-backups', str(base))
            source = source.replace('/var/lib/aemr', str(state)).replace('/usr/local/libexec/aemr', str(tools))
            script = root / 'window.sh'
            script.write_text(source)
            helper = (SCRIPT.parent / 'maintenance-lock.sh').read_text().replace('/run/lock/aemr-maintenance.lock', str(lock))
            (session / 'maintenance-lock.sh').write_text(helper)
            (session / 'quiescent').touch()
            (session / 'prepared').touch()
            (session / 'quiescent').chmod(0o600)
            (session / 'prepared').chmod(0o600)
            plan = {'format':'aemr-release-recovery-v1','release_sha':'d'*40,'manifest_sha256':'a'*64,
                    'images':{name:'sha256:'+str(i+1)*64 for i,name in enumerate(('server','web','report-worker','caddy'))},
                    'candidate_images':{name:'sha256:'+str(i+5)*64 for i,name in enumerate(('server','web','report-worker','caddy'))},
                    'config_sha256':{name:'b'*64 for name in ('compose.json','.env.production','Caddyfile','candidate-compose.json','candidate-Caddyfile')},
                    'backup_reference':'worker-1/backup','volume':'aemr_server_data','tool_sha256':'c'*64,
                    'original_running':{name:True for name in ('server','web','report-worker','caddy')},
                    'word':{'release_id':'REL-'+'e'*64,'sha256':{name:'f'*64 for name in ('main','supplement','operational')}}}
            bound={key:plan[key] for key in ('release_sha','manifest_sha256','images','config_sha256')}
            plan['proofs']={name:{**bound,'state':value} for name,value in {'full_restore':'VERIFIED_IN_SCRATCH','in_place_restore':'STATE_RESTORED','previous_runtime':'PREVIOUS_RUNTIME_COMPATIBLE'}.items()}
            def write(path, value):
                path.write_text(json.dumps(value));path.chmod(0o600)
            if scenario=='wrong-origin-status':plan['original_running']['report-worker']=False
            preparing = scenario.startswith('prepare-')
            cancelling = scenario.startswith('cancel-')
            if scenario=='cancel-before-plan':(session/'prepared').unlink()
            if scenario != 'cancel-before-plan':
                write(runtime/('base-plan.json' if preparing else 'trial-plan.json'),plan)
            write(session/'runtime.json',{'server':'1'*64,'worker':'3'*64,'volume':'aemr_server_data',
                  'image':plan['images']['server'],'worker_image':plan['images']['report-worker'],'candidate':plan['release_sha'],
                  'worker_was_running':True,'authorized_quiesce':True,'release_controller':True})
            plan_sha=hashlib.sha256(json.dumps(plan,sort_keys=True,separators=(',',':')).encode()).hexdigest()
            completion={'state':'RELEASE_RUNTIME_AND_STATE_RECOVERED','release_sha':plan['release_sha'],
                        'plan_sha256':plan_sha,'manifest_sha256':plan['manifest_sha256'],
                        'restored':{'state':'STATE_RESTORED','manifest_sha256':plan['manifest_sha256'],'files':6,'bytes':100,'sqlite_checked':1,'docx_checked':3}}
            if scenario=='cancel-armed':write(state/'pending-release.json',{'pending':True})
            if scenario.startswith('cancel-accepted'):
                write(state/'release-accepted.json',{'plan_sha256':plan_sha,'acceptance':{'state':'RELEASE_CANDIDATE_ACCEPTED',
                    'release_sha':plan['release_sha'],'manifest_sha256':plan['manifest_sha256'],
                    'candidate_images':plan['candidate_images'],'config_sha256':plan['config_sha256'],'word_sha256':plan['word']['sha256']}})
            if scenario=='cancel-accepted-missing-plan':(runtime/'trial-plan.json').unlink()
            if scenario=='cancel-stale-plan':
                stale=json.loads(json.dumps(plan));stale['release_sha']='e'*40
                for value in stale['proofs'].values():value['release_sha']=stale['release_sha']
                write(runtime/'trial-plan.json',stale)
            driver="""import json,os,sys;from pathlib import Path
root=Path(ROOT);trace=Path(TRACE)
assert 'FLOCK  ADVISORY  WRITE' in Path('/proc/self/fdinfo/9').read_text() or 'FLOCK ADVISORY WRITE' in Path('/proc/self/fdinfo/9').read_text()
if sys.argv[1]=='prepare':
 with trace.open('a') as f:f.write('PREPARE\\n')
 if SCENARIO=='prepare-failure':sys.exit(2)
 p=root/'release-runtime/trial-plan.json';p.write_text(json.dumps(json.load(sys.stdin)));p.chmod(0o600);sys.exit(0)
with trace.open('a') as f:f.write('DEPLOY\\n')
if SCENARIO=='armed-failure':(root/'pending-release.json').write_text('pending');sys.exit(2)
if SCENARIO=='pre-arm-failure':sys.exit(2)
(root/'release-recovered.json').write_text(json.dumps(COMPLETION));(root/'release-recovered.json').chmod(0o600)
""".replace('ROOT',repr(str(state))).replace('TRACE',repr(str(trace))).replace('SCENARIO',repr(scenario)).replace('COMPLETION',repr(completion))
            (tools/'release-controller.py').write_text(driver)
            recovery_source=(SCRIPT.parent/'release_recovery.py').read_text()
            recovery_source=recovery_source[:recovery_source.rindex("if __name__ == '__main__':")]
            recovery_source+='\nif __name__ == "__main__":\n'+(' root=Path('+repr(str(state))+'); trace=Path('+repr(str(trace))+')\n'
                ' with trace.open("a") as f:f.write("RECOVER\\n")\n'
                ' (root/"release-recovered.json").write_text(json.dumps('+repr(completion)+'))\n'
                ' (root/"release-recovered.json").chmod(0o600)\n'
                ' (root/"pending-release.json").unlink(missing_ok=True)\n')
            (tools/'release_recovery.py').write_text(recovery_source)
            for name in ('release_trial.py','stateful_backup.py','source_ci_gate.py'):
                (tools/name).write_text('# synthetic trusted module\n')
            pins={}
            for path in tools.iterdir():
                path.chmod(0o600);pins[path.name]=hashlib.sha256(path.read_bytes()).hexdigest()
            write(session/'release-window.json',{'format':'aemr-release-window-v1','candidate':plan['release_sha'],'run_id':'1',
                  'module_sha256':pins,'boot_id':Path('/proc/sys/kernel/random/boot_id').read_text().strip(),
                  'deadline_ns':time.monotonic_ns()+(0 if scenario=='cancel-late' else 800 if scenario=='expired' else 2700)*10**9})
            docker = root / 'docker'
            docker.write_text("""#!/usr/bin/env python3
import json,sys;from pathlib import Path
trace=Path(TRACE);args=sys.argv[1:]
with trace.open('a') as f:f.write(json.dumps(args)+'\\n')
if args[0]=='compose':print('1'*64 if args[-1]=='server' else '3'*64)
elif args[0]=='inspect':
 fmt=args[2]
 if '.State.Health' in fmt:print('healthy')
 elif '.Image' in fmt:print('sha256:'+('1' if args[-1]=='1'*64 else '3')*64)
 elif '.State.Status' in fmt:print('running' if trace.exists() and json.dumps(['start',args[-1]]) in trace.read_text() else 'exited')
 else:print('aemr_server_data')
elif args[0]=='start':pass
else:sys.exit(2)
""".replace('TRACE',repr(str(trace))))
            docker.chmod(0o700)
            environment={**os.environ,'PATH':str(root)+os.pathsep+os.environ['PATH']}
            unreviewed_marker=root/'unreviewed-cli-execution'
            if scenario=='prepare-untrusted-env':
                untrusted=root/'untrusted';untrusted.mkdir()
                (untrusted/'json.py').write_text('from pathlib import Path\nPath('+repr(str(unreviewed_marker))+').write_text("executed")\n')
                environment['PYTHONPATH']=str(untrusted)
            owner=subprocess.Popen(['bash','-c','umask 077; . "$1"; exec 9>"$2"; flock -n 9 || exit 2; echo $$ >"$3/guardian-ready"; read -r line; exec bash "$4" "$8" "$5" 1 "$6" "$7" --quiesce-worker --release-controller',
                 'actual-guardian',str(session/'maintenance-lock.sh'),str(lock),str(session),str(script),plan['release_sha'],str(repo),str(base),'resume-release' if cancelling and scenario!='cancel-blocks-deploy' else 'release-dispatch'],
                 stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,
                 env=environment)
            try:
                for _ in range(100):
                    if (session/'guardian-ready').exists():break
                    time.sleep(.01)
                self.assertTrue((session/'guardian-ready').exists())
                if scenario=='cancel-dead-guardian':owner.kill();owner.wait(timeout=5)
                if scenario=='cancel-no-window':(session/'quiescent').unlink()
                if scenario=='cancel-symlink':(session/'cancel-request.json').symlink_to(session/'runtime.json')
                request=subprocess.run(['bash',str(script),'request-resume' if cancelling else 'request-plan' if preparing else 'request-release',plan['release_sha'],'1',str(repo),str(base),'--quiesce-worker','--release-controller'],
                        capture_output=True,text=True,timeout=5,check=False,env=environment)
                if scenario=='cancel-dead-guardian':
                    self.assertNotEqual(request.returncode,0);self.assertIn('BACKUP_GUARDIAN_UNAVAILABLE',request.stderr);self.assertFalse((session/'cancel-request.json').exists());return
                if scenario=='cancel-no-window':
                    self.assertEqual(request.returncode,0,request.stderr);self.assertEqual(request.stdout.strip(),'NO_OPEN_WINDOW')
                    self.assertFalse((session/'cancel-request.json').exists());self.assertFalse(trace.exists());return
                if scenario=='cancel-symlink':
                    self.assertNotEqual(request.returncode,0);self.assertIn('RELEASE_CANCEL_INVALID',request.stderr);self.assertFalse(trace.exists());return
                if scenario in {'expired','wrong-origin-status'}:
                    self.assertNotEqual(request.returncode,0);self.assertFalse((runtime/'guardian-request.json').exists())
                else:
                    self.assertEqual(request.returncode,0,request.stderr)
                if scenario=='cancel-wrong-binding':
                    value=json.loads((session/'cancel-request.json').read_text());value['runtime_sha256']='0'*64;write(session/'cancel-request.json',value)
                if scenario=='wrong-plan':
                    value=json.loads((runtime/'guardian-request.json').read_text());value['plan_sha256']='0'*64;write(runtime/'guardian-request.json',value)
                if scenario=='changed-module':
                    with (tools/'release-controller.py').open('a') as f:f.write('# changed\n')
                if scenario=='prepare-plan-changed':
                    changed=json.loads((runtime/'base-plan.json').read_text());changed['manifest_sha256']='0'*64;write(runtime/'base-plan.json',changed)
                _stdout,_stderr=owner.communicate('\n',timeout=10)
                self.assertFalse(unreviewed_marker.exists(), 'Installed trusted CLI imported PYTHONPATH code')
                lines=trace.read_text().splitlines() if trace.exists() else []
                if cancelling:
                    self.assertNotIn('DEPLOY',lines);self.assertNotIn('PREPARE',lines)
                    starts=[json.loads(line) for line in lines if line.startswith('[') and json.loads(line)[0]=='start']
                    if scenario in {'cancel-wrong-binding','cancel-accepted-missing-plan','cancel-blocks-deploy'}:
                        self.assertNotEqual(owner.returncode,0);self.assertTrue((session/'quiescent').exists());self.assertEqual(starts,[])
                    else:
                        self.assertEqual(owner.returncode,0,_stderr);self.assertFalse((session/'quiescent').exists())
                        self.assertEqual('RECOVER' in lines,scenario=='cancel-armed')
                        self.assertEqual(starts,[] if scenario in {'cancel-armed','cancel-accepted'} else [['start','1'*64],['start','3'*64]])
                        self.assertFalse((session/'cancel-request.json').exists())
                elif scenario in {'wrong-plan','expired','changed-module','wrong-origin-status','prepare-plan-changed'}:
                    self.assertNotEqual(owner.returncode,0);self.assertNotIn('DEPLOY',lines)
                    self.assertNotIn('PREPARE',lines)
                    self.assertTrue((session/'quiescent').exists())
                elif preparing:
                    self.assertIn('PREPARE',lines);self.assertNotIn('DEPLOY',lines)
                    starts=[json.loads(line) for line in lines if line.startswith('[') and json.loads(line)[0]=='start']
                    if scenario=='prepare-failure':
                        self.assertNotEqual(owner.returncode,0);self.assertFalse((session/'quiescent').exists())
                        self.assertEqual(starts,[['start','1'*64],['start','3'*64]])
                    else:
                        self.assertEqual(owner.returncode,0,_stderr);self.assertTrue((session/'quiescent').exists())
                        self.assertEqual(starts,[]);self.assertEqual(json.loads((runtime/'trial-plan.json').read_text()),plan)
                    self.assertFalse((runtime/'guardian-request.json').exists())
                else:
                    self.assertIn('DEPLOY',lines)
                    self.assertFalse((session/'quiescent').exists())
                    starts=[json.loads(line) for line in lines if line.startswith('[') and json.loads(line)[0]=='start']
                    if scenario=='pre-arm-failure':self.assertEqual(starts,[['start','1'*64],['start','3'*64]])
                    else:self.assertEqual(starts,[])
                    self.assertEqual('RECOVER' in lines,scenario=='armed-failure')
            finally:
                if owner.poll() is None:owner.kill();owner.wait(timeout=5)


if __name__ == '__main__':
    unittest.main()
