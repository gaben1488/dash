from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Any

from .normalize import clean_text


@dataclass(frozen=True)
class RecommendationDimensions:
    compliance_status: str
    execution_status: str
    grouping_status: str
    evidence_quality: str
    reasons: tuple[str, ...] = ()

    def as_dict(self) -> dict[str, Any]:
        return asdict(self)


def _current_text(record: dict) -> str:
    """Current-state text only. Historical recommendation/response text is deliberately excluded."""
    vals = [
        record.get("current_deviation_reason"), record.get("current_grbs_comment"),
        record.get("current_monitoring_note"), record.get("current_procurement_state"),
    ]
    return " ".join(clean_text(v).casefold() for v in vals if v is not None)


def _structured_execution(record: dict) -> str | None:
    state = str(record.get("current_procurement_state") or "").upper()
    target_year = record.get("target_year")
    if state in {"COMPLETED", "PROCEDURE_COMPLETED", "REPROCURED_AND_COMPLETED"}:
        return "COMPLETED"
    if state in {"CONTRACTED_EP", "FACT_EP"}:
        return "CONTRACTED_EP"
    if state in {"NO_FINANCING", "CANCELLED_NO_FINANCING"}:
        return "NO_FINANCING"
    if state == "POSTPONED":
        return "POSTPONED"
    if state == "MOVED_TO_2027" or target_year == 2027:
        return "MOVED_TO_2027"
    if state == "PROCEDURE_FAILED":
        return "PROCEDURE_FAILED"
    if state == "REPROCURED":
        return "REPROCURED"
    if state == "ABSENT_FROM_CURRENT_PLAN":
        return "REMOVED_FROM_PLAN"
    if state in {"IN_PLAN_NO_FACT", "PLANNED", "MERGED_JOINT_PROCUREMENT_NO_FACT"}:
        return "PLANNED"
    return None


def _legacy_current_execution(record: dict) -> tuple[str, str]:
    """Migration-only inference from CURRENT source fields, never historical response/decision text."""
    text = _current_text(record)
    if not text:
        return "UNKNOWN", "NONE"
    if any(x in text for x in ("нет финансирован", "отсутствует финансирован", "отсутствием финансирован")):
        if any(x in text for x in ("перенос", "планируется на", "планируемый срок")):
            return "NO_FINANCING_POSTPONED", "TEXT_DERIVED_CURRENT"
        return "NO_FINANCING", "TEXT_DERIVED_CURRENT"
    if "2027" in text and any(x in text for x in ("в план на 2027", "запланировано", "планового периода", "перенес")):
        return "MOVED_TO_2027", "TEXT_DERIVED_CURRENT"
    if any(x in text for x in ("перенос", "отлож", "планируется на", "планируемый срок")):
        return "POSTPONED", "TEXT_DERIVED_CURRENT"
    return "UNKNOWN", "NONE"


def evaluate_dimensions(record: dict) -> RecommendationDimensions:
    """V2 semantics: recommendation compliance and procurement execution are independent axes.

    This prevents a plan-level method change from erasing a simultaneous no-financing/postponement state.
    Historical free text is never used as current evidence here.
    """
    typ = record.get("recommendation_type") or "OTHER"
    method = record.get("current_method")
    state = str(record.get("current_procurement_state") or "")
    active = record.get("active_in_current_slice", True)
    current_ids = record.get("current_procurement_ids") or []
    reliable = set((record.get("procedure_binding_reliable") or {}).get("reliable_codes") or [])

    if not active or record.get("semantic_status") == "SUPERSEDED":
        return RecommendationDimensions("SUPERSEDED", "SUPERSEDED", "NONE", "STRUCTURED", ("historical version superseded",))

    # Compliance axis.
    grouping = "NONE"
    reasons: list[str] = []
    if typ == "MERGE_PROCUREMENTS":
        if state in {"MERGED_JOINT_PROCUREMENT_NO_FACT", "MERGED_PROCEDURE_COMPLETED"}:
            compliance = "IMPLEMENTED"
            grouping = "MERGED"
            reasons.append("joint replacement procurement proven")
        elif str(method or "").startswith("MIXED:") or state in {"PROCEDURE_COMPLETED", "REPROCURED_AND_COMPLETED"}:
            compliance = "PARTIAL"
            grouping = "PARTIAL_MERGE"
            reasons.append("competitive/procedure evidence exists but full merge is not proven")
        elif method == "ЭА":
            compliance = "PARTIAL"
            grouping = "PARTIAL_MERGE"
            reasons.append("competitive method exists but merge relation is not proven")
        elif current_ids:
            compliance = "NOT_IMPLEMENTED"
            reasons.append("merge relation not evidenced")
        else:
            compliance = "UNKNOWN"
    elif typ in {"CHANGE_METHOD_EA", "CHANGE_METHOD_EP"}:
        target_competitive = method == "ЭА" or (typ == "CHANGE_METHOD_EP" and method not in {None, "", "ЕП"})
        if target_competitive:
            compliance = "IMPLEMENTED"
            reasons.append("target competitive method reflected in current plan")
        elif method == "ЕП":
            compliance = "NOT_IMPLEMENTED"
            reasons.append("current method remains single-supplier")
        else:
            compliance = "UNKNOWN"
    else:
        compliance = "OPEN" if current_ids else "UNKNOWN"

    # Execution axis: structured state first, then objective fact/procedure, then current-source migration text.
    execution = _structured_execution(record)
    quality = "STRUCTURED" if execution else "NONE"
    # A generic structured presence state (PLANNED/IN_PLAN_NO_FACT) does not erase a more specific
    # current-source execution constraint such as no financing/postponement. Historical text remains excluded.
    if execution == "PLANNED":
        text_execution, text_quality = _legacy_current_execution(record)
        if text_execution != "UNKNOWN":
            execution = text_execution
            quality = "STRUCTURED_PRESENCE+" + text_quality
    if execution is None:
        facts = record.get("current_fact_date") or []
        if facts:
            execution = "COMPLETED" if method != "ЕП" else "CONTRACTED_EP"
            quality = "STRUCTURED_FACT_DATE"
        elif reliable and state in {"PROCEDURE_COMPLETED", "MERGED_PROCEDURE_COMPLETED", "REPROCURED_AND_COMPLETED"}:
            execution = "COMPLETED"
            quality = "RELIABLE_PROCEDURE"
        else:
            execution, quality = _legacy_current_execution(record)
            if execution == "UNKNOWN" and current_ids:
                execution = "PLANNED"
                quality = "STRUCTURED_PRESENCE"
            elif execution == "UNKNOWN" and not current_ids:
                execution = "REMOVED_FROM_PLAN"
                quality = "STRUCTURED_ABSENCE"

    return RecommendationDimensions(compliance, execution, grouping, quality, tuple(reasons))
