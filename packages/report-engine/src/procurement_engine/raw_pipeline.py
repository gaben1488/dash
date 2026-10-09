"""Reproducible recorded-state reports from complete, revision-checked matrices."""
from __future__ import annotations

import json
from collections import Counter, defaultdict
from dataclasses import asdict, replace
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from .adapters import normalize_master_values
from .atomic_snapshot import AtomicSnapshotBundle, SourcePayload
from .canonical_metrics import calendar_facts, completed, metric_block
from .constants import GRBS_ORDER
from .diagnostics import project_diagnostics
from .fact_model import is_procurement_row
from .formula_dependencies import audit_formula_dependencies
from .metrics import reporting_quarter
from .normalize import (
    clean_text,
    normalize_id,
    normalize_procedure_code,
    parse_date,
    to_decimal,
)
from .procedures import (
    iter_operational_rows,
    normalize_procedure_values,
    operational_cells,
    validate_operational_view,
    validate_procedure_lineage,
    validate_procedure_shares,
    validate_procedure_uniqueness,
)
from .projections import (
    assert_projection_parity,
    project_dashboard,
    project_main_view,
    project_management_view,
)
from .publication_history import compare_published_models
from .qa import (
    classify_future_context,
    explicit_future_plan_dates,
    validate_master_values,
)
from .release_gates import validate_recorded_state_model
from .report_content import build_business_sections
from .report_model import build_report_model_v3
from .rule_catalog import DEFAULT_RULE_CATALOG
from .snapshot import _snapshot_id, canonical_semantic_hash
from .snapshot_bundle_io import persist_atomic_bundle, verify_persisted_bundle
from .source_contract import registry_grbs_order
from .validation import validate_snapshot
from .weekly_evidence import CONTRACT as WEEKLY_CONTRACT
from .weekly_evidence import build_weekly_evidence, freeze_weekly_baseline

RENDERER_VERSION = 'renderer-v1.5.0rc25'
RAW_RULES_VERSION = DEFAULT_RULE_CATALOG.version + '+raw-v1.5.0rc25+reviewed-actions-v1verified-original-links-v1+grid-coverage-v1+archive-scope-v1+weekly-evidence-v1'

FORMULA_ERRORS = {'#REF!', '#VALUE!', '#N/A', '#DIV/0!', '#NAME?', '#NUM!', '#ERROR!', '#SPILL!'}


def dump(value, path):
    Path(path).write_text(json.dumps(value, ensure_ascii=False, indent=2, default=str, allow_nan=False), encoding='utf-8')


def header_hash(values, header_rows, *, volatile_cells=()):
    # Numeric header enumeration is identical between Sheets (int) and XLSX (float).
    normalized = [[str(int(v)) if isinstance(v, (int, float)) and not isinstance(v, bool) and v == int(v)
                   else clean_text(v) for v in row] for row in values[header_rows-1:header_rows]]
    for row, column in volatile_cells:
        if row == header_rows and normalized:
            normalized[0].extend([''] * max(0, column - len(normalized[0])))
            normalized[0][column - 1] = ''
    for row in normalized:
        while row and not row[-1]:
            row.pop()
    return canonical_semantic_hash(normalized)


