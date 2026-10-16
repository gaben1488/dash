import contextlib
import copy
import importlib.util
import io
import json
import os
import unittest
from pathlib import Path
from unittest.mock import patch


def load_tool():
    path = Path(__file__).with_name('provenance_api_probe.py')
    spec = importlib.util.spec_from_file_location('provenance_api_probe', path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


BOOK_ID = 'PRIVATE_BOOK_IDENTIFIER_123456789012345678901234'


def fixture():
    source = {'spreadsheetId': BOOK_ID, 'journalSheet': '_ChangeLog', 'journalRow': 9, 'readAt': 1700000000000}
    event = {'sheet': 'PRIVATE_CHANGED_SHEET', 'cell': 'K419', 'column': 'K',
             'was': 100, 'became': 90, 'delta': -10, 'at': '2026-10-16T12:00:00',
             'author': 'PRIVATE_AUTHOR', 'kind': 'retro-cut', 'wasKnown': True, 'becameKnown': True,
             'witnessCount': 1, 'sources': [source]}
    row = {'dept': 'УКСиМП', 'deptLatin': 'uksimp', 'rowSeq': '416', 'sheetRow': 419,
           'journalAvailable': True, 'events': [event], 'ambiguity': None,
           'summary': {'witnessCount': 1, 'financialAmbiguityCount': 0, 'retroCutCount': 1, 'retroCutTotal': 10},
           'observability': {'journalEntries': 1, 'coversRow': True, 'planEntries': 1}}
    rows = {label: (200, copy.deepcopy(row)) for label in ('416', '434', '437', '449', '456', '477')}
    for label, (_, value) in rows.items():
        value['rowSeq'] = label
        if label != '416':
            value['events'] = []
            value['summary'].update(witnessCount=0, retroCutCount=0, retroCutTotal=0)
            value['observability'].update(coversRow=False, planEntries=0)
    health = {'booksTotal': 1, 'booksRead': 1, 'witnessCount': 1, 'financialAmbiguityCount': 0,
              'books': [{'dept': 'УКСиМП', 'spreadsheetId': BOOK_ID, 'journalAvailable': True,
                         'journalEntries': 1, 'rows': 6, 'rowsCovered': 1,
                         'provenance': {'witnessCount': 1, 'financialAmbiguityCount': 0}}]}
    entry = {'origin': 'book-journal', 'book': 'УКСиМП', 'sheet': event['sheet'], 'rowSeq': '416',
             'column': 'K', 'sheetRow': 419, 'at': event['at'], 'author': event['author'],
             'journalSource': copy.deepcopy(source), 'before': 'PRIVATE_VALUE', 'after': 'PRIVATE_VALUE'}
    story = {'shown': 1, 'total': 1, 'entries': [entry], 'gaps': [], 'deletionsUnobservable': True}
    return health, rows, story


class ProvenanceApiProbeTests(unittest.TestCase):
    def test_fixed_sample_preserves_alabel_and_projects_no_private_data(self):
        tool = load_tool()
        result = tool.inspect_sample(*fixture())
        self.assertEqual(result['status'], 'SAMPLE_VALID')
        self.assertEqual(result['same_read_witnesses_checked'], 1)
        self.assertEqual(result['classes']['unknown_sides'], 'NOT_OBSERVED')
        self.assertFalse(result['full_journal_accepted'])
        text = json.dumps(result, ensure_ascii=False)
        for private in ('PRIVATE', 'K419', '416', 'УКСиМП', '2026-10-16'):
            self.assertNotIn(private, text)

    def test_malformed_flags_addresses_and_witness_counts_fail_closed(self):
        tool = load_tool()
        variants = [lambda e: e.update(wasKnown='false'), lambda e: e.update(becameKnown=None),
                    lambda e: e.update(witnessCount=2), lambda e: e['sources'][0].update(readAt=True),
                    lambda e: e['sources'][0].update(journalRow=0),
                    lambda e: e['sources'][0].update(spreadsheetId='OTHER_BOOK'),
                    lambda e: e['sources'].append(copy.deepcopy(e['sources'][0])),
                    lambda e: e.update(cell='K420'),
                    lambda e: e.update(wasKnown=False, delta=-10)]
        for change in variants:
            with self.subTest(change=change):
                health, rows, story = fixture()
                change(rows['416'][1]['events'][0])
                with self.assertRaises(ValueError):
                    tool.inspect_sample(health, rows, story)
        health, rows, story = fixture()
        rows['416'][1]['rowSeq'] = '419'  # Physical sheet row must never replace the A-label.
        with self.assertRaises(ValueError):
            tool.inspect_sample(health, rows, story)

    def test_ambiguity_keeps_other_confirmed_subtotal_and_unknown_is_not_zero(self):
        tool = load_tool()
        health, rows, story = fixture()
        event = copy.deepcopy(rows['416'][1]['events'][0])
        event.update(cell='J419', column='J', was=None, wasKnown=False, delta=None, kind='unknown')
        event['sources'][0]['journalRow'] = 10
        rows['416'][1]['events'].append(event)
        rows['416'][1]['summary'].update(witnessCount=2, financialAmbiguityCount=1)
        result = tool.inspect_sample(health, rows, story)
        self.assertEqual(result['status'], 'SAMPLE_VALID')
        self.assertEqual(result['classes']['financial_ambiguity'], 'OBSERVED')
        self.assertEqual(result['classes']['unknown_sides'], 'OBSERVED')
        self.assertNotIn('retroCutTotal', json.dumps(result))
        rows['416'][1]['summary']['witnessCount'] = 0
        with self.assertRaises(ValueError):
            tool.inspect_sample(health, rows, story)

    def test_unavailable_unread_empty_and_not_found_are_distinct(self):
        tool = load_tool()
        health, rows, story = fixture()
        rows['434'] = (404, None)
        rows['437'] = (503, None)
        rows['449'][1]['journalAvailable'] = False
        result = tool.inspect_sample(health, rows, story)
        self.assertEqual(result['status'], 'SAMPLE_UNAVAILABLE')
        self.assertEqual([result[key] for key in ('missing_rows', 'unavailable_rows', 'unread_rows', 'empty_readable_rows')],
                         [1, 1, 1, 2])

    def test_only_actual_same_read_overlaps_are_compared_including_folded_evidence(self):
        tool = load_tool()
        health, rows, story = fixture()
        original = story['entries'][0]
        story['entries'] = [{'origin': 'book-journal', 'book': 'УКСиМП', 'evidence': [original]}]
        self.assertEqual(tool.inspect_sample(health, rows, story)['same_read_witnesses_checked'], 1)
        original['journalSource']['readAt'] += 1
        original['sheet'] = 'DIFFERENT_READING'
        result = tool.inspect_sample(health, rows, story)
        self.assertEqual(result['same_read_witnesses_checked'], 0)
        self.assertEqual(result['classes']['same_read_overlap'], 'NOT_OBSERVED')
        original['journalSource']['readAt'] -= 1
        with self.assertRaises(ValueError):
            tool.inspect_sample(health, rows, story)
        original['sheet'] = rows['416'][1]['events'][0]['sheet']
        story.update(total=2001, shown=1)
        self.assertTrue(tool.inspect_sample(health, rows, story)['story_truncated'])

    def test_transport_is_get_only_bounded_loopback_no_redirect_or_proxy(self):
        tool = load_tool()
        class Response:
            status = 200
            def __enter__(self): return self
            def __exit__(self, *_): return False
            def read(self, limit): return b'x' * limit
        class Opener:
            def open(self, request, **kwargs):
                self.request = request
                self.timeout = kwargs['timeout']
                return Response()
        opener = Opener()
        with patch.object(tool, 'build_opener', return_value=opener), self.assertRaises(ValueError):
            tool.fetch_json('/api/provenance/health', 'PRIVATE_SECRET', 2)
        self.assertEqual(opener.request.get_method(), 'GET')
        self.assertEqual(opener.request.full_url, 'http://127.0.0.1:3000/api/provenance/health')
        self.assertLessEqual(opener.timeout, 2)
        for path in ('https://foreign/', '/api/refresh', '/api/provenance/uksimp/419'):
            with self.assertRaises(ValueError):
                tool.fetch_json(path, 'PRIVATE_SECRET', 2)
        with self.assertRaises(ValueError):
            tool.NoRedirect().redirect_request(None, None, 302, 'PRIVATE', {}, 'https://foreign/')

    def test_missing_credentials_make_no_requests_and_service_failure_is_not_empty(self):
        tool = load_tool()
        for token, expected, calls in (('', 'SAMPLE_INVALID', 0), ('PRIVATE', 'SAMPLE_UNAVAILABLE', 1)):
            output = io.StringIO()
            with patch.dict(os.environ, {'AEMR_API_KEY': token}), patch.object(tool, 'fetch_json', return_value=(503, None)) as fetch, contextlib.redirect_stdout(output):
                self.assertEqual(tool.main(), 2)
            self.assertEqual(fetch.call_count, calls)
            self.assertEqual(json.loads(output.getvalue())['status'], expected)
            self.assertNotIn('witnesses_checked', output.getvalue())

    def test_main_has_eight_fixed_gets_and_failure_output_never_contains_exception(self):
        tool = load_tool()
        health, rows, story = fixture()
        calls = []
        def fetch(path, token, remaining):
            calls.append(path)
            self.assertEqual(token, 'PRIVATE_SECRET')
            self.assertLessEqual(remaining, 180)
            if path.endswith('/health'): return 200, health
            if path.startswith('/api/change-story?'): return 200, story
            return rows[path.rsplit('/', 1)[1]]
        output = io.StringIO()
        with patch.dict(os.environ, {'AEMR_API_KEY': 'PRIVATE_SECRET'}), patch.object(tool, 'fetch_json', side_effect=fetch), contextlib.redirect_stdout(output):
            self.assertEqual(tool.main(), 0)
        self.assertEqual(len(calls), 8)
        self.assertIn('book=%D0%A3%D0%9A%D0%A1%D0%B8%D0%9C%D0%9F&limit=2000', calls[-1])
        self.assertNotIn('PRIVATE', output.getvalue())
        output = io.StringIO()
        with patch.dict(os.environ, {'AEMR_API_KEY': 'PRIVATE_SECRET'}), patch.object(tool, 'fetch_json', side_effect=RuntimeError('PRIVATE_TOKEN_VALUE_AUTHOR')), contextlib.redirect_stdout(output):
            self.assertEqual(tool.main(), 2)
        self.assertEqual(json.loads(output.getvalue())['status'], 'SAMPLE_UNAVAILABLE')
        self.assertNotIn('PRIVATE', output.getvalue())


if __name__ == '__main__':
    unittest.main()
