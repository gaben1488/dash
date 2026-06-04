# AEMR Production Deploy

Канонический production stack: Docker Compose с тремя контейнерами.

- `caddy`: edge proxy на 80/443, gzip, optional Let's Encrypt.
- `web`: собранная Vite SPA, отдаётся Caddy внутри контейнера.
- `server`: Node 22 + Fastify + SQLite. Данные лежат в volume `server_data`.

## Подготовка

```bash
cd deploy
cp .env.production.example .env.production
```

Заполните `.env.production`:

```env
NODE_ENV=production
HOST=0.0.0.0
PORT=3000
LOG_LEVEL=info
SQLITE_PATH=/app/packages/server/data/aemr.db
AEMR_API_KEY=<strong-random-key>
GOOGLE_SHEETS_SPREADSHEET_ID=<spreadsheet-id>
GOOGLE_SERVICE_ACCOUNT_EMAIL=<service-account-email>
GOOGLE_PRIVATE_KEY=<private-key-with-\n-or-real-newlines>
DOMAIN=:80
```

`AEMR_API_KEY` обязателен в production. Сгенерировать:

```bash
openssl rand -base64 32
```

## Запуск

Из каталога `deploy/`:

```bash
docker compose --env-file .env.production up -d --build
```

Из корня репозитория:

```bash
docker compose -f deploy/docker-compose.yml --env-file deploy/.env.production up -d --build
```

## Проверка

```bash
docker compose --env-file .env.production ps
docker compose --env-file .env.production logs -f server
curl http://127.0.0.1/api/health
```

Health endpoint публичный и должен вернуть JSON вида:

```json
{"status":"ok","service":"aemr-server","timestamp":"..."}
```

Остальные `/api/*` требуют:

```bash
curl -H "Authorization: Bearer $AEMR_API_KEY" http://127.0.0.1/api/dashboard
```

## Обновление

```bash
git pull
cd deploy
docker compose --env-file .env.production up -d --build
```

## SQLite Backup

В репозитории нет автоматического cron backup. Делайте backup volume явно:

```bash
docker run --rm \
  -v aemr_server_data:/data:ro \
  -v "$PWD":/backup \
  alpine sh -c 'cp /data/aemr.db /backup/aemr-db-$(date +%F-%H%M%S).db'
```

Restore:

```bash
docker compose --env-file .env.production stop server
docker run --rm \
  -v aemr_server_data:/data \
  -v "$PWD":/backup \
  alpine sh -c 'cp /backup/aemr.db /data/aemr.db && chown 1000:1000 /data/aemr.db'
docker compose --env-file .env.production start server
```

## Web Auth Bootstrap

Пока полноценного login-flow нет, web client берёт API key из browser localStorage:

```js
localStorage.setItem('aemr_api_key', '<same-key-as-AEMR_API_KEY>')
```

Это MLP-режим для внутреннего контура. Для публичного доступа нужен отдельный login/session слой.
