"""End-to-end regressions: ordinary edits and visible assurance are one frozen release."""
import json
from copy import deepcopy
from datetime import datetime
from zoneinfo import ZoneInfo

import pytest
from procurement_engine.publication_reader import read_publication
from procurement_engine.release_gates import validate_recorded_state_model
from procurement_engine.runtime import run_once
from test_business_document_contract import build_case, publish, rewrite
from test_forensic_qa import rawrow
from test_recorded_release import CompleteGoogle
from test_runtime import inputs


def test_price_and_context_update_without_fact_survives_real_publication(tmp_path):
    registry, ledger = inputs(tmp_path); now = datetime.now(ZoneInfo('Asia/Kamchatka'))
    class Data(CompleteGoogle):
        def __init__(self, amount, comment): self.amount, self.comment = amount, comment
        def revision(self, provider): return str(self.amount)
        def grid(self, provider, sheet_id):
            result = super().grid(provider, sheet_id)
            if provider == 'master-0': result['gridProperties']['rowCount'] = 4
            return result
        def values(self, provider, title, start, end, columns):
            rows = [[], [], ['Synthetic header']]
            if provider == 'master-0':
                row = rawrow('42', subject='Синтетическая бумага', fact_date='', plan=(0, 0, self.amount))
                row[13:16] = [f'01.{now.month:02d}.{now.year}', (now.month-1)//3+1, now.year]
                row[2]='Синтетическая школа'; row[5]='Поставка'; row[12]=self.comment; row[29]='нет'
                rows.append(row)
            return rows[start-1:end]
    state = tmp_path / 'state'
    first=run_once(registry, ledger, state, client=Data(10, 'Первое пояснение.'))
    assert first['status']=='VERIFIED'
    original=read_publication(state, 'main', first['publication']['release_id'])
    old=json.loads(read_publication(state, 'dashboard', first['publication']['release_id']))
    second=run_once(registry, ledger, state, client=Data(20, 'Закупка отложена: финансирование отсутствует.'))
    assert second['status']=='VERIFIED'
    new=json.loads(read_publication(state, 'dashboard', second['publication']['release_id']))
    assert old['details'][0]['procurement_uid']==new['details'][0]['procurement_uid']
    assert new['headline']['single_supplier']['year']['plan_amount']==20
    assert new['headline']['single_supplier']['year']['fact_count']==0
    assert new['automation_assurance']['user_action_count']==0
    assert new['automation_assurance']['engine_action_count']==0
    assert read_publication(state, 'main', first['publication']['release_id'])==original
    assert second['publication']['automation_assurance']==new['automation_assurance']


def test_source_error_cannot_have_full_automation_label():
    from procurement_engine.automation_assurance import assess_automation
    result=assess_automation({'issues':[{'severity':'ERROR','code':'FUTURE_UNHANDLED_VALIDATION'}]})
    assert not result['fully_automated']
    assert result['engine_action_count']==1
    assert not result['actions'][0]['user_action_required']


def test_date_error_action_has_source_coordinates_not_just_an_english_code():
    from procurement_engine.automation_assurance import assess_automation
    result=assess_automation({'issues':[{'severity':'ERROR','code':'INVALID_PLAN_DATE',
        'context':{'source_id':'book','sheet':'ВСЕ','row':17,'grbs':'УЭР','row_key':'key'}}]},
        [{'provider_id':'book','sheet':'ВСЕ','sheet_id':0}])
    action=result['actions'][0]
    assert action['locations'][0]['a1']=='N17'
    assert action['severity']=='blocks_release'
    assert action['user_action_required']
    assert 'существующую календарную дату' in action['action']


@pytest.mark.parametrize('field', ['automation_assurance', 'document_content', 'trace_catalog'])
def test_current_renderer_cannot_drop_mandatory_contract(tmp_path, field):
    model, _, _=build_case(tmp_path)
    model['contract'].pop(field+'_contract')
    codes={x.code for x in validate_recorded_state_model(model, ledger=[])}
    assert {'AUTOMATION_ASSURANCE_MISSING', 'BUSINESS_DOCUMENT_CONTRACT_MISSING'} & codes


def test_forged_all_clear_assurance_is_rejected_even_with_regenerated_documents(tmp_path):
    model, root, _=build_case(tmp_path, ledger=[{'recommendation_id':'R', 'grbs':'УЭР',
        'table_no':1,'row_no':1,'recommendation_text':'Неопознанная рекомендация.',
        'active_in_current_slice':True,'source_procurement_ids':['42']}])
    bad=deepcopy(model)
    bad['automation_assurance'].update(fully_automated=True, actions=[], engine_action_count=0, user_action_count=0)
    rewrite(root, bad)
    with pytest.raises(ValueError):
        publish(root)
