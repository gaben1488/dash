"""An archived bad historical source does not become a new engine regression."""
from procurement_engine.rehearsal_policy import compare_weekly_replay

LEGACY = {
    "replay_status": "FAIL",
    "error_code": "ARCHIVE_BUILD_FAILED",
    "blocker_codes": ["SECTION_SOURCE_MISMATCH", "SOURCE_QA_ERRORS"],
    "section_errors": {"procedure_source_contract": 1},
    "source_error_counts": {"DUPLICATE_PROCEDURE_CODE": 1},
}


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
