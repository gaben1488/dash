"""Public deployment summary; full evidence stays in the private runtime directory."""
import json
import sys
from datetime import datetime
from pathlib import Path

# Fixed vocabulary, not a character filter: unknown source text is never echoed.
PUBLIC_CODES = frozenset(['GENERATION_FAILED', 'GOOGLE_BATCH_SOURCE_MISMATCH', 'GOOGLE_BATCH_RANGE_COUNT_MISMATCH', 'GOOGLE_BATCH_RANGE_MISMATCH', 'GOOGLE_BATCH_VALUES_INVALID', 'GOOGLE_AUTH_CONFIGURATION_INVALID', 'GOOGLE_CREDENTIALS_REQUIRED', 'GOOGLE_AUTH_REFRESH_FAILED', 'GOOGLE_AUTH_TOKEN_MISSING', 'GOOGLE_READ_NETWORK_ERROR', 'GOOGLE_READ_RETRIES_EXHAUSTED', 'GOOGLE_SOURCE_NOT_SPREADSHEET', 'GOOGLE_SHEET_ID_NOT_FOUND', 'SOURCE_CHANGED', 'SOURCE_CHANGED_AFTER_FREEZE', 'SOURCE_SCHEMA_CHANGED', 'SOURCE_CHANGED_DURING_FREEZE', 'ATOMIC_SOURCE_REVISION_UNAVAILABLE', 'ATOMIC_SOURCE_IDENTITY_INCOMPLETE', 'SOURCE_PAYLOAD_ID_MISMATCH', 'SOURCE_PROVIDER_ID_MISMATCH', 'SOURCE_ROLE_MISMATCH', 'SOURCE_SET_MISMATCH', 'ATOMIC_SNAPSHOT_UNSTABLE', 'SECTION_SOURCE_MISMATCH', 'MONTHLY_PARITY_FAILED', 'RECOMMENDATION_LEDGER_SCHEMA_INVALID', 'RECOMMENDATION_LEDGER_DUPLICATE_ID', 'FACT_AFTER_REPORT_DATE', 'SOURCE_FORMULA_ERROR', 'INPUT_CONTRACT_INVALID'])
PUBLIC_TYPES = frozenset(['GoogleReadError', 'AtomicSnapshotError', 'PublicationError',
                         'ValueError', 'TypeError', 'KeyError', 'OSError', 'RuntimeError'])

# HTTP status is a finite protocol vocabulary; no provider response text is public.
PUBLIC_CODES = PUBLIC_CODES | frozenset(f'GOOGLE_READ_HTTP_{code}' for code in range(400, 600)) | frozenset({
    'GOOGLE_FORMULA_ERROR', 'GOOGLE_SHEET_TITLE_CHANGED_REVIEW_CONTRACT',
    'GOOGLE_SOURCE_COLUMNS_MISSING', 'GOOGLE_RANGE_OVERFLOW', 'GOOGLE_COLUMN_OVERFLOW',
    'GOOGLE_FORMULA_RANGE_OVERFLOW', 'CAPTURE_CROSSED_LOCAL_MIDNIGHT_RETRY',
    'ATOMIC_SNAPSHOT_NO_SOURCES', 'ATOMIC_SNAPSHOT_DUPLICATE_SOURCE_ID', 'ATOMIC_SNAPSHOT_MODE_INVALID',
    'IDENTITY_REVIEW_BEFORE_OBSERVATION', 'IDENTITY_REVIEW_EVIDENCE_REQUIRED',
    'IDENTITY_REVIEW_ROW_UNKNOWN', 'IDENTITY_REVIEW_UID_UNKNOWN', 'IDENTITY_REVIEW_TIMEZONE_MISSING',
    'IDENTITY_REVIEW_CONFLICT', 'IDENTITY_REVIEW_UID_COLLISION', 'IDENTITY_REVIEW_EVIDENCE_MISMATCH',
    'IDENTITY_BACKUP_INVALID', 'IDENTITY_BACKUP_MODEL_MISMATCH', 'IDENTITY_SNAPSHOT_UNKNOWN',
    'IDENTITY_DATABASE_CORRUPT', 'IDENTITY_CAPTURE_TIMEZONE_MISSING', 'IDENTITY_LOCATORS_INVALID',
    'IDENTITY_SNAPSHOT_MUTATION', 'IDENTITY_OUT_OF_ORDER_CAPTURE', 'IDENTITY_UID_COLLISION',
    'BUNDLE_JSON_INVALID', 'BUNDLE_UNSAFE_FILE', 'RELEASE_BLOCKED', 'INDEPENDENT_AUDIT_FAILED',
    'REPORT_METADATA_MISSING', 'REPORT_DATE_INVALID', 'DASHBOARD_MODEL_MISMATCH',
    'DOCUMENT_HASH_MISMATCH', 'DOCUMENT_MODEL_MISMATCH', 'DOCUMENT_SNAPSHOT_MISMATCH',
    'SNAPSHOT_EMPTY', 'SNAPSHOT_PATH_INVALID', 'SNAPSHOT_CORRUPT', 'SNAPSHOT_MODEL_MISMATCH',
    'SOURCE_CHANGED_DURING_CAPTURE', 'SOURCE_COVERAGE_MISMATCH', 'DOMAIN_RELEASE_POLICY_MISSING',
    'DOMAIN_RELEASE_CONTRACT_FAILED', 'SAVED_SOURCE_RECHECK_FAILED', 'PUBLISHED_BUNDLE_CORRUPT',
    'PUBLICATION_ID_INVALID', 'PUBLICATION_VIEW_INVALID', 'PUBLICATION_NOT_FOUND',
    'CANDIDATE_DIRECTORY_INVALID', 'SOURCE_CHANGED_BEFORE_PUBLICATION', 'ORPHAN_RELEASE_CONFLICT',
    'MASTER_GRBS_SET_INCOMPLETE', 'DUPLICATE_SOURCE_ID', 'CAPTURE_TIMEZONE_MISSING',
    'REPORT_DATE_CAPTURE_DATE_MISMATCH', 'REPORT_YEAR_MISMATCH', 'SOURCE_CONTRACT_MISMATCH',
    'SOURCE_REVISION_MISSING', 'SOURCE_RANGE_INCOMPLETE', 'OUTPUT_DIRECTORY_NOT_EMPTY',
    'FORMULA_EVIDENCE_MISSING', 'FORMULA_GRID_INCOMPLETE', 'FORMULA_CONTEXT_MISSING',
    'FORMULA_CONTEXT_CHANGED', 'FORMULA_CONTEXT_INVALID', 'FORMULA_CELL_INVALID',
    'FORMULA_FUNCTION_UNVERIFIED', 'FORMULA_DEPENDENCY_NOT_CAPTURED', 'FORMULA_DEPENDENCY_RANGE_NOT_CAPTURED',
})

