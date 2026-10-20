"""Reviewed customer-name migrations must not create a different procurement."""
import json
import re
from contextlib import closing
from pathlib import Path

import pytest
from procurement_engine.identity_store import IdentityStore, read_saved_identity
from test_identity_and_metrics import row


def test_reviewed_customer_rename_keeps_uid_and_original_source_names(tmp_path):
    store = IdentityStore(tmp_path / 'identity.sqlite')
    original = row(grbs='УЭР', institution='МКУ «ЦЭР»')
    first = store.ingest([original], snapshot_id='before',
                         captured_at='2026-10-10T09:49:39+00:00', allow_plan_updates=True)
    current = row(grbs='УЭР', institution='МКУ "ЦЭР"')
    second = store.ingest([current], snapshot_id='after',
                          captured_at='2026-10-11T09:15:12+00:00', allow_plan_updates=True,
                          allow_customer_aliases=True)
    assert second['rows'][0]['procurement_uid'] == first['rows'][0]['procurement_uid']
    assert second['unresolved_count'] == 0
    assert original.institution == 'МКУ «ЦЭР»'
    assert current.institution == 'МКУ "ЦЭР"'
    assert read_saved_identity(store.path, 'before') == first


def test_packaged_customer_names_match_the_existing_shared_registry():
    root = Path(__file__).resolve().parents[2]
    source = (root / 'shared/src/dictionaries/subordinate-registry.ts').read_text(encoding='utf-8')
    source = source.split('export const SUBORDINATE_REGISTRY: SubordinateEntry[] = [', 1)[1].split('\n];', 1)[0]
    expected = []
    for block in re.findall(r'\{([^{}]*)\}', source, re.DOTALL):
        entry = dict(re.findall(r"\b(id|canonicalName|legacyCanonicalName|grbsId):\s*'([^']*)'", block))
        if entry.get('legacyCanonicalName'):
            expected.append(entry)
    packaged = Path(__file__).resolve().parents[1] / 'src/procurement_engine/customer_aliases.json'
    assert json.loads(packaged.read_text(encoding='utf-8')) == expected


def test_recovers_a_lost_uid_across_reviewed_aliases_without_rewriting_old_results(tmp_path):
    store = IdentityStore(tmp_path / 'identity.sqlite')
    first = store.ingest([row(grbs='УЭР', institution='МКУ «ЦЭР»')], snapshot_id='s1',
                         captured_at='2026-10-10T00:00:00Z')
    lost = store.ingest([row(grbs='УЭР', institution='МКУ "ЦЭР"')], snapshot_id='s2',
                        captured_at='2026-10-11T00:00:00Z')
    assert lost['rows'][0]['procurement_uid'] is None
    recovered = store.ingest([row(grbs='УЭР', institution='МКУ "ЦЭР"', plan_mb=12)],
                             snapshot_id='s3', captured_at='2026-10-20T00:00:00Z',
                             allow_plan_updates=True, allow_customer_aliases=True)
    assert recovered['rows'][0]['procurement_uid'] == first['rows'][0]['procurement_uid']
    assert recovered['rows'][0]['evidence']['chain_snapshot_ids'] == ['s2', 's1']
    assert read_saved_identity(store.path, 's2') == lost


@pytest.mark.parametrize('change', [
    {'program': 'Другая программа'}, {'subject': 'Другой товар'}, {'institution': 'Другая организация'},
    {'source_row_no': '2'}, {'planned_year': 2027}, {'grbs': 'УД'},
])
def test_customer_alias_is_not_permission_to_merge_changed_identity(tmp_path, change):
    store = IdentityStore(tmp_path / 'identity.sqlite')
    first = store.ingest([row(grbs='УЭР', institution='МКУ «ЦЭР»')], snapshot_id='s1',
                         captured_at='2026-10-10T00:00:00Z')
    values = {'grbs': 'УЭР', 'institution': 'МКУ "ЦЭР"', **change}
    result = store.ingest([row(**values)], snapshot_id='s2', captured_at='2026-10-11T00:00:00Z',
                          allow_plan_updates=True, allow_customer_aliases=True)
    assert result['rows'][0]['procurement_uid'] != first['rows'][0]['procurement_uid']


