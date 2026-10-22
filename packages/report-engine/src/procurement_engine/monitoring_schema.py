"""One explicit canonical-monitoring review; never discover schema acceptance."""
import fcntl
import json
from copy import deepcopy
from pathlib import Path

from .department_directory import MONITORING_SOURCE_SCHEMA
from .google_adapter import GoogleReadClient, GoogleReadError
from .raw_pipeline import header_hash
from .runtime import _write
from .runtime_inputs import validate_inputs
from .semantic_headers import _headers, semantic_header_hash
from .snapshot import canonical_semantic_hash

REVIEW = MONITORING_SOURCE_SCHEMA['review']
REASON = MONITORING_SOURCE_SCHEMA['reason']
SUPPLIER_SOURCE = deepcopy(MONITORING_SOURCE_SCHEMA['supplierSource'])
RECORDED_REVIEWS_V3 = deepcopy(MONITORING_SOURCE_SCHEMA['recordedV3'])
REVIEWS = deepcopy(MONITORING_SOURCE_SCHEMA['reviews'])
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
    lease_root = Path(state) / 'published'
    from contextlib import nullcontext
    lease = (PublicationStore(lease_root, readonly=True).reader_lease()
             if (lease_root / 'publications.sqlite').is_file() else nullcontext())
    with lease:
        return _leased__sealed_headers(state)


def _leased__sealed_headers(state):
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
        if (source['provider_id'] != provider or source['role'] != patch['role']
            or ('sheet_id' in patch and source['sheet_id'] != patch['sheet_id'])):
            raise ValueError('MONITORING_SCHEMA_IDENTITY_MISMATCH')
        old_geometry = (patch['old_columns'], patch['old_header_rows'], patch['old_fingerprint'])
        new_geometry = (patch['columns'], patch['header_rows'], patch['fingerprint'])
        # Old customer-directory generations are archival evidence, never live contracts.
        accepted_geometry = (
            {new_geometry} if patch['sheet'] == 'Справочник заказчиков'
            else {old_geometry, new_geometry, *[tuple(g) for g in patch.get('previous_geometry', [])]}
        )
        if (source['columns'], source['header_rows'], source['schema_fingerprint']) not in accepted_geometry:
            raise ValueError('MONITORING_SCHEMA_BASE_MISMATCH')
        prior = sealed.get(source['source_id'])
        accepted_semantic = (
            {patch['semantic']} if patch['sheet'] == 'Справочник заказчиков'
            else {patch['previous_semantic'], patch['semantic'], *patch.get('previous_semantics', [])}
        )
        # A registry with an invented semantic fingerprint must not be
        # repaired implicitly merely because the live sheet looks familiar.
        if (patch['sheet'] == 'Справочник заказчиков'
                and source.get('semantic_header_fingerprint') not in accepted_semantic | {None}):
            raise ValueError('MONITORING_SCHEMA_BASE_MISMATCH')
        if patch.get('sealed_baseline') and prior and tuple(prior[0].get(k) for k in ('columns', 'header_rows', 'schema_fingerprint')) == old_geometry:
            accepted_semantic.add(prior[1])
        # Archived 18/19/32 directory headers do not gate the current live
        # contract. An existing sealed identity mismatch still fails closed.
        if prior and (
            any(prior[0].get(k) != source.get(k) for k in ('provider_id', 'sheet_id', 'role', 'grbs'))
            or (patch['sheet'] != 'Справочник заказчиков' and prior[1] not in accepted_semantic)
        ):
            raise ValueError('MONITORING_SCHEMA_SEALED_BASE_MISMATCH')
        grid = client.grid(provider, source['sheet_id'])
        if grid['title'] != patch['sheet'] or grid['gridProperties']['columnCount'] != patch['columns']:
            raise ValueError('MONITORING_SCHEMA_LIVE_GEOMETRY_MISMATCH')
        rows = client.values(provider, grid['title'], 1, patch['header_rows'], patch['columns'])
        if (header_hash(rows, patch['header_rows'], volatile_cells=patch['volatile_cells']) != patch['fingerprint']
            or semantic_header_hash(rows, patch['header_rows'], patch['columns'],
                volatile_cells=patch['volatile_cells']) != patch['semantic']):
            raise ValueError('MONITORING_SCHEMA_LIVE_HEADER_MISMATCH')
        # Never copy a frozen header's semantic fingerprint into a current
        # directory registry; preserve existing historical provenance instead.
        previous_semantic = (
            source.get('previous_semantic_header_fingerprint', patch['semantic'])
            if patch['sheet'] == 'Справочник заказчиков'
            else (prior[1] if prior and prior[1] != patch['semantic']
                  else source.get('previous_semantic_header_fingerprint', patch['previous_semantic']))
        )
        updated = {**source, 'sheet': patch['sheet'], 'columns': patch['columns'],
            'header_rows': patch['header_rows'], 'schema_fingerprint': patch['fingerprint'],
            'semantic_header_fingerprint': patch['semantic'],
            'previous_semantic_header_fingerprint': previous_semantic,
            'schema_change_reason': patch.get('reason', REASON)}
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
        # C1 of the analytical sheet explicitly reads this retained native QA
        # source. Capture its values and formulas; do not infer that QA passed.
        if not any(s['provider_id'] == provider and s['sheet_id'] == 913657450 for s in registry['sources']):
            patch = next(p for p in REVIEWS if p['sheet'] == '_Проверки')
            grid = client.grid(provider, 913657450)
            rows = client.values(provider, '_Проверки', 1, 2, 8)
            if (grid['title'] != '_Проверки' or grid['gridProperties']['columnCount'] != 8
                or header_hash(rows, 2, volatile_cells=patch['volatile_cells']) != patch['fingerprint']
                or semantic_header_hash(rows, 2, 8, volatile_cells=patch['volatile_cells']) != patch['semantic']):
                raise ValueError('MONITORING_SCHEMA_CHECKS_HEADER_MISMATCH')
            registry['sources'].append({'source_id': 'canonical-monitoring-checks-v1', 'provider_id': provider,
                'sheet_id': 913657450, 'sheet': '_Проверки', 'role': 'historical_control_dependency',
                'columns': 8, 'header_rows': 2, 'units': 'control', 'grbs': None,
                'schema_fingerprint': patch['fingerprint'], 'semantic_header_fingerprint': patch['semantic'],
                'previous_semantic_header_fingerprint': patch['semantic'], 'schema_change_reason': REASON,
                'volatile_header_cells': patch['volatile_cells']})
            changed += 1
    if not revision or client.revision(provider) != revision:
        raise ValueError('MONITORING_SCHEMA_SOURCE_CHANGED')
    changed += _review_ud_header(registry, sealed, client)
    return registry, changed


