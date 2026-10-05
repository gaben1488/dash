"""Offline upgrade rehearsal over a verified saved release; never a live publication.

All writes, including the identity database copy, stay in a private TemporaryDirectory.
Production can be mounted read-only and networking disabled for this command.
"""
from __future__ import annotations

import argparse
import json
import re
import shutil
import tempfile
from collections import Counter, defaultdict
from pathlib import Path

from .deployment_diagnostics import PUBLIC_CODES, public_error_code
from .identity_store import IdentityStore
from .publication_store import PublicationStore, _validate
from .raw_pipeline import build_from_capture
from .runtime_inputs import validate_inputs


def _json(path):
    return json.loads(path.read_text(encoding='utf-8'))



def _coverage_details(candidate):
    """Safe aggregate diagnostics for engine-owned gaps; never emit business text or IDs."""
    identity_rows = (candidate.get('identity_observations') or {}).get('rows') or []
    unresolved = [row for row in identity_rows if not row.get('procurement_uid')]
    candidate_buckets = Counter()
    for row in unresolved:
        evidence = row.get('evidence') or {}
        count = len(set(evidence.get('candidate_uids') or []))
        candidate_buckets['0' if count == 0 else '1' if count == 1 else '2+'] += 1

    details = candidate.get('details') or []
    by_business = defaultdict(list)
    for row in details:
        business_id = str(row.get('source_row_no') or '').strip().casefold()
        if business_id:
            by_business[(row.get('grbs'), business_id)].append(row)

    from .recommendation_links import _text, _text_ids

    gap_shapes = Counter()
    subject_only = Counter()
    for record in candidate.get('recommendation_records') or []:
        if not record.get('active_in_current_slice'):
            continue
        link = record.get('current_link') or {}
        if link.get('status') == 'CONFIRMED':
            continue
        text = _text(record.get('recommendation_text'))
        ids, _ = _text_ids(text)
        if ids:
            groups = [by_business[(record.get('grbs'), str(value).casefold())] for value in ids]
            if all(len(group) == 1 for group in groups):
                gap_shapes['explicit_ids_all_present_unique'] += 1
                rows = [group[0] for group in groups]
                if all(row.get('procurement_uid') for row in rows):
                    gap_shapes['explicit_ids_all_have_uid'] += 1
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
        shutil.copyfile(root / 'identity.sqlite', work / 'identity.sqlite')
        identities = IdentityStore(work / 'identity.sqlite')
        identities.recover_latest_plan_signatures([*state.glob('attempts/*/bundle/snapshot_bundle'),
            *state.glob('published/releases/*/snapshot_bundle')], recover_chain=True)
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
            result.update(_coverage_details(candidate))
        return result


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--state', required=True)
    parser.add_argument('--coverage', action='store_true')
    args = parser.parse_args(argv)
    try:
        result = rehearse_latest(args.state, coverage=args.coverage)
    except Exception as error:  # noqa: BLE001 — CLI boundary never prints private source text or tracebacks.
        result = {'replay_status': 'FAIL', 'error_code': public_error_code(str(error))}
    print(json.dumps(result, ensure_ascii=False, allow_nan=False))
    return 0 if result['replay_status'] == 'PASS' else 2


if __name__ == '__main__':
    raise SystemExit(main())
