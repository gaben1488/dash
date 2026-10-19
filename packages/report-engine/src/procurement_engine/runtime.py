"""One complete acquisition/build/publication attempt, callable by a system timer."""
from __future__ import annotations

import fcntl
import json
import os
import re
import traceback
import uuid
from datetime import datetime, timezone
from pathlib import Path

from .deployment_diagnostics import public_error_code, safe_sqlite_error
from .google_adapter import (
    GoogleReadClient,
    GoogleReadError,
    capture_google,
    recheck_google_sources,
)
from .identity_store import IdentityStore
from .publication_store import PublicationError, PublicationStore, _assurance_hash
from .raw_pipeline import (
    build_from_capture,
    bundle_from_capture,
)
from .recommendation_history import issued_recommendations, read_google_history
from .snapshot import canonical_semantic_hash
from .weekly_evidence import freeze_weekly_baseline


def _load(path):
    return json.loads(Path(path).read_text(encoding='utf-8'))


def _write(path, value):
    mode = path.stat().st_mode & 0o777 if path.exists() else 0o600
    temporary = path.with_name(path.name + '.' + uuid.uuid4().hex + '.tmp')
    try:
        with temporary.open('x', encoding='utf-8') as file:
            os.fchmod(file.fileno(), mode)
            json.dump(value, file, ensure_ascii=False, separators=(',', ':'), allow_nan=False)
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


def _checkpoint(state, attempt, status, stage):
    status['stage'] = stage
    journal = {key: status[key] for key in ('status', 'attempt_id', 'started_at', 'stage',
        'snapshot_id', 'report_date', 'pending_release_id') if key in status}
    _write(attempt / 'status.json', journal)
    _write(state / 'status.json', journal)


def _recover_committed_publication(state, status):
    """Only a validated receipt proves publication, including a lost response."""
    release_id = status.get('pending_release_id')
    if not release_id:
        return False
    store = PublicationStore(state / 'published', readonly=True)
    try:
        receipt = store.receipt(release_id)
    except PublicationError as error:
        if str(error) == 'PUBLICATION_NOT_FOUND':
            return False
        raise
    if receipt['snapshot_id'] != status.get('snapshot_id'):
        raise ValueError('REPORT_ATTEMPT_STATE_INVALID')
    status.update(status=receipt['status'], publication=receipt, recovered_publication=True,
                  finished_at=receipt['published_at'],
                  recovered_at=datetime.now(timezone.utc).isoformat())
    return True


