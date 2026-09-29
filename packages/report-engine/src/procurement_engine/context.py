from __future__ import annotations

from collections.abc import Iterable
from dataclasses import asdict, dataclass
from typing import Any

ALLOWED_NOTE_TYPES = {"CONTEXT", "EXPLANATION", "MANAGEMENT_ACTION", "DATA_QUALITY_NOTE"}
ALLOWED_ANCHORS = {"GLOBAL", "COMPETITIVE", "SINGLE_SUPPLIER", "RECOMMENDATIONS", "PROCEDURES", "GRBS", "DATA_QUALITY"}


@dataclass(frozen=True)
class NarrativeNote:
    """Typed human/context input that is presentation-only.

    Notes can explain or request action, but they cannot alter KPI values, row inclusion,
    procedure binding or recommendation state. Those belong to RuleCatalog / reviewed events.
    """

    note_id: str
    text: str
    note_type: str = "CONTEXT"
    anchor: str = "GLOBAL"
    source_ref: str = ""
    created_at: str = ""
    author: str = ""
    grbs: str | None = None
    evidence_ids: tuple[str, ...] = ()
    active: bool = True

    def as_dict(self) -> dict[str, Any]:
        d = asdict(self)
        d["impact"] = "PRESENTATION_ONLY"
        return d


def validate_narrative_notes(notes: Iterable[NarrativeNote | dict]) -> list[str]:
    errors: list[str] = []
    seen: set[str] = set()
    for raw in notes:
        if isinstance(raw, NarrativeNote):
            n = raw
        else:
            data = dict(raw)
            data.pop("impact", None)
            n = NarrativeNote(**data)
        if not n.note_id:
            errors.append("NARRATIVE_NOTE_ID_MISSING")
        elif n.note_id in seen:
            errors.append(f"NARRATIVE_NOTE_ID_DUPLICATE:{n.note_id}")
        seen.add(n.note_id)
        if not n.text.strip():
            errors.append(f"NARRATIVE_NOTE_TEXT_MISSING:{n.note_id}")
        if n.note_type not in ALLOWED_NOTE_TYPES:
            errors.append(f"NARRATIVE_NOTE_TYPE_UNKNOWN:{n.note_id}:{n.note_type}")
        if n.anchor not in ALLOWED_ANCHORS:
            errors.append(f"NARRATIVE_NOTE_ANCHOR_UNKNOWN:{n.note_id}:{n.anchor}")
        # A human note is itself a typed source when author/time/source are present. If all are
        # absent, evidence_ids are required to prevent anonymous unsupported claims.
        if not (n.source_ref or n.created_at or n.author or n.evidence_ids):
            errors.append(f"NARRATIVE_NOTE_PROVENANCE_MISSING:{n.note_id}")
    return errors
