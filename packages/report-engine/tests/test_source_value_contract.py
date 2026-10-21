import json
from decimal import Decimal
from pathlib import Path

import pytest
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
