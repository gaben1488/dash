"""Sequential polling worker supervised by Docker; one failed run does not stop it."""
from __future__ import annotations

import math
import signal
from threading import Event
from time import monotonic

from .retention import safe_compact_transient_attempts
from .runtime import has_pending_report, run_once
from .weekly_archive import maybe_seal_weekly_archive, recover_weekly_archives


def work(registry, ledger, state, *, interval_seconds=900, stop=None, run=run_once,
         seal=maybe_seal_weekly_archive, recover=recover_weekly_archives,
         compact=safe_compact_transient_attempts, queued_only=False):
    if not math.isfinite(interval_seconds) or interval_seconds <= 0:
        raise ValueError('INTERVAL_INVALID')
    stopped = stop if stop is not None else Event()
    handlers = {}
    if stop is None:
        for signum in (signal.SIGTERM, signal.SIGINT):
            handlers[signum] = signal.signal(signum, lambda *_: stopped.set())
    try:
        # Recovery is evidence-only: it scans retained attempt statuses and seals
        # complete Thursday inputs. Missing weeks remain missing; no live reread occurs.
        if not queued_only:
            recover(state)
            # Only after recovery may old non-weekly transient payloads be compacted.
            # Status/error records, publications, weekly archives and identity state
            # are outside the retention surface.
            compact(state)
        next_run = 0.0
        while not stopped.is_set():
            if monotonic() < next_run and not has_pending_report(state):
                stopped.wait(min(5, max(0, next_run - monotonic())))
                continue
            result = (run(registry, ledger, state, queued_only=True) if queued_only
                      else run(registry, ledger, state))
            if queued_only:
                if result['status'] == 'IDLE':
                    break
                if result['status'] == 'ALREADY_RUNNING':
                    if not has_pending_report(state):
                        break
                    stopped.wait(5)
                    continue
            # A Thursday capture must get the first chance to become an immutable
            # weekly archive before retention considers its transient payload.
            seal(state, result)
            compact(state)
            if not queued_only:
                next_run = monotonic() + interval_seconds
                stopped.wait(min(5, interval_seconds))
        return 0
    finally:
        for signum, handler in handlers.items():
            signal.signal(signum, handler)
