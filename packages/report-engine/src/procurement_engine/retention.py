"""Bound transient report attempts without deleting audit status or canonical history.

The worker polls frequently. Each changed input can leave a complete capture and rendered
bundle under attempts/<uuid>, which is useful for short-term diagnostics but is not the
long-term historical contract. Long-term replay lives in immutable publications and
WEEKLY-* archives. This module therefore compacts only old transient payloads while
keeping status/error records.

Safety rules:
- never touch published/, archives/, inputs/, identity.sqlite or top-level status;
- never compact the current attempt;
- never compact an unsealed Thursday attempt (it may still be the only weekly source);
- keep the newest N attempts complete for operational diagnosis;
- unknown/malformed attempt metadata is fail-closed and left untouched;
- only the exact capture.json and bundle/ payload names are eligible.
"""
from __future__ import annotations

import fcntl
import json
import shutil
from datetime import date
from pathlib import Path
from typing import Any

# Owner policy: weekly history; only the working/previous attempts stay complete.
DEFAULT_FULL_ATTEMPTS = 2


def _load_json(path: Path) -> dict[str, Any] | None:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError, TypeError):
        return None
    return value if isinstance(value, dict) else None


def _report_day(value: object) -> str | None:
    text = str(value or "").strip()
    try:
        if len(text) == 10 and text[2] == "." and text[5] == ".":
            day, month, year = (int(part) for part in text.split("."))
            return date(year, month, day).isoformat()
        if len(text) == 10 and text[4] == "-" and text[7] == "-":
            return date.fromisoformat(text).isoformat()
    except ValueError:
        pass
    return None


def _sort_key(status: dict[str, Any], name: str) -> tuple[str, str]:
    # ISO timestamps sort chronologically when emitted by runtime. A malformed
    # timestamp remains deterministic and does not weaken fail-closed retention.
    stamp = status.get("finished_at") or status.get("started_at")
    return (stamp if isinstance(stamp, str) else "", name)


def _payload_bytes(path: Path) -> int:
    if path.is_symlink():
        raise ValueError("ATTEMPT_PAYLOAD_SYMLINK")
    if path.is_file():
        return path.stat().st_size
    if not path.exists():
        return 0
    if not path.is_dir():
        raise ValueError("ATTEMPT_PAYLOAD_UNSAFE")
    total = 0
    for item in path.rglob("*"):
        if item.is_symlink():
            raise ValueError("ATTEMPT_PAYLOAD_SYMLINK")
        if item.is_file():
            total += item.stat().st_size
    return total


def _sealed_week_evidence(state: Path) -> tuple[set[str], set[str]]:
    """Return sealed days and source attempts that must remain as a second copy.

    The weekly archive is the canonical replay input, but keeping the one attempt
    it was copied from gives an independent local recovery path at modest cost
    (one complete attempt per week instead of up to 96 per day).
    """
    days: set[str] = set()
    source_attempts: set[str] = set()
    archives = state / "archives"
    if not archives.is_dir():
        return days, source_attempts
    for root in archives.glob("WEEKLY-*"):
        if root.is_symlink() or not root.is_dir():
            continue
        day = root.name.removeprefix("WEEKLY-")
        try:
            parsed = date.fromisoformat(day)
        except ValueError:
            continue
        if parsed.weekday() != 3:
            continue
        manifest = _load_json(root / "snapshot_bundle/manifest.json")
        imported = _load_json(root / "import.json")
        identity = root / "identity.sqlite"
        if (manifest is None or imported is None or not identity.is_file() or identity.is_symlink()
                or manifest.get("snapshot_id") != imported.get("snapshot_id")
                or _report_day(manifest.get("report_date")) != day
                or _report_day(imported.get("report_date")) != day
                or imported.get("contract") != "canonical-weekly-report-input-v1"):
            continue
        days.add(day)
        if imported.get("source_kind") == "attempt" and isinstance(imported.get("source_ref"), str):
            source_attempts.add(imported["source_ref"])
    return days, source_attempts


