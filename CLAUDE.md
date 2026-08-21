# AEMR Agent Notes

Этот файл содержит только проверяемые правила работы с репозиторием. Внешние vault/memory ссылки не являются частью проекта.

## Canonical Commands

```bash
pnpm lint
pnpm typecheck
pnpm -r test
pnpm build
pnpm audit --audit-level moderate
```

Перед заявлением "готово" нужно выполнить релевантный набор команд и явно назвать результат.

## Project Facts

- Monorepo: `shared`, `core`, `server`, `web`.
- Runtime server: Fastify, Node 22, TypeScript ESM.
- Runtime web: React 19 + Vite 6.
- Current database implementation: SQLite through `better-sqlite3` and Drizzle schema.
- Production deploy: `deploy/docker-compose.yml`, not root-level Docker files.
- Production auth: `AEMR_API_KEY` is required; `/api/health` is public; other `/api/*` routes require `Authorization: Bearer <key>`.
- Google Sheets IDs are configured in code defaults and can be overridden through env/config; credentials must never be committed.

## Editing Rules

- Do not commit generated build info: `*.tsbuildinfo`.
- Do not put secrets, service account JSON, SQLite DB files, reports, graph outputs, or local agent artifacts into git.
  - Единственное исключение, разрешённое владельцем 29.07.2026: выжимки недель
    `packages/core/src/report/__fixtures__/week-*.json` для регресса «расчёт против ручного
    отчёта». Проверены: плановые строки закупок, без ключей и персональных данных. Новые
    фикстуры того же вида добавлять можно; любые другие отчёты в git по-прежнему нельзя.
- Keep documentation factual. If a command, route, script, deploy path, or table is not present in the repo, do not document it as implemented.
- Prefer `@aemr/shared` constants and `@aemr/core` calculations over duplicating legal/procurement thresholds in UI or server code.
- Keep `docs/REVIEW.md` updated when security posture or verification commands change.
- Определение готовности карточки — `docs/superpowers/specs/2026-08-21-card-done-definition.md`
  (канон пп. 53, 58, 104, 119, 127, 129, 131, 132, 135, 139). Любая работа над
  экраном читает этот список ДО начала и предъявляется по нему. Частично
  выполненный список не считается: карточка либо доведена, либо нет.
- Атлас продукта `docs/superpowers/audits/2026-08-20-cards-map/` — живой артефакт
  (требование владельца 20.08.2026): любая волна, меняющая UI вкладки, обязана
  обновить карту этой вкладки (инвентарь карточек, источники цифр до файла:строки,
  навигация и интерактив, вердикты по канону). Карта, разошедшаяся с кодом, хуже
  отсутствующей — при правке экрана без обновления карты волна не считается завершённой.

## Tooling Routing (триггер → скилл)

| Триггер в задаче | Скилл |
|---|---|
| `packages/server/src/**` — роуты, плагины, hooks, JSON-schema, pino, WebSocket, `inject`-тесты | `fastify-best-practices` |
| `any`, generics, type guards, ошибки `tsc --noEmit`, брендированные типы | `typescript-magician` |
| docs/API любой библиотеки (drizzle, better-sqlite3, googleapis, React 19, Vite) | Context7 MCP — не по памяти |
| UI: править/оценивать/полировать экран, дашборд, таблицу | `impeccable-shape` → `impeccable-craft` → `impeccable-audit` |
| React-перф, ре-рендеры, бандл | `vercel-react-best-practices` |
| Баг, падающий тест, необъяснимое поведение | `systematic-debugging` → `test-driven-development` |
| Разрез god-файла (>600 LOC) | `test-driven-development` (характеризационные тесты) → `simplify` |
| Перед «готово» | `verification-before-completion` + Canonical Commands |
| `.xlsx` / `.docx` / `.pdf` | `anthropic-skills:xlsx` / `:docx` / `:pdf` — до своего кода |

## Known Residual Work

- Reduce `any` usage after current lint error-gate is stable.
- Add a real browser login/session flow instead of localStorage API key bootstrap.
- Split the large web bundle with route-level/code-level dynamic imports.
