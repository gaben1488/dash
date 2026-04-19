#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""skill_registry_live.py — живой регистр skills / plugins / MCP.

Задача: всегда знать, какие у Claude есть skills, plugins и MCP-коннекторы,
без ручного ведения AEMR_TOOLKIT_REGISTRY.md.

Источники:
  1. ~/.claude/skills/*/SKILL.md               — пользовательские user-skills
  2. dash/.claude/plugins/*/skills/*/SKILL.md — project-plugin скиллы
  3. dash/.claude/plugins/*/commands/*.md     — команды плагинов
  4. Platform skills и MCP — извлекаются из env CLAUDE_AVAILABLE_SKILLS / MCP_LIST,
     либо переданы как argv --platform-skills / --mcp-list JSON.
     (в большинстве сред Claude Code этих env нет — тогда берутся из локального
      файла фикстуры memory/_platform_tools_snapshot.json, который пользователь
      актуализирует после апдейта Claude.app).

Выходы:
  - memory/SKILL_REGISTRY_LIVE.json       — структурированные данные (machine)
  - memory/SKILL_REGISTRY_LIVE.md         — человеко-читаемый reader (human)

Группировка (в MD): ag-* · impeccable-* · taste-* · ruflo-* · plugin-skills
                     · platform-skills · MCP-connectors · misc

Оценка активности: парсит transcripts (Claude Code projects jsonl) за последние
7 дней, считает вхождения skill name → last_used. Без telemetry — все поля
помечаются "unknown".

Dry-run default. CLI:
  --apply           — писать MD/JSON (по умолчанию dry-run: только stdout-сводка)
  --with-telemetry  — прочитать jsonl для last_used
  --json            — вывести JSON в stdout
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
from typing import Dict, List, Optional

HOME = Path.home()
USER_SKILLS_ROOT  = HOME / ".claude" / "skills"
PROJECT_ROOT      = Path(r"C:/Users/filat/dash")
PLUGINS_ROOT      = PROJECT_ROOT / ".claude" / "plugins"
MEMORY_ROOT       = HOME / ".claude" / "projects" / "C--Users-filat-dash" / "memory"
TRANSCRIPTS_ROOT  = HOME / ".claude" / "projects" / "C--Users-filat-dash"

OUT_JSON  = MEMORY_ROOT / "SKILL_REGISTRY_LIVE.json"
OUT_MD    = MEMORY_ROOT / "SKILL_REGISTRY_LIVE.md"
FIXTURE   = MEMORY_ROOT / "_platform_tools_snapshot.json"

NAME_RE   = re.compile(r"^\s*name\s*:\s*(.+?)\s*$", re.MULTILINE)
DESC_RE   = re.compile(r"^\s*description\s*:\s*(.+?)\s*$", re.MULTILINE)
TRIG_RE   = re.compile(r"^\s*trigger\s*:\s*(.+?)\s*$", re.MULTILINE)


@dataclass
class Skill:
    name: str
    description: str = ""
    source: str = ""          # user | plugin:<plugin> | platform | mcp
    path: str = ""
    trigger: str = ""
    mtime: Optional[str] = None
    last_used: Optional[str] = None   # ISO date or "unknown"
    used_last_7d: int = 0
    group: str = ""           # ag | impeccable | taste | ruflo | plugin | platform | mcp | misc


def parse_skill_md(path: Path, source: str) -> Optional[Skill]:
    try:
        text = path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return None
    name_m = NAME_RE.search(text)
    desc_m = DESC_RE.search(text)
    trig_m = TRIG_RE.search(text)
    name = (name_m.group(1).strip().strip('"\'') if name_m else path.parent.name)
    desc = (desc_m.group(1).strip().strip('"\'') if desc_m else "").split("\n")[0][:500]
    trigger = (trig_m.group(1).strip().strip('"\'') if trig_m else "")
    mtime = datetime.fromtimestamp(path.stat().st_mtime).isoformat(timespec="seconds")
    return Skill(name=name, description=desc, source=source, path=str(path),
                 trigger=trigger, mtime=mtime, last_used="unknown",
                 group=classify_group(name, source))


def classify_group(name: str, source: str) -> str:
    if source == "platform":
        return "platform"
    if source == "mcp":
        return "mcp"
    if source.startswith("plugin:"):
        return "plugin"
    for prefix, g in (
        ("ag-", "ag"),
        ("impeccable-", "impeccable"),
        ("taste-", "taste"),
        ("ruflo-", "ruflo"),
    ):
        if name.startswith(prefix):
            return g
    return "misc"


def scan_user_skills() -> List[Skill]:
    out: List[Skill] = []
    if not USER_SKILLS_ROOT.is_dir():
        return out
    for d in sorted(USER_SKILLS_ROOT.iterdir()):
        sk_md = d / "SKILL.md"
        if sk_md.exists():
            s = parse_skill_md(sk_md, "user")
            if s:
                out.append(s)
    return out


def scan_plugin_skills() -> List[Skill]:
    out: List[Skill] = []
    if not PLUGINS_ROOT.is_dir():
        return out
    for plugin_dir in sorted(PLUGINS_ROOT.iterdir()):
        if not plugin_dir.is_dir():
            continue
        plug_name = plugin_dir.name
        skills_dir = plugin_dir / "skills"
        if skills_dir.is_dir():
            for sd in sorted(skills_dir.iterdir()):
                sk_md = sd / "SKILL.md"
                if sk_md.exists():
                    s = parse_skill_md(sk_md, f"plugin:{plug_name}")
                    if s:
                        out.append(s)
        commands_dir = plugin_dir / "commands"
        if commands_dir.is_dir():
            for cm in sorted(commands_dir.glob("*.md")):
                out.append(Skill(
                    name=f"/{cm.stem}",
                    description="(plugin command)",
                    source=f"plugin:{plug_name}",
                    path=str(cm),
                    trigger=f"/{cm.stem}",
                    mtime=datetime.fromtimestamp(cm.stat().st_mtime).isoformat(timespec="seconds"),
                    last_used="unknown",
                    group="plugin",
                ))
    return out


def scan_platform_and_mcp() -> List[Skill]:
    """Платформенные skills и MCP берутся из snapshot-фикстуры.

    Фикстура memory/_platform_tools_snapshot.json формируется пользователем
    (или отдельным шагом) на основании system-reminder'а Claude Code.
    Формат:
      {
        "platform_skills": [
          {"name": "update-config", "description": "..."},
          {"name": "simplify",      "description": "..."},
          ...
        ],
        "mcp_connectors": [
          {"name": "Claude_Preview",     "description": "Live preview Vite"},
          {"name": "Desktop_Commander",  "description": "Shell + filesystem"},
          ...
        ]
      }
    """
    out: List[Skill] = []
    if not FIXTURE.exists():
        return out
    try:
        data = json.loads(FIXTURE.read_text(encoding="utf-8"))
    except Exception:
        return out
    for item in data.get("platform_skills", []):
        out.append(Skill(
            name=item.get("name", ""),
            description=item.get("description", ""),
            source="platform",
            path=str(FIXTURE),
            trigger=item.get("trigger", ""),
            mtime=None,
            last_used="unknown",
            group="platform",
        ))
    for item in data.get("mcp_connectors", []):
        out.append(Skill(
            name=item.get("name", ""),
            description=item.get("description", ""),
            source="mcp",
            path=str(FIXTURE),
            trigger=item.get("trigger", ""),
            mtime=None,
            last_used="unknown",
            group="mcp",
        ))
    return out


def attach_telemetry(skills: List[Skill]) -> None:
    """Проходит jsonl транскриптов за последние 7 дней, ищет упоминания skill.name.

    Грубая эвристика: строка, содержащая `"skill": "<name>"` или `name="<name>"`
    в tool_use блоке. Без полного парсинга содержимого.
    """
    if not TRANSCRIPTS_ROOT.is_dir():
        return
    cutoff = datetime.now() - timedelta(days=7)
    names = {s.name: s for s in skills}
    for jsonl in TRANSCRIPTS_ROOT.rglob("*.jsonl"):
        try:
            st = jsonl.stat()
        except OSError:
            continue
        if datetime.fromtimestamp(st.st_mtime) < cutoff:
            continue
        try:
            with jsonl.open("r", encoding="utf-8", errors="replace") as fh:
                for line in fh:
                    for name, s in names.items():
                        if not name:
                            continue
                        if f'"{name}"' in line or f"'{name}'" in line:
                            s.used_last_7d += 1
                            s.last_used = datetime.fromtimestamp(st.st_mtime).strftime("%Y-%m-%d")
        except OSError:
            continue


def render_md(skills: List[Skill]) -> str:
    groups = {
        "ag":         "## ag-* skills (sunnyc-agents)",
        "impeccable": "## impeccable-* skills (UI polish)",
        "taste":      "## taste-* skills (premium design)",
        "ruflo":      "## ruflo-agent-* skills (agent-tier)",
        "plugin":     "## plugin skills (project plugins)",
        "platform":   "## platform skills (Claude.app native)",
        "mcp":        "## MCP connectors",
        "misc":       "## misc skills",
    }
    order = ["ag", "impeccable", "taste", "ruflo", "plugin", "platform", "mcp", "misc"]
    by_group: Dict[str, List[Skill]] = {g: [] for g in order}
    for s in skills:
        by_group.setdefault(s.group, []).append(s)

    now = datetime.now().strftime("%Y-%m-%d %H:%M")
    total = len(skills)
    lines = [
        "---",
        "type: registry",
        f"date: {datetime.now().strftime('%Y-%m-%d')}",
        "priority: P0",
        "status: active",
        'description: "Живой регистр всех user-skills, plugin-skills, platform-skills и MCP-коннекторов. Генерируется scripts/skill_registry_live.py в SessionStart-хуке. Сверка — ежесессия. Замещает ручной AEMR_TOOLKIT_REGISTRY как source-of-truth."',
        'related: ["[[AEMR_TOOLKIT_REGISTRY]]", "[[SKILL_ACTIVATION_MAP]]", "[[AEMR_EXTENSION_POINTS]]", "[[CONNECTIONS_AUDIT]]"]',
        "---",
        "",
        f"# SKILL_REGISTRY_LIVE — актуализировано {now}",
        "",
        f"Всего инструментов: **{total}**.",
        "",
        "| Группа | Кол-во |",
        "|--------|:------:|",
    ]
    for g in order:
        lines.append(f"| {g} | {len(by_group.get(g, []))} |")
    lines.append("")

    for g in order:
        items = by_group.get(g, [])
        if not items:
            continue
        lines.append(groups[g])
        lines.append("")
        lines.append("| Имя | Описание | Источник | Триггер | Last used | 7d |")
        lines.append("|-----|----------|---------|---------|-----------|----|")
        for s in sorted(items, key=lambda x: x.name):
            desc = (s.description or "").replace("|", "\\|").replace("\n", " ")[:140]
            lines.append(
                f"| `{s.name}` | {desc} | {s.source} | {s.trigger or '—'} | "
                f"{s.last_used or 'unknown'} | {s.used_last_7d} |"
            )
        lines.append("")

    lines.append("## Как обновить")
    lines.append("")
    lines.append("```bash")
    lines.append("python C:/Users/filat/dash/scripts/skill_registry_live.py --with-telemetry --apply")
    lines.append("```")
    lines.append("")
    lines.append("SessionStart-хук делает это автоматически; см. `.claude/settings.json`.")
    lines.append("")
    lines.append(f"Snapshot-фикстура (platform+MCP): `{FIXTURE}`. Обновляется вручную, когда Claude.app получает новые инструменты.")
    return "\n".join(lines)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true", help="write files (default: dry-run)")
    ap.add_argument("--with-telemetry", action="store_true", help="scan jsonl transcripts")
    ap.add_argument("--json", action="store_true", help="print JSON to stdout")
    args = ap.parse_args()

    skills: List[Skill] = []
    skills.extend(scan_user_skills())
    skills.extend(scan_plugin_skills())
    skills.extend(scan_platform_and_mcp())
    if args.with_telemetry:
        attach_telemetry(skills)

    payload = {
        "generated": datetime.now().isoformat(timespec="seconds"),
        "counts": {
            "total": len(skills),
            "user": sum(1 for s in skills if s.source == "user"),
            "plugin": sum(1 for s in skills if s.source.startswith("plugin:")),
            "platform": sum(1 for s in skills if s.source == "platform"),
            "mcp": sum(1 for s in skills if s.source == "mcp"),
        },
        "skills": [asdict(s) for s in skills],
    }

    if args.apply:
        OUT_JSON.parent.mkdir(parents=True, exist_ok=True)
        OUT_JSON.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        OUT_MD.write_text(render_md(skills), encoding="utf-8")
        print(f"wrote {OUT_JSON}")
        print(f"wrote {OUT_MD}")
    else:
        c = payload["counts"]
        print(f"[dry-run] total={c['total']} user={c['user']} "
              f"plugin={c['plugin']} platform={c['platform']} mcp={c['mcp']}")
        if args.json:
            print(json.dumps(payload, ensure_ascii=False, indent=2))

if __name__ == "__main__":
    main()
