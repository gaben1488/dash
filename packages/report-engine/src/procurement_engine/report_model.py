from __future__ import annotations

from collections import Counter, defaultdict

from .constants import GRBS_ORDER
from .metrics import headline_from_snapshot
from .recommendations import is_historically_accepted


def build_report_model(snapshot: dict, ledger: list[dict]) -> dict:
    active = [r for r in ledger if r.get("active_in_current_slice")]
    grouped: dict[int, list[dict]] = defaultdict(list)
    for r in active:
        grouped[int(r.get("table_no") or 0)].append(r)
    for rows in grouped.values():
        rows.sort(key=lambda r: (int(r.get("row_no") or 0), r.get("recommendation_id") or ""))

    status_counts = Counter(r["semantic_status"] for r in active)
    reliable_linked = sum(bool((r.get("procedure_binding_reliable") or {}).get("reliable_codes") or []) for r in active)
    completed = sum(r.get("semantic_status") == "IMPLEMENTED_AND_COMPLETED" for r in active)

    renderer_tables = {}
    for table_no, rows in sorted(grouped.items()):
        projected = []
        for r in rows:
            original = (r.get("uer_decision_original") or "").strip()
            status_line = f"Статус на {snapshot.get('report_date')}: {r.get('semantic_status_ru')}. {r.get('status_evidence') or ''}".strip()
            decision = original + ("\n" if original else "") + status_line
            projected.append({
                "row_no": r.get("row_no"),
                "recommendation_id": r.get("recommendation_id"),
                "recommendation": r.get("recommendation_text") or "",
                "grbs_response": r.get("grbs_response_original") or "",
                "uer_decision_and_current_status": decision,
            })
        renderer_tables[str(table_no)] = projected

    return {
        "snapshot": {
            "snapshot_id": snapshot.get("snapshot_id"),
            "cutoff_at": snapshot.get("cutoff_at") or snapshot.get("captured_at"),
            "captured_at": snapshot.get("captured_at"),
            "report_date": snapshot.get("report_date"),
            "report_year": snapshot.get("report_year"),
            "timezone": snapshot.get("timezone"),
            "row_count": snapshot.get("row_count"),
            "rules_version": snapshot.get("rules_version"),
            "renderer_version": snapshot.get("renderer_version"),
            "snapshot_contract_version": snapshot.get("snapshot_contract_version"),
            "mode": snapshot.get("mode"),
        },
        "headline": headline_from_snapshot(snapshot),
        "active_procedures_count": snapshot.get("active_procedures"),
        "operational_events": snapshot.get("operational_events") or [],
        "recommendations": {
            "historical_unique": len(ledger),
            "active": len(active),
            "superseded": sum(not r.get("active_in_current_slice") for r in ledger),
            "historically_accepted": sum(is_historically_accepted(r) for r in active),
            "status_counts": dict(sorted(status_counts.items())),
            "reliable_procedure_links": reliable_linked,
            "implemented_and_completed": completed,
            "tables": {str(k): v for k, v in sorted(grouped.items())},
            "renderer_tables": renderer_tables,
            "renderer_header": ["№ п/п", "Рекомендация", "Ответ ГРБС на рекомендацию", f"Решение УЭР / статус на {snapshot.get('report_date')}"],
        },
        "grbs_order": GRBS_ORDER,
        "contract": {"report_model_version": "report-model-v1.1.0"},
    }


def build_report_model_v2(snapshot: dict, ledger: list[dict]) -> dict:
    """Renderer-independent v2 projection with independent recommendation axes.

    The legacy single ``semantic_status`` is retained only as migration metadata;
    renderers should use ``dimensions`` for current state.
    """
    from .recommendation_dimensions import evaluate_dimensions

    model = build_report_model(snapshot, ledger)
    dimensions_by_id = {}
    review_required = []
    for r in ledger:
        if not r.get("active_in_current_slice"):
            continue
        d = evaluate_dimensions(r).as_dict()
        dimensions_by_id[r.get("recommendation_id")] = d
        if d["evidence_quality"] in {"NONE", "TEXT_DERIVED_CURRENT", "STRUCTURED_PRESENCE+TEXT_DERIVED_CURRENT"}:
            review_required.append(r.get("recommendation_id"))
    model["recommendations_v2"] = {
        "dimensions_by_id": dimensions_by_id,
        "review_required_ids": [x for x in review_required if x],
        "legacy_semantic_status_is_presentation_only": True,
    }
    model.setdefault("contract", {})["recommendation_state_model"] = "compliance+execution+grouping+evidence_quality"
    return model


