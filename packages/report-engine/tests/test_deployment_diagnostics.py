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
