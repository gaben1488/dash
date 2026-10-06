"""One explicit canonical-monitoring review; never discover schema acceptance."""
import fcntl
import json
from copy import deepcopy
from pathlib import Path

from .google_adapter import GoogleReadClient, GoogleReadError
from .raw_pipeline import header_hash
from .runtime import _write
from .runtime_inputs import validate_inputs
from .semantic_headers import _headers, semantic_header_hash
from .snapshot import canonical_semantic_hash

REVIEW = 'canonical-monitoring-v2-2026-10-06'
REASON = 'Reviewed canonical monitoring migration: physical sources retained, current queue mapped, legacy controls retired; variable summary cells are data, not schema.'
REVIEWS = [
    {'old_sheet': 'Процедуры в работе', 'sheet': 'Процедуры в работе',
     'role': 'procedure_lifecycle', 'old_columns': 13, 'columns': 23,
     'old_header_rows': 2, 'header_rows': 2,
     'old_fingerprint': '44b89bedff9ced887103666dfa1eab3b88062b597e688cb988ef6e9f722df51f',
     'fingerprint': 'ee62039702fe893fdb9a04a39851708fb4d60842e160d1c3bb3cd5ed1d492e2a',
     'previous_semantic': '2819165c346113d933bf44f4a08cc70b6270c181d59a4f9663805d475ca5694c',
     'semantic': '8a9bd23bb83d1020fd9f1de53e384e2bfd90a2e3a205cd9ea56581c3eda0f50d',
     'volatile_cells': []},
    {'old_sheet': 'Архив успешно завершенных процедур с фильтрацией', 'sheet': 'Процедуры по управлениям',
     'role': 'procedure_lifecycle', 'old_columns': 20, 'columns': 20,
     'old_header_rows': 3, 'header_rows': 3,
     'old_fingerprint': 'a8da37938076609f7ba026533759645dd59382523281962480f62e1c0e6e9404',
     'fingerprint': 'a8da37938076609f7ba026533759645dd59382523281962480f62e1c0e6e9404',
     'previous_semantic': '9a8466b2e995bea8a687ab4e7a24226489cf3a23a50bbe257cab584801df7a0d',
     'semantic': '50b949b6b61a70e17826110c242884017395c0541dfd93244e10c621712c6d5e',
     'volatile_cells': [[1, 2], [2, 2], [2, 4], [2, 6], [2, 8], [2, 10]]},
    {'old_sheet': 'Архив не завершившихся процедур, их судьба', 'sheet': 'Архив не завершившихся процедур, их судьба',
     'role': 'procedure_lifecycle', 'old_columns': 17, 'columns': 17,
     'old_header_rows': 1, 'header_rows': 1,
     'old_fingerprint': '437921160613f1304093beda28bd9d8078c8e767f0f432bc85c7f0890c95935e',
     'fingerprint': '2cd65b82d05685147ebdc23bdf6204fb091c5dc5b00e6095d5db2b7bbc10178b',
     'previous_semantic': '06581bfd10dfa5c0283cd61fc98d50a78391846d7cbf727327f5acb72f4b2125',
     'semantic': '85ccf99fc7e76557f8422632fd06e358be5d5c847b1afa30f8c55714a5f12806',
     'volatile_cells': []},
    {'old_sheet': 'Сводный аналитический лист', 'sheet': 'Сводный аналитический лист',
     'role': 'formula_dependency', 'old_columns': 18, 'columns': 18,
     'old_header_rows': 2, 'header_rows': 2,
     'old_fingerprint': '278c3d862c8b240f430dafb47302f4dbaf2cec8401e95ac31daeb88bb8313afa',
     'fingerprint': '278c3d862c8b240f430dafb47302f4dbaf2cec8401e95ac31daeb88bb8313afa',
     'previous_semantic': 'f35ee3c75cc256be856eb662c574ceebb507c9f5bfa10d27446d775d13673f02',
     'semantic': '03c976a9bfef88531193d6f8586abcf5c532e9cfcc79ece91b2acd69f3a2e7a9',
     'volatile_cells': [[1, 2]]},
]
RETIRED = [
    ('_Связи процедур', 'procedure_lifecycle', 6, 1, '2dfe910f94c506a6178fae3da4db270de166c578d7c042a1a066a79a533bd271'),
    ('_Распределение ГРБС', 'procedure_lifecycle', 12, 1, '2d49d5a37e6d04669996abf25833a8ad673f3475c5c5d146cdc63c7c1a252a61'),
    ('_Проверки', 'historical_control_dependency', 26, 2, '21ffaafbb326f1f425dca7a25585a9cf5b757bfd4f043aa13e0dd40d9e2b1e6b'),
    ('25-26', 'historical_control_dependency', 23, 1, 'f80ebbf7d785ee4ab3d040f285da7ed4c780a37c5bf7c94cf80c39d17f199e97'),
    ('СВОДНЫЙ 2', 'historical_control_dependency', 18, 2, '4cd883a00396f105e285b27bb52b7ac1f561d109b57a661caa3f00dea27fcbdb'),
]


def _sealed_headers(state):
    from .publication_store import PublicationStore
    from .readonly_catalog import copied_catalog

    root = Path(state) / 'published'
    if not (root / 'publications.sqlite').is_file():
        return {}
    store = PublicationStore(root, readonly=True)
    with copied_catalog(store.database_path) as catalog:
        store.database_path = catalog
        receipt = store.latest()
    return _headers(root / 'releases' / receipt['release_id']) if receipt else {}


