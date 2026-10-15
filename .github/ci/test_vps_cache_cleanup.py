"""Exercise cache-only maintenance with synthetic Docker state, never a VPS."""
import ast
import hashlib
import json
import os
import subprocess
import sys
import tempfile
import textwrap
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[2] / "deploy" / "cleanup-build-cache.sh"


class HostReserveTests(unittest.TestCase):
    def exercise(self, scenario):
        import contextlib
        import io
        from unittest.mock import patch
        workflow = (SCRIPT.parents[1] / '.github/workflows/vps-cache-cleanup.yml').read_text()
        self.assertTrue("<<'PYRESERVE'" in workflow, 'Missing bounded host reserve maintenance')
        program = textwrap.dedent(workflow.split("<<'PYRESERVE'\n", 1)[1].split('\n            PYRESERVE', 1)[0])
        changed = []
        def command(args, **kwargs):
            if args[0] == 'findmnt':
                return json.dumps({'filesystems': [{'source': '/dev/other' if scenario == 'device' else '/dev/vda2',
                    'fstype': 'xfs' if scenario == 'filesystem' else 'ext4'}]})
            if args[:2] == ['docker', 'inspect']:
                return json.dumps([{'Id': str(i), 'Image': 'verified', 'RestartCount': 0, 'Mounts': [],
                    'Config': {}, 'State': {'Status': 'exited' if i == 3 else 'running', 'StartedAt': 'fixed'}} for i in range(4)])
            if args[:2] == ['tune2fs', '-l']:
                reserved = 100 if changed or scenario == 'already' else 2000 if scenario == 'ratio' else 500
                return f'Block count: 10000\nReserved block count: {reserved}\nBlock size: 4096\n'
            if args[:2] == ['tune2fs', '-r']:
                changed.append(args);return ''
            raise AssertionError(args)
        with tempfile.TemporaryDirectory() as temporary:
            lock = Path(temporary) / 'lock';lock.touch()
            program = program.replace('/run/lock/aemr-maintenance.lock', str(lock))
            with patch('subprocess.check_output', side_effect=command), patch('os.geteuid', return_value=0), \
                 contextlib.redirect_stdout(io.StringIO()) as output:
                if scenario in ('filesystem', 'device', 'ratio'):
                    with self.assertRaises(SystemExit):exec(compile(program, '<reserve-fixture>', 'exec'), {})  # noqa: S102 - reviewed local workflow fixture
                else:
                    exec(compile(program, '<reserve-fixture>', 'exec'), {})  # noqa: S102 - reviewed local workflow fixture
                    self.assertIn('HOST_RESERVE_', output.getvalue())
        self.assertEqual(changed, [['tune2fs', '-r', '100', '/dev/vda2']] if scenario == 'valid' else [])

    def test_only_verified_default_ext4_reserve_is_reduced_to_one_percent(self):
        for scenario in ('valid', 'already'):
            with self.subTest(scenario=scenario):self.exercise(scenario)

    def test_unknown_filesystem_device_or_reservation_is_not_changed(self):
        for scenario in ('filesystem', 'device', 'ratio'):
            with self.subTest(scenario=scenario):self.exercise(scenario)


