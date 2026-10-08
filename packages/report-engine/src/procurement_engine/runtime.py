"""One complete acquisition/build/publication attempt, callable by a system timer."""
from __future__ import annotations

import fcntl
import json
import os
import traceback
import uuid
from datetime import datetime, timezone
from pathlib import Path

from .deployment_diagnostics import public_error_code, safe_sqlite_error
from .google_adapter import GoogleReadClient, capture_google
from .identity_store import IdentityStore
from .publication_store import PublicationStore
from .raw_pipeline import (
    build_from_capture,
    bundle_from_capture,
)
from .recommendation_history import read_google_history
from .recommendation_intake import (
    previous_published_ledger,
    read_registered_ledger,
    validate_append_only,
    verify_new_official_records,
)
from .snapshot import canonical_semantic_hash


def _load(path):
    return json.loads(Path(path).read_text(encoding='utf-8'))


def _write(path, value):
    temporary = path.with_name(path.name + '.' + uuid.uuid4().hex + '.tmp')
    try:
        with temporary.open('x', encoding='utf-8') as file:
            json.dump(value, file, ensure_ascii=False, indent=2, allow_nan=False)
            file.flush()
            os.fsync(file.fileno())
        os.replace(temporary, path)
        fd = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)
    finally:
        temporary.unlink(missing_ok=True)


