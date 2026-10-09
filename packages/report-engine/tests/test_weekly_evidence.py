"""Weekly executive text must follow archived evidence, not invented purchase events."""
from copy import deepcopy

from procurement_engine.weekly_evidence import (
    CONTRACT,
    build_weekly_evidence,
    event_sentence,
    freeze_weekly_baseline,
    previous_week_window,
)


def report(day, *, method="ЭА", quarter=3, plan="100.00", fact=None, uid="PUR-proven",
           rec_ids=(), included=True, rules="rules"):
    row = {
        "procurement_uid": uid, "included": included, "planned_year": 2026,
        "grbs": "УО", "subject": "Поставка бумаги", "method": method,
        "planned_quarter": quarter, "planned_date": "2026-09-25",
        "actual_date": fact, "plan_amount": float(plan), "fact_amount": 0.0,
        "plan_fb": 0.0, "plan_kb": 0.0, "plan_mb": float(plan),
        "fact_fb": 0.0, "fact_kb": 0.0, "fact_mb": 0.0,
        "physical_row_key": f"book::ВСЕ::4::{uid}",
    }
    return {
        "snapshot": {"snapshot_id": day, "report_date": day, "report_year": 2026,
                     "rules_version": rules},
        "grbs_order": ["УО"], "details": [row], "recommendation_records": [
            {"recommendation_id": identifier} for identifier in rec_ids],
        "headline": {
            kind: {"year": {"plan_count": 1, "fact_count": int(fact is not None)}}
            for kind in ("competitive", "single_supplier")
        },
    }


def older(model):
    return freeze_weekly_baseline({
        "receipt": {"release_id": "REL-old", "snapshot_id": "SNP-old",
                    "model_sha256": "a" * 64, "report_date": model["snapshot"]["report_date"]},
        "model": model,
    })


def test_prior_week_is_strict_thursday_friday():
    assert previous_week_window("09.10.2026") == ("2026-10-01", "2026-10-02")
    assert previous_week_window("08.10.2026") == ("2026-10-01", "2026-10-02")
    assert previous_week_window("02.01.2027") == ("2026-12-24", "2026-12-25")


def test_unavailable_week_never_substitutes_daily_comparison():
    result = build_weekly_evidence(report("2026-10-09"), freeze_weekly_baseline(None))
    assert result["status"] == "NOT_AVAILABLE"
    assert result["events"] == []
    assert "не подтверждён" in result["message"]


def test_report_week_matches_same_uid_and_separates_late_entry_from_new_contract():
    previous = report("2026-10-02", method="ЕП", quarter=3, fact=None)
    current = report("2026-10-09", method="ЭА", quarter=4,
                     fact="2026-09-25", rec_ids=("R-1",))
    result = build_weekly_evidence(current, older(previous))
    assert result["contract"] == CONTRACT
    assert result["status"] == "COMPARABLE"
    assert result["matched_positions"] == 1
    assert result["unmatched_positions"] == 0
    assert result["recommendations_added"] == 1
    assert result["event_counts"] == {
        "FACT_DATE_RECORDED": 1, "METHOD_CHANGED": 1, "PLAN_QUARTER_CHANGED": 1}
    date_change = next(x for x in result["events"] if x["kind"] == "FACT_DATE_RECORDED")
    text = event_sentence(date_change, baseline_date="2026-10-02")
    assert "более раннему периоду" in text
    assert "договор заключен" not in text.casefold()
    assert "PUR-proven" not in text
    assert "book::" not in text


def test_absent_or_duplicate_uids_never_yield_claim_of_cancelled_procurement():
    previous = report("2026-10-02", uid="PUR-old")
    current = report("2026-10-09", uid="PUR-new")
    result = build_weekly_evidence(current, older(previous))
    assert result["status"] == "COMPARABLE"
    assert result["matched_positions"] == 0
    assert result["unmatched_positions"] == 2
    assert result["events"] == []
    duplicate = deepcopy(current["details"][0])
    current["details"].append(duplicate)
    result = build_weekly_evidence(current, older(previous))
    assert result["matched_positions"] == 0
    assert result["unmatched_positions"] == 3


def test_bad_week_or_changed_rules_is_not_comparable():
    prior = report("2026-10-01")
    current = report("2026-10-09")
    assert build_weekly_evidence(current, older(prior))["status"] == "COMPARABLE"
    invalid = deepcopy(older(prior))
    invalid["report_date"] = "2026-09-30"
    assert build_weekly_evidence(current, invalid)["status"] == "INCOMPARABLE"
    different = report("2026-10-09", rules="changed")
    assert build_weekly_evidence(different, older(prior))["status"] == "INCOMPARABLE"


def test_zero_plan_amount_is_presented_as_zero_not_empty_or_missing():
    previous = report("2026-10-02", plan="0.00")
    current = report("2026-10-09", plan="100.00")
    evidence = build_weekly_evidence(current, older(previous))
    event = next(x for x in evidence["events"] if x["kind"] == "PLAN_AMOUNT_CHANGED")
    assert "0,00" in event_sentence(event)
    assert "100,00" in event_sentence(event)


def test_report_week_does_not_reclassify_missing_date_as_cancellation():
    old = report("2026-10-02", fact="2026-09-25")
    new = report("2026-10-09", fact=None)
    evidence = build_weekly_evidence(new, older(old))
    assert evidence["event_counts"] == {"FACT_DATE_REMOVED": 1}
    text = event_sentence(evidence["events"][0])
    assert "больше не отражается в реестре" in text
    assert "отмен" not in text
