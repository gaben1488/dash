# Уточнение действующей модели доступа — 2026-10-10

Это датированная добавка к историческому документу ниже, **не аудит penetration test**. В `packages/server/src/middleware/auth.ts` обычный закрытый API использует общий Bearer key; Caddy может ставить его за общим Basic Auth (см. `deploy/Caddyfile`). Публичный `AEMR_PUBLIC_READONLY=true` открывает чтение, но запрещает мутации за исключением ограниченных диагностических POST. Поэтому утверждение старого документа «единственный публичный API — health» не универсально: также есть секретный Drive-webhook, и отдельный публичный read-only режим.

`registerHeavyRouteRateLimit` подключён в `packages/server/src/app.ts`, поэтому старое «rate limiting отсутствует» уже неверно в буквальном виде. **Персональной role/actor-проверки для официальной рекомендации нет** (DASH-006); существующий read-only не является её заменой. Опция `DOMAIN=:80` — документированный отладочный режим без TLS, но текущую боевую конфигурацию этот аудит не читал (DASH-017). Проверка исходников: [верифицированный аудит](superpowers/audits/2026-10-10-dash-code-review-verified/README.md).

---

> Далее исторический snapshot безопасности от июня 2026; приведённые ниже пункты про публичные пути, лимиты и зависимости не считать текущими без проверки.

# Security

Last reviewed: 2026-06-04.

## Current Controls

- Production fails closed without `AEMR_API_KEY`.
- `/api/health` is the only public API route.
- Protected API routes require `Authorization: Bearer <AEMR_API_KEY>`.
- Token comparison uses `crypto.timingSafeEqual`.
- `/api/debug/sheets` is not registered in production.
- Health response does not expose spreadsheet IDs, service account status or auth state.
- `.env`, production env files, service account JSON and SQLite data files are ignored by git.
- Dependency audit passes at moderate severity threshold.

## Secrets

Do not commit:

- `.env`
- `deploy/.env.production`
- Google service account JSON
- SQLite DB files
- generated reports or local agent artifacts

Google Sheets access should use a service account with the minimum required spreadsheet permissions.

## Auth Model

This is an MLP internal auth model. It protects API routes with one shared API key. The web client reads that key from `localStorage.aemr_api_key`.

Known limitations:

- no per-user login
- no role-based authorization
- no server-side sessions
- localStorage token storage is vulnerable if an XSS bug is introduced
- no rate limiting

For public or multi-user deployment, add a real login/session layer before exposing the app broadly.

## Production Checklist

- `NODE_ENV=production`
- strong `AEMR_API_KEY`
- HTTPS domain through Caddy when not limited to a private network
- service account has only required spreadsheet access
- `SQLITE_PATH=/app/packages/server/data/aemr.db`
- regular SQLite backups
- no debug route visible: `/api/debug/sheets` should return 404 in production

## Verification Commands

```bash
pnpm lint
pnpm typecheck
pnpm -r test
pnpm build
pnpm audit --audit-level moderate
```
