#!/usr/bin/env python3
"""Offline, non-destructive checks for DASH agent documentation.

It checks explicit invariants and optionally verifies an external source archive.
It does NOT perform semantic review of 250 files, query Sheets, or verify VPS.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import sys
import zipfile

EXPECTED_SOURCE_COUNT = 250
REQUIRED = (
    "AGENTS.md",
    "CLAUDE.md",
    "docs/STATUS.md",
    "docs/contracts/SOURCES_AND_INTEGRITY.md",
    "docs/contracts/REPORT_RELEASE.md",
    "docs/engineering/AUTHORING_STANDARD.md",
    "docs/engineering/AI_DOCS_CHECKS.md",
    "docs/CONFLICT_REGISTER.md",
)


def check_repo(root: Path, report: dict) -> None:
    contents: dict[str, str] = {}
    for path in REQUIRED:
        p = root / path
        if not p.is_file():
            report["fail"].append(f"missing:{path}")
        else:
            contents[path] = p.read_text(encoding="utf-8")

    if len(contents) != len(REQUIRED):
        return

    agent = contents["AGENTS.md"]
    claude = contents["CLAUDE.md"]
    source = contents["docs/contracts/SOURCES_AND_INTEGRITY.md"]
    report_release = contents["docs/contracts/REPORT_RELEASE.md"]
    status = contents["docs/STATUS.md"]
    author = contents["docs/engineering/AUTHORING_STANDARD.md"]
    checks = contents["docs/engineering/AI_DOCS_CHECKS.md"]
    conflicts = contents["docs/CONFLICT_REGISTER.md"]

    required_fragments = {
        "CLAUDE.md": [(sum(line.strip() == "@AGENTS.md" for line in claude.splitlines()) == 1, "one-shared-import")],
        "AGENTS.md": [(bool("SOURCES_AND_INTEGRITY.md" in agent), "route-to-source-contract"),
                       ("полностью подтверждённое" in agent, "baseline-preservation")],
        "SOURCES_AND_INTEGRITY.md": [("sourceCoverage=100%" in source, "complete-source-coverage"),
                                      ("webhook" in source and "A1" in source, "webhook-file-not-range"),
                                      ("не обновлять" in source and "watermark" in source, "partial-fail-closed")],
        "REPORT_RELEASE.md": [("packages/core/src/report/__fixtures__/week-*.json" in report_release, "fixture-carveout"),
                              ("персональных данных" in report_release, "fixture-privacy")],
        "STATUS.md": [("PR #145" in status and "draft-PR-not-merged" in status, "draft-status"),
                      ("PR #150" in status and "закрыт без merge" in status, "closed-unmerged-proposal")],
        "AUTHORING_STANDARD.md": [("superseded_by" in author and "asOf" in author, "lifecycle-ownership")],
        "AI_DOCS_CHECKS.md": [("Negative baseline test" in checks, "negative-baseline-test")],
        "CONFLICT_REGISTER.md": [(all(f"KC-{i:02d}" in conflicts for i in range(16, 19)), "new-conflict-register")],
    }
    for path, validators in required_fragments.items():
        for ok, name in validators:
            (report["pass"] if ok else report["fail"]).append(f"{path}:{name}")

    if "PR не создавался" in status:
        report["fail"].append("STATUS.md:obsolete-no-PR-claim")
    else:
        report["pass"].append("STATUS.md:no-obsolete-no-PR-claim")

    code = root / "packages/shared/src/column-map.ts"
    if code.exists():
        t = code.read_text(encoding="utf-8")
        if "PROGRAM_NAME: 3" in t and "SUBPROGRAM: 4" in t:
            report["pass"].append("source-code:D-program-E-subprogram")
        else:
            report["fail"].append("source-code:D-E-map-diverged")
    else:
        report["skip"].append("source-code:missing-in-document-only-package")


def verify_archive(path: Path, report: dict) -> None:
    if not path.is_file():
        report["fail"].append("archive:not-found")
        return
    with zipfile.ZipFile(path) as z:
        try:
            manifest = json.loads(z.read("MANIFEST.json"))
        except (KeyError, json.JSONDecodeError):
            report["fail"].append("archive:missing-or-invalid-manifest")
            return
        files = manifest.get("files", [])
        if len(files) != EXPECTED_SOURCE_COUNT or manifest.get("file_count") != EXPECTED_SOURCE_COUNT:
            report["fail"].append(f"archive:expected-250-found-{len(files)}")
            return
        seen: set[str] = set()
        total = 0
        for entry in files:
            rel = entry.get("path", "")
            # No extraction and no absolute / traversal paths.
            if not rel or rel in seen or Path(rel).is_absolute() or ".." in Path(rel).parts or not rel.endswith(".md"):
                report["fail"].append("archive:unsafe-or-duplicate-path")
                continue
            seen.add(rel)
            try:
                data = z.read("repo_markdown/" + rel)
            except KeyError:
                report["fail"].append(f"archive:missing:{rel}")
                continue
            total += len(data)
            git_sha = hashlib.sha1(b"blob " + str(len(data)).encode() + b"\0" + data).hexdigest()
            if (len(data) != entry.get("bytes") or hashlib.sha256(data).hexdigest() != entry.get("sha256")
                    or git_sha != entry.get("git_blob_sha1")):
                report["fail"].append(f"archive:hash-or-size-mismatch:{rel}")
        if total != manifest.get("total_bytes"):
            report["fail"].append("archive:byte-count-mismatch")
        if not report["fail"]:
            report["pass"].append(f"archive:250-of-250-hashes-and-{total}-bytes")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", type=Path, default=Path(__file__).resolve().parents[2])
    parser.add_argument("--source-zip", type=Path, help="Optional trusted 250-MD archive with MANIFEST.json")
    parser.add_argument("--json", action="store_true", help="Print parseable results")
    args = parser.parse_args()
    report: dict = {"pass": [], "fail": [], "skip": []}
    check_repo(args.repo, report)
    if args.source_zip:
        try:
            verify_archive(args.source_zip, report)
        except (zipfile.BadZipFile, OSError, UnicodeDecodeError, ValueError) as exc:
            report["fail"].append(f"archive:unreadable:{type(exc).__name__}")
    else:
        report["skip"].append("archive:no-source-zip-supplied")
    report["result"] = "PASS" if not report["fail"] else "FAIL"
    if args.json:
        print(json.dumps(report, ensure_ascii=False, indent=2))
    else:
        print(f"{report['result']}: {len(report['pass'])} passed; {len(report['fail'])} failed; {len(report['skip'])} skipped")
        for issue in report["fail"] + report["skip"]:
            print(" -", issue)
    return 0 if report["result"] == "PASS" else 1


if __name__ == "__main__":
    sys.exit(main())
