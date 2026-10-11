"""The production gate must never mistake real code for documentation."""
import unittest

from deploy_scope import is_non_runtime, runtime_changed


class DeploymentScopeTests(unittest.TestCase):
    def test_workflow_script_bodies_cannot_escape_yaml_blocks(self):
        import re
        from pathlib import Path

        workflows = Path(__file__).resolve().parents[1] / "workflows"
        for workflow in workflows.glob("*.yml"):
            body_indent = None
            delimiter = None
            for number, line in enumerate(workflow.read_text().splitlines(), 1):
                if not line.strip():
                    continue
                indentation = len(line) - len(line.lstrip())
                if body_indent is not None and indentation < body_indent:
                    self.assertIsNone(delimiter,
                                      f"{workflow.name}:{number}: heredoc escaped YAML script")
                    self.assertRegex(line, r"^\s*(?:-\s+)?[A-Za-z_][A-Za-z_0-9-]*:\s*",
                                     f"{workflow.name}:{number}: code escaped YAML script")
                    body_indent = None
                if re.fullmatch(r"\s*(?:run|script):\s*\|[-+]?\s*", line):
                    body_indent = indentation + 2
                    continue
                if body_indent is None:
                    continue
                if delimiter is not None:
                    if line.strip() == delimiter:
                        delimiter = None
                else:
                    match = re.search(r"<<\s*['\"]?([A-Za-z_][A-Za-z_0-9]*)['\"]?", line)
                    if match:
                        delimiter = match.group(1)
            self.assertIsNone(delimiter, f"{workflow.name}: unterminated heredoc")

    def test_docs_only_does_not_deploy(self):
        self.assertFalse(runtime_changed([
            "docs/TECHNICAL_SHEETS_COMPATIBILITY_2026-10-10.md",
            "docs/decisions/2026-10-10-customer-directory-migration-qa.md",
            "README.md",
        ]))

    def test_root_claude_md_is_docs_but_nested_claude_md_is_runtime(self):
        self.assertTrue(is_non_runtime("CLAUDE.md"))
        self.assertFalse(runtime_changed(["docs/README.md", "AGENTS.md", "CLAUDE.md"]))
        self.assertTrue(runtime_changed(["packages/server/CLAUDE.md"]))
        self.assertTrue(runtime_changed(["CLAUDE.md", "packages/web/src/App.tsx"]))

    def test_workflow_change_alone_does_not_stop_report_worker(self):
        self.assertFalse(runtime_changed([
            ".github/workflows/ci.yml",
            ".github/ci/deploy_scope.py",
            ".github/ci/test_deploy_scope.py",
        ]))

    def test_any_server_web_or_report_change_requires_deploy(self):
        for path in [
            "packages/server/src/routes/rows.ts",
            "packages/web/src/App.tsx",
            "packages/report-engine/src/procurement_engine/cli.py",
            "deploy/docker-compose.yml",
            "packages/shared/src/rule-book.ts",
        ]:
            with self.subTest(path=path):
                self.assertTrue(runtime_changed(["docs/README.md", path]))

    def test_unknown_paths_are_not_exempt(self):
        self.assertTrue(runtime_changed(["scripts/something.py"]))
        self.assertTrue(runtime_changed([".env.production.example"]))
        self.assertTrue(runtime_changed(["packages/report-engine/templates/report.md"]))

    def test_empty_diff_has_no_runtime_change(self):
        self.assertFalse(runtime_changed([]))

    def test_fake_documentation_prefix_is_not_whitelisted(self):
        self.assertFalse(is_non_runtime("../docs/bad.ts"))
        self.assertTrue(runtime_changed(["docs-old/README.js"]))


