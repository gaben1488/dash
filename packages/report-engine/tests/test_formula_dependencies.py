from copy import deepcopy

import pytest
from procurement_engine.formula_dependencies import audit_formula_dependencies


def source(sid='master', sheet_id=0, title='Master', formulas=None):
    return {'source_id': sid, 'provider_id': 'book', 'sheet_id': sheet_id, 'sheet': title,
            'rows': 3, 'columns': 3, 'before': 'r1', 'after': 'r1',
            'formula_evidence': {'rows': 3, 'columns': 3, 'formulas': formulas or [],
                'sheets': [{'sheetId': 0, 'title': 'Master'}, {'sheetId': 1, 'title': 'Support'}],
                'named_ranges': [{'name': 'Customers', 'range': {'sheetId': 1}}]}}


def audit(sources):
    return audit_formula_dependencies({'sources': sources})


def test_local_formula_closure_accepts_native_math_and_quoted_text():
    s = source(formulas=[{'row': 1, 'column': 3, 'formula': '=IF(A1="IMPORTRANGE(test)";0;SUM(A2:B3))'}])
    assert audit([s])['closed'] is True


def test_absolute_references_are_local_cells_not_unknown_names():
    s = source(formulas=[{'row': 1, 'column': 3, 'formula': '=SUM($A$1:$B$3;A$1;$A1;$A:$C)'}])
    assert audit([s])['closed']


@pytest.mark.parametrize('formula', ['=ISBLANK(A1)', '=LOWER(A1)', '=SUBSTITUTE(A1;"a";"b")',
                                     '=SEARCH("a";A1)', '=COLUMNS(A1:C3)'])
def test_native_text_and_range_inspection_functions_are_local(formula):
    s = source(formulas=[{'row': 1, 'column': 3, 'formula': formula}])
    assert audit([s])['closed']


@pytest.mark.parametrize('formula', ['=IMPORTRANGE("url";"A1")', '=INDIRECT("Support!A1")',
                                     '=GOOGLEFINANCE("TEST")', '=CUSTOM_REMOTE(A1)'])
def test_unverified_external_or_dynamic_functions_block(formula):
    result = audit([source(formulas=[{'row': 1, 'column': 1, 'formula': formula}])])
    assert not result['closed']
    assert result['issues'][0]['code'] == 'FORMULA_FUNCTION_UNVERIFIED'


@pytest.mark.parametrize('formula', ['=SUM(Customers)', "=SUM('Support'!A1:B3)", '=SUM(Support!A1)'])
def test_dependencies_must_be_fully_captured(formula):
    master = source(formulas=[{'row': 1, 'column': 1, 'formula': formula}])
    assert not audit([master])['closed']
    support = source('support', 1, 'Support')
    result = audit([master, support])
    assert result['closed']
    assert result['edges'] == [{'from': 'master', 'to': 'support'}]


def test_support_formula_import_is_not_hidden_by_local_master_formula():
    master = source(formulas=[{'row': 1, 'column': 1, 'formula': '=SUM(Customers)'}])
    support = source('support', 1, 'Support', [{'row': 1, 'column': 1, 'formula': '=IMPORTDATA("url")'}])
    assert not audit([master, support])['closed']


def test_let_lambda_local_functions_do_not_require_external_review():
    s = source(formulas=[{'row': 1, 'column': 1,
                         'formula': '=LET(delta;LAMBDA(x;x-1);MAP(A1:A3;LAMBDA(v;delta(v))))'}])
    assert audit([s])['closed']


def test_missing_formula_evidence_and_unread_columns_are_not_proof():
    s = source()
    del s['formula_evidence']
    assert not audit([s])['closed']
    s = source()
    s['formula_evidence']['columns'] = 4
    assert not audit([s])['closed']


def test_formula_and_metadata_must_belong_to_one_book_version():
    first = source()
    second = source('support', 1, 'Support')
    second['formula_evidence'] = deepcopy(second['formula_evidence'])
    second['formula_evidence']['named_ranges'][0]['range']['sheetId'] = 2
    assert not audit([first, second])['closed']


def test_reference_to_unknown_sheet_cannot_pass_as_local():
    s = source(formulas=[{'row': 1, 'column': 1, 'formula': "='Renamed'!A1"}])
    assert not audit([s])['closed']


