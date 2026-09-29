from __future__ import annotations

from collections.abc import Iterable
from dataclasses import asdict, dataclass
from typing import Any

from .models import ValidationIssue
from .qa import freshness_gate
from .renderer_guard import RendererInputError, assert_renderer_inputs


@dataclass(frozen=True)
class BindingUse:
    procurement_row_key: str
    procedure_code: str
    decision: str
    reliable: bool
    affects_published_kpi: bool = False
    evidence: dict[str, Any] | None = None

    def as_dict(self) -> dict[str, Any]:
        return asdict(self)


def validate_release_v2(*,
                        source_before: dict[str, str | None],
                        source_after: dict[str, str | None],
                        raw_issues: Iterable[ValidationIssue],
                        binding_uses: Iterable[BindingUse],
                        recommendation_replay_proven: bool,
                        report_model: dict | None = None,
                        renderer_input_files: list[str] | None = None,
                        report_snapshot_id: str | None = None,
                        dashboard_snapshot_id: str | None = None,
                        source_at_publish: dict[str, str | None] | None = None,
                        identity_uses_business_id_only: bool = False,
                        unresolved_recommendation_reviews: int = 0,
                        projection_model_matches: bool | None = None,
                        input_contract_issues: Iterable[ValidationIssue] | None = None,
                        identity_issues: Iterable[ValidationIssue] | None = None,
                        require_report_metadata: bool = False) -> list[ValidationIssue]:
    """Fail-closed release gates for atomic, evidence-bound publication.

    A report may only publish facts derived from one stable snapshot. A proposed/no-code procedure
    relation can be shown in a review queue but cannot alter a published KPI until it is persisted as
    reviewed/reliable. Recommendation rows must be replayed from current evidence, never copied from
    the previous report.
    """
    issues = list(freshness_gate(source_before, source_after))
    if require_report_metadata:
        if not source_before or not source_after or any(not x for x in [*source_before.values(), *source_after.values()]):
            issues.append(ValidationIssue("ERROR", "SOURCE_REVISION_PROOF_MISSING", "Publication requires nonempty source revision barriers"))
        if source_at_publish is None or not source_at_publish or any(not x for x in source_at_publish.values()):
            issues.append(ValidationIssue("ERROR", "AT_PUBLISH_PROOF_MISSING", "Publication requires an observed final source revision barrier"))
        if projection_model_matches is not True:
            issues.append(ValidationIssue("ERROR", "PROJECTION_PARITY_NOT_PROVEN", "Publication requires verified model/projection parity"))
        if input_contract_issues is None:
            issues.append(ValidationIssue("ERROR", "INPUT_CONTRACT_NOT_CHECKED", "Publication requires a completed input-contract check"))
    if input_contract_issues is not None:
        issues.extend(x for x in input_contract_issues if x.severity == "ERROR")
    if identity_issues is not None:
        issues.extend(x for x in identity_issues if x.severity == "ERROR")
    issues.extend(x for x in raw_issues if x.severity == "ERROR")

    for b in binding_uses:
        if b.affects_published_kpi and not b.reliable:
            issues.append(ValidationIssue(
                "ERROR", "UNRELIABLE_BINDING_AFFECTS_KPI",
                f"{b.procedure_code}: non-reliable/review-only binding would alter published KPI",
                {"procurement_row_key": b.procurement_row_key, "decision": b.decision,
                 "evidence": b.evidence or {}},
            ))

    if not recommendation_replay_proven:
        issues.append(ValidationIssue(
            "ERROR", "RECOMMENDATION_REPLAY_NOT_PROVEN",
            "Current recommendation tables/statuses were not rebuilt from current evidence",
        ))

    if report_model is not None:
        try:
            assert_renderer_inputs(report_model=report_model, input_files=renderer_input_files or [])
        except RendererInputError as exc:
            issues.append(ValidationIssue("ERROR", "RENDERER_INPUT_VIOLATION", str(exc)))
        if require_report_metadata:
            meta = report_model.get("snapshot") if isinstance(report_model, dict) else None
            required = ("snapshot_id", "cutoff_at", "rules_version", "renderer_version")
            missing = [k for k in required if not isinstance(meta, dict) or not meta.get(k)]
            if missing:
                issues.append(ValidationIssue(
                    "ERROR", "REPORT_METADATA_MISSING",
                    "ReportModel is missing immutable publication metadata",
                    {"missing": missing},
                ))


    if source_at_publish is not None:
        for issue in freshness_gate(source_after, source_at_publish):
            issues.append(ValidationIssue(
                "ERROR", "SOURCE_CHANGED_AFTER_FREEZE",
                issue.message.replace("while snapshot was being built", "after snapshot freeze and before publication"),
                issue.context,
            ))

    if identity_uses_business_id_only:
        issues.append(ValidationIssue(
            "ERROR", "UNSAFE_BUSINESS_ID_IDENTITY",
            "Column A/business procurement_id is non-unique in real sources and cannot be the sole lookup identity",
        ))

    if unresolved_recommendation_reviews:
        issues.append(ValidationIssue(
            "ERROR", "RECOMMENDATION_REVIEW_QUEUE_NOT_EMPTY",
            f"{unresolved_recommendation_reviews} recommendation semantic review item(s) remain unresolved",
            {"count": unresolved_recommendation_reviews},
        ))

    if projection_model_matches is False:
        issues.append(ValidationIssue(
            "ERROR", "DERIVED_PROJECTION_MISMATCH",
            "Dashboard/consolidated projection does not reproduce the frozen source-derived ReportModel",
        ))

    if report_snapshot_id and dashboard_snapshot_id and report_snapshot_id != dashboard_snapshot_id:
        issues.append(ValidationIssue(
            "ERROR", "PROJECTION_SNAPSHOT_MISMATCH",
            "Report and dashboard/control projection were derived from different snapshots",
            {"report_snapshot_id": report_snapshot_id, "dashboard_snapshot_id": dashboard_snapshot_id},
        ))
    return issues


