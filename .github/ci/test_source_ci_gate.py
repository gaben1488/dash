"""Admission of immutable source jobs differs from installed-API observations."""
import importlib.util
import unittest
from pathlib import Path


class SourceGateTests(unittest.TestCase):
    def setUp(self):
        path = Path(__file__).with_name('source_ci_gate.py')
        self.assertTrue(path.is_file(), 'Exact source-job admission is missing')
        spec = importlib.util.spec_from_file_location('source_gate', path)
        self.module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.module)
        self.sha = 'a' * 40
        self.run = {'head_sha': self.sha, 'name': 'CI', 'event': 'pull_request', 'path': '.github/workflows/ci.yml',
                    'head_repository': {'full_name': 'gaben1488/dash'}, 'conclusion': 'failure'}
        self.jobs = [{'name': name, 'status': 'completed', 'conclusion': 'success'}
                     for name in ('Lint, TypeScript, Tests, Build, Audit',
                                  'Report engine, publication and runtime',
                                  'Production image with report runtime')]

    def test_failed_installed_api_observation_does_not_erase_passed_source_proof(self):
        self.jobs.append({'name': 'Read-only browser Word readiness and Caddy edge diagnosis',
                          'status': 'completed', 'conclusion': 'failure'})
        self.assertTrue(self.module.source_ci_passed(self.run, self.jobs, self.sha))

    def test_missing_failed_pending_or_duplicate_required_job_blocks_admission(self):
        self.assertFalse(self.module.source_ci_passed(self.run, self.jobs[:-1], self.sha))
        for field, value in (('conclusion', 'failure'), ('status', 'in_progress')):
            changed = [dict(job) for job in self.jobs]
            changed[0][field] = value
            self.assertFalse(self.module.source_ci_passed(self.run, changed, self.sha))
        self.assertFalse(self.module.source_ci_passed(self.run, [*self.jobs, self.jobs[0]], self.sha))

    def test_only_exact_owner_push_on_integration_branch_may_supply_source_proof(self):
        run = {**self.run, 'event': 'push',
               'head_branch': 'codex/dash-audit-integrated-20261010',
               'actor': {'login': 'gaben1488'}}
        self.assertTrue(self.module.source_ci_passed(run, self.jobs, self.sha))
        for changes in (
            {'head_branch': 'main'},
            {'head_branch': 'another-feature'},
            {'actor': {'login': 'another-user'}},
            {'actor': None},
            {'head_sha': 'b' * 40},
            {'head_repository': {'full_name': 'another/repo'}},
            {'path': '.github/workflows/unknown.yml'},
        ):
            self.assertFalse(self.module.source_ci_passed({**run, **changes}, self.jobs, self.sha))

    def test_other_sha_repository_or_workflow_never_admits(self):
        for field, value in (('head_sha', 'b' * 40), ('name', 'Other'), ('event', 'push'),
                             ('path', '.github/workflows/other.yml'),
                             ('head_repository', {'full_name': 'other/dash'})):
            changed = {**self.run, field: value}
            self.assertFalse(self.module.source_ci_passed(changed, self.jobs, self.sha))


if __name__ == '__main__':
    unittest.main()
