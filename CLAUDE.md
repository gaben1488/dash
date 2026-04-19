# AEMR — Project Instructions for Claude

> Generic rules: see `~/.claude/CLAUDE.md`; this file — AEMR-specific only.
> Conventions (brainstorm, multi-dim UI, KB tooltip, smart cards, 12 personas, min-patches) — в `memory/PROCEDURE.md` и `feedback_*.md`. Skill ранжирование — в `memory/AEMR_TOOLKIT_REGISTRY.md`. Текущий шаг — `AEMR/10-Index/NOW.md` в vault.

## 1. Автоматизация (справка, не правило)

Хуки в `.claude/settings.json`:
- **SessionStart** → `mulch prime` + `UNIFIED_MECHANISM.md` head 80 + `PROCEDURE.md` head 60 + `AEMR/10-Index/NOW.md` (full).
- **PreCompact** → `mulch prime` + `ml sync` (авто-коммит `.mulch/`).
- **PreToolUse Glob|Grep** → «читай `graphify-out/GRAPH_REPORT.md` сначала» (skip на `node_modules/`, `dist/`, `.next/`, `artifacts/raw/`).
- **PostToolUse Edit/Write** → `pnpm -s tsc --noEmit` + path-specific skill hints (UI tsx / KB copy / SQL).
- **Stop** → graphify rebuild если менялись `packages/**/*.{ts,tsx}` + напоминание `ml sync` если `.mulch/` изменён.
- **UserPromptSubmit** — slash (`/pulse`, `/graphify`, `/supersede`, `/telemetry`, `/close`) + direction hints (UI, Trust, Migration, Swarm).

## 2. Инварианты AEMR (не меняются без ADR)

1. **Строка = atom**: `dept × sub × method × activity × budget × period`. `exec_count_pct` = главный KPI (по штукам, не только по суммам).
2. **Apple-style filters**: multi-select, `identity("Все") = no filter`, immediate (no «Apply» button).
3. **Vault canonical path**: `C:/Users/filat/Documents/Obsidian/delete not delete/` — корень, `AEMR/` — подпапка. **Никогда** не создавать вложенный `.obsidian/`. См. [ADR-0003](C:/Users/filat/Documents/Obsidian/delete not delete/AEMR/30-Decisions/2026-04-19-adr-vault-canonical-path.md).
4. **Три memory-store роли** (см. `memory/UNIFIED_MECHANISM.md` §1.3): vault = user-facing canonical; `memory/` = Claude scratch desk; mulch = sticky-note reflex.
5. **Screen target**: 1240×480 compact UI (см. `memory/user_screen_resolution.md`).

## 3. Project-specific enforceable (AEMR)

| # | Правило | Проверка |
|---|---------|----------|
| R3 | Новый `feedback_*.md` → `verified: true/false` в frontmatter, в issue-tracker или PR | Manual; pulse сигнал `fb_to_rule` считает. |
| R4 | Каждая Ф-phase close → `mark_chapter` | Manual; `/close` ritual напоминает. |
| R5 | `ml record` каждый значимый инсайт **внутри** турна, не в конце | Stop-hook напоминает если `.mulch/` не трогали. |

> Generic R1 (tsc+test green), R2 (`ml sync` в конце), R6 (стиль), R7 (`mulch search` перед `ml record`) — см. `~/.claude/CLAUDE.md`.

## 4. Активные планы (single-pointer)

**Читать в порядке:**
1. **`AEMR/10-Index/NOW.md`** (в vault) — где мы сейчас + next step + blockers. **Обновляется каждой сессией.**
2. `memory/FINAL_MASTER_ROADMAP.md` — 11 фаз до production.
3. `memory/LIVING_SYSTEM_V3_PRODUCT_PLAN.md` — инфраструктура (Sprint 0 done, 1-2 pending).
4. `memory/rustling-sniffing-lobster.md` — UI Ф4-Ф8 детализация.

Текущий блокер = см. `NOW.md`.

## 5. Слеш-команды

| Slash | Файл / Skill | Что делает |
|-------|---|---|
| `/pulse` | `scripts/daily_pulse.py` | пишет `vault/50-Workflow/daily/` + `memory/daily-pulse/` |
| `/graphify` | rebuild `graphify-out/` | knowledge graph код |
| `/supersede` | `scripts/archive_supersede.py` | dry-run; apply вручную |
| `/telemetry` | `scripts/skill_telemetry.py` | skills+mcp usage за N дней |
| `/distill <topic>` | `~/.claude/skills/distill/SKILL.md` | дистилляция темы из vault+memory+mulch (Express stage Karpathy LLM-Wiki) |
| `/lint` | `~/.claude/skills/lint/SKILL.md` | health-check vault: орфаны, противоречия mulch, stale dates (Karpathy Lint operation) |
| `/close` | ritual | ml learn → tsc+test → commit → ml sync → mark_chapter → pulse → update NOW.md |

**Hybrid поиск (после Карпатого / VaultSearch стандарта)**: `python scripts/semantic_search.py "<query>"` — BM25 × векторы × RRF (k=60), мультиязычная модель `paraphrase-multilingual-MiniLM-L12-v2`. Использовать когда grep/wikilink не справляются. `--bm25-only` для точных терминов, `--vector-only` для смысла. Перед первым запуском: `pip install sentence-transformers numpy rank-bm25` + `--reindex`.

**Vault-spec для AI-агентов**: `vault/AEMR/00-Meta/CLAUDE-VAULT.md` (3-слойная архитектура raw/wiki/spec по Karpathy). Lint-queries: `vault/AEMR/00-Meta/Vault-Lint.md`.

## 6. Skills/MCP (краткий регистр; полный — `memory/REGISTRIES.md` Часть I)

**P0 каждая сессия:** `graphify`, `ag-essentials-lint-and-validate`, `ag-essentials-systematic-debugging`, `update-config`.

**P1 по направлению** (см. hooks auto-inject):
- UI → `ag-full-stack-developer-frontend-developer`, `ag-apple-platform-design-hig-patterns`, `impeccable-polish` (near-ship).
- Trust → `finance:reconciliation`.
- Migration → `postgres`, `ag-data-analytics-database-architect`.
- KB copy → `design:ux-copy` + `humanizer`.
- ADR → `ag-architecture-design-architecture-decision-records`.

**Skip:** все `sales:*`, `brand-voice:*`, `stripe-integration`, iOS HIG, `operations:vendor/capacity/compliance-tracking`.

## 7. Evolution

`CLAUDE.md` меняется только если:
- появилось новое auto-check правило (добавить в §3 с проверкой).
- изменились инварианты (§2) через ADR.
- новый slash-command (§5).
- новая direction в hooks (§1 → settings.json).

**Декоративное/принципиальное** → не сюда, в `memory/PROCESS.md` или `memory/FEEDBACK.md`. Правило: если нельзя написать «auto-check: ...» — это не enforceable rule, это convention.
