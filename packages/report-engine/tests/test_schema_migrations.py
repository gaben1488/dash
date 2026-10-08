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


def test_recorded_migration_does_not_replay_old_proposal_but_live_capture_stays_strict(tmp_path):
    from procurement_engine.atomic_snapshot import AtomicSnapshotError
    from procurement_engine.google_adapter import capture_google

    registry, package, _ = migration(tmp_path)
    assert apply_google_schema_migrations(registry, client=Client(package)) == 1
    installed = registry.read_bytes()

    class NextHeader(Client):
        def values(self, *_):
            return [['Key', 'Next unreviewed caption']]

    assert apply_google_schema_migrations(registry, client=NextHeader(package)) == 0
    assert registry.read_bytes() == installed
    source = json.loads(installed)['sources'][-1]
    with pytest.raises(AtomicSnapshotError, match='SOURCE_SCHEMA_CHANGED'):
        capture_google({'sources': [source]}, client=NextHeader(package))


def test_unrecorded_applied_fingerprint_still_requires_live_proof(tmp_path):
    registry, package, before = migration(tmp_path)
    before['sources'][-1]['schema_fingerprint'] = package['migrations'][0]['new_fingerprint']
    registry.write_text(json.dumps(before))

    class NextHeader(Client):
        def values(self, *_):
            return [['Key', 'Next unreviewed caption']]

    with pytest.raises(ValueError, match='SCHEMA_MIGRATION_LIVE_HEADER_MISMATCH'):
        apply_google_schema_migrations(registry, client=NextHeader(package))


@pytest.mark.parametrize('changed_width', [False, True])
@pytest.mark.parametrize('damage', [None, 'private_history', 'review_history', 'backup', 'identity', 'units', 'fingerprint', 'later_review'])
def test_private_patch_after_recorded_monitoring_successor(tmp_path, monkeypatch, changed_width, damage):
    from procurement_engine import monitoring_schema as module
    from procurement_engine.semantic_headers import semantic_header_hash
    from procurement_engine.snapshot import canonical_semantic_hash

    registry, package, _ = migration(tmp_path)
    assert apply_google_schema_migrations(registry, client=Client(package)) == 1
    prior_registry = json.loads(registry.read_text())
    prior = prior_registry['sources'][-1]
    columns = 3 if changed_width else 2
    headers = [['Key', 'Canonical caption', 'Institution ID'][:columns]]
    old_semantic = semantic_header_hash(package['migrations'][0]['new_headers'], 1, 2)
    review = {'sheet': prior['sheet'], 'role': prior['role'], 'columns': columns, 'header_rows': 1,
             'fingerprint': header_hash(headers, 1), 'semantic': semantic_header_hash(headers, 1, columns),
             'previous_semantic': old_semantic, 'volatile_cells': []}
    monkeypatch.setattr(module, 'REVIEWS', [review])
    monkeypatch.setattr(module, 'RETIRED', [])
    digest = canonical_semantic_hash(prior_registry)
    history = tmp_path / 'registry-history'
    backup = history / (digest + '.json')
    backup.write_text(json.dumps(prior_registry))
    record = history / 'canonical.migration.json'
    record.write_text(json.dumps({'review': module.REVIEW, 'patches': [review],
                                 'retired': [], 'previous_registry_hash': digest}))
    if damage == 'later_review':
        # A later queue-caption review must not invalidate an unrelated, exactly
        # recorded reference transition or change the old immutable history.
        monkeypatch.setattr(module, 'RECORDED_REVIEWS_V3', [review], raising=False)
        monkeypatch.setattr(module, 'REVIEWS', [review, {'sheet': 'Unrelated queue review'}])
    current = deepcopy(prior_registry)
    current['sources'][-1].update(columns=columns, schema_fingerprint=review['fingerprint'],
        semantic_header_fingerprint=review['semantic'], previous_semantic_header_fingerprint=old_semantic,
        schema_change_reason=module.REASON)
    if damage == 'private_history':
        for p in history.glob('*.migration.json'):
            if p != record:
                p.unlink()
    elif damage == 'review_history':
        record.unlink()
    elif damage == 'backup':
        backup.write_text('{}')
    elif damage == 'identity':
        current['sources'][-1]['provider_id'] = 'another-provider'
    elif damage == 'units':
        current['sources'][-1]['units'] = 'changed-unit'
    elif damage == 'fingerprint':
        current['sources'][-1]['schema_fingerprint'] = '0' * 64
    registry.write_text(json.dumps(current))
    unchanged = registry.read_bytes()

    class ObsoleteProposal(Client):
        def values(self, *_):
            raise AssertionError('A recorded predecessor must not reread its obsolete live headers')

    if damage and damage != 'later_review':
        with pytest.raises(ValueError, match='SCHEMA_MIGRATION_'):
            apply_google_schema_migrations(registry, client=ObsoleteProposal(package))
    else:
        assert apply_google_schema_migrations(registry, client=ObsoleteProposal(package)) == 0
    assert registry.read_bytes() == unchanged


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


def test_reviewed_migration_updates_full_semantic_header_proof_and_is_idempotent(tmp_path):
    from procurement_engine.semantic_headers import semantic_header_hash
    registry, package, before = migration(tmp_path)
    patch = package['migrations'][0]
    old = semantic_header_hash(patch['old_headers'], 1, 2)
    new = semantic_header_hash(patch['new_headers'], 1, 2)
    before['sources'][-1]['semantic_header_fingerprint'] = old
    registry.write_text(json.dumps(before))
    patch.update(old_semantic_fingerprint=old, new_semantic_fingerprint=new)
    assert apply_google_schema_migrations(registry, client=Client(package)) == 1
    source = json.loads(registry.read_text())['sources'][-1]
    assert source['semantic_header_fingerprint'] == new
    assert source['previous_semantic_header_fingerprint'] == old
    assert source['schema_change_reason'] == patch['reason']
    assert apply_google_schema_migrations(registry, client=Client(package)) == 0


def test_unproved_full_semantic_header_change_keeps_registry_intact(tmp_path):
    from procurement_engine.semantic_headers import semantic_header_hash
    registry, package, before = migration(tmp_path)
    patch = package['migrations'][0]
    old = semantic_header_hash(patch['old_headers'], 1, 2)
    before['sources'][-1]['semantic_header_fingerprint'] = old
    registry.write_text(json.dumps(before))
    patch.update(old_semantic_fingerprint=old, new_semantic_fingerprint='unproved')
    with pytest.raises(ValueError, match='SCHEMA_MIGRATION_SEMANTIC_PROOF_INVALID'):
        apply_google_schema_migrations(registry, client=Client(package))
    assert json.loads(registry.read_text()) == before
