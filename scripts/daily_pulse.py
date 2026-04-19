"""Daily pulse — «сила петли» (strength of the feedback loop).

Mirrors AEMR's trust-score pattern onto the meta-work of building AEMR:
  loop_strength = weighted({closure, fb_to_rule, rule_to_code,
                             drift, orphan_pressure, lessons})

Pulls data from:
  - git log       (commits, what was touched)
  - MEMORY.md     (docs, feedback files, rules)
  - mulch status  (records/day, domain activity)  [auto-skipped if not installed]
  - graphify-out  (orphan counts on last run)
  - plan file     (rustling-sniffing-lobster + aemr-full-revisit)
  - SELF_IMPROVEMENT.md (lesson cadence)

Writes:
  50-Workflow/daily/YYYY-MM-DD-pulse.md     (Obsidian vault)
  memory/daily-pulse/YYYY-MM-DD.md          (project memory, if path exists)

USAGE
  python scripts/daily_pulse.py                # today, write files
  python scripts/daily_pulse.py --date 2026-04-17
  python scripts/daily_pulse.py --print-only   # stdout, don't write
"""
from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from datetime import date, datetime, timedelta
from pathlib import Path

sys.stdout.reconfigure(encoding='utf-8')

PROJECT = Path(r"C:/Users/filat/dash")
MEMORY = Path(r"C:/Users/filat/.claude/projects/C--Users-filat-dash/memory")
VAULT = Path(r"C:/Users/filat/Documents/Obsidian/delete not delete/AEMR")
VAULT_DAILY = VAULT / "50-Workflow" / "daily"
GRAPH = PROJECT / "graphify-out"


def run(cmd: list[str], cwd: Path = PROJECT, timeout: int = 20) -> str:
    # Windows: .cmd/.bat shims (ml.cmd, bun.cmd) need shell resolution, but
    # naïve ' '.join(cmd) then shell=True makes cmd.exe eat `|` as a pipe
    # (breaks `git log --pretty=format:%H|%cI|%s`). Strategy:
    #   1) Try shell=False first. Works for real .exe (git, python, node).
    #   2) On WinError 193 / FileNotFoundError (shim needs shell), fall back
    #      to shell=True with every arg containing shell metacharacters quoted.
    try:
        r = subprocess.run(list(cmd), cwd=str(cwd), capture_output=True,
                           text=True, timeout=timeout, shell=False,
                           encoding='utf-8', errors='replace')
        return r.stdout or ''
    except (FileNotFoundError, OSError):
        # shim fallback — quote args with shell-special chars
        def q(a: str) -> str:
            if any(c in a for c in ' |&<>()^"'):
                return '"' + a.replace('"', '\\"') + '"'
            return a
        try:
            r = subprocess.run(' '.join(q(a) for a in cmd), cwd=str(cwd),
                               capture_output=True, text=True, timeout=timeout,
                               shell=True, encoding='utf-8', errors='replace')
            return r.stdout or ''
        except (subprocess.TimeoutExpired, FileNotFoundError, OSError):
            return ''
    except subprocess.TimeoutExpired:
        return ''


