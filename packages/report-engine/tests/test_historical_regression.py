from io import BytesIO

from openpyxl import Workbook
from procurement_engine.historical_regression import (
    _canonical_history_matrix,
    metric_digest,
    source_semantic_digest,
    verify_private_corpus,
)


def row(*, number=1, method='ЭА', plan=10, fact=0, plan_date='01.05.2034', fact_date=None):
    value = [''] * 34
    value[0] = number
    value[5] = 'Программное мероприятие'
    value[6] = 'Private subject is deliberately ignored by the semantic source digest'
    value[7:10] = [0, 0, plan]
    value[11] = method
    value[13:16] = [plan_date, 2, 2034]
    value[16] = fact_date
    value[21:24] = [0, 0, fact]
    value[25:28] = [0, 0, 0]
    value[29] = 'нет'
    return value


def capture(values, grbs='УДТХ'):
    return {'report_date': '2034-05-08', 'report_year': 2034, 'sources': [{
        'role': 'master', 'grbs': grbs, 'provider_id': 'private', 'sheet': grbs,
        'header_rows': 3, 'values': values,
    }]}


def test_historical_ordinal_row_restores_reordered_physical_columns():
    canonical = [[i for i in range(1, 35)], [None] * 34, [None] * 34, row()]
    order = [2, 3, 4, 5, 1] + list(range(6, 35))
    workbook = Workbook()
    sheet = workbook.active
    sheet.title = 'УДТХ'
    for source_row in canonical:
        physical = [None] * 34
        for physical_index, canonical_ordinal in enumerate(order):
            physical[physical_index] = source_row[canonical_ordinal - 1]
        sheet.append(physical)
    data = BytesIO()
    workbook.save(data)
    workbook.close()

    name, restored = _canonical_history_matrix(data.getvalue(), preferred_sheet='УДТХ')
    assert name == 'УДТХ'
    assert restored[3][0] == 1
    assert restored[3][5] == 'Программное мероприятие'
    assert restored[3][11] == 'ЭА'
    assert restored[3][13:17] == ['01.05.2034', 2, 2034, None]
    assert source_semantic_digest(restored) == source_semantic_digest(canonical)


def test_private_corpus_regression_accepts_typed_missing_source_without_zero_fabrication():
    values = [[None] * 34 for _ in range(3)] + [row()]
    registry = {'sources': [
        {'role': 'master', 'grbs': 'УДТХ', 'provider_id': 'private', 'sheet': 'УДТХ'},
    ]}
    private = [{'date': '2034-05-08', 'sources': [
        {'grbs': 'УДТХ', 'sheet': 'УДТХ', 'rows': [{'cells': row()}]},
        {'grbs': 'УЭР', 'missing': True},
    ]}]
    oracle = {'contract': 'historical-master-oracle-v1', 'cases': [{
        'date': '2034-05-08',
        'source_digests': {'УДТХ': source_semantic_digest(values)},
        'metric_digest': metric_digest(capture(values)),
        'expected_missing_sources': ['УЭР'],
    }]}
    result = verify_private_corpus(private, oracle, registry)
    assert result['pass']
    assert result['checks'] == 2


def test_private_corpus_regression_fails_when_expected_missing_state_is_silently_filled():
    values = [[None] * 34 for _ in range(3)] + [row()]
    registry = {'sources': [
        {'role': 'master', 'grbs': 'УДТХ', 'provider_id': 'private', 'sheet': 'УДТХ'},
    ]}
    private = [{'date': '2034-05-08', 'sources': [
        {'grbs': 'УДТХ', 'sheet': 'УДТХ', 'rows': [{'cells': row()}]},
    ]}]
    oracle = {'contract': 'historical-master-oracle-v1', 'cases': [{
        'date': '2034-05-08',
        'source_digests': {'УДТХ': source_semantic_digest(values)},
        'metric_digest': metric_digest(capture(values)),
        'expected_missing_sources': ['УЭР'],
    }]}
    result = verify_private_corpus(private, oracle, registry)
    assert not result['pass']
    assert result['failures'] == [{
        'date': '2034-05-08',
        'code': 'HISTORICAL_MISSING_SOURCE_STATE_MISMATCH',
    }]