def bundle_from_capture(capture, registry, ledger=None, *, identity_evidence=None):
    """Validate a completed connector capture. Never simulate revision rereads."""
    from .recommendation_history import issued_recommendations

    ledger = issued_recommendations(ledger if ledger is not None else [])
    if capture.get('archived_file_evidence') is not None:
        from .archived_evidence import verify_archived_values
        verify_archived_values(capture, registry=registry, ledger=ledger)
    expected = {s['source_id']: s for s in registry['sources']}
    got = capture['sources']
    if sorted(s.get('grbs') for s in got if s['role'] == 'master') != sorted(registry_grbs_order(registry)):
        raise ValueError('MASTER_GRBS_SET_INCOMPLETE')
    if len(expected) != len(registry['sources']) or len({s['source_id'] for s in got}) != len(got):
        raise ValueError('DUPLICATE_SOURCE_ID')
    if set(expected) != {s['source_id'] for s in got}:
        raise ValueError('SOURCE_SET_MISMATCH')
    capture_time = datetime.fromisoformat(capture['captured_at'])
    if capture_time.tzinfo is None:
        raise ValueError('CAPTURE_TIMEZONE_MISSING')
    report_date = parse_date(capture['report_date'])
    if not report_date or report_date != capture_time.astimezone(ZoneInfo(capture['timezone'])).date().isoformat():
        raise ValueError('REPORT_DATE_CAPTURE_DATE_MISMATCH')
    reporting_quarter(capture)  # Validate explicit selection before any persistence.
    if 'report_scope' not in capture and int(report_date[:4]) != capture['report_year']:
        raise ValueError('REPORT_YEAR_MISMATCH')
    payloads, source_manifest, before, after = [], [], {}, {}
    for s in sorted(got, key=lambda x: x['source_id']):
        sid = s['source_id']; contract = expected[sid]
        for key in ('provider_id', 'sheet_id', 'sheet', 'role', 'columns', 'grbs'):
            if s.get(key) != contract.get(key):
                raise ValueError(f'SOURCE_CONTRACT_MISMATCH:{sid}:{key}')
        if not s.get('before') or not s.get('after'):
            raise ValueError(f'SOURCE_REVISION_MISSING:{sid}')
        if s['before'] != s['after']:
            raise ValueError(f'SOURCE_CHANGED_DURING_FREEZE:{sid}')
        values = s['values']
        headers = contract['header_rows']
        if (type(headers) is not int or not 1 <= headers <= len(values)
                or s.get('header_rows', 3) != headers):
            raise ValueError(f'SOURCE_HEADER_CONTRACT_MISMATCH:{sid}')
        if len(values) != s['rows'] or not all(isinstance(r, list) and len(r) <= s['columns'] for r in values):
            raise ValueError(f'SOURCE_RANGE_INCOMPLETE:{sid}')
        if contract.get('semantic_header_fingerprint'):
            from .semantic_headers import semantic_header_hash
            if semantic_header_hash(values, headers, contract['columns'],
                volatile_cells=contract.get('volatile_header_cells', ())) != contract['semantic_header_fingerprint']:
                raise ValueError(f'SOURCE_SEMANTIC_HEADER_CHANGED:{sid}')
        fingerprint = header_hash(values, contract['header_rows'], volatile_cells=contract.get('volatile_header_cells', ()))
        if fingerprint != contract['schema_fingerprint']:
            raise ValueError(f'SOURCE_SCHEMA_CHANGED:{sid}')
        for n, row in enumerate(values, 1):
            for col, value in enumerate(row, 1):
                if isinstance(value, str) and value in FORMULA_ERRORS:
                    raise ValueError(f'SOURCE_FORMULA_ERROR:{sid}:{n}:{col}:{value}')
        before[sid], after[sid] = s['before'], s['after']
        metadata = {'sheet_title': s['sheet'], 'grbs': s.get('grbs'), 'row_count': s['rows'],
                    'column_count': s['columns'], 'header_rows': contract['header_rows'],
                    'units': contract['units'], 'capture_method': s.get('capture_method', 'connector_bounded_ranges')}
        if 'archive_file_sha256' in s:
            metadata['archive_file_sha256'] = s['archive_file_sha256']
        if 'formula_evidence' in s:
            metadata['formula_evidence']=s['formula_evidence']
        payload = SourcePayload(sid, s['role'], s['provider_id'], values, str(s['sheet_id']), fingerprint, metadata=metadata)
        payloads.append(payload)
        content = {'values':values,'formula_evidence':s['formula_evidence']} if 'formula_evidence' in s else values
        source_manifest.append({'source_id': sid, 'provider_id': s['provider_id'], 'role': s['role'],
            'sheet_or_tab_id': str(s['sheet_id']), 'schema_fingerprint': fingerprint,
            'revision_or_modified_at': s['after'], 'revision_or_modified_time_before': s['before'],
            'revision_or_modified_time_after': s['after'], 'canonical_semantic_hash': canonical_semantic_hash(values),
            'content_hash': canonical_semantic_hash(content),
            'content_hash_kind': 'canonical_values_and_formulas' if 'formula_evidence' in s else 'canonical_semantic_values',
            'payload_metadata': metadata})
    # A changed historical ledger or source contract must produce a different evidence identity.
    for sid, role, value in (('HISTORICAL_RECOMMENDATIONS', 'historical_ledger', ledger or []),
                             ('SOURCE_CONTRACT', 'rule_contract', registry),
                             *([('REPORT_SCOPE', 'report_scope', capture['report_scope'])] if 'report_scope' in capture else []),
                             *([('ARCHIVE_ORIGIN', 'archive_origin', capture['archive_origin'])] if 'archive_origin' in capture else []),
                             *([('IDENTITY_REVIEWS', 'identity_reviews', identity_evidence)]
                               if identity_evidence is not None else [])):
        token = canonical_semantic_hash(value)
        payloads.append(SourcePayload(sid, role, sid, value, raw_content_hash=None))
        before[sid] = after[sid] = token
        source_manifest.append({'source_id':sid, 'provider_id':sid, 'role':role,
            'revision_or_modified_at':token, 'content_hash':token, 'canonical_semantic_hash':token,
            'content_hash_kind':'canonical_semantic_values'})
    # Pin the weekly comparison input inside the immutable report snapshot.
    # The prior publication is never reopened from present-day Google Sheets.
    weekly_baseline = capture.get('weekly_baseline') or freeze_weekly_baseline(None)
    if weekly_baseline.get('contract') != WEEKLY_CONTRACT:
        raise ValueError('WEEKLY_BASELINE_CONTRACT_INVALID')
    sid = 'WEEKLY_BASELINE'
    token = canonical_semantic_hash(weekly_baseline)
    payloads.append(SourcePayload(sid, 'weekly_baseline', sid, weekly_baseline))
    before[sid] = after[sid] = token
    source_manifest.append({'source_id': sid, 'provider_id': sid, 'role': 'weekly_baseline',
        'revision_or_modified_at': token, 'content_hash': token, 'canonical_semantic_hash': token,
        'content_hash_kind': 'canonical_semantic_values'})
    if capture.get('archived_file_evidence') is not None:
        value = capture['archived_file_evidence']; sid = 'ARCHIVED_FILE_EVIDENCE'
        token = canonical_semantic_hash(value)
        payloads.append(SourcePayload(sid, 'archived_file_evidence', sid, value))
        before[sid] = after[sid] = token
        source_manifest.append({'source_id': sid, 'provider_id': sid, 'role': 'archived_file_evidence',
            'revision_or_modified_at': token, 'content_hash': token, 'canonical_semantic_hash': token,
            'content_hash_kind': 'canonical_semantic_values'})
    history = capture.get('recommendation_history_evidence')
    if history is not None:
        from .recommendation_history import enroll_history_package

        enroll_history_package(history['package'], ledger or [])
        sid = 'RECOMMENDATION_HISTORY_EVIDENCE'
        token = canonical_semantic_hash(history['metadata'])
        payloads.append(SourcePayload(sid, 'historical_report_evidence', sid, history))
        before[sid] = after[sid] = token
        source_manifest.append({'source_id': sid, 'provider_id': sid, 'role': 'historical_report_evidence',
            'revision_or_modified_at': token, 'content_hash': canonical_semantic_hash(history),
            'canonical_semantic_hash': canonical_semantic_hash(history), 'content_hash_kind': 'canonical_semantic_values'})
    snapshot_id = _snapshot_id(report_date=capture['report_date'], report_year=capture['report_year'],
        sources=source_manifest, rules_version=RAW_RULES_VERSION, renderer_version=RENDERER_VERSION, mode='CANONICAL')
    manifest = {'snapshot_id': snapshot_id, 'report_date': capture['report_date'], 'report_year': capture['report_year'],
        'captured_at': capture['captured_at'], 'cutoff_at': capture['captured_at'], 'timezone': capture['timezone'],
        'rules_version': RAW_RULES_VERSION, 'renderer_version': RENDERER_VERSION, 'mode': 'CANONICAL',
        'status': 'DIAGNOSTIC', 'snapshot_contract_version': 'snapshot-v2.2.0', 'sources': source_manifest,
        'atomic_capture': {'before_after_equal': True, 'basis': 'observed provider modifiedTime barriers',
                           'limitation': 'Provider revision stability does not prove upstream IMPORTRANGE freshness.'}}
    if capture.get('archived_file_evidence') is not None:
        manifest['atomic_capture'] = {'before_after_equal': True,
            'basis': 'Registered immutable archived file bytes and observed XLSX caches',
            'limitation': 'Historical cutoff is declared in the source archive; neither live revisions nor upstream formula freshness are asserted.'}
    for key in ('report_scope', 'archive_origin'):
        if key in capture:
            manifest[key] = capture[key]
    return AtomicSnapshotBundle(manifest, tuple(payloads), 1, before, after)


