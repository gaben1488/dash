"""Phase 1: collect ALL markdown knowledge bases into one inspectable compendium.

Sources:
  - C:/Users/filat/.claude/projects/C--Users-filat-dash/memory/**/*.md (all)
  - C:/Users/filat/Documents/Obsidian/delete not delete/AEMR/**/*.md (all non-auto-gen)
  - C:/Users/filat/dash/.claude/plans/*.md
  - C:/Users/filat/dash/CLAUDE.md
  - C:/Users/filat/.claude/CLAUDE.md

Output:
  reports/memory_compendium.md — every file with header (path, size, mtime, first_heading, first 3 non-empty lines)
  reports/memory_compendium_stats.json — counts per folder, size distribution

Not dumping full content (would be ~50MB). Instead: metadata + heading + first lines
to allow grouping by topic and identifying overlaps. Full content is read later
per-cluster in Phase 2.
"""
from __future__ import annotations

import json
import os
import re
import sys
from datetime import datetime
from pathlib import Path

sys.stdout.reconfigure(encoding='utf-8')

SOURCES = [
    ("memory_root", Path(r"C:/Users/filat/.claude/projects/C--Users-filat-dash/memory"), False),
    ("memory_reference", Path(r"C:/Users/filat/.claude/projects/C--Users-filat-dash/memory/reference"), False),
    ("memory_archive", Path(r"C:/Users/filat/.claude/projects/C--Users-filat-dash/memory/archive"), True),
    ("memory_archive_sessions", Path(r"C:/Users/filat/.claude/projects/C--Users-filat-dash/memory/archive/sessions"), True),
    ("memory_archive_superseded", Path(r"C:/Users/filat/.claude/projects/C--Users-filat-dash/memory/archive/superseded"), True),
    ("memory_archive_v2", Path(r"C:/Users/filat/.claude/projects/C--Users-filat-dash/memory/_archive"), True),
    ("memory_daily_pulse", Path(r"C:/Users/filat/.claude/projects/C--Users-filat-dash/memory/daily-pulse"), False),
    ("memory_artifacts", Path(r"C:/Users/filat/.claude/projects/C--Users-filat-dash/memory/artifacts"), True),
    ("memory_audit", Path(r"C:/Users/filat/.claude/projects/C--Users-filat-dash/memory/audit"), False),
    ("memory_loadouts", Path(r"C:/Users/filat/.claude/projects/C--Users-filat-dash/memory/loadouts"), False),
    ("vault_root", Path(r"C:/Users/filat/Documents/Obsidian/delete not delete/AEMR"), True),
    ("dash_plans", Path(r"C:/Users/filat/dash/.claude/plans"), False),
    ("dash_root_claude", Path(r"C:/Users/filat/dash"), False),  # CLAUDE.md only
    ("user_global_claude", Path(r"C:/Users/filat/.claude"), False),  # CLAUDE.md only
]

OUT_DIR = Path(r"C:/Users/filat/dash/reports")
OUT_DIR.mkdir(parents=True, exist_ok=True)
OUT_COMPENDIUM = OUT_DIR / "memory_compendium.md"
OUT_STATS = OUT_DIR / "memory_compendium_stats.json"


def get_heading(content: str) -> str:
    for line in content.split("\n"):
        if line.startswith("# ") and len(line) > 2:
            return line[2:].strip()
    return ""


def first_lines(content: str, n: int = 5) -> list[str]:
    lines = [l.strip() for l in content.split("\n") if l.strip()]
    # Skip frontmatter
    if lines and lines[0] == "---":
        end = -1
        for i, l in enumerate(lines[1:], 1):
            if l == "---":
                end = i
                break
        lines = lines[end + 1:] if end > 0 else lines
    # Skip heading itself
    lines = [l for l in lines if not l.startswith("#")]
    return lines[:n]


