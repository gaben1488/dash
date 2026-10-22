"""Full-header continuity against the last sealed publication, not live auto-enrolment.

The legacy last-row fingerprint remains readable. This additional gate rejects
changes in ANY declared header row. A deliberate schema migration is a private
contract with exact old/new full-header hashes and a reason, never an inferred fix.
"""
import json

from .normalize import clean_text
from .snapshot import canonical_semantic_hash


def semantic_header_hash(values, header_rows, columns, *, volatile_cells=()):
    if type(header_rows) is not int or type(columns) is not int or header_rows < 1 or columns < 1:
        raise ValueError('SOURCE_SEMANTIC_HEADER_INVALID')
    result = []
    for row in values[:header_rows]:
        cells = []
        for value in row[:columns]:
            cells.append(str(int(value)) if isinstance(value, (int, float))
                         and not isinstance(value, bool) and value == int(value) else clean_text(value))
        cells.extend([''] * (columns - len(cells)))
        result.append(cells)
    result.extend([[''] * columns for _ in range(header_rows - len(result))])
    seen = set()
    for cell in volatile_cells:
        if (not isinstance(cell, (list, tuple)) or len(cell) != 2
            or any(type(n) is not int for n in cell)
            or not 1 <= cell[0] <= header_rows or not 1 <= cell[1] <= columns
            or tuple(cell) in seen):
            raise ValueError('SOURCE_SEMANTIC_HEADER_INVALID')
        seen.add(tuple(cell))
        result[cell[0] - 1][cell[1] - 1] = ''
    return canonical_semantic_hash({'header_rows': header_rows, 'columns': columns, 'values': result})


def header_contract_diagnostic(source, values, previous_fingerprint=None):
    """Read-only, bounded diagnostics; never expose IDs, captions or provider text."""
    from .raw_pipeline import header_hash

    kinds = {'Рабочий реестр процедур': 'monitoring_master',
        'Процедуры в работе': 'monitoring_queue', '_Поставщики': 'supplier_directory',
        'Сводный аналитический лист': 'monitoring_summary',
        'Справочник заказчиков': 'customer_directory'}
    roles = {'master', 'procedure', 'procedure_master', 'procedure_view', 'operational_view',
        'procedures', 'operational', 'formula_dependency', 'directory'}
    rows, columns = source['header_rows'], source['columns']
    full_hash = semantic_header_hash(values, rows, columns)
    pinned = source.get('semantic_header_fingerprint')
    return {'kind': kinds.get(source['sheet'], 'other'),
        'role': source['role'] if source['role'] in roles else 'other',
        'columns': columns, 'header_rows': rows,
        'last_row_matches': header_hash(values, rows) == source['schema_fingerprint'],
        'pinned_full_header_matches': full_hash == pinned if pinned else None,
        'previous_full_header_matches': full_hash == previous_fingerprint if previous_fingerprint else None}


def _headers(root):
    snapshot = root / 'snapshot_bundle'
    manifest = json.loads((snapshot / 'manifest.json').read_text())
    payloads = [json.loads((snapshot / entry['path']).read_text()) for entry in manifest['payload_index']]
    contracts = [p['semantic_values'] for p in payloads if p['role'] == 'rule_contract']
    if len(contracts) != 1:
        raise ValueError('INPUT_CONTRACT_INVALID')
    contracts = {s['source_id']: s for s in contracts[0]['sources']}
    result = {}
    for payload in payloads:
        sid = payload['source_id']
        if sid not in contracts:
            continue
        source = contracts[sid]
        result[sid] = (source, semantic_header_hash(payload['semantic_values'], source['header_rows'], source['columns'],
            volatile_cells=source.get('volatile_header_cells', ())))
    return result


def assert_header_continuity(previous, candidate):
    """Caller checks both bundles' integrity; runs under the publication lock."""
    old = _headers(previous)
    physical = {(s['provider_id'], s['sheet_id']): (s, fingerprint) for s, fingerprint in old.values()}
    for sid, (current, new_hash) in _headers(candidate).items():
        prior = old.get(sid) or physical.get((current['provider_id'], current['sheet_id']))
        if prior is None:
            # A new source still requires explicit registry enrolment and the
            # existing canonical adapter validation. There is no past to compare.
            continue
        source, old_hash = prior
        same_identity = all(source.get(k) == current.get(k) for k in ('provider_id', 'sheet_id', 'role', 'grbs'))
        if old_hash == new_hash and same_identity:
            continue
        if (current.get('semantic_header_fingerprint') == new_hash
            and current.get('previous_semantic_header_fingerprint') == old_hash
            and isinstance(current.get('schema_change_reason'), str) and current['schema_change_reason'].strip()
            and same_identity):
            continue
        raise ValueError('SOURCE_SEMANTIC_HEADER_CHANGED:' + sid)
