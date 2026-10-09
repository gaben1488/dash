from __future__ import annotations

from collections.abc import Iterable
from dataclasses import asdict, dataclass
from typing import Any

from .models import ValidationIssue
from .qa import freshness_gate
from .renderer_guard import RendererInputError, assert_renderer_inputs


@dataclass(frozen=True)
class BindingUse:
    procurement_row_key: str
    procedure_code: str
    decision: str
    reliable: bool
    affects_published_kpi: bool = False
    evidence: dict[str, Any] | None = None

    def as_dict(self) -> dict[str, Any]:
        return asdict(self)


def validate_release_v2(*,
                        source_before: dict[str, str | None],
                        source_after: dict[str, str | None],
                        raw_issues: Iterable[ValidationIssue],
                        binding_uses: Iterable[BindingUse],
                        recommendation_replay_proven: bool,
                        report_model: dict | None = None,
                        renderer_input_files: list[str] | None = None,
                        report_snapshot_id: str | None = None,
                        dashboard_snapshot_id: str | None = None,
                        source_at_publish: dict[str, str | None] | None = None,
                        identity_uses_business_id_only: bool = False,
                        unresolved_recommendation_reviews: int = 0,
                        projection_model_matches: bool | None = None,
                        input_contract_issues: Iterable[ValidationIssue] | None = None,
                        identity_issues: Iterable[ValidationIssue] | None = None,
                        require_report_metadata: bool = False) -> list[ValidationIssue]:
    """Fail-closed release gates for atomic, evidence-bound publication.

    A report may only publish facts derived from one stable snapshot. A proposed/no-code procedure
    relation can be shown in a review queue but cannot alter a published KPI until it is persisted as
    reviewed/reliable. Recommendation rows must be replayed from current evidence, never copied from
    the previous report.
    """
    issues = list(freshness_gate(source_before, source_after))
    if require_report_metadata:
        if not source_before or not source_after or any(not x for x in [*source_before.values(), *source_after.values()]):
            issues.append(ValidationIssue("ERROR", "SOURCE_REVISION_PROOF_MISSING", "Publication requires nonempty source revision barriers"))
        if source_at_publish is None or not source_at_publish or any(not x for x in source_at_publish.values()):
            issues.append(ValidationIssue("ERROR", "AT_PUBLISH_PROOF_MISSING", "Publication requires an observed final source revision barrier"))
        if projection_model_matches is not True:
            issues.append(ValidationIssue("ERROR", "PROJECTION_PARITY_NOT_PROVEN", "Publication requires verified model/projection parity"))
        if input_contract_issues is None:
            issues.append(ValidationIssue("ERROR", "INPUT_CONTRACT_NOT_CHECKED", "Publication requires a completed input-contract check"))
    if input_contract_issues is not None:
        issues.extend(x for x in input_contract_issues if x.severity == "ERROR")
    if identity_issues is not None:
        issues.extend(x for x in identity_issues if x.severity == "ERROR")
    issues.extend(x for x in raw_issues if x.severity == "ERROR")

    for b in binding_uses:
        if b.affects_published_kpi and not b.reliable:
            issues.append(ValidationIssue(
                "ERROR", "UNRELIABLE_BINDING_AFFECTS_KPI",
                f"{b.procedure_code}: non-reliable/review-only binding would alter published KPI",
                {"procurement_row_key": b.procurement_row_key, "decision": b.decision,
                 "evidence": b.evidence or {}},
            ))

    if not recommendation_replay_proven:
        issues.append(ValidationIssue(
            "ERROR", "RECOMMENDATION_REPLAY_NOT_PROVEN",
            "Current recommendation tables/statuses were not rebuilt from current evidence",
        ))

    if report_model is not None:
        try:
            assert_renderer_inputs(report_model=report_model, input_files=renderer_input_files or [])
        except RendererInputError as exc:
            issues.append(ValidationIssue("ERROR", "RENDERER_INPUT_VIOLATION", str(exc)))
        if require_report_metadata:
            meta = report_model.get("snapshot") if isinstance(report_model, dict) else None
            required = ("snapshot_id", "cutoff_at", "rules_version", "renderer_version")
            missing = [k for k in required if not isinstance(meta, dict) or not meta.get(k)]
            if missing:
                issues.append(ValidationIssue(
                    "ERROR", "REPORT_METADATA_MISSING",
                    "ReportModel is missing immutable publication metadata",
                    {"missing": missing},
                ))


    if source_at_publish is not None:
        for issue in freshness_gate(source_after, source_at_publish):
            issues.append(ValidationIssue(
                "ERROR", "SOURCE_CHANGED_AFTER_FREEZE",
                issue.message.replace("while snapshot was being built", "after snapshot freeze and before publication"),
                issue.context,
            ))

    if identity_uses_business_id_only:
        issues.append(ValidationIssue(
            "ERROR", "UNSAFE_BUSINESS_ID_IDENTITY",
            "Column A/business procurement_id is non-unique in real sources and cannot be the sole lookup identity",
        ))

    if unresolved_recommendation_reviews:
        issues.append(ValidationIssue(
            "ERROR", "RECOMMENDATION_REVIEW_QUEUE_NOT_EMPTY",
            f"{unresolved_recommendation_reviews} recommendation semantic review item(s) remain unresolved",
            {"count": unresolved_recommendation_reviews},
        ))

    if projection_model_matches is False:
        issues.append(ValidationIssue(
            "ERROR", "DERIVED_PROJECTION_MISMATCH",
            "Dashboard/consolidated projection does not reproduce the frozen source-derived ReportModel",
        ))

    if report_snapshot_id and dashboard_snapshot_id and report_snapshot_id != dashboard_snapshot_id:
        issues.append(ValidationIssue(
            "ERROR", "PROJECTION_SNAPSHOT_MISMATCH",
            "Report and dashboard/control projection were derived from different snapshots",
            {"report_snapshot_id": report_snapshot_id, "dashboard_snapshot_id": dashboard_snapshot_id},
        ))
    return issues


