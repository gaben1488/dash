"""Sequential polling worker supervised by Docker; one failed run does not stop it."""
from __future__ import annotations

import json
import logging
import math
import signal
import sqlite3
from datetime import datetime, timedelta
from pathlib import Path
from threading import Event
from time import monotonic
from zoneinfo import ZoneInfo

from .google_adapter import GoogleReadClient
from .identity_store import read_identity_reviews
from .raw_pipeline import RAW_RULES_VERSION, RENDERER_VERSION
from .recommendation_history import google_history_metadata, issued_recommendations
from .retention import safe_compact_transient_attempts
from .runtime import has_pending_report, run_once
from .snapshot import canonical_semantic_hash
from .weekly_archive import maybe_seal_weekly_archive, recover_weekly_archives


def input_revision(registry, ledger, state, *, client=None, now=None):
    """Cheap change detection; never downloads sheet grids or history documents."""
    registry_data = json.loads(Path(registry).read_text(encoding='utf-8'))
    ledger_data = issued_recommendations(json.loads(Path(ledger).read_text(encoding='utf-8')))
    client = client or GoogleReadClient()
    providers = sorted({source['provider_id'] for source in registry_data['sources']})
    versions = {provider: client.revision(provider) for provider in providers}
    if not versions or any(not version for version in versions.values()):
        raise ValueError('SOURCE_REVISION_UNAVAILABLE')
    instant = now or datetime.now(ZoneInfo('Asia/Kamchatka'))
    day = instant.astimezone(ZoneInfo('Asia/Kamchatka')).date()
    # Preserve the existing weekly archive obligation even during an idle week.
    # This is a scheduled evidence capture, not a repeated ordinary recalculation.
    thursday = day - timedelta(days=(day.weekday() - 3) % 7)
    identity = Path(state) / 'identity.sqlite'
    return canonical_semantic_hash({
        'registry': registry_data, 'ledger': ledger_data, 'versions': versions,
        'history': google_history_metadata(client),
        'reviews': read_identity_reviews(identity, as_of=instant.isoformat()) if identity.exists() else [],
        'rules': RAW_RULES_VERSION, 'renderer': RENDERER_VERSION,
        'weekly_evidence': thursday.isoformat(), 'financial_year': day.year,
    })


def work(registry, ledger, state, *, interval_seconds=900, stop=None, run=run_once,
         seal=maybe_seal_weekly_archive, recover=recover_weekly_archives,
         compact=safe_compact_transient_attempts, queued_only=False, probe=input_revision):
    if not math.isfinite(interval_seconds) or interval_seconds < 0:
        raise ValueError('INTERVAL_INVALID')
    stopped = stop if stop is not None else Event()
    handlers = {}
    if stop is None:
        for signum in (signal.SIGTERM, signal.SIGINT):
            handlers[signum] = signal.signal(signum, lambda *_: stopped.set())
    try:
        # Recovery is evidence-only: it scans retained attempt statuses and seals
        # complete Thursday inputs. Missing weeks remain missing; no live reread occurs.
        if not queued_only and interval_seconds > 0:
            recover(state)
            # Only after recovery may old non-weekly transient payloads be compacted.
            # Status/error records, publications, weekly archives and identity state
            # are outside the retention surface.
            compact(state)
        # Zero disables source polling; durable user commands still execute.
        next_run = float('inf') if interval_seconds == 0 else 0.0
        accepted_revision = None
        while not stopped.is_set():
            pending = has_pending_report(state)
            if monotonic() < next_run and not pending:
                stopped.wait(min(5, max(0, next_run - monotonic())))
                continue
            revision = None
            if not queued_only and not pending:
                try:
                    revision = probe(registry, ledger, state)
                except (OSError, ValueError, RuntimeError, sqlite3.Error, KeyError, TypeError) as error:
                    # Unknown is not unchanged. The normal attempt records its
                    # source failure durably; never suppress it behind a cached success.
                    logging.getLogger(__name__).warning('Source change probe unavailable: %s', type(error).__name__)
                if revision is not None and revision == accepted_revision:
                    next_run = monotonic() + interval_seconds
                    stopped.wait(min(5, interval_seconds))
                    continue
            result = (run(registry, ledger, state, queued_only=True) if queued_only or interval_seconds == 0
                      else run(registry, ledger, state))
            if queued_only or interval_seconds == 0:
                if result['status'] == 'IDLE':
                    if queued_only:
                        break
                    stopped.wait(5)
                    continue
                if result['status'] == 'ALREADY_RUNNING':
                    if queued_only and not has_pending_report(state):
                        break
                    stopped.wait(5)
                    continue
            # A Thursday capture must get the first chance to become an immutable
            # weekly archive before retention considers its transient payload.
            seal(state, result)
            compact(state)
            accepted_revision = revision if result['status'] in ('VERIFIED', 'VERIFIED_WITH_WARNINGS') else None
            if not queued_only:
                next_run = monotonic() + interval_seconds if interval_seconds else float('inf')
                stopped.wait(min(5, interval_seconds))
        return 0
    finally:
        for signum, handler in handlers.items():
            signal.signal(signum, handler)