def test_distinct_numbers_disambiguate_same_customer_and_subject_without_using_price(tmp_path):
    store = IdentityStore(tmp_path / 'identity.sqlite')
    first = store.ingest([row(grbs='УЭР', institution='МКУ «ЦЭР»'),
                          row(grbs='УЭР', institution='МКУ «ЦЭР»', row_number=5, source_row_no='2')],
                         snapshot_id='s1', captured_at='2026-10-10T00:00:00Z',
                         allow_plan_updates=True, allow_customer_aliases=True)
    assert first['unresolved_count'] == 0
    assert len({item['procurement_uid'] for item in first['rows']}) == 2
    current = store.ingest([row(grbs='УЭР', institution='МКУ "ЦЭР"', plan_mb=17),
                            row(grbs='УЭР', institution='МКУ "ЦЭР"', row_number=5, source_row_no='2', plan_mb=17)],
                           snapshot_id='s2', captured_at='2026-10-11T00:00:00Z',
                           allow_plan_updates=True, allow_customer_aliases=True)
    assert [item['procurement_uid'] for item in current['rows']] == [item['procurement_uid'] for item in first['rows']]


def test_same_number_and_same_entity_are_still_ambiguous(tmp_path):
    store = IdentityStore(tmp_path / 'identity.sqlite')
    result = store.ingest([row(), row(row_number=5)], snapshot_id='s1',
                          captured_at='2026-10-10T00:00:00Z',
                          allow_plan_updates=True, allow_customer_aliases=True)
    assert result['unresolved_count'] == 2


def test_repeated_number_can_be_disambiguated_by_complete_program_context(tmp_path):
    store = IdentityStore(tmp_path / 'identity.sqlite')
    first = store.ingest([row(grbs='УЭР', institution='МКУ «ЦЭР»', program='Программа А'),
                          row(grbs='УЭР', institution='МКУ «ЦЭР»', program='Программа Б', row_number=5)],
                         snapshot_id='s1', captured_at='2026-10-10T00:00:00Z',
                         allow_plan_updates=True, allow_customer_aliases=True)
    second = store.ingest([row(grbs='УЭР', institution='МКУ "ЦЭР"', program='Программа А'),
                           row(grbs='УЭР', institution='МКУ "ЦЭР"', program='Программа Б', row_number=5)],
                          snapshot_id='s2', captured_at='2026-10-11T00:00:00Z',
                          allow_plan_updates=True, allow_customer_aliases=True)
    assert [item['procurement_uid'] for item in second['rows']] == [item['procurement_uid'] for item in first['rows']]


def test_unproved_historical_program_cannot_be_discarded_to_make_an_alias_unique(tmp_path):
    store = IdentityStore(tmp_path / 'identity.sqlite')
    store.ingest([row(grbs='УЭР', institution='МКУ «ЦЭР»', program='Программа А'),
                  row(grbs='УЭР', institution='МКУ «ЦЭР»', program='Программа Б', row_number=5)],
                 snapshot_id='s1', captured_at='2026-10-10T00:00:00Z',
                 allow_plan_updates=True, allow_customer_aliases=True)
    with closing(store.connect()) as db, db:
        db.execute("UPDATE observations SET entity_signature=NULL WHERE snapshot_id='s1' AND locator=?",
                   (row(row_number=5).physical_row_key,))
    result = store.ingest([row(grbs='УЭР', institution='МКУ "ЦЭР"', program='Программа А')],
                          snapshot_id='s2', captured_at='2026-10-11T00:00:00Z',
                          allow_plan_updates=True, allow_customer_aliases=True)
    assert result['rows'][0]['procurement_uid'] is None


def test_adding_a_distinct_number_cannot_steal_the_retained_rows_uid(tmp_path):
    store = IdentityStore(tmp_path / 'identity.sqlite')
    first = store.ingest([row()], snapshot_id='s1', captured_at='2026-10-10T00:00:00Z',
                         allow_plan_updates=True, allow_customer_aliases=True)
    result = store.ingest([row(), row(row_number=5, source_row_no='2')],
                          snapshot_id='s2', captured_at='2026-10-11T00:00:00Z',
                          allow_plan_updates=True, allow_customer_aliases=True)
    assert result['rows'][0]['procurement_uid'] == first['rows'][0]['procurement_uid']
    assert result['rows'][1]['procurement_uid']
    assert result['rows'][1]['procurement_uid'] != first['rows'][0]['procurement_uid']
    assert result['unresolved_count'] == 0


def test_missing_snapshot_still_breaks_customer_alias_chain(tmp_path):
    store = IdentityStore(tmp_path / 'identity.sqlite')
    first = store.ingest([row(grbs='УЭР', institution='МКУ «ЦЭР»')], snapshot_id='s1',
                         captured_at='2026-10-10T00:00:00Z')
    store.ingest([], snapshot_id='s2', captured_at='2026-10-11T00:00:00Z')
    result = store.ingest([row(grbs='УЭР', institution='МКУ "ЦЭР"')], snapshot_id='s3',
                          captured_at='2026-10-12T00:00:00Z',
                          allow_plan_updates=True, allow_customer_aliases=True)
    assert result['rows'][0]['procurement_uid'] != first['rows'][0]['procurement_uid']