def aggregate_rows(rows, year, as_of=None, *, grbs_order=None):
    """Translate the existing canonical row aggregation to the renderer schema."""
    model = {}
    for grbs in GRBS_ORDER if grbs_order is None else grbs_order:
        model[grbs] = {}
        for kind in ('comp', 'ep'):
            model[grbs][kind] = {}
            for period in ('year', 'q1', 'q2', 'q3', 'q4'):
                m = metric_block([r for r in rows if r.grbs == grbs], report_year=year, as_of=as_of,
                    method='ЭА' if kind=='comp' else 'ЕП', planned_quarter=None if period=='year' else int(period[1]))
                model[grbs][kind][period] = {k: m[k] for k in ('plan_count', 'fact_count', 'remain_count')}
                model[grbs][kind][period].update(plan={'K': m['plan_amount'], 'K_decimal':m['exact_decimal']['plan_amount']},
                    fact={'Y': m['fact_amount'], 'Y_decimal':m['exact_decimal']['fact_amount']},
                    remain={'K': m['remain_amount'], 'K_decimal':m['exact_decimal']['remain_amount']},
                    metric_block=m)
    return model


def contributors(rows, year, quarter, as_of=None):
    out = {}
    for typ, method in (('competitive', 'ЭА'), ('single_supplier', 'ЕП')):
        for scope in ('year', 'quarter'):
            selected = [r for r in rows if is_procurement_row(r, report_year=year) and r.method == method
                        and (scope == 'year' or r.planned_quarter == quarter)]
            for field in ('plan_count', 'fact_count', 'remain_count', 'plan_amount', 'fact_amount', 'remain_amount', 'execution_pct'):
                subset = [r for r in selected if completed(r,as_of)] if field.startswith('fact') else (
                    [r for r in selected if not completed(r,as_of)] if field.startswith('remain') else selected)
                out[f'headline.{typ}.{scope}.{field}'] = [r.physical_row_key for r in subset]
    return out



def _reviewed_current_link(reviewed, rows, verified_origin, snapshot_id):
    """Expose only an original-backed and uniquely reviewed current identity.

    A reviewed UID can bridge a documented historical change but cannot replace
    verification of the original recommendation document. A duplicated current
    UID is not an unambiguous link.
    """
    if verified_origin is None:
        return None
    evidence = reviewed.get('binding_evidence') or {}
    uids = list(evidence.get('current_procurement_uids') or [])
    required = list(evidence.get('source_procurement_ids') or [])
    review_ids = list(evidence.get('review_ids') or [])
    if (not uids or not required or not review_ids or len(uids) != len(set(uids))
            or any(not value for value in uids + required + review_ids)):
        return None
    by_uid = defaultdict(list)
    for row in rows:
        if row.procurement_uid in uids:
            by_uid[row.procurement_uid].append(row)
    if any(len(by_uid[uid]) != 1 for uid in uids):
        return None
    from .normalize import to_decimal

    linked = [by_uid[uid][0] for uid in uids]
    return {
        'status': 'CONFIRMED',
        'procurement_uids': uids,
        'business_ids': sorted({normalize_id(row.source_row_no) for row in linked if row.source_row_no}),
        'required_business_ids': sorted({normalize_id(value) for value in required}),
        'source_row_keys': [row.physical_row_key for row in linked],
        'fulfillment': 'UNKNOWN',
        'evidence_snapshot_id': snapshot_id,
        'origin': verified_origin,
        'review_ids': sorted(review_ids),
        'matches': [{
            'source_row_key': row.physical_row_key,
            'procurement_uid': row.procurement_uid,
            'business_id': row.source_row_no,
            'subject': row.subject,
            'plan_amount_thousand_decimal': format(to_decimal(row.plan_total), 'f'),
            'planned_year': row.planned_year,
            'method': row.method,
            'recorded_fact_date': row.actual_date,
            'match_basis': 'REVIEWED_HISTORICAL_IDENTITY',
            'amount_is_identity_key': False,
        } for row in linked],
    }


