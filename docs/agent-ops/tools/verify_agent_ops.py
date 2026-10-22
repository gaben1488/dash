#!/usr/bin/env python3
"""Read-only checks for the Dash agent handoff and a pinned Markdown corpus.

This program validates *shape and local bytes*. It does not authenticate
approvals, execute writes, query Google, or verify a production deployment.
No network access or third-party dependencies are required.
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
from pathlib import Path, PurePosixPath
import re
import sys

SHA = re.compile(r"^[0-9a-f]{40}$")
DIGEST = re.compile(r"^[0-9a-f]{64}$")
STAGES = {"proposal", "branch", "ci_verified", "source_verified", "deployed", "accepted", "blocked"}
KINDS = {"docs", "code", "source_write", "production_release"}
READ_STATES = {"indexed_fulltext", "reviewed_core", "source_verified"}


def _sha40(value: object) -> bool:
    return isinstance(value, str) and SHA.fullmatch(value) is not None


def _ok_string(obj: dict, name: str) -> bool:
    return isinstance(obj.get(name), str) and bool(obj[name].strip())


def _valid_rel_path(text: str) -> bool:
    if not isinstance(text, str) or not text or "\\" in text or "\x00" in text:
        return False
    p = PurePosixPath(text)
    return not p.is_absolute() and len(p.parts) > 0 and all(part not in (".", "..") for part in p.parts)


def check_corpus(ledger: Path, source_dir: Path) -> dict:
    """Fail on duplicate paths, unsafe paths, unexpected source revisions or byte drift."""
    problems: list[str] = []
    root = source_dir.resolve()
    seen: set[str] = set()
    revisions: set[str] = set()
    count = 0
    total = 0
    states: dict[str, int] = {key: 0 for key in READ_STATES}
    with ledger.open(newline="", encoding="utf-8-sig") as fh:
        for r in csv.DictReader(fh):
            count += 1
            path = r.get("path", "")
            if not _valid_rel_path(path):
                problems.append(f"row {count}: unsafe path")
                continue
            if path in seen:
                problems.append(f"row {count}: duplicate path: {path}")
                continue
            seen.add(path)
            digest = r.get("sha256", "")
            if not DIGEST.fullmatch(digest):
                problems.append(f"{path}: malformed sha256")
                continue
            revision = r.get("git_sha", "")
            if not _sha40(revision):
                problems.append(f"{path}: invalid repo_sha")
            else:
                revisions.add(revision)
            state = r.get("read_state", "")
            if state not in READ_STATES:
                problems.append(f"{path}: invalid read_state")
            else:
                states[state] += 1
            f = (root / path).resolve()
            if not f.is_relative_to(root) or not f.is_file():
                problems.append(f"{path}: file absent from pinned archive")
                continue
            b = f.read_bytes()
            total += len(b)
            if hashlib.sha256(b).hexdigest() != digest:
                problems.append(f"{path}: source bytes differ from pinned sha256")
            if str(len(b)) != r.get("bytes", ""):
                problems.append(f"{path}: source size differs")
    if len(revisions) != 1:
        problems.append("ledger must name exactly one pinned Git commit")
    if not seen:
        problems.append("empty ledger")
    actual = {p.relative_to(root).as_posix() for p in root.rglob("*.md") if p.is_file()}
    if actual != seen:
        problems.append(f"ledger coverage differs: missing={len(actual - seen)}, extra={len(seen - actual)}")
    return {"ok": not problems, "files_checked": len(seen), "bytes_seen": total,
            "read_states": states, "revision": next(iter(revisions), None),
            "problems": problems[:50]}


def check_handoff(item: dict) -> dict:
    errors: list[str] = []
    if not isinstance(item, dict):
        return {"ok": False, "problems": ["handoff must be a JSON object"]}
    for key in ("change_id", "owner", "agent", "reason", "next_action"):
        if not _ok_string(item, key):
            errors.append(f"missing {key}")
    if not _sha40(item.get("repo_sha")):
        errors.append("repo_sha must be the fixed base commit SHA")
    stage = item.get("stage")
    kind = item.get("kind")
    if stage not in STAGES:
        errors.append("unknown stage")
    if kind not in KINDS:
        errors.append("unknown kind")
    scope = item.get("scope")
    if not isinstance(scope, list) or not scope or any(not _valid_rel_path(p) for p in scope):
        errors.append("scope requires safe repository paths")
    if stage not in {"proposal", "blocked"} and not _ok_string(item, "diff_ref"):
        errors.append("change requires exact diff_ref")
    tests = item.get("tests")
    if stage in {"ci_verified", "source_verified", "deployed", "accepted"}:
        if not isinstance(tests, dict) or tests.get("result") != "passed" or not _ok_string(tests, "command"):
            errors.append("stage requires named passing tests")
    evidence = item.get("evidence", {})
    if not isinstance(evidence, dict):
        errors.append("evidence must be a JSON object")
        evidence = {}
    if stage in {"ci_verified", "source_verified", "deployed", "accepted"} and kind in {"code", "production_release"}:
        if not _ok_string(evidence, "ci_ref") or not _sha40(evidence.get("head_sha")):
            errors.append("runtime proof requires exact-head CI URL and SHA")
    if kind == "source_write" and stage not in {"proposal", "blocked"}:
        guard = item.get("source_guard")
        required = ("source_id", "source_revision", "snapshot_before", "approved_plan", "rollback_ref", "consumer_matrix")
        if not isinstance(guard, dict) or any(not _ok_string(guard, x) for x in required):
            errors.append("source_write requires source_guard and rollback before operation")
        if stage in {"source_verified", "accepted"} and (not _ok_string(evidence, "source_readback_ref") or not _ok_string(evidence, "same_snapshot_ref")):
            errors.append("source_write needs source readback and same-snapshot parity")
    if stage in {"deployed", "accepted"} and kind in {"code", "production_release"}:
        release = item.get("release_evidence")
        fields = ("deployed_sha", "release_id", "backup_ref", "readback_ref", "rollback_ref")
        if not isinstance(release, dict) or any(not _ok_string(release, x) for x in fields):
            errors.append("production claim requires deploy, backup, readback, rollback evidence")
        elif release.get("deployed_sha") != evidence.get("head_sha"):
            errors.append("deployed_sha does not match CI-tested head_sha")
    if stage == "accepted" and not _ok_string(item, "acceptance_ref"):
        errors.append("an agent cannot self-declare acceptance without a receipt")
    return {"ok": not errors, "change_id": item.get("change_id"),
            "kind": kind, "stage": stage, "problems": errors}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    corpus = sub.add_parser("corpus", help="check SHA-256 of all rows in pinned ledger")
    corpus.add_argument("--ledger", type=Path, required=True)
    corpus.add_argument("--sources", type=Path, required=True)
    handoff = sub.add_parser("handoff", help="validate structural change evidence")
    handoff.add_argument("file", type=Path)
    args = parser.parse_args(argv)
    try:
        if args.command == "corpus":
            result = check_corpus(args.ledger, args.sources)
        else:
            result = check_handoff(json.loads(args.file.read_text(encoding="utf-8")))
    except (OSError, UnicodeError, csv.Error, json.JSONDecodeError) as exc:
        print(json.dumps({"ok": False, "problems": [type(exc).__name__]}, ensure_ascii=False))
        return 2
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result["ok"] else 2


if __name__ == "__main__":
    sys.exit(main())