def _recover_interrupted_attempts(state):
    """Caller owns run.lock: no RUNNING journal can still have a live writer."""
    current = _load(state / 'status.json') if (state / 'status.json').exists() else {}
    if current.get('status') == 'RUNNING':
        identifier = current.get('attempt_id')
        if not isinstance(identifier, str) or not re.fullmatch(r'[a-f0-9]{32}', identifier):
            raise ValueError('REPORT_ATTEMPT_STATE_INVALID')
        root = state / 'attempts' / identifier
        if root.is_symlink() or not root.is_dir() or (root / 'status.json').is_symlink():
            raise ValueError('REPORT_ATTEMPT_STATE_INVALID')
        if not (root / 'status.json').exists():
            _write(root / 'status.json', current)  # Recover the previous global-only format.
        saved = _load(root / 'status.json')
        if saved.get('status') in {'VERIFIED', 'VERIFIED_WITH_WARNINGS', 'NOT_ISSUED'}:
            # The local terminal write succeeded before the global pointer failed.
            _write(state / 'status.json', saved)
            from .report_health import record_attempt
            record_attempt(state, saved)
    for path in sorted((state / 'attempts').glob('*/status.json')):
        if not re.fullmatch(r'[a-f0-9]{32}', path.parent.name):
            continue
        if path.is_symlink() or path.parent.is_symlink():
            raise ValueError('REPORT_ATTEMPT_STATE_INVALID')
        status = _load(path)
        if status.get('status') != 'RUNNING':
            continue
        if status.get('attempt_id') != path.parent.name:
            raise ValueError('REPORT_ATTEMPT_STATE_INVALID')
        if not _recover_committed_publication(state, status):
            detected = datetime.now(timezone.utc).isoformat()
            status.update(status='NOT_ISSUED', error_code='REPORT_ATTEMPT_INTERRUPTED',
                          failure_stage=status.get('stage'), interrupted_detected_at=detected,
                          finished_at=None)
        _finish_attempt(state, path.parent, status)


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
        _recover_interrupted_attempts(state)
        attempt_id = uuid.uuid4().hex
        attempt = state / 'attempts' / attempt_id
        attempt.mkdir(parents=True, mode=0o700)
        status = {'status': 'RUNNING', 'attempt_id': attempt_id,
                  'started_at': datetime.now(timezone.utc).isoformat()}
        stage = 'inputs'
        _checkpoint(state, attempt, status, stage)
        try:
            registry = _load(registry_path)
            ledger = issued_recommendations(_load(ledger_path))
            from .runtime_inputs import validate_inputs

            validate_inputs(registry, ledger)
            stage = 'acquisition'
            _checkpoint(state, attempt, status, stage)
            client = client or GoogleReadClient()
            ledger, _, history_metadata, history_package = read_google_history(client, ledger, include_package=True)
            capture = capture_google(registry, client)
            identities = IdentityStore(state / 'identity.sqlite')
            identity_evidence = identities.review_evidence(as_of=capture['captured_at'])
            if history_metadata is not None:
                capture['recommendation_history_evidence'] = {'metadata': history_metadata, 'package': history_package}
            stage = 'publication_selection'
            _checkpoint(state, attempt, status, stage)
            publications = PublicationStore(state / 'published')
            latest = publications.latest()
            capture['weekly_baseline'] = freeze_weekly_baseline(publications.previous_weekly_model(capture['report_date']))
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
            _checkpoint(state, attempt, status, stage)
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
                source_equivalence = {}
                def final_revisions():
                    versions, proofs = recheck_google_sources(registry, capture, client)
                    source_equivalence.clear()
                    source_equivalence.update(proofs)
                    current_ledger, _, metadata = read_google_history(client, issued_recommendations(_load(ledger_path)))
                    history_revision = {'RECOMMENDATION_HISTORY_EVIDENCE': canonical_semantic_hash(metadata)} if metadata is not None else {}
                    if proofs:
                        # History reads must not leave a window after the content reread barrier.
                        providers = {source['provider_id'] for source in registry['sources']}
                        final_versions = {provider: client.revision(provider) for provider in sorted(providers)}
                        if any(final_versions[source['provider_id']] != versions[source['source_id']]
                               for source in registry['sources']):
                            raise GoogleReadError('SOURCE_CHANGED_DURING_FREEZE')
                    return {**versions, **history_revision,
                            'HISTORICAL_RECOMMENDATIONS': canonical_semantic_hash(current_ledger),
                            'SOURCE_CONTRACT': canonical_semantic_hash(_load(registry_path)),
                            'IDENTITY_REVIEWS': canonical_semantic_hash(identities.review_evidence(as_of=capture['captured_at'])),
                            'WEEKLY_BASELINE': canonical_semantic_hash(capture['weekly_baseline'])}

                stage = 'publication'
                # Same strict canonical JSON digest used by the publication validator.
                status['pending_release_id'] = 'REL-' + _assurance_hash(model)
                _checkpoint(state, attempt, status, stage)
                receipt = publications.publish(attempt / 'bundle', read_revisions=final_revisions, source_equivalence=source_equivalence)
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
            if _recover_committed_publication(state, status):
                status.update(post_commit_error_code=code, post_commit_error_type=type(error).__name__)
            else:
                status.update(status='NOT_ISSUED',
                              error_code=code, failure_stage=stage,
                              error_type=type(error).__name__)
                if sqlite_error is not None:
                    status['sqlite_error'] = sqlite_error
        return _finish_attempt(state, attempt, status)


def _retained_attempt_status(status):
    """Only a new reused observation references immutable evidence (ADR-001)."""
    publication = status.get('publication')
    if (status.get('reused_publication') is not True
            or status.get('status') not in {'VERIFIED', 'VERIFIED_WITH_WARNINGS'}
            or 'automation_assurance' in status or not isinstance(publication, dict)
            or publication.get('status') != status['status']
            or not status.get('snapshot_id') or status['snapshot_id'] != publication.get('snapshot_id')
            or not isinstance(publication.get('model_sha256'), str)
            or not re.fullmatch(r'[a-f0-9]{64}', publication['model_sha256'])
            or publication.get('release_id') != 'REL-' + publication['model_sha256']
            or 'automation_assurance_ref' in publication
            or not isinstance(publication.get('automation_assurance'), dict)):
        return status
    reference = {'release_id': publication['release_id'],
                 'content_sha256': _assurance_hash(publication['automation_assurance'])}
    retained = {key: value for key, value in publication.items() if key != 'automation_assurance'}
    return {**status, 'publication': {**retained, 'automation_assurance_ref': reference}}


def _finish_attempt(state, attempt, status):
    status.setdefault('finished_at', datetime.now(timezone.utc).isoformat())
    _write(attempt / 'status.json', _retained_attempt_status(status))
    _write(state / 'status.json', status)
    from .report_health import record_attempt
    try:
        record_attempt(state, status)
    except (OSError, ValueError):
        print('REPORT_HEALTH_WRITE_FAILED', file=__import__('sys').stderr)
    return status
