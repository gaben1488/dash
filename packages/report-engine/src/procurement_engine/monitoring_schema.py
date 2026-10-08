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

REVIEW = 'canonical-monitoring-v3-2026-10-08'
REASON = 'Reviewed canonical monitoring migration: physical sources retained, current queue mapped, legacy controls retired; variable summary cells are data, not schema.'
SUPPLIER_SOURCE = {
    'sheet_id': 110002, 'sheet': '_Поставщики', 'role': 'formula_dependency',
    'columns': 6, 'header_rows': 1, 'units': 'directory', 'grbs': None,
    'schema_fingerprint': '0f0393b3199a2877eb76e8c938fb467462ffd4e7aa75921be24048e9f97ac75c',
    'semantic_header_fingerprint': 'd631bfa16d234d0548beeaa0c16fd3eb823cdfba7372c59d54a5ed0b84c97170',
}
REVIEWS = [{'old_sheet': 'Процедуры в работе',
  'sheet': 'Процедуры в работе',
  'role': 'procedure_lifecycle',
  'old_columns': 13,
  'columns': 24,
  'old_header_rows': 2,
  'header_rows': 2,
  'old_fingerprint': '44b89bedff9ced887103666dfa1eab3b88062b597e688cb988ef6e9f722df51f',
  'fingerprint': '7410aa94a1ca8067db0aee24c04859bee9c88abec9a077542f00ad5291420afe',
  'previous_semantic': '2819165c346113d933bf44f4a08cc70b6270c181d59a4f9663805d475ca5694c',
  'semantic': '40e6c01b2bcc1aee6f7d1fe8bb63139b23ddd37cda12ba347494f07ae522ccdf',
  'volatile_cells': [[1, 1], [1, 15]],
  'previous_geometry': [[23, 2, 'ee62039702fe893fdb9a04a39851708fb4d60842e160d1c3bb3cd5ed1d492e2a']],
  'previous_semantics': ['8a9bd23bb83d1020fd9f1de53e384e2bfd90a2e3a205cd9ea56581c3eda0f50d'],
  'previous_titles': ['Процедуры в работе']},
 {'old_sheet': 'Архив успешно завершенных процедур с фильтрацией',
  'sheet': 'Архив завершённых процедур по ГРБС',
  'role': 'procedure_lifecycle',
  'old_columns': 20,
  'columns': 20,
  'old_header_rows': 3,
  'header_rows': 3,
  'old_fingerprint': 'a8da37938076609f7ba026533759645dd59382523281962480f62e1c0e6e9404',
  'fingerprint': 'd913069152442a501a2d4b1677f25f5d4c1dd1ab0dda53ccdeb21fd922afdebc',
  'previous_semantic': '9a8466b2e995bea8a687ab4e7a24226489cf3a23a50bbe257cab584801df7a0d',
  'semantic': '0bff84cc375425b514f0c4654050c90e48c9448e2aca3e2842f99e54dc7a8f27',
  'volatile_cells': [[1, 2], [1, 5], [2, 2], [2, 4], [2, 6], [2, 8], [2, 10]],
  'previous_geometry': [[20, 3, 'a8da37938076609f7ba026533759645dd59382523281962480f62e1c0e6e9404']],
  'previous_semantics': ['50b949b6b61a70e17826110c242884017395c0541dfd93244e10c621712c6d5e'],
  'previous_titles': ['Процедуры по управлениям']},
 {'old_sheet': 'Архив не завершившихся процедур, их судьба',
  'sheet': 'Архив не завершившихся процедур, их судьба',
  'role': 'procedure_lifecycle',
  'old_columns': 17,
  'columns': 17,
  'old_header_rows': 1,
  'header_rows': 1,
  'old_fingerprint': '437921160613f1304093beda28bd9d8078c8e767f0f432bc85c7f0890c95935e',
  'fingerprint': '98e774e3f09e725cd7f267cab3b5414d151f8c946e673f65a1abf69784683e3c',
  'previous_semantic': '06581bfd10dfa5c0283cd61fc98d50a78391846d7cbf727327f5acb72f4b2125',
  'semantic': '6199aff3bbaac8f94b1f14b9977c6dffc427cfdd24c18fbdf3edbc947dea09c8',
  'volatile_cells': [[1, 14], [1, 15]],
  'previous_geometry': [[17, 1, '2cd65b82d05685147ebdc23bdf6204fb091c5dc5b00e6095d5db2b7bbc10178b']],
  'previous_semantics': ['85ccf99fc7e76557f8422632fd06e358be5d5c847b1afa30f8c55714a5f12806'],
  'previous_titles': ['Архив не завершившихся процедур, их судьба']},
 {'old_sheet': 'Сводный аналитический лист',
  'sheet': 'Сводный аналитический лист',
  'role': 'formula_dependency',
  'old_columns': 18,
  'columns': 18,
  'old_header_rows': 2,
  'header_rows': 2,
  'old_fingerprint': '278c3d862c8b240f430dafb47302f4dbaf2cec8401e95ac31daeb88bb8313afa',
  'fingerprint': 'fa79208276a2921c0e3f703f6e83f22cd6ed2b9e63099a7a76b07aa8df22168a',
  'previous_semantic': 'f35ee3c75cc256be856eb662c574ceebb507c9f5bfa10d27446d775d13673f02',
  'semantic': '6647e3d8ba74b0b5698fa39474ff686b454e73902737bc089b6e3a4df13b23df',
  'volatile_cells': [[1, 2], [1, 3]],
  'previous_geometry': [[18, 2, '278c3d862c8b240f430dafb47302f4dbaf2cec8401e95ac31daeb88bb8313afa']],
  'previous_semantics': ['03c976a9bfef88531193d6f8586abcf5c532e9cfcc79ece91b2acd69f3a2e7a9'],
  'previous_titles': ['Сводный аналитический лист']},
 {'old_sheet': 'Справочник заказчиков',
  'sheet': 'Справочник заказчиков',
  'role': 'formula_dependency',
  'old_columns': 18,
  'columns': 19,
  'old_header_rows': 1,
  'header_rows': 1,
  'old_fingerprint': '33c63a8f5a1b2bd6fb5bd4d49a325bdd04c174f53859c29a3373fa991f941b50',
  'fingerprint': '994786f28666c28c7633243f2e881b2a1bd7bbfb2efbccb6293694a86b19d042',
  'previous_semantic': '594117f4a78542aaee93605b400d737e6b08692748aee1faf5df20359cc66ea5',
  'semantic': 'c7a3d028c03385f80ad24e79e85ac45c80fc98d73fcf62764b57121a4f1a3dc1',
  'volatile_cells': [],
  'optional': True},
 {'old_sheet': '_Проверки',
  'sheet': '_Проверки',
  'role': 'historical_control_dependency',
  'old_columns': 26,
  'columns': 8,
  'old_header_rows': 2,
  'header_rows': 2,
  'old_fingerprint': '21ffaafbb326f1f425dca7a25585a9cf5b757bfd4f043aa13e0dd40d9e2b1e6b',
  'fingerprint': '21ffaafbb326f1f425dca7a25585a9cf5b757bfd4f043aa13e0dd40d9e2b1e6b',
  'previous_semantic': 'c40c927d527a6f7593800636f6d13734dccfbebdaf7dd5d670db82ab9e2317e2',
  'semantic': 'c40c927d527a6f7593800636f6d13734dccfbebdaf7dd5d670db82ab9e2317e2',
  'volatile_cells': [[1, 2], [1, 4], [1, 8]],
  'optional': True,
  'sealed_baseline': True}]
