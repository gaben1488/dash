import json
import sqlite3
from contextlib import closing
from dataclasses import replace

import pytest
from procurement_engine.identity_store import IdentityStore
from test_identity_and_metrics import row


def test_corrupt_identity_database_is_rejected_before_use_or_backup(tmp_path):
    path = tmp_path / 'identity.sqlite'
    store = IdentityStore(path)
    with path.open('r+b') as file:
        file.write(b'not a sqlite db!')
    with pytest.raises(ValueError, match='IDENTITY_DATABASE_CORRUPT'):
        IdentityStore(path)
    with pytest.raises(ValueError, match='IDENTITY_DATABASE_CORRUPT'):
        store.backup(tmp_path / 'backup.sqlite')
    assert not (tmp_path / 'backup.sqlite').exists()


def test_backup_keeps_complete_overflow_pages_and_reopens_independently(tmp_path):
    store = IdentityStore(tmp_path / 'identity.sqlite')
    with closing(store.connect()) as db, db:
        db.execute('INSERT INTO snapshots(snapshot_id,digest,captured_at,result) VALUES(?,?,?,?)',
                   ('synthetic', 'digest', '2026-09-30T00:00:00Z', 'x' * 6_000_000))
    backup = tmp_path / 'backup.sqlite'; store.backup(backup)
    with closing(sqlite3.connect(backup)) as db:
        assert db.execute('PRAGMA integrity_check').fetchone() == ('ok',)
        assert db.execute('SELECT length(result) FROM snapshots').fetchone() == (6_000_000,)


def legacy_store(tmp_path):
    path = tmp_path / 'identity.sqlite'; store = IdentityStore(path)
    original = row(snapshot_id='old')
    outcome = store.ingest([original], snapshot_id='old', captured_at='2026-09-30T00:00:00Z')
    with closing(store.connect()) as db, db:
        db.execute('ALTER TABLE observations DROP COLUMN plan_signature')
    reopened = IdentityStore(path)
    return reopened, replace(original, procurement_uid=outcome['rows'][0]['procurement_uid']), outcome


def test_legacy_plan_backfill_uses_original_semantics_and_retains_frozen_result(tmp_path):
    store, original, frozen = legacy_store(tmp_path)
    assert store.backfill_plan_signatures([original], snapshot_id='old') == 1
    assert store.backfill_plan_signatures([original], snapshot_id='old') == 0
    with closing(store.connect()) as db:
        assert db.execute('SELECT result FROM snapshots WHERE snapshot_id=?', ('old',)).fetchone()[0] == json.dumps(frozen,ensure_ascii=False,sort_keys=True,separators=(',',':'))
    next_row = replace(original, snapshot_id='new', actual_date='2026-10-01')
    current = store.ingest([next_row], snapshot_id='new', captured_at='2026-10-01T00:00:00Z')
    assert current['rows'][0]['procurement_uid'] == original.procurement_uid


@pytest.mark.parametrize('change', [{'subject': 'Other'}, {'procurement_uid': 'PUR-other'}, {'snapshot_id': 'other'}])
def test_legacy_backfill_rejects_forged_row_or_uid(tmp_path, change):
    store, original, _ = legacy_store(tmp_path)
    with pytest.raises(ValueError, match='IDENTITY_'):
        store.backfill_plan_signatures([replace(original, **change)], snapshot_id='old')
    with closing(store.connect()) as db:
        assert db.execute('SELECT plan_signature FROM observations').fetchone()[0] is None


def test_legacy_backfill_rejects_partial_snapshot_before_any_update(tmp_path):
    store = IdentityStore(tmp_path / 'identity.sqlite')
    originals = [row(snapshot_id='old'), row(snapshot_id='old', row_number=5, actual_date='2026-09-20')]
    frozen = store.ingest(originals, snapshot_id='old', captured_at='2026-09-30T00:00:00Z')
    originals = [replace(r, procurement_uid=item['procurement_uid']) for r, item in zip(originals, frozen['rows'], strict=True)]
    with closing(store.connect()) as db, db:
        db.execute('ALTER TABLE observations DROP COLUMN plan_signature')
    store = IdentityStore(store.path)
    with pytest.raises(ValueError, match='IDENTITY_BACKFILL_COVERAGE_INCOMPLETE'):
        store.backfill_plan_signatures(originals[:1], snapshot_id='old')
    with closing(store.connect()) as db:
        assert db.execute('SELECT count(*) FROM observations WHERE plan_signature IS NOT NULL').fetchone()[0] == 0


def test_runtime_recovers_complete_legacy_identity_from_frozen_bundle_before_state_update(tmp_path):
    from procurement_engine.runtime import run_once
    from test_clean_documents import BusinessGoogle
    from test_runtime import inputs

    registry, ledger = inputs(tmp_path); state = tmp_path / 'state'
    first = run_once(registry, ledger, state, client=BusinessGoogle())
    assert first['status'] == 'VERIFIED'
    original = json.loads((state / 'attempts' / first['attempt_id'] / 'bundle/identity_observations.json').read_text())
    with closing(sqlite3.connect(state / 'identity.sqlite')) as db, db:
        db.execute('ALTER TABLE observations DROP COLUMN plan_signature')
    class UpdatedGoogle(BusinessGoogle):
        def values(self, provider, title, start, end, columns):
            values = super().values(provider, title, start, end, columns)
            if provider == 'master-0':
                for physical, value in enumerate(values, start):
                    if physical == 5: value[31] = 'Updated factual comment'
            return values
    second = run_once(registry, ledger, state, client=UpdatedGoogle())
    assert second['status'] == 'VERIFIED', second
    current = json.loads((state / 'attempts' / second['attempt_id'] / 'bundle/identity_observations.json').read_text())
    assert {r['source_row_key']: r['procurement_uid'] for r in current['rows']} == {
        r['source_row_key']: r['procurement_uid'] for r in original['rows']}
    assert current['unresolved_count'] == 0
    with closing(sqlite3.connect(state / 'identity.sqlite')) as db:
        assert json.loads(db.execute('SELECT result FROM snapshots WHERE snapshot_id=?', (first['snapshot_id'],)).fetchone()[0]) == original


def test_frozen_identity_reader_projects_dated_reviews_independently(tmp_path):
    from procurement_engine.identity_store import read_saved_identity

    store = IdentityStore(tmp_path / 'identity.sqlite')
    first = store.ingest([row()], snapshot_id='s1', captured_at='2026-09-30T00:00:00Z')
    changed = row(subject='Changed subject')
    store.ingest([changed], snapshot_id='s2', captured_at='2026-10-01T00:00:00Z')
    uid = first['rows'][0]['procurement_uid']
    store.record_review(snapshot_id='s2', locator=changed.physical_row_key, uid=uid,
        reviewer='synthetic reviewer', reviewed_at='2026-10-02T00:00:00Z',
        evidence={'source_ref': 'synthetic', 'reason': 'documented identity'})
    assert read_saved_identity(store.path, 's2', as_of='2026-10-01T00:00:00Z')['rows'][0]['procurement_uid'] is None
    assert read_saved_identity(store.path, 's2', as_of='2026-10-03T00:00:00Z')['rows'][0]['procurement_uid'] == uid
