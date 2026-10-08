import json
from copy import deepcopy

import pytest
from procurement_engine.google_adapter import GoogleReadError
from procurement_engine.monitoring_schema import (
    apply_monitoring_schema,
    review_registry,
)
from procurement_engine.raw_pipeline import header_hash
from procurement_engine.semantic_headers import semantic_header_hash
from test_runtime import inputs


def test_dynamic_header_counts_do_not_change_the_schema_but_static_labels_do():
    before = [['Code', 'No successor count', 23, 1000]]
    after = [['Code', 'No successor count', 24, 2000]]
    volatile = [[1, 3], [1, 4]]
    assert header_hash(before, 1, volatile_cells=volatile) == header_hash(after, 1, volatile_cells=volatile)
    after[0][0] = 'Different key'
    assert header_hash(before, 1, volatile_cells=volatile) != header_hash(after, 1, volatile_cells=volatile)


def fixture(tmp_path, monkeypatch):
    from procurement_engine import monitoring_schema as module

    path, _ = inputs(tmp_path)
    original = json.loads(path.read_text())
    for index, source in enumerate(original['sources'][-2:], 1):
        source.update(provider_id='private-monitoring', sheet_id=index, role='procedure_lifecycle')
    source = original['sources'][-1]
    old = [['Old queue']]; new = [['Today', 123], ['Code', 'Action']]
    source.update(columns=1, header_rows=1, schema_fingerprint=header_hash(old, 1))
    patch = {'old_sheet': source['sheet'], 'sheet': source['sheet'], 'role': source['role'],
             'old_columns': 1, 'columns': 2, 'old_header_rows': 1, 'header_rows': 2,
             'old_fingerprint': source['schema_fingerprint'], 'fingerprint': header_hash(new, 2),
             'previous_semantic': semantic_header_hash(old, 1, 1),
             'semantic': semantic_header_hash(new, 2, 2, volatile_cells=[[1, 2]]),
             'volatile_cells': [[1, 2]]}
    original['sources'].append({'source_id': 'legacy', 'provider_id': 'private-monitoring',
        'sheet_id': 3, 'sheet': 'Legacy control', 'role': 'historical_control_dependency',
        'columns': 1, 'header_rows': 1, 'units': 'control', 'grbs': None,
        'schema_fingerprint': header_hash([['Legacy']], 1)})
    monkeypatch.setattr(module, 'REVIEWS', [patch])
    monkeypatch.setattr(module, 'RETIRED', [('Legacy control', 'historical_control_dependency',
        1, 1, original['sources'][-1]['schema_fingerprint'])])
    sealed = {source['source_id']: (deepcopy(source), patch['previous_semantic'])}
    monkeypatch.setattr(module, '_sealed_headers', lambda state: sealed)
    path.write_text(json.dumps(original))

    class Client:
        def revision(self, provider):
            return '1'

        def grid(self, provider, sheet_id):
            if sheet_id == 3:
                raise GoogleReadError('GOOGLE_SHEET_ID_NOT_FOUND')
            return {'title': source['sheet'], 'gridProperties': {'columnCount': 2, 'rowCount': 10}}

        def values(self, provider, title, start, end, columns):
            return deepcopy(new)

    return path, original, sealed, Client


def test_reviewed_monitoring_migration_keeps_primary_identity_ledger_and_backup(tmp_path, monkeypatch):
    path, original, _, Client = fixture(tmp_path, monkeypatch)
    ledger_bytes = (tmp_path / 'ledger.json').read_bytes()
    assert apply_monitoring_schema(path, tmp_path, client=Client()) == 2
    after = json.loads(path.read_text())
    assert after['sources'][:-1] == original['sources'][:-2]
    assert all(after['sources'][-1][k] == original['sources'][-2][k]
               for k in ('source_id', 'provider_id', 'sheet_id', 'role', 'units', 'grbs'))
    assert after['sources'][-1]['columns'] == 2
    assert (tmp_path / 'ledger.json').read_bytes() == ledger_bytes
    backups = [p for p in (tmp_path / 'registry-history').glob('*.json') if not p.name.endswith('.migration.json')]
    assert len(backups) == 1 and json.loads(backups[0].read_text()) == original
    assert apply_monitoring_schema(path, tmp_path, client=Client()) == 0


