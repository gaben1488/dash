"""Exercise cache-only maintenance with synthetic Docker state, never a VPS."""
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


if __name__ == '__main__':
    unittest.main()
