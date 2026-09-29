from __future__ import annotations

from dataclasses import dataclass

from .constants import COMPLETED_PROCEDURE_STATES, FACT_STATES
from .normalize import clean_text

STATUS_RU = {
    "OPEN": "ОТКРЫТО",
    "ACCEPTED_PENDING": "ПРИНЯТО, ОЖИДАЕТ ИСПОЛНЕНИЯ",
    "IMPLEMENTED": "РЕАЛИЗОВАНО",
    "IMPLEMENTED_AND_COMPLETED": "РЕАЛИЗОВАНО И ЗАВЕРШЕНО",
    "PARTIALLY_IMPLEMENTED": "ЧАСТИЧНО РЕАЛИЗОВАНО",
    "NOT_IMPLEMENTED": "НЕ РЕАЛИЗОВАНО",
    "CONTRACTED_EP": "НЕ РЕАЛИЗОВАНО — ЗАКЛЮЧЕНО С ЕП",
    "MERGED": "ОБЪЕДИНЕНО",
    "REMOVED_FROM_PLAN": "УДАЛЕНО ИЗ ПЛАНА",
    "CANCELLED_NO_FINANCING": "НЕ РЕАЛИЗОВАНО — НЕТ ФИНАНСИРОВАНИЯ",
    "POSTPONED": "ОТЛОЖЕНО",
    "MOVED_TO_2027": "ПЕРЕНЕСЕНО НА 2027",
    "PROCEDURE_FAILED": "ПРОЦЕДУРА НЕ СОСТОЯЛАСЬ",
    "REPROCURED": "ПЕРЕОБЪЯВЛЕНО",
    "SUPERSEDED": "ЗАМЕЩЕНО БОЛЕЕ ПОЗДНЕЙ ВЕРСИЕЙ",
}


@dataclass(frozen=True)
class RecommendationDecision:
    status: str
    reason: str


def _text_blob(r: dict) -> str:
    values = [
        r.get("recommendation_text"), r.get("grbs_response_original"), r.get("uer_decision_original"),
        r.get("status_evidence"), r.get("current_procurement_state")
    ]
    return " ".join(clean_text(v).casefold() for v in values if v is not None)


def _special_flags(r: dict) -> dict[str, bool]:
    t = _text_blob(r)
    return {
        "moved_2027": "2027" in t,
        "no_financing": any(x in t for x in ("нет финансирован", "отсутстви" + "е финансирован", "финансирование не")),
        "postponed": any(x in t for x in ("отлож", "перенес", "поздний срок")),
        "failed": any(x in t for x in ("нет заявок", "не состоял", "отмен")),
    }


def is_historically_accepted(r: dict) -> bool:
    """Migration-only compatibility rule for legacy accepted recommendations.

    New data should carry a semantic acceptance enum. This fallback exists only for migration.
    """
    if r.get("historical_acceptance") is not None:
        return bool(r.get("historical_acceptance"))
    text = clean_text(r.get("grbs_response_original")).casefold()
    return "позиция принята" in text or "учтут рекомендац" in text


