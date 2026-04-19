# AEMR — Project Instructions for Claude

> **Что здесь.** Только то, что (a) автоматически проверяется хуками или (b) неизменные инварианты проекта. Всё прочее — в `memory/PROCEDURE.md` (conventions), `memory/AEMR_TOOLKIT_REGISTRY.md` (skill ранжирование), `AEMR/10-Index/NOW.md` в vault (текущий шаг).

## 1. Автоматизация (справка, не правило)

Хуки в `.claude/settings.json`:
- **SessionStart** → `mulch prime` + `UNIFIED_MECHANISM.md` head 80 + `PROCEDURE.md` head 60 + `AEMR/10-Index/NOW.md` (full)
- **PreCompact** → `mulch prime` + `ml sync` (авто-коммит `.mulch/`)
- **PreToolUse Glob|Grep** → «читай `graphify-out/GRAPH_REPORT.md` сначала» (skip на `node_modules/`, `dist/`, `.next/`, `artifacts/raw/`)
- **PostToolUse Edit/Write** → `pnpm -s tsc --noEmit` + path-specific skill hints (UI tsx / KB copy / SQL)
- **Stop** → graphify rebuild если менялись `packages/**/*.{ts,tsx}` + напоминание `ml sync` если `.mulch/` изменён
- **UserPromptSubmit** — 9 матчеров: 4 slash (`/pulse`, `/graphify`, `/supersede`, `/telemetry`) + `/close` + 4 direction (UI, Trust, Migration, Swarm)

## 2. Инварианты (не меняются без ADR)

1. **Строка = atom**: `dept × sub × method × activity × budget × period`. `exec_count_pct` = главный KPI (по штукам, не только по суммам).
2. **Apple-style filters**: multi-select, `identity("Все") = no filter`, immediate (no «Apply» button).
3. **Vault canonical path**: `C:/Users/filat/Documents/Obsidian/delete not delete/` — корень, `AEMR/` — подпапка. **Никогда** не создавать вложенный `.obsidian/`. См. [ADR-0003](C:/Users/filat/Documents/Obsidian/delete not delete/AEMR/30-Decisions/2026-04-19-adr-vault-canonical-path.md).
4. **Три memory-store роли** (см. `memory/UNIFIED_MECHANISM.md` §1.3): vault = user-facing canonical; `memory/` = Claude scratch desk; mulch = sticky-note reflex.
5. **Screen target**: 1240×480 compact UI (см. `memory/user_screen_resolution.md`).

## 3. Enforceable правила (обязательно, с auto-check)

| # | Правило | Проверка |
|---|---------|----------|
| R1 | Перед commit кода → `pnpm tsc --noEmit && pnpm test` green | PostToolUse tsc hook auto; test — ручной. TODO: pre-commit hook. |
| R2 | Конец сессии без `ml sync` = недопустимо | PreCompact авто-делает `ml sync`. `/close` ritual напоминает. |
| R3 | Новый `feedback_*.md` → `verified: true/false` в frontmatter, в issue-tracker или PR | Manual; pulse сигнал `fb_to_rule` считает. |
| R4 | Каждая Ф-phase close → `mark_chapter` | Manual; `/close` ritual напоминает. |
| R5 | `ml record` каждый значимый инсайт **внутри** турна, не в конце | Stop-hook напоминает если `.mulch/` не трогали. |
| R6 | **Стиль ответов**: литературный русский, связная проза. Английские термины (API, hook, skill, schema) раскрываются в скобках при первом упоминании. Таблицы только для сравнения по нескольким осям (2+ колонок данных), не для статусов. Эмодзи только функциональные (🟢🔴 в pulse), не декоративные. Перед финализацией длинного ответа (>500 слов) — мысленно применить skill `humanizer` (убрать em-dash abuse, parallel structure в тройках, hedging «it's worth noting»). См. mulch `mx-9185e2` + `feedback_kb_tooltip_russian_literary.md`. | Manual; при жалобе пользователя на стиль — немедленный рефакторинг. |
| R7 | **`mulch search <тема>` ПЕРЕД `ml record`**. Если найдена близкая запись — расширить/supersede, не дублировать. Без этого — противоречия в мулче плодятся невидимо (как `mx-abfa44` vs `mx-ccaa11`). | Manual для `ml record`; TODO: `ml record --check-duplicates` на стороне CLI. |

## 4. Активные планы (single-pointer)

**Читать в порядке:**
1. **`AEMR/10-Index/NOW.md`** (в vault) — где мы сейчас + next step + blockers. **Обновляется каждой сессией.**
2. `memory/FINAL_MASTER_ROADMAP.md` — 11 фаз до production.
3. `memory/LIVING_SYSTEM_V3_PRODUCT_PLAN.md` — инфраструктура (Sprint 0 done, 1-2 pending).
4. `memory/rustling-sniffing-lobster.md` — UI Ф4-Ф8 детализация.

Текущий блокер = см. `NOW.md`.

## 5. Слеш-команды

| Slash | Файл |
|-------|------|
| `/pulse` | `scripts/daily_pulse.py` — пишет `vault/50-Workflow/daily/` + `memory/daily-pulse/` |
| `/graphify` | rebuild `graphify-out/` |
| `/supersede` | `scripts/archive_supersede.py` — dry-run; apply вручную |
| `/telemetry` | `scripts/skill_telemetry.py` — skills+mcp usage за N дней |
| `/close` | ritual (ml learn → tsc+test → commit → ml sync → mark_chapter → pulse → update NOW.md) |

## 6. Conventions → see `memory/PROCEDURE.md`

Вынесено:
- Brainstorm на содержательные вопросы (5+ гипотез + swarm) → `memory/PROCEDURE.md §3.a`
- Multi-dimensional UI (KB tooltip, δ, budget breakdown, dept hierarchy) → `memory/design_multidimensionality.md`
- KB tooltip 10-block русский литературный → `memory/feedback_kb_tooltip_russian_literary.md`
- Min patches, fix whole chain → `memory/feedback_no_patches.md`
- 12 персон per screen → `memory/feedback_karpathy_methodology.md`
- Smart cards vs drill-down → `memory/design_smart_cards_system.md`
- Direction loadouts → `memory/loadouts/*.yaml` (stubs существуют, контент pending Sprint 1 v3)

## 7. Skills/MCP (краткий регистр; полный — `memory/AEMR_TOOLKIT_REGISTRY.md`)

**P0 каждая сессия:** `graphify`, `ag-essentials-lint-and-validate`, `ag-essentials-systematic-debugging`, `update-config`.

**P1 по направлению** (см. hooks auto-inject):
- UI → `ag-full-stack-developer-frontend-developer`, `ag-apple-platform-design-hig-patterns`, `impeccable-polish` (near-ship)
- Trust → `finance:reconciliation`
- Migration → `postgres`, `ag-data-analytics-database-architect`
- KB copy → `design:ux-copy` + `humanizer`
- ADR → `ag-architecture-design-architecture-decision-records`

**Skip:** все `sales:*`, `brand-voice:*`, `stripe-integration`, iOS HIG, `operations:vendor/capacity/compliance-tracking`.

## 8. Evolution — как обновлять этот файл

`CLAUDE.md` меняется только если:
- появилось новое auto-check правило (добавить в §3 с проверкой)
- изменились инварианты (§2) через ADR
- новый slash-command (§5)
- новая direction в hooks (§1 → settings.json)

**Декоративное/принципиальное** → не сюда, в `memory/PROCEDURE.md` или `feedback_*.md`. Правило: если нельзя написать «auto-check: ...» — это не enforceable rule, это convention.
