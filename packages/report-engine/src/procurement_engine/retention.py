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

import json
import os
import shutil
from datetime import date, datetime
from pathlib import Path
from typing import Any

DEFAULT_FULL_ATTEMPTS = 12


def _load_json(path: Path) -> dict[str, Any] | None:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError, TypeError):
        return None
    return value if isinstance(value, dict) else None


def _report_day(value: object) -> str | None:
    text = str(value or "").strip()
    for fmt in ("%d.%m.%Y", "%Y-%m-%d"):
        try:
            return datetime.strptime(text, fmt).date().isoformat()
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
            except OSError:
                continue
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
