import importlib.util
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


class RuntimeProbeTests(unittest.TestCase):
    def tool(self):
        path = ROOT / 'deploy/runtime-state-probe.py'
        self.assertTrue(path.is_file(), 'Missing read-only runtime probe')
        spec = importlib.util.spec_from_file_location('runtime_probe', path)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module

    def sample(self):
        return {'containers': [{'id': 'c', 'image': 'i', 'status': 'running', 'started': 't', 'restarts': 0,
                                'mounts': [{'Destination': '/a', 'Source': '/private/a', 'Type': 'volume'}, {'Destination': '/b', 'Source': '/private/b', 'Type': 'bind'}]}],
                'images': [{'ID': 'i', 'Repository': 'app', 'Tag': 'previous'}, {'ID': 'd', 'Repository': '<none>', 'Tag': '<none>'}]}

    def test_mount_array_order_is_distinguished_from_real_mount_change(self):
        tool = self.tool()
        before, after = self.sample(), self.sample()
        after['containers'][0]['mounts'].reverse()
        result = tool.compare(before, after)
        self.assertEqual(result['mount_changes'], 0)
        self.assertTrue(result['raw_mount_order_changed'])
        after['containers'][0]['mounts'][0]['Source'] = '/private/replaced'
        self.assertEqual(tool.compare(before, after)['mount_changes'], 1)

    def test_runtime_restart_and_tag_changes_are_not_hidden_as_cache(self):
        tool = self.tool()
        before, after = self.sample(), self.sample()
        after['containers'][0]['started'] = 'new-time'
        after['images'][0]['ID'] = 'new-image'
        result = tool.compare(before, after)
        self.assertEqual(result['runtime_changes'], 1)
        self.assertEqual(result['protected_tag_changes'], 1)
        self.assertNotIn('/private', str(result))

    def test_dangling_catalog_change_is_separate_and_not_silently_accepted(self):
        tool = self.tool()
        before, after = self.sample(), self.sample()
        after['images'].pop()
        result = tool.compare(before, after)
        self.assertEqual(result['dangling_changes'], 1)
        self.assertEqual(result['runtime_changes'], 0)
        self.assertEqual(result['status'], 'TECHNICAL_STATE_CHANGED')


if __name__ == '__main__':
    unittest.main()
