from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Any

TRACKED_FIELDS = {
    "planned_date": "PLAN_DATE_CHANGED",
    "planned_quarter": "PLAN_QUARTER_CHANGED",
    "method": "METHOD_CHANGED",
    "plan_total": "PLAN_AMOUNT_CHANGED",
    "actual_date": "FACT_ADDED",
    "fact_total": "FACT_AMOUNT_CHANGED",
    "comment": "COMMENT_CHANGED",
    "status": "STATUS_CHANGED",
}


@dataclass(frozen=True)
class DiffEvent:
    event_type: str
    procurement_id: str
    before: Any = None
    after: Any = None
    field: str | None = None

    def as_dict(self):
        return asdict(self)


def _row_key(row: dict, id_field: str | None) -> str:
    if id_field:
        value = row.get(id_field)
        if value not in (None, ""):
            return str(value)
    physical = row.get("physical_row_key")
    if physical:
        return str(physical)
    value = row.get("procurement_id")
    if value in (None, ""):
        raise ValueError("DIFF_KEY_MISSING")
    return str(value)


def _index(rows: list[dict], id_field: str | None) -> dict[str, dict]:
    out: dict[str, dict] = {}
    for row in rows:
        key = _row_key(row, id_field)
        if key in out:
            raise ValueError(f"DUPLICATE_DIFF_KEY:{key}")
        out[key] = row
    return out


def diff_rows(previous: list[dict], current: list[dict], *, id_field: str | None = None) -> list[DiffEvent]:
    """Diff rows without silently collapsing duplicate business IDs.

    Default identity precedence is physical_row_key -> procurement_id. If procurement_id is not unique and
    physical provenance is unavailable, the diff fails closed instead of overwriting one row in a dict.
    Callers doing semantic replacement/merge comparison should pass an explicit semantic key produced by
    IdentityGraph, not raw column A.
    """
    p = _index(previous, id_field)
    c = _index(current, id_field)
    events: list[DiffEvent] = []
    for key in sorted(p.keys() - c.keys()):
        pid = str(p[key].get("procurement_id") or key)
        events.append(DiffEvent("ROW_REMOVED", pid, p[key], None))
    for key in sorted(c.keys() - p.keys()):
        pid = str(c[key].get("procurement_id") or key)
        events.append(DiffEvent("ROW_ADDED", pid, None, c[key]))
    for key in sorted(p.keys() & c.keys()):
        a, b = p[key], c[key]
        pid = str(b.get("procurement_id") or a.get("procurement_id") or key)
        for field, event_name in TRACKED_FIELDS.items():
            if a.get(field) == b.get(field):
                continue
            if field == "actual_date" and not a.get(field) and b.get(field):
                event_name = "FACT_ADDED"
            elif field == "actual_date" and a.get(field) and not b.get(field):
                event_name = "FACT_REMOVED"
            events.append(DiffEvent(event_name, pid, a.get(field), b.get(field), field))
    return events
