import pytest
from procurement_engine.google_adapter import GoogleReadError, GoogleSheetSourceAdapter
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


def test_wider_grid_captures_dependency_values_without_expanding_business_columns():
    from procurement_engine.formula_dependencies import audit_formula_dependencies

    class Wide(Client):
        def grid(self, provider, sheet_id):
            return {'title': 'Master', 'gridProperties': {'rowCount': 3, 'columnCount': 4}}

        def values(self, provider, title, start, end, columns):
            assert columns == 4
            return [['header'], [1, 2, 7, 7], []][start - 1:end]

        def formulas(self, provider, title, start, end, columns):
            return [['header'], [1, 2, '=D2', 7], []][start - 1:end]

    contract = {'source_id': 'master', 'role': 'master', 'provider_id': 'book',
                'sheet_id': 0, 'sheet': 'Master', 'columns': 3, 'header_rows': 1,
                'units': 'thousand', 'schema_fingerprint': header_hash([['header']], 1)}
    payload = GoogleSheetSourceAdapter(contract, Wide()).read_payload()
    assert payload.semantic_values == [['header'], [1, 2, 7], []]
    evidence = payload.metadata['formula_evidence']
    assert evidence['extra_values'] == [[], [7], []]
    result = audit_formula_dependencies({'sources': [{**contract, 'rows': 3,
        'values': payload.semantic_values, 'formula_evidence': evidence}]})
    assert result['closed'], result['issues']

 
@pytest.mark.parametrize('registered_width, physical_width', [
    (18, 18), (19, 19), (32, 32), (34, 34),
    (18, 34), (19, 34), (32, 34), (34, 35),
])
def test_canonical_directory_exact_physical_width_guards_live_capture(
        registered_width, physical_width):
    """Historical frozen schemas stay readable; live width drift cannot hide columns."""
    class Directory(Client):
        def grid(self, provider, sheet_id):
            assert sheet_id == 837564274
            return {'title': 'Справочник заказчиков',
                    'gridProperties': {'rowCount': 2, 'columnCount': physical_width}}

        def values(self, provider, title, start, end, columns):
            assert columns == physical_width
            return [['Heading'], list(range(physical_width))][start - 1:end]

        def formulas(self, provider, title, start, end, columns):
            assert columns == physical_width
            return self.values(provider, title, start, end, columns)

        def formula_context(self, provider):
            return {'sheets': [{'sheetId': 837564274, 'title': 'Справочник заказчиков'}],
                    'named_ranges': []}

    contract = {'source_id': 'directory', 'role': 'formula_dependency',
                'provider_id': '1wET-yUf9OQGTgPWSs96xAE3X7WSrVejtVGWRH1pv-1E',
                'sheet_id': 837564274, 'sheet': 'Справочник заказчиков',
                'columns': registered_width, 'header_rows': 1, 'units': 'directory',
                'schema_fingerprint': header_hash([['Heading']], 1)}
    adapter = GoogleSheetSourceAdapter(contract, Directory())
    if registered_width != physical_width:
        with pytest.raises(GoogleReadError, match='MONITORING_SCHEMA_LIVE_GEOMETRY_MISMATCH'):
            adapter.read_payload()
        return
    payload = adapter.read_payload()
    assert len(payload.semantic_values[1]) == registered_width
    assert payload.metadata['formula_evidence']['columns'] == registered_width
    assert 'extra_values' not in payload.metadata['formula_evidence']
