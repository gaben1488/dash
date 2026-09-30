from dataclasses import replace

import pytest
from procurement_engine.raw_pipeline import review_recommendations
from test_identity_and_metrics import row


def recommendation(**changes):
    item = {'recommendation_id': 'R1', 'grbs': 'УО', 'table_no': 1, 'row_no': 1,
            'recommendation_text': 'Перевести закупку на ЭА', 'recommendation_type': 'CHANGE_METHOD_EA',
            'source_procurement_ids': ['1'], 'active_in_current_slice': True}
    return {**item, **changes}


def proof(**changes):
    item = {'review_id': 'REV-1', 'snapshot_id': 'prior', 'locator': 'prior-row', 'uid': 'PUR-1',
            'reviewer': 'Проверяющий', 'reviewed_at': '2026-09-29T00:00:00Z',
            'evidence': {'source_ref': 'protocol/1', 'reason': 'Проверена история',
                         'recommendation_id': 'R1', 'source_procurement_ids': ['1']}}
    return {**item, **changes}


def resolve(record=None, rows=None, proofs=None):
    return review_recommendations([record or recommendation()],
        rows or [row(method='ЭА', procurement_uid='PUR-1')], 'snapshot', '30.09.2026',
        identity_evidence=[proof()] if proofs is None else proofs)[0]


def test_proven_method_change_is_implemented_without_claiming_contract_completion():
    result = resolve()
    assert result['semantic_status'] == 'IMPLEMENTED'
    assert result['dimensions']['compliance_status'] == 'IMPLEMENTED'
    assert result['dimensions']['execution_status'] == 'PLANNED'
    assert result['current_procurement_uids'] == ['PUR-1']
    assert 'ЭА' in result['business_finding']


@pytest.mark.parametrize('rows', [[row(procurement_uid='PUR-1', actual_date='2026-09-29')],
                                [row(method='ЕП', procurement_uid='PUR-1')]])
def test_acceptance_and_fact_do_not_prove_recommended_method(rows):
    result = resolve(recommendation(historical_acceptance=True), rows=rows)
    assert result['semantic_status'] == 'NOT_IMPLEMENTED'


@pytest.mark.parametrize('proofs', [[], [proof(uid='PUR-missing')],
    [proof(evidence={'source_ref': 'protocol/1', 'reason': 'Проверено',
                     'recommendation_id': 'R1', 'source_procurement_ids': ['2']})]])
def test_missing_or_wrong_binding_never_inherits_positive_status(proofs):
    assert resolve(proofs=proofs)['semantic_status'] == 'REVIEW_REQUIRED'


def test_same_uid_in_two_current_rows_cannot_prove_recommendation():
    result = resolve(rows=[row(procurement_uid='PUR-1'), replace(row(), row_number=5,
                     procurement_id='2', procurement_uid='PUR-1')])
    assert result['semantic_status'] == 'REVIEW_REQUIRED'


def test_unrelated_fact_does_not_prove_merge():
    result = resolve(recommendation(recommendation_type='MERGE_PROCUREMENTS'),
                     rows=[row(procurement_uid='PUR-1', actual_date='2026-09-29')])
    assert result['dimensions']['compliance_status'] == 'UNKNOWN'


def test_reviewed_full_merge_can_be_proven_at_plan_level():
    record = recommendation(recommendation_type='MERGE_PROCUREMENTS', source_procurement_ids=['1', '2'])
    reviewed = proof(evidence={**proof()['evidence'], 'source_procurement_ids': ['1', '2'],
                              'relation': 'MERGES_INTO'})
    result = resolve(record, proofs=[reviewed])
    assert result['semantic_status'] == 'IMPLEMENTED'
    assert result['dimensions']['grouping_status'] == 'MERGED'
    assert result['dimensions']['execution_status'] == 'PLANNED'


