"""Public deployment summary; full evidence stays in the private runtime directory."""
import json
import sys
from pathlib import Path

# Fixed vocabulary, not a character filter: unknown source text is never echoed.
PUBLIC_CODES = frozenset(['GENERATION_FAILED', 'GOOGLE_BATCH_SOURCE_MISMATCH', 'GOOGLE_BATCH_RANGE_COUNT_MISMATCH', 'GOOGLE_BATCH_RANGE_MISMATCH', 'GOOGLE_BATCH_VALUES_INVALID', 'GOOGLE_AUTH_CONFIGURATION_INVALID', 'GOOGLE_CREDENTIALS_REQUIRED', 'GOOGLE_AUTH_REFRESH_FAILED', 'GOOGLE_AUTH_TOKEN_MISSING', 'GOOGLE_READ_NETWORK_ERROR', 'GOOGLE_READ_RETRIES_EXHAUSTED', 'GOOGLE_SOURCE_NOT_SPREADSHEET', 'GOOGLE_SHEET_ID_NOT_FOUND', 'SOURCE_CHANGED', 'SOURCE_CHANGED_AFTER_FREEZE', 'SOURCE_SCHEMA_CHANGED', 'SOURCE_CHANGED_DURING_FREEZE', 'ATOMIC_SOURCE_REVISION_UNAVAILABLE', 'ATOMIC_SOURCE_IDENTITY_INCOMPLETE', 'SOURCE_PAYLOAD_ID_MISMATCH', 'SOURCE_PROVIDER_ID_MISMATCH', 'SOURCE_ROLE_MISMATCH', 'SOURCE_SET_MISMATCH', 'ATOMIC_SNAPSHOT_UNSTABLE', 'SECTION_SOURCE_MISMATCH', 'MONTHLY_PARITY_FAILED', 'RECOMMENDATION_LEDGER_SCHEMA_INVALID', 'RECOMMENDATION_LEDGER_DUPLICATE_ID', 'FACT_AFTER_REPORT_DATE', 'SOURCE_FORMULA_ERROR', 'INPUT_CONTRACT_INVALID'])
PUBLIC_TYPES = frozenset(['GoogleReadError', 'AtomicSnapshotError', 'PublicationError',
                         'ValueError', 'TypeError', 'KeyError', 'OSError', 'RuntimeError'])


def summarize_status(status):
    value = status.get('status')
    result = {'last_report_status': value if isinstance(value, str) and value in {
        'RUNNING', 'VERIFIED', 'VERIFIED_WITH_WARNINGS', 'NOT_ISSUED', 'ALREADY_RUNNING'} else 'UNKNOWN'}
    for field, allowed, fallback in [('error_code', PUBLIC_CODES, 'UNRECOGNIZED_ERROR'),
                                     ('error_type', PUBLIC_TYPES, 'OtherError')]:
        if field in status:
            value = status[field]
            result[field] = value if isinstance(value, str) and value in allowed else fallback
    blockers = status.get('blockers')
    if isinstance(blockers, list):
        result['blocker_codes'] = sorted({item['code'] if isinstance(item.get('code'), str)
            and item['code'] in PUBLIC_CODES else 'UNRECOGNIZED_ERROR'
            for item in blockers if isinstance(item, dict)})
    return result


if __name__ == '__main__':
    stage = sys.argv[1] if len(sys.argv) == 2 and sys.argv[1] in {'bootstrap', 'schema_migration', 'capture', 'http'} else 'unknown'
    try:
        status = json.loads(Path('data/reports/status.json').read_text())
        summary = summarize_status(status) if isinstance(status, dict) else {'last_report_status': 'UNKNOWN'}
    except (OSError, ValueError):
        summary = {'last_report_status': 'UNAVAILABLE'}
    print(json.dumps({'failed_deployment_stage': stage, **summary}))