def validate_product_contract(report_model: dict, *, require_metric_contributors: bool = False) -> list[ValidationIssue]:
    """Product-layer gates restored from the full requirements baseline."""
    from .context import validate_narrative_notes
    from .narrative import validate_narrative_blocks
    from .traceability import validate_trace_records

    issues: list[ValidationIssue] = []
    snapshot = report_model.get("snapshot") or {}
    if snapshot.get("mode") == "FORENSIC_REPLAY":
        issues.append(ValidationIssue("ERROR", "FORENSIC_REPLAY_NOT_PUBLISHABLE",
                                      "FORENSIC_REPLAY cannot be used for an official publication"))

    notes = ((report_model.get("context") or {}).get("narrative_notes") or [])
    for code in validate_narrative_notes(notes):
        issues.append(ValidationIssue("ERROR", code.split(":", 1)[0], code))

    narratives = report_model.get("narratives") or {}
    for mode in ("GENERIC_TEMPLATE", "SMART_NARRATIVE"):
        if mode not in narratives:
            issues.append(ValidationIssue("ERROR", "NARRATIVE_MODE_MISSING", f"{mode} is missing"))
            continue
        for code in validate_narrative_blocks(narratives.get(mode) or []):
            issues.append(ValidationIssue("ERROR", code.split(":", 1)[0], code))
    if narratives.get("same_kpi_source") is not True:
        issues.append(ValidationIssue("ERROR", "NARRATIVE_KPI_SOURCE_NOT_SHARED",
                                      "GENERIC_TEMPLATE and SMART_NARRATIVE must project the same ReportModel KPIs"))

    for code in validate_trace_records(report_model.get("trace_records") or [],
                                       require_contributors_for_metrics=require_metric_contributors):
        issues.append(ValidationIssue("ERROR", code.split(":", 1)[0], code))

    pub = report_model.get("publication") or {}
    if pub.get("history_policy") != "previous official CANONICAL PUBLISHED snapshot only":
        issues.append(ValidationIssue("ERROR", "PUBLICATION_HISTORY_POLICY_MISSING",
                                      "Diff baseline must be selected from official published CANONICAL history"))
    for raw in report_model.get("product_contract_issues") or []:
        code = str(raw.get("code") if isinstance(raw, dict) else raw)
        if not code:
            continue
        issues.append(ValidationIssue("ERROR", code.split(":", 1)[0], code))
    return issues
