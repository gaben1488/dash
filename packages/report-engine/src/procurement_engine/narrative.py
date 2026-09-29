from __future__ import annotations

import re
from collections.abc import Iterable
from dataclasses import asdict, dataclass
from typing import Any

from .context import NarrativeNote
from .traceability import TraceRecord

GENERIC_TEMPLATE = "GENERIC_TEMPLATE"
SMART_NARRATIVE = "SMART_NARRATIVE"
NARRATIVE_MODES = {GENERIC_TEMPLATE, SMART_NARRATIVE}
STAGES = ("describe", "explain", "judge", "act")


@dataclass(frozen=True)
class SectorProfile:
    profile_id: str
    label: str
    priority_issue_codes: tuple[str, ...] = ()
    preferred_action_verbs: tuple[str, ...] = ()

    def as_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(frozen=True)
class NarrativeBlock:
    block_id: str
    stage: str
    text: str
    semantic_key: str
    trace: TraceRecord
    profile_id: str | None = None

    def as_dict(self) -> dict[str, Any]:
        d = asdict(self)
        d["trace"] = self.trace.as_dict()
        return d


def _norm_text(value: str) -> str:
    return re.sub(r"\s+", " ", value.strip().casefold())


def deduplicate_blocks(blocks: Iterable[NarrativeBlock]) -> list[NarrativeBlock]:
    """Remove duplicate semantic claims while preserving stage order and first evidence-bound phrasing."""
    seen_semantic: set[tuple[str, str]] = set()
    seen_text: set[tuple[str, str]] = set()
    out: list[NarrativeBlock] = []
    for b in blocks:
        semantic = (b.stage, b.semantic_key) if b.semantic_key else None
        text_key = (b.stage, _norm_text(b.text))
        if (semantic and semantic in seen_semantic) or text_key in seen_text:
            continue
        if semantic:
            seen_semantic.add(semantic)
        seen_text.add(text_key)
        out.append(b)
    return out


def _fmt_num(value: float | None, decimals: int = 2) -> str:
    if value is None:
        return "н/д"
    if isinstance(value, int) or (isinstance(value, float) and value.is_integer() and decimals == 0):
        return f"{int(value):,}".replace(",", " ")
    return f"{float(value):,.{decimals}f}".replace(",", " ").replace(".", ",")


def _metric_trace(report_model: dict, block_id: str, *metric_keys: str, template_rule_id: str) -> TraceRecord:
    snapshot = report_model["snapshot"]
    contributor_index = report_model.get("metric_contributors") or {}
    contributors: list[str] = []
    for key in metric_keys:
        contributors.extend(str(x) for x in contributor_index.get(key, []) if x not in (None, ""))
    return TraceRecord(
        report_block_id=block_id,
        metric_key="|".join(metric_keys),
        source_procurement_ids=tuple(dict.fromkeys(contributors)),
        snapshot_id=str(snapshot.get("snapshot_id") or ""),
        rules_version=str(snapshot.get("rules_version") or ""),
        renderer_version=str(snapshot.get("renderer_version") or ""),
        template_rule_id=template_rule_id,
    )