def plan_transient_attempt_retention(state_dir: str | Path, *, keep_full: int = DEFAULT_FULL_ATTEMPTS) -> dict[str, Any]:
    """Return a deterministic, aggregate-only compaction plan.

    The plan contains attempt directory names because the apply phase must bind
    deletion to exactly what was inspected. It never includes business content.
    """
    if not isinstance(keep_full, int) or isinstance(keep_full, bool) or not (2 <= keep_full <= 96):
        raise ValueError("ATTEMPT_RETENTION_INVALID")
    state = Path(state_dir).resolve()
    attempts = state / "attempts"
    if attempts.is_symlink():
        raise ValueError("ATTEMPTS_DIRECTORY_UNSAFE")
    if not attempts.is_dir():
        return {
            "status": "NO_ATTEMPTS",
            "keep_full": keep_full,
            "attempt_count": 0,
            "compact_count": 0,
            "bytes_reclaimable": 0,
            "compact_attempts": [],
            "protected_unsealed_thursdays": 0,
        }

    current = _load_json(state / "status.json") or {}
    current_id = current.get("attempt_id") if isinstance(current.get("attempt_id"), str) else None
    sealed_days, weekly_source_attempts = _sealed_week_evidence(state)
    valid: list[tuple[Path, dict[str, Any]]] = []
    protected: set[str] = set(weekly_source_attempts)
    malformed = 0

    for root in attempts.iterdir():
        if root.is_symlink() or not root.is_dir():
            malformed += 1
            continue
        status = _load_json(root / "status.json")
        if status is None or status.get("attempt_id") != root.name:
            malformed += 1
            continue
        valid.append((root, status))
        if root.name == current_id:
            protected.add(root.name)
        day = _report_day(status.get("report_date"))
        if day:
            parsed = date.fromisoformat(day)
            if parsed.weekday() == 3 and day not in sealed_days:
                # Recovery runs before retention. If no canonical archive exists
                # afterwards, preserve every complete Thursday source for repair.
                protected.add(root.name)

    newest = sorted(valid, key=lambda pair: _sort_key(pair[1], pair[0].name), reverse=True)[:keep_full]
    protected.update(root.name for root, _ in newest)

    compact: list[str] = []
    reclaimable = 0
    unsafe = 0
    for root, _ in valid:
        if root.name in protected:
            continue
        try:
            size = _payload_bytes(root / "capture.json") + _payload_bytes(root / "bundle")
        except (OSError, ValueError):
            unsafe += 1
            continue
        if size <= 0:
            continue
        compact.append(root.name)
        reclaimable += size

    return {
        "status": "PLANNED",
        "keep_full": keep_full,
        "attempt_count": len(valid),
        "compact_count": len(compact),
        "bytes_reclaimable": reclaimable,
        "compact_attempts": sorted(compact),
        "protected_unsealed_thursdays": sum(
            1 for root, status in valid
            if (_report_day(status.get("report_date"))
                and date.fromisoformat(_report_day(status.get("report_date"))).weekday() == 3
                and _report_day(status.get("report_date")) not in sealed_days)
        ),
        "malformed_or_unsafe_entries": malformed + unsafe,
    }


def apply_transient_attempt_retention(
    state_dir: str | Path,
    *,
    keep_full: int = DEFAULT_FULL_ATTEMPTS,
    expected_attempts: list[str] | None = None,
) -> dict[str, Any]:
    """Compact only payloads selected by a fresh safe plan.

    expected_attempts is an optional compare-and-delete barrier for a dry-run/apply
    workflow. If supplied and the fresh plan differs, nothing is changed.
    """
    state = Path(state_dir).resolve()
    lock_path = state / "run.lock"
    if lock_path.is_symlink():
        raise ValueError("ATTEMPT_RETENTION_LOCK_UNSAFE")
    state.mkdir(parents=True, exist_ok=True, mode=0o700)

    # Share the report worker's process-wide exclusion barrier. An external
    # maintenance pass therefore cannot compact evidence while run_once is
    # acquiring/building/publishing it, and the worker's own post-run compaction
    # starts only after run_once has released this lock.
    with lock_path.open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        plan = plan_transient_attempt_retention(state, keep_full=keep_full)
        selected = plan["compact_attempts"]
        if expected_attempts is not None and sorted(expected_attempts) != selected:
            return {**plan, "status": "PLAN_CHANGED", "bytes_reclaimed": 0}

        reclaimed = 0
        compacted = 0
        for attempt_id in selected:
            root = state / "attempts" / attempt_id
            # Bind deletion to a normal direct child and to still-valid metadata.
            if root.parent != state / "attempts" or root.is_symlink() or not root.is_dir():
                continue
            status = _load_json(root / "status.json")
            if status is None or status.get("attempt_id") != attempt_id:
                continue
            removed_any = False
            for name in ("capture.json", "bundle"):
                target = root / name
                if target.is_symlink():
                    continue
                try:
                    size = _payload_bytes(target)
                    if target.is_dir():
                        shutil.rmtree(target)
                    elif target.is_file():
                        target.unlink()
                    else:
                        continue
                    reclaimed += size
                    removed_any = True
                except OSError:
                    continue
            if removed_any:
                compacted += 1

        return {
            **plan,
            "status": "COMPACTED",
            "compacted": compacted,
            "bytes_reclaimed": reclaimed,
        }


def safe_compact_transient_attempts(state_dir: str | Path, *, keep_full: int = DEFAULT_FULL_ATTEMPTS) -> dict[str, Any]:
    """Worker boundary: retention failure must never stop report acquisition."""
    try:
        return apply_transient_attempt_retention(state_dir, keep_full=keep_full)
    except Exception as error:  # noqa: BLE001 - safe process boundary, no source text emitted.
        return {
            "status": "FAILED",
            "code": "ATTEMPT_RETENTION_FAILED",
            "error_type": type(error).__name__,
            "bytes_reclaimed": 0,
        }