def validate_product_contract(report_model: dict, *, require_metric_contributors: bool = False) -> list[ValidationIssue]:
    """Product-layer gates restored from the full requirements baseline."""
    from .context import validate_narrative_notes
    from .narrative import validate_narrative_blocks
    from .traceability import validate_trace_records

    issues: list[ValidationIssue] = []
    snapshot = report_model.get("snapshot") or {}
    if snapshot.get("mode") == "FORENSIC_REPLAY":
        issues.append(ValidationIssue("ERROR", "FORENSIC_REPLAY_NOT_PUBLISHABLE",
                                      "FORENSIC_REPLAY cannot be used for an official publication"))

    notes = ((report_model.get("context") or {}).get("narrative_notes") or [])
    for code in validate_narrative_notes(notes):
        issues.append(ValidationIssue("ERROR", code.split(":", 1)[0], code))

    narratives = report_model.get("narratives") or {}
    for mode in ("GENERIC_TEMPLATE", "SMART_NARRATIVE"):
        if mode not in narratives:
            issues.append(ValidationIssue("ERROR", "NARRATIVE_MODE_MISSING", f"{mode} is missing"))
            continue
        for code in validate_narrative_blocks(narratives.get(mode) or []):
            issues.append(ValidationIssue("ERROR", code.split(":", 1)[0], code))
    if narratives.get("same_kpi_source") is not True:
        issues.append(ValidationIssue("ERROR", "NARRATIVE_KPI_SOURCE_NOT_SHARED",
                                      "GENERIC_TEMPLATE and SMART_NARRATIVE must project the same ReportModel KPIs"))

    for code in validate_trace_records(report_model.get("trace_records") or [],
                                       require_contributors_for_metrics=require_metric_contributors):
        issues.append(ValidationIssue("ERROR", code.split(":", 1)[0], code))

    pub = report_model.get("publication") or {}
    if pub.get("history_policy") != "previous official CANONICAL PUBLISHED snapshot only":
        issues.append(ValidationIssue("ERROR", "PUBLICATION_HISTORY_POLICY_MISSING",
                                      "Diff baseline must be selected from official published CANONICAL history"))
    for raw in report_model.get("product_contract_issues") or []:
        code = str(raw.get("code") if isinstance(raw, dict) else raw)
        if not code:
            continue
        issues.append(ValidationIssue("ERROR", code.split(":", 1)[0], code))
    return issues


