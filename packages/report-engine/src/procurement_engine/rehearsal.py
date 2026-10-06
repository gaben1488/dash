"""Offline upgrade rehearsal over a verified saved release; never a live publication.

All writes, including the identity database copy, stay in a private TemporaryDirectory.
Production can be mounted read-only and networking disabled for this command.
"""
from __future__ import annotations

import argparse
import json
import re
import tempfile
from collections import Counter, defaultdict
from datetime import date
from pathlib import Path

from .deployment_diagnostics import PUBLIC_CODES, public_error_code, safe_sqlite_error
from .identity_store import IdentityStore, freeze_identity_snapshot
from .publication_store import PublicationError, PublicationStore, _validate
from .raw_pipeline import build_from_capture
from .runtime_inputs import validate_inputs


def _json(path):
    return json.loads(path.read_text(encoding='utf-8'))


def diagnose_failed_attempt(state):
    """Recheck retained failure bytes; expose only bounded audit categories."""
    failures = []
    for path in Path(state).glob('attempts/*/status.json'):
        try:
            status = _json(path)
        except (OSError, ValueError):
            continue
        bundle = path.parent / 'bundle'
        if (isinstance(status, dict) and status.get('error_code') == 'SAVED_SOURCE_RECHECK_FAILED'
                and bundle.is_dir() and not bundle.is_symlink()):
            failures.append((status.get('finished_at') or '', bundle))
    if not failures:
        return None
    root = max(failures, key=lambda item: item[0])[1]
    try:
        _validate(root)
    except PublicationError as error:
        evidence = getattr(error, 'evidence', {})
        allowed = {'source_context', 'remaining_population', 'identity_evidence', 'recommendation_records',
            'recommendation_evidence', 'future_plan', 'procedure_source_contract', 'procedures',
            'closed_procedure_quality', 'active_procedures_count', 'management_summary.procedure_rows',
            'management_summary.procedure_count', 'automation_assurance'}
        return {'error_code': public_error_code(str(error)),
            **{key: evidence[key] for key in ('formula_closed', 'arithmetic_pass')
               if type(evidence.get(key)) is bool},
            'section_errors': dict(Counter(code if code in allowed else 'UNRECOGNIZED_SECTION'
                for code in evidence.get('section_errors', [])))}
    return {'recheck_status': 'PASS'}


