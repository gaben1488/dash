"""Signals must state a location, consequence and a concrete action, or no user work."""
from dataclasses import asdict

import pytest
from test_identity_and_metrics import row


def assurance(rows, records=()):
    from procurement_engine.automation_assurance import assess_automation
    details = [{**asdict(r), 'physical_row_key': r.physical_row_key} for r in rows]
    return assess_automation({'details': details, 'recommendation_records': list(records),
        'issues': [], 'identity_observations': {'rows': []}, 'snapshot': {'report_date': '01.10.2026'}},
        [{'provider_id': 'book', 'sheet': 'ВСЕ', 'sheet_id': 17}])


def test_empty_fact_date_alone_does_not_create_a_task():
    result = assurance([row(fact_mb=0, procurement_uid="PUR-test")])
    assert result['actions'] == []
    assert result['user_action_count'] == 0


def test_fact_money_without_date_provides_exact_address_and_does_not_invent_completion():
    result = assurance([row(fact_mb=12, actual_date=None)])
    signal = next(x for x in result['actions'] if x['code'] == 'FACT_MONEY_WITHOUT_DATE')
    assert signal['user_action_required'] is True
    assert signal['owner_kind'] == 'SOURCE_OWNER'
    assert signal['locations'][0]['a1'] == 'Q4'
    assert signal['locations'][0]['url'].endswith('gid=17&range=Q4')
    for field in ('cause', 'report_effect', 'action', 'resolved_when'):
        assert signal[field]
    assert 'не увеличивает' in signal['report_effect']


def test_source_statement_funding_updates_report_meaning_but_not_fact():
    from procurement_engine.automation_assurance import source_events
    r = row(grbs_comment='Закупка отложена: финансирование отсутствует.', actual_date=None)
    events = source_events(r)
    assert {event['kind'] for event in events} == {'POSTPONED_REPORTED', 'NO_FUNDING_REPORTED'}
    assert all(event['evidence_kind'] == 'SOURCE_STATEMENT' for event in events)
    assert r.actual_date is None


@pytest.mark.parametrize('text', [
    'Если финансирование отсутствует, закупка будет отложена.',
    'Отсутствие финансирования не подтверждено.',
    'Неизвестно, выделено ли финансирование.',
    'Поставка перенесена на 2035 год.',
    'Контракт не заключён 15.09.2026.',
])
def test_conditions_negations_and_delivery_are_not_procurement_events(text):
    from procurement_engine.automation_assurance import source_events
    assert source_events(row(grbs_comment=text)) == []


def test_conflicting_authors_have_both_exact_locations_and_no_silent_precedence():
    result = assurance([row(grbs_comment='Финансирование отсутствует.',
                            monitoring_note='Финансирование выделено.', fact_mb=0)])
    signal = next(x for x in result['actions'] if x['code'] == 'CONFLICTING_FUNDING_STATEMENTS')
    assert {where['a1'] for where in signal['locations']} == {'AF4', 'AH4'}
    assert signal['user_action_required'] is True


def test_unresolved_parser_is_engine_work_not_a_blanket_user_confirmation():
    record = {'recommendation_id': 'R1', 'grbs': 'УО', 'active_in_current_slice': True,
        'current_link': {'status': 'TEXT_REFERENCE_MISSING'}, 'dimensions': {'compliance_status': 'UNKNOWN'}}
    result = assurance([], [record])
    assert result['fully_automated'] is False
    assert result['user_action_count'] == 0
    assert result['engine_action_count'] == 1
    assert result['actions'][0]['user_action_required'] is False
    assert 'От вас' in result['actions'][0]['action']


def test_signal_closes_automatically_when_primary_date_appears():
    r = row(actual_date=None)
    first = assurance([r]); second = assurance([row(actual_date='2026-09-30')])
    assert any(x['code'] == 'FACT_MONEY_WITHOUT_DATE' for x in first['actions'])
    assert not any(x['code'] == 'FACT_MONEY_WITHOUT_DATE' for x in second['actions'])


def test_conditional_or_historical_colon_does_not_turn_hypothesis_into_fact():
    from dataclasses import replace

    from procurement_engine.automation_assurance import source_events
    from test_recommendation_links import row

    for comment in ('Если потребуется: финансирование отсутствует.',
                    'Ранее сообщалось: финансирование отсутствует.',
                    'Пример: договор заключен 01.10.2026.'):
        assert source_events(replace(row(), grbs_comment=comment)) == []

def test_conflicting_link_proofs_stay_engine_work_with_specific_cause():
    record = {'recommendation_id': 'R1', 'grbs': 'УО', 'active_in_current_slice': True,
        'current_link': {'status': 'AMBIGUOUS',
            'conflict_kind': 'AUTOMATIC_REVIEWED_UID_DISAGREEMENT'},
        'dimensions': {'compliance_status': 'UNKNOWN'}}
    result = assurance([], [record])
    assert result['engine_action_count'] == 1
    assert result['user_action_count'] == 0
    assert result['actions'][0]['code'] == 'ENGINE_RECOMMENDATION_LINK'
    assert 'разные закупки' in result['actions'][0]['cause']


def test_ineligible_identity_observations_are_not_false_procurement_actions():
    from dataclasses import asdict, replace

    from procurement_engine.automation_assurance import assess_automation
    from test_recommendation_links import row as source_row

    a = replace(source_row(), procurement_uid=None)
    eligible = {**asdict(a), 'physical_row_key': 'book:4', 'included': True}
    excluded = {**eligible, 'physical_row_key': 'book:5', 'included': False}
    result = assess_automation({'details': [eligible, excluded],
        'recommendation_records': [], 'issues': [],
        'identity_observations': {'rows': []}, 'snapshot': {'report_date': '09.10.2026'}})
    alerts = [r for r in result['actions'] if r['code'] == 'ENGINE_IDENTITY_CONTINUITY']
    assert len(alerts) == 1
    assert result['nonprocurement_identity_observations'] == 1
    assert result['engine_action_count'] == 1


def test_v1_archived_assurance_remains_readable_after_v2_scoped_tasks():
    from dataclasses import asdict, replace

    from procurement_engine.automation_assurance import assess_automation
    from test_recommendation_links import row as source_row

    purchase = replace(source_row(), procurement_uid=None)
    other = {**asdict(purchase), 'physical_row_key': 'book:5', 'included': False}
    model = {'details': [other], 'recommendation_records': [], 'issues': [],
             'identity_observations': {'rows': []}, 'snapshot': {'report_date': '09.10.2026'}}
    former = assess_automation(model, legacy_scope=True)
    current = assess_automation(model)
    assert former['contract'] == 'actionable-assurance-v1'
    assert former['engine_action_count'] == 1
    assert 'nonprocurement_identity_observations' not in former
    assert current['contract'] == 'actionable-assurance-v2'
    assert current['engine_action_count'] == 0
    assert current['nonprocurement_identity_observations'] == 1
