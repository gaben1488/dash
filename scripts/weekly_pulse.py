#!/usr/bin/env python3
"""Weekly pulse v1 — measures PRODUCT/RISK outcomes, not meta-activity.

WHY (vs old daily_pulse.py): the old pulse scored "сила петли" from commit-count,
mulch-records-today, feedback-verified — i.e. "did I do rituals today". Over 31
historical runs it never surfaced a real problem and never drove an action
(stuck 3.7🔴 for weeks on quiet days, 9🟢 on active days). It rated the project
"8.5 сильная петля" on a day with an OPEN P0 auth hole.

This pulse asks instead: is the product shipping + correct, are known risks
shrinking, is the memory loop intact, is the project drifting. Each signal is
cheaply derivable, and RED prints the concrete next action. Silent-friendly:
when everything is green it says so in one line.

Cadence: WEEKLY (run via scheduler or /pulse) — never per user-turn.
USAGE: python scripts/weekly_pulse.py [--write]
"""
from __future__ import annotations

import glob
import json
import re
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")

ROOT = Path(r"C:/Users/filat/dash")
MEM = Path(r"C:/Users/filat/.claude/projects/C--Users-filat-dash/memory")
NOW_MD = Path(r"C:/Users/filat/Documents/Obsidian/delete not delete/AEMR/10-Index/NOW.md")
VAULT_DAILY = Path(r"C:/Users/filat/Documents/Obsidian/delete not delete/AEMR/50-Workflow/daily")
WEEKLY_OUT = VAULT_DAILY.parent / "weekly"
PROD_HEALTH = "http://193.233.244.217/api/health"


def run(cmd: list[str], timeout: int = 30) -> str:
    try:
        r = subprocess.run(cmd, cwd=str(ROOT), capture_output=True, text=True,
                           timeout=timeout, encoding="utf-8", errors="replace")
        return r.stdout or ""
    except Exception:
        return ""


# --- signals: each returns (name, ok: bool|None, status_text, action_if_red) ---

def s_prod_health():
    out = run(["curl", "-fsS", "-m", "15", PROD_HEALTH])
    ok = '"status":"ok"' in out.replace(" ", "")
    return ("prod_health", ok,
            "прод жив (/api/health ok)" if ok else "ПРОД НЕ ОТВЕЧАЕТ на /api/health",
            "проверить VPS: docker compose ps + логи server; при нужде передеплой")


def s_ci_main():
    out = run(["gh", "run", "list", "--branch", "main", "--limit", "1",
               "--json", "conclusion,status,headSha"])
    concl, sha = "", ""
    try:
        j = json.loads(out)
        if j:
            concl = j[0].get("conclusion") or j[0].get("status") or ""
            sha = (j[0].get("headSha") or "")[:7]
    except Exception:
        pass
    head = run(["git", "rev-parse", "--short=7", "HEAD"]).strip()
    on_head = bool(sha) and bool(head) and sha[:7] == head[:7]
    ok = (concl == "success") and on_head
    if concl == "success" and not on_head:
        desc = f"CI success, но на {sha} — HEAD={head} (stale green: тесты/parity не подтверждены на текущем коде)"
    else:
        desc = f"CI main: {concl or '?'} @ {sha or '?'}"
    return ("ci_gate_on_head", ok if concl else None, desc,
            "прогнать CI на текущем HEAD — зелёный должен быть на HEAD; покрывает parity/валидацию/recon (всё в vitest)")


def s_ssot():
    issues = []
    defs = 0
    for f in ROOT.glob("packages/shared/src/**/*.ts"):
        try:
            defs += len(re.findall(r"export function classifySheet\b", f.read_text(encoding="utf-8", errors="replace")))
        except Exception:
            pass
    if defs != 1:
        issues.append(f"classifySheet определений: {defs} (SSOT требует 1)")
    routes: dict[str, int] = {}
    for f in ROOT.glob("packages/server/src/routes/**/*.ts"):
        try:
            txt = f.read_text(encoding="utf-8", errors="replace")
            for m in re.finditer(r"""app\.(get|post|put|delete)\(\s*['"]([^'"]+)['"]""", txt):
                key = f"{m.group(1).upper()} {m.group(2)}"
                routes[key] = routes.get(key, 0) + 1
        except Exception:
            pass
    dups = [k for k, v in routes.items() if v > 1]
    if dups:
        issues.append(f"дубль-роуты: {', '.join(dups[:3])}")
    ok = not issues
    return ("ssot_guard", ok,
            "SSOT цел (1×classifySheet, нет дубль-роутов)" if ok else "; ".join(issues),
            "схлопнуть к единому источнику (GOAL §3); дубль-роут ломает старт Fastify (см. NOW.md)")


def s_drift():
    last = run(["git", "log", "-1", "--format=%cI"]).strip()
    days = None
    if last:
        try:
            days = (datetime.now(timezone.utc) - datetime.fromisoformat(last)).days
        except Exception:
            pass
    ok = days is not None and days <= 7
    return ("drift", ok,
            f"последний коммит {days}д назад" if days is not None else "коммиты не читаются",
            "проект застрял >7д — взять следующий шаг из NOW/GOAL")


