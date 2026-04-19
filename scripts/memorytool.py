#!/usr/bin/env python3
"""
memorytool — unified lookup across AEMR second brain.

Usage:
    python scripts/memorytool.py search "<query>"       # top-N ranked atoms
    python scripts/memorytool.py read <stem>            # read single file by stem
    python scripts/memorytool.py recent --days 7        # recent changes across all stores
    python scripts/memorytool.py stats                  # corpus stats

Searches:
    1. Obsidian vault (C:/Users/filat/Documents/Obsidian/delete not delete/AEMR/)
    2. Project memory (C:/Users/filat/.claude/projects/C--Users-filat-dash/memory/)
    3. Mulch records (C:/Users/filat/dash/.mulch/expertise/*.jsonl)
    4. Graphify code report (C:/Users/filat/dash/graphify-out/GRAPH_REPORT.md)

Ranking: TF-IDF-lite (token overlap * length-inverse), optionally bumps canonical.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from collections import Counter

# Windows console (cp1251) cannot encode unicode arrows etc. Force UTF-8 stdout.
if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass
from datetime import datetime, timedelta
from pathlib import Path
from typing import Iterable

VAULT = Path("C:/Users/filat/Documents/Obsidian/delete not delete/AEMR")
MEMORY = Path("C:/Users/filat/.claude/projects/C--Users-filat-dash/memory")
MULCH = Path("C:/Users/filat/dash/.mulch/expertise")
GRAPH_REPORT = Path("C:/Users/filat/dash/graphify-out/GRAPH_REPORT.md")

CANONICAL_BOOST = {
    "UNIFIED_MECHANISM", "PROCEDURE", "FINAL_MASTER_ROADMAP",
    "MASTER_V2_ENTRY", "AEMR_UNIFIED_CONCEPT_V2", "AEMR_CODE_STATE_2026_04_18",
    "AEMR_ARCHITECTURE_VERDICT", "LIVING_SYSTEM_V3_PRODUCT_PLAN",
    "living-system-v3", "MEMORY", "Home",
}

SKIP_DIRS = {".obsidian", "Attachments", "_archive", "archive", "node_modules"}


def tokenize(s: str) -> list[str]:
    return re.findall(r"[a-zA-Zа-яА-Я0-9\-_]{3,}", s.lower())


def iter_md(root: Path) -> Iterable[Path]:
    if not root.exists():
        return
    for p in root.rglob("*.md"):
        if any(part in SKIP_DIRS for part in p.parts):
            continue
        yield p


def iter_mulch() -> Iterable[dict]:
    if not MULCH.exists():
        return
    for jsonl in MULCH.glob("*.jsonl"):
        with jsonl.open(encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    rec = json.loads(line)
                    rec["_source"] = jsonl.name
                    yield rec
                except json.JSONDecodeError:
                    continue


def score(query_tokens: list[str], text_tokens: list[str]) -> float:
    if not query_tokens or not text_tokens:
        return 0.0
    q = Counter(query_tokens)
    t = Counter(text_tokens)
    overlap = sum((q & t).values())
    if not overlap:
        return 0.0
    # length-inverse normalization (punishes bloat)
    length_penalty = 1.0 / (1.0 + len(text_tokens) / 500.0)
    return overlap * length_penalty


def cmd_search(query: str, limit: int = 10) -> None:
    q_tokens = tokenize(query)
    results: list[tuple[float, str, str, str]] = []  # (score, store, path, snippet)

    # Vault + memory
    for root, label in [(VAULT, "vault"), (MEMORY, "memory")]:
        for p in iter_md(root):
            try:
                txt = p.read_text(encoding="utf-8", errors="ignore")
            except Exception:
                continue
            t_tokens = tokenize(txt)
            s = score(q_tokens, t_tokens)
            if p.stem in CANONICAL_BOOST:
                s *= 1.5
            if s > 0:
                # snippet = first line containing any query token
                snippet = ""
                for line in txt.split("\n")[:200]:
                    if any(tok in line.lower() for tok in q_tokens):
                        snippet = line.strip()[:160]
                        break
                results.append((s, label, str(p), snippet))

    # Mulch
    for rec in iter_mulch():
        blob = json.dumps(rec, ensure_ascii=False)
        t_tokens = tokenize(blob)
        s = score(q_tokens, t_tokens) * 0.8  # mulch slight demotion
        if s > 0:
            desc = rec.get("description", "") or rec.get("name", "") or rec.get("title", "")
            results.append((s, "mulch", f"{rec.get('_source','?')}::{rec.get('id','?')}", desc[:160]))

    # Graphify god-nodes (one-pass grep)
    if GRAPH_REPORT.exists():
        try:
            gr = GRAPH_REPORT.read_text(encoding="utf-8", errors="ignore")
            for line in gr.split("\n"):
                ll = line.lower()
                if any(tok in ll for tok in q_tokens) and line.startswith("- "):
                    results.append((0.5, "graphify", "GRAPH_REPORT.md", line.strip()[:160]))
        except Exception:
            pass

    results.sort(key=lambda r: -r[0])
    top = results[:limit]

    if not top:
        print(f"[memorytool] no matches for: {query}")
        return

    print(f"[memorytool] top-{len(top)} for: {query}\n")
    for i, (s, label, path, snip) in enumerate(top, 1):
        print(f"{i:>2}. [{label:>8}]  {s:.2f}  {path}")
        if snip:
            print(f"        -> {snip}")


def cmd_read(stem: str) -> None:
    # find first .md with this stem in vault, memory
    for root in [VAULT, MEMORY]:
        for p in iter_md(root):
            if p.stem == stem:
                print(f"=== {p} ===\n")
                print(p.read_text(encoding="utf-8", errors="ignore"))
                return
    print(f"[memorytool] not found: {stem}")


def cmd_recent(days: int = 7) -> None:
    cutoff = datetime.now() - timedelta(days=days)
    changes: list[tuple[datetime, str, str]] = []
    for root, label in [(VAULT, "vault"), (MEMORY, "memory")]:
        for p in iter_md(root):
            try:
                mtime = datetime.fromtimestamp(p.stat().st_mtime)
                if mtime > cutoff:
                    changes.append((mtime, label, str(p)))
            except Exception:
                continue
    changes.sort(key=lambda r: -r[0].timestamp())
    print(f"[memorytool] changes in last {days} days: {len(changes)}")
    for mtime, label, path in changes[:40]:
        print(f"  {mtime:%Y-%m-%d %H:%M}  [{label}]  {path}")


def cmd_stats() -> None:
    vault_count = sum(1 for _ in iter_md(VAULT))
    memory_count = sum(1 for _ in iter_md(MEMORY))
    mulch_count = sum(1 for _ in iter_mulch())
    print(f"Vault (.md):    {vault_count}")
    print(f"Memory (.md):   {memory_count}")
    print(f"Mulch records:  {mulch_count}")
    print(f"Graph report:   {'ok' if GRAPH_REPORT.exists() else 'missing'}")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    sub = ap.add_subparsers(dest="cmd", required=True)

    s_search = sub.add_parser("search", help="Rank atoms by relevance to query")
    s_search.add_argument("query", nargs="+")
    s_search.add_argument("--limit", type=int, default=10)

    s_read = sub.add_parser("read", help="Read single md by stem")
    s_read.add_argument("stem")

    s_recent = sub.add_parser("recent", help="List recent changes")
    s_recent.add_argument("--days", type=int, default=7)

    sub.add_parser("stats", help="Corpus stats")

    args = ap.parse_args()

    if args.cmd == "search":
        cmd_search(" ".join(args.query), args.limit)
    elif args.cmd == "read":
        cmd_read(args.stem)
    elif args.cmd == "recent":
        cmd_recent(args.days)
    elif args.cmd == "stats":
        cmd_stats()


if __name__ == "__main__":
    main()
