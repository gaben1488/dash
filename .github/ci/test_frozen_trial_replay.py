"""Diagnostic instrumentation preserves subprocess results and keeps bodies private."""
import importlib.util
import itertools
import json
import subprocess
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch


class FrozenTrialReplayTests(unittest.TestCase):
    def setUp(self):
        path = Path(__file__).with_name('frozen_trial_replay.py')
        self.assertTrue(path.is_file(), 'Missing transparent frozen trial replay')
        spec = importlib.util.spec_from_file_location('frozen_trial_replay', path)
        self.module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.module)

    def timed_trial(self, run):
        # Match native module/function names without changing any installed trial.
        namespace = {}
        exec(compile('def restore_state():\n return inventory()\ndef inventory():\n return None\n',  # noqa: S102 — synthetic profile fixture
                     '/private/stateful_backup.py', 'exec'), namespace)
        proof = {'state': 'TRUSTED_RELEASE_TRIAL_PASS', 'private_binding': 'PRIVATE_BINDING',
                 'full_restore': {'sqlite_checked': 2, 'docx_checked': 3}}
        def execute(plan):
            namespace['restore_state']()
            subprocess.run(['/usr/bin/docker', 'run', 'PRIVATE_IMAGE', 'PRIVATE_NATIVE_PROGRAM', 'candidate'],
                           input='PRIVATE_ENVIRONMENT', timeout=180, capture_output=True, check=False)
            subprocess.run(['/usr/bin/docker', 'run', 'PRIVATE_IMAGE', 'PRIVATE_NATIVE_PROGRAM', 'previous'],
                           timeout=180, capture_output=True, check=False)
            namespace['restore_state']()
            return proof
        with patch('subprocess.run', run):
            previous_profile = sys.getprofile()
            result = self.module.diagnose(SimpleNamespace(run=execute), {})
            self.assertIs(sys.getprofile(), previous_profile)
            self.assertIs(subprocess.run, run)
        return result, proof

    def test_runner_timing_distinguishes_two_restores_and_native_commands_without_measuring_transfer(self):
        calls = []
        def run(*args, **kwargs):
            calls.append((args, kwargs))
            return subprocess.CompletedProcess(args[0], 0, stdout='PRIVATE_BODY', stderr='')
        result, proof = self.timed_trial(run)
        self.assertIs(result['proof'], proof)
        timings = result['timings']
        self.assertEqual(timings['scope'], 'RUNNER_ONLY')
        self.assertEqual(timings['transfer'], 'NOT_MEASURED')
        restores = [item for item in timings['phases'] if item['phase'] == 'restore_state']
        self.assertEqual([item['call'] for item in restores], [1, 2])
        self.assertEqual([item['command'] for item in timings['commands']], ['candidate_native', 'previous_native'])
        self.assertTrue(all(item['returncode'] == 0 for item in timings['commands']))
        self.assertTrue(all(type(item['elapsed_ms']) is int and item['elapsed_ms'] >= 0
                            for item in [*timings['phases'], *timings['commands']]))
        self.assertEqual(calls[0][1], {'input': 'PRIVATE_ENVIRONMENT', 'timeout': 180, 'capture_output': True, 'check': False})
        self.assertEqual(len(calls), 2)
        public = json.dumps(self.module.public_summary(result))
        self.assertNotIn('PRIVATE', public)
        self.assertNotIn('network_ms', public)

    def test_raised_command_is_timed_without_replacing_error_or_leaking_argv(self):
        original = subprocess.TimeoutExpired(['PRIVATE_ARGV'], 180, output='PRIVATE_BODY', stderr='PRIVATE_ERROR')
        def run(*args, **kwargs):
            raise original
        result, _ = self.timed_trial(run)
        self.assertEqual(result['state'], 'FROZEN_TRIAL_REPLAY_FAILED')
        self.assertEqual(result['exception_type'], 'TimeoutExpired')
        self.assertIn('PRIVATE_ARGV', result['private_trace'])
        command = result['timings']['commands'][0]
        self.assertEqual(command['outcome'], 'RAISED')
        self.assertEqual(command['command'], 'candidate_native')
        self.assertNotIn('PRIVATE', json.dumps(self.module.public_summary(result)))

    def test_timing_storage_and_clock_anomalies_are_bounded_and_never_change_trial_proof(self):
        def run(*args, **kwargs):
            return subprocess.CompletedProcess(args[0], 0)
        backwards = itertools.count(1000, -1)
        oversized = itertools.count(0, 1_000_000)
        for clock in (lambda: float('nan'), lambda: float('inf'), lambda: -1,
                      lambda: 'PRIVATE_CLOCK', lambda: True, lambda: next(backwards), lambda: next(oversized)):
            with self.subTest(clock=clock), patch.object(self.module.time, 'monotonic', side_effect=clock):
                result, proof = self.timed_trial(run)
                self.assertIs(result['proof'], proof)
                self.assertIsNone(result['timings']['runner_elapsed_ms'])
                self.assertGreater(result['timings']['clock_anomalies'], 0)
                self.assertNotIn('PRIVATE', json.dumps(self.module.public_summary(result), allow_nan=False))
        namespace = {'subprocess': subprocess}
        exec(compile('def inventory():\n return subprocess.run(["PRIVATE_COMMAND"], check=False)\n',  # noqa: S102 — synthetic profile fixture
                     '/private/stateful_backup.py', 'exec'), namespace)
        def execute(plan):
            for _ in range(200):
                namespace['inventory']()
            return {'full_restore': {'sqlite_checked': 0, 'docx_checked': 0}}
        with patch('subprocess.run', run):
            result = self.module.diagnose(SimpleNamespace(run=execute), {})
        self.assertLessEqual(len(result['timings']['phases']), 64)
        self.assertLessEqual(len(result['timings']['commands']), 64)
        self.assertGreater(result['timings']['dropped_phases'], 0)
        self.assertGreater(result['timings']['dropped_commands'], 0)
        result['timings']['commands'][0] = {'command': 'PRIVATE_ARGV', 'phase': 'PRIVATE_PATH',
                                           'elapsed_ms': float('inf'), 'outcome': 'PRIVATE_ERROR'}
        result['timings']['commands'][1]['elapsed_ms'] = float('nan')
        result['timings']['phases'][0]['phase'] = 'PRIVATE_PATH'
        self.assertNotIn('PRIVATE', json.dumps(self.module.public_summary(result), allow_nan=False))

    def test_public_timing_projection_rejects_malformed_collection_and_unhashable_labels(self):
        for collection in (None, {}, 'PRIVATE_COLLECTION'):
            with self.subTest(collection=collection):
                result = self.module.public_timings({'phases': collection, 'commands': collection})
                self.assertEqual(result['phases'], [])
                self.assertEqual(result['commands'], [])
        phases = [{'phase': value, 'elapsed_ms': float('nan')} for value in (None, [], {}, 'PRIVATE_PHASE')]
        commands = [{'phase': 'entry', 'command': command, 'outcome': outcome}
                    for command, outcome in (([], 'RETURNED'), ({}, 'RETURNED'),
                                             ('other', []), ('other', {}), ('other', None))]
        commands.append({'phase': [], 'command': 'other', 'outcome': 'RETURNED'})
        result = self.module.public_timings({'phases': phases, 'commands': commands})
        self.assertEqual(result['phases'], [])
        self.assertEqual(result['commands'], [])
        self.assertNotIn('PRIVATE', json.dumps(result, allow_nan=False))

    def test_failed_subprocess_is_preserved_privately_without_changing_its_result(self):
        class Trial:
            def run(self, plan):
                value = subprocess.run([sys.executable, '-c', "import sys;sys.stderr.write('PRIVATE_SENTINEL');sys.exit(7)"], capture_output=True, text=True, check=False)
                self.returncode = value.returncode
                raise ValueError('PRIVATE_SENTINEL')
        trial = Trial()
        result = self.module.diagnose(trial, {})
        self.assertEqual(trial.returncode, 7)
        self.assertEqual(result['process_failures'][0]['stderr'], 'PRIVATE_SENTINEL')
        self.assertEqual(result['timings']['commands'][0]['returncode'], 7)
        self.assertNotIn('PRIVATE_SENTINEL', json.dumps(self.module.public_summary(result)))
        self.assertEqual(result['state'], 'FROZEN_TRIAL_REPLAY_FAILED')

    def test_native_failure_code_survives_redaction_without_private_body(self):
        result = {'state':'FROZEN_TRIAL_REPLAY_FAILED','phase':'inventory',
                  'process_failures':[{'stderr':'PRIVATE_DETAIL\nNATIVE_TRIAL_FAILURE=historyschema\n'
                    'NATIVE_TRIAL_FAILURE=word PRIVATE_DETAIL\nNATIVE_TRIAL_FAILURE=PRIVATE_DETAIL\n'}]}
        public = self.module.public_summary(result)
        self.assertEqual(public.get('native_failure_codes'),['historyschema'])
        self.assertNotIn('PRIVATE_DETAIL',json.dumps(public))

    def test_read_only_ssh_cannot_consume_the_remaining_image_list(self):
        import os
        import tempfile
        import textwrap
        workflow = Path(__file__).parents[1] / 'workflows/vps-cache-cleanup.yml'
        step = workflow.read_text().split('      - name: Read exact existing immutable images without changing VPS runtime\n', 1)[1]
        program = textwrap.dedent(step.split('        run: |\n', 1)[1].split('      - name:', 1)[0])
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary) / 'release';root.mkdir()
            images = ['sha256:' + str(index) * 64 for index in range(1, 6)]
            (root / 'images.txt').write_text('\n'.join(images) + '\n')
            # Real child stdin drain models ssh's default stdin forwarding.
            (root / 'ssh.sh').write_text("""remote() { cat >/dev/null; printf '%s\\n' "$*" >>"$RUNNER_TEMP/release/transferred"; printf archive; }
            docker() { if test "$1" = load; then cat >/dev/null; else printf '%s\\n' "$3"; fi; }
            """)
            subprocess.run(['bash', '-euo', 'pipefail', '-c', program],
                           env={**os.environ, 'RUNNER_TEMP':temporary}, check=True, capture_output=True, text=True)
            transferred = (root / 'transferred').read_text().splitlines()
            self.assertEqual(len(transferred), len(images), 'ssh consumed the batch input; only its first image reached the runner')
            self.assertTrue(all(any(image in call for call in transferred) for image in images))

    def test_cli_proof_mode_preserves_release_binding_and_failed_runs_remain_private(self):
        import contextlib
        import io
        import os
        import tempfile
        from types import SimpleNamespace
        from unittest.mock import patch
        proof = {'state':'TRUSTED_RELEASE_TRIAL_PASS','plan_sha256':'PRIVATE_BINDING',
                 'full_restore':{'sqlite_checked':2,'docx_checked':3}}
        class Trial:
            def run(self, plan):
                if not accepted:raise ValueError('PRIVATE_FAILURE')
                return proof
        for accepted, release in ((True,True),(True,False),(False,True),(False,False)):
            with self.subTest(accepted=accepted, release=release), tempfile.TemporaryDirectory() as temporary:
                target = Path(temporary) / 'private.json'
                modules = {'release_trial':SimpleNamespace(ReleaseTrial=Trial),
                           'release_recovery':SimpleNamespace(RUNTIME_DIR=Path('/unused'),read_owned=lambda path:'{}')}
                previous = os.umask(0o077)
                try:
                    with patch.dict(sys.modules, modules), patch.dict(os.environ, {'GITHUB_ACTIONS':'true','RUNNER_OS':'Linux'}), \
                         patch.object(sys,'argv',['frozen_trial_replay.py',str(target),*(['--release-proof'] if release else [])]), \
                         patch.object(sys,'path',sys.path.copy()), patch.object(sys,'dont_write_bytecode',True), \
                         patch.object(self.module.os,'geteuid',return_value=0), contextlib.redirect_stdout(io.StringIO()) as output:
                        status = self.module.main()
                finally:os.umask(previous)
                public = json.loads(output.getvalue())
                self.assertEqual(status,0 if accepted else 2)
                self.assertEqual(target.stat().st_mode & 0o777,0o600)
                if accepted and release:
                    self.assertEqual(public,proof)
                    self.assertEqual(output.getvalue(), json.dumps(proof, sort_keys=True) + '\n')
                else:self.assertNotIn('PRIVATE_',output.getvalue())
                private = json.loads(target.read_text())
                if accepted:self.assertEqual(private['proof'],proof)
                else:self.assertIn('PRIVATE_FAILURE',private['private_trace'])

    def test_private_json_transfers_read_fd0_and_reject_invalid_or_oversized_input(self):
        import io
        import re
        from types import SimpleNamespace
        from unittest.mock import patch
        workflow = Path(__file__).parents[1] / 'workflows/vps-cache-cleanup.yml'
        source = workflow.read_text()
        self.assertFalse('install -m 600 /dev/stdin' in source,
                         'Live SSH repro: install accepts a new target but fails to replace an existing proof')
        commands = re.findall(r"remote \"sudo -n python3 -IB -c '([^']+)'\"", source)
        programs = [body.replace('\\"', '"') for body in commands if 'r.atomic_json(' in body and 'sys.stdin.buffer.read(' in body]
        self.assertEqual(len(programs), 3, 'Trial, replay evidence and installed passport must all use the fd0 atomic writer')
        self.assertEqual(sum('installed-passport.json' in program for program in programs), 1)
        for program in programs:
            if 'installed-passport.json' in program:
                limit = 64 * 1024
            else:
                self.assertTrue('trial-proof.json' in program or 'replay-$GITHUB_RUN_ID.json' in program)
                limit = 8 * 1024 * 1024
            valid = b'{"state":"synthetic"}'
            boundary = valid + b' ' * (limit - len(valid))
            for body, accepted in ((valid, True), (boundary, True), (b'not-json', False), (boundary + b' ', False)):

                writes = []
                module = SimpleNamespace(Path=Path, RUNTIME_DIR=Path('/var/lib/aemr/release-runtime'),
                                         atomic_json=lambda path, value, seen=writes: seen.append((path, value)))
                with self.subTest(program=program[-80:], valid=accepted, size=len(body)), patch.dict(sys.modules, {'release_recovery':module}), patch.object(sys, 'stdin', SimpleNamespace(buffer=io.BytesIO(body))), patch.object(sys, 'path', sys.path.copy()):
                    if accepted:
                        exec(compile(program, '<actual-private-json-transfer>', 'exec'), {})  # noqa: S102 - actual reviewed workflow
                        self.assertEqual(len(writes), 1)
                        self.assertEqual(writes[0][1], {'state':'synthetic'})
                    else:
                        with self.assertRaises((ValueError, AssertionError)):
                            exec(compile(program, '<actual-private-json-transfer>', 'exec'), {})  # noqa: S102 - actual reviewed workflow
                        self.assertEqual(writes, [], 'Malformed or oversized data must not replace the prior proof')

    def test_successful_trial_result_is_returned_without_fabricating_acceptance(self):
        proof = {'state': 'TRUSTED_RELEASE_TRIAL_PASS', 'private_release_id': 'PRIVATE_ID',
                 'full_restore': {'sqlite_checked': 2, 'docx_checked': 3}}
        class Trial:
            def run(self, plan):
                return proof
        result = self.module.diagnose(Trial(), {})
        self.assertIs(result['proof'], proof)
        self.assertEqual(result['state'], 'FROZEN_TRIAL_REPLAY_PASS')
        public = self.module.public_summary(result)
        self.assertNotIn('PRIVATE_ID', json.dumps(public))
        self.assertEqual(public['sqlite_checked'], 2)


if __name__ == '__main__':
    unittest.main()