class ReleaseFailureEvidenceTests(unittest.TestCase):
    def programs(self):
        import re
        workflow = (SCRIPT.parents[1] / '.github/workflows/vps-cache-cleanup.yml').read_text()
        self.assertTrue('      - name: Preserve bounded private release failure evidence\n' in workflow)
        step = workflow.split('      - name: Preserve bounded private release failure evidence\n', 1)[1]
        programs = re.findall(r"python3 - <<'PY'[^\n]*\n(.*?)\n          PY", step, re.DOTALL)
        self.assertEqual(len(programs), 2, 'Private failure evidence must survive runner cleanup')
        cleanup = step.split('      - name: Remove private runner state and credentials\n', 1)[1]
        self.assertIn('if: always()', cleanup)
        return [textwrap.dedent(program) for program in reversed(programs)]

    def test_only_known_failure_codes_are_public_and_private_credentials_are_not_copied(self):
        import contextlib
        import io
        from unittest.mock import patch
        private, public = self.programs()
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary) / 'release';root.mkdir()
            (root / 'stage.log').write_text('RELEASE_SAVED_RUNTIME_MISMATCH\nPRIVATE_BEARER_VALUE\nRELEASE_UNKNOWN_PRIVATE_VALUE\n')
            (root / 'key').write_text('PRIVATE_SSH_VALUE')
            (root / '.env.production').write_text('PRIVATE_ENV_VALUE')
            with patch.dict(os.environ, {'RUNNER_TEMP': temporary}), contextlib.redirect_stdout(io.StringIO()) as output:
                exec(compile(private, '<private-evidence-fixture>', 'exec'), {})  # noqa: S102 - trusted local workflow
            value = json.loads(output.getvalue())
            self.assertEqual(set(value), {'stage.log'})
            self.assertIn('PRIVATE_BEARER_VALUE', value['stage.log'])  # Preserved only in root-private transport.
            with patch.dict(os.environ, {'RUNNER_TEMP': temporary}), contextlib.redirect_stdout(io.StringIO()) as output:
                exec(compile(public, '<public-evidence-fixture>', 'exec'), {})  # noqa: S102 - trusted local workflow
            self.assertEqual(output.getvalue(), 'PRIVATE_RELEASE_FAILURE_CODE=RELEASE_SAVED_RUNTIME_MISMATCH\n')

    def test_private_log_capture_is_bounded(self):
        import contextlib
        import io
        from unittest.mock import patch
        private, _ = self.programs()
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary) / 'release';root.mkdir()
            for index in range(40):(root / f'{index:02}.log').write_text('x' * 200000)
            with patch.dict(os.environ, {'RUNNER_TEMP': temporary}), contextlib.redirect_stdout(io.StringIO()) as output:
                exec(compile(private, '<bounded-evidence-fixture>', 'exec'), {})  # noqa: S102 - trusted local workflow
            value = json.loads(output.getvalue())
            self.assertEqual(len(value), 32)
            self.assertTrue(all(len(body) == 131072 for body in value.values()))


class CacheCleanupTests(unittest.TestCase):
    def run_cleanup(self, scenario="normal"):
        self.assertTrue(SCRIPT.is_file(), "Missing cache-only maintenance implementation")
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            trace = root / "trace.jsonl"
            docker = root / "docker"
            docker.write_text("""#!/usr/bin/env python3
import json, os, sys
from pathlib import Path
args = sys.argv[1:]
trace = Path(os.environ['CACHE_TEST_TRACE'])
previous = trace.read_text() if trace.exists() else ''
with trace.open('a') as stream:
    stream.write(json.dumps(args) + '\\n')
scenario = os.environ['CACHE_TEST_SCENARIO']
if args[:2] == ['ps', '--all']:
    print('synthetic-container')
    if scenario == 'oneoff' and 'label=com.docker.compose.oneoff=False' not in args:
        print('transient-container')
elif args[0] == 'inspect':
    if args[-1] == 'transient-container' and 'prune' in previous:
        sys.exit(2)
    if scenario == 'unreadable':
        sys.exit(2)
    changed = scenario == 'changed' and 'prune' in previous
    mounts = [{'Destination': '/a', 'Source': '/private/a'}, {'Destination': '/b', 'Source': '/private/b'}]
    if scenario == 'mount-order' and 'prune' in previous:
        mounts.reverse()
    if scenario == 'mount-changed' and 'prune' in previous:
        mounts[0]['Source'] = '/private/replaced'
    print(('different' if changed else 'synthetic') + '|image|running|' + json.dumps(mounts))
elif args[:2] == ['image', 'ls']:
    print('sha256:synthetic rollback:previous')
elif args[:2] == ['builder', 'prune']:
    if scenario == 'prune-failed':
        sys.exit(2)
    print('Total reclaimed space: 5GB')
elif args[:2] == ['system', 'df']:
    print('Build Cache: synthetic')
else:
    sys.exit(3)
""")
            docker.chmod(0o700)
            result = subprocess.run(['bash', str(SCRIPT)], capture_output=True,
                                    text=True, timeout=10, check=False,
                                    env={**os.environ, "PATH": tmp + os.pathsep + os.environ['PATH'],
                                         "CACHE_TEST_TRACE": str(trace),
                                         "CACHE_TEST_SCENARIO": scenario})
            calls = [json.loads(line) for line in trace.read_text().splitlines()] if trace.exists() else []
            return result, calls

    def test_only_regenerable_build_cache_is_removed_and_protected_state_is_rechecked(self):
        result, calls = self.run_cleanup()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('CACHE_ONLY_CLEANUP_PASS', result.stdout)
        self.assertEqual([call for call in calls if 'prune' in call],
                         [['builder', 'prune', '--all', '--force']])
        self.assertGreaterEqual(sum(call[0] == 'inspect' for call in calls), 2)
        self.assertFalse(any(call[0] in {'rm', 'rmi', 'stop', 'start', 'restart', 'volume'}
                             for call in calls))

    def test_mount_serialization_order_does_not_trigger_false_state_change(self):
        result, _ = self.run_cleanup('mount-order')
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_actual_mount_change_still_blocks_success(self):
        result, _ = self.run_cleanup('mount-changed')
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn('CACHE_ONLY_CLEANUP_PASS', result.stdout)

    def test_unreadable_protected_state_refuses_cleanup(self):
        result, calls = self.run_cleanup('unreadable')
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(any('prune' in call for call in calls))

    def test_changed_protected_state_cannot_be_reported_as_success(self):
        result, _ = self.run_cleanup('changed')
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn('CACHE_ONLY_CLEANUP_PASS', result.stdout)

    def test_failed_prune_cannot_be_reported_as_success(self):
        result, _ = self.run_cleanup('prune-failed')
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn('CACHE_ONLY_CLEANUP_PASS', result.stdout)

    def test_disappearing_oneoff_rehearsal_does_not_hide_stable_service_readback(self):
        result, _ = self.run_cleanup('oneoff')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('CACHE_ONLY_CLEANUP_PASS', result.stdout)