def rehearse_weekly(state):
    """Replay the newest own sealed week into disposable storage, offline."""
    from .archive_runtime import build_archived_release

    weeks = sorted(Path(state).glob('archives/WEEKLY-*'))
    if not weeks:
        return None
    source = weeks[-1]
    day = date.fromisoformat(source.name.removeprefix('WEEKLY-'))
    with tempfile.TemporaryDirectory(prefix='report-weekly-rehearsal-') as temporary:
        receipt = build_archived_release(source, temporary, day=day.isoformat(),
                                         year=day.year, quarter=(day.month - 1) // 3 + 1)
        root = Path(temporary) / 'published/releases' / receipt['release_id']
        _validate(root)
        documents = all((root / name).read_bytes().startswith(b'PK')
                        for name in ('main_report.docx', 'management_report.docx'))
        return {'replay_status': 'PASS', 'two_docx_rebuilt': documents,
                'source_verification': receipt['source_verification']}



def _coverage_details(candidate, identities=None):
    """Safe aggregate diagnostics for engine-owned gaps; never emit business text or IDs."""
    identity_rows = (candidate.get('identity_observations') or {}).get('rows') or []
    unresolved = [row for row in identity_rows if not row.get('procurement_uid')]
    candidate_buckets = Counter()
    for row in unresolved:
        evidence = row.get('evidence') or {}
        count = len(set(evidence.get('candidate_uids') or []))
        candidate_buckets['0' if count == 0 else '1' if count == 1 else '2+'] += 1

    from .normalize import normalize_id
    from .recommendation_links import _text, _text_ids

    details = candidate.get('details') or []
    by_business = defaultdict(list)
    for row in details:
        business_id = normalize_id(row.get('source_row_no'))
        if business_id:
            by_business[(row.get('grbs'), business_id)].append(row)

    gap_shapes = Counter()
    subject_only = Counter()
    origin_date_bindable = 0
    for record in candidate.get('recommendation_records') or []:
        if not record.get('active_in_current_slice'):
            continue
        link = record.get('current_link') or {}
        if link.get('status') == 'CONFIRMED':
            continue
        text = _text(record.get('recommendation_text'))
        ids, _ = _text_ids(text)
        if ids:
            groups = [by_business[(record.get('grbs'), normalize_id(value))] for value in ids]
            if all(len(group) == 1 for group in groups):
                gap_shapes['explicit_ids_all_present_unique'] += 1
                rows = [group[0] for group in groups]
                if all(row.get('procurement_uid') for row in rows):
                    gap_shapes['explicit_ids_all_have_uid'] += 1
                    if identities is not None and link.get('origin'):
                        proof = identities.prove_origin_date_binding(
                            details,
                            grbs=record.get('grbs'),
                            business_ids=ids,
                            document_date=link['origin'].get('document_date'),
                        )
                        origin_date_bindable += int(proof is not None)
            else:
                if any(len(group) == 0 for group in groups):
                    gap_shapes['explicit_ids_missing_current_row'] += 1
                if any(len(group) > 1 for group in groups):
                    gap_shapes['explicit_ids_ambiguous_current_row'] += 1
            continue

        origin = link.get('origin') or {}
        year = str(origin.get('document_date') or '')[:4]
        candidates = [
            row for row in details
            if row.get('grbs') == record.get('grbs')
            and (not year or not row.get('planned_year') or str(row.get('planned_year')) == year)
        ]
        matches = []
        for row in candidates:
            subject = _text(row.get('subject'))
            if subject and re.search(r'(?<!\w)' + re.escape(subject) + r'(?!\w)', text):
                matches.append(row)
        if not matches:
            subject_only['none'] += 1
        elif len(matches) == 1:
            subject_only['unique_exact_subject'] += 1
            if matches[0].get('procurement_uid'):
                subject_only['unique_exact_subject_with_uid'] += 1
        else:
            subject_only['multiple_exact_subjects'] += 1

    return {
        'identity_status_counts': dict(sorted(Counter(row.get('status') or 'UNKNOWN' for row in identity_rows).items())),
        'identity_unresolved_candidate_uid_buckets': dict(sorted(candidate_buckets.items())),
        'recommendation_gap_shapes': dict(sorted(gap_shapes.items())),
        'origin_date_identity_bindable_count': origin_date_bindable,
        'text_reference_missing_subject_shapes': dict(sorted(subject_only.items())),
    }


def rehearse_latest(state_dir, *, coverage=False):
    """Check old artifact integrity and rebuild frozen evidence with installed rules.

    PASS means the candidate can process that saved input. It does NOT establish
    source freshness, authorize a new current release or replace native HTTP checks.
    No Google request, schedule change, production identity write or publish occurs.
    """
    state = Path(state_dir).resolve()
    if not (state / 'published/publications.sqlite').is_file():
        raise ValueError('PUBLICATION_NOT_FOUND')
    store = PublicationStore(state / 'published', readonly=True)
    from .readonly_catalog import copied_catalog

    with copied_catalog(store.database_path) as catalog:
        store.database_path = catalog
        receipt = store.latest()
    if receipt is None:
        raise ValueError('PUBLICATION_NOT_FOUND')
    root = store.releases / receipt['release_id']
    previous, *_ = _validate(root)
    snapshot = root / 'snapshot_bundle'
    manifest = _json(snapshot / 'manifest.json')
    bundle = _json(snapshot / 'bundle.json')
    payloads = [_json(snapshot / item['path']) for item in manifest['payload_index']]
    contracts = [p['semantic_values'] for p in payloads if p['role'] == 'rule_contract']
    ledgers = [p['semantic_values'] for p in payloads if p['role'] == 'historical_ledger']
    if len(contracts) != 1 or len(ledgers) != 1:
        raise ValueError('INPUT_CONTRACT_INVALID')
    registry, ledger = contracts[0], ledgers[0]
    validate_inputs(registry, ledger)
    capture = {key: manifest[key] for key in ('captured_at', 'timezone', 'report_date', 'report_year')}
    capture['sources'] = []
    for payload in payloads:
        meta = payload.get('metadata') or {}
        if payload['role'] == 'archived_file_evidence':
            capture['archived_file_evidence'] = payload['semantic_values']
        if payload['role'] == 'historical_report_evidence':
            capture['recommendation_history_evidence'] = payload['semantic_values']
        if 'sheet_title' not in meta:
            continue
        sid = payload['source_id']
        source = {'source_id': sid, 'role': payload['role'], 'provider_id': payload['provider_id'],
                  'sheet_id': int(payload['sheet_or_tab_id']), 'sheet': meta['sheet_title'],
                  'grbs': meta.get('grbs'), 'rows': meta['row_count'], 'columns': meta['column_count'],
                  'header_rows': meta.get('header_rows', 3), 'values': payload['semantic_values'],
                  'before': bundle['before'][sid], 'after': bundle['after'][sid]}
        for key in ('capture_method', 'archive_file_sha256'):
            if key in meta:
                source[key] = meta[key]
        if 'formula_evidence' in meta:
            source['formula_evidence'] = meta['formula_evidence']
        capture['sources'].append(source)
    with tempfile.TemporaryDirectory(prefix='report-rehearsal-') as temporary:
        work = Path(temporary)
        freeze_identity_snapshot(
            root / 'identity.sqlite',
            work / 'identity.sqlite',
            snapshot_id=manifest['snapshot_id'],
            as_of=capture['captured_at'],
        )
        identities = IdentityStore(work / 'identity.sqlite')
        identities.recover_latest_plan_signatures([*state.glob('attempts/*/bundle/snapshot_bundle'),
            *state.glob('published/releases/*/snapshot_bundle'),
            *state.glob('archives/*/snapshot_bundle')], recover_chain=True)
        candidate = build_from_capture(capture, registry, ledger, work / 'bundle', identity_store=identities)
        issues = [*candidate.get('issues', []), *candidate['release']['blockers']]
        errors = Counter(issue['code'] if issue.get('code') in PUBLIC_CODES else 'UNRECOGNIZED_ERROR'
                         for issue in issues if issue.get('severity') == 'ERROR')
        documents = all((work / 'bundle' / name).read_bytes().startswith(b'PK')
                        for name in ('main_report.docx', 'management_report.docx'))
        ready = candidate['release']['official_release_allowed'] is True
        if ready:
            # The same domain/artifact checks used by publication, but no commit
            # and no fabricated assertion about current provider revisions.
            _validate(work / 'bundle')
        result = {'frozen_release_readable': True, 'replay_status': 'PASS' if ready else 'BLOCKED',
                'independent_audit': 'PASS' if candidate['independent_audit']['pass'] else 'FAIL',
                'two_docx_rebuilt': documents, 'headline_changed': candidate['headline'] != previous['headline'],
                'error_counts': dict(sorted(errors.items()))}
        if coverage:
            assurance = candidate.get('automation_assurance') or {}
            result['automation'] = {key: assurance.get(key) for key in ('fully_automated', 'user_action_count',
                'engine_action_count', 'active_recommendations', 'link_status_counts', 'action_status_counts')}
            result['identity_unresolved_count'] = candidate['identity_observations']['unresolved_count']
            result['action_code_counts'] = dict(Counter(action['code'] for action in assurance.get('actions', [])))
            result.update(_coverage_details(candidate, identities))
            weekly = rehearse_weekly(state)
            if weekly is not None:
                result['weekly'] = weekly
        return result


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--state', required=True)
    parser.add_argument('--coverage', action='store_true')
    parser.add_argument('--failed-attempt', action='store_true')
    args = parser.parse_args(argv)
    try:
        if args.failed_attempt:
            print(json.dumps({'failed_attempt': diagnose_failed_attempt(args.state)}, ensure_ascii=False))
            return 0
        result = rehearse_latest(args.state, coverage=args.coverage)
    except Exception as error:  # noqa: BLE001 — CLI boundary never prints private source text or tracebacks.
        message = str(error)
        result = {
            'replay_status': 'FAIL',
            'error_code': public_error_code(message),
            'error_type': type(error).__name__,
        }
        # Known invariant failures are fixed machine codes. Expose only that
        # restricted grammar; arbitrary exception text can contain source data.
        if message in PUBLIC_CODES:
            result['internal_code'] = message
        sqlite_error = getattr(error, 'sqlite_errorname', None)
        if safe_sqlite_error(sqlite_error) is not None:
            result['sqlite_error'] = sqlite_error
    print(json.dumps(result, ensure_ascii=False, allow_nan=False))
    return 0 if result['replay_status'] == 'PASS' else 2


if __name__ == '__main__':
    raise SystemExit(main())
