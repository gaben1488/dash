"""An archived bad historical source does not become a new engine regression."""
import json

import pytest
from procurement_engine.rehearsal_policy import compare_weekly_replay

LEGACY = {
    "replay_status": "FAIL",
    "error_code": "ARCHIVE_BUILD_FAILED",
    "blocker_codes": ["SECTION_SOURCE_MISMATCH", "SOURCE_QA_ERRORS"],
    "section_errors": {"procedure_source_contract": 1},
    "source_error_counts": {"DUPLICATE_PROCEDURE_CODE": 1},
}


def test_clean_start_has_no_weekly_replay_to_perform():
    empty = {'replay_status': 'NOT_APPLICABLE', 'reason': 'NO_WEEKLY_ARCHIVES', 'archive_count': 0}
    result = compare_weekly_replay(empty, dict(empty))
    assert result['ready'] is True
    assert result['historical_replay_verified'] is False
    assert result['status'] == 'NO_WEEKLY_HISTORY'
    for prior in ({'replay_status': 'PASS'}, LEGACY, {}, {'replay_status': 'FAIL', 'error_code': 'ARCHIVE_NOT_FOUND'}):
        assert not compare_weekly_replay(prior, empty)['ready']
        assert not compare_weekly_replay(empty, prior)['ready'] or prior == {'replay_status': 'PASS'}
    for count in (False, None, 1):
        malformed = {**empty, 'archive_count': count}
        assert not compare_weekly_replay(malformed, malformed)['ready']


def test_identical_proven_legacy_archive_blocker_is_labeled_not_hidden():
    result = compare_weekly_replay(LEGACY, dict(LEGACY))
    assert result["ready"] is True
    assert result["historical_replay_verified"] is False
    assert result["status"] == "UNCHANGED_LEGACY_ARCHIVE_BLOCKER"
    assert "дублирующийся" in result["explanation"]


def test_clean_candidate_needs_no_legacy_exception():
    result = compare_weekly_replay(LEGACY, {"replay_status": "PASS"})
    assert result == {"status": "PASS", "ready": True, "historical_replay_verified": True}


def test_newly_broken_candidate_is_rejected():
    result = compare_weekly_replay({"replay_status": "PASS"}, LEGACY)
    assert result["ready"] is False


def test_changed_duplicate_count_is_rejected():
    result = compare_weekly_replay(LEGACY, {**LEGACY,
        "source_error_counts": {"DUPLICATE_PROCEDURE_CODE": 2}})
    assert result["ready"] is False


def test_other_inherited_error_is_not_waived():
    prior = {**LEGACY, "source_error_counts": {"SOURCE_RANGE_INCOMPLETE": 1}}
    result = compare_weekly_replay(prior, prior)
    assert result["ready"] is False


def test_missing_current_or_baseline_replay_is_rejected():
    assert not compare_weekly_replay(LEGACY, {})["ready"]
    assert not compare_weekly_replay({}, LEGACY)["ready"]


def test_unproven_failure_explains_both_sides_with_only_fixed_codes_and_counts():
    failed = {**LEGACY, 'source_error_counts': {'DUPLICATE_PROCEDURE_CODE': 2,
        'PRIVATE_SENTINEL': 3}, 'message': 'PRIVATE_SENTINEL', 'error_type': 'RuntimeError'}
    result = compare_weekly_replay(LEGACY, failed)
    assert result['ready'] is False
    assert result['baseline']['error_code'] == 'ARCHIVE_BUILD_FAILED'
    assert result['candidate']['source_error_counts']['DUPLICATE_PROCEDURE_CODE'] == 2
    assert result['candidate']['source_error_counts']['UNRECOGNIZED_ERROR'] == 3
    assert 'PRIVATE_SENTINEL' not in json.dumps(result)


@pytest.mark.parametrize('malformed', [None, [], {'private': 'PRIVATE_SENTINEL'}])
def test_malformed_failure_fields_do_not_bypass_the_gate_or_leak_text(malformed):
    result = compare_weekly_replay(LEGACY, {'replay_status': malformed, 'error_code': malformed,
        'error_type': malformed, 'os_error_code': malformed})
    assert result['ready'] is False
    assert result['candidate']['error_code'] == 'GENERATION_FAILED'
    assert 'PRIVATE_SENTINEL' not in json.dumps(result)


def frozen_refusal():
    return {'replay_status': 'FAIL', 'error_code': 'ARCHIVE_BUILD_FAILED',
            'blocker_codes': ['UPSTREAM_IMPORT_FRESHNESS_NOT_PROVEN'],
            'section_errors': {}, 'source_error_counts': {},
            'frozen_refusal': {'contract': 'frozen-invalid-reference-proof-v1',
                'archive_sha256': 'a' * 64, 'snapshot_sha256': 'b' * 64,
                'dependency_issue_sha256': 'c' * 64, 'invalid_reference_count': 3}}


def test_same_proven_immutable_invalid_reference_is_an_expected_refusal_not_a_successful_report():
    value = frozen_refusal()
    result = compare_weekly_replay(value, value)
    assert result['ready'] is True
    assert result['status'] == 'UNCHANGED_FROZEN_SOURCE_REFUSAL'
    assert result['historical_replay_verified'] is False


@pytest.mark.parametrize('field,value', [('archive_sha256', 'd' * 64),
    ('snapshot_sha256', 'd' * 64), ('dependency_issue_sha256', 'd' * 64),
    ('invalid_reference_count', 4), ('invalid_reference_count', True),
    ('archive_sha256', 'PRIVATE_SENTINEL'), ('contract', 'other')])
def test_refusal_needs_exact_same_frozen_content_and_issues(field, value):
    original = frozen_refusal()
    changed = {**original, 'frozen_refusal': {**original['frozen_refusal'], field: value}}
    result = compare_weekly_replay(original, changed)
    assert not result['ready']
    assert 'PRIVATE_SENTINEL' not in json.dumps(result)


@pytest.mark.parametrize('changes', [{'blocker_codes': ['UPSTREAM_IMPORT_FRESHNESS_NOT_PROVEN', 'INDEPENDENT_AUDIT_FAILED']},
    {'section_errors': {'procedures': 1}}, {'source_error_counts': {'SOURCE_RANGE_INCOMPLETE': 1}},
    {'frozen_refusal': None}, {'error_code': 'ARCHIVE_CORRUPT'}])
def test_frozen_refusal_does_not_waive_other_failures(changes):
    original = frozen_refusal()
    assert not compare_weekly_replay(original, {**original, **changes})['ready']


def test_publishing_known_invalid_frozen_references_is_a_regression():
    assert not compare_weekly_replay(frozen_refusal(), {'replay_status': 'PASS'})['ready']


def test_other_baseline_errors_do_not_allow_publication_of_proven_literal_invalid_references():
    baseline = {**frozen_refusal(), 'blocker_codes': ['UPSTREAM_IMPORT_FRESHNESS_NOT_PROVEN', 'SOURCE_QA_ERRORS'],
                'source_error_counts': {'DUPLICATE_PROCEDURE_CODE': 1}}
    assert not compare_weekly_replay(baseline, {'replay_status': 'PASS'})['ready']
