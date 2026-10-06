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


def complete_trace_catalog(model):
    """Expected inventory, rebuilt from semantic entities, never from supplied traces.

    Includes zero metrics (an empty population is not a missing inventory), all
    departmental/quarter blocks, source explanations and active recommendation rows.
    The document-plan catalogue separately maps every emitted paragraph/table cell.
    """
    snap = model['snapshot']
    records = []

    def add(block, rule, *, metric=None, sources=(), recommendations=()):
        records.append(TraceRecord(block, str(snap['snapshot_id']), str(snap['rules_version']),
                                   str(snap['renderer_version']), rule, metric_key=metric,
                                   source_procurement_ids=tuple(sources),
                                   recommendation_ids=tuple(recommendations)).as_dict())

    for kind in ('competitive', 'single_supplier'):
        for scope in ('year', 'quarter'):
            for field in ('plan_count', 'fact_count', 'remain_count', 'plan_amount',
                          'fact_amount', 'remain_amount', 'execution_pct'):
                key = f'headline.{kind}.{scope}.{field}'
                add('metric.' + key, 'METRIC.PROJECTION', metric=key,
                    sources=model.get('metric_contributors', {}).get(key, []))
    content = model.get('report_content') or {}
    for group, departments in [('global', {'ALL': content.get('global', {})}),
                               ('by_grbs', content.get('by_grbs', {}))]:
        for department, kinds in departments.items():
            for kind, scopes in kinds.items():
                for scope, block in scopes.items():
                    base = f'report_content.{group}.' + (f'{department}.' if group == 'by_grbs' else '') + f'{kind}.{scope}'
                    add('section.' + base, 'METRIC.BUDGET_AND_POPULATION', metric=base,
                        sources=block.get('contributors', []))
    for record in model.get('recommendation_records', []):
        if record.get('active_in_current_slice'):
            add('recommendation.' + record['recommendation_id'], 'RECOMMENDATION.CURRENT_AND_HISTORY',
                recommendations=[record['recommendation_id']])
    for row in model.get('source_context', []):
        for entry in row['explanations']:
            add('context.' + row['source_row_key'] + '.' + entry['column'], 'SOURCE.ATTRIBUTED_EXPLANATION',
                sources=[row['source_row_key']])
    for mode in ('GENERIC_TEMPLATE', 'SMART_NARRATIVE'):
        records.extend(dict(block['trace']) for block in (model.get('narratives', {}).get(mode) or []))
    unique = {}
    for record in records:
        unique.setdefault(record['report_block_id'], record)
    return list(unique.values())
