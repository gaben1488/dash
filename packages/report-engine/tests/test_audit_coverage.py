"""Financial display mutations must not survive an otherwise coherent bundle."""
import json
from copy import deepcopy

import pytest
from procurement_engine.docx_renderer import (
    render_main_docx,
    render_management_docx,
    render_operational_docx,
)
from procurement_engine.google_adapter import capture_google
from procurement_engine.identity_store import IdentityStore
from procurement_engine.independent_audit import audit_model
from procurement_engine.projections import project_dashboard
from procurement_engine.publication_store import PublicationError, PublicationStore
from procurement_engine.raw_pipeline import build_from_capture
from test_forensic_qa import rawrow
from test_recorded_release import CompleteGoogle
from test_runtime import inputs


@pytest.fixture
def financial_bundle(tmp_path):
    registry_path, _ = inputs(tmp_path)
    registry = json.loads(registry_path.read_text())
    capture = capture_google(registry, CompleteGoogle())
    capture.update(report_date='30.09.2026', report_year=2026,
                   captured_at='2026-09-30T00:00:00+00:00')
    # One completed September position and one outstanding February position.
    # Planned-year count=2, fact count=1, money=300.3/80.1; Q3 count=1/1.
    source = next(s for s in capture['sources'] if s.get('grbs') == 'УЭР')
    source['values'].extend([
        rawrow('1', subject='Synthetic paper', plan=(0, 0, 100.1),
               fact_date='25.09.2026', fact=(0, 0, 80.1)),
        rawrow('2', subject='Synthetic furniture', plan_date='15.02.2026', q=1,
               plan=(0, 0, 200.2), fact_date='', fact=(0, 0, 0)),
    ])
    source['rows'] = len(source['values'])
    source['formula_evidence']['rows'] = source['rows']
    root = tmp_path / 'candidate'
    model = build_from_capture(capture, registry, [], root, render_docx=False,
                               identity_store=IdentityStore(tmp_path / 'identities.sqlite'))
    assert model['release']['official_release_allowed'], model['release']['blockers']
    assert model['grbs_metrics']['УЭР']['ep']['year']['plan_count'] == 2
    assert model['exact_metrics']['single_supplier']['year']['exact_decimal']['plan_amount'] == '300.3'
    assert model['calendar_fact']['recorded_position_count'] == 1
    return capture, model, root


@pytest.mark.parametrize('path,value', [
    ('grbs_metrics.УЭР.ep.year.plan_count', 999),
    ('grbs_metrics.УЭР.ep.q1.plan_amount', 999.0),
    ('grbs_metrics.УЭР.ep.year.execution_pct', 99.0),
    ('global_quarters.ep.q1.plan_amount', 999.0),
    ('global_quarters.ep.year.execution_pct', 99.0),
    ('exact_metrics.single_supplier.year.plan_amount', 999.0),
    ('exact_metrics.single_supplier.year.exact_decimal.plan_amount', '999'),
    ('exact_metrics.single_supplier.year.contracted_share_pct', 999.0),
    ('exact_metrics.single_supplier.year.exact_decimal.contracted_share_pct', '999'),
    ('exact_metrics.single_supplier.year.execution_pct', 99.0),
    ('headline.single_supplier.year.execution_pct', 99.0),
    ('exact_metrics.competitive.year.contracted_share_pct', 0.0),
    ('calendar_fact.recorded_position_count', 999),
    ('calendar_fact.amount_thousand', 999.0),
])
def test_independent_audit_rejects_display_and_group_mutations(financial_bundle, path, value):
    capture, original, _ = financial_bundle
    model = deepcopy(original)
    target = model
    parts = path.split('.')
    for part in parts[:-1]:
        target = target[part]
    target[parts[-1]] = value
    result = audit_model(capture, model)
    assert result['pass'] is False, path
    assert result['failures']


