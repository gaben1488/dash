"""Synthetic acceptance: configuration, not the original answer, governs the report."""
import json
from copy import deepcopy
from datetime import datetime
from zoneinfo import ZoneInfo

import pytest
from procurement_engine.publication_history import compare_published_models
from procurement_engine.publication_reader import read_publication
from procurement_engine.qa import validate_master_values
from procurement_engine.runtime import run_once
from procurement_engine.runtime_inputs import validate_inputs
from test_recorded_release import CompleteGoogle
from test_runtime import inputs


def source_row(*, grbs='УЭР', year=2034, month=5, amount=17.5):
    row = [''] * 34
    row[:7] = ['42', grbs, 'Синтетическое учреждение', '', '', 'Поставка', 'Синтетический предмет']
    row[7:12] = [0, 0, amount, amount, 'ЕП']
    row[13:16] = [f'01.{month:02d}.{year}', (month - 1) // 3 + 1, year]
    row[21:30] = [0, 0, 0, 0, 0, 0, 0, 0, 'нет']
    return row


@pytest.mark.parametrize('header_rows', [1, 3, 5])
def test_configured_departments_drive_the_real_capture_to_publication_path(tmp_path, header_rows):
    registry_file, ledger = inputs(tmp_path)
    registry = json.loads(registry_file.read_text())
    departments = ['НОВОЕ УПРАВЛЕНИЕ', 'УЭР', 'УО']
    masters = registry['sources'][:3]
    for source, department in zip(masters, departments):
        source['grbs'] = department
        source['header_rows'] = header_rows
    registry.update(grbs_order=departments, sources=masters + registry['sources'][8:])
    from procurement_engine.raw_pipeline import header_hash
    headers = [[] for _ in range(header_rows)]
    headers[-1] = ['Synthetic header']
    if header_rows > 3:
        headers[3] = source_row()  # Procurement-shaped example inside the declared header must not enter data.
    for source in masters:
        source['schema_fingerprint'] = header_hash(headers, header_rows)
    validate_inputs(registry, [])
    registry_file.write_text(json.dumps(registry))
    now = datetime.now(ZoneInfo('Asia/Kamchatka'))
    department_by_source = {source['provider_id']: source['grbs'] for source in masters}

    class Data(CompleteGoogle):
        def grid(self, provider, sheet_id):
            result = super().grid(provider, sheet_id)
            result['gridProperties']['rowCount'] = header_rows + 1 if provider in department_by_source else 3
            return result

        def values(self, provider, title, start, end, columns):
            rows = [[], [], ['Synthetic header']]
            if provider in department_by_source:
                rows = deepcopy(headers) + [[]]
                rows[header_rows] = source_row(grbs=department_by_source[provider], year=now.year, month=now.month)
            return rows[start - 1:end]

    state = tmp_path / 'state'
    result = run_once(registry_file, ledger, state, client=Data())
    assert result['status'] == 'VERIFIED'
    model = json.loads((state / 'attempts' / result['attempt_id'] / 'bundle/report_model.json').read_text())
    assert model['grbs_order'] == departments
    assert model['headline']['single_supplier']['year']['plan_count'] == len(departments)
    assert model['headline']['single_supplier']['year']['plan_amount'] == 52.5
    assert set(model['report_content']['by_grbs']) == set(departments)
    assert model['independent_audit']['pass']
    capture = json.loads((state / 'attempts' / result['attempt_id'] / 'capture.json').read_text())
    assert all(s['header_rows'] == header_rows for s in capture['sources'] if s['role'] == 'master')
    assert {row['row_number'] for row in model['details']} == {header_rows + 1}
    for kind in ('main', 'supplement'):
        assert read_publication(state, kind, result['publication']['release_id']).startswith(b'PK')


@pytest.mark.parametrize('scope', [[], ['УЭР', 'УЭР'], [''], [' УЭР'], [True], 'УЭР'])
def test_invalid_department_contract_is_rejected(tmp_path, scope):
    registry_file, _ = inputs(tmp_path)
    registry = json.loads(registry_file.read_text()); registry['grbs_order'] = scope
    with pytest.raises(ValueError, match='INPUT_GRBS_ORDER_INVALID'):
        validate_inputs(registry, [])


def test_configured_missing_department_does_not_silently_reduce_the_report(tmp_path):
    registry_file, _ = inputs(tmp_path)
    registry = json.loads(registry_file.read_text())
    registry['grbs_order'] = [source['grbs'] for source in registry['sources'] if source['role'] == 'master']
    registry['sources'].pop(0)
    with pytest.raises(ValueError, match='INPUT_MASTER_SET_INVALID'):
        validate_inputs(registry, [])


@pytest.mark.parametrize('column,value,code', [
    (15, 2034.5, 'INVALID_PLAN_YEAR'), (15, '2034,5', 'INVALID_PLAN_YEAR'),
    (15, 'NaN', 'INVALID_PLAN_YEAR'), (15, True, 'INVALID_PLAN_YEAR'),
    (14, 2.9, 'INVALID_PLAN_QUARTER'), (14, 0, 'INVALID_PLAN_QUARTER'),
    (18, 2034.2, 'INVALID_FACT_YEAR'), (17, 1.1, 'INVALID_FACT_QUARTER'),
    (13, '31.02.2034', 'INVALID_PLAN_DATE'), (16, '31.02.2034', 'INVALID_FACT_DATE'),
])
def test_invalid_civil_periods_cannot_be_truncated_or_treated_as_missing(column, value, code):
    row = source_row(); row[column] = value
    issues = validate_master_values([row], grbs='УЭР', source_id='synthetic', sheet_name='ВСЕ')
    assert any(issue.code == code and issue.severity == 'ERROR' for issue in issues)


def test_department_scope_change_is_not_presented_as_procurement_progress():
    current = {'snapshot': {'snapshot_id': 'new', 'report_date': '02.05.2034',
                           'report_year': 2034, 'rules_version': 'test'}, 'grbs_order': ['УЭР', 'УО']}
    previous = deepcopy(current); previous['snapshot'].update(snapshot_id='old', report_date='01.05.2034')
    previous['grbs_order'] = ['УЭР']
    comparison = compare_published_models(current, previous)
    assert comparison['status'] == 'REPORT_SCOPE_CHANGED'
    assert comparison['changes'] == []
