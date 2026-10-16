"""The operational source probe reveals comparisons, never primary values."""
import importlib.util
import unittest
from pathlib import Path
from types import SimpleNamespace


class DriftProbeTests(unittest.TestCase):
    def setUp(self):
        spec = importlib.util.spec_from_file_location('source_drift_probe', Path(__file__).with_name('source_drift_probe.py'))
        self.module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.module)

    def test_exact_coordinates_preserve_missing_empty_zero_and_type(self):
        result = self.module.value_differences([[0, '', None, 3]], [['0', '', None], ['PRIVATE_SENTINEL']])
        self.assertEqual(result, {'changed_cells': 3, 'coordinates': [[1, 1], [1, 4], [2, 1]], 'truncated': False})
        self.assertNotIn('PRIVATE_SENTINEL', str(result))

    def test_coordinates_are_bounded_without_losing_total(self):
        result = self.module.value_differences([[1] * 120], [[]])
        self.assertEqual(result['changed_cells'], 120)
        self.assertEqual(len(result['coordinates']), 50)
        self.assertTrue(result['truncated'])

    def test_metadata_and_schema_are_reported_separately(self):
        source = {'values': [['PRIVATE_OLD']], 'sheet': 'PRIVATE_TITLE', 'grbs': 'PRIVATE_CUSTOMER',
                  'rows': 2, 'columns': 1, 'formula_evidence': {'PRIVATE_FORMULA': 'OLD'}}
        contract = {'header_rows': 1, 'units': 'rubles', 'schema_fingerprint': 'old'}
        payload = SimpleNamespace(semantic_values=[['PRIVATE_NEW']], schema_fingerprint='new',
                                  metadata={'formula_evidence': {'PRIVATE_FORMULA': 'NEW'}})
        result = self.module.compare_source(source, contract, payload, lambda x: repr(x), lambda x: x,
                                            lambda *a, **k: 'old')
        self.assertEqual(result['values_equal'], False)
        self.assertEqual(result['metadata_equal'], False)
        self.assertEqual(result['schema_equal'], False)
        self.assertNotIn('PRIVATE', str(result))

    def test_installed_semantic_helpers_ignore_display_only_changes(self):
        import copy

        from procurement_engine.google_adapter import source_semantic_metadata
        from procurement_engine.raw_pipeline import header_hash
        from procurement_engine.snapshot import canonical_semantic_hash

        evidence = {'sheets': [{'sheetId': 1, 'title': 'PRIVATE', 'hidden': False,
                               'gridProperties': {'rowCount': 2, 'columnCount': 1}}],
                    'named_ranges': [], 'formulas': [['=1']], 'rows': 2, 'columns': 1}
        frozen = {'sheet': 'PRIVATE', 'grbs': None, 'values': [['Header'], [1]],
                  'rows': 2, 'columns': 1, 'formula_evidence': evidence}
        contract = {'header_rows': 1, 'units': 'rubles', 'schema_fingerprint': header_hash(frozen['values'], 1)}
        changed = copy.deepcopy(evidence)
        changed['sheets'][0]['hidden'] = True
        payload = SimpleNamespace(semantic_values=frozen['values'], schema_fingerprint=contract['schema_fingerprint'],
                                  metadata={'formula_evidence': changed})
        result = self.module.compare_source(frozen, contract, payload, canonical_semantic_hash, source_semantic_metadata, header_hash)
        self.assertTrue(result['values_equal'])
        self.assertTrue(result['metadata_equal'])
        self.assertTrue(result['schema_equal'])
        self.assertFalse(result['formula_evidence_equal'])

    def test_one_source_reuses_shared_payload_without_loading_full_capture(self):
        import json
        import os
        import tempfile

        with tempfile.TemporaryDirectory() as temporary:
            bundle = Path(temporary)
            (bundle / 'payloads').mkdir()
            path = bundle / 'payloads/TEST.json'
            contract = {'provider_id': 'private', 'role': 'master', 'sheet_id': 1}
            payload = {'source_id': 'TEST', **contract, 'sheet_or_tab_id': '1',
                       'semantic_values': [['PRIVATE']], 'metadata': {'sheet_title': 'Private', 'grbs': 'Private',
                       'row_count': 1, 'column_count': 1, 'formula_evidence': {}, 'capture_method': 'native'}}
            path.write_text(json.dumps(payload))
            path.chmod(0o600)
            os.link(path, bundle / 'same-content.json')
            frozen = self.module.frozen_source(bundle, 'TEST', contract, {'TEST': 'captured'})
            self.assertEqual(frozen['values'], [['PRIVATE']])
            self.assertEqual(frozen['after'], 'captured')
            # Shared payloads are legitimate; mutable private config remains stricter.
            with self.assertRaises(AssertionError):
                self.module.read_private(path, 16384)

    def test_streaming_manifest_rejects_fifo_symlink_and_wrong_hash(self):
        import hashlib
        import os
        import tempfile

        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            path = root / 'manifest.json'
            path.write_bytes(b'private-fixture')
            path.chmod(0o600)
            digest = hashlib.sha256(b'private-fixture').hexdigest()
            self.module.verify_manifest(path, digest)
            with self.assertRaises(AssertionError):
                self.module.verify_manifest(path, '0' * 64)
            os.symlink(path, root / 'link.json')
            with self.assertRaises(AssertionError):
                self.module.verify_manifest(root / 'link.json', digest)
            os.mkfifo(root / 'fifo.json', 0o600)
            with self.assertRaises(AssertionError):
                self.module.verify_manifest(root / 'fifo.json', digest)


if __name__ == '__main__':
    unittest.main()
