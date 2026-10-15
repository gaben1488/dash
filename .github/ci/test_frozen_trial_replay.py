"""Diagnostic instrumentation preserves subprocess results and keeps bodies private."""
import importlib.util
import json
import subprocess
import sys
import unittest
from pathlib import Path


class FrozenTrialReplayTests(unittest.TestCase):
    def setUp(self):
        path = Path(__file__).with_name('frozen_trial_replay.py')
        self.assertTrue(path.is_file(), 'Missing transparent frozen trial replay')
        spec = importlib.util.spec_from_file_location('frozen_trial_replay', path)
        self.module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.module)

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
        self.assertNotIn('PRIVATE_SENTINEL', json.dumps(self.module.public_summary(result)))
        self.assertEqual(result['state'], 'FROZEN_TRIAL_REPLAY_FAILED')

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