def _review_ud_header(registry, sealed, client):
    """Reviewed cosmetic A1 change: ordinal 1 to blank; all 34 business labels stay identical."""
    provider = '1zrpgVaCyS4S4KBNMFuDleMJS-PSTonHmPY_bRLgTVsg'
    matches = [s for s in registry['sources'] if s['provider_id'] == provider and s['sheet_id'] == 1489829974]
    if not matches:
        return 0
    if len(matches) != 1:
        raise ValueError('MONITORING_SCHEMA_UD_NOT_UNIQUE')
    source = matches[0]
    fingerprint = '9f99bae48efdc4516559fdf23f81c4f7634fc4eb15d3a3b65bea7e0e8580b88e'
    old_hash = '2488b3c0690154103023303e35a7cc8cb119b825336d0403ee37011fec08507e'
    new_hash = 'd6dd9b17798157b993694b8b204c218666df869aec6ec3e85b5ddfb9409351fc'
    if (source['sheet'], source['role'], source['grbs'], source['columns'], source['header_rows'], source['schema_fingerprint']) != ('ВСЕ', 'master', 'УД', 34, 3, fingerprint):
        raise ValueError('MONITORING_SCHEMA_UD_IDENTITY_MISMATCH')
    prior = sealed.get(source['source_id'])
    if not prior or prior[1] not in {old_hash, new_hash} or any(prior[0].get(k) != source.get(k) for k in ('provider_id', 'sheet_id', 'role', 'grbs')):
        raise ValueError('MONITORING_SCHEMA_UD_SEALED_MISMATCH')
    revision = client.revision(provider)
    grid = client.grid(provider, source['sheet_id'])
    rows = client.values(provider, 'ВСЕ', 1, 3, 34)
    if (grid['title'] != 'ВСЕ' or grid['gridProperties']['columnCount'] != 34
        or header_hash(rows, 3) != fingerprint or semantic_header_hash(rows, 3, 34) != new_hash):
        raise ValueError('MONITORING_SCHEMA_UD_HEADER_MISMATCH')
    # Reconstruct the sealed header as an independent proof of the single-cell edit.
    before = deepcopy(rows); before[0][0] = 1
    if semantic_header_hash(before, 3, 34) != old_hash:
        raise ValueError('MONITORING_SCHEMA_UD_PROOF_MISMATCH')
    if not revision or client.revision(provider) != revision:
        raise ValueError('MONITORING_SCHEMA_SOURCE_CHANGED')
    update = {'semantic_header_fingerprint': new_hash,
        'previous_semantic_header_fingerprint': old_hash,
        'schema_change_reason': 'Reviewed УД ВСЕ A1: cosmetic ordinal 1 cleared; primary business headers, physical identity and data unchanged.'}
    if all(source.get(k) == v for k, v in update.items()):
        return 0
    source.update(update)
    return 1


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