def collect():
    entries = []
    stats_per_source = {}

    # Shallow cap files: only root CLAUDE.md
    shallow_cap_files = {
        "dash_root_claude": "CLAUDE.md",
        "user_global_claude": "CLAUDE.md",
    }

    for source_name, root, recursive in SOURCES:
        if not root.exists():
            stats_per_source[source_name] = {"status": "missing", "count": 0}
            continue

        files = []
        if source_name in shallow_cap_files:
            p = root / shallow_cap_files[source_name]
            if p.exists():
                files.append(p)
        elif recursive:
            files = list(root.rglob("*.md"))
        else:
            files = [p for p in root.iterdir() if p.is_file() and p.suffix == ".md"]

        # Filter out duplicates across sources (by path)
        seen = {e["path"] for e in entries}
        added = 0
        for p in files:
            try:
                rel = p.resolve()
            except Exception:
                continue
            if str(rel) in seen:
                continue
            try:
                st = p.stat()
                content = p.read_text(encoding="utf-8", errors="replace")
            except Exception:
                continue
            entries.append({
                "source": source_name,
                "path": str(rel),
                "name": p.name,
                "size": st.st_size,
                "mtime": datetime.fromtimestamp(st.st_mtime).strftime("%Y-%m-%d"),
                "heading": get_heading(content),
                "first_lines": first_lines(content),
                "word_count": len(content.split()),
                "line_count": content.count("\n"),
            })
            seen.add(str(rel))
            added += 1

        stats_per_source[source_name] = {"status": "ok", "count": added}

    return entries, stats_per_source


def write_compendium(entries, stats):
    # Sort by source then name
    entries.sort(key=lambda e: (e["source"], e["size"]), reverse=False)

    with OUT_COMPENDIUM.open("w", encoding="utf-8") as f:
        f.write("# Memory Compendium — all markdown knowledge bases (metadata)\n\n")
        f.write(f"Collected: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n\n")
        f.write(f"**Total files**: {len(entries)}\n")
        f.write(f"**Total size**: {sum(e['size'] for e in entries) / 1024**2:.1f} MB\n")
        f.write(f"**Total words**: {sum(e['word_count'] for e in entries):,}\n\n")

        f.write("## Per-source breakdown\n\n")
        f.write("| Source | Count |\n|---|---:|\n")
        for name, d in stats.items():
            f.write(f"| {name} | {d['count']} |\n")
        f.write("\n")

        # Group entries by source
        from collections import defaultdict
        by_source = defaultdict(list)
        for e in entries:
            by_source[e["source"]].append(e)

        for source_name in sorted(by_source.keys()):
            f.write(f"\n## {source_name} ({len(by_source[source_name])} files)\n\n")
            for e in sorted(by_source[source_name], key=lambda x: -x["size"]):
                size_kb = e["size"] / 1024
                f.write(f"### {e['name']} — {size_kb:.0f}KB · {e['mtime']} · {e['word_count']}w\n")
                f.write(f"Path: `{e['path']}`\n\n")
                if e["heading"]:
                    f.write(f"Heading: **{e['heading']}**\n\n")
                if e["first_lines"]:
                    for line in e["first_lines"]:
                        f.write(f"> {line[:200]}\n")
                    f.write("\n")

    with OUT_STATS.open("w", encoding="utf-8") as f:
        json.dump({
            "total": len(entries),
            "total_size_bytes": sum(e["size"] for e in entries),
            "total_words": sum(e["word_count"] for e in entries),
            "per_source": stats,
            "entries_summary": [
                {"source": e["source"], "name": e["name"], "size": e["size"], "words": e["word_count"], "mtime": e["mtime"]}
                for e in entries
            ],
        }, f, ensure_ascii=False, indent=2)


def main():
    entries, stats = collect()
    write_compendium(entries, stats)
    total_files = len(entries)
    total_mb = sum(e["size"] for e in entries) / 1024**2
    total_words = sum(e["word_count"] for e in entries)
    print(f"Collected {total_files} files, {total_mb:.1f} MB, {total_words:,} words")
    print(f"Per source:")
    for name, d in stats.items():
        print(f"  {name}: {d['count']}")
    print(f"\nWrote: {OUT_COMPENDIUM}")
    print(f"Wrote: {OUT_STATS}")


if __name__ == "__main__":
    main()