def review_recommendations(ledger, rows, snapshot_id, report_date, *, identity_evidence=None, documents=None, legacy=False,
                           link_contract='verified-original-and-current-plan-v2', context_contract=None, budget_years=None):
    """Current observations and candidates, never inheritance of old current statuses.

    GRBS + business A narrows a candidate set but is not a persisted identity.
    Every unresolved historical binding remains explicitly review-required.
    """
    index = defaultdict(list)
    for row in rows:
        if row.source_row_no:
            index[row.grbs, row.source_row_no].append(row)
    from .recommendation_links import resolve_current_link, verify_saved_report_origin

    output = []
    for old in ledger:
        r = {k: old.get(k) for k in ('recommendation_id','grbs','row_no','table_no','section','recommendation_type',
             'recommendation_text','grbs_response_original','uer_decision_original','first_seen','last_seen',
             'active_in_current_slice','source_procurement_ids','historical_acceptance')}
        r['historical_status'] = {'as_of': old.get('status_as_of'), 'status': old.get('semantic_status'),
                                  'evidence': old.get('status_evidence')}
        r['status_as_of'] = report_date
        ids = old.get('current_procurement_ids') or old.get('source_procurement_ids') or []
        candidates, missing, ambiguous = [], [], []
        for pid in ids:
            hits = index[old.get('grbs'), normalize_id(pid)]
            if not hits: missing.append(pid)
            if len(hits) > 1: ambiguous.append(pid)
            candidates.extend(hits)
        unique = {x.physical_row_key: x for x in candidates}
        observations = [{'source_row_key': x.physical_row_key, 'subject': x.subject, 'method': x.method,
            'plan_amount_thousand': x.plan_total, 'actual_date': x.actual_date,
            'current_comment': ' | '.join(t for t in (x.deviation_reason, x.grbs_comment, x.monitoring_note) if t)} for x in unique.values()]
        active = bool(r['active_in_current_slice'])
        gaps = []
        if missing:
            gaps.append('Не найдены кандидаты по номерам: ' + ', '.join(map(str, missing)) + '.')
        if ambiguous:
            gaps.append('Номер неоднозначен: ' + ', '.join(map(str, ambiguous)) + '.')
        if not ids:
            gaps.append('В исторической записи отсутствуют номера исходных позиций.')
        if observations:
            gaps.append('Кандидаты в первичном реестре: строки ' + ', '.join(str(x.row_number) for x in unique.values()) + '.')
        gaps.append('Совпадение номера не подтверждает постоянную идентичность; исполнение не установлено.')
        proof = verify_saved_report_origin(old, documents or {})
        if proof is None and link_contract == 'verified-original-and-current-plan-v14':
            from .recommendation_history import uer_entry_origin

            proof = uer_entry_origin(old, as_of=report_date)
        link = resolve_current_link(old, rows, report_date=report_date, snapshot_id=snapshot_id, verified_origin=proof,
            legacy_group_rules=link_contract not in {'verified-original-and-current-plan-v2', 'verified-original-and-current-plan-v3', 'verified-original-and-current-plan-v4', 'verified-original-and-current-plan-v5', 'verified-original-and-current-plan-v6', 'verified-original-and-current-plan-v7', 'verified-original-and-current-plan-v8', 'verified-original-and-current-plan-v9', 'verified-original-and-current-plan-v10', 'verified-original-and-current-plan-v11', 'verified-original-and-current-plan-v12', 'verified-original-and-current-plan-v13', 'verified-original-and-current-plan-v14'},
            entity_link_rules=link_contract in {'verified-original-and-current-plan-v3', 'verified-original-and-current-plan-v4', 'verified-original-and-current-plan-v5', 'verified-original-and-current-plan-v6', 'verified-original-and-current-plan-v7', 'verified-original-and-current-plan-v8', 'verified-original-and-current-plan-v9', 'verified-original-and-current-plan-v10', 'verified-original-and-current-plan-v11', 'verified-original-and-current-plan-v12', 'verified-original-and-current-plan-v13', 'verified-original-and-current-plan-v14'},
            exact_subject_fallback=link_contract in {'verified-original-and-current-plan-v5', 'verified-original-and-current-plan-v6', 'verified-original-and-current-plan-v7', 'verified-original-and-current-plan-v8', 'verified-original-and-current-plan-v9', 'verified-original-and-current-plan-v10', 'verified-original-and-current-plan-v11', 'verified-original-and-current-plan-v12', 'verified-original-and-current-plan-v13', 'verified-original-and-current-plan-v14'},
            shared_group_subject=link_contract in {'verified-original-and-current-plan-v6', 'verified-original-and-current-plan-v7', 'verified-original-and-current-plan-v8', 'verified-original-and-current-plan-v9', 'verified-original-and-current-plan-v10', 'verified-original-and-current-plan-v11', 'verified-original-and-current-plan-v12', 'verified-original-and-current-plan-v13', 'verified-original-and-current-plan-v14'},
            joint_group_target=link_contract in {'verified-original-and-current-plan-v8', 'verified-original-and-current-plan-v9', 'verified-original-and-current-plan-v10', 'verified-original-and-current-plan-v11', 'verified-original-and-current-plan-v12', 'verified-original-and-current-plan-v13', 'verified-original-and-current-plan-v14'},
            extended_literal_reference=link_contract in {'verified-original-and-current-plan-v9', 'verified-original-and-current-plan-v10', 'verified-original-and-current-plan-v11', 'verified-original-and-current-plan-v12', 'verified-original-and-current-plan-v13', 'verified-original-and-current-plan-v14'},
            budget_years=budget_years if link_contract in {'verified-original-and-current-plan-v9', 'verified-original-and-current-plan-v10', 'verified-original-and-current-plan-v11', 'verified-original-and-current-plan-v12', 'verified-original-and-current-plan-v13', 'verified-original-and-current-plan-v14'} else None,
            inflected_supply_subject=link_contract in {'verified-original-and-current-plan-v10', 'verified-original-and-current-plan-v11', 'verified-original-and-current-plan-v12', 'verified-original-and-current-plan-v13', 'verified-original-and-current-plan-v14'},
            joint_method_reference=link_contract in {'verified-original-and-current-plan-v11', 'verified-original-and-current-plan-v12', 'verified-original-and-current-plan-v13', 'verified-original-and-current-plan-v14'},
            inflected_service_subject=link_contract in {'verified-original-and-current-plan-v12', 'verified-original-and-current-plan-v13', 'verified-original-and-current-plan-v14'})
        confirmed = active and link['status'] == 'CONFIRMED'
        r.update(semantic_status=('CURRENT_LINK_CONFIRMED' if confirmed else 'REVIEW_REQUIRED') if active else 'SUPERSEDED',
            semantic_status_ru='', current_link=link,
            current_procurement_ids=link['business_ids'] if confirmed else [], procedure_binding_reliable={'reliable_codes':[], 'details':[]},
            current_procurement_state='UNKNOWN', current_method=None, current_fact_date=[],
            status_evidence=' '.join(gaps),
            current_observations=observations, missing_business_ids=missing, ambiguous_business_ids=ambiguous,
            evidence_snapshot_id=snapshot_id,
            dimensions={'compliance_status':'UNKNOWN','execution_status':'UNKNOWN','grouping_status':'UNKNOWN',
                        'evidence_quality':'VERIFIED_ORIGIN_AND_CURRENT_IDENTITY' if confirmed else 'VERIFIED_ORIGIN' if link['origin'] else 'IDENTITY_REVIEW_REQUIRED'})
        if active and not legacy:
            from .recommendation_evidence import confirmed_result

            reviewed = confirmed_result(old, rows, identity_evidence, report_date,
                compile_original=link_contract in {'verified-original-and-current-plan-v3', 'verified-original-and-current-plan-v4', 'verified-original-and-current-plan-v5', 'verified-original-and-current-plan-v6', 'verified-original-and-current-plan-v7', 'verified-original-and-current-plan-v8', 'verified-original-and-current-plan-v9', 'verified-original-and-current-plan-v10', 'verified-original-and-current-plan-v11', 'verified-original-and-current-plan-v12', 'verified-original-and-current-plan-v13', 'verified-original-and-current-plan-v14'},
                reference_grammar=link_contract in {'verified-original-and-current-plan-v4', 'verified-original-and-current-plan-v5', 'verified-original-and-current-plan-v6', 'verified-original-and-current-plan-v7', 'verified-original-and-current-plan-v8', 'verified-original-and-current-plan-v9', 'verified-original-and-current-plan-v10', 'verified-original-and-current-plan-v11', 'verified-original-and-current-plan-v12', 'verified-original-and-current-plan-v13', 'verified-original-and-current-plan-v14'},
                subject_reference_grammar=link_contract in {'verified-original-and-current-plan-v5', 'verified-original-and-current-plan-v6', 'verified-original-and-current-plan-v7', 'verified-original-and-current-plan-v8', 'verified-original-and-current-plan-v9', 'verified-original-and-current-plan-v10', 'verified-original-and-current-plan-v11', 'verified-original-and-current-plan-v12', 'verified-original-and-current-plan-v13', 'verified-original-and-current-plan-v14'},
                literal_open_quote=link_contract in {'verified-original-and-current-plan-v7', 'verified-original-and-current-plan-v8', 'verified-original-and-current-plan-v9', 'verified-original-and-current-plan-v10', 'verified-original-and-current-plan-v11', 'verified-original-and-current-plan-v12', 'verified-original-and-current-plan-v13', 'verified-original-and-current-plan-v14'},
                inflected_supply_subject=link_contract in {'verified-original-and-current-plan-v10', 'verified-original-and-current-plan-v11', 'verified-original-and-current-plan-v12', 'verified-original-and-current-plan-v13', 'verified-original-and-current-plan-v14'})
            if reviewed is not None:
                if link_contract in {'verified-original-and-current-plan-v13', 'verified-original-and-current-plan-v14'}:
                    reviewed_link = _reviewed_current_link(reviewed, rows, proof, snapshot_id)
                    if reviewed_link is not None:
                        if (link['status'] == 'CONFIRMED'
                                and set(link['procurement_uids']) != set(reviewed_link['procurement_uids'])):
                            # Two independent evidence paths disagree: neither may win by order.
                            r['current_link'] = {**link, 'status': 'AMBIGUOUS',
                                'procurement_uids': [], 'business_ids': [],
                                'source_row_keys': [], 'matches': [],
                                'conflict_kind': 'AUTOMATIC_REVIEWED_UID_DISAGREEMENT'}
                            r['current_procurement_ids'] = []
                            r['semantic_status'] = 'REVIEW_REQUIRED'
                            r['semantic_status_ru'] = 'СВЯЗЬ НЕ ПОДТВЕРЖДЕНА: ПРОТИВОРЕЧИЕ ДОКАЗАТЕЛЬСТВ'
                            r['dimensions']['evidence_quality'] = 'CONFLICTING_IDENTITY_EVIDENCE'
                            r['status_evidence'] = (
                                'Автоматическая и проверенная историческая связи противоречат друг другу. '
                                'Текущее исполнение рекомендации не установлено.')
                        else:
                            r['current_link'] = reviewed_link
                            r.update(reviewed)
                    # Missing verified original or an ambiguous UID never inherits
                    # a positive reviewed status under the new link contract.
                else:
                    r.update(reviewed)
            elif confirmed:
                from .recommendation_evidence import (
                    action_target_proven,
                    evaluate_linked_action,
                )

                linked_rows = [row for row in rows if row.procurement_uid in link['procurement_uids']]
                source_ids = link.get('required_business_ids') or link['business_ids']
                spec = link.get('action_spec')
                if spec is None and link_contract in {'verified-original-and-current-plan-v3', 'verified-original-and-current-plan-v4', 'verified-original-and-current-plan-v5', 'verified-original-and-current-plan-v6', 'verified-original-and-current-plan-v7', 'verified-original-and-current-plan-v8', 'verified-original-and-current-plan-v9', 'verified-original-and-current-plan-v10', 'verified-original-and-current-plan-v11', 'verified-original-and-current-plan-v12', 'verified-original-and-current-plan-v13', 'verified-original-and-current-plan-v14'}:
                    from .action_spec import compile_action
                    spec = compile_action(old.get('recommendation_text'), source_ids=source_ids,
                        subjects=[(row.source_row_no, row.subject) for row in linked_rows],
                        reference_grammar=link_contract in {'verified-original-and-current-plan-v4', 'verified-original-and-current-plan-v5', 'verified-original-and-current-plan-v6', 'verified-original-and-current-plan-v7', 'verified-original-and-current-plan-v8', 'verified-original-and-current-plan-v9', 'verified-original-and-current-plan-v10', 'verified-original-and-current-plan-v11', 'verified-original-and-current-plan-v12', 'verified-original-and-current-plan-v13', 'verified-original-and-current-plan-v14'},
                        subject_reference_grammar=link_contract in {'verified-original-and-current-plan-v5', 'verified-original-and-current-plan-v6', 'verified-original-and-current-plan-v7', 'verified-original-and-current-plan-v8', 'verified-original-and-current-plan-v9', 'verified-original-and-current-plan-v10', 'verified-original-and-current-plan-v11', 'verified-original-and-current-plan-v12', 'verified-original-and-current-plan-v13', 'verified-original-and-current-plan-v14'},
                        literal_open_quote=link_contract in {'verified-original-and-current-plan-v7', 'verified-original-and-current-plan-v8', 'verified-original-and-current-plan-v9', 'verified-original-and-current-plan-v10', 'verified-original-and-current-plan-v11', 'verified-original-and-current-plan-v12', 'verified-original-and-current-plan-v13', 'verified-original-and-current-plan-v14'},
                        inflected_supply_subject=link_contract in {'verified-original-and-current-plan-v10', 'verified-original-and-current-plan-v11', 'verified-original-and-current-plan-v12', 'verified-original-and-current-plan-v13', 'verified-original-and-current-plan-v14'})
                if link_contract in {'verified-original-and-current-plan-v3', 'verified-original-and-current-plan-v4', 'verified-original-and-current-plan-v5', 'verified-original-and-current-plan-v6', 'verified-original-and-current-plan-v7', 'verified-original-and-current-plan-v8', 'verified-original-and-current-plan-v9', 'verified-original-and-current-plan-v10', 'verified-original-and-current-plan-v11', 'verified-original-and-current-plan-v12', 'verified-original-and-current-plan-v13', 'verified-original-and-current-plan-v14'} or action_target_proven(old, source_ids):
                    relation_proofs = ([{'evidence': {'relation': 'MERGES_INTO',
                        'source_procurement_ids': source_ids}}]
                        if link.get('relation') == 'MERGES_INTO' else [])
                    r.update(evaluate_linked_action(old, linked_rows, report_date,
                        source_ids=source_ids, proofs=relation_proofs,
                        evidence_quality='VERIFIED_ORIGIN_AND_CURRENT_IDENTITY',
                        action_spec=spec))
        if legacy:
            r.pop('current_link', None)
            r.update(semantic_status='REVIEW_REQUIRED' if active else 'SUPERSEDED',
                semantic_status_ru='ТРЕБУЕТСЯ ПОДТВЕРЖДЕНИЕ СВЯЗИ' if active else 'ЗАМЕЩЕННАЯ ВЕРСИЯ',
                current_procurement_ids=[])
            r['dimensions']['evidence_quality'] = 'IDENTITY_REVIEW_REQUIRED'
        if context_contract == 'source-context-v1' and not legacy:
            from .source_context import enrich_recommendation

            enrich_recommendation(r, rows)
        output.append(r)
    return output


