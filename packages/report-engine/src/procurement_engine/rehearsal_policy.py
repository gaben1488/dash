"""Read-only upgrade gate for pre-existing, immutable weekly-archive defects.

A candidate that introduces a new failure is never accepted. A legacy frozen
weekly archive can already be invalid and cannot be repaired by editing its
bytes; the upgrade may proceed only when its precise known blocking condition
is identical under the deployed engine and under the candidate engine.
This does not certify the historical report or downgrade publication checks.
"""
import re

from .deployment_diagnostics import (
    PUBLIC_CODES,
    PUBLIC_TYPES,
    public_error_code,
    safe_sqlite_error,
)


def _failure_summary(value):
    """Only fixed protocol codes/counts, never arbitrary frozen source text."""
    summary = {'replay_status': value.get('replay_status') if value.get('replay_status') in ('PASS', 'FAIL') else 'UNKNOWN'}
    if 'error_code' in value:
        summary['error_code'] = public_error_code(value['error_code']) if isinstance(value['error_code'], str) else 'GENERATION_FAILED'
    if isinstance(value.get('error_type'), str) and value['error_type'] in PUBLIC_TYPES:
        summary['error_type'] = value['error_type']
    if isinstance(value.get('blocker_codes'), list):
        summary['blocker_codes'] = sorted({public_error_code(code) for code in value['blocker_codes'] if isinstance(code, str)})
    if isinstance(value.get('source_error_counts'), dict):
        counts = {}
        for code, count in value['source_error_counts'].items():
            if type(count) is not int or count < 0:
                continue
            key = code if code in PUBLIC_CODES else 'UNRECOGNIZED_ERROR'
            counts[key] = counts.get(key, 0) + count
        summary['source_error_counts'] = counts
    if value.get('os_error_code') in ('ENOSPC', 'ENOMEM', 'EIO', 'EROFS', 'EACCES', 'EMFILE', 'ENFILE', 'OTHER_OS_ERROR'):
        summary['os_error_code'] = value['os_error_code']
    if safe_sqlite_error(value.get('sqlite_error')) is not None:
        summary['sqlite_error'] = safe_sqlite_error(value['sqlite_error'])
    return summary


def _valid_refusal_proof(proof):
    hashes = ('archive_sha256', 'snapshot_sha256', 'dependency_issue_sha256')
    return (isinstance(proof, dict)
        and set(proof) == {'contract', 'invalid_reference_count', *hashes}
        and proof['contract'] == 'frozen-invalid-reference-proof-v1'
        and type(proof['invalid_reference_count']) is int and 0 < proof['invalid_reference_count'] <= 1_000_000
        and all(isinstance(proof[key], str) and re.fullmatch('[a-f0-9]{64}', proof[key]) for key in hashes))


def _proven_invalid_references(value):
    return (value.get('replay_status') == 'FAIL' and value.get('error_code') == 'ARCHIVE_BUILD_FAILED'
        and value.get('blocker_codes') == ['UPSTREAM_IMPORT_FRESHNESS_NOT_PROVEN']
        and value.get('section_errors') == {} and value.get('source_error_counts') == {}
        and _valid_refusal_proof(value.get('frozen_refusal')))


def compare_weekly_replay(baseline: dict, candidate: dict) -> dict:
    empty = {'replay_status': 'NOT_APPLICABLE', 'reason': 'NO_WEEKLY_ARCHIVES', 'archive_count': 0}
    if (baseline == empty and candidate == empty
            and type(baseline.get('archive_count')) is int and type(candidate.get('archive_count')) is int):
        return {'status': 'NO_WEEKLY_HISTORY', 'ready': True, 'historical_replay_verified': False,
                'explanation': 'Недельная история ещё не создана. Проверка исторического воспроизведения неприменима; '
                               'проверки первого расчёта и выпуска выполняются отдельно.'}
    proven = _proven_invalid_references(baseline)
    if (proven and _proven_invalid_references(candidate)
            and baseline['frozen_refusal'] == candidate['frozen_refusal']):
        return {'status': 'UNCHANGED_FROZEN_SOURCE_REFUSAL', 'ready': True,
                'historical_replay_verified': False,
                'explanation': 'Неизменный исторический срез содержит доказанные #REF!. '
                               'Оба генератора отказали в публикации; исторический отчёт не принят.'}
    if candidate.get("replay_status") == "PASS" and not _valid_refusal_proof(baseline.get('frozen_refusal')):
        return {"status": "PASS", "ready": True, "historical_replay_verified": True}
    keys = ("replay_status", "error_code", "blocker_codes", "section_errors", "source_error_counts")
    if (baseline.get("replay_status") == "FAIL"
        and candidate.get("replay_status") == "FAIL"
        and all(baseline.get(key) == candidate.get(key) for key in keys)
        and baseline.get("error_code") == "ARCHIVE_BUILD_FAILED"
        and baseline.get("blocker_codes") == ["SECTION_SOURCE_MISMATCH", "SOURCE_QA_ERRORS"]
        and baseline.get("section_errors") == {"procedure_source_contract": 1}
        and baseline.get("source_error_counts") == {"DUPLICATE_PROCEDURE_CODE": 1}):
        return {
            "status": "UNCHANGED_LEGACY_ARCHIVE_BLOCKER",
            "ready": True,
            "historical_replay_verified": False,
            "explanation": "В сохранённой неделе до обновления уже есть дублирующийся код процедуры. "
                           "Сохранённые данные не изменялись; новый генератор не усилил ошибку."
        }
    return {
        "status": "NEW_OR_UNPROVEN_ARCHIVE_FAILURE", "ready": False,
        "historical_replay_verified": False,
        "baseline": _failure_summary(baseline), "candidate": _failure_summary(candidate),
    }
