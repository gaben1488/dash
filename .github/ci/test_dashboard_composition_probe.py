import importlib.util
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location('probe', Path(__file__).with_name('dashboard_composition_probe.py'))
probe = importlib.util.module_from_spec(spec)


class CompositionProbeTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        spec.loader.exec_module(probe)

    def test_full_and_partial_sources_remain_distinct_without_source_values(self):
        snapshot = {'id': 'real-1', 'createdAt': '2026-10-18T15:00:00Z', 'rowCount': 3,
                    'metadata': {'targetYear': 2026, 'sourceCoverage': {'complete': False,
                        'expectedDepartments': ['one', 'two'], 'readDepartments': ['one'],
                        'unreadDepartments': [{'department': 'two', 'reason': 'private failure'}]}},
                    'rowsByDept': {'one': [['PRIVATE ROW'], ['second']]},
                    'issues': [{'description': 'PRIVATE ISSUE'}],
                    'officialMetrics': {'x': {'numericValue': 99}}, 'calculatedMetrics': {}}
        result = probe.summarize(snapshot)
        self.assertFalse(result['coverage']['complete'])
        self.assertEqual(result['coverage']['read'], 1)
        self.assertEqual(result['rows_by_department']['one']['count'], 2)
        self.assertEqual(result['issue_count'], 1)
        self.assertNotIn('PRIVATE', str(result))
        self.assertNotIn('private failure', str(result))
        self.assertNotIn('numericValue', str(result))

    def test_unknown_coverage_and_missing_atoms_do_not_become_complete_or_zero(self):
        result = probe.summarize({'id': 'demo-snapshot', 'metadata': {}})
        self.assertTrue(result['demo'])
        self.assertIsNone(result['coverage'])
        self.assertIsNone(result['rows_by_department'])
        self.assertIsNone(result['target_year'])

    def test_oversized_or_different_scope_snapshot_is_not_comparable(self):
        self.assertFalse(probe.same_scope({'metadata': {}}, 2026))
        self.assertFalse(probe.same_scope({'metadata': {'targetYear': None}}, 2026))
        self.assertTrue(probe.same_scope({'metadata': {'targetYear': 2026}}, 2026))


if __name__ == '__main__':
    unittest.main()
