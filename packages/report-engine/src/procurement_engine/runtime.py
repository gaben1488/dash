"""One complete acquisition/build/publication attempt, callable by a system timer."""
from __future__ import annotations

import fcntl
import json
import os
import traceback
import uuid
from datetime import datetime, timezone
from pathlib import Path

from .deployment_diagnostics import public_error_code
from .google_adapter import GoogleReadClient, capture_google
from .identity_store import IdentityStore
from .publication_store import PublicationStore
from .raw_pipeline import (
    build_from_capture,
    bundle_from_capture,
    validate_ledger_contract,
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
            ledger = _load(ledger_path)
            validate_ledger_contract(ledger)
            stage = 'acquisition'
            client = client or GoogleReadClient()
            capture = capture_google(registry, client)
            stage = 'publication_selection'
            publications = PublicationStore(state / 'published')
            latest = publications.latest()
            captured_id = bundle_from_capture(capture, registry, ledger).manifest['snapshot_id']
            if latest and latest['snapshot_id'] == captured_id:
                status.update(status=latest['status'], publication=latest, snapshot_id=captured_id,
                    report_date=capture['report_date'], reused_publication=True,
                    acquisition_started_at=capture['acquisition_started_at'],
                    acquisition_completed_at=capture['acquisition_completed_at'])
                return _finish_attempt(state, attempt, status)
            _write(attempt / 'capture.json', capture)
            previous = publications.previous_model(capture['report_date'])
            stage = 'build'
            model = build_from_capture(capture, registry, ledger, attempt / 'bundle',
                                       identity_store=IdentityStore(state / 'identity.sqlite'), previous_publication=previous)
            status['snapshot_id'] = model['snapshot']['snapshot_id']
            status['report_date'] = model['snapshot']['report_date']
            if model['release']['official_release_allowed'] is not True:
                status.update(status='NOT_ISSUED', blockers=model['release']['blockers'])
            else:
                def final_revisions():
                    providers = {s['provider_id'] for s in registry['sources']}
                    versions = {provider: client.revision(provider) for provider in providers}
                    return {**{s['source_id']: versions[s['provider_id']] for s in registry['sources']},
                            'HISTORICAL_RECOMMENDATIONS': canonical_semantic_hash(_load(ledger_path)),
                            'SOURCE_CONTRACT': canonical_semantic_hash(_load(registry_path))}

                stage = 'publication'
                receipt = publications.publish(attempt / 'bundle', read_revisions=final_revisions)
                status.update(status=receipt['status'], publication=receipt)
        except Exception as error:  # noqa: BLE001 — process boundary records a failed attempt; never reports success.
            code = public_error_code(str(error))
            private_error = attempt / 'error.json'
            try:
                with private_error.open('x', encoding='utf-8') as file:
                    os.chmod(private_error, 0o600)
                    json.dump({'attempt_id': attempt_id, 'stage': stage, 'error_code': code,
                               'error_type': type(error).__name__, 'message': str(error),
                               'traceback': ''.join(traceback.format_exception(error))}, file, ensure_ascii=False)
                    file.flush()
                    os.fsync(file.fileno())
                status['private_error_saved'] = True
            except OSError:
                status['private_error_saved'] = False
            status.update(status='NOT_ISSUED',
                          error_code=code, failure_stage=stage,
                          error_type=type(error).__name__)
        return _finish_attempt(state, attempt, status)


def _finish_attempt(state, attempt, status):
    status['finished_at'] = datetime.now(timezone.utc).isoformat()
    _write(attempt / 'status.json', status)
    _write(state / 'status.json', status)
    return status
