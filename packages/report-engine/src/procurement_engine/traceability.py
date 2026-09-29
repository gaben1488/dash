from __future__ import annotations

from collections.abc import Iterable
from dataclasses import asdict, dataclass
from typing import Any


@dataclass(frozen=True)
class TraceRecord:
    """Evidence link for one published metric/block.

    A trace record never stores a computed value. It identifies the already-computed
    ReportModel field and the evidence entities that contributed to it.
    """

    report_block_id: str
    snapshot_id: str
    rules_version: str
    renderer_version: str
    template_rule_id: str
    metric_key: str | None = None
    source_procurement_ids: tuple[str, ...] = ()
    operational_event_ids: tuple[str, ...] = ()
    procedure_ids: tuple[str, ...] = ()
    recommendation_ids: tuple[str, ...] = ()
    narrative_note_ids: tuple[str, ...] = ()
    issue_ids: tuple[str, ...] = ()

    def as_dict(self) -> dict[str, Any]:
        return asdict(self)

    @property
    def has_evidence(self) -> bool:
        return bool(
            self.metric_key
            or self.source_procurement_ids
            or self.operational_event_ids
            or self.procedure_ids
            or self.recommendation_ids
            or self.narrative_note_ids
            or self.issue_ids
        )


def metric_trace(*, block_id: str, metric_key: str, snapshot: dict,
                 contributor_index: dict[str, Iterable[str]] | None = None,
                 template_rule_id: str = "METRIC.PROJECTION") -> TraceRecord:
    contributor_index = contributor_index or {}
    contributors = tuple(str(x) for x in contributor_index.get(metric_key, ()) if x not in (None, ""))
    return TraceRecord(
        report_block_id=block_id,
        metric_key=metric_key,
        source_procurement_ids=contributors,
        snapshot_id=str(snapshot.get("snapshot_id") or ""),
        rules_version=str(snapshot.get("rules_version") or ""),
        renderer_version=str(snapshot.get("renderer_version") or ""),
        template_rule_id=template_rule_id,
    )


def validate_trace_records(records: Iterable[TraceRecord | dict], *, require_contributors_for_metrics: bool = False) -> list[str]:
    errors: list[str] = []
    seen: set[str] = set()
    for raw in records:
        r = raw if isinstance(raw, TraceRecord) else TraceRecord(**raw)
        if not r.report_block_id:
            errors.append("TRACE_BLOCK_ID_MISSING")
            continue
        if r.report_block_id in seen:
            errors.append(f"TRACE_BLOCK_ID_DUPLICATE:{r.report_block_id}")
        seen.add(r.report_block_id)
        if not r.snapshot_id:
            errors.append(f"TRACE_SNAPSHOT_ID_MISSING:{r.report_block_id}")
        if not r.rules_version:
            errors.append(f"TRACE_RULES_VERSION_MISSING:{r.report_block_id}")
        if not r.renderer_version:
            errors.append(f"TRACE_RENDERER_VERSION_MISSING:{r.report_block_id}")
        if not r.template_rule_id:
            errors.append(f"TRACE_TEMPLATE_RULE_ID_MISSING:{r.report_block_id}")
        if not r.has_evidence:
            errors.append(f"TRACE_EVIDENCE_MISSING:{r.report_block_id}")
        if require_contributors_for_metrics and r.metric_key and not r.source_procurement_ids and not r.recommendation_ids and not r.procedure_ids:
            errors.append(f"TRACE_CONTRIBUTORS_MISSING:{r.report_block_id}")
    return errors