def plan_publication_compaction(store):
    """Keep weekly replay roots and current/previous; compact only daily copies.

    The catalog keeps exact artifact links. Ledger/RAW/identity databases are
    never deletion targets. Every full release is checksum checked before plan.
    """
    import hashlib
    import re
    import sqlite3
    from contextlib import closing
    from datetime import datetime, timedelta, timezone

    from .readonly_catalog import copied_catalog

    if store.releases.is_symlink() or not store.releases.is_dir():
        raise ValueError('PUBLICATION_RETENTION_ROOT_UNSAFE')
    with copied_catalog(store.database_path) as path, closing(sqlite3.connect(path)) as db:
        records = db.execute('SELECT release_id,report_date,cutoff_at,receipt,files FROM publications ORDER BY report_date DESC,cutoff_at DESC,release_id DESC').fetchall()
    keep, weeks, live = set(), {}, []
    for rid, day, cutoff, receipt, files in records:
        # Bind the catalog selector to the same root and civil period validated
        # by _checked; never permit a receipt to redirect an apply path.
        try:
            metadata = json.loads(receipt)
            if not isinstance(rid, str) or re.fullmatch(r'REL-[0-9a-f]{64}', rid) is None:
                raise ValueError('release id')
            if metadata.get('release_id') != rid:
                raise ValueError('receipt release id')
            parsed_day = date.fromisoformat(day)
            receipt_day = datetime.strptime(metadata['report_date'], '%d.%m.%Y').date()  # noqa: DTZ007 — civil report date.
            sql_cutoff = datetime.fromisoformat(cutoff.replace('Z', '+00:00'))
            receipt_cutoff = datetime.fromisoformat(metadata['cutoff_at'].replace('Z', '+00:00'))
            if (receipt_day != parsed_day or sql_cutoff.utcoffset() is None
                    or receipt_cutoff.utcoffset() is None
                    or sql_cutoff.astimezone(timezone.utc) != receipt_cutoff.astimezone(timezone.utc)):
                raise ValueError('period metadata')
        except (ValueError, TypeError, KeyError, AttributeError) as error:
            raise ValueError('PUBLICATION_RETENTION_METADATA_INVALID') from error
        record = store._checked((receipt, files))
        if record.get('replay_available') is False:
            continue
        if 'archive_origin' in record:
            keep.add(rid)
            continue
        live.append(rid)
        parsed = date.fromisoformat(day)
        week = (parsed - timedelta(days=parsed.weekday())).isoformat()
        priority = (parsed.weekday() in {3, 4}, day, cutoff, rid)
        if week not in weeks or priority > weeks[week][0]:
            weeks[week] = priority, rid
    keep.update(live[:2])
    keep.update(rid for _, rid in weeks.values())
    status_path = store.root.parent / 'status.json'
    if status_path.exists() or status_path.is_symlink():
        if status_path.is_symlink():
            raise ValueError('PUBLICATION_RETENTION_STATUS_UNSAFE')
        status = _load_json(status_path)
        if status is None or not isinstance(status.get('publication') or {}, dict):
            raise ValueError('PUBLICATION_RETENTION_STATUS_INVALID')
        current = status.get('publication') or {}
        if current.get('release_id'):
            if current['release_id'] not in {r[0] for r in records}:
                raise ValueError('PUBLICATION_RETENTION_CURRENT_MISSING')
            current_record = next(json.loads(r[3]) for r in records if r[0] == current['release_id'])
            if current_record.get('replay_available') is False:
                raise ValueError('PUBLICATION_RETENTION_CURRENT_COMPACTED')
            keep.add(current['release_id'])
    targets = [r for r in records if r[0] not in keep and json.loads(r[3]).get('replay_available') is not False]
    signatures = True
    missing_signatures = missing_snapshots = 0
    identity = store.root.parent / 'identity.sqlite'
    if targets:
        if not identity.is_file() or identity.is_symlink():
            signatures = False
        else:
            with copied_catalog(identity) as path, closing(sqlite3.connect(path)) as db:
                for sid in {json.loads(r[3])['snapshot_id'] for r in targets}:
                    count, missing = db.execute('SELECT COUNT(*), SUM(plan_signature IS NULL OR entity_signature IS NULL) FROM observations WHERE snapshot_id=?', (sid,)).fetchone()
                    missing_snapshots += int(not count)
                    missing_signatures += missing or 0
                    if not count or missing:
                        signatures = False
    return {'catalog_revision': hashlib.sha256(json.dumps([records, sorted(keep), sorted(r[0] for r in targets)], separators=(',', ':')).encode()).hexdigest(),
            'keep_release_ids': sorted(keep), 'retire_release_ids': sorted(r[0] for r in targets),
            'identity_ready': signatures, 'records': records,
            'identity_missing_signatures': missing_signatures if identity.is_file() else None,
            'identity_missing_snapshots': missing_snapshots if identity.is_file() else None,
            'weekly_live_count': len(weeks), 'publication_count': len(records),
            'keep_count': len(keep), 'retire_count': len(targets),
            # Upper bound before retaining old downloadable artifacts and exact
            # ledger/identity proofs. Finalization reports actual removed bytes.
            'bytes_reclaimable_upper_bound': sum(_payload_bytes(store.releases / r[0]) for r in targets)}