def run_once(registry_path, ledger_path, state_dir, *, client=None):
    """Return VERIFIED, VERIFIED_WITH_WARNINGS, NOT_ISSUED, or ALREADY_RUNNING.

    Registry and ledger are private runtime files, never defaults embedded in code.
    Blocking domain findings preserve both the diagnostic attempt and prior release.
    """
    state = Path(state_dir)
    state.mkdir(parents=True, exist_ok=True, mode=0o700)
    with (state / 'run.lock').open('a') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return {'status': 'ALREADY_RUNNING'}
        attempt_id = uuid.uuid4().hex
        attempt = state / 'attempts' / attempt_id
        attempt.mkdir(parents=True, mode=0o700)
        status = {'status': 'RUNNING', 'attempt_id': attempt_id,
                  'started_at': datetime.now(timezone.utc).isoformat()}
        _write(state / 'status.json', status)
        stage = 'inputs'
        try:
            registry = _load(registry_path)
            baseline_ledger = _load(ledger_path)
            from .runtime_inputs import validate_inputs

            validate_inputs(registry, baseline_ledger)
            stage = 'acquisition'
            client = client or GoogleReadClient()
            ledger, authority_metadata, new_from_bootstrap = read_registered_ledger(client, baseline_ledger)
            ledger, historical_documents, history_metadata, history_package = read_google_history(
                client, ledger, include_package=True)
            capture = capture_google(registry, client)
            if new_from_bootstrap:
                verify_new_official_records(ledger, new_from_bootstrap, historical_documents,
                                            report_date=capture['report_date'])
            if authority_metadata is not None:
                capture['authoritative_ledger_source'] = {'metadata': authority_metadata}
            identities = IdentityStore(state / 'identity.sqlite')
            identity_evidence = identities.review_evidence(as_of=capture['captured_at'])
            if history_metadata is not None:
                capture['recommendation_history_evidence'] = {'metadata': history_metadata, 'package': history_package}
            stage = 'publication_selection'
            publications = PublicationStore(state / 'published')
            latest = publications.latest()
            previous_ledger = previous_published_ledger(state, latest)
            if previous_ledger is not None:
                changes_since_release = validate_append_only(previous_ledger, ledger)
                if changes_since_release:
                    verify_new_official_records(ledger, changes_since_release,
                                                historical_documents, report_date=capture['report_date'])
                previous_model = _load(state / 'published' / 'releases' / latest['release_id'] / 'report_model.json')
                if ((previous_model.get('contract') or {}).get('official_ledger_authority') == 'REMOTE'
                        and authority_metadata is None):
                    raise ValueError('OFFICIAL_LEDGER_SOURCE_DISAPPEARED')
            captured_id = bundle_from_capture(capture, registry, ledger, identity_evidence=identity_evidence).manifest['snapshot_id']
            if latest and latest['snapshot_id'] == captured_id:
                status.update(status=latest['status'], publication=latest, snapshot_id=captured_id,
                    report_date=capture['report_date'], reused_publication=True,
                    acquisition_started_at=capture['acquisition_started_at'],
                    acquisition_completed_at=capture['acquisition_completed_at'])
                return _finish_attempt(state, attempt, status)
            _write(attempt / 'capture.json', capture)
            previous = publications.previous_model(capture['report_date'])
            stage = 'build'
            recovery_diagnostics = {}
            identities.recover_latest_plan_signatures([
                *state.glob('attempts/*/bundle/snapshot_bundle'),
                *state.glob('published/releases/*/snapshot_bundle'),
                *state.glob('archives/*/snapshot_bundle')], recover_chain=True, diagnostics=recovery_diagnostics)
            if any(recovery_diagnostics.values()):
                status['identity_recovery'] = recovery_diagnostics
            model = build_from_capture(capture, registry, ledger, attempt / 'bundle',
                                       identity_store=identities, previous_publication=previous)
            status['snapshot_id'] = model['snapshot']['snapshot_id']
            status['report_date'] = model['snapshot']['report_date']
            status['automation_assurance'] = model.get('automation_assurance')
            if model['release']['official_release_allowed'] is not True:
                status.update(status='NOT_ISSUED', blockers=model['release']['blockers'])
            else:
                def final_revisions():
                    providers = {s['provider_id'] for s in registry['sources']}
                    versions = {provider: client.revision(provider) for provider in providers}
                    raw_ledger, latest_authority, _ = read_registered_ledger(client, baseline_ledger)
                    current_ledger, _, metadata = read_google_history(client, raw_ledger)
                    history_revision = {'RECOMMENDATION_HISTORY_EVIDENCE': canonical_semantic_hash(metadata)} if metadata is not None else {}
                    authority_revision = ({'AUTHORITY_LEDGER_INPUT': canonical_semantic_hash(
                        {'metadata': latest_authority})} if latest_authority is not None else {})
                    return {**{s['source_id']: versions[s['provider_id']] for s in registry['sources']},
                            **history_revision, **authority_revision,
                            'HISTORICAL_RECOMMENDATIONS': canonical_semantic_hash(current_ledger),
                            'SOURCE_CONTRACT': canonical_semantic_hash(_load(registry_path)),
                            'IDENTITY_REVIEWS': canonical_semantic_hash(identities.review_evidence(as_of=capture['captured_at']))}

                stage = 'publication'
                receipt = publications.publish(attempt / 'bundle', read_revisions=final_revisions)
                status.update(status=receipt['status'], publication=receipt)
        except Exception as error:  # noqa: BLE001 — process boundary records a failed attempt; never reports success.
            code = public_error_code(str(error))
            sqlite_error = safe_sqlite_error(getattr(error, 'sqlite_errorname', None))
            private_error = attempt / 'error.json'
            try:
                with private_error.open('x', encoding='utf-8') as file:
                    os.chmod(private_error, 0o600)
                    payload = {'attempt_id': attempt_id, 'stage': stage, 'error_code': code,
                               'error_type': type(error).__name__, 'message': str(error),
                               'evidence': getattr(error, 'evidence', None),
                               'traceback': ''.join(traceback.format_exception(error))}
                    if sqlite_error is not None:
                        payload['sqlite_error'] = sqlite_error
                    json.dump(payload, file, ensure_ascii=False)
                    file.flush()
                    os.fsync(file.fileno())
                status['private_error_saved'] = True
            except OSError:
                status['private_error_saved'] = False
            status.update(status='NOT_ISSUED',
                          error_code=code, failure_stage=stage,
                          error_type=type(error).__name__)
            if sqlite_error is not None:
                status['sqlite_error'] = sqlite_error
        return _finish_attempt(state, attempt, status)


def _finish_attempt(state, attempt, status):
    status['finished_at'] = datetime.now(timezone.utc).isoformat()
    _write(attempt / 'status.json', status)
    _write(state / 'status.json', status)
    return status