def evaluate_recommendation(r: dict) -> RecommendationDecision:
    """Deterministic semantic state machine.

    Precedence is deliberate. A recommendation can be implemented at plan level even when the
    procurement is later postponed/no-funded; this is why method conversion is checked before
    cancellation for target-EA recommendations.
    """
    if not r.get("active_in_current_slice", True) or r.get("semantic_status") == "SUPERSEDED":
        return RecommendationDecision("SUPERSEDED", "historical record superseded by a later ledger version")

    typ = r.get("recommendation_type") or "OTHER"
    state = r.get("current_procurement_state") or ""
    method = r.get("current_method")
    current_ids = r.get("current_procurement_ids") or []
    reliable_codes = set((r.get("procedure_binding_reliable") or {}).get("reliable_codes") or [])
    flags = _special_flags(r)

    if flags["moved_2027"]:
        return RecommendationDecision("MOVED_TO_2027", "explicit 2027 postponement evidence")

    if state == "ABSENT_FROM_CURRENT_PLAN" and not current_ids:
        return RecommendationDecision("REMOVED_FROM_PLAN", "source procurement absent and no proven replacement")

    if typ == "MERGE_PROCUREMENTS":
        if state == "MERGED_PROCEDURE_COMPLETED" and reliable_codes:
            return RecommendationDecision("IMPLEMENTED_AND_COMPLETED", "merge proven and linked procedure completed")
        if state == "MERGED_JOINT_PROCUREMENT_NO_FACT":
            return RecommendationDecision("MERGED", "joint replacement procurement proven; completion not yet proven")
        if state in {"PROCEDURE_COMPLETED", "REPROCURED_AND_COMPLETED"} or str(method or "").startswith("MIXED:"):
            return RecommendationDecision("PARTIALLY_IMPLEMENTED", "competitive/procedure outcome exists but full merge semantics are not proven")
        if method == "ЭА" and state in {"POSTPONED", "IN_PLAN_NO_FACT", "NO_FINANCING"}:
            return RecommendationDecision("PARTIALLY_IMPLEMENTED", "competitive method reflected but merge/completion is not proven")
        if method == "ЕП" and state in FACT_STATES:
            return RecommendationDecision("CONTRACTED_EP", "recommendation not implemented; procurement executed as single-supplier")
        if flags["no_financing"]:
            return RecommendationDecision("CANCELLED_NO_FINANCING", "explicit no-financing evidence")
        if state == "POSTPONED" or flags["postponed"]:
            return RecommendationDecision("POSTPONED", "execution postponed")
        return RecommendationDecision("NOT_IMPLEMENTED", "merge recommendation is not evidenced as implemented")

    if typ in {"CHANGE_METHOD_EA", "CHANGE_METHOD_EP"}:
        # CHANGE_METHOD_EP is a legacy label for a recommendation to leave ЕП for a competitive method.
        if method == "ЭА" or (method not in {None, "", "ЕП"} and typ == "CHANGE_METHOD_EP"):
            if state in COMPLETED_PROCEDURE_STATES and reliable_codes:
                return RecommendationDecision("IMPLEMENTED_AND_COMPLETED", "target competitive method + reliable completed procedure")
            return RecommendationDecision("IMPLEMENTED", "target competitive method is reflected in the current plan")
        if method == "ЕП" and state in FACT_STATES:
            return RecommendationDecision("CONTRACTED_EP", "procurement executed/recorded as single-supplier")
        if state == "POSTPONED":
            return RecommendationDecision("POSTPONED", "structured current state says execution is postponed")
        if flags["no_financing"]:
            return RecommendationDecision("CANCELLED_NO_FINANCING", "explicit no-financing evidence while target method not implemented")
        if flags["postponed"]:
            return RecommendationDecision("POSTPONED", "execution postponed while target method not implemented")
        return RecommendationDecision("NOT_IMPLEMENTED", "target competitive method not evidenced")

    if state == "POSTPONED":
        return RecommendationDecision("POSTPONED", "structured current state says execution is postponed")
    if flags["no_financing"]:
        return RecommendationDecision("CANCELLED_NO_FINANCING", "explicit no-financing evidence")
    if flags["postponed"]:
        return RecommendationDecision("POSTPONED", "execution postponed")
    if state in COMPLETED_PROCEDURE_STATES and reliable_codes:
        return RecommendationDecision("IMPLEMENTED_AND_COMPLETED", "reliable completed procedure")
    if current_ids:
        return RecommendationDecision("OPEN", "recommendation remains in current slice without a more specific rule")
    return RecommendationDecision("REMOVED_FROM_PLAN", "no current procurement or replacement")


def replay_ledger(records: list[dict], *, preserve_evidence: bool = True) -> list[dict]:
    out: list[dict] = []
    for record in records:
        r = dict(record)
        d = evaluate_recommendation(r)
        r["semantic_status"] = d.status
        r["semantic_status_ru"] = STATUS_RU[d.status]
        if not preserve_evidence:
            r["status_evidence"] = d.reason
        out.append(r)
    return out
