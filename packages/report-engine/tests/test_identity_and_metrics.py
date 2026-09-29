from concurrent.futures import ThreadPoolExecutor
from decimal import Decimal
from pathlib import Path

import pytest
from procurement_engine.canonical_metrics import calendar_facts, metric_block
from procurement_engine.identity_store import IdentityStore
from procurement_engine.models import ProcurementRow
from procurement_engine.normalize import parse_date, to_decimal

ROOT=Path(__file__).resolve().parents[1]

def row(**kw):
    data={'snapshot_id': 's','procurement_id': '1','source_row_no': '1','grbs': 'УО','subject': 'Бумага',
        'institution': 'Школа 1','activity_kind': 'Текущая деятельность','method': 'ЕП',
        'planned_date': '2026-09-30','planned_quarter': 3,'planned_year': 2026,
        'source_id': 'book','sheet_name': 'ВСЕ','row_number': 4,'plan_fb': 0.1,'plan_kb': 0.2,
        'fact_mb': 0.2,'saving_mb': 0.1,'include_saving': True}
    data.update(kw);return ProcurementRow(**data)

def test_future_fact_is_excluded_and_becomes_fact_on_its_date():
    r=row(actual_date='2026-10-01')
    before=metric_block([r],report_year=2026,as_of='2026-09-30')
    after=metric_block([r],report_year=2026,as_of='2026-10-01')
    assert (before['fact_count'],before['remain_count'],before['monetary_fact_amount'])==(0,1,0)
    assert (after['fact_count'],after['remain_count'])==(1,0)
    assert after['exact_decimal']['confirmed_saving_amount']=='0.1'

def test_cohort_and_calendar_event_are_different_populations():
    rows=[row(actual_date='2026-10-01'),row(procurement_id='2',row_number=5,
        planned_year=2025,planned_date='2025-12-20',planned_quarter=4,actual_date='2026-10-02')]
    cohort=metric_block(rows,report_year=2026,as_of='2026-10-02',planned_quarter=4)
    assert cohort['plan_count']==0
    calendar=calendar_facts(rows,event_year=2026,event_quarter=4,as_of='2026-10-02')
    assert calendar['recorded_position_count']==2 and calendar['contract_count'] is None

def test_decimal_sign_saving_and_unknown_money_are_explicit():
    a=row(actual_date='2026-09-30')
    b=row(procurement_id='2',row_number=5,include_saving=False,actual_date='2026-09-30')
    block=metric_block([a,b],report_year=2026,as_of='2026-09-30')
    assert Decimal(block['exact_decimal']['plan_amount'])==Decimal('0.6')
    assert Decimal(block['exact_decimal']['deviation_amount'])==Decimal('-0.2')
    assert Decimal(block['exact_decimal']['confirmed_saving_amount'])==Decimal('0.1')
    unknown=metric_block([row(plan_fb=0,plan_kb=0,missing_money_fields=('H','I','J'))],report_year=2026)
    assert unknown['money_coverage']['rows_with_all_plan_components_missing']==1
    assert unknown['contracted_share_pct'] is None

@pytest.mark.parametrize('value',[True,False])
def test_boolean_dates_are_invalid(value):
    assert parse_date(value) is None

@pytest.mark.parametrize('value',[True,float('nan'),float('inf'),'NaN','-Infinity'])
def test_nonfinite_and_boolean_money_are_rejected(value):
    with pytest.raises(ValueError):to_decimal(value)

def test_identity_survives_move_sort_renumber_and_restore(tmp_path):
    store=IdentityStore(tmp_path/'identity.sqlite')
    a=store.ingest([row()],snapshot_id='s1',captured_at='2026-09-30T00:00:00+12:00')
    moved=row(snapshot_id='s2',row_number=901,procurement_id='33',source_row_no='33')
    b=store.ingest([moved],snapshot_id='s2',captured_at='2026-10-01T00:00:00+12:00')
    assert b['rows'][0]['procurement_uid']==a['rows'][0]['procurement_uid']
    assert b['rows'][0]['status']=='EXACT_CONTINUITY'
    store.backup(tmp_path/'restored.sqlite')
    restored=IdentityStore(tmp_path/'restored.sqlite')
    assert restored.ingest([moved],snapshot_id='s2',captured_at='2026-10-01T00:00:00+12:00')==b

def test_identity_change_is_review_not_business_number_match(tmp_path):
    store=IdentityStore(tmp_path/'id.sqlite')
    first=store.ingest([row()],snapshot_id='s1',captured_at='2026-09-30T00:00:00+12:00')
    second=store.ingest([row(actual_date='2026-10-01')],snapshot_id='s2',captured_at='2026-10-01T00:00:00+12:00')
    assert second['unresolved_count']==1
    assert second['rows'][0]['evidence']['candidate_uids']==[first['rows'][0]['procurement_uid']]
    assert second['rows'][0]['procurement_uid'] is None

def test_identical_duplicate_rows_never_collapsed(tmp_path):
    store=IdentityStore(tmp_path/'id.sqlite')
    result=store.ingest([row(),row(row_number=5,procurement_id='2')],snapshot_id='s',captured_at='2026-09-30T00:00:00Z')
    assert result['unresolved_count']==2
    assert {r['status'] for r in result['rows']}=={'AMBIGUOUS_DUPLICATE'}

def test_concurrent_same_identity_import_is_idempotent_and_snapshot_is_immutable(tmp_path):
    store=IdentityStore(tmp_path/'id.sqlite')
    def run():return store.ingest([row()],snapshot_id='s',captured_at='2026-09-30T00:00:00Z')
    with ThreadPoolExecutor(max_workers=2) as pool:results=list(pool.map(lambda _:run(),range(2)))
    assert results[0]==results[1]
    with pytest.raises(ValueError,match='MUTATION'):
        store.ingest([row(subject='Другая закупка')],snapshot_id='s',captured_at='2026-09-30T00:00:00Z')
    with pytest.raises(ValueError,match='OUT_OF_ORDER'):
        store.ingest([row()],snapshot_id='older',captured_at='2026-09-29T00:00:00Z')


def test_same_evidence_can_be_rechecked_later_without_rewriting_identity_history(tmp_path):
    store = IdentityStore(tmp_path / 'identity.sqlite')
    first = store.ingest([row()], snapshot_id='same', captured_at='2026-09-29T14:00:00Z')
    later = store.ingest([row()], snapshot_id='same', captured_at='2026-09-29T16:00:00Z')
    assert later == first
    assert later['captured_at'] == '2026-09-29T14:00:00Z'
    with pytest.raises(ValueError, match='MUTATION'):
        store.ingest([row(subject='Changed')], snapshot_id='same', captured_at='2026-09-29T17:00:00Z')
    with pytest.raises(ValueError, match='OUT_OF_ORDER'):
        store.ingest([row()], snapshot_id='same', captured_at='2026-09-29T13:00:00Z')
