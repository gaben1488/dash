from procurement_engine.publication_history import compare_published_models


def model(*, quarter=3, year=2026, rules='rules', plan='100.10'):
    return {'snapshot': {'snapshot_id': 'SNP', 'report_date': '30.09.2026', 'report_year': year, 'rules_version': rules},
            'headline': {'current_quarter': quarter}, 'exact_metrics': {
                kind: {period: {'plan_count': 2, 'fact_count': 1, 'remain_count': 1,
                               'exact_decimal': {'plan_amount': plan, 'fact_amount': '80.01', 'remain_amount': '20.09'}}
                       for period in ('year', 'quarter')}
                for kind in ('competitive', 'single_supplier')}}


def test_comparison_uses_exact_saved_amounts_and_never_calls_changes_events():
    result = compare_published_models(model(plan='100.30'), model())
    assert result['status'] == 'COMPARABLE'
    change = next(x for x in result['changes'] if x['kind'] == 'competitive' and x['period'] == 'year')
    assert change['field'] == 'plan_amount' and change['delta'] == '0.20'
    assert 'event_type' not in change


def test_quarter_rollover_does_not_compare_different_planned_cohorts():
    result = compare_published_models(model(quarter=4, plan='120.10'), model())
    assert result['compared_periods'] == ['year']
    assert all(x['period'] == 'year' for x in result['changes'])


def test_rules_year_and_first_release_have_explicit_noncomparison_reason():
    assert compare_published_models(model(), None)['status'] == 'FIRST_RELEASE'
    assert compare_published_models(model(rules='new'), model())['status'] == 'RULES_CHANGED'
    assert compare_published_models(model(year=2027), model())['status'] == 'REPORT_YEAR_CHANGED'
