"""The read-only observer works before an optional failure receipt exists."""
import contextlib
import io
import json
import os
import re
import stat
import tempfile
import textwrap
import unittest
from pathlib import Path


class ReleaseObserverTests(unittest.TestCase):
    def run_observer(self, target):
        workflow = (Path(__file__).resolve().parents[1] / 'workflows/ci.yml').read_text()
        function = re.search(
            r'^            def release_failure_metadata\(\):\n.*?(?=^            def transfer_host_metadata\(\):)',
            workflow, re.MULTILINE | re.DOTALL).group()
        function = textwrap.dedent(function).replace(
            '/root/codex-fixes/release-38831492016/runner-diagnostics.json', str(target))
        namespace = {'Path': Path, 'os': os, 'stat': stat, 'json': json, 're': re}
        exec(compile(function, '<actual-workflow-observer>', 'exec'), namespace)  # noqa: S102 — actual trusted workflow code.
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            namespace['release_failure_metadata']()
        return json.loads(output.getvalue())

    def test_no_failure_receipt_during_normal_backup_is_observable(self):
        with tempfile.TemporaryDirectory() as folder:
            result = self.run_observer(Path(folder) / 'not-created.json')
        self.assertEqual(result, {'release_failure_metadata': True, 'present': False})

    def test_dangling_failure_receipt_symlink_is_rejected(self):
        with tempfile.TemporaryDirectory() as folder:
            target = Path(folder) / 'unsafe.json'
            target.symlink_to(Path(folder) / 'absent.json')
            with self.assertRaises(AssertionError):
                self.run_observer(target)


if __name__ == '__main__':
    unittest.main()
