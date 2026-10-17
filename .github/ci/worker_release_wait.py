"""Read-only, bounded admission before observing a controlled worker activation."""
import json
import os
import time
from datetime import UTC, datetime


class WorkerReleaseWaitError(RuntimeError):
    pass


def wait_for_release(source_sha, recovery, *, clock=time.monotonic, pause=time.sleep,
                     timeout_seconds=1200):
    deadline = clock() + timeout_seconds
    while True:
        try:
            plan = recovery.validate_plan(json.loads(recovery.read_owned(
                recovery.RUNTIME_DIR/'trial-plan.json')))
        except FileNotFoundError:
            plan = None
        pending = any(os.path.lexists(recovery.STATE_DIR/name) for name in (
            'pending-release.json', 'release-recovery-progress.json'))
        quiescent = any(recovery.BACKUP_BASE.glob('*/quiescent'))
        if plan and plan['release_sha'] == source_sha and not pending and not quiescent:
            try:
                accepted = json.loads(recovery.read_owned(recovery.STATE_DIR/'release-accepted.json'))
            except FileNotFoundError:
                accepted = None
            if accepted is not None:
                expected = {'plan_sha256': recovery.digest(json.dumps(plan, sort_keys=True,
                    separators=(',', ':')).encode()), 'acceptance': recovery.ReleaseRecovery._acceptance(plan)}
                if accepted != expected:
                    raise WorkerReleaseWaitError('WORKER_RELEASE_ACCEPTANCE_INVALID')
                return plan
        if clock() >= deadline:
            raise WorkerReleaseWaitError('WORKER_RELEASE_WAIT_TIMED_OUT')
        pause(min(5, deadline-clock()))


def cycle_cutoff(observer_started_at, worker_started_at):
    dates = [datetime.fromisoformat(value) for value in (observer_started_at, worker_started_at)]
    if any(value.tzinfo is None for value in dates):
        raise ValueError('WORKER_OBSERVATION_CLOCK_INVALID')
    return max(dates).astimezone(UTC).isoformat()