class ReportWorkerReleaseSafetyTests(unittest.TestCase):
    """A failed report preflight must not strand a healthy scheduler."""

    def test_deployment_does_not_stop_worker_or_prune_report_history_early(self):
        from pathlib import Path
        workflow = (Path(__file__).resolve().parents[1] / "workflows" / "ci.yml").read_text()
        deploy = workflow.split("name: Deploy to VPS", 1)[1]
        before_report_preflight = deploy.split("bash enable-reports.sh", 1)[0]
        self.assertNotIn("stop report-worker", before_report_preflight)
        self.assertNotIn("recover_weekly_archives", before_report_preflight)
        self.assertNotIn("apply_transient_attempt_retention", before_report_preflight)

    def test_report_enable_never_prunes_or_recovers_historical_state_implicitly(self):
        from pathlib import Path
        script = (Path(__file__).resolve().parents[2] / "deploy" / "enable-reports.sh").read_text()
        self.assertNotIn("apply_transient_attempt_retention", script)
        self.assertNotIn("recover_weekly_archives", script)
        self.assertNotIn("prune-state --apply", script)

    def test_report_preflight_checks_engine_before_stopping_worker(self):
        from pathlib import Path
        script = (Path(__file__).resolve().parents[2] / "deploy" / "enable-reports.sh").read_text()
        self.assertLess(script.index("proc-report --help"), script.index("stop report-worker"))
        self.assertIn("worker_stopped=false", script)
        self.assertIn('"$worker_stopped" = true', script)

    def test_ssh_wrapping_preserves_exit_trap_after_report_release_failure(self):
        import os
        import subprocess
        import tempfile
        import textwrap
        from pathlib import Path

        root = Path(__file__).resolve().parents[2]
        workflow = (root / ".github/workflows/ci.yml").read_text()
        remote = workflow.split("name: Deploy tested commit over SSH", 1)[1]
        script_stop = "script_stop: true" in remote.split("script: |", 1)[0]
        shell = textwrap.dedent(remote.split("script: |\n", 1)[1])
        # Execute the actual recovery trap, isolating all later production work.
        shell = shell.split("trap restore_worker_on_failure EXIT", 1)[0] + "trap restore_worker_on_failure EXIT\n"
        shell += "report_release_started=true\ndocker stop report-worker\nfalse\n"
        # drone-ssh v1.8.0 (ssh-action v1.2.0) injects this after every line.
        # Injecting after the function's opening brace exits before result=$?.
        if script_stop:
            guard = "DRONE_SSH_PREV_COMMAND_EXIT_CODE=$?; if [ $DRONE_SSH_PREV_COMMAND_EXIT_CODE -ne 0 ]; then exit $DRONE_SSH_PREV_COMMAND_EXIT_CODE; fi"
            shell = "\n".join(line + "\n" + guard for line in shell.splitlines())
        with tempfile.TemporaryDirectory() as tmp:
            folder = Path(tmp)
            (folder / "deploy").mkdir()
            trace = folder / "trace"
            docker = folder / "docker"
            docker.write_text('#!/bin/sh\nprintf "%s\\n" "$*" >> "$MOCK_DOCKER_TRACE"\ncase " $* " in *" ps "*) echo old-worker ;; esac\n')
            docker.chmod(0o755)
            shell = shell.replace("/home/aemr/dash", tmp)
            result = subprocess.run(["bash", "-c", shell], capture_output=True, text=True,
                timeout=10, check=False, env={**os.environ, "PATH": tmp + os.pathsep + os.environ["PATH"],
                "MOCK_DOCKER_TRACE": str(trace)})
            self.assertNotEqual(result.returncode, 0)
            calls = trace.read_text().splitlines()
            self.assertTrue(any("stop report-worker" in call for call in calls), calls)
            self.assertTrue(any("start report-worker" in call for call in calls), calls)
            self.assertGreaterEqual(sum("ps --status running --quiet report-worker" in call for call in calls), 2)
            self.assertNotIn("REPORT_WORKER_RESTORE_FAILED", result.stderr)

    def test_failed_engine_preflight_does_not_stop_worker_or_touch_history(self):
        import json
        import os
        import subprocess
        import tempfile
        import textwrap
        from pathlib import Path

        root = Path(__file__).resolve().parents[2]
        with tempfile.TemporaryDirectory() as tmp:
            fake_docker = Path(tmp) / "docker"
            trace = Path(tmp) / "calls.jsonl"
            fake_docker.write_text(textwrap.dedent("""\
                #!/usr/bin/env python3
                import json, os, sys
                from pathlib import Path
                argv = sys.argv[1:]
                with Path(os.environ["MOCK_DOCKER_TRACE"]).open("a") as log:
                    log.write(json.dumps(argv) + "\\n")
                if "ps" in argv and "report-worker" in argv:
                    print("old-running-worker")
                if "--help" in argv and "proc-report" in " ".join(argv):
                    sys.exit(27)
                """), encoding="utf-8")
            fake_docker.chmod(0o755)
            env = {**os.environ,
                   "PATH": tmp + os.pathsep + os.environ.get("PATH", ""),
                   "MOCK_DOCKER_TRACE": str(trace)}
            process = subprocess.run(
                ["bash", str(root / "deploy" / "enable-reports.sh")],
                cwd=root / "deploy", env=env,
                capture_output=True, text=True, timeout=10, check=False)
            calls = [json.loads(line) for line in trace.read_text().splitlines()]
            self.assertNotEqual(process.returncode, 0)
            self.assertTrue(any("--help" in args for args in calls))
            self.assertFalse(any("stop" in args or "start" in args for args in calls))
            self.assertFalse(any("deployment_diagnostics" in " ".join(args) for args in calls))
            self.assertFalse(any("apply_transient_attempt_retention" in " ".join(args)
                                 for args in calls))

    def test_failed_bootstrap_cannot_report_worker_recovered_without_running_state(self):
        import json
        import os
        import subprocess
        import tempfile
        import textwrap
        from pathlib import Path

        root = Path(__file__).resolve().parents[2]
        # The fake Docker client records calls but has no access to production.
        with tempfile.TemporaryDirectory() as tmp:
            fake_docker = Path(tmp) / "docker"
            trace = Path(tmp) / "docker.jsonl"
            started = Path(tmp) / "start-attempted"
            fake_docker.write_text(textwrap.dedent("""\
                #!/usr/bin/env python3
                import json, os, sys
                from pathlib import Path
                args = sys.argv[1:]
                with Path(os.environ["MOCK_DOCKER_TRACE"]).open("a") as log:
                    log.write(json.dumps(args) + "\\n")
                state = Path(os.environ["MOCK_DOCKER_STARTED"])
                if "ps" in args and "report-worker" in args:
                    if state.exists():
                        sys.exit(0)  # Restart returned success, process then exited.
                    print("previously-running-worker")
                elif "start" in args and "report-worker" in args:
                    state.touch()
                elif any("bootstrap-google" in arg for arg in args):
                    sys.exit(23)  # The private schema/Google stage fails.
                """), encoding="utf-8")
            fake_docker.chmod(0o755)
            env = os.environ.copy()
            env.update({
                "PATH": tmp + os.pathsep + env.get("PATH", ""),
                "MOCK_DOCKER_TRACE": str(trace),
                "MOCK_DOCKER_STARTED": str(started),
            })
            completed = subprocess.run(
                ["bash", str(root / "deploy" / "enable-reports.sh")],
                cwd=root / "deploy", env=env, text=True,
                capture_output=True, timeout=10, check=False,
            )
            calls = [json.loads(line) for line in trace.read_text().splitlines()]
            self.assertNotEqual(completed.returncode, 0)
            self.assertTrue(any("stop" in call and "report-worker" in call for call in calls))
            self.assertTrue(any("start" in call and "report-worker" in call for call in calls))
            # Verify the running state after restart; successful docker start
            # is insufficient and was the original production failure class.
            queried = [call for call in calls if "ps" in call and "report-worker" in call]
            self.assertGreaterEqual(len(queried), 2)
            self.assertIn("REPORT_WORKER_RESTORE_FAILED", completed.stderr)

    def test_production_release_is_explicit_and_bound_to_exact_sha(self):
        from pathlib import Path
        workflow = (Path(__file__).resolve().parents[1] / "workflows" / "ci.yml").read_text()
        deploy = workflow.split("\n  deploy:\n", 1)[1]
        gate = deploy.split("    steps:\n", 1)[0]
        self.assertIn("github.event_name == 'workflow_dispatch'", gate)
        self.assertIn("inputs.release_sha == github.sha", gate)
        self.assertIn("inputs.backup_name", workflow)
        self.assertIn("environment: production", gate)
        self.assertNotIn("needs.deploy_scope.outputs.runtime_changed == 'true'", gate)

    def test_raw_backup_inputs_never_enter_remote_shell(self):
        from pathlib import Path
        workflow = (Path(__file__).resolve().parents[1] / "workflows" / "ci.yml").read_text()
        remote = workflow.split("      - name: Deploy tested commit over SSH", 1)[1]
        self.assertNotIn("verified_backup_root='${{ inputs.backup_root }}'", remote)
        self.assertNotIn("verified_backup_name='${{ inputs.backup_name }}'", remote)
        self.assertIn("steps.release_inputs.outputs.backup_root", remote)
        self.assertIn("steps.release_inputs.outputs.backup_name", remote)
        validation = workflow.split("      - name: Validate explicit release intent", 1)[1]
        self.assertIn("id: release_inputs", validation)
        self.assertIn('BACKUP_ROOT', validation)
        self.assertIn('BACKUP_NAME', validation)
        self.assertIn('>> "$GITHUB_OUTPUT"', validation)

    def test_production_release_validates_restorable_backup_before_changes(self):
        from pathlib import Path
        workflow = (Path(__file__).resolve().parents[1] / "workflows" / "ci.yml").read_text()
        deploy = workflow.split("\n  deploy:\n", 1)[1]
        self.assertIn("BACKUP_AND_SCRATCH_RESTORE", deploy)
        self.assertIn("stateful_backup.py", deploy)
        self.assertLess(deploy.index("BACKUP_AND_SCRATCH_RESTORE"),
                        deploy.index("docker image prune --force"))

    def test_production_release_requires_backup_of_quiesced_current_volume(self):
        from pathlib import Path
        workflow = (Path(__file__).resolve().parents[1] / "workflows" / "ci.yml").read_text()
        deploy = workflow.split("\n  deploy:\n", 1)[1]
        preflight = deploy.split("echo 'BACKUP_AND_SCRATCH_RESTORE_PASS'", 1)[0]
        self.assertIn('BACKUP_REQUIRES_SERVER_QUIESCENCE', preflight)
        self.assertIn('BACKUP_REQUIRES_WORKER_QUIESCENCE', preflight)
        self.assertIn('BACKUP_SOURCE_VOLUME_NOT_VERIFIED', preflight)
        self.assertIn('type=volume,src=$source_volume,dst=/source,readonly', preflight)
        self.assertIn('--scratch-parent /scratch --source /source', preflight)

    def test_failed_release_backup_preflight_never_restarts_running_worker(self):
        import json
        import os
        import subprocess
        import tempfile
        import textwrap
        from pathlib import Path

        root = Path(__file__).resolve().parents[2]
        workflow = (root / ".github/workflows/ci.yml").read_text()
        remote = workflow.split('      - name: Deploy tested commit over SSH', 1)[1]
        remote = remote.split('          script: |\n', 1)[1].split('\n  browser-report-contract:', 1)[0]
        # Execute the actual workflow's shell, with only destinations and
        # external executables isolated. No Docker or SSH server is contacted.
        with tempfile.TemporaryDirectory() as tmp:
            folder = Path(tmp)
            repo = folder / "repo"
            (repo / "deploy").mkdir(parents=True)
            backup = folder / "backups" / "REL-test"
            backup.mkdir(parents=True)
            (backup / "manifest.json").write_text('{}')
            trace = folder / "calls.jsonl"
            docker = folder / "docker"
            docker.write_text(textwrap.dedent('''\
                #!/usr/bin/env python3
                import json, os, sys
                from pathlib import Path
                args = sys.argv[1:]
                with Path(os.environ["MOCK_DOCKER_TRACE"]).open("a") as log:
                    log.write(json.dumps(args) + "\\n")
                if "ps" in args:
                    print("old-worker" if "report-worker" in args else "old-server")
                elif "inspect" in args:
                    print("running")
                '''))
            docker.chmod(0o755)
            git = folder / "git"
            git.write_text('#!/bin/sh\nexit 0\n')
            git.chmod(0o755)
            script = textwrap.dedent(remote).replace('/home/aemr/dash', str(repo))
            script = script.replace('${{ steps.release_inputs.outputs.backup_root }}', str(backup.parent))
            script = script.replace('${{ steps.release_inputs.outputs.backup_name }}', backup.name)
            script = script.replace('${{ github.sha }}', 'a' * 40)
            result = subprocess.run(['bash', '-c', script], capture_output=True, text=True,
                                    timeout=10, check=False, env={**os.environ,
                                    "PATH": tmp + os.pathsep + os.environ.get("PATH", ""),
                                    "MOCK_DOCKER_TRACE": str(trace)})
            self.assertNotEqual(result.returncode, 0)
            self.assertIn('BACKUP_REQUIRES_SERVER_QUIESCENCE', result.stderr)
            calls = [json.loads(line) for line in trace.read_text().splitlines()]
            self.assertFalse(any('start' in call or 'stop' in call or 'up' in call
                                 or 'run' in call or 'prune' in call for call in calls), calls)


if __name__ == "__main__":
    unittest.main()