def review_registry(original, sealed, client):
    registry = deepcopy(original)
    masters = [s for s in registry['sources'] if s['sheet'] == 'Рабочий реестр процедур']
    if len(masters) != 1:
        raise ValueError('MONITORING_SCHEMA_PRIMARY_MISSING')
    provider = masters[0]['provider_id']
    revision = client.revision(provider)
    changed = 0
    for patch in REVIEWS:
        matches = [s for s in registry['sources'] if s['sheet'] in {patch['old_sheet'], patch['sheet']}]
        if len(matches) != 1:
            raise ValueError('MONITORING_SCHEMA_SOURCE_NOT_UNIQUE')
        source = matches[0]
        if source['provider_id'] != provider or source['role'] != patch['role']:
            raise ValueError('MONITORING_SCHEMA_IDENTITY_MISMATCH')
        old_geometry = (patch['old_columns'], patch['old_header_rows'], patch['old_fingerprint'])
        new_geometry = (patch['columns'], patch['header_rows'], patch['fingerprint'])
        if (source['columns'], source['header_rows'], source['schema_fingerprint']) not in {old_geometry, new_geometry}:
            raise ValueError('MONITORING_SCHEMA_BASE_MISMATCH')
        prior = sealed.get(source['source_id'])
        if prior and (any(prior[0].get(k) != source.get(k) for k in ('provider_id', 'sheet_id', 'role', 'grbs'))
            or prior[1] not in {patch['previous_semantic'], patch['semantic']}):
            raise ValueError('MONITORING_SCHEMA_SEALED_BASE_MISMATCH')
        grid = client.grid(provider, source['sheet_id'])
        if grid['title'] != patch['sheet'] or grid['gridProperties']['columnCount'] != patch['columns']:
            raise ValueError('MONITORING_SCHEMA_LIVE_GEOMETRY_MISMATCH')
        rows = client.values(provider, grid['title'], 1, patch['header_rows'], patch['columns'])
        if (header_hash(rows, patch['header_rows']) != patch['fingerprint']
            or semantic_header_hash(rows, patch['header_rows'], patch['columns'],
                volatile_cells=patch['volatile_cells']) != patch['semantic']):
            raise ValueError('MONITORING_SCHEMA_LIVE_HEADER_MISMATCH')
        updated = {**source, 'sheet': patch['sheet'], 'columns': patch['columns'],
            'header_rows': patch['header_rows'], 'schema_fingerprint': patch['fingerprint'],
            'semantic_header_fingerprint': patch['semantic'],
            'previous_semantic_header_fingerprint': patch['previous_semantic'], 'schema_change_reason': REASON}
        if patch['volatile_cells']:
            updated['volatile_header_cells'] = patch['volatile_cells']
        if source != updated:
            source.clear(); source.update(updated); changed += 1
    for title, role, columns, headers, fingerprint in RETIRED:
        matches = [s for s in registry['sources'] if s['sheet'] == title]
        if not matches:
            continue
        if len(matches) != 1:
            raise ValueError('MONITORING_SCHEMA_RETIRED_NOT_UNIQUE')
        source = matches[0]
        if (source['provider_id'], source['role'], source['columns'], source['header_rows'], source['schema_fingerprint']) != (
            provider, role, columns, headers, fingerprint):
            raise ValueError('MONITORING_SCHEMA_RETIRED_BASE_MISMATCH')
        try:
            client.grid(provider, source['sheet_id'])
        except GoogleReadError as error:
            if str(error) != 'GOOGLE_SHEET_ID_NOT_FOUND':
                raise
        else:
            raise ValueError('MONITORING_SCHEMA_RETIRED_STILL_PRESENT')
        registry['sources'].remove(source); changed += 1
    if not revision or client.revision(provider) != revision:
        raise ValueError('MONITORING_SCHEMA_SOURCE_CHANGED')
    return registry, changed


def apply_monitoring_schema(registry_path, state, *, client=None):
    path = Path(registry_path)
    with (path.parent / '.schema-migrations.lock').open('a') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise ValueError('SCHEMA_MIGRATION_ALREADY_RUNNING') from None
        original = json.loads(path.read_text())
        candidate, changed = review_registry(original, _sealed_headers(state), client or GoogleReadClient())
        if not changed:
            return 0
        validate_inputs(candidate, json.loads((path.parent / 'ledger.json').read_text()))
        digest = canonical_semantic_hash(original)
        if canonical_semantic_hash(json.loads(path.read_text())) != digest:
            raise ValueError('MONITORING_SCHEMA_REGISTRY_CHANGED')
        history = path.parent / 'registry-history'; history.mkdir(mode=0o700, exist_ok=True)
        record = {'review': REVIEW, 'patches': REVIEWS, 'retired': RETIRED, 'previous_registry_hash': digest}
        for destination, value in ((history / (digest + '.json'), original),
            (history / (digest + '-' + canonical_semantic_hash(record) + '.migration.json'), record)):
            if destination.exists():
                if json.loads(destination.read_text()) != json.loads(json.dumps(value)):
                    raise ValueError('MONITORING_SCHEMA_HISTORY_MISMATCH')
            else:
                _write(destination, value)
        if canonical_semantic_hash(json.loads(path.read_text())) != digest:
            raise ValueError('MONITORING_SCHEMA_REGISTRY_CHANGED')
        _write(path, candidate)
        return changed