def _headline_descriptions(report_model: dict, *, profile_id: str | None = None) -> list[NarrativeBlock]:
    h = report_model["headline"]
    q = int(h["current_quarter"])
    blocks: list[NarrativeBlock] = []
    for kind, label in (("competitive", "Конкурентные закупки"), ("single_supplier", "Единственный поставщик")):
        year = h[kind]["year"]
        quarter = h[kind]["quarter"]
        prefix = f"headline.{kind}"
        year_keys = tuple(f"{prefix}.year.{x}" for x in ("plan_count", "fact_count", "plan_amount", "fact_amount", "execution_pct"))
        q_keys = tuple(f"{prefix}.quarter.{x}" for x in ("plan_count", "fact_count", "remain_count", "execution_pct"))
        bid = f"nar.describe.{kind}.year"
        text = (
            f"{label}: годовой план — {_fmt_num(year['plan_count'], 0)} позиций на {_fmt_num(year['plan_amount'])} тыс. руб.; "
            f"исполнено {_fmt_num(year['fact_count'], 0)} позиций на {_fmt_num(year['fact_amount'])} тыс. руб."
        )
        blocks.append(NarrativeBlock(bid, "describe", text, f"{kind}:year-headline",
                                     _metric_trace(report_model, bid, *year_keys, template_rule_id="NAR.GENERIC.YEAR_HEADLINE"), profile_id))
        bid = f"nar.describe.{kind}.q{q}"
        pct = quarter.get("execution_pct")
        text = (
            f"{q} квартал: {_fmt_num(quarter['fact_count'], 0)} из {_fmt_num(quarter['plan_count'], 0)}; "
            f"исполнение {_fmt_num(pct) if pct is not None else 'н/д'}%; осталось {_fmt_num(quarter['remain_count'], 0)}."
        )
        blocks.append(NarrativeBlock(bid, "describe", text, f"{kind}:current-quarter",
                                     _metric_trace(report_model, bid, *q_keys, template_rule_id="NAR.GENERIC.CURRENT_QUARTER"), profile_id))
    return blocks


def build_generic_narrative(report_model: dict, *, notes: Iterable[NarrativeNote | dict] = (),
                            sector_profile: SectorProfile | None = None) -> list[NarrativeBlock]:
    """Deterministic report narrative. It only projects values already present in ReportModel."""
    profile_id = sector_profile.profile_id if sector_profile else None
    blocks = _headline_descriptions(report_model, profile_id=profile_id)
    snapshot = report_model["snapshot"]
    for raw in notes:
        n = raw if isinstance(raw, NarrativeNote) else NarrativeNote(**raw)
        if not n.active or n.note_type not in {"CONTEXT", "DATA_QUALITY_NOTE"}:
            continue
        bid = f"nar.context.{n.note_id}"
        trace = TraceRecord(
            report_block_id=bid,
            narrative_note_ids=(n.note_id,),
            source_procurement_ids=tuple(n.evidence_ids),
            snapshot_id=str(snapshot.get("snapshot_id") or ""),
            rules_version=str(snapshot.get("rules_version") or ""),
            renderer_version=str(snapshot.get("renderer_version") or ""),
            template_rule_id="NAR.GENERIC.CONTEXT_NOTE",
        )
        blocks.append(NarrativeBlock(bid, "explain", n.text.strip(), f"note:{n.note_id}", trace, profile_id))
    return deduplicate_blocks(blocks)


