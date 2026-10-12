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
    def run_window(self, scenario, mode='prepare'):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            repo, base = root / 'repo', root / 'private'
            (repo / 'deploy').mkdir(parents=True)
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
    if '.State.Health' in fmt: print('unhealthy' if scenario=='unhealthy' else 'healthy')
    elif '.State.Status' in fmt:
        print(('running' if scenario=='worker-running' else 'exited') if args[-1]==worker else ('exited' if old.rfind('"stop"') > old.rfind('"start"') or os.environ['WINDOW_MODE']=='match-source' else 'running'))
    elif '.Image' in fmt: print('sha256:'+'c'*64)
    else: print('synthetic_data')
elif args[0]=='run':
    if scenario=='match-watchdog':
        Path(os.environ['WINDOW_MARKER']).unlink()
        sys.exit(0)
    sys.exit(2)
elif args[0] in {'stop','start'}: pass
else: sys.exit(3)
''')
            docker.chmod(0o700)
            git = root / 'git'
            git.write_text('#!/bin/sh\ncase "$*" in *deploy/maintenance-lock.sh*) cat "$WINDOW_HELPER";; esac\nexit 0\n')
            git.chmod(0o700)
            for name in ('sleep',):
                command = root / name
                command.write_text('#!/bin/sh\nexit 0\n')
                command.chmod(0o700)
            guardian = None
            session = base / 'worker-1'
            if mode != 'prepare':
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
                    'volume': 'synthetic_data', 'image': 'sha256:' + 'c' * 64, 'candidate': 'd' * 40}))
            result = subprocess.run(['bash', str(SCRIPT), mode, 'd' * 40, '1', str(repo), str(base)],
                                    capture_output=True, text=True, timeout=15, check=False,
                                    env={**os.environ, 'PATH': tmp + os.pathsep + os.environ['PATH'],
                                         'WINDOW_TRACE': str(trace), 'WINDOW_SCENARIO': scenario, 'WINDOW_MODE': mode,
                                         'WINDOW_MARKER': str(base / 'worker-1/quiescent'),
                                         'WINDOW_HELPER': str(SCRIPT.parent / 'maintenance-lock.sh')})
            # A failed health check intentionally retains quiescence. Clean up only
            # the synthetic window after assertions can inspect its command trace.
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

    def test_missing_runtime_record_has_private_error_boundary(self):
        result = subprocess.run(['bash', str(SCRIPT), 'resume', 'd' * 40, '1', str(SCRIPT.parents[1]),
                                 '/tmp/nonexistent-private-window'], capture_output=True, text=True, check=False)
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn('/tmp/nonexistent-private-window', result.stderr)
        self.assertNotIn('Traceback', result.stderr)


if __name__ == '__main__':
    unittest.main()
