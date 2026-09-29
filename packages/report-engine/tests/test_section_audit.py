import json
from copy import deepcopy

import pytest
from procurement_engine.release_gates import validate_recorded_state_model
from procurement_engine.runtime import run_once
from test_recorded_release import CompleteGoogle
from test_runtime import inputs


@pytest.mark.parametrize('field', ['recommendations_by_grbs', 'recommendation_tables_by_grbs', 'renderer_tables'])
def test_mutated_renderer_recommendations_are_rejected(tmp_path, field):
    registry, ledger = inputs(tmp_path)
    ledger.write_text(json.dumps([{'recommendation_id':'R1','grbs':'УЭР','section':'ep','table_no':1,'row_no':1,
        'recommendation_text':'Исходная рекомендация','grbs_response_original':'Исходный ответ',
        'uer_decision_original':'Историческое решение','source_procurement_ids':['42'],'active_in_current_slice':True}]))
    state=tmp_path/'state'; result=run_once(registry,ledger,state,client=CompleteGoogle())
    assert result['status']=='VERIFIED_WITH_WARNINGS'
    model=json.loads((state/'attempts'/result['attempt_id']/'bundle/report_model.json').read_text())
    if field=='renderer_tables':
        model['recommendations']['renderer_tables']['1'][0]['recommendation']='Подмена'
    elif field=='recommendations_by_grbs':
        model[field]['УЭР'][0]['recommendation']='Подмена'
    else:
        model[field]['УЭР'][0]['rows'][0]['recommendation']='Подмена'
    assert 'RECOMMENDATION_PROJECTION_MISMATCH' in {x.code for x in validate_recorded_state_model(model,ledger=json.loads(ledger.read_text()))}


def test_source_sections_detect_lost_future_and_active_rows():
    from procurement_engine.raw_pipeline import future_rows
    from procurement_engine.section_audit import audit_source_sections
    from test_procedure_clock import master, queue

    future=['']*34;future[6]='Future item';future[7]=100;future[13]='01.02.2027';future[15]=2027
    row=master('ЭА1-26','Объявлена')
    source={'role':'master','provider_id':'s','sheet':'ВСЕ','sheet_id':0,'grbs':'УЭР','values':[[],[],[],future]}
    q={'role':'procedure','provider_id':'p','sheet':'Процедуры в работе','values':[queue(row)]}
    capture={'report_date':'30.09.2026','report_year':2026,'sources':[source,q,{'sheet':'Рабочий реестр процедур','values':[row]}]}
    active={'procedure_code':'ЭА1-26','stage':'Объявлена','subject':'Synthetic subject','action':'Действие',
            'deadline':'2026-09-30','source_ref':'p::Процедуры в работе::1'}
    model={'future_plan':future_rows([source],2027),'procedures':[active],'active_procedures_count':1,
           'closed_procedure_quality':[],'management_summary':{'procedure_rows':[active],'procedure_count':1}}
    assert audit_source_sections(capture,model)==[]
    bad=deepcopy(model);bad['future_plan']['rows']=[]
    assert 'future_plan' in audit_source_sections(capture,bad)
    bad=deepcopy(model);bad['procedures']=[]
    assert 'procedures' in audit_source_sections(capture,bad)
    bad=deepcopy(model);bad['management_summary']['procedure_rows']=[]
    assert 'management_summary.procedure_rows' in audit_source_sections(capture,bad)


