import contextlib
import importlib.util
import io
import itertools
import json
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch


def tool():
    spec = importlib.util.spec_from_file_location('native_selection_profile', Path(__file__).with_name('native_selection_profile.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def fixture():
    calls = []
    receipt = {'release_id': 'REL-' + 'a' * 64, 'PRIVATE_BODY': 'PRIVATE_AUTHOR_VALUE'}
    def inventory(root):
        calls.append('inventory')
        return {'PRIVATE_PATH': 'PRIVATE_HASH'}
    def model(path):
        calls.append('model')
        return {'PRIVATE_MODEL': path}
    def rows(*args, **kwargs):
        calls.append('sql_advance')
        yield ('PRIVATE_RECEIPT', 'PRIVATE_FILES')
        calls.append('sql_exhausted')
    class Store:
        def _checked(self, row):
            store._files('PRIVATE_ROOT')
            return receipt
        def _select(self):
            for row in store._ordered_publication_rows():
                value = self._checked(row)
                store._json('PRIVATE_MODEL_PATH')
                return value
        def _latest_for_period(self, cached):
            for _ in store._ordered_publication_rows():
                store._json('PRIVATE_MODEL_PATH')
                return cached
        def select_status(self, *selection):
            first = self._select()
            return {'selected': first, 'latest_matching': self._latest_for_period(first)}
    store = SimpleNamespace(PublicationStore=Store, _files=inventory, _json=model, _ordered_publication_rows=rows)
    def projection(value):
        return value
    def read(state, view, *, selection):
        calls.append((state, view, selection))
        return json.dumps(reader._status_projection(Store().select_status(*selection))).encode()
    reader = SimpleNamespace(read_publication=read, _status_projection=projection)
    return reader, store, calls


class NativeSelectionProfileTests(unittest.TestCase):
    def test_one_native_read_records_real_advancement_and_conditional_memo_path_without_private_output(self):
        module = tool()
        reader, store, calls = fixture()
        originals = (store.PublicationStore._checked, store._files, store._json, store._ordered_publication_rows)
        result = module.run_profile(reader, store, ('2026-10-17', 2026, 4))
        phases = {row['phase']: row for row in result['phases']}
        self.assertEqual(result['scope'], 'NATIVE_SINGLE_READ')
        self.assertEqual(calls.count((module.STATE, 'status', ('2026-10-17', 2026, 4))), 1)
        self.assertTrue(result['selected_present'] and result['latest_matching_present'] and result['same_release'])
        self.assertEqual(phases['catalog_iteration']['calls'], 2)
        self.assertEqual(calls.count('sql_advance'), 2)
        self.assertEqual(phases['bundle_validation']['calls'], 1)
        self.assertEqual(phases['artifact_inventory']['calls'], 1)
        self.assertEqual(phases['model_json']['calls'], 2)
        self.assertEqual(originals, (store.PublicationStore._checked, store._files, store._json, store._ordered_publication_rows))
        self.assertNotIn('PRIVATE', json.dumps(result))
        self.assertNotIn('REL-', json.dumps(result))

    def test_original_failure_identity_and_all_wrappers_are_restored(self):
        module = tool()
        reader, store, _ = fixture()
        error = ValueError('PRIVATE_DATA_PATH')
        def broken(root):
            raise error
        store._files = broken
        original = store.PublicationStore.select_status
        with self.assertRaises(ValueError) as raised:
            module.run_profile(reader, store, ('2026-10-17', 2026, 4))
        self.assertIs(raised.exception, error)
        self.assertIs(store._files, broken)
        self.assertIs(store.PublicationStore.select_status, original)

    def test_generator_send_throw_close_and_return_value_are_preserved(self):
        module = tool()
        closed = []
        def source():
            try:
                value = yield 'first'
                try:
                    yield value
                except LookupError:
                    return 'PRIVATE_RETURN'
            finally:
                closed.append(True)
        profile = module.Profile()
        wrapped = module.timed_rows(source, profile)()
        self.assertEqual(next(wrapped), 'first')
        self.assertEqual(wrapped.send('second'), 'second')
        with self.assertRaises(StopIteration) as stopped:
            wrapped.throw(LookupError('PRIVATE_ERROR'))
        self.assertEqual(stopped.exception.value, 'PRIVATE_RETURN')
        self.assertEqual(closed, [True])
        wrapped = module.timed_rows(source, profile)()
        next(wrapped)
        wrapped.close()
        self.assertEqual(closed, [True, True])

    def test_clock_anomalies_and_counters_are_bounded_without_changing_return(self):
        module = tool()
        for clock in (lambda: float('nan'), lambda: float('inf'), lambda: True,
                      lambda: -1, lambda: 'PRIVATE_CLOCK', itertools.count(1000, -1).__next__):
            with self.subTest(clock=clock):
                profile = module.Profile(wall=clock, cpu=clock)
                marker = object()
                self.assertIs(profile.measure('native_read', lambda marker=marker: marker), marker)
                value = profile.summary()
                self.assertIsNone(next(item for item in value if item['phase'] == 'native_read')['wall_ms'])
                self.assertNotIn('PRIVATE', json.dumps(value, allow_nan=False))
        profile = module.Profile()
        profile.metrics['native_read']['calls'] = module.COUNT_LIMIT
        profile.measure('native_read', lambda: None)
        self.assertEqual(profile.metrics['native_read']['calls'], module.COUNT_LIMIT)
        self.assertTrue(profile.truncated)
        with self.assertRaises(ValueError):
            profile.measure('PRIVATE_PHASE', lambda: None)

    def test_null_and_different_release_results_remain_valid_and_body_is_bounded(self):
        module = tool()
        reader, store, _ = fixture()
        for selected, latest, expected in ((None, None, (False, False, False)),
                (None, {'release_id': 'REL-' + 'b'*64}, (False, True, False)),
                ({'release_id': 'REL-' + 'a'*64}, {'release_id': 'REL-' + 'b'*64}, (True, True, False))):
            reader.read_publication = lambda *args, selected=selected, latest=latest, **kwargs: json.dumps({'selected': selected, 'latest_matching': latest}).encode()
            result = module.run_profile(reader, store, ('2026-10-17', 2026, 4))
            self.assertEqual(tuple(result[name] for name in ('selected_present', 'latest_matching_present', 'same_release')), expected)
        for body in (b'x' * (module.RESULT_LIMIT + 1), b'PRIVATE_MALFORMED_BODY', b'{"selected":{},"latest_matching":null}'):
            reader.read_publication = lambda *args, body=body, **kwargs: body
            with self.assertRaises(ValueError):
                module.run_profile(reader, store, ('2026-10-17', 2026, 4))

    def test_cli_context_is_required_validated_and_never_discovered_or_imported_on_error(self):
        module = tool()
        args = ['--report-date', '2026-10-17', '--report-year', '2026', '--quarter', '4']
        self.assertEqual(module.parse_context(args), ('2026-10-17', 2026, 4))
        for invalid in ([], args[:-1], ['--report-date', 'PRIVATE_DATE', *args[2:]],
                        ['--report-date', '2026-02-30', *args[2:]], [*args[:-1], '0'],
                        [*args[:3], 'PRIVATE_YEAR', *args[4:]], [*args, '--state', '/PRIVATE_PATH']):
            with self.subTest(invalid=invalid), self.assertRaises(ValueError):
                module.parse_context(invalid)
        with patch.object(sys, 'argv', ['profile', '--PRIVATE_ARGUMENT']), contextlib.redirect_stdout(io.StringIO()) as stdout, contextlib.redirect_stderr(io.StringIO()) as stderr:
            self.assertEqual(module.main(), 2)
        self.assertNotIn('PRIVATE', stdout.getvalue() + stderr.getvalue())

    def test_main_failure_emits_only_fixed_code_and_counts_with_no_native_target_import_in_fixture(self):
        module = tool()
        reader, store, _ = fixture()
        reader.read_publication = lambda *args, **kwargs: (_ for _ in ()).throw(RuntimeError('PRIVATE_ERROR_BODY'))
        modules = {'procurement_engine': SimpleNamespace(publication_reader=reader, publication_store=store)}
        with patch.dict(sys.modules, modules), patch.object(sys, 'argv', ['profile', '--report-date', '2026-10-17', '--report-year', '2026', '--quarter', '4']), contextlib.redirect_stdout(io.StringIO()) as output:
            self.assertEqual(module.main(), 2)
        result = json.loads(output.getvalue())
        self.assertEqual(result['code'], 'NATIVE_SELECTION_PROFILE_FAILED')
        self.assertNotIn('PRIVATE', output.getvalue())


if __name__ == '__main__':
    unittest.main()