def validate_ledger_contract(ledger):
    """Reject legacy/raw histories before they can silently erase report content."""
    if not isinstance(ledger, list):
        raise ValueError('RECOMMENDATION_LEDGER_SCHEMA_INVALID')  # noqa: TRY004 — public validation contract uses ValueError.
    ids = set()
    for item in ledger:
        if (not isinstance(item, dict) or not isinstance(item.get('recommendation_id'), str)
                or not item['recommendation_id'].strip()
                or not isinstance(item.get('active_in_current_slice'), bool)
                or not isinstance(item.get('recommendation_text'), str)
                or not item['recommendation_text'].strip()
                or not isinstance(item.get('source_procurement_ids'), list)):
            raise ValueError('RECOMMENDATION_LEDGER_SCHEMA_INVALID')
        if item['recommendation_id'] in ids:
            raise ValueError('RECOMMENDATION_LEDGER_DUPLICATE_ID')
        ids.add(item['recommendation_id'])


def future_rows(sources, year):
    output = []
    for s in sources:
        if s['role'] != 'master': continue
        for rn, raw in enumerate(s['values'][s.get('header_rows', 3):], s.get('header_rows', 3) + 1):
            c = lambda i, raw=raw: raw[i] if i < len(raw) else None
            if not c(6): continue
            kind = classify_future_context(raw, target_year=year)
            if kind not in {f'STRUCTURED_PLAN_{year}', f'TARGET_PLAN_{year}_UNSTRUCTURED'}: continue
            date = parse_date(c(13))
            date_basis = 'structured_plan_date' if date else None
            if not date:
                text = ' '.join(clean_text(c(i)) for i in (4,6,12,20,30,31,32,33))
                dates = explicit_future_plan_dates(text, year)
                if len(dates) == 1:
                    date = dates.pop(); date_basis = 'explicit_current_plan_text'
            output.append({'grbs':s['grbs'], 'provider_id':s['provider_id'], 'sheet_id':s['sheet_id'],
                'sheet':s['sheet'], 'row_number':rn, 'business_id':normalize_id(c(0)), 'subject':clean_text(c(6)),
                'amount_thousand':float(sum(to_decimal(c(i)) for i in (7,8,9))), 'classification':kind,
                'date_basis':date_basis, 'target_year':year, 'target_month':int(date[5:7]) if date and date.startswith(str(year)) else None,
                'evidence':' | '.join(clean_text(c(i)) for i in (20,30,31,32,33) if c(i)),
                'review_required': kind.endswith('UNSTRUCTURED')})
    return {'target_year':year, 'rows':output, 'unknown_month_count':sum(r['target_month'] is None for r in output)}