class SupersededBackupTests(unittest.TestCase):
    def exercise(self, scenario):
        workflow = SCRIPT.parents[1] / '.github/workflows/vps-cache-cleanup.yml'
        program = textwrap.dedent(workflow.read_text().split("sudo -n python3 -I - <<'PY'\n", 1)[1]
                                  .split('\n            PY\n', 1)[0])
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            base = root / 'backups'
            retained = base / 'worker-38349415596/backup'
            retained.mkdir(parents=True)
            content = b'accepted complete archive'
            (retained / 'state.tar.gz').write_bytes(content)
            (retained / 'manifest.json').write_text(json.dumps({'format': 2,
                'archive_bytes': len(content), 'archive_sha256': hashlib.sha256(content).hexdigest()}))
            originals = []
            for run in ('worker-38171945386', 'worker-38178244703'):
                folder = base / run / 'backup'
                folder.mkdir(parents=True)
                target = folder / 'state.tar.gz'
                target.write_bytes(b'old redundant archive')
                (folder / 'manifest.json').write_bytes(b'keep audit receipt')
                originals.append(target)
            (root / 'runtime').mkdir()
            (root / 'lock').touch()
            if scenario == 'corrupt-retained':
                (retained / 'state.tar.gz').write_bytes(b'x' * len(content))
            elif scenario == 'pending':
                (root / 'runtime/pending-release.json').touch()
            elif scenario == 'quiescent':
                (base / 'worker-38171945386/quiescent').touch()
            elif scenario in ('symlink-second', 'dangling-second'):
                originals[1].unlink()
                originals[1].symlink_to(retained / 'state.tar.gz' if scenario == 'symlink-second' else root / 'missing')
            elif scenario == 'dangling-parent-second':
                folder = originals[1].parent
                saved = folder.with_name('saved-receipt')
                folder.rename(saved)
                folder.symlink_to(root / 'missing-directory', target_is_directory=True)
                originals[1] = saved / 'state.tar.gz'
            program = (program.replace('/home/aemr/.dash-private-backups', str(base))
                       .replace('/var/lib/aemr', str(root / 'runtime'))
                       .replace('/run/lock/aemr-maintenance.lock', str(root / 'lock'))
                       .replace('4589649313', str(len(content)))
                       .replace('2_000_000_000', '0').replace('3_000_000_000', '1000'))
            result = subprocess.run([sys.executable, '-I', '-'], input=program, text=True,
                                    capture_output=True, timeout=10, check=False)
            if scenario == 'valid':
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual(json.loads(result.stdout)['removed'], 2)
                self.assertTrue(all(not p.exists() for p in originals))
            else:
                self.assertNotEqual(result.returncode, 0)
                self.assertIn('AssertionError', result.stderr)
                self.assertTrue(all(p.exists() or p.is_symlink() for p in originals))
            self.assertTrue((retained / 'state.tar.gz').exists())
            self.assertTrue(all(p.with_name('manifest.json').read_bytes() == b'keep audit receipt'
                                for p in originals))

    def test_exact_old_blobs_only_and_retained_archive_and_receipts_survive(self):
        self.exercise('valid')

    def test_refuse_before_any_delete_when_retained_proof_or_custody_is_invalid(self):
        for scenario in ('corrupt-retained', 'pending', 'quiescent', 'symlink-second', 'dangling-second', 'dangling-parent-second'):
            with self.subTest(scenario=scenario):
                self.exercise(scenario)


