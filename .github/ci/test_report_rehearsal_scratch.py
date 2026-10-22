"""Catalog-bearing rehearsals must not copy a growing DB into small RAM scratch."""
import os
import re
import subprocess
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

WORKFLOW = Path(__file__).resolve().parents[1] / 'workflows/report-rehearsal.yml'


def docker_commands(text):
    command = ''
    limits = ''
    for line in text.splitlines():
        if line.strip().startswith('rehearsal_limits=('):
            limits = line.strip().removeprefix('rehearsal_limits=(').removesuffix(')')
        if 'docker run ' in line and not line.lstrip().startswith('#'):
            command = line[line.index('docker run '):].strip().replace('"${rehearsal_limits[@]}"', limits)
        elif command:
            command += '\n' + line.strip()
        if command and not line.rstrip().endswith('\\'):
            yield command
            command = ''


class ReportRehearsalScratchTests(unittest.TestCase):
    def test_scope_keeps_existing_same_repository_rehearsal_branches_eligible(self):
        scope = WORKFLOW.read_text().split('  scope:\n', 1)[1].split('    runs-on:', 1)[0]
        expression = ' '.join(scope.split('    if: >-\n', 1)[1].split()).replace('&&', 'and')
        for repository in ['owner/dash', 'foreign/dash']:
            for branch in ['codex/report-example', 'codex/monitoring-workplace', 'codex/dash-audit-integrated-20261010']:
                github = SimpleNamespace(repository='owner/dash', head_ref=branch,
                    event=SimpleNamespace(pull_request=SimpleNamespace(head=SimpleNamespace(repo=SimpleNamespace(full_name=repository)))))
                self.assertEqual(eval(expression, {'__builtins__': {}}, {'github': github}), repository == 'owner/dash')

    def test_frozen_candidate_replay_cannot_claim_installed_worker_cycle_acceptance(self):
        frozen = WORKFLOW.read_text().split('  frozen-replay:\n', 1)[1]
        self.assertNotIn('check_worker_cycle', frozen)
        self.assertNotIn('scheduled_worker_cycle', frozen)
        self.assertIn('REQUIRES_EXACT_DEPLOYED_CANDIDATE_TWO_CYCLES', frozen)
        self.assertIn('"status":"NOT_RUN"', frozen)
        # Strong operational acceptance remains a separate, explicitly invoked
        # observer. A prior installed success is not a candidate replay result.
        operator = (WORKFLOW.parent / 'vps-cache-cleanup.yml').read_text()
        observer = operator.split('  worker-acceptance-readback:\n', 1)[1]
        self.assertIn('maintenance: worker-acceptance-readback', observer)

    def test_new_heads_queue_without_cancelling_native_work_already_running(self):
        concurrency = WORKFLOW.read_text().split('concurrency:\n', 1)[1].split('\njobs:', 1)[0]
        self.assertIn('group: report-readonly-rehearsal-${{ github.event.pull_request.number }}', concurrency)
        self.assertIn('cancel-in-progress: false', concurrency)

    def test_replay_waits_for_schema_but_cancellation_cannot_start_more_work(self):
        part = WORKFLOW.read_text().split('  frozen-replay:\n', 1)[1]
        self.assertEqual(re.findall(r'^    needs:.*$', part, re.MULTILINE), ['    needs: [scope, source-schema]'])
        expression = ' '.join(part.split('    if: >-\n', 1)[1].split('    runs-on:', 1)[0].split())
        expression = expression.replace('!cancelled()', 'not cancelled()').replace('&&', 'and').replace('||', 'or')
        for cancelled, repository, branch, native, expected in [(False, 'owner/dash', 'codex/dash-audit-integrated-20261010', 'true', True),
                (True, 'owner/dash', 'codex/dash-audit-integrated-20261010', 'true', False),
                (False, 'foreign/dash', 'codex/dash-audit-integrated-20261010', 'true', False),
                (False, 'owner/dash', 'codex/dash-audit-integrated-20261010', 'false', False),
                (False, 'owner/dash', 'codex/dash-audit-integrated-20261010', '', False)]:
            github = SimpleNamespace(repository='owner/dash', head_ref=branch,
                event=SimpleNamespace(pull_request=SimpleNamespace(head=SimpleNamespace(repo=SimpleNamespace(full_name=repository)))))
            needs = SimpleNamespace(scope=SimpleNamespace(outputs=SimpleNamespace(native_required=native)))
            result = eval(expression, {'__builtins__': {}}, {'github': github, 'needs': needs,
                'cancelled': lambda value=cancelled: value, 'startsWith': lambda value, prefix: value.startswith(prefix)})
            self.assertEqual(result, expected)

    def test_actual_cleanup_preserves_failure_and_removes_only_its_labelled_test_container(self):
        text = WORKFLOW.read_text()
        for job in ('source-schema', 'frozen-replay'):
            part = text.split('  ' + job + ':\n', 1)[1]
            cleanup = part.split('            cleanup_rehearsal() {\n', 1)[1].split('\n            trap cleanup_rehearsal EXIT', 1)[0]
            import textwrap
            function = 'cleanup_rehearsal() {\n' + textwrap.dedent(cleanup)
            with self.subTest(job=job), tempfile.TemporaryDirectory() as temporary:
                scratch = Path(temporary) / 'owned'
                scratch.mkdir()
                outside = Path(temporary) / 'protected'
                outside.write_text('keep')
                log = Path(temporary) / 'docker-args'
                script = '''docker() {
                    printf '%s\\n' "$@" >> "$DOCKER_TEST_LOG"
                    if [ "$1" = ps ]; then printf '%s\\n' aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa; fi
                }
                rehearsal_run=123
                rehearsal_attempt=2
                work="$OWNED_SCRATCH"
                ''' + function + '\ntrap cleanup_rehearsal EXIT\nexit 7\n'
                result = subprocess.run(['bash', '-c', script], env={**os.environ,
                    'OWNED_SCRATCH': str(scratch), 'DOCKER_TEST_LOG': str(log)},
                    capture_output=True, text=True, timeout=5, check=False)
                self.assertEqual(result.returncode, 7, result.stderr)
                self.assertEqual(result.stdout, '')
                args = log.read_text().splitlines()
                self.assertIn('label=aemr.rehearsal-run=123', args)
                self.assertIn('label=aemr.rehearsal-attempt=2', args)
                self.assertIn('label=aemr.rehearsal-job=' + job, args)
                self.assertEqual(args[-3:], ['rm', '--force', 'a' * 64])
                self.assertFalse(scratch.exists())
                self.assertEqual(outside.read_text(), 'keep')

    def test_each_native_rehearsal_has_resource_limits_and_an_owned_cleanup_label(self):
        commands = list(docker_commands(WORKFLOW.read_text()))
        self.assertGreater(len(commands), 10)
        for command in commands:
            with self.subTest(command=command.splitlines()[0]):
                self.assertIn('--memory ', command)
                self.assertIn('--cpus ', command)
                self.assertIn('--pids-limit ', command)
                self.assertIn('--label "aemr.rehearsal-run=$rehearsal_run"', command)
                self.assertIn('--label "aemr.rehearsal-attempt=$rehearsal_attempt"', command)

    def test_long_python_runs_have_a_daemon_side_deadline_after_ssh_cancellation(self):
        commands = [cmd for cmd in docker_commands(WORKFLOW.read_text()) if '/opt/report-env/bin/python' in cmd]
        self.assertGreater(len(commands), 10)
        for command in commands:
            with self.subTest(command=command.splitlines()[0]):
                self.assertIn('--entrypoint /usr/bin/timeout "$image"', command)
                self.assertIn('-k 5s 1200s /opt/report-env/bin/python', command)

    def test_baseline_probe_cannot_replace_installed_engine_imports_with_candidate_code(self):
        text = WORKFLOW.read_text()
        baseline = re.search(r'baseline_weekly=\$\(docker run.*?\|\| true\)', text, re.DOTALL).group()
        candidate = re.search(r'candidate_weekly=\$\(docker run.*?\|\| true\)', text, re.DOTALL).group()
        self.assertIn('--network none --read-only', baseline)
        self.assertIn('$data_volume:/app/packages/server/data:ro', baseline)
        self.assertIn('/qualification:ro', baseline)
        self.assertIn('runpy.run_path', baseline)
        self.assertIn('run_name="procurement_engine.rehearsal_probe"', baseline)
        self.assertNotIn('PYTHONPATH', baseline)
        self.assertIn('PYTHONPATH=/candidate/src', candidate)

    def test_full_catalog_readers_use_disposable_disk_and_readonly_production(self):
        readers = [cmd for cmd in docker_commands(WORKFLOW.read_text())
                   if 'copied_catalog' in cmd or "<<'PYREAD'" in cmd]
        self.assertEqual(len(readers), 3, 'Keep all three catalog readers under the same scratch policy')
        for cmd in readers:
            with self.subTest(command=cmd.splitlines()[0]):
                self.assertIn('--mount type=volume,dst=/tmp', cmd)
                self.assertNotIn('--tmpfs /tmp', cmd)
                self.assertIn('--rm', cmd)
                self.assertIn('--read-only', cmd)
                self.assertIn('$data_volume:/app/packages/server/data:ro', cmd)


if __name__ == '__main__':
    unittest.main()
