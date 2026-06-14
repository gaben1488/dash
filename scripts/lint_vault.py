#!/usr/bin/env python3
"""Vault lint — broken wikilink checker for the AEMR Obsidian vault.

Referenced by 00-Meta/Vault-Lint.md §6 (previously a TODO). Resolves every
`[[wikilink]]` / `![[embed]]` the way Obsidian does (shortest-path / basename
match, with optional path-qualified and aliased forms) and reports the broken
ones, per file and as a folder-level percentage.

Usage:
    python scripts/lint_vault.py --broken-links                 # whole vault
    python scripts/lint_vault.py --broken-links --scope 10-Index
    python scripts/lint_vault.py --broken-links --scope 10-Index --json

The vault root is auto-detected; override with --vault.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

DEFAULT_VAULT = Path(
    r"C:/Users/filat/Documents/Obsidian/delete not delete/AEMR"
)

# [[target]], [[target|alias]], ![[target]], [[target#heading]], [[target^block]]
WIKILINK_RE = re.compile(r"!?\[\[([^\]]+?)\]\]")
# Obsidian does not render wikilinks inside fenced or inline code.
FENCED_CODE_RE = re.compile(r"```.*?```", re.DOTALL)
INLINE_CODE_RE = re.compile(r"`[^`\n]*`")


def strip_code(text: str) -> str:
    text = FENCED_CODE_RE.sub("", text)
    text = INLINE_CODE_RE.sub("", text)
    return text


def build_index(vault: Path) -> tuple[set[str], set[str]]:
    """Return (basenames, relpaths) usable as wikilink resolution targets.

    basenames: every file's name without the .md extension (md), or full name
               (non-md attachments) — Obsidian resolves [[X]] by basename.
    relpaths:  every file's vault-relative path (forward slashes) without the
               trailing .md — supports path-qualified links like
               [[50-Workflow/daily/2026-06-13-pulse]].
    """
    basenames: set[str] = set()
    relpaths: set[str] = set()
    for p in vault.rglob("*"):
        if not p.is_file():
            continue
        # Skip Obsidian internals.
        if ".obsidian" in p.parts or ".trash" in p.parts:
            continue
        rel = p.relative_to(vault).as_posix()
        # Obsidian resolves wikilinks case-insensitively → index lowercased.
        if p.suffix.lower() == ".md":
            basenames.add(p.stem.lower())
            relpaths.add(rel[:-3].lower())  # drop ".md"
        else:
            basenames.add(p.name.lower())
            relpaths.add(rel.lower())
    return basenames, relpaths


def normalize_target(raw: str) -> str | None:
    """Extract the resolvable target from a raw wikilink body.

    Strips alias (`|...`), heading (`#...`) and block (`^...`) suffixes.
    Returns None for pure same-file anchors ([[#heading]] / [[^block]]).
    """
    target = raw.split("|", 1)[0].strip()
    # Same-file heading/block reference — not a note link.
    if target.startswith("#") or target.startswith("^"):
        return None
    target = re.split(r"[#^]", target, 1)[0].strip()
    return target or raw.strip()  # keep literal placeholders like "..." as broken


def resolves(target: str, basenames: set[str], relpaths: set[str]) -> bool:
    target = target.lower()  # Obsidian wikilinks are case-insensitive
    if target in relpaths or target in basenames:
        return True
    # md target referenced with explicit extension
    if target.endswith(".md"):
        stem = target[:-3]
        if stem in relpaths or Path(stem).name in basenames:
            return True
    # basename of a path-qualified miss (rare; Obsidian falls back to basename)
    return Path(target).name in basenames


def scan(vault: Path, scope: str | None) -> dict:
    basenames, relpaths = build_index(vault)
    root = vault / scope if scope else vault
    files = sorted(root.rglob("*.md"))

    per_file: list[dict] = []
    total_links = 0
    total_broken = 0
    for f in files:
        try:
            text = f.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            text = f.read_text(encoding="utf-8", errors="replace")
        broken: list[str] = []
        n_links = 0
        for m in WIKILINK_RE.finditer(strip_code(text)):
            target = normalize_target(m.group(1))
            if target is None:
                continue
            n_links += 1
            if not resolves(target, basenames, relpaths):
                broken.append(target)
        total_links += n_links
        if broken:
            total_broken += len(broken)
            per_file.append(
                {
                    "file": f.relative_to(vault).as_posix(),
                    "links": n_links,
                    "broken": len(broken),
                    "targets": broken,
                }
            )
    pct = (total_broken / total_links * 100) if total_links else 0.0
    return {
        "scope": scope or "(whole vault)",
        "files_scanned": len(files),
        "total_links": total_links,
        "total_broken": total_broken,
        "broken_pct": round(pct, 2),
        "per_file": per_file,
    }


def main() -> int:
    ap = argparse.ArgumentParser(description="AEMR vault lint")
    ap.add_argument("--broken-links", action="store_true", help="report broken wikilinks")
    ap.add_argument("--scope", default=None, help="limit to a subfolder, e.g. 10-Index")
    ap.add_argument("--vault", default=str(DEFAULT_VAULT), help="vault root path")
    ap.add_argument("--json", action="store_true", help="emit JSON")
    args = ap.parse_args()

    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except (AttributeError, ValueError):
        pass

    vault = Path(args.vault)
    if not vault.is_dir():
        print(f"vault not found: {vault}", file=sys.stderr)
        return 2

    if not args.broken_links:
        ap.print_help()
        return 0

    report = scan(vault, args.scope)
    if args.json:
        print(json.dumps(report, ensure_ascii=False, indent=2))
        return 0

    print(f"Scope: {report['scope']}")
    print(f"Files scanned : {report['files_scanned']}")
    print(f"Wikilinks     : {report['total_links']}")
    print(f"Broken        : {report['total_broken']}")
    print(f"Broken %      : {report['broken_pct']}%")
    if report["per_file"]:
        print("\nBroken by file:")
        for row in report["per_file"]:
            print(f"  {row['file']}  ({row['broken']}/{row['links']})")
            for t in row["targets"]:
                print(f"      ✗ [[{t}]]")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
