"""Derived worker observations; never an input to publication eligibility."""
from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from pathlib import Path

SUCCESS = {'VERIFIED', 'VERIFIED_WITH_WARNINGS'}
CHECK_STALE_SECONDS = 3600
STAGES = {'inputs', 'acquisition', 'publication_selection', 'build', 'publication'}


def _read(path, max_bytes=1024 * 1024):
    try:
        if path.stat().st_size > max_bytes:
            return {}
        value = json.loads(path.read_text(encoding='utf-8'))
        return value if isinstance(value, dict) else {}
    except (OSError, ValueError):
        return {}


def _instant(value):
    try:
        result = datetime.fromisoformat(value)
        return result if result.tzinfo is not None else None
    except (TypeError, ValueError):
        return None


def _past(value, now):
    instant = _instant(value)
    return instant if instant and instant <= now else None


def _elapsed(start, end):
    first, last = _instant(start), _instant(end)
    return round((last - first).total_seconds()) if first and last and last >= first else None


def _code(value):
    return value if isinstance(value, str) and re.fullmatch(r'[A-Z][A-Z0-9_]{1,100}', value) else 'REPORT_ATTEMPT_FAILED'


def _index(state, now):
    saved = _read(state / 'report-health.json')
    result = {}
    for field in ('last_finished_at', 'last_success_at', 'last_failure_at'):
        instant = _past(saved.get(field), now)
        if instant:
            result[field] = instant.isoformat()
    duration = saved.get('last_cycle_duration_seconds')
    if result.get('last_finished_at') and type(duration) is int and duration >= 0:
        result['last_cycle_duration_seconds'] = duration
    if result.get('last_failure_at'):
        result['last_failure_code'] = _code(saved.get('last_failure_code'))
        stage = saved.get('last_failure_stage')
        result['last_failure_stage'] = stage if isinstance(stage, str) and stage in STAGES else None
    return result


def _fold(index, status, now):
    finished = _past(status.get('finished_at'), now)
    outcome = status.get('status')
    if not finished or not isinstance(outcome, str) or outcome not in SUCCESS | {'NOT_ISSUED'}:
        return
    previous = _instant(index.get('last_finished_at'))
    if not previous or finished >= previous:
        index['last_finished_at'] = finished.isoformat()
        index['last_cycle_duration_seconds'] = _elapsed(status.get('started_at'), status.get('finished_at'))
    field = 'last_success_at' if status.get('status') in SUCCESS else 'last_failure_at'
    previous = _instant(index.get(field))
    if not previous or finished >= previous:
        index[field] = finished.isoformat()
        if field == 'last_failure_at':
            blockers = status.get('blockers')
            first = blockers[0] if isinstance(blockers, list) and blockers and isinstance(blockers[0], dict) else {}
            index['last_failure_code'] = _code(status.get('error_code') or first.get('code'))
            stage = status.get('failure_stage')
            index['last_failure_stage'] = stage if isinstance(stage, str) and stage in STAGES else None


def record_attempt(state_dir, status):
    """Best-effort caller holds existing run.lock, including publication reuse."""
    from .runtime import _write
    state = Path(state_dir)
    now = datetime.now(timezone.utc)
    index = _index(state, now)
    if not index:
        # ponytail: initial metadata-only rebuild, never bundle scanning on GET.
        for path in (state / 'attempts').glob('*/status.json'):
            _fold(index, _read(path), now)
    _fold(index, status, now)
    _write(state / 'report-health.json', index)


def _running(state, attempt):
    if not attempt or attempt.get('status') != 'RUNNING':
        return 'idle' if attempt else 'unknown'
    try:
        import fcntl
        with (state / 'run.lock').open('r') as lock:
            try:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                return 'running'
            fcntl.flock(lock, fcntl.LOCK_UN)
            return 'interrupted'
    except (OSError, ImportError):
        return 'unknown'


def report_health(state_dir, attempt=None, publication=None, *, now=None):
    """Read-only check freshness is independent of an unchanged Word cutoff."""
    state = Path(state_dir)
    now = now or datetime.now(timezone.utc)
    index = _index(state, now)
    attempt = attempt if isinstance(attempt, dict) else _read(state / 'status.json')
    _fold(index, attempt, now)
    success = _instant(index.get('last_success_at'))
    failure = _instant(index.get('last_failure_at'))
    checked = now.isoformat()
    age = _elapsed(index.get('last_success_at'), checked)
    worker = _running(state, attempt)
    cutoff = _instant((publication or {}).get('cutoff_at'))
    return {
        'checked_at': checked,
        'worker_state': worker,
        'running_duration_seconds': _elapsed(attempt.get('started_at'), checked) if worker == 'running' else None,
        'last_cycle_duration_seconds': index.get('last_cycle_duration_seconds'),
        'last_success_at': success.isoformat() if success else None,
        'last_success_age_seconds': age,
        'check_stale': age is None or age > CHECK_STALE_SECONDS,
        'last_failure_at': failure.isoformat() if failure else None,
        'last_failure_code': index.get('last_failure_code') if failure else None,
        'last_failure_stage': index.get('last_failure_stage') if failure else None,
        'failure_resolved': bool(failure and success and success >= failure),
        'publication_cutoff_at': cutoff.isoformat() if cutoff else None,
    }