def git_metrics(target_day: date) -> dict:
    since = (target_day - timedelta(days=7)).isoformat()
    until = (target_day + timedelta(days=1)).isoformat()
    log = run(['git', 'log', f'--since={since}', f'--until={until}',
               '--pretty=format:%H|%cI|%s', '--numstat'])
    commits_today_total = 0
    commits_today_mulch = 0
    commits_today_code = 0
    commits_week = 0
    commits_week_code = 0
    files_today = set()
    lines_today = 0
    current_day = None
    current_is_mulch = False
    # commit header line: <hash>|<iso>|<subject> — match strictly by leading 40-hex
    header_re = re.compile(r'^[0-9a-f]{7,40}\|')
    # Mulch auto-bot subject prefix: `mulch: update expertise` etc.
    mulch_subject_re = re.compile(r'^mulch\s*:', re.IGNORECASE)
    for line in log.splitlines():
        if header_re.match(line):
            parts = line.split('|', 2)
            try:
                dt = datetime.fromisoformat(parts[1]).date()
            except ValueError:
                continue
            subject = parts[2] if len(parts) > 2 else ''
            is_mulch = bool(mulch_subject_re.match(subject))
            current_day = dt
            current_is_mulch = is_mulch
            commits_week += 1
            if not is_mulch:
                commits_week_code += 1
            if dt == target_day:
                commits_today_total += 1
                if is_mulch:
                    commits_today_mulch += 1
                else:
                    commits_today_code += 1
        elif current_day == target_day and '\t' in line:
            # numstat: added  deleted  path — only count real code commits
            if current_is_mulch:
                continue
            a, d, *p = line.split('\t')
            try:
                lines_today += int(a) + int(d)
            except ValueError:
                pass
            if p:
                files_today.add(p[0])
    return {
        # Back-compat: `commits_today` keeps total so nothing downstream breaks.
        'commits_today': commits_today_total,
        'commits_today_total': commits_today_total,
        'commits_today_mulch': commits_today_mulch,
        'commits_today_code': commits_today_code,
        'commits_week': commits_week,
        'commits_week_code': commits_week_code,
        'files_today': len(files_today),
        'lines_today': lines_today,
    }


def feedback_metrics() -> dict:
    fb_dir = VAULT / "20-Knowledge" / "feedback"
    fb_count = 0
    fb_verified = 0
    if fb_dir.exists():
        for p in fb_dir.rglob('*.md'):
            fb_count += 1
            try:
                if 'verified: true' in p.read_text(encoding='utf-8', errors='replace'):
                    fb_verified += 1
            except OSError:
                pass
    return {'fb_total': fb_count, 'fb_verified': fb_verified}


def mulch_metrics(target_day: date) -> dict:
    """Mulch counters.

    - `records`: lifetime total (from `ml status --json`) — baseline context.
    - `records_today`: parsed from .mulch/expertise/*.jsonl by `recorded_at`
      prefix == target day. THIS is what `rule_to_code` should watch;
      lifetime total is meaningless as a daily signal.

    Bug fix (2026-04-19): mulch writes `recorded_at`, not `timestamp`. Was
    reading wrong field → always 0 today. Accept both for compat.
    """
    today_iso = target_day.isoformat()
    records_today = 0
    records_today_by_domain: dict[str, int] = {}

    mulch_dir = PROJECT / '.mulch' / 'expertise'
    if mulch_dir.exists():
        for jf in mulch_dir.glob('*.jsonl'):
            domain = jf.stem
            domain_count = 0
            try:
                for line in jf.read_text(encoding='utf-8', errors='replace').splitlines():
                    if not line.strip():
                        continue
                    # Fast path: look for "timestamp":"YYYY-MM-DD"
                    try:
                        rec = json.loads(line)
                    except json.JSONDecodeError:
                        # Substring fallback
                        if f'"{today_iso}' in line:
                            domain_count += 1
                        continue
                    ts = None
                    if isinstance(rec, dict):
                        # Accept both: `recorded_at` (actual mulch schema) + `timestamp` (legacy)
                        ts = rec.get('recorded_at') or rec.get('timestamp')
                    if isinstance(ts, str) and ts.startswith(today_iso):
                        domain_count += 1
            except OSError:
                continue
            if domain_count:
                records_today_by_domain[domain] = domain_count
                records_today += domain_count

    status = run(['ml', 'status', '--json'])
    if not status:
        return {
            'mulch': False,
            'records': 0,
            'domains': 0,
            'records_today': records_today,
            'records_today_by_domain': records_today_by_domain,
        }
    try:
        j = json.loads(status)
        records = sum(d.get('count', 0) for d in j.get('domains', []))
        return {
            'mulch': True,
            'records': records,
            'domains': len(j.get('domains', [])),
            'records_today': records_today,
            'records_today_by_domain': records_today_by_domain,
        }
    except (json.JSONDecodeError, AttributeError):
        return {
            'mulch': True,
            'records': -1,
            'domains': -1,
            'records_today': records_today,
            'records_today_by_domain': records_today_by_domain,
        }


