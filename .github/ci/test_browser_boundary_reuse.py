"""Changes to any browser input or its accepted proof require a new run."""
import copy
import unittest

import browser_boundary_reuse as gate
from source_ci_gate import REQUIRED


class BoundaryReuseTests(unittest.TestCase):
    def setUp(self):
        self.run = {'id': gate.BASELINE_RUN, 'head_sha': gate.BASELINE, 'name': 'CI',
                    'event': 'pull_request', 'path': '.github/workflows/ci.yml',
                    'head_repository': {'full_name': 'gaben1488/dash'},
                    'status': 'completed', 'conclusion': 'success'}
        self.jobs = [{'name': name, 'status': 'completed', 'conclusion': 'success',
                      'steps': [{'name': gate.STEP, 'conclusion': 'success'}]}
                     for name in REQUIRED]
        self.inputs = {path: 'a'*40 for path in gate.DEPENDENCIES} | {'workflow_scope': 'a'*64}

    def reuse(self, **overrides):
        return gate.can_reuse(overrides.get('run', self.run), overrides.get('jobs', self.jobs),
                              overrides.get('baseline', self.inputs), overrides.get('candidate', self.inputs))

    def test_identical_complete_inputs_and_accepted_baseline_reuse_only_synthetic_proof(self):
        self.assertTrue(self.reuse())

    def test_malformed_metadata_requires_a_full_run(self):
        for value in (None, [], 'PRIVATE'):
            self.assertFalse(self.reuse(run=value))
            self.assertFalse(self.reuse(jobs=value))
            self.assertFalse(self.reuse(candidate=value))

    def test_every_changed_input_including_commands_requires_full_run(self):
        for key in self.inputs:
            with self.subTest(key=key):
                candidate = self.inputs | {key: 'b'*len(self.inputs[key])}
                self.assertFalse(self.reuse(candidate=candidate))

    def test_missing_unknown_or_invalid_input_never_reuses(self):
        missing = dict(self.inputs); missing.pop('packages/web')
        for inputs in (missing, self.inputs | {'unknown': 'a'*40}, self.inputs | {'scripts': ''}):
            self.assertFalse(self.reuse(baseline=inputs, candidate=inputs))

    def test_failed_pending_foreign_or_other_baseline_is_rejected(self):
        for field, value in [('id', gate.BASELINE_RUN+1), ('head_sha', 'b'*40), ('status', 'in_progress'),
                             ('conclusion', 'failure'), ('event', 'push'),
                             ('head_repository', {'full_name': 'foreign/dash'})]:
            self.assertFalse(self.reuse(run=self.run | {field: value}))

    def test_workflow_projection_keeps_runner_setup_and_browser_commands(self):
        source = ('name: CI\njobs:\n  checks:\n    name: Lint, TypeScript, Tests, Build, Audit\n'
                  '    runs-on: ubuntu-latest\n      - name: Setup\n        run: prepare\n'
                  '      - name: '+gate.STEP+'\n        run: |\n          check\n'
                  '      - name: ESLint\n        run: lint\n')
        for old, new in [('check\n', 'other\n'), ('prepare', 'other'), ('ubuntu-latest', 'other')]:
            self.assertNotEqual(gate.workflow_scope(source), gate.workflow_scope(source.replace(old, new)))

    def test_absent_failed_or_duplicate_source_job_is_rejected(self):
        self.assertFalse(self.reuse(jobs=self.jobs[:-1]))
        self.assertFalse(self.reuse(jobs=self.jobs + [self.jobs[0]]))
        changed = copy.deepcopy(self.jobs); changed[0]['conclusion'] = 'failure'
        self.assertFalse(self.reuse(jobs=changed))

    def test_absent_failed_or_duplicate_browser_step_is_rejected(self):
        for steps in ([], [{'name': gate.STEP, 'conclusion': 'failure'}],
                      [{'name': gate.STEP, 'conclusion': 'success'}]*2):
            changed = copy.deepcopy(self.jobs)
            for item in changed: item['steps'] = steps
            self.assertFalse(self.reuse(jobs=changed))


if __name__ == '__main__':
    unittest.main()
