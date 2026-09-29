from __future__ import annotations

from copy import deepcopy


def _base_envelope(report_model: dict, view: str) -> dict:
    snapshot = report_model.get("snapshot") or {}
    return {
        "view": view,
        "snapshot_id": snapshot.get("snapshot_id"),
        "report_date": snapshot.get("report_date"),
        "release": deepcopy(report_model.get("release")),
        "rules_version": snapshot.get("rules_version"),
        "renderer_version": snapshot.get("renderer_version"),
        "report_model_version": (report_model.get("contract") or {}).get("report_model_version"),
    }


def project_dashboard(report_model: dict) -> dict:
    """Dashboard projection with no independent KPI calculations."""
    out = _base_envelope(report_model, "dashboard")
    out.update({
        "headline": deepcopy(report_model.get("headline")),
        "metric_semantics": deepcopy(report_model.get("metric_semantics")),
        "recommendations": deepcopy(report_model.get("recommendations")),
        "procedures": deepcopy(report_model.get("procedures")),
        "issues": deepcopy(report_model.get("issues")),
        "diff": deepcopy(report_model.get("diff")),
        "trace_records": deepcopy(report_model.get("trace_records")),
        "publication": deepcopy(report_model.get("publication")),
        "comparison": deepcopy(report_model.get("comparison")),
        "monthly": deepcopy(report_model.get("monthly")),
        "future_plan": deepcopy(report_model.get("future_plan")),
        "metric_contributors": deepcopy(report_model.get("metric_contributors")),
        "details": deepcopy(report_model.get("details")),
        "exact_metrics": deepcopy(report_model.get("exact_metrics")),
        "calendar_fact": deepcopy(report_model.get("calendar_fact")),
        "period_contract": deepcopy(report_model.get("period_contract")),
        "independent_audit": deepcopy(report_model.get("independent_audit")),
        "report_clock": deepcopy(report_model.get("report_clock")),
        "closed_procedure_quality": deepcopy(report_model.get("closed_procedure_quality")),
        "identity_observations": deepcopy(report_model.get("identity_observations")),
        "formula_dependencies": deepcopy(report_model.get("formula_dependencies")),
    })
    return out


def project_main_view(report_model: dict, *, mode: str = "GENERIC_TEMPLATE") -> dict:
    out = _base_envelope(report_model, "main")
    narratives = report_model.get("narratives") or {}
    out.update({
        "headline": deepcopy(report_model.get("headline")),
        "recommendations": deepcopy(report_model.get("recommendations")),
        "procedures": deepcopy(report_model.get("procedures")),
        "narrative": deepcopy(narratives.get(mode) or []),
        "trace_records": deepcopy(report_model.get("trace_records")),
    })
    return out


def project_management_view(report_model: dict) -> dict:
    out = _base_envelope(report_model, "management")
    smart = (report_model.get("narratives") or {}).get("SMART_NARRATIVE") or []
    out.update({
        "headline": deepcopy(report_model.get("headline")),
        "narrative": [deepcopy(x) for x in smart if x.get("stage") in {"explain", "judge", "act"}],
        "issues": deepcopy(report_model.get("issues")),
        "diff": deepcopy(report_model.get("diff")),
        "publication": deepcopy(report_model.get("publication")),
        "trace_records": deepcopy(report_model.get("trace_records")),
    })
    return out


def assert_projection_parity(report_model: dict, *projections: dict) -> None:
    expected = (report_model.get("snapshot") or {}).get("snapshot_id")
    headline = report_model.get("headline")
    for p in projections:
        if p.get("snapshot_id") != expected:
            raise ValueError("PROJECTION_SNAPSHOT_MISMATCH")
        if p.get("headline") != headline:
            raise ValueError("PROJECTION_HEADLINE_MISMATCH")
