# AEMR Platform

BI-платформа мониторинга закупочной деятельности Елизовского муниципального района.

Проект читает Google Sheets, нормализует закупочные строки, считает KPI, сигналы, сверки и индекс доверия к данным, затем отдаёт Fastify API и React/Vite интерфейс.

Last verified: 2026-06-14.

## Состав

```text
packages/
  shared/   типы, константы, справочники, rule book
  core/     ingest/normalize/validate/reconcile/trust/analytics
  server/   Fastify API, Google Sheets, SQLite/Drizzle, auth middleware
  web/      React 19, Vite 6, Zustand, Recharts, Tailwind
deploy/     production docker compose: Caddy + web + server
docs/       архитектура, эксплуатация, security/review
```

## Требования

- Node.js 22+
- pnpm 10.33.0
- Google service account с доступом к нужным таблицам

## Быстрый старт

```bash
pnpm install
cp .env.example .env
pnpm dev
```

Откройте:

- Web: http://localhost:5173
- API health: http://localhost:3000/api/health

В development `AEMR_API_KEY` можно не задавать. Если ключ задан, web отправляет его из `localStorage.aemr_api_key`:

```js
localStorage.setItem('aemr_api_key', 'your-key')
```

## Environment

Минимальный `.env`:

```env
NODE_ENV=development
HOST=0.0.0.0
PORT=3000
LOG_LEVEL=info

GOOGLE_SHEETS_SPREADSHEET_ID=
GOOGLE_SERVICE_ACCOUNT_EMAIL=
GOOGLE_PRIVATE_KEY=
GOOGLE_API_KEY=

SQLITE_PATH=./data/aemr.db
CACHE_TTL_SECONDS=300
AEMR_API_KEY=
```

`GOOGLE_PRIVATE_KEY` можно хранить как JSON-style строку с `\n`; сервер преобразует её в реальные переносы строк.

## Команды

```bash
pnpm lint                         # ESLint по packages/**/*.{ts,tsx}
pnpm typecheck                    # tsc --noEmit во всех пакетах
pnpm -r test                      # Vitest
pnpm build                        # server + web production build
pnpm audit --audit-level moderate # dependency security audit
```

Текущий локальный результат проверки 2026-06-14:

- `pnpm lint` проходит; остаются предупреждения по `any`, не ошибки.
- `pnpm typecheck` проходит.
- `pnpm -r test` проходит: shared 72, core 720, server 18, web 25.
- `pnpm build` проходит; Vite предупреждает о web chunk около 1.36 MB.
- `pnpm audit --audit-level moderate` проходит; Deno-only advisory для esbuild
  исключён с обоснованием в [docs/REVIEW.md](docs/REVIEW.md).

## Production

Канонический production stack находится в `deploy/`: Caddy edge, отдельный web container и server container с persisted SQLite volume.

```bash
cd deploy
cp .env.production.example .env.production
# заполнить GOOGLE_*, AEMR_API_KEY, DOMAIN
docker compose --env-file .env.production up -d --build
```

Подробно: [deploy/README.md](deploy/README.md).

## Документация

- [AGENTS.md](AGENTS.md) — правила для агентов: лестница ponytail + инварианты AEMR.
- [docs/PLAN.md](docs/PLAN.md) — цель, контрольный список покрытия отчёта, порядок работ, уход от таблиц.
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — слои, данные, API, runtime flow.
- [docs/DATA_SOURCES.md](docs/DATA_SOURCES.md) — боевые Google Sheets, архивы, копии и запреты для production ingest.
- [docs/METRICS_CONTRACT.md](docs/METRICS_CONTRACT.md) — трассировка KPI от колонок Google Sheets до DTO и UI.
- [docs/RUNBOOK.md](docs/RUNBOOK.md) — запуск, проверка, обновление, backup/restore.
- [docs/SECURITY.md](docs/SECURITY.md) — auth, secrets, production security notes.
- [docs/REVIEW.md](docs/REVIEW.md) — code/security review status и оставшиеся риски.

## Статус MLP

Проект готов к локальному запуску и production сборке. Критичные production-условия:

- В production обязательно задать `AEMR_API_KEY`; без него server не стартует.
- SQLite путь в production должен указывать на mounted volume: `/app/packages/server/data/aemr.db`.
- Google service account должен иметь доступ на чтение к таблицам.
- Для защищённого web-доступа оператор должен сохранить API key в `localStorage.aemr_api_key` до появления полноценного login-flow.