def test_publisher_rejects_future_section_mutation_after_coherent_rerender(tmp_path):
    from procurement_engine.docx_renderer import (
        render_main_docx,
        render_management_docx,
    )
    from procurement_engine.projections import project_dashboard
    from procurement_engine.publication_store import PublicationError, PublicationStore

    registry,ledger=inputs(tmp_path);state=tmp_path/'state'
    result=run_once(registry,ledger,state,client=CompleteGoogle())
    bundle=state/'attempts'/result['attempt_id']/'bundle'
    model=json.loads((bundle/'report_model.json').read_text())
    model['future_plan']['target_year']+=1
    (bundle/'report_model.json').write_text(json.dumps(model))
    (bundle/'dashboard.json').write_text(json.dumps(project_dashboard(model)))
    render_main_docx(model,bundle/'main_report.docx')
    render_management_docx(model,bundle/'management_report.docx')
    versions=json.loads((bundle/'snapshot_bundle/bundle.json').read_text())['after']
    with pytest.raises(PublicationError,match='SAVED_SOURCE_RECHECK_FAILED'):
        PublicationStore(tmp_path/'other').publish(bundle,read_revisions=lambda:versions)


@pytest.mark.parametrize('year', [0, 'X', 'х', '—'])
def test_future_audit_accepts_legacy_missing_year_markers(year):
    from procurement_engine.raw_pipeline import future_rows
    from procurement_engine.section_audit import _future_population

    row=['']*34;row[6]='Future item';row[7]=100;row[15]=year
    row[30]='поставили в план на 2027 год'
    source={'role':'master','provider_id':'s','sheet':'ВСЕ','sheet_id':0,'grbs':'УЭР','values':[[],[],[],row]}
    assert _future_population({'report_year':2026,'sources':[source]})==future_rows([source],2027)


@pytest.mark.parametrize('field', ['semantic_status_ru', 'status_evidence', 'current_observations'])
def test_source_replay_rejects_coherent_recommendation_claim_mutation(tmp_path, field):
    from procurement_engine.section_audit import audit_source_sections

    registry, ledger=inputs(tmp_path)
    ledger.write_text(json.dumps([{'recommendation_id':'R1','grbs':'УЭР','section':'ep','table_no':1,'row_no':1,
        'recommendation_text':'Исходная рекомендация','source_procurement_ids':['42'],'active_in_current_slice':True}]))
    state=tmp_path/'state';result=run_once(registry,ledger,state,client=CompleteGoogle())
    bundle=state/'attempts'/result['attempt_id']/'bundle'
    model=json.loads((bundle/'report_model.json').read_text())
    index=json.loads((bundle/'snapshot_bundle/manifest.json').read_text())
    capture={'report_date':model['snapshot']['report_date'],'report_year':2026,'sources':[]}
    for item in index['payload_index']:
        p=json.loads((bundle/'snapshot_bundle'/item['path']).read_text());m=p.get('metadata') or {}
        if 'sheet_title' in m:
            capture['sources'].append({'role':p['role'],'provider_id':p['provider_id'],'sheet':m['sheet_title'],
                'sheet_id':int(p['sheet_or_tab_id']),'grbs':m.get('grbs'),'values':p['semantic_values']})
    model['recommendations']['tables']['1'][0][field]='ИСПОЛНЕНО И ОПЛАЧЕНО'
    assert 'recommendation_evidence' in audit_source_sections(capture,model,ledger=json.loads(ledger.read_text()))


@pytest.mark.parametrize('field', ['competitive_remaining_by_grbs','single_supplier_remaining_by_grbs',
    'recommendation_compliance_counts','recommendation_execution_counts','recommendation_evidence_quality_counts'])
def test_management_projection_mutation_is_rejected(tmp_path,field):
    registry,ledger=inputs(tmp_path);state=tmp_path/'state'
    result=run_once(registry,ledger,state,client=CompleteGoogle())
    model=json.loads((state/'attempts'/result['attempt_id']/'bundle/report_model.json').read_text())
    model['management_summary'][field]=[{'grbs':'УЭР','remain_count':999,'remain_amount':999}] if field.endswith('_by_grbs') else {'Исполнено и оплачено':999}
    assert 'MANAGEMENT_PROJECTION_MISMATCH' in {x.code for x in validate_recorded_state_model(model,ledger=json.loads(ledger.read_text()))}
