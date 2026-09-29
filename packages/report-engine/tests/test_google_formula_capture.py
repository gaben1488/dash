from procurement_engine.google_adapter import GoogleSheetSourceAdapter
from procurement_engine.raw_pipeline import header_hash


class Client:
    def grid(self, provider, sheet_id):
        return {'title': 'Master', 'gridProperties': {'rowCount': 3, 'columnCount': 3}}

    def formula_context(self, provider):
        return {'sheets': [{'sheetId': 0, 'title': 'Master'}], 'named_ranges': []}

    def values(self, provider, title, start, end, columns):
        return [['header'], [1, 2, 3], []][start - 1:end]

    def formulas(self, provider, title, start, end, columns):
        return [['header'], [1, 2, '=SUM(A2:B2)'], []][start - 1:end]


def test_adapter_persists_formula_locations_and_context_in_same_payload():
    contract = {'source_id': 'master', 'role': 'master', 'provider_id': 'book',
                'sheet_id': 0, 'sheet': 'Master', 'columns': 3, 'header_rows': 1,
                'units': 'thousand', 'schema_fingerprint': header_hash([['header']], 1)}
    payload = GoogleSheetSourceAdapter(contract, Client(), chunk_rows=2).read_payload()
    evidence = payload.metadata['formula_evidence']
    assert evidence['rows'] == 3
    assert evidence['columns'] == 3
    assert evidence['formulas'] == [{'row': 2, 'column': 3, 'formula': '=SUM(A2:B2)'}]
    assert evidence['sheets'] == [{'sheetId': 0, 'title': 'Master'}]
    assert evidence['named_ranges'] == []


def test_formula_scan_reads_grid_width_even_if_value_contract_omits_columns():
    class Wide(Client):
        def grid(self, provider, sheet_id):
            return {'title': 'Master', 'gridProperties': {'rowCount': 3, 'columnCount': 4}}

        def formulas(self, provider, title, start, end, columns):
            assert columns == 4
            return [['header'], [1, 2, 3, '=IMPORTDATA("url")'], []][start - 1:end]

    contract = {'source_id': 'master', 'role': 'master', 'provider_id': 'book',
                'sheet_id': 0, 'sheet': 'Master', 'columns': 3, 'header_rows': 1,
                'units': 'thousand', 'schema_fingerprint': header_hash([['header']], 1)}
    payload = GoogleSheetSourceAdapter(contract, Wide()).read_payload()
    assert payload.metadata['formula_evidence']['columns'] == 4
    assert payload.metadata['formula_evidence']['formulas'][0]['column'] == 4
