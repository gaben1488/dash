import json
from itertools import pairwise
from urllib.parse import parse_qs, urlsplit

import pytest
from procurement_engine.google_adapter import (
    GoogleReadClient,
    GoogleReadError,
    GoogleSheetSourceAdapter,
)


def test_batch_uses_ordered_ranges_and_preserves_empty_chunks(monkeypatch):
    requests = []

    def get(url, params):
        requests.append((url, params))
        return {'spreadsheetId': 'synthetic-book', 'valueRanges': [
            {'range': "'Owner''s registry'!A1:AH400", 'values': [['header']]},
            {'range': "'Owner''s registry'!A401:AH800"},
            {'range': "'Owner''s registry'!A801:AH1200", 'values': [['far row']]},
        ]}
    client = GoogleReadClient('synthetic')
    monkeypatch.setattr(client, '_get', get)
    chunks = client.batch_values('synthetic-book', "Owner's registry", [(1, 400), (401, 800), (801, 1200)], 34, 'UNFORMATTED_VALUE')
    assert chunks == [[['header']], [], [['far row']]]
    assert requests[0][0].endswith('/values:batchGet')
    assert requests[0][1]['ranges'] == ["'Owner''s registry'!A1:AH400", "'Owner''s registry'!A401:AH800", "'Owner''s registry'!A801:AH1200"]
    assert requests[0][1]['dateTimeRenderOption'] == 'SERIAL_NUMBER'


@pytest.mark.parametrize('payload', [
    {'spreadsheetId': 'another-book', 'valueRanges': []},
    {'spreadsheetId': 'synthetic-book', 'valueRanges': []},
    {'spreadsheetId': 'synthetic-book', 'valueRanges': [{'range': 'Sheet!A401:B800'}]},
])
def test_missing_or_misaddressed_ranges_fail_closed(monkeypatch, payload):
    client = GoogleReadClient('synthetic')
    monkeypatch.setattr(client, '_get', lambda *_: payload)
    with pytest.raises(GoogleReadError, match='GOOGLE_BATCH_'):
        client.batch_values('synthetic-book', 'Sheet', [(1, 400)], 2, 'FORMULA')


def test_range_query_parameters_are_repeated_not_stringified(monkeypatch):
    seen = []

    class Response:
        def __enter__(self): return self
        def __exit__(self, *_): pass
        def read(self): return json.dumps({'ok': True}).encode()

    def open_request(request, **_):
        seen.append(parse_qs(urlsplit(request.full_url).query))
        return Response()

    monkeypatch.setattr('procurement_engine.google_adapter.urlopen', open_request)
    assert GoogleReadClient('synthetic')._get('https://sheets.googleapis.com/test', {'ranges': ['Sheet!A1:B2', 'Sheet!A3:B4']}) == {'ok': True}
    assert seen == [{'ranges': ['Sheet!A1:B2', 'Sheet!A3:B4']}]


def test_adapter_batches_every_allocated_row_and_formula_with_original_coordinates():
    class Client:
        def __init__(self): self.calls = []
        def grid(self, *_):
            return {'title': 'Sheet', 'gridProperties': {'rowCount': 1601, 'columnCount': 3}}
        def values(self, *_): raise AssertionError('individual values read')
        def formulas(self, *_): raise AssertionError('individual formula read')
        def formula_context(self, *_): return {'sheets': [], 'named_ranges': []}
        def batch_values(self, provider, title, ranges, columns, render):
            self.calls.append((ranges, columns, render))
            return [[['=A1' if render == 'FORMULA' else 'far row']] if start == 1601 else [] for start, _ in ranges]

    client = Client()
    contract = {'source_id': 'synthetic', 'role': 'master', 'provider_id': 'synthetic-book',
                'sheet_id': 0, 'sheet': 'Sheet', 'columns': 2, 'schema_fingerprint': 'synthetic',
                'header_rows': 1, 'units': 'thousand_rub'}
    payload = GoogleSheetSourceAdapter(contract, client).read_payload()
    assert len(payload.semantic_values) == 1601
    assert payload.semantic_values[:1600] == [[] for _ in range(1600)]
    assert payload.semantic_values[1600] == ['far row']
    assert payload.metadata['formula_evidence']['formulas'] == [{'row': 1601, 'column': 1, 'formula': '=A1'}]
    assert len(client.calls) == 4  # Two value batches and two formula batches, not ten requests.
    assert all(len(ranges) <= 4 for ranges, _, _ in client.calls)


def test_wide_formula_grid_keeps_requested_cell_bound_and_last_row():
    class Client:
        def batch_values(self, provider, title, ranges, columns, render):
            assert sum(end - start + 1 for start, end in ranges) * columns <= 64000
            return [[['=1']] if start <= 1601 <= end else [] for start, end in ranges]

    adapter = GoogleSheetSourceAdapter({'source_id': 'test', 'role': 'master',
        'provider_id': 'test', 'sheet': 'Wide', 'schema_fingerprint': 'test'}, Client())
    chunks = list(adapter._chunks(1601, 201, 'FORMULA'))
    assert chunks[0][0] == 1
    assert chunks[-1][1] == 1601
    assert all(left[1] + 1 == right[0] for left, right in pairwise(chunks))
