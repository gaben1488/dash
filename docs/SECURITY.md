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
