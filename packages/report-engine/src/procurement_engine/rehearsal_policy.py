"""Read-only upgrade gate for pre-existing, immutable weekly-archive defects.

A candidate that introduces a new failure is never accepted. A legacy frozen
weekly archive can already be invalid and cannot be repaired by editing its
bytes; the upgrade may proceed only when its precise known blocking condition
is identical under the deployed engine and under the candidate engine.
This does not certify the historical report or downgrade publication checks.
"""


def compare_weekly_replay(baseline: dict, candidate: dict) -> dict:
    if candidate.get("replay_status") == "PASS":
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
    }