def test_valid_plan_date_with_missing_derived_year_cannot_be_released(financial_bundle, tmp_path):
    capture, _, _ = financial_bundle
    source = next(s for s in capture['sources'] if s.get('grbs') == 'УЭР')
    source['values'][-1][15] = None
    registry_path, _ = inputs(tmp_path)
    model = build_from_capture(capture, json.loads(registry_path.read_text()), [], tmp_path / 'missing-year',
                               render_docx=False, identity_store=IdentityStore(tmp_path / 'missing-year.sqlite'))
    assert not model['release']['official_release_allowed']
    assert any(issue['code'] == 'PLAN_YEAR_DATE_MISMATCH' and issue['severity'] == 'ERROR'
               for issue in model['issues'])


def test_strengthened_checks_do_not_reuse_prior_success_for_same_capture(financial_bundle, tmp_path):
    from procurement_engine.raw_pipeline import bundle_from_capture
    from procurement_engine.rule_catalog import DEFAULT_RULE_CATALOG
    from procurement_engine.snapshot import _snapshot_id

    capture, _, _ = financial_bundle
    registry_path, _ = inputs(tmp_path)
    manifest = bundle_from_capture(capture, json.loads(registry_path.read_text())).manifest
    prior_rules = DEFAULT_RULE_CATALOG.version + (
        '+raw-v1.5.0rc25+reviewed-actions-v1verified-original-links-v1+grid-coverage-v1'
        '+archive-scope-v1+weekly-evidence-v1+source-values-v2')
    prior_id = _snapshot_id(report_date=capture['report_date'], report_year=capture['report_year'],
                           sources=manifest['sources'], rules_version=prior_rules,
                           renderer_version=manifest['renderer_version'], mode='CANONICAL')
    assert manifest['snapshot_id'] != prior_id


@pytest.mark.parametrize('field', [
    'plan_amount', 'fact_amount', 'remain_amount', 'monetary_fact_amount',
    'confirmed_saving_amount', 'partial_fact_without_completion_amount',
    *(prefix + '_' + budget + '_amount' for prefix in ('plan', 'fact', 'remain') for budget in ('fb', 'kb', 'mb')),
    'deviation_amount', 'contracted_share_pct',
])
def test_monthly_money_is_recounted_from_source_even_with_matching_decimal(financial_bundle, field):
    capture, original, _ = financial_bundle
    model = deepcopy(original)
    month = next(m for m in model['monthly'] if m['grbs'] == 'УЭР' and m['method'] == 'ЕП' and m['month'] == 9)
    month[field] = 999999.0
    month['exact_decimal'][field] = '999999'
    result = audit_model(capture, model)
    assert result['pass'] is False
    assert any(failure['path'].startswith('monthly.') for failure in result['failures'])


@pytest.mark.parametrize('mutation', ['duplicate', 'missing', 'contributors'])
def test_monthly_population_is_checked_not_only_annual_sums(financial_bundle, mutation):
    capture, original, _ = financial_bundle
    model = deepcopy(original)
    if mutation == 'duplicate':
        model['monthly'].append(deepcopy(model['monthly'][0]))
    elif mutation == 'missing':
        model['monthly'].pop(0)
    else:
        next(m for m in model['monthly'] if m['plan_count'])['contributors'] = []
    assert audit_model(capture, model)['pass'] is False


@pytest.mark.parametrize('corruption', ['grbs_total', 'monthly_amount'])
def test_publisher_rejects_wrong_money_after_matching_render_and_hashes(financial_bundle, tmp_path, corruption):
    _, model, root = financial_bundle
    if corruption == 'grbs_total':
        model['grbs_metrics']['УЭР']['ep']['year']['plan_count'] = 999
    else:
        month = next(m for m in model['monthly'] if m['plan_count'])
        month['plan_amount'] = 999999.0
        month['exact_decimal']['plan_amount'] = '999999'
    (root / 'report_model.json').write_text(json.dumps(model))
    (root / 'dashboard.json').write_text(json.dumps(project_dashboard(model)))
    render_main_docx(model, root / 'main_report.docx')
    render_management_docx(model, root / 'management_report.docx')
    render_operational_docx(model, root / 'operational_report.docx')
    revisions = json.loads((root / 'snapshot_bundle/bundle.json').read_text())['after']
    store = PublicationStore(tmp_path / 'published')
    with pytest.raises(PublicationError, match='SAVED_SOURCE_RECHECK_FAILED'):
        store.publish(root, read_revisions=lambda: revisions)
    assert store.latest() is None
