from __future__ import annotations


def structured_special_state(record: dict) -> str | None:
    """Strict replacement for free-text special flags in new data.

    Historical text parsing is migration evidence only. New production records must carry a structured state/event.
    """
    state = str(record.get("current_procurement_state") or "")
    target_year = record.get("target_year")
    if target_year == 2027 or state == "MOVED_TO_2027":
        return "MOVED_TO_2027"
    if state == "NO_FINANCING":
        return "CANCELLED_NO_FINANCING"
    if state == "POSTPONED":
        return "POSTPONED"
    if state == "PROCEDURE_FAILED":
        return "PROCEDURE_FAILED"
    if state == "REPROCURED":
        return "REPROCURED"
    return None


def text_derived_special_status(record: dict) -> bool:
    """True when the legacy status depends on unstructured text instead of structured state."""
    status = record.get("semantic_status")
    state = record.get("current_procurement_state")
    if status == "MOVED_TO_2027" and not (record.get("target_year") == 2027 or state == "MOVED_TO_2027"):
        return True
    if status == "CANCELLED_NO_FINANCING" and state != "NO_FINANCING":
        return True
    return bool(status == "POSTPONED" and state != "POSTPONED")
