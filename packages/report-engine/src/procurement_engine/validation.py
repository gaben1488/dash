from __future__ import annotations

from collections import Counter

from .constants import ALL_RECOMMENDATION_STATUSES
from .metrics import aggregate_snapshot_model
from .models import ValidationIssue
from .procedures import validate_ledger_procedure_evidence
from .recommendation_strict import text_derived_special_status
from .recommendations import evaluate_recommendation, is_historically_accepted


def validate_snapshot(snapshot: dict, *, amount_tol: float = 0.01) -> list[ValidationIssue]:
    issues: list[ValidationIssue] = []
    model = snapshot.get("model") or {}
    if not model:
        return [ValidationIssue("ERROR", "SNAPSHOT_MODEL_MISSING", "snapshot.model is missing")]

    for grbs, g in model.items():
        for typ in ("comp", "ep"):
            if typ not in g:
                issues.append(ValidationIssue("ERROR", "TYPE_BLOCK_MISSING", f"{grbs}: missing {typ}"))
                continue
            annual = g[typ]["year"]
            if annual["remain_count"] != annual["plan_count"] - annual["fact_count"]:
                issues.append(ValidationIssue("ERROR", "REMAIN_COUNT_MISMATCH",
                                              f"{grbs}/{typ}: annual remain != plan-fact"))
            q_plan = sum(int(g[typ][f"q{i}"]["plan_count"]) for i in range(1, 5))
            if q_plan != int(annual["plan_count"]):
                issues.append(ValidationIssue("ERROR", "QUARTER_PLAN_SUM_MISMATCH",
                                              f"{grbs}/{typ}: q1..q4 plan count != annual"))
            q_fact = sum(int(g[typ][f"q{i}"]["fact_count"]) for i in range(1, 5))
            if q_fact != int(annual["fact_count"]):
                issues.append(ValidationIssue("ERROR", "QUARTER_FACT_SUM_MISMATCH",
                                              f"{grbs}/{typ}: q1..q4 fact count != annual"))

    checks = snapshot.get("headline_checks") or []
    for c in checks:
        typ = c.get("type")
        if typ not in {"comp", "ep"}:
            continue
        got = c.get("got")
        if got != c.get("expected") or c.get("pass") is not True:
            issues.append(ValidationIssue("ERROR", "HEADLINE_CHECK_FAILED",
                                          f"headline check failed for {typ}", {"check": c}))
        # Independently recompute current known check tuple (annual plan/fact, q3 plan/fact).
        year = aggregate_snapshot_model(model, typ, "year")
        q3 = aggregate_snapshot_model(model, typ, "q3")
        recomputed = [year.plan_count, year.fact_count, q3.plan_count, q3.fact_count]
        if got and list(got) != recomputed:
            issues.append(ValidationIssue("ERROR", "HEADLINE_RECOMPUTE_MISMATCH",
                                          f"recomputed headline differs for {typ}",
                                          {"declared": got, "recomputed": recomputed}))
    return issues


def validate_ledger(ledger: list[dict], summary: dict | None = None) -> list[ValidationIssue]:
    issues: list[ValidationIssue] = []
    ids = [r.get("recommendation_id") for r in ledger]
    if any(not x for x in ids):
        issues.append(ValidationIssue("ERROR", "RECOMMENDATION_ID_MISSING", "ledger contains missing recommendation_id"))
    dup = [k for k, v in Counter(ids).items() if k and v > 1]
    if dup:
        issues.append(ValidationIssue("ERROR", "RECOMMENDATION_ID_DUPLICATE", "duplicate recommendation ids", {"ids": dup}))

    active = [r for r in ledger if r.get("active_in_current_slice")]
    for r in ledger:
        rid = r.get("recommendation_id")
        if r.get("semantic_status") not in ALL_RECOMMENDATION_STATUSES:
            issues.append(ValidationIssue("ERROR", "UNKNOWN_SEMANTIC_STATUS", f"{rid}: unknown status"))
        if not r.get("source_procurement_ids") and r.get("semantic_status") != "SUPERSEDED":
            issues.append(ValidationIssue("ERROR", "PROVENANCE_MISSING", f"{rid}: source procurement ids missing"))
        if r.get("active_in_current_slice") and not r.get("status_evidence"):
            issues.append(ValidationIssue("ERROR", "STATUS_EVIDENCE_MISSING", f"{rid}: status evidence missing"))
        if r.get("semantic_status") == "SUPERSEDED" and r.get("active_in_current_slice"):
            issues.append(ValidationIssue("ERROR", "SUPERSEDED_IS_ACTIVE", f"{rid}: superseded record is active"))

        replay = evaluate_recommendation(r).status
        if replay != r.get("semantic_status"):
            issues.append(ValidationIssue("ERROR", "SEMANTIC_REPLAY_MISMATCH",
                                          f"{rid}: rule engine={replay}, ledger={r.get('semantic_status')}",
                                          {"current_state": r.get("current_procurement_state"), "method": r.get("current_method")}))
        issues.extend(validate_ledger_procedure_evidence(r))
        if r.get("active_in_current_slice") and text_derived_special_status(r):
            issues.append(ValidationIssue("WARN", "LEGACY_TEXT_DERIVED_SPECIAL_STATUS",
                                          f"{rid}: special status still depends on unstructured migration text; new pipeline must use structured state/event"))
        pb = r.get("procedure_binding_reliable") or {}
        for d in pb.get("details") or []:
            if d.get("reliable") is True and not d.get("evidence"):
                issues.append(ValidationIssue("WARN", "LEGACY_PROCEDURE_BINDING_EVIDENCE",
                                              f"{rid}: reliable procedure binding has no v2 evidence bundle",
                                              {"code": d.get("code"), "procurement_id": d.get("procurement_id")}))

        if r.get("semantic_status") == "REMOVED_FROM_PLAN" and r.get("current_procurement_ids"):
            issues.append(ValidationIssue("ERROR", "REMOVED_HAS_CURRENT_IDS", f"{rid}: removed row has current ids"))
        if r.get("semantic_status") == "CONTRACTED_EP" and r.get("current_method") != "ЕП":
            issues.append(ValidationIssue("ERROR", "CONTRACTED_EP_METHOD_MISMATCH", f"{rid}: CONTRACTED_EP but method != ЕП"))

    if summary:
        expected_statuses = Counter(summary.get("semantic_status_counts") or {})
        actual_statuses = Counter(r.get("semantic_status") for r in active)
        if expected_statuses != actual_statuses:
            issues.append(ValidationIssue("ERROR", "SUMMARY_STATUS_MISMATCH", "summary status counts differ",
                                          {"expected": dict(expected_statuses), "actual": dict(actual_statuses)}))
        pairs = [
            ("historical_unique_recommendations", len(ledger)),
            ("active_recommendations", len(active)),
            ("superseded_historical_versions", len(ledger) - len(active)),
            ("historically_accepted_by_rule", sum(is_historically_accepted(r) for r in active)),
        ]
        for field, actual in pairs:
            if summary.get(field) != actual:
                issues.append(ValidationIssue("ERROR", "SUMMARY_COUNT_MISMATCH",
                                              f"summary {field}={summary.get(field)!r}, actual={actual!r}"))
    return issues


def validation_report(snapshot: dict, ledger: list[dict], summary: dict | None = None) -> dict:
    issues = validate_snapshot(snapshot) + validate_ledger(ledger, summary)
    counts = Counter(x.severity for x in issues)
    return {
        "pass": counts.get("ERROR", 0) == 0,
        "issue_counts": dict(counts),
        "issues": [x.as_dict() for x in issues],
    }
