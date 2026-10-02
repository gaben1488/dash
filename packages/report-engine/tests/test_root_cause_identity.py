"""A monetary update changes state, not the identity of an unambiguous purchase."""
import json
from contextlib import closing
from dataclasses import replace

import pytest
from procurement_engine.identity_store import IdentityStore
from test_identity_and_metrics import row


def observe(store, value, number):
    return store.ingest([value], snapshot_id=f's{number}',
        captured_at=f'2026-10-0{number}T00:00:00Z', allow_plan_updates=True)


@pytest.mark.parametrize('update', [
    {'plan_fb': 17}, {'plan_fb': 1, 'plan_mb': 30, 'stored_plan_total': 31.2},
    {'planned_date': '2026-11-01', 'planned_quarter': 4},
    {'method': 'ЭА', 'plan_mb': 10}, {'missing_money_fields': ('H', 'I', 'J')},
])
def test_routine_plan_updates_keep_proven_unique_identity(tmp_path, update):
    store = IdentityStore(tmp_path / 'identity.sqlite')
    first = observe(store, row(), 1)
    second = observe(store, row(**update), 2)
    assert second['rows'][0]['procurement_uid'] == first['rows'][0]['procurement_uid']
    assert second['unresolved_count'] == 0
    assert second['rows'][0]['evidence']['signature'] != first['rows'][0]['evidence']['signature']
    assert second['rows'][0]['evidence']['rule'] == 'unique-entity-continuity-v1'


@pytest.mark.parametrize('update', [
    {'subject': 'Другой товар'}, {'institution': 'Другая школа'}, {'planned_year': 2027},
    {'source_row_no': '99', 'plan_mb': 10}, {'grbs': 'УД'},
])
def test_scope_or_subject_or_renumbered_and_changed_row_needs_separate_evidence(tmp_path, update):
    store = IdentityStore(tmp_path / 'identity.sqlite')
    first = observe(store, row(), 1)
    second = observe(store, row(**update), 2)
    assert second['rows'][0]['procurement_uid'] != first['rows'][0]['procurement_uid']


def test_two_same_entity_candidates_are_not_resolved_using_changed_price(tmp_path):
    store = IdentityStore(tmp_path / 'identity.sqlite')
    store.ingest([row(), row(row_number=5, source_row_no='2', plan_mb=25)],
        snapshot_id='s1', captured_at='2026-10-01T00:00:00Z', allow_plan_updates=True)
    second = observe(store, row(plan_mb=12), 2)
    assert second['rows'][0]['procurement_uid'] is None


def test_backfill_new_nullable_signature_preserves_legacy_evidence_and_enables_price_change(tmp_path):
    store = IdentityStore(tmp_path / 'identity.sqlite')
    original = row(snapshot_id='old')
    old = store.ingest([original], snapshot_id='old', captured_at='2026-09-30T00:00:00Z')
    uid = old['rows'][0]['procurement_uid']
    with closing(store.connect()) as db, db:
        db.execute('ALTER TABLE observations DROP COLUMN entity_signature')
        frozen = db.execute("SELECT result FROM snapshots WHERE snapshot_id='old'").fetchone()[0]
    store = IdentityStore(store.path)
    assert store.backfill_plan_signatures([replace(original, procurement_uid=uid)], snapshot_id='old') == 1
    new = observe(store, row(plan_mb=48), 2)
    assert new['rows'][0]['procurement_uid'] == uid
    with closing(store.connect()) as db:
        assert db.execute("SELECT result FROM snapshots WHERE snapshot_id='old'").fetchone()[0] == frozen
        assert json.loads(frozen) == old


def test_new_rules_recover_identity_lost_by_legacy_price_rule(tmp_path):
    store=IdentityStore(tmp_path/'identity.sqlite')
    first=store.ingest([row()], snapshot_id='s1', captured_at='2026-10-01T00:00:00Z')
    lost=store.ingest([row(plan_mb=20)], snapshot_id='s2', captured_at='2026-10-02T00:00:00Z')
    assert lost['rows'][0]['procurement_uid'] is None
    recovered=observe(store, row(plan_mb=30), 3)
    assert recovered['rows'][0]['procurement_uid']==first['rows'][0]['procurement_uid']
    assert recovered['rows'][0]['evidence']['chain_snapshot_ids']==['s2','s1']
    with closing(store.connect()) as db:
        assert json.loads(db.execute("SELECT result FROM snapshots WHERE snapshot_id='s2'").fetchone()[0])==lost


def test_missing_observation_breaks_the_recovery_chain(tmp_path):
    store=IdentityStore(tmp_path/'identity.sqlite')
    first=observe(store, row(), 1)
    store.ingest([], snapshot_id='s2', captured_at='2026-10-02T00:00:00Z', allow_plan_updates=True)
    result=observe(store, row(plan_mb=20), 3)
    assert result['rows'][0]['procurement_uid'] != first['rows'][0]['procurement_uid']


def test_legacy_fingerprint_must_be_backfilled_before_recovery(tmp_path):
    store=IdentityStore(tmp_path/'identity.sqlite')
    store.ingest([row()], snapshot_id='s1', captured_at='2026-10-01T00:00:00Z')
    store.ingest([row(plan_mb=20)], snapshot_id='s2', captured_at='2026-10-02T00:00:00Z')
    with closing(store.connect()) as db, db:
        db.execute("UPDATE observations SET entity_signature=NULL WHERE snapshot_id='s1'")
    result=observe(store, row(plan_mb=20), 3)
    assert result['rows'][0]['procurement_uid'] is None


def test_entity_program_change_is_not_hidden_by_legacy_state_signature(tmp_path):
    from dataclasses import replace

    from procurement_engine.identity_store import IdentityStore
    from test_recommendation_links import row

    store = IdentityStore(tmp_path / 'identity.sqlite')
    first = replace(row(), snapshot_id='s1', institution='Школа', activity_kind='Поставка',
                    program='Программа А', planned_year=2034)
    old = store.ingest([first], snapshot_id='s1', captured_at='2034-01-01T12:00:00+12:00', allow_plan_updates=True)
    new = store.ingest([replace(first, snapshot_id='s2', program='Программа Б')],
        snapshot_id='s2', captured_at='2034-01-02T12:00:00+12:00', allow_plan_updates=True)
    assert old['rows'][0]['procurement_uid']
    assert new['rows'][0]['procurement_uid'] is None
