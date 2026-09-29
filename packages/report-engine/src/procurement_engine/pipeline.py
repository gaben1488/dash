from __future__ import annotations

from .report_model import (
    build_report_model,
    build_report_model_v2,
    build_report_model_v3,
)
from .validation import validation_report


class PublishBlocked(RuntimeError):
    pass


def build_publishable_report_model(snapshot: dict, ledger: list[dict], summary: dict | None = None) -> tuple[dict, dict]:
    """Single publication gate. Renderers should receive output only from this function."""
    qa = validation_report(snapshot, ledger, summary)
    if not qa["pass"]:
        codes = ", ".join(i["code"] for i in qa["issues"] if i["severity"] == "ERROR")
        raise PublishBlocked(f"Publication blocked by validation errors: {codes}")
    return build_report_model(snapshot, ledger), qa


def build_publishable_report_model_v2(snapshot: dict, ledger: list[dict], *, summary: dict | None = None,
                                      source_before: dict[str, str | None],
                                      source_after: dict[str, str | None],
                                      raw_issues, binding_uses, recommendation_replay_proven: bool,
                                      renderer_input_files: list[str] | None = None,
                                      source_at_publish: dict[str, str | None] | None = None,
                                      identity_uses_business_id_only: bool = False,
                                      unresolved_recommendation_reviews: int = 0,
                                      dashboard_snapshot_id: str | None = None,
                                      projection_model_matches: bool | None = None,
                                      input_contract_issues=None) -> tuple[dict, dict]:
    """Production publication gate after the 29.09 forensic QA.

    This composes domain validation with live-source/release validation. Renderers must consume only
    the returned ReportModel and never previous Word documents.
    """
    from .release_gates import validate_release_v2
    qa = validation_report(snapshot, ledger, summary)
    candidate_model = build_report_model_v2(snapshot, ledger)
    release_issues = validate_release_v2(
        source_before=source_before, source_after=source_after, raw_issues=raw_issues,
        binding_uses=binding_uses, recommendation_replay_proven=recommendation_replay_proven,
        report_model=candidate_model,
        renderer_input_files=renderer_input_files or [],
        report_snapshot_id=snapshot.get("snapshot_id"), dashboard_snapshot_id=dashboard_snapshot_id,
        source_at_publish=source_at_publish,
        identity_uses_business_id_only=identity_uses_business_id_only,
        unresolved_recommendation_reviews=unresolved_recommendation_reviews,
        projection_model_matches=projection_model_matches,
        input_contract_issues=input_contract_issues,
        require_report_metadata=True,
    )
    errors = [x for x in qa["issues"] if x["severity"] == "ERROR"] + [x.as_dict() for x in release_issues if x.severity == "ERROR"]
    if errors:
        codes = ", ".join(x["code"] for x in errors)
        raise PublishBlocked(f"Publication blocked by validation/release errors: {codes}")
    return candidate_model, {"domain": qa, "release_issues": [x.as_dict() for x in release_issues]}


def build_publishable_report_model_v3(snapshot: dict, ledger: list[dict], *, summary: dict | None = None,
                                      source_before: dict[str, str | None], source_after: dict[str, str | None],
                                      raw_issues=(), binding_uses=(), recommendation_replay_proven: bool,
                                      renderer_input_files: list[str] | None = None,
                                      source_at_publish: dict[str, str | None] | None = None,
                                      identity_uses_business_id_only: bool = False,
                                      unresolved_recommendation_reviews: int = 0,
                                      dashboard_snapshot_id: str | None = None, projection_model_matches: bool | None = None,
                                      input_contract_issues=None, identity_issues=None,
                                      contributor_index: dict[str, list[str]] | None = None,
                                      narrative_notes=(), diff_events=(), issues=(), procedures=(), publication_history=(),
                                      sector_profile=None, require_metric_contributors: bool = False) -> tuple[dict, dict]:
    """Publication gate for the v1.2 product layer.

    The semantic v1.1 validation remains authoritative. Product-layer narrative/history/trace
    gates are added on top and cannot weaken any forensic/source gate.
    """
    from .release_gates import validate_product_contract, validate_release_v2

    qa = validation_report(snapshot, ledger, summary)
    candidate_model = build_report_model_v3(
        snapshot, ledger, contributor_index=contributor_index, narrative_notes=narrative_notes,
        diff_events=diff_events, issues=issues, procedures=procedures, publication_history=publication_history,
        sector_profile=sector_profile,
    )
    release_issues = validate_release_v2(
        source_before=source_before, source_after=source_after, raw_issues=raw_issues,
        binding_uses=binding_uses, recommendation_replay_proven=recommendation_replay_proven,
        report_model=candidate_model, renderer_input_files=renderer_input_files or [],
        report_snapshot_id=snapshot.get("snapshot_id"), dashboard_snapshot_id=dashboard_snapshot_id,
        source_at_publish=source_at_publish, identity_uses_business_id_only=identity_uses_business_id_only,
        unresolved_recommendation_reviews=unresolved_recommendation_reviews,
        projection_model_matches=projection_model_matches, input_contract_issues=input_contract_issues,
        identity_issues=identity_issues, require_report_metadata=True,
    )
    product_issues = validate_product_contract(candidate_model, require_metric_contributors=require_metric_contributors)
    errors = [x for x in qa["issues"] if x["severity"] == "ERROR"]
    errors += [x.as_dict() for x in release_issues + product_issues if x.severity == "ERROR"]
    if errors:
        codes = ", ".join(x["code"] for x in errors)
        raise PublishBlocked(f"Publication blocked by validation/release/product errors: {codes}")
    return candidate_model, {
        "domain": qa,
        "release_issues": [x.as_dict() for x in release_issues],
        "product_issues": [x.as_dict() for x in product_issues],
    }