def graphify_metrics() -> dict:
    gr = GRAPH / 'graph.json'
    if not gr.exists():
        return {'nodes': 0, 'edges': 0, 'orphans_pct': None}
    try:
        j = json.loads(gr.read_text(encoding='utf-8'))
        nodes = len(j.get('nodes', []))
        # networkx node-link schema uses 'links' not 'edges'
        edge_list = j.get('links', j.get('edges', []))
        edges = len(edge_list)
        nodes_with_edges: set[str] = set()
        for e in edge_list:
            if isinstance(e, dict):
                nodes_with_edges.add(e.get('source'))
                nodes_with_edges.add(e.get('target'))
            elif isinstance(e, list) and len(e) >= 2:
                nodes_with_edges.update(e[:2])
        orphans = max(0, nodes - len(nodes_with_edges))
        return {'nodes': nodes, 'edges': edges,
                'orphans_pct': round(orphans / nodes * 100, 1) if nodes else None}
    except (json.JSONDecodeError, OSError):
        return {'nodes': 0, 'edges': 0, 'orphans_pct': None}


def self_improvement_metrics(target_day: date) -> dict:
    """Lessons detector — broad scope:
      - SELF_IMPROVEMENT.md: count rule-ID headings (A1, A2, …, ### 1.) as 'total'.
      - For 'today', scan mulch records written today (they ARE the lessons now)
        plus any feedback_*.md / *.md touched in memory+vault today.
    """
    si = MEMORY / 'SELF_IMPROVEMENT.md'
    total = 0
    if si.exists():
        txt = si.read_text(encoding='utf-8', errors='replace')
        # A1-Z9 style rule IDs OR numbered ### headings
        total = len(re.findall(r'(?:^|\n)###\s+\w', txt))
        total += len(re.findall(r'^\s*([A-Z]\d+)[:.]\s', txt, re.MULTILINE))

    # today's lessons = mulch records today + new/edited feedback_* files today
    today_iso = target_day.isoformat()
    today_count = 0

    # mulch JSONL: one record per line with "timestamp":"ISO..."
    mulch_dir = PROJECT / '.mulch' / 'expertise'
    if mulch_dir.exists():
        for jf in mulch_dir.glob('*.jsonl'):
            try:
                for line in jf.read_text(encoding='utf-8', errors='replace').splitlines():
                    if today_iso in line:
                        today_count += 1
            except OSError:
                pass

    # feedback files touched today in memory/ and vault
    for root in (MEMORY, Path(r"C:/Users/filat/Documents/Obsidian/delete not delete/AEMR/20-Knowledge/feedback")):
        if not root.exists():
            continue
        for p in root.rglob('feedback*.md'):
            try:
                mt = datetime.fromtimestamp(p.stat().st_mtime).date()
                if mt == target_day:
                    today_count += 1
            except OSError:
                pass

    return {'lessons_today': today_count, 'lessons_total': total}


