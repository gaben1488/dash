"""Read-only browser admission must not pass an unopened maintenance descriptor."""
import ast
import importlib.util
import os
import subprocess
import sys
import unittest
from pathlib import Path
from unittest import mock

ROOT=Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('browser_release_recovery',ROOT/'deploy/release_recovery.py')
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)


class BrowserAdmissionTests(unittest.TestCase):
    def test_actual_workflow_constructor_runs_with_no_maintenance_fd(self):
        workflow=(ROOT/'.github/workflows/ci.yml').read_text()
        section=workflow.split('  browser-readback:\n',1)[1].split('  observe:\n',1)[0]
        line=next(line.strip() for line in section.splitlines() if 'executor=r.ReleaseRecovery(' in line)
        assignment=ast.parse(line.split(';',1)[0])
        context={'r':module};exec(compile(assignment,'<browser-workflow>','exec'),context)  # noqa: S102 - execute only the trusted workflow constructor
        original=subprocess.run
        def native_probe(arguments,**kwargs):
            return original([sys.executable,'-IB','-c','print("{}")'],**kwargs)
        saved=None
        try:
            try:saved=os.dup(9);os.close(9)
            except OSError:pass
            with mock.patch.object(module.subprocess,'run',side_effect=native_probe):
                self.assertEqual(context['executor'].command(['inspect','synthetic']), '{}\n')
        finally:
            if saved is not None:os.dup2(saved,9);os.close(saved)


if __name__=='__main__':unittest.main()
