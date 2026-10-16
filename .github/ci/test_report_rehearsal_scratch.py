"""Catalog-bearing rehearsals must not copy a growing DB into small RAM scratch."""
import unittest
from pathlib import Path

WORKFLOW = Path(__file__).resolve().parents[1] / 'workflows/report-rehearsal.yml'


def docker_commands(text):
    command = ''
    for line in text.splitlines():
        if line.lstrip().startswith('docker run '):
            command = line.strip()
        elif command:
            command += '\n' + line.strip()
        if command and not line.rstrip().endswith('\\'):
            yield command
            command = ''


class ReportRehearsalScratchTests(unittest.TestCase):
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
