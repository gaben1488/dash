# AEMR — production deploy на VPS

Цель: запустить полный AEMR (web + Fastify API + SQLite) на VPS через docker compose.

## Быстрый старт

```bash
# на VPS (193.233.244.217), пользователь aemr
cd ~/dash/deploy
cp .env.production.example .env.production
nano .env.production  # заполнить Google credentials, AEMR_API_KEY, DOMAIN

docker compose -f docker-compose.yml --env-file .env.production up -d --build
```

## Архитектура

Три контейнера в одной сети `aemr`:

- **caddy** (80/443) — единый edge-proxy с автоматическим Let's Encrypt сертификатом, если задан реальный DOMAIN. Маршрутизирует `/api/*` → server, всё остальное → web.
- **web** — собранный Vite SPA, отдаётся встроенным Caddy на :80.
- **server** — Node 22 + Fastify + better-sqlite3. БД лежит в томе `server_data` (`/app/data/aemr.db`).

## Перенос локальной БД на VPS

С локального ноутбука:
```bash
# 1. остановить server-контейнер на VPS
ssh aemr@193.233.244.217 'cd ~/dash/deploy && docker compose stop server'

# 2. скопировать SQLite файл
scp packages/server/data/aemr.db aemr@193.233.244.217:/tmp/aemr.db

# 3. перенести в volume и запустить
ssh aemr@193.233.244.217 << 'EOF'
docker run --rm -v aemr_server_data:/data -v /tmp/aemr.db:/in/aemr.db alpine \
    sh -c 'cp /in/aemr.db /data/aemr.db && chown 1000:1000 /data/aemr.db'
cd ~/dash/deploy && docker compose start server
EOF
```

## Backup БД

Каждую ночь cron создаёт snapshot БД в `/var/backups/aemr/`, хранятся 7 дней.
Скрипт: `/usr/local/bin/aemr-backup.sh` (создаётся при первом деплое).

## Обновление кода

```bash
cd ~/dash
git pull origin main
cd deploy
docker compose --env-file .env.production up -d --build
```

Авто-deploy через GitHub Actions описан в `.github/workflows/deploy.yml` (отдельная задача).

## Проверка

```bash
curl http://193.233.244.217/                  # → 200 + HTML «СВОД»
curl http://193.233.244.217/api/health        # → 200 + JSON {"status":"ok",...}
docker compose logs -f server                 # streaming логов
docker compose ps                              # статус контейнеров
```
