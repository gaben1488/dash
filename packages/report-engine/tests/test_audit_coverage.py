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


def test_publisher_rejects_wrong_grbs_total_after_matching_render_and_hashes(financial_bundle, tmp_path):
    _, model, root = financial_bundle
    model['grbs_metrics']['УЭР']['ep']['year']['plan_count'] = 999
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
