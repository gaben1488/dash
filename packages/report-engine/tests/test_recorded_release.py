import json

import pytest
from docx import Document
from procurement_engine.publication_reader import read_publication
from procurement_engine.publication_store import PublicationError, PublicationStore
from procurement_engine.release_gates import validate_recorded_state_model
from procurement_engine.runtime import run_once
from test_runtime import Google, inputs


class CompleteGoogle(Google):
    def formula_context(self, provider):
        return {'sheets': [{'sheetId': 0, 'title': self.grid(provider, 0)['title']}], 'named_ranges': []}

    def formulas(self, provider, title, start, end, columns):
        return []


def test_real_runtime_can_publish_without_manual_context_or_forced_model(tmp_path):
    registry, ledger = inputs(tmp_path)
    state = tmp_path / 'state'
    result = run_once(registry, ledger, state, client=CompleteGoogle())
    assert result['status'] == 'VERIFIED'
    release_id = result['publication']['release_id']
    dashboard = json.loads(read_publication(state, 'dashboard', release_id))
    assert dashboard['snapshot_id'] == result['snapshot_id']
    assert dashboard['headline']['competitive']['year']['plan_count'] == 0
    assert read_publication(state, 'main', release_id).startswith(b'PK')
    assert read_publication(state, 'supplement', release_id).startswith(b'PK')


def test_complete_wider_grids_can_publish_both_documents(tmp_path):
    class Wide(CompleteGoogle):
        def grid(self, provider, sheet_id):
            value = super().grid(provider, sheet_id)
            value['gridProperties']['columnCount'] = 35
            return value

    registry, ledger = inputs(tmp_path)
    state = tmp_path / 'state'
    result = run_once(registry, ledger, state, client=Wide())
    assert result['status'] == 'VERIFIED'
    release_id = result['publication']['release_id']
    assert read_publication(state, 'main', release_id).startswith(b'PK')
    assert read_publication(state, 'supplement', release_id).startswith(b'PK')


def test_unlinked_recommendation_is_preserved_as_unknown_not_executed(tmp_path):
    registry, ledger = inputs(tmp_path)
    ledger.write_text(json.dumps([{
        'recommendation_id': 'REC-SYNTHETIC', 'grbs': 'УЭР', 'section': 'ep',
        'table_no': 1, 'row_no': 1, 'recommendation_text': 'Проверить способ закупки бумаги',
        'source_procurement_ids': ['42'], 'active_in_current_slice': True,
        'semantic_status': 'IMPLEMENTED_AND_COMPLETED', 'status_as_of': '01.01.2020',
        'uer_decision_original': 'Принята', 'historical_acceptance': True,
    }]))
    state = tmp_path / 'state'
    result = run_once(registry, ledger, state, client=CompleteGoogle())
    assert result['status'] == 'VERIFIED_WITH_WARNINGS'
    dashboard = json.loads(read_publication(state, 'dashboard', result['publication']['release_id']))
    rec = dashboard['recommendations']['tables']['1'][0]
    assert rec['semantic_status'] == 'REVIEW_REQUIRED'
    assert rec['current_procurement_state'] == 'UNKNOWN'
    assert rec['missing_business_ids'] == ['42']
    assert '42' in rec['status_evidence']
    assert dashboard['recommendations']['implemented_and_completed'] == 0
    assert any(x['code'] == 'RECOMMENDATION_LINK_UNCONFIRMED' for x in dashboard['issues'])


def test_bad_source_after_real_success_preserves_previous_release(tmp_path):
    registry, ledger = inputs(tmp_path)
    state = tmp_path / 'state'
    good = run_once(registry, ledger, state, client=CompleteGoogle())
    assert good['status'] == 'VERIFIED'
    failed = run_once(registry, ledger, state, client=Google())
    assert failed['status'] == 'NOT_ISSUED'
    status = json.loads(read_publication(state, 'status'))
    assert status['latest']['release_id'] == good['publication']['release_id']


