#!/usr/bin/env python3
"""UserPromptSubmit router — prompt-aware gate for AEMR hooks.

WHY THIS EXISTS
---------------
Claude Code ignores the `matcher` field for UserPromptSubmit hooks (matchers
only filter by tool-name for Pre/PostToolUse). So the ~20 matcher-"gated" hooks
that used to live in .claude/settings.json ALL fired on every single prompt:
they ran daily_pulse.py + archive_supersede.py + skill_telemetry.py each turn
and injected ~2-2.5k tokens of static suggestions regardless of topic.

This ONE hook reads the actual prompt from stdin and emits ONLY the blocks that
match. Heavy scripts run only on their explicit slash command. On a normal turn
that matches nothing, it prints nothing -> near-zero token + latency cost.

CONTRACT
--------
stdin : Claude Code UserPromptSubmit JSON, e.g. {"prompt": "...", ...}
stdout: matched context blocks (plain text), or empty
Fails open: ANY error -> exit 0 with no output (never blocks the user's prompt).
"""
from __future__ import annotations

import json
import re
import subprocess
import sys
from pathlib import Path

# Claude Code reads hook stdout as UTF-8; Windows console default is cp1251.
# Force UTF-8 so Cyrillic context blocks are not mojibake'd.
try:
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stdin.reconfigure(encoding="utf-8")
except Exception:
    pass

ROOT = Path(r"C:/Users/filat/dash")


def _run(cmd: list[str], tail: int | None = None) -> str:
    try:
        res = subprocess.run(
            cmd, cwd=str(ROOT), capture_output=True, text=True,
            timeout=90, encoding="utf-8", errors="replace",
        )
        out = res.stdout or ""
    except Exception:
        return ""
    if tail:
        out = "\n".join(out.splitlines()[-tail:])
    return out


# (regex on lowercased prompt) -> context atom. Keyword-gated; only emitted when relevant.
ATOMS: list[tuple[str, str]] = [
    (r"ф[4-8]|phase [4-8]|dashboard|databrowser|\beconomy\b|control center|tanstack|table editor|\.tsx\b",
     "Direction=UI — atoms: AEMR_DASHBOARD_F4_SPEC, AEMR_CONTROL_CENTER_REDESIGN, AEMR_TABLE_EDITOR_DESIGN. P0: ag-full-stack-developer-frontend-developer, ag-apple-platform-design-hig-patterns."),
    (r"recon|сверк|верификац|verification|шдю|\bсвод\b|\bеис\b|\b1с\b",
     "Direction=Trust — atoms: AEMR_VERIFICATION_PIPELINE, shdyu_discrepancy_root_cause, feedback_recon_display. P0: finance:reconciliation. 8 verify.* сигналов."),
    (r"postgres|postgresql|миграц\w* бд|supabase|apply_migration|pgvector",
     "Direction=Migration — atoms: AEMR_PG_MIGRATION_PLAN, ADR-0001. Skills: postgres, ag-data-analytics-database-architect. MCP: Supabase apply_migration."),
    (r"\bswarm\b|параллельн\w* агент|parallel agents",
     "Swarm — SWARM_PATTERNS.md, 8 patterns. Max 3 concurrent, per-agent ≤25k tokens."),
    (r"figma|макет|wireframe|\bux\b|ui design|frontend design",
     "Suggest: impeccable-shape -> impeccable-audit -> impeccable-polish. Figma MCP — authorize в plugins (см. TOOLKIT_AUDIT §3)."),
    (r"44.?фз|бк ?рф|\bнпа\b|статья \d+|редакц\w* закон",
     "Suggest: WebSearch свежая редакция; canon в memory/data/44fz-domain.md + columns-canon.md (legal-refs §13). Deep-research с цитатами — Perplexity MCP (нужен ключ)."),
    (r"e2e|playwright|browser test|web automation|скриншот\w* страниц",
     "Suggest: Playwright установлен (Chromium 147). DOM-aware ops -> claude-in-chrome MCP. impeccable-audit для a11y перед коммитом."),
    (r"\bdeploy\b|production|релиз|\bship\b|готов к запуску|показать начальству",
     "Pre-ship: impeccable-polish + impeccable-audit + ag-essentials-lint-and-validate. VPS http://193.233.244.217/ — curl /api/health."),
    (r"анализ\w* данны|sql query|aggregation|пересеч|statistical|корреляц",
     "Suggest: data:explore-data (профилирование), data:analyze, data:validate-data, sql-pro, postgres-best-practices."),
    (r"brainstorm|мозгов\w* штурм|варианты|опции для",
     "Suggest: product-management:brainstorm; per mx-d0f672 content-вопросы -> brainstorming + parallel subagents, не first-take."),
    (r"\badr\b|архитектурн\w* решение|architecture decision|trade-?off",
     "Suggest: ag-architecture-design-architecture-decision-records -> vault/AEMR/30-Decisions/. ADR 0001-0007 существуют."),
    (r"управлять\w* chrome|\bcdp\b|\bscrape\b|web.?парсинг|загрузить\w* файл\w* браузер",
     "Browser: claude-in-chrome MCP (DOM, предпочтительно); browser-harness (CDP self-improving); Playwright (тесты)."),
]

