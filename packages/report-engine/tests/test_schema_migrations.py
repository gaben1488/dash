import fcntl
import json
from copy import deepcopy

import pytest
from procurement_engine.raw_pipeline import header_hash
from procurement_engine.schema_migrations import apply_google_schema_migrations
from test_runtime import inputs


class Client:
    def __init__(self, body, *, changed=False):
        self.body = body; self.changed = changed; self.revision_calls = 0

    def _get(self, url, params):
        meta = {'id': 'private-config', 'name': 'aemr-report-schema-migrations-v1.json',
                'mimeType': 'application/json', 'version': '1'}
        if url.endswith('/files'):
            return {'files': [meta]}
        return self.body if params.get('alt') == 'media' else meta

    def revision(self, _):
        self.revision_calls += 1
        return str(self.revision_calls) if self.changed else '1'

    def grid(self, *_):
        return {'title': 'Synthetic reference', 'gridProperties': {'columnCount': 2, 'rowCount': 10}}

    def values(self, *_):
        return [['Key', 'Reviewed caption']]


def migration(tmp_path):
    registry, _ = inputs(tmp_path)
    body = json.loads(registry.read_text())
    body['sources'].append({'source_id': 'reference', 'provider_id': 'private-reference',
        'sheet_id': 3, 'sheet': 'Synthetic reference', 'role': 'formula_dependency',
        'columns': 2, 'header_rows': 1, 'units': 'reference',
        'schema_fingerprint': header_hash([['Key', 'Original caption']], 1)})
    registry.write_text(json.dumps(body))
    patch = {'source_id': 'reference', 'provider_id': 'private-reference', 'sheet_id': 3,
        'sheet': 'Synthetic reference', 'role': 'formula_dependency', 'columns': 2, 'header_rows': 1,
        'old_headers': [['Key', 'Original caption']], 'new_headers': [['Key', 'Reviewed caption']],
        'old_fingerprint': body['sources'][-1]['schema_fingerprint'],
        'new_fingerprint': header_hash([['Key', 'Reviewed caption']], 1),
        'reason': 'Reviewed caption-only change; column positions and meaning unchanged.'}
    return registry, {'format': 'aemr-report-schema-migrations-v1', 'migrations': [patch]}, body


def test_reviewed_header_migration_keeps_contract_geometry_and_immutable_backup(tmp_path):
    registry, package, before = migration(tmp_path)
    assert apply_google_schema_migrations(registry, client=Client(package)) == 1
    after = json.loads(registry.read_text())
    expected = deepcopy(before); expected['sources'][-1]['schema_fingerprint'] = package['migrations'][0]['new_fingerprint']
    assert after == expected
    history = [p for p in (tmp_path / 'registry-history').glob('*.json') if not p.name.endswith('.migration.json')]
    assert len(history) == 1 and json.loads(history[0].read_text()) == before
    assert apply_google_schema_migrations(registry, client=Client(package)) == 0
    assert len([p for p in (tmp_path / 'registry-history').glob('*.json') if not p.name.endswith('.migration.json')]) == 1


@pytest.mark.parametrize('mutation', ['wrong_source', 'wrong_hash', 'wrong_geometry', 'not_current'])
def test_unreviewed_or_misaddressed_migration_cannot_replace_the_contract(tmp_path, mutation):
    registry, package, before = migration(tmp_path)
    patch = package['migrations'][0]
    if mutation == 'wrong_source': patch['provider_id'] = 'another-source'
    if mutation == 'wrong_hash': patch['new_fingerprint'] = '0' * 64
    if mutation == 'wrong_geometry': patch['columns'] = 3
    if mutation == 'not_current': patch['new_headers'][0][1] = 'Another current caption'; patch['new_fingerprint'] = header_hash(patch['new_headers'], 1)
    with pytest.raises(ValueError, match='SCHEMA_MIGRATION_'):
        apply_google_schema_migrations(registry, client=Client(package))
    assert json.loads(registry.read_text()) == before


def test_source_changing_during_migration_does_not_install_a_new_schema(tmp_path):
    registry, package, before = migration(tmp_path)
    with pytest.raises(ValueError, match='SCHEMA_MIGRATION_SOURCE_CHANGED'):
        apply_google_schema_migrations(registry, client=Client(package, changed=True))
    assert json.loads(registry.read_text()) == before


def test_cli_runs_reviewed_schema_migration(monkeypatch, capsys):
    from procurement_engine.cli import main

    called = []
    monkeypatch.setattr('procurement_engine.schema_migrations.apply_google_schema_migrations',
        lambda path: called.append(path) or 1)
    assert main(['migrate-google-schema', '--registry', 'private/registry.json']) == 0
    assert called == ['private/registry.json']
    assert json.loads(capsys.readouterr().out) == {'reviewed_schema_migrations_applied': 1}


def test_concurrent_registry_change_is_not_overwritten(tmp_path):
    registry, package, before = migration(tmp_path)

    class Concurrent(Client):
        def values(self, *_):
            current = json.loads(registry.read_text()); current['sources'][0]['units'] = 'concurrent value'
            registry.write_text(json.dumps(current))
            return super().values()

    with pytest.raises(ValueError, match='SCHEMA_MIGRATION_REGISTRY_CHANGED'):
        apply_google_schema_migrations(registry, client=Concurrent(package))
    current = json.loads(registry.read_text())
    assert current['sources'][0]['units'] == 'concurrent value'
    assert current['sources'][-1]['schema_fingerprint'] == before['sources'][-1]['schema_fingerprint']


def test_reapplying_after_another_registry_restore_preserves_first_history_record(tmp_path):
    registry, package, before = migration(tmp_path)
    apply_google_schema_migrations(registry, client=Client(package))
    history = list((tmp_path / 'registry-history').glob('*.migration.json'))
    assert len(history) == 1
    original_bytes = history[0].read_bytes()
    restored = deepcopy(before); restored['sources'][0]['units'] = 'reviewed unit label'
    registry.write_text(json.dumps(restored))
    apply_google_schema_migrations(registry, client=Client(package))
    assert history[0].read_bytes() == original_bytes
    assert len(list((tmp_path / 'registry-history').glob('*.migration.json'))) == 2


def test_another_migration_holding_the_lock_cannot_be_overwritten(tmp_path):
    registry, package, before = migration(tmp_path)
    with (tmp_path / '.schema-migrations.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        with pytest.raises(ValueError, match='SCHEMA_MIGRATION_ALREADY_RUNNING'):
            apply_google_schema_migrations(registry, client=Client(package))
    assert json.loads(registry.read_text()) == before