def test_unchanged_scheduled_read_reuses_release_instead_of_republishing_new_timestamp(tmp_path):
    registry, ledger = inputs(tmp_path)
    state = tmp_path / 'state'
    first = run_once(registry, ledger, state, client=CompleteGoogle())
    second = run_once(registry, ledger, state, client=CompleteGoogle())
    assert first['status'] == second['status'] == 'VERIFIED'
    assert second['publication'] == first['publication']
    assert second['reused_publication'] is True
    assert len(PublicationStore(state / 'published').history()) == 1
    assert not (state / 'attempts' / second['attempt_id'] / 'capture.json').exists()


@pytest.mark.parametrize('damage,expected', [
    ('section', 'REQUIRED_REPORT_SECTION_MISSING'),
    ('identity', 'PERSISTENT_IDENTITY_NOT_INTEGRATED'),
    ('audit', 'INDEPENDENT_AUDIT_FAILED'),
    ('qa', 'SOURCE_QA_ERRORS'),
    ('overlay', 'RECORDED_STATE_SEMANTICS_CHANGED'),
])
def test_mandatory_failures_never_become_warnings(tmp_path, damage, expected):
    registry, ledger = inputs(tmp_path)
    state = tmp_path / 'state'
    result = run_once(registry, ledger, state, client=CompleteGoogle())
    bundle = state / 'attempts' / result['attempt_id'] / 'bundle'
    model = json.loads((bundle / 'report_model.json').read_text())
    if damage == 'section':
        model.pop('future_plan')
    elif damage == 'identity':
        model['identity_observations'] = None
    elif damage == 'audit':
        model['independent_audit']['pass'] = False
    elif damage == 'qa':
        model['issues'].append({'severity': 'ERROR', 'code': 'BROKEN_DATE'})
    else:
        model['metric_semantics']['procedure_overlay_applied'] = True
    assert expected in {x.code for x in validate_recorded_state_model(model, ledger=[])}


def test_empty_required_sections_and_fact_meaning_remain_explicit_in_both_documents(tmp_path):
    registry, ledger = inputs(tmp_path)
    state = tmp_path / 'state'
    result = run_once(registry, ledger, state, client=CompleteGoogle())
    bundle = state / 'attempts' / result['attempt_id'] / 'bundle'
    for name in ['main_report.docx', 'management_report.docx']:
        text = '\n'.join(p.text for p in Document(bundle / name).paragraphs)
        assert 'число договоров' in text
        assert 'ЗАКУПКИ БУДУЩЕГО ПЕРИОДА' in text
        assert 'В зарегистрированных источниках записи не обнаружены.' in text
        assert 'Денежные показатели' in text
        assert 'Отклонение факт минус план' in text
        assert 'Подтверждённая экономия' in text


def test_publisher_rechecks_domain_contract_even_with_matching_document_hashes(tmp_path):
    from procurement_engine.docx_renderer import (
        render_main_docx,
        render_management_docx,
    )
    from procurement_engine.projections import project_dashboard

    registry, ledger = inputs(tmp_path)
    state = tmp_path / 'state'
    result = run_once(registry, ledger, state, client=CompleteGoogle())
    bundle = state / 'attempts' / result['attempt_id'] / 'bundle'
    model = json.loads((bundle / 'report_model.json').read_text())
    model.pop('future_plan')
    (bundle / 'report_model.json').write_text(json.dumps(model))
    (bundle / 'dashboard.json').write_text(json.dumps(project_dashboard(model)))
    render_main_docx(model, bundle / 'main_report.docx')
    render_management_docx(model, bundle / 'management_report.docx')
    versions = json.loads((bundle / 'snapshot_bundle/bundle.json').read_text())['after']
    other = PublicationStore(tmp_path / 'other')
    with pytest.raises(PublicationError, match='DOMAIN_RELEASE_CONTRACT_FAILED'):
        other.publish(bundle, read_revisions=lambda: versions)
    assert other.latest() is None
