"""Exercise cache-only maintenance with synthetic Docker state, never a VPS."""
import json
import os
import subprocess
import tempfile
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
elif args[0] == 'inspect':
    if scenario == 'unreadable':
        sys.exit(2)
    changed = scenario == 'changed' and 'prune' in previous
    print('different-state' if changed else 'synthetic-protected-state')
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


if __name__ == '__main__':
    unittest.main()
