"""Sequential polling worker supervised by Docker; one failed run does not stop it."""
from __future__ import annotations

import math
import signal
from threading import Event

from .retention import safe_compact_transient_attempts
from .runtime import run_once
from .weekly_archive import maybe_seal_weekly_archive, recover_weekly_archives


def work(registry, ledger, state, *, interval_seconds=900, stop=None, run=run_once,
         seal=maybe_seal_weekly_archive, recover=recover_weekly_archives,
         compact=safe_compact_transient_attempts):
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
        recover(state)
        # Only after recovery may old non-weekly transient payloads be compacted.
        # Status/error records, publications, weekly archives and identity state
        # are outside the retention surface.
        compact(state)
        while not stopped.is_set():
            result = run(registry, ledger, state)
            # A Thursday capture must get the first chance to become an immutable
            # weekly archive before retention considers its transient payload.
            seal(state, result)
            compact(state)
            stopped.wait(interval_seconds)
        return 0
    finally:
        for signum, handler in handlers.items():
            signal.signal(signum, handler)
