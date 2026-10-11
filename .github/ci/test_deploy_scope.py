"""The production gate must never mistake real code for documentation."""
import unittest
from deploy_scope import is_non_runtime, runtime_changed


class DeploymentScopeTests(unittest.TestCase):
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

    def test_failed_bootstrap_cannot_report_worker_recovered_without_running_state(self):
        import json
        import os
        from pathlib import Path
        import subprocess
        import tempfile
        import textwrap

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


if __name__ == "__main__":
    unittest.main()
