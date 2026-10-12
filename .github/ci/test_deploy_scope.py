"""The production gate must never mistake real code for documentation."""
import unittest

from deploy_scope import is_non_runtime, runtime_changed


class DeploymentScopeTests(unittest.TestCase):
    def test_current_signal_probe_is_bounded_private_and_unknown_safe(self):
        import json
        import subprocess
        from pathlib import Path
        workflow = (Path(__file__).resolve().parents[1] / "workflows" / "ci.yml").read_text()
        script = workflow.split("            import * as shared", 1)[1].split("            JSSIGNALS", 1)[0]
        script = "import * as shared" + script
        script = "\n".join(line.removeprefix("            ") for line in script.splitlines())
        for scenario in ["good", "unavailable", "duplicate", "incomplete", "wrong_address", "composite", "cross_year_duplicate", "large_dashboard", "oversized_dashboard", "oversized_detail"]:
            with self.subTest(scenario=scenario):
                mock = r'''const shared={dayNumberOf:v=>v==="valid"?123:NaN,economyFlagState:v=>v==="yes"?"approved":"undetermined",CHECK_REGISTRY:[{id:"anti_dumping",legacyId:"highEconomy"}]};
const scenario=SCENARIO, addresses=[419,437,440,452,459,480], numbers=["416","434","437","449","456","477"];
let calls=[];globalThis.fetch=async(url,options)=>{calls.push(url);if(options.method!=="GET"||url.includes("refresh")||!url.startsWith("http://127.0.0.1:3000/api/"))throw Error("Unsafe request");
if(scenario==="unavailable")return {ok:false};let data;
if(url.includes("dashboard"))data={snapshot:{id:"safe-id",createdAt:"2026-10-12T01:00:00Z"},recentIssues:[{departmentId:"uksimp",row:419,checkId:"anti_dumping",severity:"critical",status:"acknowledged",title:"PRIVATE_SENTINEL"}]};
else if(url.includes("?")){let rows=addresses.map((rowIndex,i)=>({rowIndex,id:numbers[i],subject:"PRIVATE_SENTINEL"}));if(scenario==="composite")rows[0].id="416/1";if(scenario==="duplicate"||(scenario==="cross_year_duplicate"&&!url.includes("year=")))rows.push({rowIndex:999,id:"416"});data={department:{id:"uksimp"},rows,pagination:{page:1,limit:1000,total:rows.length,totalPages:scenario==="incomplete"?4:1}};}
else {const address=Number(url.split("/").pop()),i=addresses.indexOf(address);data={department:{id:"uksimp"},rowIndex:scenario==="wrong_address"?address+1:address,cells:{A:numbers[i],Q:i===0?"":i===1?"valid":"PRIVATE_SENTINEL",AD:"yes",G:"PRIVATE_SENTINEL"},signals:{economyFlagUndetermined:false,highEconomy:true,epFactDeviation:false,futureFactDate:i===1}};}
if(url.includes("dashboard")&&scenario==="large_dashboard")data.privatePadding="PRIVATE_SENTINEL".repeat(350000);if(url.includes("dashboard")&&scenario==="oversized_dashboard")data.privatePadding="PRIVATE_SENTINEL".repeat(1500000);if(!url.includes("dashboard")&&!url.includes("?")&&scenario==="oversized_detail")data.privatePadding="PRIVATE_SENTINEL".repeat(350000);return {ok:true,text:async()=>JSON.stringify(data)};};
'''.replace("SCENARIO", json.dumps(scenario))
                script_mocked = script.replace('import * as shared from "@aemr/shared";', mock)
                result = subprocess.run(["node", "--input-type=module", "-e", script_mocked], text=True, capture_output=True, timeout=10, check=False)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertNotIn("PRIVATE_SENTINEL", result.stdout)
                data = json.loads(result.stdout)
                self.assertEqual(data["scope"], "current_addresses_only")
                self.assertEqual(data["sourceReadAt"], "UNAVAILABLE")
                row = data["rows"][0]
                if scenario in ["unavailable", "wrong_address", "oversized_detail"]:
                    self.assertEqual(row["signals"]["highEconomy"], "UNAVAILABLE")
                    self.assertEqual(row["matching_checks"], "UNAVAILABLE" if scenario in ["unavailable", "oversized_dashboard"] else [{"checkId": "anti_dumping", "severity": "critical", "status": "acknowledged"}])
                else:
                    self.assertIs(row["signals"]["economyFlagUndetermined"], False)
                    self.assertEqual(row["Q"], "MISSING")
                    self.assertEqual(data["rows"][1]["Q"], "FUTURE")
                    self.assertEqual(data["rows"][2]["Q"], "UNAVAILABLE")
                    self.assertEqual(row["matching_checks"], "UNAVAILABLE" if scenario == "oversized_dashboard" else [{"checkId": "anti_dumping", "severity": "critical", "status": "acknowledged"}])
                if scenario in ["duplicate", "incomplete", "unavailable", "wrong_address", "composite", "cross_year_duplicate", "oversized_detail"]:
                    self.assertEqual(row["logical_resolution"], "UNAVAILABLE")
                else:
                    self.assertIs(row["logical_resolution"]["A_match_expected"], True)
                if scenario == "large_dashboard":
                    self.assertEqual(data["snapshotId"], "safe-id")
                if scenario == "oversized_dashboard":
                    self.assertEqual(data["snapshotId"], "UNAVAILABLE")

    def test_host_probe_privileged_df_is_read_only_and_permission_gated(self):
        import contextlib
        import io
        import json
        import os
        import subprocess
        from pathlib import Path
        from types import SimpleNamespace
        from unittest.mock import patch
        workflow = (Path(__file__).resolve().parents[1] / "workflows" / "ci.yml").read_text()
        script = workflow.split("            import json\n", 1)[1].split("            PYHOST", 1)[0]
        script = "import json\n" + "\n".join(line.removeprefix("            ") for line in script.splitlines())
        for allowed in [True, False]:
            with self.subTest(sudo_allowed=allowed):
                commands = []
                def run(args, *, commands=commands, allowed=allowed, **kwargs):
                    commands.append(args)
                    code, output = 0, ""
                    if args[:3] == ["docker", "compose", "--env-file"]:
                        output = "a" * 64
                    elif args[:2] == ["docker", "inspect"]:
                        output = json.dumps([{"Destination": "/app/packages/server/data", "Source": "/private/volume"}])
                    elif args == ["whoami"]:
                        output = "releaseactor"
                    elif args == ["sudo", "-n", "true"]:
                        code = 0 if allowed else 1
                    elif args == ["sudo", "-n", "test", "-d", "/private/volume"]:
                        self.assertTrue(allowed)
                    elif args == ["sudo", "-n", "df", "-B1", "--output=avail", "--", "/private/volume"]:
                        self.assertTrue(allowed)
                        output = "Avail\n123456789\n"
                    else:
                        self.fail(f"Unexpected host operation: {args!r}")
                    return SimpleNamespace(returncode=code, stdout=output)
                out = io.StringIO()
                with patch.object(subprocess, "run", run), patch.object(os.path, "isdir", return_value=False), contextlib.redirect_stdout(out):
                    exec(compile(script, "host-readonly-probe", "exec"), {})  # noqa: S102 — trusted tracked workflow, mocked subprocesses
                data = json.loads(out.getvalue())
                self.assertEqual(data["volume_free_bytes"], 123456789 if allowed else "UNAVAILABLE")
                self.assertEqual(data["private_backup_free_bytes"], "UNAVAILABLE")
                self.assertNotIn("/private/volume", out.getvalue())
                self.assertIs(data["sudo_noninteractive"], allowed)
                self.assertLessEqual(len(commands), 6)

    def test_rehearsal_worker_lookup_reports_blocker_without_masking_failure(self):
        import json
        import subprocess
        from pathlib import Path
        workflow = (Path(__file__).resolve().parents[1] / "workflows" /
                    "report-rehearsal.yml").read_text()
        shell = workflow.split('# Startup success is insufficient: observe a later timer attempt.', 1)[1]
        shell = shell.split('started=$(docker inspect', 1)[0]
        for status, reason in [(0, 'RUNNING_REPORT_WORKER_NOT_FOUND'),
                               (2, 'REPORT_WORKER_LOOKUP_FAILED')]:
            with self.subTest(status=status):
                result = subprocess.run(
                    ['bash', '-c', 'set -euo pipefail\n'
                     + f'docker() {{ return {status}; }}\n' + shell],
                    text=True, capture_output=True, timeout=5, check=False)
                self.assertNotEqual(result.returncode, 0)
                self.assertTrue(result.stdout.strip(), 'Lookup failure lost its blocker diagnostic')
                self.assertEqual(json.loads(result.stdout)['scheduled_worker_cycle'],
                                 {'status': 'BLOCKED', 'reason': reason})

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
            shell = "\n".join(line + ("\n" + guard if line.strip() and not line.rstrip().endswith("\\") else "") for line in shell.splitlines())
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
            script = textwrap.dedent(remote).replace('/home/aemr/dash', str(repo)).replace('/run/lock/aemr-maintenance.lock', str(folder/'maintenance.lock'))
            script = script.replace('${{ steps.release_inputs.outputs.backup_root }}', str(backup.parent))
            script = script.replace('${{ steps.release_inputs.outputs.backup_name }}', backup.name)
            script = script.replace('${{ github.sha }}', 'a' * 40)
            result = subprocess.run(['bash', '-c', script], capture_output=True, text=True,
                                    timeout=10, check=False, env={**os.environ,
                                    "PATH": tmp + os.pathsep + os.environ.get("PATH", ""),
                                    "MOCK_DOCKER_TRACE": str(trace)})
            self.assertNotEqual(result.returncode, 0)
            self.assertIn('BACKUP_REQUIRES_WORKER_QUIESCENCE', result.stderr)
            calls = [json.loads(line) for line in trace.read_text().splitlines()]
            self.assertFalse(any('start' in call or 'stop' in call or 'up' in call
                                 or 'run' in call or 'prune' in call for call in calls), calls)


    def release_owner_case(self, scenario):
        import importlib.util
        import json
        import os
        import sqlite3
        import subprocess
        import tempfile
        import textwrap
        import zipfile
        from pathlib import Path
        root = Path(__file__).resolve().parents[2]
        spec = importlib.util.spec_from_file_location('backup', root / 'deploy/stateful_backup.py')
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        with tempfile.TemporaryDirectory() as tmp:
            folder = Path(tmp)
            repo, session, source, scratch = [folder / n for n in ('repo', 'window', 'source', 'scratch')]
            (repo / 'deploy').mkdir(parents=True)
            (source / 'reports/inputs').mkdir(parents=True)
            (source / 'reports/published').mkdir()
            scratch.mkdir()
            session.mkdir()
            with sqlite3.connect(source / 'aemr.db') as database:
                database.execute('create table facts (value integer)')
                database.execute('insert into facts values (17)')
            for name in ('registry', 'ledger'):
                (source / f'reports/inputs/{name}.json').write_text('{}')
            with zipfile.ZipFile(source / 'reports/published/main.docx', 'w') as document:
                document.writestr('word/document.xml', '<document/>')
            module.create(source, session / 'backup')
            baseline = {'candidate': 'd'*40, 'server': 'a'*64, 'worker': 'b'*64, 'volume': 'synthetic_data', 'image': 'sha256:'+'c'*64}
            (session / 'runtime.json').write_text(json.dumps(baseline))
            if scenario == 'normal-resume-updates':
                (source / 'reports/inputs/ledger.json').write_text('{"startup_update":true}')
            if scenario == 'runtime-changed':
                baseline['image'] = 'sha256:'+'f'*64
                (session / 'runtime.json').write_text(json.dumps(baseline))
            state, trace = folder / 'state', folder / 'calls'
            state.write_text('running')
            docker = folder / 'docker'
            docker.write_text(textwrap.dedent(r'''#!/usr/bin/env python3
import json,os,subprocess,sys
from pathlib import Path
args=sys.argv[1:]
with Path(os.environ['TRACE']).open('a') as log:log.write(json.dumps(args)+'\n')
assert subprocess.run(['flock','-n',os.environ['MAINTENANCE_LOCK'],'true'],stdout=subprocess.DEVNULL).returncode != 0
state=Path(os.environ['STATE'])
if args[0]=='compose':
 if 'build' in args and os.environ['SCENARIO']=='build-failed':sys.exit(53)
 if 'up' in args:state.write_text('running')
 print(('b' if args[-1]=='report-worker' else 'e' if args[-1]=='web' else 'a')*64)
elif args[0]=='inspect':
 fmt=args[2]
 if '.State.Health' in fmt:print('healthy')
 elif '.State.Status' in fmt:print('exited' if args[-1]=='b'*64 else state.read_text())
 elif fmt=='{{.Name}}':print('/aemr-server')
 elif '.Image' in fmt:print('sha256:'+('e' if args[-1]=='e'*64 else 'c')*64)
 else:print('synthetic_data')
elif args[0]=='stop':state.write_text('exited')
elif args[0]=='start':state.write_text('running')
elif args[0]=='run':
 if '/tool.py' not in args:sys.exit(0)
 command=args[args.index('/tool.py')+1:]
 def host(value):
  if value.startswith('/backups'):return os.environ['SESSION']+value[len('/backups'):]
  return os.environ['SOURCE'] if value=='/source' else os.environ['SCRATCH'] if value=='/scratch' else value
 command=[host(value) for value in command]
 if command[0]=='release-capacity' and os.environ['SCENARIO']=='low-storage':
  import importlib.util,types
  spec=importlib.util.spec_from_file_location('capacity',os.environ['TOOL']);tool=importlib.util.module_from_spec(spec);spec.loader.exec_module(tool)
  tool.shutil.disk_usage=lambda _:types.SimpleNamespace(free=128*1024*1024)
  sys.argv=[os.environ['TOOL'],*command];sys.exit(tool.main())
 result=subprocess.run([sys.executable,os.environ['TOOL'],*command])
 if result.returncode==0 and command[0]=='create' and os.environ['SCENARIO']=='stale':
  Path(os.environ['SOURCE']+'/reports/inputs/ledger.json').write_text('{"changed_after_capture":true}')
 sys.exit(result.returncode)
elif args[0] in {'image','tag','builder'} and os.environ['SCENARIO'] in {'rollback-tags','worker-failed','checkout-failed','build-failed'}:pass
else:sys.exit(41)
'''))
            docker.chmod(0o700)
            git = folder / 'git'
            git.write_text('#!/bin/sh\ncase "$*" in *checkout*) [ "$SCENARIO" != checkout-failed ] || exit 52;; *runtime_guard.py*) cat "$GUARD";; *aemr-runtime-guard.service*) cat "$GUARD_SERVICE";; *aemr-runtime-guard.timer*) cat "$GUARD_TIMER";; *stateful_backup.py*) cat "$TOOL";; *rev-parse*) printf "%s\\n" '+"'"+'d'*40+"'"+';; esac\n')
            git.chmod(0o700)
            workflow = (root / '.github/workflows/ci.yml').read_text()
            remote = workflow.split('      - name: Deploy tested commit over SSH', 1)[1].split('          script: |\n', 1)[1].split('\n  browser-report-contract:', 1)[0]
            if scenario == 'rollback-tags':
                remote = remote.split('            git fetch origin', 1)[0]
            elif scenario not in {'worker-failed','checkout-failed','build-failed'}:
                remote = remote.split('            # Storage is a deployment prerequisite', 1)[0]
            script = textwrap.dedent(remote).replace('/home/aemr/dash', str(repo)).replace('/run/lock/aemr-maintenance.lock', str(folder/'maintenance.lock'))
            script = script.replace('${{ steps.release_inputs.outputs.backup_root }}', str(session))
            script = script.replace('${{ steps.release_inputs.outputs.backup_name }}', 'backup').replace('${{ github.sha }}', 'd'*40)
            script = script.replace('${{ github.run_id }}','1').replace('${{ github.run_attempt }}','1')
            for name, source_file in [('installed_guard.py',root/'deploy/runtime_guard.py'), ('installed_guard.service',root/'deploy/systemd/aemr-runtime-guard.service'), ('installed_guard.timer',root/'deploy/systemd/aemr-runtime-guard.timer')]:
                (folder/name).write_text(source_file.read_text())
            policy=folder/'guard-policy.json'
            policy.write_text(json.dumps({'project':'aemr','worker_enabled':False,'services':{'server':{'container':'aemr-server'}}}))
            for old, target in [('/usr/local/libexec/aemr/runtime_guard.py',folder/'installed_guard.py'),('/etc/systemd/system/aemr-runtime-guard.service',folder/'installed_guard.service'),('/etc/systemd/system/aemr-runtime-guard.timer',folder/'installed_guard.timer'),('/etc/aemr/runtime-policy.json',policy)]:
                script=script.replace(old,str(target))
            systemctl=folder/'systemctl'
            systemctl.write_text('#!/bin/sh\ncase "$*" in *FragmentPath*aemr-runtime-guard.service*) echo "$INSTALLED_SERVICE";; *FragmentPath*aemr-runtime-guard.timer*) echo "$INSTALLED_TIMER";; *NeedDaemonReload*) echo no;; *DropInPaths*) echo;; esac\n')
            systemctl.chmod(0o700)
            sudo=folder/"sudo"
            sudo.write_text('#!/bin/sh\n[ "$SCENARIO" != policy-unavailable ] || exit 54\n[ "$1" = -n ] && [ "$2" = cat ] && [ "$3" = "$GUARD_POLICY" ] || exit 2\nexec cat "$3"\n')
            sudo.chmod(0o700)
            actor_id=folder/"id"
            actor_id.write_text('#!/bin/sh\nif [ "$SCENARIO" = policy-unavailable ] && [ "$1" = -u ]; then echo 1001; else /usr/bin/id "$@"; fi\n')
            actor_id.chmod(0o700)
            # Force a pre-runtime failure after successful proof: restore old API,
            # retain receipt, and never mutate an image, code, worker or live data.
            script += '\nexit 41\n'
            (repo / 'deploy/enable-reports.sh').write_text('#!/bin/sh\nexit 51\n')
            for name, content in [('sleep','exit 0'), ('df','printf \'Filesystem 1024-blocks Used Available Capacity Mounted\\nsynthetic 40000000 0 40000000 0 /\\n\'')]:
                executable=folder/name;executable.write_text('#!/bin/sh\n'+content+'\n');executable.chmod(0o700)
            env = {**os.environ, 'PATH': tmp+os.pathsep+os.environ['PATH'], 'TRACE': str(trace), 'STATE': str(state),
                   'MAINTENANCE_LOCK':str(folder/'maintenance.lock'),'GUARD_POLICY':str(policy),'INSTALLED_SERVICE':str(folder/'installed_guard.service'),'INSTALLED_TIMER':str(folder/'installed_guard.timer'),'GUARD':str(root/'deploy/runtime_guard.py'),'GUARD_SERVICE':str(root/'deploy/systemd/aemr-runtime-guard.service'),'GUARD_TIMER':str(root/'deploy/systemd/aemr-runtime-guard.timer'),'TOOL': str(root / 'deploy/stateful_backup.py'), 'BACKUP': str(session / 'backup'), 'SESSION': str(session), 'SCENARIO': scenario, 'SCRATCH': str(scratch), 'SOURCE': str(source)}
            if scenario == 'contention':
                import fcntl
                with (folder/'maintenance.lock').open('a') as owner:
                    fcntl.flock(owner,fcntl.LOCK_EX|fcntl.LOCK_NB)
                    result=subprocess.run(['bash','-c',script],env=env,capture_output=True,text=True,timeout=15,check=False)
            else:
                result = subprocess.run(['bash','-c',script],env=env,capture_output=True,text=True,timeout=15,check=False)
            calls = [json.loads(line) for line in trace.read_text().splitlines()] if trace.exists() else []
            receipts = list(session.glob('release-*.json'))
            receipt = json.loads(receipts[0].read_text()) if receipts else None
            return result, calls, state.read_text(), receipt

    def test_same_owner_release_quiesces_then_matches_and_restores_original_on_preflight_failure(self):
        result, calls, state, receipt = self.release_owner_case('unchanged')
        self.assertEqual(result.returncode, 41, result.stderr)
        self.assertEqual([c for c in calls if c[0]=='stop'], [['stop','--time','75','a'*64]])
        self.assertEqual([c for c in calls if c[0]=='start'], [['start','a'*64]])
        self.assertEqual(state, 'running')
        self.assertEqual(receipt['restore']['state'], 'VERIFIED_IN_SCRATCH')
        self.assertTrue(receipt['restore']['source_matched'])
        self.assertEqual(receipt['rollback']['server_image'], 'sha256:'+'c'*64)
        self.assertFalse(any('up' in c or 'prune' in c or 'tag' in c for c in calls))

    def test_same_owner_release_rejects_changed_source_and_returns_original_api(self):
        result, calls, state, receipt = self.release_owner_case('stale')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('BACKUP_SOURCE_MISMATCH', result.stderr)
        self.assertEqual([c for c in calls if c[0]=='start'], [['start','a'*64]])
        self.assertEqual(state, 'running')
        self.assertIsNone(receipt)
        self.assertFalse(any('up' in c or 'prune' in c or 'tag' in c for c in calls))

    def test_same_owner_release_rejects_changed_runtime_before_stopping_api(self):
        result, calls, state, receipt = self.release_owner_case('runtime-changed')
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(state, 'running')
        self.assertIsNone(receipt)
        self.assertFalse(any(c[0] in {'stop','start','run'} for c in calls))

    def test_same_owner_capacity_failure_leaves_original_api_running_without_stop(self):
        result, calls, state, receipt = self.release_owner_case('low-storage')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('BACKUP_STORAGE_INSUFFICIENT', result.stderr)
        self.assertEqual(state, 'running')
        self.assertIsNone(receipt)
        self.assertFalse(any(c[0] in {'stop','start'} or 'up' in c or 'prune' in c for c in calls))

    def test_same_owner_captures_legitimate_resume_updates_in_new_checkpoint(self):
        result, _calls, state, receipt = self.release_owner_case('normal-resume-updates')
        self.assertEqual(result.returncode, 41, result.stderr)
        self.assertEqual(state, 'running')
        self.assertTrue(receipt['restore']['source_matched'])
        self.assertEqual(receipt['prior_restore']['state'], 'VERIFIED_IN_SCRATCH')
        self.assertNotIn('source_matched', receipt['prior_restore'])

    def test_release_cannot_steal_external_guardian_lock_or_stop_api(self):
        result, calls, state, receipt = self.release_owner_case('contention')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('AEMR_MAINTENANCE_BUSY', result.stderr)
        self.assertEqual(calls, [])
        self.assertEqual(state, 'running')
        self.assertIsNone(receipt)

    def test_release_rollback_uses_pre_stop_actual_images_not_latest_tags(self):
        result, calls, state, receipt = self.release_owner_case('rollback-tags')
        self.assertEqual(result.returncode, 41, result.stderr)
        self.assertIn(['tag','sha256:'+'c'*64,'aemr-server:previous'],calls)
        self.assertIn(['tag','sha256:'+'e'*64,'aemr-web:previous'],calls)
        self.assertEqual(state,'running')
        self.assertEqual(receipt['rollback']['web_image'],'sha256:'+'e'*64)

    def test_late_worker_failure_never_starts_old_api_or_restores_global_state(self):
        result, calls, state, receipt = self.release_owner_case('worker-failed')
        self.assertEqual(result.returncode,51,result.stderr)
        self.assertEqual(state,'running')
        self.assertFalse(any(c[0]=='start' or 'restore-reports' in c for c in calls))
        self.assertTrue(receipt['restore']['source_matched'])

    def test_git_checkout_failure_resumes_unchanged_original_api(self):
        result,calls,state,_=self.release_owner_case('checkout-failed')
        self.assertEqual(result.returncode,52,result.stderr)
        self.assertEqual(state,'running')
        self.assertEqual([c for c in calls if c[0]=='start'],[['start','a'*64]])
        self.assertFalse(any('up' in c for c in calls))

    def test_docker_build_failure_resumes_unchanged_original_api(self):
        result,calls,state,_=self.release_owner_case('build-failed')
        self.assertEqual(result.returncode,53,result.stderr)
        self.assertEqual(state,'running')
        self.assertEqual([c for c in calls if c[0]=='start'],[['start','a'*64]])
        self.assertFalse(any('up' in c for c in calls))

    def test_sigkill_release_owner_drops_lock_and_actual_guard_recovers_api(self):
        import json
        import os
        import signal
        import subprocess
        import sys
        import tempfile
        import textwrap
        import time
        from pathlib import Path
        root=Path(__file__).resolve().parents[2]
        workflow=(root/'.github/workflows/ci.yml').read_text()
        remote=workflow.split('      - name: Deploy tested commit over SSH',1)[1].split('          script: |\n',1)[1]
        prefix=textwrap.dedent(remote.split('            previous_worker=',1)[0]).replace('/home/aemr/dash','.')
        with tempfile.TemporaryDirectory() as tmp:
            folder=Path(tmp);(folder/'deploy').mkdir()
            state=folder/'state';state.write_text('exited')
            ready=folder/'child-ready';policy=folder/'policy.json'
            policy.write_text(json.dumps({'project':'aemr','worker_enabled':False,'services':{'server':{'container':'aemr-server'}}}))
            docker=folder/'docker'
            docker.write_text(r'''#!/usr/bin/env python3
import json,os,sys,time
from pathlib import Path
args=sys.argv[1:];state=Path(os.environ['API_STATE'])
if args[0]=='wait-forever':
 Path(os.environ['CHILD_READY']).write_text(str(os.getpid()));time.sleep(30)
elif args[0]=='inspect':
 print(json.dumps([{'Name':'/aemr-server','Image':'sha256:'+'c'*64,'Config':{'Labels':{'com.docker.compose.project':'aemr','com.docker.compose.service':'server'}},'State':{'Status':state.read_text()}}]))
elif args[0]=='start':state.write_text('running')
''');docker.chmod(0o700)
            env={**os.environ,'PATH':tmp+os.pathsep+os.environ['PATH'],'API_STATE':str(state),'CHILD_READY':str(ready)}
            prefix=prefix.replace('/run/lock/aemr-maintenance.lock',str(folder/'maintenance.lock'))
            owner=subprocess.Popen(['bash','-c',prefix+'\ndocker wait-forever\n'],cwd=folder,env=env,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
            child=None
            try:
                for _ in range(100):
                    if ready.exists():break
                    time.sleep(.02)
                self.assertTrue(ready.exists())
                child=int(ready.read_text())
                self.assertNotEqual(subprocess.run(['flock','-n',str(folder/'maintenance.lock'),'true'],check=False).returncode,0)
                owner.kill();owner.wait(timeout=3)
                guarded=subprocess.run([sys.executable,str(root/'deploy/runtime_guard.py'),'--policy',str(policy),'--state',str(folder/'guard-state.json'),'--lock',str(folder/'maintenance.lock')],env=env,capture_output=True,text=True,timeout=3,check=False)
                self.assertEqual(guarded.returncode,0,guarded.stderr)
                self.assertEqual(state.read_text(),'running','orphan external child retained maintenance lock')
            finally:
                if owner.poll() is None:owner.kill();owner.wait(timeout=3)
                if owner.stderr:owner.stderr.close()
                if child:
                    try:os.kill(child,signal.SIGTERM)
                    except ProcessLookupError:pass

    def test_unavailable_privileged_guard_policy_blocks_before_api_stop(self):
        result,calls,state,receipt=self.release_owner_case('policy-unavailable')
        self.assertEqual(result.returncode,54,result.stderr)
        self.assertEqual(state,'running')
        self.assertIsNone(receipt)
        self.assertFalse(any(c[0] in {'stop','start'} or 'up' in c for c in calls))


if __name__ == "__main__":
    unittest.main()