RETIRED = [('_Связи процедур',
  'procedure_lifecycle',
  6,
  1,
  '2dfe910f94c506a6178fae3da4db270de166c578d7c042a1a066a79a533bd271'),
 ('_Распределение ГРБС',
  'procedure_lifecycle',
  12,
  1,
  '2d49d5a37e6d04669996abf25833a8ad673f3475c5c5d146cdc63c7c1a252a61'),
 ('25-26',
  'historical_control_dependency',
  23,
  1,
  'f80ebbf7d785ee4ab3d040f285da7ed4c780a37c5bf7c94cf80c39d17f199e97'),
 ('СВОДНЫЙ 2',
  'historical_control_dependency',
  18,
  2,
  '4cd883a00396f105e285b27bb52b7ac1f561d109b57a661caa3f00dea27fcbdb')]


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
        matches = [s for s in registry['sources'] if s['sheet'] in {patch['old_sheet'], patch['sheet'], *patch.get('previous_titles', [])}]
        if not matches and patch.get('optional'):
            continue
        if len(matches) != 1:
            raise ValueError('MONITORING_SCHEMA_SOURCE_NOT_UNIQUE')
        source = matches[0]
        if source['provider_id'] != provider or source['role'] != patch['role']:
            raise ValueError('MONITORING_SCHEMA_IDENTITY_MISMATCH')
        old_geometry = (patch['old_columns'], patch['old_header_rows'], patch['old_fingerprint'])
        new_geometry = (patch['columns'], patch['header_rows'], patch['fingerprint'])
        accepted_geometry = {old_geometry, new_geometry, *[tuple(g) for g in patch.get('previous_geometry', [])]}
        if (source['columns'], source['header_rows'], source['schema_fingerprint']) not in accepted_geometry:
            raise ValueError('MONITORING_SCHEMA_BASE_MISMATCH')
        prior = sealed.get(source['source_id'])
        accepted_semantic = {patch['previous_semantic'], patch['semantic'], *patch.get('previous_semantics', [])}
        if patch.get('sealed_baseline') and prior and tuple(prior[0].get(k) for k in ('columns', 'header_rows', 'schema_fingerprint')) == old_geometry:
            accepted_semantic.add(prior[1])
        if prior and (any(prior[0].get(k) != source.get(k) for k in ('provider_id', 'sheet_id', 'role', 'grbs'))
            or prior[1] not in accepted_semantic):
            raise ValueError('MONITORING_SCHEMA_SEALED_BASE_MISMATCH')
        grid = client.grid(provider, source['sheet_id'])
        if grid['title'] != patch['sheet'] or grid['gridProperties']['columnCount'] != patch['columns']:
            raise ValueError('MONITORING_SCHEMA_LIVE_GEOMETRY_MISMATCH')
        rows = client.values(provider, grid['title'], 1, patch['header_rows'], patch['columns'])
        if (header_hash(rows, patch['header_rows'], volatile_cells=patch['volatile_cells']) != patch['fingerprint']
            or semantic_header_hash(rows, patch['header_rows'], patch['columns'],
                volatile_cells=patch['volatile_cells']) != patch['semantic']):
            raise ValueError('MONITORING_SCHEMA_LIVE_HEADER_MISMATCH')
        updated = {**source, 'sheet': patch['sheet'], 'columns': patch['columns'],
            'header_rows': patch['header_rows'], 'schema_fingerprint': patch['fingerprint'],
            'semantic_header_fingerprint': patch['semantic'],
            'previous_semantic_header_fingerprint': prior[1] if prior and prior[1] != patch['semantic'] else source.get('previous_semantic_header_fingerprint', patch['previous_semantic']), 'schema_change_reason': REASON}
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
    # Explicit enrolment of the reviewed new supplier dependency, only in the
    # owner-confirmed canonical book. No source discovery or primary remapping.
    if provider == '1wET-yUf9OQGTgPWSs96xAE3X7WSrVejtVGWRH1pv-1E':
        spec = SUPPLIER_SOURCE
        existing = [s for s in registry['sources'] if s['provider_id'] == provider and s['sheet_id'] == spec['sheet_id']]
        if not existing:
            grid = client.grid(provider, spec['sheet_id'])
            rows = client.values(provider, spec['sheet'], 1, 1, spec['columns'])
            if (grid['title'] != spec['sheet'] or grid['gridProperties']['columnCount'] != spec['columns']
                or header_hash(rows, 1) != spec['schema_fingerprint']
                or semantic_header_hash(rows, 1, spec['columns']) != spec['semantic_header_fingerprint']):
                raise ValueError('MONITORING_SCHEMA_SUPPLIER_HEADER_MISMATCH')
            registry['sources'].append({**spec, 'source_id': 'canonical-monitoring-suppliers-v1', 'provider_id': provider})
            changed += 1
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