# All domain blockers share the same safe vocabulary as exception codes.
PUBLIC_CODES = PUBLIC_CODES | frozenset({
    'AT_PUBLISH_PROOF_MISSING',
    'DERIVED_PROJECTION_MISMATCH',
    'DETAIL_LOCATORS_INVALID',
    'FORENSIC_REPLAY_NOT_PUBLISHABLE',
    'IDENTITY_COVERAGE_MISMATCH',
    'INDEPENDENT_AUDIT_FAILED',
    'INPUT_CONTRACT_NOT_CHECKED',
    'MANAGEMENT_PROJECTION_MISMATCH',
    'NARRATIVE_KPI_SOURCE_NOT_SHARED',
    'NARRATIVE_MODE_MISSING',
    'PERSISTENT_IDENTITY_NOT_INTEGRATED',
    'PROJECTION_PARITY_NOT_PROVEN',
    'PROJECTION_SNAPSHOT_MISMATCH',
    'PUBLICATION_HISTORY_POLICY_MISSING',
    'RECOMMENDATION_COVERAGE_MISMATCH',
    'RECOMMENDATION_EVIDENCE_MISMATCH',
    'RECOMMENDATION_PROJECTION_MISMATCH',
    'RECOMMENDATION_REPLAY_NOT_PROVEN',
    'RECOMMENDATION_REVIEW_QUEUE_NOT_EMPTY',
    'RECORDED_STATE_SEMANTICS_CHANGED',
    'RENDERER_INPUT_VIOLATION',
    'REPORT_METADATA_MISSING',
    'REQUIRED_REPORT_SECTION_MISSING',
    'SOURCE_CHANGED_AFTER_FREEZE',
    'SOURCE_QA_ERRORS',
    'SOURCE_REVISION_PROOF_MISSING',
    'TRACE_CONTRIBUTORS_MISSING',
    'UNPROVEN_RECOMMENDATION_CLAIM',
    'UNRELIABLE_BINDING_AFFECTS_KPI',
    'UNSAFE_BUSINESS_ID_IDENTITY',
    'UPSTREAM_IMPORT_FRESHNESS_NOT_PROVEN',
})
PUBLIC_STAGES = frozenset({'inputs', 'acquisition', 'publication_selection', 'build', 'publication'})


def public_error_code(message):
    """Separate known machine codes from private suffixes and arbitrary exceptions."""
    prefix = message.split(':', 1)[0]
    return prefix if prefix in PUBLIC_CODES else 'GENERATION_FAILED'


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
    if 'failure_stage' in status:
        stage = status['failure_stage']
        result['failure_stage'] = stage if isinstance(stage, str) and stage in PUBLIC_STAGES else 'unknown'
    return result


if __name__ == '__main__':
    stage = sys.argv[1] if len(sys.argv) in {2, 3} and sys.argv[1] in {'bootstrap', 'schema_migration', 'capture', 'http'} else 'unknown'
    try:
        status = json.loads(Path('data/reports/status.json').read_text())
        summary = summarize_status(status) if isinstance(status, dict) else {'last_report_status': 'UNKNOWN'}
        if len(sys.argv) == 3:
            start = datetime.fromisoformat(sys.argv[2])
            attempted = datetime.fromisoformat(status.get('started_at') or '')
            if stage not in {'capture', 'http'} or start.tzinfo is None or attempted.tzinfo is None or attempted < start:
                summary = {'last_report_status': 'NOT_CURRENT'}
    except (OSError, ValueError, TypeError, AttributeError):
        summary = {'last_report_status': 'UNAVAILABLE'}
    print(json.dumps({'failed_deployment_stage': stage, **summary}))