def test_weekly_scope_ignores_unretained_midweek_metadata(tmp_path):
    store = IdentityStore(tmp_path / 'identity.sqlite')
    first = store.ingest([row(grbs='УЭР', institution='МКУ «ЦЭР»')], snapshot_id='weekly',
                         captured_at='2026-10-08T08:00:00Z')
    store.ingest([row(grbs='УЭР', institution='МКУ «ЦЭР»')], snapshot_id='midweek',
                 captured_at='2026-10-09T08:00:00Z')
    store.ingest([row(grbs='УЭР', institution='МКУ "ЦЭР"')], snapshot_id='current',
                 captured_at='2026-10-20T08:00:00Z')
    with closing(store.connect()) as db, db:
        db.execute("UPDATE observations SET entity_signature=NULL WHERE snapshot_id='midweek'")
    store.continuity_snapshot_ids = {'weekly', 'current'}
    result = store.ingest([row(grbs='УЭР', institution='МКУ "ЦЭР"')], snapshot_id='next',
                          captured_at='2026-10-21T08:00:00Z',
                          allow_plan_updates=True, allow_customer_aliases=True)
    assert result['rows'][0]['procurement_uid'] == first['rows'][0]['procurement_uid']
    assert result['rows'][0]['evidence']['chain_snapshot_ids'] == ['current', 'weekly']


def test_weekly_scope_cannot_skip_an_absent_row_in_a_retained_week(tmp_path):
    store = IdentityStore(tmp_path / 'identity.sqlite')
    first = store.ingest([row(grbs='УЭР', institution='МКУ «ЦЭР»')], snapshot_id='weekly1',
                         captured_at='2026-10-01T08:00:00Z')
    store.ingest([], snapshot_id='weekly2', captured_at='2026-10-08T08:00:00Z')
    store.ingest([row(grbs='УЭР', institution='МКУ "ЦЭР"')], snapshot_id='current',
                 captured_at='2026-10-20T08:00:00Z')
    store.continuity_snapshot_ids = {'weekly1', 'weekly2', 'current'}
    result = store.ingest([row(grbs='УЭР', institution='МКУ "ЦЭР"')], snapshot_id='next',
                          captured_at='2026-10-21T08:00:00Z',
                          allow_plan_updates=True, allow_customer_aliases=True)
    assert result['rows'][0]['procurement_uid'] != first['rows'][0]['procurement_uid']

def test_unique_current_compound_keys_can_start_identity_when_weekly_cuts_never_had_uids(tmp_path):
    store = IdentityStore(tmp_path / 'identity.sqlite')
    values = [row(), row(row_number=5, source_row_no='2')]
    first = store.ingest(values, snapshot_id='weekly', captured_at='2026-10-08T08:00:00Z')
    assert all(item['procurement_uid'] is None for item in first['rows'])
    store.ingest(values, snapshot_id='current', captured_at='2026-10-20T08:00:00Z')
    store.continuity_snapshot_ids = {'weekly', 'current'}
    result = store.ingest(values, snapshot_id='next', captured_at='2026-10-21T08:00:00Z',
                          allow_plan_updates=True, allow_customer_aliases=True)
    assert result['unresolved_count'] == 0
    assert len({item['procurement_uid'] for item in result['rows']}) == 2
    assert all(item['status'] == 'CURRENT_IDENTITY_ESTABLISHED' for item in result['rows'])
    assert all(item['evidence']['historical_uid_recovered'] is False for item in result['rows'])

def test_weekly_mode_starts_current_identity_without_claiming_a_missing_history(tmp_path):
    store = IdentityStore(tmp_path / 'identity.sqlite')
    first = store.ingest([row()], snapshot_id='weekly', captured_at='2026-10-08T08:00:00Z')
    store.ingest([row(program='Changed program')], snapshot_id='current', captured_at='2026-10-20T08:00:00Z')
    with closing(store.connect()) as db, db:
        db.execute("UPDATE observations SET uid=NULL WHERE snapshot_id='current'")
    store.continuity_snapshot_ids = {'weekly', 'current'}
    result = store.ingest([row(program='Changed program')], snapshot_id='next',
                          captured_at='2026-10-21T08:00:00Z',
                          allow_plan_updates=True, allow_customer_aliases=True)
    current = result['rows'][0]
    assert current['procurement_uid'] and current['procurement_uid'] != first['rows'][0]['procurement_uid']
    assert current['status'] == 'CURRENT_IDENTITY_ESTABLISHED'
    assert current['evidence']['historical_uid_recovered'] is False
