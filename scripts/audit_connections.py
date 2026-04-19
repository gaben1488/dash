#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""audit_connections.py — двойной аудит memory/ и Obsidian AEMR vault.

Сканирует:
  1. C:/Users/filat/.claude/projects/C--Users-filat-dash/memory/
  2. C:/Users/filat/Documents/Obsidian/delete not delete/AEMR/

Считает:
  - число узлов / рёбер
  - broken wikilinks (target не найден ни в одном хранилище по basename)
  - асимметричные related-пары (A→B без обратной связи)
  - stale-ноды (mtime ≥ STALE_DAYS и нет incoming)
  - orphan-ноды (outgoing == 0 and incoming == 0)
  - ноды без frontmatter
Пишет audit_connections_report.json + (опционально) CONNECTIONS_AUDIT_RESULT.md.

Dry-run default. CLI:
  --apply            — разрешить запись в файлы (в т.ч. --symmetrize)
  --symmetrize       — дописывать A в related: B при A→B асимметрии
  --incremental FILE — обработать один файл (скорость для PostToolUse-hook'а)
  --json             — вывести JSON в stdout
"""

from __future__ import annotations
import argparse
import json
import os
import re
import sys
from dataclasses import dataclass, field, asdict
from datetime import datetime, timedelta
from pathlib import Path
from typing import Dict, List, Optional, Set, Tuple

MEMORY_ROOT = Path(r"C:/Users/filat/.claude/projects/C--Users-filat-dash/memory")
VAULT_ROOT  = Path(r"C:/Users/filat/Documents/Obsidian/delete not delete/AEMR")
STALE_DAYS  = 30

WIKILINK_RE    = re.compile(r"\[\[([^\]|#]+?)(?:#[^\]|]+)?(?:\|[^\]]+?)?\]\]")
FRONTMATTER_RE = re.compile(r"\A---\n(.*?)\n---", re.DOTALL)
RELATED_RE     = re.compile(r'^\s*related\s*:\s*(\[.*?\]|.*)$', re.MULTILINE | re.DOTALL)
TYPE_RE        = re.compile(r'^\s*type\s*:\s*(.+?)\s*$', re.MULTILINE)


@dataclass
class Node:
    path: Path
    stem: str
    type_: str = ""
    mtime: float = 0.0
    has_frontmatter: bool = False
    outgoing: Set[str] = field(default_factory=set)
    incoming: Set[str] = field(default_factory=set)
    related: Set[str] = field(default_factory=set)


def collect(root: Path) -> Dict[str, Node]:
    nodes: Dict[str, Node] = {}
    if not root.exists():
        return nodes
    for p in root.rglob("*.md"):
        try:
            text = p.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        n = Node(path=p, stem=p.stem, mtime=p.stat().st_mtime)
        fm = FRONTMATTER_RE.search(text)
        if fm:
            n.has_frontmatter = True
            block = fm.group(1)
            t = TYPE_RE.search(block)
            if t:
                n.type_ = t.group(1).strip().strip('"\'')
            rel = RELATED_RE.search(block)
            if rel:
                for m in WIKILINK_RE.finditer(rel.group(1)):
                    n.related.add(m.group(1).split("/")[-1].strip())
        for m in WIKILINK_RE.finditer(text):
            tgt = m.group(1).split("/")[-1].strip()
            n.outgoing.add(tgt)
        nodes[n.stem] = n
    return nodes


def merge(a: Dict[str, Node], b: Dict[str, Node]) -> Dict[str, Node]:
    out = dict(a)
    for k, v in b.items():
        # если stem совпал, оставляем более свежий
        if k in out:
            if v.mtime > out[k].mtime:
                out[k] = v
        else:
            out[k] = v
    return out


def compute(nodes: Dict[str, Node]) -> dict:
    all_stems = set(nodes.keys())
    # заполняем incoming
    for n in nodes.values():
        for tgt in n.outgoing:
            if tgt in nodes:
                nodes[tgt].incoming.add(n.stem)
    broken = []
    for n in nodes.values():
        for tgt in n.outgoing:
            if tgt not in all_stems:
                broken.append({"from": n.stem, "to": tgt, "path": str(n.path)})
    asymmetric = []
    for n in nodes.values():
        for tgt in n.related:
            if tgt in nodes:
                if n.stem not in nodes[tgt].related and n.stem not in nodes[tgt].outgoing:
                    asymmetric.append({"a": n.stem, "b": tgt, "path_b": str(nodes[tgt].path)})
    stale_threshold = datetime.now() - timedelta(days=STALE_DAYS)
    stale = [
        {"stem": n.stem,
         "mtime": datetime.fromtimestamp(n.mtime).strftime("%Y-%m-%d"),
         "path": str(n.path)}
        for n in nodes.values()
        if datetime.fromtimestamp(n.mtime) < stale_threshold and not n.incoming
    ]
    orphans = [
        n.stem for n in nodes.values()
        if not n.outgoing and not n.incoming
    ]
    no_fm = [n.stem for n in nodes.values() if not n.has_frontmatter]
    return {
        "counts": {
            "nodes": len(nodes),
            "edges": sum(len(n.outgoing) for n in nodes.values()),
            "broken": len(broken),
            "asymmetric": len(asymmetric),
            "stale_with_no_incoming": len(stale),
            "orphans": len(orphans),
            "nodes_without_frontmatter": len(no_fm),
        },
        "broken": broken,
        "asymmetric": asymmetric,
        "stale": stale,
        "orphans": orphans,
        "nodes_without_frontmatter": no_fm,
    }


def symmetrize(nodes: Dict[str, Node], report: dict, apply: bool) -> int:
    """Дописать A в related: B при A→B асимметрии.

    Формат: related: ["[[A]]", "[[B]]"] — дописываем перед ']'.
    """
    touched = 0
    for item in report["asymmetric"]:
        b = nodes.get(item["b"])
        if not b:
            continue
        try:
            text = b.path.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        fm = FRONTMATTER_RE.search(text)
        if not fm:
            continue
        block = fm.group(1)
        a = item["a"]
        if RELATED_RE.search(block):
            def _append(match):
                val = match.group(1).rstrip().rstrip("]")
                if f'[[{a}]]' in val:
                    return match.group(0)
                sep = ", " if val.strip().endswith("]") is False and "[[" in val else ""
                return match.group(0).replace(match.group(1), f'{val}{sep}"[[{a}]]"]')
            new_block = RELATED_RE.sub(_append, block, count=1)
        else:
            new_block = block + f'\nrelated: ["[[{a}]]"]'
        if new_block == block:
            continue
        new_text = text.replace(block, new_block, 1)
        if apply:
            b.path.write_text(new_text, encoding="utf-8")
        touched += 1
    return touched


def write_result_md(report: dict) -> str:
    c = report["counts"]
    lines = [
        "---",
        "type: audit-result",
        f"date: {datetime.now().strftime('%Y-%m-%d %H:%M')}",
        "priority: P0",
        "status: generated",
        'description: "Автоматический отчёт scripts/audit_connections.py. Обновляется при каждом запуске."',
        'related: ["[[CONNECTIONS_AUDIT]]"]',
        "---",
        "",
        "# CONNECTIONS_AUDIT_RESULT",
        "",
        f"nodes={c['nodes']}  edges={c['edges']}  broken={c['broken']}  "
        f"asym={c['asymmetric']}  stale_no_incoming={c['stale_with_no_incoming']}  "
        f"orphans={c['orphans']}  no_fm={c['nodes_without_frontmatter']}",
        "",
        "## broken (top 30)",
        "",
        "| from | to |",
        "|------|----|",
    ]
    for b in report["broken"][:30]:
        lines.append(f"| `{b['from']}` | `{b['to']}` |")
    lines += ["", "## asymmetric (top 30)", "", "| a | b |", "|---|---|"]
    for a in report["asymmetric"][:30]:
        lines.append(f"| `{a['a']}` | `{a['b']}` |")
    lines += ["", "## stale (top 30)", "", "| stem | mtime |", "|------|-------|"]
    for s in report["stale"][:30]:
        lines.append(f"| `{s['stem']}` | {s['mtime']} |")
    lines += ["", "## orphans (sample 30)"]
    for o in report["orphans"][:30]:
        lines.append(f"- `{o}`")
    lines.append("")
    return "\n".join(lines)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true", help="write files (default: dry-run)")
    ap.add_argument("--symmetrize", action="store_true", help="fill missing back-refs")
    ap.add_argument("--incremental", metavar="FILE", help="audit only one file path")
    ap.add_argument("--json", action="store_true", help="print JSON to stdout")
    args = ap.parse_args()

    mem  = collect(MEMORY_ROOT)
    vlt  = collect(VAULT_ROOT)
    nodes = merge(mem, vlt)
    if args.incremental:
        # Грубый режим: проверяем broken/stale для одного файла, без global recompute.
        target = Path(args.incremental)
        n = nodes.get(target.stem)
        if not n:
            print(f"file {target} not indexed")
            return
        all_stems = set(nodes.keys())
        broken = [t for t in n.outgoing if t not in all_stems]
        print(f"{n.stem}: outgoing={len(n.outgoing)} broken={len(broken)}")
        if broken:
            for b in broken:
                print(f"  broken -> {b}")
        return

    report = compute(nodes)
    if args.symmetrize:
        touched = symmetrize(nodes, report, args.apply)
        report["symmetrize_touched"] = touched

    report_path = MEMORY_ROOT / "audit_connections_report.json"
    result_md_path = MEMORY_ROOT / "CONNECTIONS_AUDIT_RESULT.md"
    if args.apply:
        report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
        result_md_path.write_text(write_result_md(report), encoding="utf-8")
        print(f"wrote {report_path}")
        print(f"wrote {result_md_path}")
    if args.json:
        print(json.dumps(report, ensure_ascii=False, indent=2))
    else:
        c = report["counts"]
        print(f"nodes={c['nodes']} edges={c['edges']} broken={c['broken']} "
              f"asym={c['asymmetric']} stale={c['stale_with_no_incoming']} "
              f"orphans={c['orphans']} no_fm={c['nodes_without_frontmatter']}")
        if not args.apply:
            print("[dry-run] nothing was written; pass --apply to persist")


if __name__ == "__main__":
    main()
