# Multi-agent workflow (Claude × N + Codex)

Конвенции для параллельной работы нескольких агентов над AEMR без клобберинга.
Выведены аудитом дерева 2026-06-14 (workflow `tree-branches-cleanup-audit`).

## Топология

- **`main` — интеграционная, только через PR.** Агенты НИКОГДА не коммитят и не
  пушат напрямую в `main` (исключение — `ml sync` mulch-данных). Продвигается
  только review-мёрджем PR. После каждого мёрджа primary-checkout делает
  `git fetch origin && git branch -f main origin/main`, чтобы локальный `main`
  не отставал (отставание на 200+ коммитов — ровно та проблема, что это правит).
- **Primary checkout** `C:/Users/filat/dash` владеет `main` и держит локальные
  машинно-специфичные артефакты (`.claude/`, `memory/`, `scripts/*.py`-хуки).
- **Один агент = одна ветка = один worktree = один PR.** Агенты не делят ветку.

## Worktrees

- Плоские сиблинги под одним родителем: `C:/Users/filat/dash-wt/<agent>/`
  (`dash-wt/claude-a`, `dash-wt/claude-b`, `dash-wt/codex`).
- **Никогда не вложенные в репозиторий** (антипаттерн `.claude/worktrees/…`
  путал status/ignore родителя) и не разбросанные по `C:/tmp` + домашней папке.
- Создание: `git worktree add C:/Users/filat/dash-wt/claude-a -b claude/<topic> origin/main`.

## Ветки

- Имя = `claude/<topic>` или `codex/<topic>` (namespace по агенту).
- Перед PR: `git fetch origin && git rebase origin/main` (внутри своего worktree).
- После мёрджа PR — ветка и её worktree удаляются.

## Изоляция (что НЕ делить между агентами)

- **Грязное/untracked-состояние не делится.** Никаких cross-worktree
  `stash pop/apply`, никаких коммитов чужого WIP. `refs/stash` — один общий ref на
  все worktrees, поэтому стэши между агентами не использовать (брать свой worktree).
- Каждый worktree имеет свой HEAD+index — конфликтов индекса между агентами нет.

## Каналы данных

- **`.mulch/` — tracked (НЕ gitignored): общий канал экспертизы.** `ml sync`
  стейджит+коммитит mulch-записи; на rebase они доезжают до всех worktrees.
  (Сообщение «mulch is gitignored» от инструмента — ложное, проверено.)
- **`memory/`, `.claude/`, `reports/`, `*.db`/`*.sqlite` — gitignored, per-machine.**
  Никогда не коммитить память агента, отчёты, планы, локальные БД в общий репо
  (см. CLAUDE.md → Editing Rules).

## Гейт перед коммитом

`pnpm lint && pnpm -r tsc --noEmit && pnpm -r test` зелёные (для Python — `ruff + pytest`).
Локальный server-tsc может упереться в RAM при нескольких параллельных агентах →
гнать последовательно: `pnpm -r --workspace-concurrency=1 exec tsc --noEmit`, либо
поднять Windows page-file до 16 ГБ.