def build_report_model_v3(snapshot: dict, ledger: list[dict], *, contributor_index: dict[str, list[str]] | None = None,
                          narrative_notes=(), diff_events=(), issues=(), procedures=(), publication_history=(),
                          sector_profile=None) -> dict:
    """Full renderer-neutral product model layered on the v1.1 forensic kernel.

    The two narrative modes are projections of the same already-computed KPIs. Human/context
    notes are presentation-only and publication history excludes diagnostic snapshots.
    """
    from .context import NarrativeNote, validate_narrative_notes
    from .narrative import build_generic_narrative, build_smart_narrative
    from .publication_history import select_previous_official
    from .traceability import metric_trace

    model = build_report_model_v2(snapshot, ledger)
    model.setdefault("contract", {})["report_model_version"] = "report-model-v1.2.0"

    # Renderer-neutral per-GRBS and all-quarter metric projections.  Renderers must not
    # reach back into snapshot["model"] or recompute business aggregates.
    from .metrics import MetricBlock, aggregate_snapshot_model

    def cell_metric(cell: dict) -> dict:
        m = MetricBlock(
            plan_count=int(cell.get("plan_count") or 0),
            fact_count=int(cell.get("fact_count") or 0),
            remain_count=int(cell.get("remain_count") or 0),
            plan_amount=float((cell.get("plan") or {}).get("K") or 0.0),
            fact_amount=float((cell.get("fact") or {}).get("Y") or 0.0),
            remain_amount=float((cell.get("remain") or {}).get("K") or 0.0),
        )
        return m.as_dict()

    raw_model = snapshot.get("model") or {}
    grbs_metrics = {}
    for grbs in model.get("grbs_order") or []:
        src = raw_model.get(grbs) or {}
        if not src:
            continue
        grbs_metrics[grbs] = {}
        for ptype in ("comp", "ep"):
            grbs_metrics[grbs][ptype] = {}
            for scope in ("year", "q1", "q2", "q3", "q4"):
                cell = ((src.get(ptype) or {}).get(scope))
                if cell is not None:
                    grbs_metrics[grbs][ptype][scope] = cell_metric(cell)
    model["grbs_metrics"] = grbs_metrics
    model["global_quarters"] = {
        ptype: {scope: aggregate_snapshot_model(raw_model, ptype, scope).as_dict()
                for scope in ("year", "q1", "q2", "q3", "q4")}
        for ptype in ("comp", "ep") if raw_model
    }

    # Ready-to-render recommendation rows grouped by GRBS.  This is a presentation
    # projection of ledger entities, not copied content from a previous DOCX.
    rec_by_grbs = defaultdict(list)
    for r in ledger:
        if not r.get("active_in_current_slice"):
            continue
        rec_by_grbs[str(r.get("grbs") or "")].append({
            "row_no": r.get("row_no"),
            "table_no": r.get("table_no"),
            "section": r.get("section"),
            "recommendation_id": r.get("recommendation_id"),
            "recommendation": r.get("recommendation_text") or "",
            "grbs_response": r.get("grbs_response_original") or "",
            "uer_decision": r.get("uer_decision_original") or "",
            "semantic_status_ru": r.get("semantic_status_ru") or r.get("semantic_status") or "",
            "status_evidence": r.get("status_evidence") or "",
        })
    for rows in rec_by_grbs.values():
        rows.sort(key=lambda x: (int(x.get("table_no") or 0), int(x.get("row_no") or 0), str(x.get("recommendation_id") or "")))
    model["recommendations_by_grbs"] = dict(rec_by_grbs)
    groups = {}
    for grbs, records in rec_by_grbs.items():
        by_table = defaultdict(list)
        for record in records:
            by_table[record.get("table_no")].append(record)
        groups[grbs] = [{"table_no": number, "rows": records} for number, records in by_table.items()]
    model["recommendation_tables_by_grbs"] = groups
    model["metric_contributors"] = {str(k): list(v) for k, v in (contributor_index or {}).items()}

    note_objs = [x if isinstance(x, NarrativeNote) else NarrativeNote(**x) for x in narrative_notes]
    note_errors = validate_narrative_notes(note_objs)
    if note_errors:
        model.setdefault("product_contract_issues", []).extend(note_errors)
    model["context"] = {"narrative_notes": [x.as_dict() for x in note_objs]}
    model["diff"] = [x.as_dict() if hasattr(x, "as_dict") else dict(x) for x in diff_events]
    model["issues"] = [x.as_dict() if hasattr(x, "as_dict") else dict(x) for x in issues]
    model["procedures"] = [x.as_dict() if hasattr(x, "as_dict") else dict(x) for x in procedures]

    # Management-view data is prepared here so the renderer performs no business aggregation.
    current_q = int((model.get("headline") or {}).get("current_quarter") or 1)
    comp_remaining = []
    ep_remaining = []
    for grbs in model.get("grbs_order") or []:
        gm = grbs_metrics.get(grbs) or {}
        for ptype, target in (("comp", comp_remaining), ("ep", ep_remaining)):
            qmetric = ((gm.get(ptype) or {}).get(f"q{current_q}")) or {}
            if int(qmetric.get("remain_count") or 0) > 0:
                target.append({
                    "grbs": grbs,
                    "remain_count": int(qmetric.get("remain_count") or 0),
                    "remain_amount": float(qmetric.get("remain_amount") or 0.0),
                })

    diff_counts = Counter(str(x.get("event_type") or "UNKNOWN") for x in model.get("diff") or [])
    serious_issues = [
        dict(x) for x in model.get("issues") or []
        if str(x.get("severity") or "").upper() in {"ERROR", "BLOCKER", "HIGH"}
    ]
    compliance_counts = Counter()
    execution_counts = Counter()
    evidence_quality_counts = Counter()
    for d in (model.get("recommendations_v2") or {}).get("dimensions_by_id", {}).values():
        compliance_counts[str(d.get("compliance_status") or "UNKNOWN")] += 1
        execution_counts[str(d.get("execution_status") or "UNKNOWN")] += 1
        evidence_quality_counts[str(d.get("evidence_quality") or "UNKNOWN")] += 1
    model["management_summary"] = {
        "current_quarter": current_q,
        "competitive_remaining_by_grbs": comp_remaining,
        "single_supplier_remaining_by_grbs": ep_remaining,
        "procedure_count": len(model.get("procedures") or []),
        "procedure_rows": [dict(x) for x in model.get("procedures") or []],
        "diff_counts": dict(sorted(diff_counts.items())),
        "serious_issue_count": len(serious_issues),
        "serious_issues": serious_issues,
        "recommendation_compliance_counts": dict(sorted(compliance_counts.items())),
        "recommendation_execution_counts": dict(sorted(execution_counts.items())),
        "recommendation_evidence_quality_counts": dict(sorted(evidence_quality_counts.items())),
    }

    previous = select_previous_official(
        publication_history, current_report_date=str(snapshot.get("report_date")),
        current_snapshot_id=snapshot.get("snapshot_id"),
    ) if publication_history else None
    model["publication"] = {
        "previous_official_snapshot_id": previous.snapshot_id if previous else None,
        "previous_official_report_date": previous.report_date if previous else None,
        "previous_official_published_at": previous.published_at if previous else None,
        "history_policy": "previous official CANONICAL PUBLISHED snapshot only",
    }
    if model["diff"] and previous is None:
        model.setdefault("product_contract_issues", []).append("DIFF_WITHOUT_OFFICIAL_BASELINE")

    generic = build_generic_narrative(model, notes=note_objs, sector_profile=sector_profile)
    smart = build_smart_narrative(
        model, diff_events=model["diff"], issues=model["issues"], notes=note_objs, sector_profile=sector_profile,
    )
    model["narratives"] = {
        "GENERIC_TEMPLATE": [x.as_dict() for x in generic],
        "SMART_NARRATIVE": [x.as_dict() for x in smart],
        "decision_chain": ["describe", "explain", "judge", "act"],
        "same_kpi_source": True,
    }

    traces = []
    for kind in ("competitive", "single_supplier"):
        for scope in ("year", "quarter"):
            for field in ("plan_count", "fact_count", "remain_count", "plan_amount", "fact_amount", "remain_amount", "execution_pct"):
                key = f"headline.{kind}.{scope}.{field}"
                traces.append(metric_trace(
                    block_id=f"metric.{key}", metric_key=key, snapshot=model["snapshot"],
                    contributor_index=model["metric_contributors"],
                ).as_dict())

    active_ids = tuple(str(r.get("recommendation_id")) for r in ledger if r.get("active_in_current_slice") and r.get("recommendation_id"))
    if active_ids:
        from .traceability import TraceRecord
        traces.append(TraceRecord(
            report_block_id="metric.recommendations.active", metric_key="recommendations.active",
            recommendation_ids=active_ids, snapshot_id=str(model["snapshot"].get("snapshot_id") or ""),
            rules_version=str(model["snapshot"].get("rules_version") or ""),
            renderer_version=str(model["snapshot"].get("renderer_version") or ""),
            template_rule_id="METRIC.RECOMMENDATION_SUMMARY",
        ).as_dict())
    for mode in ("GENERIC_TEMPLATE", "SMART_NARRATIVE"):
        for block in model["narratives"][mode]:
            traces.append(dict(block["trace"]))
    # A stable block id identifies one logical trace; SMART and GENERIC can legitimately
    # share a metric semantic key but not the same block id. Deduplicate exact ids only.
    uniq = {}
    for t in traces:
        uniq.setdefault(t["report_block_id"], t)
    model["trace_records"] = list(uniq.values())
    return model
