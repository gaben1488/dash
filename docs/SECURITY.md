# Доступ и защита данных

Режимы ниже сверены по `packages/server/src/middleware/auth.ts`,
`packages/web/src/api.ts` и `deploy/Caddyfile` 19.10.2026. Это чтение кода,
не новое обследование установленного production и не penetration test.
Текущий runtime/проверки — [PLAN](PLAN.md#current-execution), процедуры —
[RUNBOOK](RUNBOOK.md), ограничения публикации — [AGENTS](../AGENTS.md).

| Контур | Исполняемое правило |
|---|---|
| Защищённый API | Вне явно заданных development/test требуется `AEMR_API_KEY`; закрытые `/api/*` проверяют Bearer |
| Production-браузер через штатный Caddy | Basic Auth на edge; Caddy добавляет серверный Bearer. JSON-клиент в production не отправляет localStorage-ключ |
| Локальный development/test | Может работать без ключа; при заданном ключе клиент использует `localStorage.aemr_api_key` |
| `AEMR_PUBLIC_READONLY=true` | Отдельный публичный режим чтения, не требующий общего ключа; мутации запрещены, кроме явно разрешённых проверочных/refresh POST в middleware |
| Публичные исключения | `/api/health`; Drive-webhook проверяет свой секрет канала и не становится незащищённой записью |

Это общий доступ к сервису, а не персональная role/actor-модель. Заявленные
в PRODUCT роли нельзя считать реализованной изоляцией организаций. Правила
JSON/SSE/скачиваний проверяются вместе при изменении auth; таблица выше не
объявляет завершённым их целевое объединение. TLS требует реальной доменной
конфигурации; `DOMAIN=:80` — только отладка без защищённой передачи пароля.

`registerHeavyRouteRateLimit` подключён в `packages/server/src/app.ts`;
старое утверждение «rate limiting отсутствует» ниже относится к июньскому срезу.
Общий лимит не заменяет проверки прав. Исторические security findings и границы
подтверждения — [верифицированный аудит 10.10](superpowers/audits/2026-10-10-dash-code-review-verified/README.md).

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