# Domain-skill AUTO-ACTIVATION: when a topic appears, ACTIVATE the matching skill
# (the user cannot remember which skill fits which work — the router fires it for me).
# Imperative on purpose: "ACTIVATE", not "suggest". Plan/map: memory/SKILL_ACTIVATION_PLAN_2026-06-15.md
SKILLS = [
    (r"reconcil|сверк|\brecon\b|reconcile\.ts|reconcileunified|recon\.tsx",
     "ACTIVATE finance:reconciliation — методика сверки расчёт↔официал (план/факт/экономия vs СВОД), категоризация reconciling-items, aging."),
    (r"эконом|отклонени|amount_dev|amount.?deviation|\bvariance\b|перерасч",
     "ACTIVATE finance:variance-analysis — декомпозиция отклонений (price/volume, rate/mix), пороги материальности, нарратив, waterfall."),
    (r"поставщик|supplier|\bvendor\b|концентрац|подвед|grbs-profile|master ?er",
     "ACTIVATE operations:vendor-review — концентрация/риск поставщиков (supplier_concentration). Ref OCDS: mtender aggregate_by_supplier / flag_single_bid_awards."),
    (r"сигнал|\bsignal|аномали|коррупц|дроблен|fraud|red.?flag|картел|collusion|integrity",
     "ACTIVATE operations:risk-assessment + data:statistical-analysis — построчный риск + аномалии (Benford/EWMA/z в anomaly.ts). Ref: auditcopilot (split-PO=дробление, round-dollar, dup-invoice), Tender-shield (cover-bids/gap-uniformity)."),
    (r"порог|threshold|антидемпинг|комплаенс|compliance|ст\.?\s?93|ст\.?\s?37|дроблени",
     "ACTIVATE operations:compliance-tracking — 44-ФЗ пороги/антидемпинг/дробление vs canon (44fz-domain.md, columns-canon legal-refs §13)."),
    (r"\bpg\b|postgres|миграц\w* бд|\bschema\b|drizzle|финмодел|data ?model",
     "ACTIVATE ag-data-analytics-database-architect + postgres-best-practices + sql-pro — модель/индексы/миграция."),
    (r"профил\w* данн|качество данн|data ?quality|\bqa\b|валидац\w* данн|explore.?data",
     "ACTIVATE data:explore-data + data:validate-data — профилирование + QA до показа."),
]

# slash command -> ("text", None) literal, or ("script", [cmd], tail) to execute on demand only.
RITUALS = {
    "close": "Close ritual: ml learn -> pnpm -r tsc --noEmit && pnpm -r test -> git commit логическими группами -> ml sync -> mark_chapter (если phase-граница) -> python scripts/daily_pulse.py -> обновить AEMR/10-Index/NOW.md.",
    "lint": "Lint ritual: vault/AEMR/00-Meta/Vault-Lint.md (Dataview: орфаны/пустые/без тегов) -> mulch search близких -> ml delete + ml record consolidated. Гайд: ~/.claude/skills/lint/SKILL.md.",
    "distill": "Distill (Karpathy Express): mulch search + scripts/semantic_search.py + canonical lookup -> синтез ≤500 слов, TL;DR ≤3 строки, 8 sources. Опц. в vault/AEMR/20-Knowledge/insights/. Гайд: ~/.claude/skills/distill/SKILL.md.",
}


def _has_cmd(prompt: str, cmd: str) -> bool:
    return re.search(rf"(?:^|\s)/{cmd}(?:\s|$)", prompt) is not None


def main() -> None:
    try:
        data = json.load(sys.stdin)
        prompt = (data.get("prompt") or "").strip()
    except Exception:
        return
    if not prompt:
        return

    low = prompt.lower()
    out: list[str] = []

    # Heavy scripts: ONLY on their explicit slash command (no longer every turn).
    if _has_cmd(prompt, "pulse"):
        out.append(_run(["python", "scripts/weekly_pulse.py"]))
    if _has_cmd(prompt, "supersede"):
        out.append(_run(["python", "scripts/archive_supersede.py"], tail=20))
    if _has_cmd(prompt, "telemetry"):
        out.append(_run(["python", "scripts/skill_telemetry.py"], tail=30))
    if _has_cmd(prompt, "graphify"):
        out.append(_run(
            ["python", "-c",
             "from graphify.watch import _rebuild_code; from pathlib import Path; _rebuild_code(Path('.'))"],
            tail=5))

    # Ritual reminders: only when the slash command is typed.
    for cmd, text in RITUALS.items():
        if _has_cmd(prompt, cmd):
            out.append(text)

    # Direction / suggestion atoms: only when the topic keyword appears.
    for rx, txt in ATOMS:
        if re.search(rx, low):
            out.append(txt)

    # Domain-skill auto-activation (finance/procurement/data/ops).
    for rx, txt in SKILLS:
        if re.search(rx, low):
            out.append(txt)

    blocks = [b.strip() for b in out if b and b.strip()]
    if blocks:
        sys.stdout.write("\n".join(blocks) + "\n")


if __name__ == "__main__":
    main()