@pytest.mark.parametrize('kind', ['unknown_header', 'wrong_identity', 'wrong_sheet_id', 'wrong_geometry', 'changed_revision', 'retired_still_exists', 'wrong_sealed_base'])
def test_unreviewed_monitoring_drift_never_changes_installed_contract(tmp_path, monkeypatch, kind):
    path, original, sealed, Client = fixture(tmp_path, monkeypatch)

    class Changed(Client):
        calls = 0

        def revision(self, provider):
            self.calls += 1
            return str(self.calls) if kind == 'changed_revision' else '1'

        def grid(self, provider, sheet_id):
            if kind == 'retired_still_exists' and sheet_id == 3:
                return {'title': 'Legacy control', 'gridProperties': {'columnCount': 1}}
            result = super().grid(provider, sheet_id)
            if kind == 'wrong_geometry': result['gridProperties']['columnCount'] = 3
            return result

        def values(self, *args):
            result = super().values(*args)
            if kind == 'unknown_header': result[1][0] = 'Another meaning'
            return result

    if kind == 'wrong_identity':
        original['sources'][-2]['provider_id'] = 'another-book'; path.write_text(json.dumps(original))
    if kind == 'wrong_sheet_id':
        original['sources'][-2]['sheet_id'] = 999; path.write_text(json.dumps(original))
    if kind == 'wrong_sealed_base':
        key = original['sources'][-2]['source_id']; sealed[key] = (sealed[key][0], '0' * 64)
    with pytest.raises(ValueError, match='MONITORING_SCHEMA_'):
        apply_monitoring_schema(path, tmp_path, client=Changed())
    assert json.loads(path.read_text()) == original


def test_volatile_values_can_change_but_static_headers_cannot(tmp_path, monkeypatch):
    _, original, sealed, Client = fixture(tmp_path, monkeypatch)
    reviewed, _ = review_registry(original, sealed, Client())

    class Tomorrow(Client):
        def values(self, *args):
            result = super().values(*args); result[0][1] += 1
            return result

    assert review_registry(reviewed, sealed, Tomorrow())[1] == 0


def test_already_reviewed_hash_cannot_hide_a_changed_physical_identity(tmp_path, monkeypatch):
    _, original, sealed, Client = fixture(tmp_path, monkeypatch)
    reviewed, _ = review_registry(original, sealed, Client())
    reviewed['sources'][-1]['sheet_id'] = 999
    with pytest.raises(ValueError, match='MONITORING_SCHEMA_SEALED_BASE_MISMATCH'):
        review_registry(reviewed, sealed, Client())


def test_concurrent_registry_write_is_preserved(tmp_path, monkeypatch):
    path, _, _, Client = fixture(tmp_path, monkeypatch)

    class Concurrent(Client):
        def values(self, *args):
            changed = json.loads(path.read_text()); changed['sources'][0]['units'] = 'concurrent unit'
            path.write_text(json.dumps(changed))
            return super().values(*args)

    with pytest.raises(ValueError, match='MONITORING_SCHEMA_REGISTRY_CHANGED'):
        apply_monitoring_schema(path, tmp_path, client=Concurrent())
    assert json.loads(path.read_text())['sources'][0]['units'] == 'concurrent unit'


def test_cli_uses_the_explicit_reviewed_monitoring_migration(monkeypatch, capsys):
    from procurement_engine.cli import main

    calls = []
    monkeypatch.setattr('procurement_engine.monitoring_schema.apply_monitoring_schema',
        lambda registry, state: calls.append((registry, state)) or 9)
    assert main(['migrate-monitoring-schema', '--registry', 'private/registry.json', '--state', 'private/state']) == 0
    assert calls == [('private/registry.json', 'private/state')]
    assert json.loads(capsys.readouterr().out) == {'reviewed_monitoring_changes_applied': 9}