class WeeklyTransientMaintenanceTests(unittest.TestCase):
    def program(self):
        root = SCRIPT.parents[1]
        workflow = (root / '.github/workflows/vps-cache-cleanup.yml').read_text()
        block = workflow[workflow.index('  attempt-payloads:'):workflow.index('  cache-only:')]
        host = textwrap.dedent(block.split("<<'PYMAINT'\n", 1)[1].rsplit('\n            PYMAINT', 1)[0])
        return next(ast.literal_eval(node.value) for node in ast.walk(ast.parse(host))
                    if isinstance(node, ast.Assign) and any(isinstance(t, ast.Name) and t.id == 'program'
                                                           for t in node.targets))

    def test_actual_data_process_holds_ex_on_readonly_open_lock_until_exit(self):
        import fcntl
        with tempfile.TemporaryDirectory() as temporary:
            lock = Path(temporary) / 'maintenance.lock'
            lock.touch()
            prefix = self.program().split("for module in", 1)[0].replace('/maintenance.lock', str(lock))
            child = subprocess.Popen([sys.executable, '-I', '-c', prefix + "print('READY',flush=True);sys.stdin.read()"],
                                     stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            try:
                self.assertEqual(child.stdout.readline().strip(), 'READY')
                with lock.open('r+') as competing:
                    with self.assertRaises(BlockingIOError):
                        fcntl.flock(competing, fcntl.LOCK_EX | fcntl.LOCK_NB)
                    child.stdin.close()
                    self.assertEqual(child.wait(timeout=3), 0)
                    fcntl.flock(competing, fcntl.LOCK_EX | fcntl.LOCK_NB)
            finally:
                if child.poll() is None:child.kill();child.wait(timeout=3)
                child.stdout.close();child.stderr.close()

    def test_cold_isolated_bootstrap_preserves_weekly_and_current_before_compaction(self):
        root = SCRIPT.parents[1]
        sys.path.insert(0, str(root / 'packages/report-engine/tests'))
        from test_weekly_archive import complete_attempt
        program = self.program()
        with tempfile.TemporaryDirectory() as temporary:
            state, _ = complete_attempt(Path(temporary))
            (state / 'run.lock').touch()
            maintenance_lock = Path(temporary) / 'maintenance.lock'
            maintenance_lock.touch()
            original = state / 'attempts/attempt-1/status.json'
            frozen_status = original.read_bytes()
            for index in range(4):
                folder = state / 'attempts' / f'non-weekly-{index}'
                (folder / 'bundle').mkdir(parents=True)
                (folder / 'bundle/payload').write_bytes(b'synthetic duplicate payload')
                (folder / 'status.json').write_text(json.dumps({'attempt_id': folder.name,
                    'report_date': '29.09.2034', 'finished_at': f'2034-09-29T00:00:0{index}Z'}))
            (state / 'status.json').write_text('{"attempt_id":"non-weekly-3"}')
            program = (program.replace('/memory-patch/', str(root / 'packages/report-engine/src/procurement_engine') + '/')
                       .replace('/app/packages/server/data/reports', str(state))
                       .replace('/maintenance.lock', str(maintenance_lock)))
            result = subprocess.run([sys.executable, '-B', '-c', program], capture_output=True,
                                    text=True, timeout=30, check=False)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertTrue((state / 'archives/WEEKLY-2034-09-28').is_dir())
            self.assertEqual(original.read_bytes(), frozen_status)
            self.assertFalse((state / 'attempts/non-weekly-0/bundle').exists())
            self.assertTrue((state / 'attempts/non-weekly-2/bundle').is_dir())
            self.assertTrue((state / 'attempts/non-weekly-3/bundle').is_dir())
            self.assertEqual(json.loads(result.stdout.splitlines()[0]), {'weekly_recovery_status_counts': {'SEALED': 1}})


if __name__ == '__main__':
    unittest.main()
