from procurement_engine.deployment_diagnostics import summarize_status


def test_failure_summary_exposes_only_safe_codes_and_no_source_details():
    status = {'status': 'NOT_ISSUED', 'attempt_id': 'private-attempt',
              'error_code': 'GOOGLE_BATCH_RANGE_MISMATCH', 'error_type': 'GoogleReadError',
              'blockers': [{'code': 'SOURCE_CHANGED', 'message': 'private subject',
                            'context': {'provider_id': 'private-book'}},
                           {'code': 'private subject'}, {'code': 'SOURCE_CHANGED'}]}
    assert summarize_status(status) == {'last_report_status': 'NOT_ISSUED',
        'error_code': 'GOOGLE_BATCH_RANGE_MISMATCH', 'error_type': 'GoogleReadError',
        'blocker_codes': ['SOURCE_CHANGED', 'UNRECOGNIZED_ERROR']}


def test_malformed_diagnostic_fields_cannot_leak_free_text():
    assert summarize_status({'status': 'private source', 'error_code': 'private subject',
        'error_type': 'private\nsecret', 'blockers': 'private'}) == {'last_report_status': 'UNKNOWN', 'error_code': 'UNRECOGNIZED_ERROR', 'error_type': 'OtherError'}


def test_formatted_private_values_are_not_a_known_code_or_type():
    assert summarize_status({'status': [], 'error_code': 'SYNTHETIC_PRIVATE_VALUE',
        'error_type': 'SyntheticPrivateValue', 'blockers': [{'code': 'SYNTHETIC_PRIVATE_VALUE'}]}) == {
        'last_report_status': 'UNKNOWN', 'error_code': 'UNRECOGNIZED_ERROR',
        'error_type': 'OtherError', 'blocker_codes': ['UNRECOGNIZED_ERROR']}


def test_deployment_does_not_present_previous_attempt_as_current_failure(tmp_path):
    import json
    import os
    import subprocess
    import sys
    from pathlib import Path

    directory = tmp_path / 'data/reports'
    directory.mkdir(parents=True)
    status = {'status': 'NOT_ISSUED', 'started_at': '2026-09-29T00:00:00+00:00',
              'error_code': 'GOOGLE_READ_HTTP_429'}
    (directory / 'status.json').write_text(json.dumps(status))
    result = subprocess.run([sys.executable, '-m', 'procurement_engine.deployment_diagnostics',
                             'capture', '2026-09-30T00:00:00+00:00'], cwd=tmp_path,
        env={**os.environ, 'PYTHONPATH': str(Path(__file__).resolve().parents[1] / 'src')},
        capture_output=True, text=True, check=True)
    summary = json.loads(result.stdout)
    assert summary == {'failed_deployment_stage': 'capture', 'last_report_status': 'NOT_CURRENT'}


def test_public_summary_identifies_failure_stage_but_rejects_arbitrary_stage_text():
    assert summarize_status({'status': 'NOT_ISSUED', 'failure_stage': 'acquisition'})['failure_stage'] == 'acquisition'
    assert summarize_status({'status': 'NOT_ISSUED', 'failure_stage': 'private-book'})['failure_stage'] == 'unknown'


def test_every_release_gate_code_has_a_safe_public_projection():
    import ast
    from pathlib import Path

    from procurement_engine.deployment_diagnostics import PUBLIC_CODES

    source = Path(__file__).parents[1] / 'src/procurement_engine/release_gates.py'
    tree = ast.parse(source.read_text())
    codes = set()
    for call in ast.walk(tree):
        if (isinstance(call, ast.Call) and isinstance(call.func, ast.Name)
                and call.func.id in {'require', 'ValidationIssue'} and len(call.args) > 1
                and isinstance(call.args[1], ast.Constant) and isinstance(call.args[1].value, str)):
            codes.add(call.args[1].value)
    assert codes <= PUBLIC_CODES


def test_sqlite_failure_projection_exposes_only_fixed_sqlite_code():
    assert summarize_status({
        'status': 'NOT_ISSUED',
        'error_code': 'GENERATION_FAILED',
        'error_type': 'OperationalError',
        'failure_stage': 'publication',
        'sqlite_error': 'SQLITE_FULL',
    }) == {
        'last_report_status': 'NOT_ISSUED',
        'error_code': 'GENERATION_FAILED',
        'error_type': 'OperationalError',
        'sqlite_error': 'SQLITE_FULL',
        'failure_stage': 'publication',
    }


def test_arbitrary_sqlite_text_is_not_exposed():
    result = summarize_status({
        'status': 'NOT_ISSUED',
        'error_type': 'OperationalError',
        'sqlite_error': 'private table name',
    })
    assert result == {
        'last_report_status': 'NOT_ISSUED',
        'error_type': 'OperationalError',
    }


def test_sqlite_prefix_is_not_an_allowlist():
    for value in ('SQLITE_PRIVATE_CUSTOMER_NAME', 'SQLITE_PASSWORD_12345', 'SQLITE_' + 'X' * 10000):
        assert 'sqlite_error' not in summarize_status({'status': 'NOT_ISSUED', 'sqlite_error': value})
    assert summarize_status({'status': 'NOT_ISSUED', 'sqlite_error': 'SQLITE_BUSY_SNAPSHOT'})['sqlite_error'] == 'SQLITE_BUSY_SNAPSHOT'
