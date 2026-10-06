import json

from procurement_engine.raw_pipeline import header_hash
from procurement_engine.semantic_headers import (
    header_contract_diagnostic,
    semantic_header_hash,
)


def test_header_diagnostic_distinguishes_numbered_header_and_full_header_changes():
    old = [['Original caption'], ['Column']]
    new = [['Reviewed caption'], ['Column']]
    source = {'source_id': 'PRIVATE-ID', 'provider_id': 'PRIVATE-BOOK',
        'sheet': 'Процедуры в работе', 'role': 'procedure_view', 'columns': 2,
        'header_rows': 2, 'schema_fingerprint': header_hash(old, 2)}
    result = header_contract_diagnostic(source, new, semantic_header_hash(old, 2, 2))
    assert result == {'kind': 'monitoring_queue', 'role': 'procedure_view', 'columns': 2,
        'header_rows': 2, 'last_row_matches': True, 'pinned_full_header_matches': None,
        'previous_full_header_matches': False}
    assert 'PRIVATE' not in json.dumps(result)


def test_unknown_provider_text_and_header_values_never_enter_public_diagnostics():
    source = {'source_id': 'SECRET', 'sheet': 'SECRET', 'role': 'SECRET',
        'columns': 1, 'header_rows': 1, 'schema_fingerprint': '0' * 64,
        'semantic_header_fingerprint': '0' * 64}
    result = header_contract_diagnostic(source, [['SECRET']])
    assert result['kind'] == result['role'] == 'other'
    assert result['last_row_matches'] is result['pinned_full_header_matches'] is False
    assert result['previous_full_header_matches'] is None
    assert 'SECRET' not in json.dumps(result)