@pytest.mark.parametrize('kind, target, changes', [
    ('CHANGE_AMOUNT', {'target_amount_thousand': '0.3'}, {}),
    ('MOVE_PLANNED_DATE', {'target_planned_date': '2026-10-01'}, {'planned_date': '2026-10-01'}),
])
def test_structured_action_targets_are_checked_against_current_fields(kind, target, changes):
    result = resolve(recommendation(recommendation_type=kind, **target),
                     rows=[row(procurement_uid='PUR-1', **changes)])
    assert result['semantic_status'] == 'IMPLEMENTED'


def test_real_publication_accepts_proven_positive_and_updates_counts(tmp_path):
    import json

    from procurement_engine.identity_store import IdentityStore
    from procurement_engine.publication_reader import read_publication
    from procurement_engine.runtime import run_once
    from test_recorded_release import CompleteGoogle
    from test_runtime import inputs

    class WithRow(CompleteGoogle):
        def grid(self, provider, sheet_id):
            result = super().grid(provider, sheet_id)
            if provider == 'master-0':
                result['gridProperties']['rowCount'] = 4
            return result

        def values(self, provider, title, start, end, columns):
            data = [[], [], ['Synthetic header']]
            if provider == 'master-0':
                item = [''] * 34
                for index, value in {0: '1', 5: 'Текущая деятельность', 6: 'Бумага', 7: 10,
                        8: 0, 9: 0, 10: 10, 11: 'ЭА', 13: '30.09.2026', 14: 3, 15: 2026}.items():
                    item[index] = value
                data.append(item)
            return data[start - 1:end]

    registry, ledger = inputs(tmp_path)
    ledger.write_text(json.dumps([recommendation(grbs='УЭР')]))
    state = tmp_path / 'state'
    before = run_once(registry, ledger, state, client=WithRow())
    assert before['status'] == 'VERIFIED_WITH_WARNINGS'
    model = json.loads(read_publication(state, 'dashboard', before['publication']['release_id']))
    observation = model['identity_observations']['rows'][0]
    IdentityStore(state / 'identity.sqlite').record_review(snapshot_id=before['snapshot_id'],
        locator=observation['source_row_key'], uid=observation['procurement_uid'],
        reviewer='Проверяющий', reviewed_at=model['report_clock']['cutoff_at'], evidence=proof()['evidence'])
    after = run_once(registry, ledger, state, client=WithRow())
    assert after['status'] == 'VERIFIED'
    assert after['snapshot_id'] != before['snapshot_id']
    release = after['publication']['release_id']
    model = json.loads(read_publication(state, 'dashboard', release))
    assert model['recommendations']['tables']['1'][0]['semantic_status'] == 'IMPLEMENTED'
    assert model['management_summary']['recommendation_compliance_counts'] == {'Реализовано': 1}
    assert model['management_summary']['recommendation_execution_counts'] == {'Факт не внесён': 1}
    assert read_publication(state, 'main', release).startswith(b'PK')
    assert read_publication(state, 'supplement', release).startswith(b'PK')


def test_cli_records_existing_review_with_explicit_evidence(tmp_path, capsys):
    import json

    from procurement_engine.cli import main
    from procurement_engine.identity_store import IdentityStore

    state = tmp_path / 'state'
    store = IdentityStore(state / 'identity.sqlite')
    observed = store.ingest([row()], snapshot_id='s1', captured_at='2026-09-28T00:00:00Z')
    evidence = tmp_path / 'proof.json'; evidence.write_text(json.dumps(proof()['evidence']))
    result = main(['record-identity-review', '--state', str(state), '--snapshot-id', 's1',
        '--locator', row().physical_row_key, '--uid', observed['rows'][0]['procurement_uid'],
        '--reviewer', 'Проверяющий', '--reviewed-at', '2026-09-29T00:00:00Z', '--evidence', str(evidence)])
    assert result == 0
    receipt = json.loads(capsys.readouterr().out)
    assert receipt['review_id'] == store.review_evidence()[0]['review_id']
    assert store.review_evidence()[0]['evidence']['recommendation_id'] == 'R1'