def build_smart_narrative(report_model: dict, *, diff_events: Iterable[dict] = (), issues: Iterable[dict] = (),
                          notes: Iterable[NarrativeNote | dict] = (), sector_profile: SectorProfile | None = None) -> list[NarrativeBlock]:
    """Evidence-bound SMART narrative using describe -> explain -> judge -> act.

    It may prioritize and verbalize ReportModel evidence, but must not create a KPI, binding,
    recommendation state or factual event. Actions appear only from typed MANAGEMENT_ACTION notes.
    """
    profile_id = sector_profile.profile_id if sector_profile else None
    snapshot = report_model["snapshot"]
    blocks = _headline_descriptions(report_model, profile_id=profile_id)

    diffs = list(diff_events)
    if diffs:
        by_type: dict[str, int] = {}
        pids: list[str] = []
        for d in diffs:
            typ = str(d.get("event_type") or "UNKNOWN")
            by_type[typ] = by_type.get(typ, 0) + 1
            if d.get("procurement_id"):
                pids.append(str(d["procurement_id"]))
        parts = [f"{k}: {v}" for k, v in sorted(by_type.items())]
        bid = "nar.explain.snapshot-diff"
        trace = TraceRecord(
            report_block_id=bid,
            source_procurement_ids=tuple(dict.fromkeys(pids)),
            snapshot_id=str(snapshot.get("snapshot_id") or ""),
            rules_version=str(snapshot.get("rules_version") or ""),
            renderer_version=str(snapshot.get("renderer_version") or ""),
            template_rule_id="NAR.SMART.DIFF_EXPLANATION",
        )
        publication = report_model.get("publication") or {}
        previous_date = publication.get("previous_official_report_date")
        previous_id = publication.get("previous_official_snapshot_id")
        if previous_date and previous_id:
            prefix = f"Изменения относительно официального опубликованного среза от {previous_date}: "
        else:
            prefix = "Переданные изменения относительно базового среза: "
        blocks.append(NarrativeBlock(bid, "explain", prefix + "; ".join(parts) + ".",
                                     "smart:diff-summary", trace, profile_id))

    issue_rows = list(issues)
    serious = [x for x in issue_rows if str(x.get("severity") or "").upper() in {"ERROR", "BLOCKER", "HIGH"}]
    if serious:
        ids = [str(x.get("id") or x.get("code") or f"issue-{i}") for i, x in enumerate(serious, 1)]
        bid = "nar.judge.release-risk"
        trace = TraceRecord(
            report_block_id=bid,
            issue_ids=tuple(ids),
            snapshot_id=str(snapshot.get("snapshot_id") or ""),
            rules_version=str(snapshot.get("rules_version") or ""),
            renderer_version=str(snapshot.get("renderer_version") or ""),
            template_rule_id="NAR.SMART.EVIDENCE_JUDGMENT",
        )
        blocks.append(NarrativeBlock(
            bid, "judge",
            f"До публикации требуется устранить {_fmt_num(len(serious), 0)} блокирующих или высокоприоритетных замечаний, перечисленных в validation layer.",
            "smart:release-risk", trace, profile_id,
        ))

    # Context explanations and explicit human management actions. No auto-invented actions.
    for raw in notes:
        n = raw if isinstance(raw, NarrativeNote) else NarrativeNote(**raw)
        if not n.active:
            continue
        stage = "act" if n.note_type == "MANAGEMENT_ACTION" else "explain"
        bid = f"nar.{stage}.{n.note_id}"
        trace = TraceRecord(
            report_block_id=bid,
            narrative_note_ids=(n.note_id,),
            source_procurement_ids=tuple(n.evidence_ids),
            snapshot_id=str(snapshot.get("snapshot_id") or ""),
            rules_version=str(snapshot.get("rules_version") or ""),
            renderer_version=str(snapshot.get("renderer_version") or ""),
            template_rule_id="NAR.SMART.MANAGEMENT_ACTION" if stage == "act" else "NAR.SMART.CONTEXT_EXPLANATION",
        )
        blocks.append(NarrativeBlock(bid, stage, n.text.strip(), f"note:{n.note_id}", trace, profile_id))

    order = {stage: i for i, stage in enumerate(STAGES)}
    deduped = deduplicate_blocks(blocks)
    deduped.sort(key=lambda x: (order.get(x.stage, 99), x.block_id))
    return deduped


def validate_narrative_blocks(blocks: Iterable[NarrativeBlock | dict]) -> list[str]:
    errors: list[str] = []
    seen: set[str] = set()
    for raw in blocks:
        if isinstance(raw, NarrativeBlock):
            b = raw
            trace = b.trace
        else:
            trace_raw = raw.get("trace") or {}
            b = NarrativeBlock(
                block_id=str(raw.get("block_id") or ""), stage=str(raw.get("stage") or ""),
                text=str(raw.get("text") or ""), semantic_key=str(raw.get("semantic_key") or ""),
                trace=TraceRecord(**trace_raw), profile_id=raw.get("profile_id"),
            )
            trace = b.trace
        if not b.block_id or b.block_id in seen:
            errors.append(f"NARRATIVE_BLOCK_ID_INVALID:{b.block_id}")
        seen.add(b.block_id)
        if b.stage not in STAGES:
            errors.append(f"NARRATIVE_STAGE_UNKNOWN:{b.block_id}:{b.stage}")
        if not b.text.strip():
            errors.append(f"NARRATIVE_TEXT_MISSING:{b.block_id}")
        if not trace.has_evidence:
            errors.append(f"NARRATIVE_EVIDENCE_MISSING:{b.block_id}")
    return errors
