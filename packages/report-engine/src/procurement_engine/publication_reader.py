"""Read only committed, integrity-checked report artifacts; never use live rows."""
from __future__ import annotations

import json
from datetime import date
from pathlib import Path

from .publication_store import PublicationError, PublicationStore


def _same_release_assurance(receipt, reference):
    return (isinstance(receipt, dict) and isinstance(reference, dict)
            and bool(receipt.get('release_id')) and receipt['release_id'] == reference.get('release_id')
            and receipt.get('automation_assurance') is not None
            and receipt['automation_assurance'] == reference.get('automation_assurance'))


def _assurance_reference(receipt, reference):
    """Elide equal evidence of the SAME release only, never distinct business records."""
    if not _same_release_assurance(receipt, reference):
        return receipt
    projected = dict(receipt)
    projected.pop('automation_assurance')
    projected['automation_assurance_release_id'] = receipt['release_id']
    return projected


def _status_projection(result):
    """A public read DTO, not a rewrite of immutable receipts or worker evidence.

    The selected (or fallback) release retains its complete assurance. A status
    used to serialize that same large object up to four times. All references
    point to that visible release; other contexts and failed-attempt explanations
    retain their own evidence in full.
    """
    projected = dict(result)
    visible = result.get('selected') or result.get('latest') or result.get('latest_matching')
    if result.get('selected') is not None:
        projected['latest_matching'] = _assurance_reference(result.get('latest_matching'), visible)
    attempt = result.get('attempt')
    if isinstance(attempt, dict) and attempt.get('status') in {'VERIFIED', 'VERIFIED_WITH_WARNINGS'}:
        publication = attempt.get('publication')
        if isinstance(publication, dict):
            public_attempt = dict(attempt)
            # Keep the outer evidence when it belongs to another reporting context.
            own = {'release_id': publication.get('release_id'),
                   'automation_assurance': attempt.get('automation_assurance')}
            public_attempt['publication'] = _assurance_reference(publication, visible)
            if _same_release_assurance(own, visible):
                public_attempt.pop('automation_assurance', None)
                public_attempt['automation_assurance_release_id'] = publication['release_id']
            projected['attempt'] = public_attempt
    return projected


def read_publication(state_dir, view, release_id=None, *, selection=None):
    root = Path(state_dir) / 'published'
    if (root / 'publications.sqlite').is_file():
        with PublicationStore(root, readonly=True).reader_lease():
            return _read_publication(state_dir, view, release_id, selection=selection)
    return _read_publication(state_dir, view, release_id, selection=selection)


def _read_publication(state_dir, view, release_id=None, *, selection=None):
    if selection is not None:
        try:
            day, year, quarter = selection
            if (view != 'status' or release_id is not None or date.fromisoformat(day).isoformat() != day
                    or type(year) is not int or not 1900 <= year <= 9999
                    or type(quarter) is not int or quarter not in (1, 2, 3, 4)):
                raise ValueError('invalid selection')
        except (TypeError, ValueError) as exc:
            raise PublicationError('PUBLICATION_CONTEXT_INVALID') from exc
    state = Path(state_dir)
    root = state / 'published'
    exists = (root / 'publications.sqlite').is_file()
    store = PublicationStore(root, readonly=True) if exists else None
    if view == 'history':
        rows = store.history_summaries(limit=51, before=release_id) if store else []
        return json.dumps({'releases': rows[:50], 'next': rows[49]['release_id'] if len(rows) > 50 else None},
                          ensure_ascii=False, allow_nan=False).encode()
    if view == 'status':
        attempt_path = state / 'status.json'
        attempt = json.loads(attempt_path.read_text(encoding='utf-8')) if attempt_path.exists() else None
        if selection is not None:
            result = {**(store.select_status(*selection) if store else {'selected': None, 'latest_matching': None}),
                      'attempt': attempt}
            # GET remains read-only. Archive job status never overwrites the live worker status.
            from .archive_runtime import MESSAGES, selection_key
            archive_path = state / 'archive_attempts' / selection_key(*selection) / 'status.json'
            if archive_path.is_file():
                saved = json.loads(archive_path.read_text(encoding='utf-8'))
                job = saved.get('archive') or {}
                if job.get('status') in {'READY', 'RUNNING', 'NOT_ISSUED'}:
                    result['archive'] = job
                    # Process death cannot leave the UI saying RUNNING forever.
                    if job.get('status') == 'RUNNING':
                        import fcntl
                        lock_path = archive_path.with_name('run.lock')
                        if lock_path.is_file():
                            with lock_path.open('r') as lock:
                                try:
                                    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                                except BlockingIOError:
                                    pass
                                else:
                                    result['archive'] = {'status': 'NOT_ISSUED', 'code': 'ARCHIVE_BUILD_FAILED',
                                        'message': MESSAGES['ARCHIVE_BUILD_FAILED']}
                                    fcntl.flock(lock, fcntl.LOCK_UN)

        else:
            result = {'latest': store.latest() if store else None, 'attempt': attempt}
        from .report_health import report_health
        result['operations'] = report_health(state, attempt, result.get('selected') or result.get('latest') or result.get('latest_matching'))
        return json.dumps(_status_projection(result), ensure_ascii=False, allow_nan=False).encode()
    if view not in {'dashboard', 'main', 'supplement', 'operational'}:
        raise PublicationError('PUBLICATION_VIEW_INVALID')
    if store is None:
        raise PublicationError('PUBLICATION_NOT_FOUND')
    names = {'dashboard': 'dashboard.json', 'main': 'main_report.docx',
             'supplement': 'management_report.docx', 'operational': 'operational_report.docx'}
    return store.read_artifact(release_id, names[view])