def monthly_projection(rows, year, as_of=None, *, grbs_order=None):
    output = []
    for grbs in GRBS_ORDER if grbs_order is None else grbs_order:
        for method in ('ЭА','ЕП'):
            for month in range(1,13):
                selected = [r for r in rows if is_procurement_row(r, report_year=year) and r.grbs == grbs
                            and r.method == method and int(r.planned_date[5:7]) == month]
                metrics = metric_block(selected, report_year=year, as_of=as_of)
                metrics.update(grbs=grbs, method=method, month=month,
                               contributors=[r.physical_row_key for r in selected])
                output.append(metrics)
    return output


def build_from_capture(capture, registry, ledger, out_dir, *, render_docx=True, identity_store=None, previous_publication=None):
    from .recommendation_history import issued_recommendations

    ledger = issued_recommendations(ledger)
    validate_ledger_contract(ledger)
    out = Path(out_dir)
    if out.exists() and any(out.iterdir()):
        raise ValueError('OUTPUT_DIRECTORY_NOT_EMPTY')
    identity_evidence = identity_store.review_evidence(as_of=capture['captured_at']) if identity_store is not None else None
    bundle = bundle_from_capture(capture, registry, ledger, identity_evidence=identity_evidence)
    out.mkdir(parents=True, exist_ok=True)
    persist_atomic_bundle(bundle, out/'snapshot_bundle')
    errors = verify_persisted_bundle(out/'snapshot_bundle')
    if errors: raise ValueError(';'.join(errors))
    rows, issues = [], []
    for s in capture['sources']:
        if s['role'] != 'master': continue
        headers = s.get('header_rows', 3)
        issues.extend(x.as_dict() for x in validate_master_values(s['values'][headers:], grbs=s['grbs'],
            source_id=s['provider_id'], sheet_name=s['sheet'], first_sheet_row=headers + 1))
        rows.extend(normalize_master_values(s['values'], snapshot_id=bundle.manifest['snapshot_id'], expected_grbs=s['grbs'],
                    data_start_row=headers, source_id=s['provider_id'], sheet_name=s['sheet']))
    year=capture['report_year']; report_date=parse_date(capture['report_date'])
    identity_result=None
    if identity_store is not None:
        identity_result=identity_store.ingest(rows,snapshot_id=bundle.manifest['snapshot_id'],captured_at=capture['captured_at'],allow_plan_updates=True)
        uids={r['source_row_key']:r['procurement_uid'] for r in identity_result['rows']}
        rows=[replace(r,procurement_uid=uids[r.physical_row_key]) for r in rows]
    for r in rows:
        if r.actual_date and r.actual_date > report_date:
            issues.append({'severity':'ERROR','code':'FACT_AFTER_REPORT_DATE','message':'Дата факта позже даты отчёта', 'context':{'row_key':r.physical_row_key}})
        if is_procurement_row(r,report_year=year):
            for fields, relevant, code in ((('H','I','J'),True,'PLAN_MONEY_MISSING'),
                    (('V','W','X'),completed(r,report_date),'COMPLETED_POSITION_MONEY_MISSING')):
                if relevant and all(f in r.missing_money_fields for f in fields):
                    issues.append({'severity':'ERROR','code':code,'message':'Сумма не внесена; отсутствие данных не означает ноль.',
                                   'context':{'row_key':r.physical_row_key,'columns':fields}})
    future=future_rows(capture['sources'], year+1)
    main=next(s for s in capture['sources'] if s['sheet']=='Рабочий реестр процедур')
    attempts, shares=normalize_procedure_values(main['values'], source_ref_prefix=main['provider_id']+'::'+main['sheet'])
    issues.extend(x.as_dict() for x in validate_procedure_uniqueness(attempts)+validate_procedure_lineage(attempts)
                  + validate_procedure_shares(attempts, shares))
    queue=next(s for s in capture['sources'] if s['sheet']=='Процедуры в работе')
    issues.extend(x.as_dict() for x in validate_operational_view(main['values'], queue['values'], as_of=report_date))
    active=[];closed_quality=[]
    for block, rn, offset, raw in iter_operational_rows(queue['values']):
        cells = operational_cells(raw, offset)
        c=lambda i, cells=cells: cells[i] if i<len(cells) else None
        code=normalize_procedure_code(c(3))
        source_ref=f"{queue['provider_id']}::{queue['sheet']}::{rn}"
        if offset: source_ref += f"::column_offset={offset}"
        if block == 'closed_quality':
            closed_quality.append({'procedure_code':code,'stage':c(8),'subject':c(6),
                'action':c(2),'source_ref':source_ref,
                'raw_cells':raw,'classification':'closed_procedure_data_quality'})
            continue
        active.append({'procedure_code':code, 'stage':c(8), 'subject':c(6), 'action':c(2),
                       'deadline':parse_date(c(0)) or c(0), 'source_ref':source_ref})
    grbs_order = registry_grbs_order(registry)
    snap={**bundle.manifest, 'grbs_order':grbs_order, 'business_context_contract':'source-context-v1',
          'model':aggregate_rows(rows,year,report_date,grbs_order=grbs_order),
          'row_count':len(rows), 'active_procedures':len(active)}
    issues.extend(x.as_dict() for x in validate_snapshot(snap))
    documents = {}
    if capture.get('recommendation_history_evidence') is not None:
        from .recommendation_history import enroll_history_package

        _, documents = enroll_history_package(capture['recommendation_history_evidence']['package'], ledger)
    from .recommendation_links import primary_budget_years

    budget_years = primary_budget_years(capture['sources'])
    replay=review_recommendations(ledger,rows,bundle.manifest['snapshot_id'],capture['report_date'], documents=documents, identity_evidence=identity_evidence, context_contract='source-context-v1', link_contract='verified-original-and-current-plan-v14', budget_years=budget_years)
    unresolved_recs=[r['recommendation_id'] for r in replay if r['active_in_current_slice'] and r['semantic_status']=='REVIEW_REQUIRED']
    if unresolved_recs:
        issues.append({'severity':'WARN','code':'RECOMMENDATION_LINK_UNCONFIRMED',
            'message':'Для части исторических рекомендаций текущая связь не подтверждена. Конкретные кандидаты и пробелы указаны в каждой записи; исполнение не заявляется.',
            'context':{'recommendation_ids':unresolved_recs}})
    if identity_result and identity_result['unresolved_count']:
        issues.append({'severity':'WARN','code':'IDENTITY_CONTINUITY_UNCONFIRMED',
            'message':'Для части строк не доказана постоянная идентичность. Строки сохранены в текущем расчёте; их историческая судьба не утверждается.',
            'context':{'source_row_keys':[r['source_row_key'] for r in identity_result['rows'] if r['procurement_uid'] is None]}})
    ci=contributors(rows,year,reporting_quarter(capture),report_date)
    history=[]
    if previous_publication:
        receipt=previous_publication['receipt']
        if receipt['status'] not in {'VERIFIED','VERIFIED_WITH_WARNINGS'}:
            raise ValueError('COMPARISON_BASELINE_NOT_VERIFIED')
        history=[{k:receipt[k] for k in ('snapshot_id','report_date','published_at','rules_version','renderer_version')}]
    model=build_report_model_v3(snap,replay,contributor_index=ci,issues=issues,procedures=active,publication_history=history)
    model['contract']['recommendation_link_contract'] = 'verified-original-and-current-plan-v14'
    model['recommendation_records'] = replay
    # Legacy v2 heuristics must not turn UNKNOWN identities into 'removed' or 'planned'.
    model['recommendations_v2']['dimensions_by_id']={r['recommendation_id']:r['dimensions'] for r in replay if r['active_in_current_slice']}
    model['recommendations_v2']['review_required_ids']=unresolved_recs
    from .recommendation_evidence import recommendation_counts
    model['management_summary'].update(recommendation_counts(replay))
    model['identity_review_evidence']=identity_evidence or []
    model['future_plan']=future
    model['closed_procedure_quality']=closed_quality
    model['report_clock']={'business_as_of':report_date,'business_timezone':capture['timezone'],
        'cutoff_at':capture['captured_at'],
        'acquisition_started_at':capture.get('acquisition_started_at'),
        'acquisition_completed_at':capture.get('acquisition_completed_at'),
        'cutoff_semantics':'Interim recorded state; date-only Q cannot establish intraday event time.',
        'freshness_limitation':'Acquisition time and modifiedTime do not establish completeness of entered business events.'}
    model['identity_observations']=identity_result
    model['recommendation_review']={'policy':'Historical corpus retained; current identity and statuses require evidence',
                                   'active_review_count':len(model['recommendations_v2']['review_required_ids'])}
    model['formula_dependencies']=audit_formula_dependencies(capture)
    model['metric_semantics']={'fact_count':'Позиции плана с датой Q; не число договоров и не число процедур',
        'money_unit':'тыс. руб.', 'procedure_source_money_unit':'руб.', 'procedure_overlay_applied':False,
        'contract_count':None,'scope':'master_recorded_fact', 'identity_scope':'snapshot_physical_rows'}
    model['monthly']=monthly_projection(rows,year,report_date,grbs_order=grbs_order)
    # Detail rows share snapshot-local locators with every metric's contributor list.
    model['details']=[{**asdict(r),'physical_row_key':r.physical_row_key,'plan_amount':r.plan_total,
        'fact_amount':r.fact_total,'included':is_procurement_row(r,report_year=year)} for r in rows]
    model['fact_metrics']={kind:metric_block(rows,report_year=year,as_of=report_date,method=method)
                           for kind,method in (('competitive','ЭА'),('single_supplier','ЕП'))}
    model['calendar_fact']=calendar_facts(rows,event_year=year,event_quarter=reporting_quarter(capture),as_of=report_date)
    model['period_contract']={'planned_cohort':'headline and monthly use planned period N/O/P',
        'calendar_fact':'calendar_fact uses Q event period across plan years',
        'money_missing':'Known component sums; see money_coverage and detail missing_money_fields',
        'as_of':report_date, 'historical_reconstruction':'Requires original frozen capture, not a relabelled current capture'}
    model['exact_metrics']={kind:{scope:metric_block(rows,report_year=year,as_of=report_date,method=method,
        planned_quarter=reporting_quarter(capture) if scope=='quarter' else None)
        for scope in ('year','quarter')} for kind,method in (('competitive','ЭА'),('single_supplier','ЕП'))}
    model['report_content'] = build_business_sections(rows, year=year, as_of=report_date,
        grbs_order=model['grbs_order'], departmental_model=snap['model'])
    from .source_context import context_rows
    model['source_context'] = context_rows(rows, year=year)
    from .context_presentation import CONTRACT, group_context
    model['contract']['context_presentation_contract'] = CONTRACT
    model['source_context_groups'] = group_context(model['source_context'], year=year, as_of=report_date)
    from .automation_assurance import assess_automation
    model['contract']['automation_assurance_contract'] = 'actionable-assurance-v2'
    model['automation_assurance'] = assess_automation(model, capture['sources'])
    model['comparison']=compare_published_models(model,previous_publication['model'] if previous_publication else None)
    model['contract']['weekly_evidence_contract'] = WEEKLY_CONTRACT
    model['weekly_evidence'] = build_weekly_evidence(model, capture.get('weekly_baseline') or freeze_weekly_baseline(None))
    from .traceability import complete_trace_catalog
    model['contract']['trace_catalog_contract'] = 'complete-trace-v1'
    model['trace_records'] = complete_trace_catalog(model)
    from .independent_audit import audit_model
    model['independent_audit']=audit_model(capture,model)
    from .section_audit import audit_source_sections
    section_errors = audit_source_sections({**capture, 'identity_evidence': identity_result}, model, ledger=ledger, identity_evidence=identity_evidence)
    from .document_content import planned_documents
    model['contract']['document_content_contract'] = 'document-plan-v1'
    model['contract']['narrative_source_contract'] = 'recorded-business-v1'
    model['document_plans'] = planned_documents(model)
    blockers=[i.as_dict() for i in validate_recorded_state_model(model,ledger=ledger,documents=documents,budget_years=budget_years)]
    if section_errors:
        blockers.append({'severity':'ERROR','code':'SECTION_SOURCE_MISMATCH',
                         'message':'Обязательные разделы расходятся с исходными записями.',
                         'context':{'sections':section_errors}})
    model['release']={'status':'BLOCKED' if blockers else 'READY_WITH_WARNINGS' if issues else 'READY',
        'official_release_allowed':not blockers,'blockers':blockers,
        'policy':'recorded-state-v1','source_revision_barrier_passed':True,'at_publish_checked':False}
    model['document_plans'] = planned_documents(model)
    assert_projection_parity(model,project_dashboard(model),project_main_view(model),project_management_view(model))
    for kind,method in (('competitive','ЭА'),('single_supplier','ЕП')):
        monthly=[m for m in model['monthly'] if m['method']==method]
        if sum(m['plan_count'] for m in monthly)!=model['headline'][kind]['year']['plan_count']:
            raise ValueError('MONTHLY_PARITY_FAILED')
    dump(snap,out/'snapshot.json');dump(model,out/'report_model.json');dump(replay,out/'recommendation_review.json')
    dump(project_diagnostics(model), out/'diagnostic_protocol.json')
    dump({'issues':issues,'counts':dict(Counter(i['code'] for i in issues))},out/'qa.json')
    dump({'attempts':[asdict(x) for x in attempts], 'shares':[asdict(x) for x in shares],
          'source_amount_unit':'руб.', 'active':active},out/'procedure_lifecycle.json')
    dump({'snapshot_id':model['snapshot']['snapshot_id'], 'rows':model['monthly']},out/'monthly.json')
    dump(project_dashboard(model),out/'dashboard.json');dump(model['release'],out/'release_status.json')
    dump(model['independent_audit'],out/'independent_audit.json')
    dump(closed_quality,out/'closed_procedure_quality.json')
    if identity_result:
        dump(identity_result,out/'identity_observations.json')
        identity_store.backup_snapshot(
            out/'identity.sqlite',
            snapshot_id=bundle.manifest['snapshot_id'],
            as_of=capture['captured_at'],
        )
    if render_docx:
        from .docx_renderer import render_main_docx, render_management_docx
        render_main_docx(model,out/'main_report.docx');render_management_docx(model,out/'management_report.docx')
    return model