def s_now_fresh():
    if not NOW_MD.exists():
        return ("now_fresh", False, "NOW.md отсутствует", "создать NOW.md (текущий шаг)")
    days = (datetime.now() - datetime.fromtimestamp(NOW_MD.stat().st_mtime)).days
    ok = days <= 7
    return ("now_fresh", ok, f"NOW.md обновлён {days}д назад",
            "обновить NOW.md — текущий шаг устарел (drift-сигнал)")


def s_mulch_synced():
    st = run(["git", "status", "--porcelain", ".mulch/"]).strip()
    n = len([x for x in st.splitlines() if x.strip()])
    ok = n == 0
    return ("mulch_synced", ok,
            "mulch синкан" if ok else f"mulch-уроки НЕ закоммичены ({n} файл(ов)) — петля разорвана",
            "ml sync (или git commit .mulch/ — снять блок server-tsc OOM: page-file 16ГБ)")


def s_tooling_backed():
    st = run(["git", "status", "--porcelain", "scripts/"]).splitlines()
    unt = [x for x in st if x.startswith("??") and x.strip().endswith(".py")]
    ok = len(unt) == 0
    return ("tooling_backup", ok,
            "тулинг в git" if ok else f"{len(unt)} untracked-скриптов в scripts/ (потеряшки, только локально)",
            "решить: git add инфра-скрипты (build_state/skill_gate/...) или принять как per-machine")


def s_open_p0():
    reg = MEM / "CODEX_REVIEW_2026-06-14.md"
    titles = []
    if reg.exists():
        t = reg.read_text(encoding="utf-8", errors="replace")
        sec = ""
        if "Критические (P0)" in t:
            sec = t.split("Критические (P0)")[-1]
            sec = sec.split("### Высокие")[0] if "### Высокие" in sec else sec
        for m in re.finditer(r"\|\s*\d+\s*\|\s*\*\*(.+?)\*\*", sec):
            titles.append(m.group(1).strip().rstrip("."))
    ok = len(titles) == 0
    desc = "открытых P0 нет" if ok else f"{len(titles)} P0 открыто: " + "; ".join(titles[:2])
    return ("open_p0", ok, desc,
            "закрыть P0 безопасности (auth/RBAC/TLS) — верх дорожной карты, выше любых фич")


def s_tests():
    files = list(ROOT.glob("packages/*/src/**/*.test.ts")) + list(ROOT.glob("packages/*/test/**/*.test.ts"))
    ok = len(files) > 0
    return ("tests", ok, f"{len(files)} тест-файлов",
            "тесты исчезли — восстановить покрытие")


SIGNALS = [s_open_p0, s_prod_health, s_ci_main, s_ssot, s_mulch_synced,
           s_tooling_backed, s_now_fresh, s_drift, s_tests]


def old_pulse_today() -> str:
    fs = sorted(glob.glob(str(VAULT_DAILY / "*pulse*.md")))
    if not fs:
        return "нет данных"
    t = Path(fs[-1]).read_text(encoding="utf-8", errors="replace")
    m = re.search(r"loop_strength:\s*([\d.]+)", t)
    v = re.search(r'verdict:\s*"?([^"\n]+)', t)
    return f'{m.group(1) if m else "?"} «{(v.group(1).strip() if v else "?")}»'


def main():
    today = datetime.now().date().isoformat()
    rows = []
    for fn in SIGNALS:
        try:
            rows.append(fn())
        except Exception as e:
            rows.append((fn.__name__, None, f"ошибка сигнала: {e}", None))

    red = [r for r in rows if r[1] is False]
    green = [r for r in rows if r[1] is True]
    unknown = [r for r in rows if r[1] is None]

    lines = [f"# Недельный пульс — {today} (окно 7д)", ""]
    if red:
        lines.append(f"## 🔴 ТРЕБУЕТ ДЕЙСТВИЯ ({len(red)})")
        for name, _ok, desc, action in red:
            lines.append(f"- 🔴 **{name}** — {desc}")
            if action:
                lines.append(f"  → {action}")
        lines.append("")
    if unknown:
        lines.append("## ⚪ НЕ ОПРЕДЕЛЕНО")
        for name, _ok, desc, _a in unknown:
            lines.append(f"- ⚪ {name} — {desc}")
        lines.append("")
    lines.append("## 🟢 В ПОРЯДКЕ")
    lines.append("  " + " | ".join(f"{n}: {d}" for n, _o, d, _a in green) if green else "  (нет зелёных)")
    lines.append("")
    verdict = ("🔴 есть риски, требующие действия" if red else
               "🟡 неполные данные" if unknown and not red else
               "🟢 рисков не найдено — продолжать")
    lines.append(f"## Итог: {verdict}")
    lines.append(f"> Контроль-контраст: старый daily-пульс на {today} = **{old_pulse_today()}** "
                 f"при {len(red)} открытых рисках выше. Старый мерил активность, новый — исходы.")

    doc = "\n".join(lines) + "\n"
    print(doc)

    if "--write" in sys.argv:
        WEEKLY_OUT.mkdir(parents=True, exist_ok=True)
        (WEEKLY_OUT / f"{today}-weekly-pulse.md").write_text(doc, encoding="utf-8")
        print(f"[WRITTEN] {WEEKLY_OUT / (today + '-weekly-pulse.md')}")


if __name__ == "__main__":
    main()
