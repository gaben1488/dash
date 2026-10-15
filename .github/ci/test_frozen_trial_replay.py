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
