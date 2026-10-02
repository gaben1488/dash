"""No completion-driven loss of data and no bulk repetition of completed history."""
from copy import deepcopy

import pytest
from procurement_engine.context_presentation import group_context


def entry(number, *, year=2034, fact=None, text='Финансирование отсутствует'):
    key = f'source::ВСЕ::{number}'
    return {'source_row_key': key, 'business_id': str(number), 'grbs': 'УЭР',
        'subject': 'Поставка бумаги', 'planned_year': year, 'actual_date': fact,
        'planned_date': '2034-09-01', 'method': 'ЕП',
        'explanations': [{'field': 'grbs_comment', 'column': 'AF', 'label': 'Комментарий ГРБС',
            'text': text, 'source_row_key': key, 'visibility': 'business'}]}


def test_full_context_is_preserved_but_completed_rows_are_not_bulk_copied():
    raw = [entry(1), entry(2, fact='2034-09-25'), entry(3, year=2035), entry(4, year=2033)]
    unchanged = deepcopy(raw)
    groups = group_context(raw, year=2034, as_of='28.09.2034')
    assert [member['business_id'] for group in groups for member in group['members']] == ['1', '3']
    assert raw == unchanged


def test_fact_after_cutoff_does_not_hide_pending_context():
    assert group_context([entry(1, fact='2034-09-30')], year=2034, as_of='28.09.2034')


def test_identical_context_retains_every_members_provenance():
    raw = [entry(1), entry(2), entry(3, text='Финансирование выделено')]
    groups = group_context(raw, year=2034, as_of='28.09.2034')
    assert len(groups) == 2
    assert groups[0]['explanations'][0]['source_row_keys'] == ['source::ВСЕ::1', 'source::ВСЕ::2']
    assert [m['business_id'] for m in groups[0]['members']] == ['1', '2']
    assert groups[1]['explanations'][0]['text'] == 'Финансирование выделено'


def test_a_fabricated_group_or_missing_member_is_rejected(tmp_path):
    from procurement_engine.publication_store import PublicationError
    from procurement_engine.section_audit import audit_context
    from test_business_document_contract import build_case, publish, rewrite
    from test_forensic_qa import rawrow
    raw = rawrow('42', subject='Поставка бумаги', fact_date='', plan=(0, 0, 46))
    raw[29] = 'нет'; raw[31] = 'Финансирование отсутствует'
    model, root, capture = build_case(tmp_path, raw=raw)
    model['source_context_groups'][0]['explanations'][0]['source_row_keys'] = []
    assert not audit_context(capture, model)
    rewrite(root, model)
    with pytest.raises(PublicationError):
        publish(root)
