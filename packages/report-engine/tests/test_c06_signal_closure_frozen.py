"""C06.01: historical decisions are frozen, not recovered from today's status."""
from procurement_engine.narrative import build_smart_narrative, is_current_issue
from procurement_engine.document_plan import DocumentPlan, _add_data_notices


def _report():
    block = {'plan_count': 1, 'fact_count': 0, 'remain_count': 1,
             'plan_amount': 12.0, 'fact_amount': 0.0, 'remain_amount': 12.0,
             'execution_pct': 0.0}
    return {
        'snapshot': {'snapshot_id': 'frozen-1', 'rules_version': 'v1', 'renderer_version': 'v1'},
        'headline': {'current_quarter': 1, 'competitive': {'year': block, 'quarter': block},
                     'single_supplier': {'year': block, 'quarter': block}},
    }


def test_only_explicit_false_positive_excluded_from_risk():
    assert is_current_issue({'severity': 'HIGH'})
    for state in ('open', 'resolved', 'wont_fix'):
        assert is_current_issue({'severity': 'HIGH', 'status': state})
    assert not is_current_issue({'severity': 'HIGH', 'status': 'false_positive'})


def test_frozen_smart_narrative_honours_case_decision_and_keeps_evidence():
    model = _report()
    dismissed = [{'id': 'dismissed-1', 'severity': 'HIGH', 'status': 'false_positive'}]
    blocks = build_smart_narrative(model, issues=dismissed)
    assert not any(x.block_id == 'nar.judge.release-risk' for x in blocks)
    assert dismissed[0]['status'] == 'false_positive'
    for status in ('resolved', 'wont_fix', None):
        blocks = build_smart_narrative(model, issues=[{'id':'live-1','severity':'HIGH','status':status}])
        risk = [x for x in blocks if x.block_id == 'nar.judge.release-risk']
        assert len(risk) == 1
        assert risk[0].trace.issue_ids == ('live-1',)


def test_frozen_word_notice_excludes_false_positive_but_keeps_case_history():
    old = {'code':'MONETARY_FACT_WITHOUT_COMPLETION_DATE','severity':'WARN',
           'context':{'grbs':'УО','row_key':'UO!4','procurement_id':'173/18'},'status':'false_positive'}
    current = {'code':'MONETARY_FACT_WITHOUT_COMPLETION_DATE','severity':'WARN',
               'context':{'grbs':'УО','row_key':'UO!5','procurement_id':'173/19'},'status':'resolved'}
    model={'snapshot':{'snapshot_id':'frozen-1'},'issues':[old,current],
           'details':[{'physical_row_key':'UO!4','subject':'Снятый сигнал'},
                      {'physical_row_key':'UO!5','subject':'Требует повторной проверки'}]}
    doc=DocumentPlan(model,'main','GENERIC_TEMPLATE')
    _add_data_notices(doc,doc.model)
    words=' '.join(str(b.get('text') or '') for b in doc.blocks)
    assert 'Снятый сигнал' not in words
    assert 'Требует повторной проверки' in words
    assert len(doc.model['issues']) == 2
