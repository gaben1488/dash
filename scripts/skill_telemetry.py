#!/usr/bin/env python3
"""skill_telemetry.py — count skill/MCP invocations across AEMR sessions.

Usage:  python scripts/skill_telemetry.py [--days 30] [--out reports/skill_usage.md]

Scans Claude Code session transcripts (JSONL) under the project's memory dir,
counts Skill tool invocations + MCP tool calls, and writes a markdown report
with top-used skills, top-used MCPs, and dormant-skill list.

Drives the weekly "which skills actually fired" audit. Dormant >30 = cull or
wire a keyword hook.
"""
from __future__ import annotations
import json
import re
import argparse
import sys
from pathlib import Path
from collections import Counter
from datetime import datetime, timedelta, timezone

SESSIONS_DIR = Path("C:/Users/filat/.claude/projects/C--Users-filat-dash")

ALL_SKILLS = [
    # ag-*
    "ag-apple-platform-design-hig-components-layout",
    "ag-apple-platform-design-hig-foundations",
    "ag-apple-platform-design-hig-patterns",
    "ag-apple-platform-design-hig-inputs",
    "ag-architecture-design-architecture-decision-records",
    "ag-architecture-design-senior-architect",
    "ag-data-analytics-database-architect",
    "ag-data-analytics-postgres-best-practices",
    "ag-data-analytics-sql-pro",
    "ag-data-analytics-claude-d3js-skill",
    "ag-ddd-evented-architecture-cqrs-implementation",
    "ag-ddd-evented-architecture-event-store-design",
    "ag-ddd-evented-architecture-projection-patterns",
    "ag-essentials-lint-and-validate",
    "ag-essentials-systematic-debugging",
    "ag-essentials-concise-planning",
    "ag-essentials-git-pushing",
    "ag-essentials-kaizen",
    "ag-full-stack-developer-frontend-developer",
    "ag-full-stack-developer-backend-dev-guidelines",
    # ruflo-*
    "ruflo-agent-code-review-swarm", "ruflo-agent-tester",
    "ruflo-agent-performance-analyzer", "ruflo-agent-migration-plan",
    "ruflo-agent-security-manager", "ruflo-agent-repo-architect",
    # system
    "graphify", "postgres", "humanizer", "playwright-skill",
    "simplify", "loop", "schedule", "update-config",
    "less-permission-prompts", "init", "review", "security-review",
    "keybindings-help", "claude-api",
]
CLUSTER_PREFIXES = [
    "engineering:", "design:", "data:", "finance:", "operations:",
    "product-management:", "anthropic-skills:", "pdf-viewer:",
    "brand-voice:", "sales:",
]
MCP_PATTERN = re.compile(r"mcp__([a-zA-Z0-9_\-]+)__")


def _classify_tool_use(item: dict, skill_counts: Counter, mcp_counts: Counter,
                       session_set: set) -> None:
    """Single tool_use item → bump skill/MCP counters."""
    name = item.get("name", "") or ""
    if not isinstance(name, str):
        return

    # Skill tool invocation: name == "Skill", skill name in input
    if name == "Skill":
        inp = item.get("input") or {}
        sk = inp.get("skill") if isinstance(inp, dict) else None
        if sk and isinstance(sk, str):
            skill_counts[sk] += 1
            session_set.add(sk)
        return

    # MCP tool call: name starts with "mcp__<server>__"
    m = MCP_PATTERN.match(name)
    if m:
        mcp_counts[m.group(1)] += 1
        return

    # Direct skill-named tool (legacy shape)
    if name in ALL_SKILLS:
        skill_counts[name] += 1
        session_set.add(name)
        return
    for pref in CLUSTER_PREFIXES:
        if name.startswith(pref):
            skill_counts[name] += 1
            session_set.add(name)
            return


def _event_timestamp(evt: dict):
    """Parse event timestamp; return aware datetime or None."""
    ts = evt.get("timestamp") if isinstance(evt, dict) else None
    if not ts or not isinstance(ts, str):
        return None
    try:
        # ISO-8601, typically with trailing Z
        return datetime.fromisoformat(ts.replace("Z", "+00:00"))
    except ValueError:
        return None


def scan_transcripts(sessions_dir: Path, since):
    """Walk JSONL transcripts; count Skill invocations + MCP tool calls.

    Claude Code stores tool_use events nested under message.content[].
    Top-level `type` is "user"/"assistant"/"queue-operation" — NOT "tool_use".
    """
    skill_counts: Counter[str] = Counter()
    mcp_counts: Counter[str] = Counter()
    session_skill: dict[str, set[str]] = {}

    for fp in sessions_dir.glob("*.jsonl"):
        # File-level mtime pre-filter (fast rejection)
        if since and datetime.fromtimestamp(fp.stat().st_mtime, tz=timezone.utc) < since:
            continue
        sid = fp.stem
        session_skill.setdefault(sid, set())
        try:
            with fp.open(encoding="utf-8", errors="ignore") as f:
                for line in f:
                    try:
                        evt = json.loads(line)
                    except json.JSONDecodeError:
                        continue
                    if not isinstance(evt, dict):
                        continue

                    # Event-level timestamp filter (more precise than mtime)
                    if since is not None:
                        ets = _event_timestamp(evt)
                        if ets is not None and ets < since:
                            continue

                    # Primary path: nested message.content[] tool_use blocks
                    message = evt.get("message")
                    if isinstance(message, dict):
                        content = message.get("content")
                        if isinstance(content, list):
                            for item in content:
                                if (isinstance(item, dict)
                                        and item.get("type") == "tool_use"):
                                    _classify_tool_use(
                                        item, skill_counts, mcp_counts,
                                        session_skill[sid],
                                    )

                    # Fallback: legacy top-level tool_use events (rare)
                    if evt.get("type") == "tool_use":
                        _classify_tool_use(
                            evt, skill_counts, mcp_counts,
                            session_skill[sid],
                        )
        except OSError:
            continue
    return skill_counts, mcp_counts, session_skill


def report(skill_counts, mcp_counts, session_skill, out: Path):
    lines = [
        "# Skill Usage Telemetry",
        f"Generated: {datetime.now().isoformat(timespec='seconds')}",
        "",
        f"Sessions scanned: {len(session_skill)}",
        "",
        "## Top 20 skills",
    ]
    for sk, n in skill_counts.most_common(20):
        lines.append(f"- `{sk}` — {n}")

    lines.append("\n## Top 20 MCP connectors")
    for mcp, n in mcp_counts.most_common(20):
        lines.append(f"- `{mcp}` — {n}")

    fired = set(skill_counts.keys())
    dormant = [s for s in ALL_SKILLS if s not in fired]
    lines.append(f"\n## Dormant (zero invocations) — {len(dormant)}")
    for s in dormant:
        lines.append(f"- {s}")

    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text("\n".join(lines), encoding="utf-8")
    print(f"wrote {out}  |  skills_total={sum(skill_counts.values())}  "
          f"mcp_total={sum(mcp_counts.values())}  dormant={len(dormant)}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--days", type=int, default=0,
                    help="Only scan sessions modified within N days (0=all)")
    ap.add_argument("--out", type=Path, default=Path("reports/skill_usage.md"))
    ap.add_argument("--sessions", type=Path, default=SESSIONS_DIR)
    args = ap.parse_args()
    since = (datetime.now(tz=timezone.utc) - timedelta(days=args.days)
             if args.days > 0 else None)
    sc, mc, ss = scan_transcripts(args.sessions, since)
    report(sc, mc, ss, args.out)


if __name__ == "__main__":
    sys.exit(main() or 0)
