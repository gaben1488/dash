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


if __name__ == "__main__":
    unittest.main()