@pytest.mark.parametrize('formula', [
    '=SUM(LET(remote;LAMBDA(x;x);remote(A1));remote(A1))',
    '=MAP(A1:A3;REMOTE)',
    '=LET(x;REMOTE;x)',
    '=LET(x;remote(A1);remote;LAMBDA(v;v);x)',
    '=MAP(A1:A3;FUN)',
])
def test_local_declarations_do_not_whitelist_external_calls_or_bare_named_functions(formula):
    s = source(formulas=[{'row': 1, 'column': 1, 'formula': formula}])
    assert not audit([s])['closed']


@pytest.mark.parametrize('formula', ['=D1', '=A4', '=SUM(A1:D3)', '=SUM(A:C4)', '=SUM(A:D)'])
def test_local_reference_outside_captured_values_is_not_closed(formula):
    s = source(formulas=[{'row': 1, 'column': 1, 'formula': formula}])
    result = audit([s])
    assert not result['closed']
    assert any(i['code'] == 'FORMULA_DEPENDENCY_RANGE_NOT_CAPTURED' for i in result['issues'])


def test_dependency_sheet_must_cover_the_referenced_columns():
    s = source(formulas=[{'row': 1, 'column': 1, 'formula': '=SUM(Support!A1:D3)'}])
    result = audit([s, source('support', 1, 'Support')])
    assert not result['closed']
    assert any(i['code'] == 'FORMULA_DEPENDENCY_RANGE_NOT_CAPTURED' for i in result['issues'])


def test_named_range_cannot_extend_beyond_captured_values():
    s = source(formulas=[{'row': 1, 'column': 1, 'formula': '=SUM(Customers)'}])
    support = source('support', 1, 'Support')
    for item in (s, support):
        item['formula_evidence']['named_ranges'][0]['range']['endColumnIndex'] = 4
    assert not audit([s, support])['closed']


def allocated(sources):
    grids = [{'sheetId': s['sheet_id'], 'title': s['sheet'],
              'gridProperties': {'rowCount': s['rows'], 'columnCount': s['columns']}}
             for s in sources]
    for s in sources:
        s['formula_evidence']['sheets'] = deepcopy(grids)
    return sources


def test_whole_columns_intersect_the_verified_fully_read_allocated_grid():
    master = source(formulas=[{'row': 1, 'column': 1, 'formula': '=SUM(Support!$A:$Z)'}])
    support = source('support', 1, 'Support')
    assert audit(allocated([master, support]))['closed']


def test_allocated_columns_inside_the_formula_range_cannot_be_skipped():
    sources = allocated([source(formulas=[{'row': 1, 'column': 1,
                                         'formula': '=SUM(Support!A:Z)'}]),
                         source('support', 1, 'Support')])
    for s in sources:
        s['formula_evidence']['sheets'][1]['gridProperties']['columnCount'] = 4
    assert not audit(sources)['closed']


def test_absolute_whole_row_references_retain_target_sheet_and_row_bounds():
    master = source(formulas=[{'row': 1, 'column': 1, 'formula': '=SUM(Support!$4:$4)'}])
    assert not audit(allocated([master, source('support', 1, 'Support')]))['closed']


def test_bounded_missing_cells_still_block_with_allocated_metadata():
    s = source(formulas=[{'row': 1, 'column': 1, 'formula': '=SUM(A1:D3)'}])
    assert not audit(allocated([s]))['closed']


def test_absolute_whole_rows_use_dependency_rows_instead_of_local_rows():
    master = source(formulas=[{'row': 1, 'column': 1, 'formula': '=SUM(Support!$4:$4)'}])
    support = source('support', 1, 'Support')
    support['rows'] = support['formula_evidence']['rows'] = 5
    assert audit(allocated([master, support]))['closed']


@pytest.mark.parametrize('formula', ['=SUM(Support!D:F)', '=SUM(Support!$D:$D)'])
def test_whole_columns_starting_outside_allocated_grid_do_not_have_proven_coverage(formula):
    master = source(formulas=[{'row': 1, 'column': 1, 'formula': formula}])
    result = audit(allocated([master, source('support', 1, 'Support')]))
    assert not result['closed']
    assert any(issue['code'] == 'FORMULA_DEPENDENCY_RANGE_NOT_CAPTURED' for issue in result['issues'])
