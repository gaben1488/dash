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
- Keep documentation factual. If a command, route, script, deploy path, or table is not present in the repo, do not document it as implemented.
- Prefer `@aemr/shared` constants and `@aemr/core` calculations over duplicating legal/procurement thresholds in UI or server code.
- Keep `docs/REVIEW.md` updated when security posture or verification commands change.

## Known Residual Work

- Reduce `any` usage after current lint error-gate is stable.
- Add a real browser login/session flow instead of localStorage API key bootstrap.
- Split the large web bundle with route-level/code-level dynamic imports.