def validate_recorded_state_model(model: dict, *, ledger: list[dict], documents=None, budget_years=None) -> list[ValidationIssue]:
    """ADR-003: admit proven current facts with explicit historical evidence gaps."""
    issues = validate_product_contract(model)
    if str((model.get('snapshot') or {}).get('renderer_version', '')).startswith('renderer-v1.5.0rc25'):
        require_weekly = (model.get('contract') or {}).get('weekly_evidence_contract') == 'weekly-evidence-v1'
        if not require_weekly or not isinstance(model.get('weekly_evidence'), dict):
            issues.append(ValidationIssue('ERROR', 'WEEKLY_EVIDENCE_MISSING',
                'Недельная аналитика должна быть частью проверенного выпуска.'))


    def require(condition, code, message):
        if not condition:
            issues.append(ValidationIssue('ERROR', code, message))

    if model.get('contract', {}).get('trace_catalog_contract') == 'complete-trace-v1':
        from .snapshot import canonical_semantic_hash
        from .traceability import complete_trace_catalog

        require(canonical_semantic_hash(model.get('trace_records')) == canonical_semantic_hash(complete_trace_catalog(model)),
                'TRACE_CATALOG_MISMATCH', 'Неполный или изменённый каталог происхождения выводов.')
    if model.get('snapshot', {}).get('renderer_version') not in {'renderer-v1.5.0rc7', 'renderer-v1.5.0rc8', 'renderer-v1.5.0rc9'}:
        require(all(model.get('contract', {}).get(key) == version for key, version in (
            ('document_content_contract', 'document-plan-v1'), ('business_context_contract', 'source-context-v1'),
            ('trace_catalog_contract', 'complete-trace-v1'), ('narrative_source_contract', 'recorded-business-v1'))),
            'BUSINESS_DOCUMENT_CONTRACT_MISSING', 'Отсутствует обязательный контракт чистового документа.')
    if model.get('snapshot', {}).get('renderer_version') not in {
            'renderer-v1.5.0rc7', 'renderer-v1.5.0rc8', 'renderer-v1.5.0rc9', 'renderer-v1.5.0rc10'}:
        assurance = (model.get('contract') or {}).get('automation_assurance_contract')
        require(assurance in {'actionable-assurance-v1', 'actionable-assurance-v2'}
                and (model.get('automation_assurance') or {}).get('contract') == assurance,
                'AUTOMATION_ASSURANCE_MISSING', 'Отсутствует обязательная оценка полноты автоматизации.')
    if model.get('snapshot', {}).get('renderer_version') not in {
            'renderer-v1.5.0rc7', 'renderer-v1.5.0rc8', 'renderer-v1.5.0rc9', 'renderer-v1.5.0rc10', 'renderer-v1.5.0rc11'}:
        require(model.get('contract', {}).get('context_presentation_contract') == 'relevant-context-v1'
                and 'source_context_groups' in model, 'CONTEXT_PRESENTATION_MISSING',
                'Отсутствует проверяемый отбор пояснений для документа.')
    if model.get('contract', {}).get('narrative_source_contract') == 'recorded-business-v1':
        from .narrative import validate_recorded_narratives
        require(validate_recorded_narratives(model), 'NARRATIVE_SOURCE_MISMATCH',
                'Текстовые выводы не воспроизводятся из проверенных исходных данных.')
    if model.get('contract', {}).get('document_content_contract') == 'document-plan-v1':
        from .document_content import validate_document_plans
        require(validate_document_plans(model), 'DOCUMENT_PLAN_MISMATCH', 'Состав документа расходится с моделью.')
    required = {'headline', 'grbs_metrics', 'monthly', 'future_plan', 'calendar_fact', 'details',
                'recommendations', 'recommendations_by_grbs', 'procedures', 'closed_procedure_quality',
                'report_clock', 'period_contract', 'exact_metrics', 'trace_records'}
    if model.get('snapshot', {}).get('renderer_version') != 'renderer-v1.5.0rc7':
        required.update({'report_content', 'recommendation_records'})
    require(required <= model.keys(), 'REQUIRED_REPORT_SECTION_MISSING', 'Отсутствует обязательный раздел отчёта.')
    require((model.get('formula_dependencies') or {}).get('closed') is True,
            'UPSTREAM_IMPORT_FRESHNESS_NOT_PROVEN', 'Не подтверждён полный состав зависимостей формул.')
    require((model.get('independent_audit') or {}).get('pass') is True,
            'INDEPENDENT_AUDIT_FAILED', 'Независимый пересчёт не совпал с моделью.')
    require(not any(x.get('severity') == 'ERROR' for x in model.get('issues', [])),
            'SOURCE_QA_ERRORS', 'В исходных данных выявлены ошибки; подробности в реестре проверки.')
    identity = model.get('identity_observations')
    require(identity is not None, 'PERSISTENT_IDENTITY_NOT_INTEGRATED', 'Постоянная история наблюдений не подключена.')
    details = model.get('details') or []
    locators = [r.get('physical_row_key') for r in details]
    require(all(locators) and len(locators) == len(set(locators)),
            'DETAIL_LOCATORS_INVALID', 'Строки отчёта должны иметь уникальные ссылки на первичный снимок.')
    if identity is not None:
        require({r['source_row_key']:r['procurement_uid'] for r in identity['rows']}
                == {r['physical_row_key']:r.get('procurement_uid') for r in details},
                'IDENTITY_COVERAGE_MISMATCH', 'История наблюдений не покрывает строки текущего расчёта.')
    semantics = model.get('metric_semantics') or {}
    require(semantics.get('scope') == 'master_recorded_fact' and semantics.get('procedure_overlay_applied') is False
            and semantics.get('contract_count') is None,
            'RECORDED_STATE_SEMANTICS_CHANGED', 'Результаты процедур не подтверждают договоры или оплату.')
    from .section_audit import (
        audit_management_projection,
        audit_recommendation_projections,
    )

    require(audit_recommendation_projections(model), 'RECOMMENDATION_PROJECTION_MISMATCH',
            'Текстовые таблицы рекомендаций расходятся с проверенными записями.')
    require(audit_management_projection(model), 'MANAGEMENT_PROJECTION_MISMATCH',
            'Показатели дополнения расходятся с проверенными метриками и статусами.')
    recs = model.get('recommendations') or {}
    active = {r['recommendation_id']: r for r in ledger if r['active_in_current_slice']}
    projected = [r for group in recs.get('tables', {}).values() for r in group]
    require(recs.get('historical_unique') == len(ledger) and recs.get('active') == len(active)
            and len(projected) == len(active) and {r['recommendation_id'] for r in projected} == active.keys(),
            'RECOMMENDATION_COVERAGE_MISMATCH', 'Накопительный реестр рекомендаций сохранён не полностью.')
    from dataclasses import fields

    from .models import ProcurementRow
    from .raw_pipeline import review_recommendations

    names={field.name for field in fields(ProcurementRow)}
    current=[ProcurementRow(**{key:value for key,value in row.items() if key in names}) for row in details]
    expected_claims={row['recommendation_id']:row for row in review_recommendations(ledger, current,
        model['snapshot']['snapshot_id'], model['snapshot']['report_date'],
        identity_evidence=model.get('identity_review_evidence'), documents=documents,
        legacy=not model.get('contract', {}).get('recommendation_link_contract'),
        link_contract=model.get('contract', {}).get('recommendation_link_contract'),
        context_contract=model.get('contract', {}).get('business_context_contract'), budget_years=budget_years)}
    if 'identity_review_evidence' not in model:
        for claim in expected_claims.values():
            claim.pop('business_finding', None)
    for r in projected:
        original = active.get(r['recommendation_id']) or {}
        require(r.get('recommendation_text') == original.get('recommendation_text')
                and r.get('grbs_response_original') == original.get('grbs_response_original')
                and r.get('uer_decision_original') == original.get('uer_decision_original')
                and all(r.get(key) == original.get(key) for key in ('grbs','table_no','row_no','section'))
                and r.get('status_as_of') == model.get('snapshot', {}).get('report_date')
                and r.get('evidence_snapshot_id') == model.get('snapshot', {}).get('snapshot_id'),
                'RECOMMENDATION_EVIDENCE_MISMATCH', 'Рекомендация не связана с текущим проверенным снимком.')
        require(all(r.get(key) == value for key, value in expected_claims[r['recommendation_id']].items()),
                'UNPROVEN_RECOMMENDATION_CLAIM', 'Статус не следует из подтверждённой связи и первичных полей.')
    for trace in model.get('trace_records') or []:
        for key in (trace.get('metric_key') or '').split('|'):
            value = model
            for part in key.split('.'):
                value = value.get(part) if isinstance(value, dict) else None
            if not isinstance(value, dict) and value not in (None, 0) and key:
                require(bool(trace.get('source_procurement_ids') or trace.get('recommendation_ids') or trace.get('procedure_ids')),
                        'TRACE_CONTRIBUTORS_MISSING', 'Ненулевой показатель не имеет исходных записей.')
    return issues