def compute_loop_strength(m: dict) -> tuple[float, list[tuple[str, str]]]:
    """Returns (score 0-10, per-signal [(name, 🟢/🟡/🔴 + label)])."""
    signals = []
    score = 0.0

    # 1. Closure speed — CODE commits only. Mulch auto-bot commits
    #    ("mulch: update expertise") don't represent closed work.
    c = m['git'].get('commits_today_code', m['git']['commits_today'])
    if c >= 3:
        signals.append(('closure', f'🟢 {c} code commits today'))
        score += 2.0
    elif c >= 1:
        signals.append(('closure', f'🟡 {c} code commit(s) today'))
        score += 1.2
    else:
        signals.append(('closure', '🔴 0 code commits today'))
        score += 0.2

    # 2. Drift — week code commits (exclude mulch auto-bot noise)
    w = m['git'].get('commits_week_code', m['git']['commits_week'])
    if w >= 15:
        signals.append(('drift', f'🟢 {w} code commits/week'))
        score += 1.5
    elif w >= 5:
        signals.append(('drift', f'🟡 {w} code commits/week'))
        score += 1.0
    else:
        signals.append(('drift', f'🔴 {w} code commits/week'))
        score += 0.3

    # 3. FB→verified ratio
    fv = m['fb']['fb_verified']
    ft = max(1, m['fb']['fb_total'])
    ratio = fv / ft
    if ratio >= 0.8:
        signals.append(('fb_to_rule', f'🟢 {fv}/{ft} feedback verified'))
        score += 1.5
    elif ratio >= 0.5:
        signals.append(('fb_to_rule', f'🟡 {fv}/{ft} feedback verified'))
        score += 1.0
    else:
        signals.append(('fb_to_rule', f'🔴 {fv}/{ft} feedback verified'))
        score += 0.4

    # 4. Rule→code — mulch records written TODAY (daily cadence, not lifetime).
    #    Lifetime total is always >=10 after a week, so it never triggers as a
    #    daily health signal. We want "did a lesson land today?"
    mr_today = m['mulch'].get('records_today', 0)
    mr_total = m['mulch'].get('records', 0)
    if mr_today >= 3:
        signals.append(('rule_to_code',
                        f'🟢 {mr_today} mulch records today ({mr_total} total)'))
        score += 1.5
    elif mr_today >= 1:
        signals.append(('rule_to_code',
                        f'🟡 {mr_today} mulch record(s) today ({mr_total} total)'))
        score += 1.0
    else:
        signals.append(('rule_to_code',
                        f'🔴 0 mulch records today ({mr_total} total)'))
        score += 0.4

    # 5. Orphan pressure (lower = better)
    op = m['graph'].get('orphans_pct')
    if op is None:
        signals.append(('orphans', '⚪ no graph yet'))
        score += 0.8
    elif op <= 5:
        signals.append(('orphans', f'🟢 {op}% orphans'))
        score += 1.5
    elif op <= 15:
        signals.append(('orphans', f'🟡 {op}% orphans'))
        score += 1.0
    else:
        signals.append(('orphans', f'🔴 {op}% orphans'))
        score += 0.3

    # 6. Lessons cadence
    lt = m['si']['lessons_today']
    if lt >= 2:
        signals.append(('lessons', f'🟢 {lt} lessons today'))
        score += 2.0
    elif lt >= 1:
        signals.append(('lessons', f'🟡 1 lesson today'))
        score += 1.2
    else:
        signals.append(('lessons', '🔴 0 lessons today'))
        score += 0.3

    return round(min(score, 10), 1), signals


