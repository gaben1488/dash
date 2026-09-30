"""Changing a purchase amount does not erase an exact original reference."""
from dataclasses import replace

import pytest
from procurement_engine.recommendation_links import (
    resolve_current_link,
    verify_saved_report_origin,
)
from test_recommendation_links import TEST_DOCUMENTS, TEXT, recommendation, row


def linked(rec, rows, day='30.09.2026'):
    return resolve_current_link(rec, rows, report_date=day, snapshot_id='snapshot',
        verified_origin=verify_saved_report_origin(rec, TEST_DOCUMENTS), entity_link_rules=True)


@pytest.mark.parametrize('amount', [0, 17, 47, 1000])
def test_changed_price_with_same_full_reference_still_links(amount):
    result = linked(recommendation(), [replace(row(), plan_mb=amount, planned_year=2026)])
    assert result['status'] == 'CONFIRMED'
    assert result['fulfillment'] == 'UNKNOWN'
    assert result['matches'][0]['match_basis'] == 'EXACT_DOCUMENT_REFERENCE_AND_CURRENT_UID'


@pytest.mark.parametrize('text', [
    'Позиция 42 (Поставка бумаги). Перенести плановую дату на 01.11.2026.',
    'Позиция №42 — Поставка бумаги; обоснование выбора ЕП необходимо актуализировать.',
    '42 Поставка бумаги на сумму 100,00 тыс. руб.',
])
def test_full_subject_and_number_not_an_obsolete_price_identify_the_record(text):
    assert linked(recommendation(text), [replace(row(), planned_year=2026)])['status'] == 'CONFIRMED'


def test_plan_from_previous_year_is_not_lost_when_report_year_rolls_over():
    result = linked(recommendation(), [replace(row(), planned_year=2026)], '01.01.2027')
    assert result['status'] == 'CONFIRMED'


@pytest.mark.parametrize('change', [
    {'subject': 'Поставка бумаги специальной'}, {'grbs': 'УО'}, {'planned_year': 2027},
    {'procurement_uid': None},
])
def test_distinct_scope_subject_or_missing_uid_is_not_evidence(change):
    value = replace(row(), planned_year=2026)
    assert linked(recommendation(), [replace(value, **change)])['status'] != 'CONFIRMED'


def test_same_number_subject_two_amounts_is_ambiguous_not_nearest_price():
    a = replace(row(), planned_year=2026)
    b = replace(a, row_number=5, plan_mb=47, procurement_uid='PUR-other')
    assert linked(recommendation(), [a, b])['status'] == 'AMBIGUOUS'


@pytest.mark.parametrize('text', [
    TEXT.replace('(Поставка бумаги)', '(Поставка бумаги для архивов)'),
    'Не Поставка бумаги. Позиция 42 (Поставка картриджей) на сумму 46,00 тыс. руб.',
    '42,00 тыс. руб. Поставка бумаги',
])
def test_no_substring_or_number_elsewhere_can_establish_the_reference(text):
    assert linked(recommendation(text), [replace(row(), planned_year=2026)])['status'] != 'CONFIRMED'
