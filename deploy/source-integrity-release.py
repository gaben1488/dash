#!/usr/bin/env python3
"""One-off safe release gate for durable source-integrity state.

Executed *inside the existing server container* with its configured SQLite
volume and API key. Only a SQLite online backup and authenticated, read-only
source inspection are performed. No Google spreadsheets are modified.
Never print API responses, credentials or saved cell-level diagnostics.
"""
from __future__ import annotations

from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import sqlite3
import sys
from urllib.request import Request, urlopen

COMMIT_RE = re.compile(r"^[0-9a-f]{40}$")
MIN_HEADROOM_BYTES = 512 * 1024 * 1024
API = "http://127.0.0.1:3000"


class ReleaseGateError(RuntimeError):
    pass


def online_backup(
    source: Path,
    destination_dir: Path,
    commit: str,
    *,
    free_bytes: int | None = None,
) -> Path:
    """WAL-consistent backup. Fail before mutation if space/DB is not valid."""
    if not COMMIT_RE.fullmatch(commit):
        raise ReleaseGateError("invalid release commit")
    source = source.resolve()
    if not source.is_file():
        raise ReleaseGateError("configured SQLite file not found")
    free = shutil.disk_usage(source.parent).free if free_bytes is None else free_bytes
    needed = max(MIN_HEADROOM_BYTES, source.stat().st_size * 2)
    if free < needed:
        raise ReleaseGateError("insufficient free space for verified SQLite backup")

    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    destination_dir.mkdir(mode=0o700, parents=True, exist_ok=True)
    destination = destination_dir / f"source-integrity-{commit[:12]}-{stamp}.db"
    partial = destination.with_suffix(".partial")
    try:
        with sqlite3.connect(source.as_uri() + "?mode=ro", uri=True, timeout=30) as live:
            # Do not back up a random/wrong SQLite file that happened to exist.
            if not live.execute("SELECT 1 FROM sqlite_master WHERE name='snapshots' AND type='table'").fetchone():
                raise ReleaseGateError("configured SQLite file is not the Dash database")
            with sqlite3.connect(partial, timeout=30) as backup:
                live.backup(backup, pages=512, sleep=0.1)
        with sqlite3.connect(partial.as_uri() + "?mode=ro", uri=True) as verified:
            if verified.execute("PRAGMA quick_check").fetchone() != ("ok",):
                raise ReleaseGateError("backed up SQLite file did not pass quick_check")
        os.chmod(partial, 0o600)
        os.replace(partial, destination)
        return destination
    finally:
        partial.unlink(missing_ok=True)


def request_json(method: str, endpoint: str) -> dict:
    key = os.environ.get("AEMR_API_KEY")
    if not key:
        raise ReleaseGateError("API key unavailable inside server container")
    req = Request(
        API + endpoint, method=method,
        headers={"Authorization": "Bearer " + key, "Accept": "application/json"},
    )
    try:
        with urlopen(req, timeout=240) as response:
            result = json.load(response)
    except Exception as exc:
        # Raw error bodies may contain source details, so do not expose them.
        raise ReleaseGateError("source-integrity API request failed") from exc
    if not isinstance(result, dict):
        raise ReleaseGateError("invalid source-integrity API response")
    return result


def deep_check() -> None:
    result = request_json("POST", "/api/sources/integrity/check")
    books = result.get("books")
    expected = result.get("expectedBooks")
    if (
        not result.get("complete")
        or not isinstance(books, list)
        or not isinstance(expected, int)
        or expected != 8
        or len(books) != expected
        or any(not b.get("analyzed") or not b.get("metadataRead") for b in books)
    ):
        raise ReleaseGateError("deep source check is incomplete; no release acceptance")
    print(f"deep-check PASS: {expected} books verified; no spreadsheet writes")


def fingerprint() -> None:
    result = request_json("GET", "/api/sources/integrity")
    formulas = result.get("formulas", {})
    metadata = result.get("metadata", {})
    books = formulas.get("books", [])
    verdicts = formulas.get("verdicts", [])
    meta_books = metadata.get("books", [])
    if (
        not formulas.get("sinkConnected")
        or not isinstance(books, list)
        or len(books) != 8
        or not isinstance(verdicts, list)
        or len(verdicts) != 8
        or not isinstance(meta_books, list)
        or len(meta_books) != 8
        or any(b.get("persisted") is not True or b.get("formulasRead") is False
               or not b.get("handled") for b in books)
        or any(b.get("matchesLatestDelivery") is not True for b in verdicts)
        or any(b.get("persisted") is not True or not b.get("read") for b in meta_books)
    ):
        raise ReleaseGateError("source-integrity evidence absent or not durable")
    # Exclude only the volatile request timestamp. Detailed diagnostics stay
    # inside this container; print a digest instead of leaking cells/values.
    evidence = {
        "formulas": {
            "books": books, "verdicts": verdicts,
            "notRead": formulas.get("notRead", []),
        },
        "metadata": {
            "books": meta_books,
            "lastConfirmed": metadata.get("lastConfirmed", []),
            "notWatched": metadata.get("notWatched", []),
            "canonSyncedAt": metadata.get("canonSyncedAt"),
        },
        "storage": result.get("storage", {}),
    }
    digest = hashlib.sha256(
        json.dumps(evidence, sort_keys=True, ensure_ascii=False,
                   separators=(",", ":")).encode("utf-8")
    ).hexdigest()
    print(digest)


def main() -> int:
    if len(sys.argv) != 2:
        raise ReleaseGateError("choose backup, deep-check or fingerprint")
    mode = sys.argv[1]
    if mode == "backup":
        source = Path(os.environ.get("SQLITE_PATH", "./data/aemr.db"))
        backup = online_backup(
            source, source.parent / "source-integrity-release-backups",
            os.environ.get("RELEASE_SHA", ""),
        )
        # Print proof without source contents or DB path.
        print(f"sqlite-backup PASS: {backup.name}, bytes={backup.stat().st_size}")
    elif mode == "deep-check":
        deep_check()
    elif mode == "fingerprint":
        fingerprint()
    else:
        raise ReleaseGateError("unsupported release gate")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (ReleaseGateError, sqlite3.Error, OSError) as exc:
        # This is a security boundary: report categories, not arbitrary API
        # response or SQLite exception text with private paths.
        label = str(exc) if isinstance(exc, ReleaseGateError) else type(exc).__name__
        print("source-integrity release blocked: " + label, file=sys.stderr)
        raise SystemExit(1)
