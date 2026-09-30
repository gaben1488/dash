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
        assert 'число договоров' not in text  # Methodology remains in the diagnostic protocol.
        assert 'позици' in text
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


def test_legacy_verified_bundle_remains_readable_after_recommendation_upgrade(tmp_path):
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
    model.pop('identity_review_evidence')
    for key in ('recommendation_compliance_counts', 'recommendation_execution_counts',
                'recommendation_evidence_quality_counts'):
        model['management_summary'][key] = {'Не подтверждено': 0}
    (bundle / 'report_model.json').write_text(json.dumps(model))
    (bundle / 'dashboard.json').write_text(json.dumps(project_dashboard(model)))
    render_main_docx(model, bundle / 'main_report.docx')
    render_management_docx(model, bundle / 'management_report.docx')
    versions = json.loads((bundle / 'snapshot_bundle/bundle.json').read_text())['after']
    receipt = PublicationStore(tmp_path / 'legacy').publish(bundle, read_revisions=lambda: versions)
    assert receipt['status'] == 'VERIFIED'


def test_runtime_freezes_original_history_and_publishes_confirmed_link_with_unknown_fulfillment(tmp_path):
    from test_recommendation_history import fixture

    history, package, _ = fixture()
    history[0].update(active_in_current_slice=True, section='ep', table_no=1, row_no=1, source_procurement_ids=['42'])
    metadata = {'id': 'synthetic-history', 'name': 'aemr-report-recommendation-history-v1.json',
                'mimeType': 'application/json', 'version': '1', 'modifiedTime': '2026-09-25T00:00:00Z'}
    class HistoricalGoogle(CompleteGoogle):
        def _get(self, url, params):
            if url.endswith('/files'):
                return {'files': [metadata]}
            return package if params.get('alt') == 'media' else metadata
        def grid(self, provider, sheet_id):
            value = super().grid(provider, sheet_id)
            if provider == 'master-0': value['gridProperties']['rowCount'] = 4
            return value
        def values(self, provider, title, start, end, columns):
            values = [[], [], ['Synthetic header']]
            if provider == 'master-0':
                r = [''] * 34
                for index, value in {0: '42', 1: 'УЭР', 2: 'Synthetic customer', 5: 'Текущая деятельность',
                    6: 'Поставка бумаги', 7: 0, 8: 0, 9: 46, 10: 46, 11: 'ЕП',
                    13: '30.09.2026', 14: 3, 15: 2026}.items(): r[index] = value
                values.append(r)
            return values[start - 1:end]
    registry, ledger = inputs(tmp_path); ledger.write_text(json.dumps(history))
    state = tmp_path / 'state'; result = run_once(registry, ledger, state, client=HistoricalGoogle())
    assert result['status'] == 'VERIFIED_WITH_WARNINGS', result
    assert result['automation_assurance']['engine_action_count'] == 1
    dashboard = json.loads(read_publication(state, 'dashboard', result['publication']['release_id']))
    rec = dashboard['recommendations']['tables']['1'][0]
    assert rec['current_link']['status'] == 'CONFIRMED'
    assert rec['current_link']['fulfillment'] == 'UNKNOWN'
    assert rec['semantic_status'] == 'ACTION_REVIEW_REQUIRED'
    bundle = state / 'attempts' / result['attempt_id'] / 'bundle' / 'snapshot_bundle'
    frozen = json.loads((bundle / 'payloads/RECOMMENDATION_HISTORY_EVIDENCE.json').read_text())
    assert frozen['semantic_values']['package'] == package
    assert json.loads(ledger.read_text()) == history
    model = json.loads((bundle.parent / 'report_model.json').read_text())
    assert model['recommendations_v2']['review_required_ids'] == []
    assert model['management_summary']['recommendation_evidence_quality_counts'] == {'Связь подтверждена': 1}
    # A coherent rewrite of every projection must not invent persistent identity.
    from procurement_engine.diagnostics import project_diagnostics
    from procurement_engine.docx_renderer import (
        render_main_docx,
        render_management_docx,
    )
    from procurement_engine.projections import project_dashboard

    uid = rec['current_link']['procurement_uids'][0]
    forged = json.loads(json.dumps(model).replace(uid, 'PUR-forged-not-in-identity-db'))
    (bundle.parent / 'report_model.json').write_text(json.dumps(forged))
    (bundle.parent / 'dashboard.json').write_text(json.dumps(project_dashboard(forged)))
    (bundle.parent / 'diagnostic_protocol.json').write_text(json.dumps(project_diagnostics(forged)))
    render_main_docx(forged, bundle.parent / 'main_report.docx')
    render_management_docx(forged, bundle.parent / 'management_report.docx')
    revisions = json.loads((bundle / 'bundle.json').read_text())['after']
    with pytest.raises(PublicationError, match='IDENTITY_BACKUP_MODEL_MISMATCH'):
        PublicationStore(tmp_path / 'forged').publish(bundle.parent, read_revisions=lambda: revisions)


def test_rc7_release_contract_does_not_require_new_rc8_sections(tmp_path):
    from procurement_engine.release_gates import validate_recorded_state_model

    registry, ledger = inputs(tmp_path)
    state = tmp_path / 'state'
    result = run_once(registry, ledger, state, client=CompleteGoogle())
    bundle = state / 'attempts' / result['attempt_id'] / 'bundle'
    model = json.loads((bundle / 'report_model.json').read_text())
    model['snapshot']['renderer_version'] = 'renderer-v1.5.0rc7'
    model['contract'].pop('recommendation_link_contract')
    model.pop('report_content')
    model.pop('recommendation_records')
    codes = {issue.code for issue in validate_recorded_state_model(model, ledger=[])}
    assert 'REQUIRED_REPORT_SECTION_MISSING' not in codes
    model['snapshot']['renderer_version'] = 'renderer-v1.5.0rc8'
    codes = {issue.code for issue in validate_recorded_state_model(model, ledger=[])}
    assert 'REQUIRED_REPORT_SECTION_MISSING' in codes
