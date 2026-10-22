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

    def test_queued_production_release_refuses_superseded_pr79_head(self):
        workflow = Path(__file__).resolve().parents[1] / 'workflows' / 'vps-cache-cleanup.yml'
        source = workflow.read_text(encoding='utf-8')
        admission = source.split('  controlled-candidate-release:', 1)[1].split(
            '      - name: Match the production Docker engine', 1
        )[0]
        # An early equality pins PR79 before SSH setup; the inequality fails
        # closed during CI polling; a final equality guards later advancement.
        exact_head = 'test "$(gh api repos/$GITHUB_REPOSITORY/pulls/79 --jq .head.sha)" = "$RECOVERY_SHA"'
        superseded = 'if test "$(gh api repos/$GITHUB_REPOSITORY/pulls/79 --jq .head.sha)" != "$RECOVERY_SHA"; then'
        ci_lookup = 'ci_run=$(gh api'
        self.assertEqual(admission.count(exact_head), 2)
        self.assertIn(superseded, admission)
        self.assertLess(admission.index(exact_head), admission.index('mkdir -m 700 "$RUNNER_TEMP/release"'))
        self.assertLess(admission.index(superseded), admission.index(ci_lookup))
        fail_closed = admission[admission.index(superseded):admission.index(ci_lookup)]
        self.assertIn('echo RELEASE_CANDIDATE_SUPERSEDED', fail_closed)
        self.assertIn('exit 2', fail_closed)
        self.assertGreater(admission.rindex(exact_head), admission.index('test "$ready" = true'))

    def test_other_sha_repository_or_workflow_never_admits(self):
        for field, value in (('head_sha', 'b' * 40), ('name', 'Other'), ('event', 'push'),
                             ('path', '.github/workflows/other.yml'),
                             ('head_repository', {'full_name': 'other/dash'})):
            changed = {**self.run, field: value}
            self.assertFalse(self.module.source_ci_passed(changed, self.jobs, self.sha))


if __name__ == '__main__':
    unittest.main()