def render(target_day: date, metrics: dict, strength: float,
           signals: list[tuple[str, str]]) -> str:
    day_iso = target_day.isoformat()
    verdict = ('🟢 сильная петля' if strength >= 8 else
               '🟡 умеренная' if strength >= 5 else
               '🔴 слабая — нужно укрепить')
    sig_tbl = '\n'.join(f"| **{n}** | {s} |" for n, s in signals)
    return f"""---
type: daily-pulse
date: {day_iso}
loop_strength: {strength}
verdict: "{verdict}"
tags: [daily, pulse, сила-петли, meta]
---

# Пульс дня — {day_iso}

> [!abstract] Сила петли: **{strength}/10** — {verdict}

## 6 сигналов

| Сигнал | Значение |
|--------|----------|
{sig_tbl}

## Сырые метрики

| Источник | Метрика | Значение |
|----------|---------|----------|
| git | commits сегодня (всего) | {metrics['git']['commits_today_total']} |
| git | commits сегодня (код) | {metrics['git']['commits_today_code']} |
| git | commits сегодня (mulch) | {metrics['git']['commits_today_mulch']} |
| git | commits за неделю (всего) | {metrics['git']['commits_week']} |
| git | commits за неделю (код) | {metrics['git']['commits_week_code']} |
| git | файлов изменено сегодня (код) | {metrics['git']['files_today']} |
| git | строк сегодня (код) | {metrics['git']['lines_today']} |
| feedback | всего | {metrics['fb']['fb_total']} |
| feedback | верифицировано | {metrics['fb']['fb_verified']} |
| mulch | записей сегодня | {metrics['mulch']['records_today']} |
| mulch | записей всего | {metrics['mulch']['records']} |
| mulch | доменов | {metrics['mulch']['domains']} |
| graphify | nodes | {metrics['graph']['nodes']} |
| graphify | edges | {metrics['graph']['edges']} |
| graphify | orphans % | {metrics['graph'].get('orphans_pct')} |
| self-improve | уроков сегодня | {metrics['si']['lessons_today']} |
| self-improve | уроков всего | {metrics['si']['lessons_total']} |

## Что можно сделать (авто-рекомендации)

{_recommendations(strength, signals)}

## Навигация
- [[CAPABILITY_MAP_2026_04_18]]
- [[AEMR_TOOLKIT_REGISTRY]]
- [[WORK_SYSTEM]]
- [[ACTIVE_TASKS]]
"""


def _recommendations(strength: float, signals: list[tuple[str, str]]) -> str:
    recs = []
    for name, val in signals:
        if '🔴' not in val:
            continue
        if name == 'closure':
            recs.append("- 🔴 **closure**: нет коммитов сегодня — завершить хотя бы один атомарный шаг из плана")
        elif name == 'drift':
            recs.append("- 🔴 **drift**: неделя без активности — открыть `aemr-full-revisit-2026-04-18.md`, взять следующий S-шаг")
        elif name == 'fb_to_rule':
            recs.append("- 🔴 **fb→rule**: feedback-файлы не верифицированы — пройтись по 20-Knowledge/feedback, добавить `verified: true`")
        elif name == 'rule_to_code':
            recs.append("- 🔴 **rule→code**: мало mulch-записей — `ml record <domain> --type ...` после каждого инсайта")
        elif name == 'orphans':
            recs.append("- 🔴 **orphans**: много несвязанных нод в графе — запустить `python scripts/link_orphans_by_date.py --apply`")
        elif name == 'lessons':
            recs.append("- 🔴 **lessons**: нет уроков за день — обновить `SELF_IMPROVEMENT.md`")
    if not recs:
        recs.append("Все сигналы ≥🟡 — петля работает. Поддерживать темп.")
    return '\n'.join(recs)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--date')
    ap.add_argument('--print-only', action='store_true')
    args = ap.parse_args()

    target = (datetime.strptime(args.date, '%Y-%m-%d').date()
              if args.date else date.today())

    metrics = {
        'git': git_metrics(target),
        'fb': feedback_metrics(),
        'mulch': mulch_metrics(target),
        'graph': graphify_metrics(),
        'si': self_improvement_metrics(target),
    }
    strength, signals = compute_loop_strength(metrics)
    doc = render(target, metrics, strength, signals)

    print(doc)

    if args.print_only:
        return

    VAULT_DAILY.mkdir(parents=True, exist_ok=True)
    (VAULT_DAILY / f"{target.isoformat()}-pulse.md").write_text(doc, encoding='utf-8')

    mem_daily = MEMORY / "daily-pulse"
    mem_daily.mkdir(parents=True, exist_ok=True)
    (mem_daily / f"{target.isoformat()}.md").write_text(doc, encoding='utf-8')

    print(f"\n[WRITTEN]")
    print(f"  vault:  {VAULT_DAILY / (target.isoformat() + '-pulse.md')}")
    print(f"  memory: {mem_daily / (target.isoformat() + '.md')}")


if __name__ == '__main__':
    main()
