import json
from decimal import Decimal
from pathlib import Path

import pytest
from procurement_engine.canonical_metrics import metric_block
from procurement_engine.models import ProcurementRow
from procurement_engine.normalize import parse_date, parse_decimal

CASES = json.loads((Path(__file__).resolve().parents[2] / 'shared/fixtures/source-value-cases.json').read_text(encoding='utf-8'))


@pytest.mark.parametrize('case', CASES['numbers'])
def test_shared_number_contract(case):
    if case.get('invalid'):
        with pytest.raises(ValueError):
            parse_decimal(case['raw'])
    else:
        assert parse_decimal(case['raw']) == (None if case['value'] is None else Decimal(case['value']))


@pytest.mark.parametrize('case', CASES['dates'])
def test_shared_date_contract(case):
    assert parse_date(case['raw']) == case['value']


# Source-scale and percent oracles are independent of TypeScript; both runtimes
# consume the same declared source examples, but not the same implementation.
@pytest.mark.parametrize('case', CASES['moneyScales'])
def test_shared_money_units(case):
    scales = {'rubles': Decimal(1), 'thousand_rubles': Decimal(1000), 'million_rubles': Decimal(1_000_000)}
    observed = parse_decimal(case['raw'])
    assert observed is not None
    assert observed * scales[case['from']] / scales[case['to']] == Decimal(case['value'])


@pytest.mark.parametrize('case', CASES['percentScales'])
def test_shared_percent_encodings(case):
    raw = case['raw']
    marked = isinstance(raw, str) and raw.endswith('%')
    parsed = parse_decimal(raw[:-1] if marked else raw)
    observed = None if parsed is None else (parsed / 100 if marked or case['encoding'] == 'points' else parsed)
    assert observed == (None if case['value'] is None else Decimal(case['value']))


def test_report_metric_projection_has_explicit_money_scale_and_percentage_points():
    row = ProcurementRow(
        snapshot_id='fixed', procurement_id='1', grbs='УО', subject='Контрольная позиция',
        method='ЭА', activity_kind='Текущая деятельность', program='Существующая программа',
        planned_date='2026-10-22', planned_year=2026, actual_date='2026-10-22',
        plan_fb=20_000, fact_fb=1234.56, saving_fb=-20, include_saving=True,
    )
    result = metric_block([row], report_year=2026, as_of='2026-10-22')
    assert result['plan_count'] == result['fact_count'] == 1
    assert result['money_unit'] == 'тыс. руб.'
    assert Decimal(result['exact_decimal']['plan_amount']) == Decimal('20000')
    assert Decimal(result['exact_decimal']['confirmed_saving_amount']) == Decimal('-20')
    assert result['contracted_share_pct'] == pytest.approx(6.1728)  # percent points, not a fraction
    assert result['execution_pct'] == 100
