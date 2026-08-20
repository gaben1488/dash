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
BASIC_AUTH_USER=aemr
BASIC_AUTH_HASH=<bcrypt-hash-with-doubled-dollar-signs>
```

`AEMR_API_KEY` обязателен в production. Сгенерировать:

```bash
openssl rand -base64 32
```

`BASIC_AUTH_HASH` — bcrypt-хэш пароля периметра:

```bash
docker run --rm -it caddy:2.10-alpine caddy hash-password
```

Каждый `$` в хэше удваивается до `$$`: docker compose подставляет переменные и
иначе съедает часть хэша — правильный пароль начинает давать 401.

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

## Домен и TLS

Пока `DOMAIN=:80`, стенд работает по открытому HTTP: пароль периметра идёт по
сети текстом, и перехватить его может любой на пути. Рабочий режим — домен.

Порядок перехода.

1. **DNS.** A-запись домена (например `aemr.example.ru`) указывает на IP этого
   сервера. Дождаться, пока запись разойдётся: `nslookup aemr.example.ru`
   должен отдавать нужный IP с чужой машины, а не только локально.
2. **Порты.** Наружу открыты 80 и 443. Порт 80 закрывать нельзя, даже когда
   заработает HTTPS: по нему идёт ACME-проверка Let's Encrypt при каждом
   продлении сертификата.
3. **`.env.production`.** Заменить строку режима:

   ```env
   DOMAIN=aemr.example.ru
   ```

4. **Перезапуск.** Из каталога `deploy/`:

   ```bash
   docker compose --env-file .env.production up -d
   ```

   Пересборка образов не нужна — меняется только конфигурация Caddy.

Если нужен и `www`, в переменную кладутся оба имени через запятую:
`DOMAIN=example.ru, www.example.ru` — Caddy выпустит сертификат на каждое.

Больше ничего настраивать не надо: авто-HTTPS включается от того, что адрес
сайта стал именем. Caddy сам получает сертификат, сам продлевает его и сам
поднимает редирект с HTTP на HTTPS. Сертификаты лежат в томе `caddy_data` и
переживают пересборку — том удалять нельзя, иначе повторные выпуски упрутся в
лимиты Let's Encrypt.

Проверка после перезапуска:

```bash
docker compose --env-file .env.production logs caddy | grep -i "certificate obtained"
curl -I http://aemr.example.ru/api/health          # ожидается 308 на https
curl -sI https://aemr.example.ru/api/health | head -n 12
```

В ответе по HTTPS обязаны присутствовать три заголовка:
`Strict-Transport-Security: max-age=31536000`, `X-Content-Type-Options: nosniff`,
`Referrer-Policy: no-referrer`. По HTTP первого из них нет и быть не должно —
браузер игнорирует HSTS, полученный по незащищённому соединению.

Синтаксис конфигурации можно проверить до перезапуска:

```bash
docker compose --env-file .env.production exec caddy \
  caddy validate --config /etc/caddy/Caddyfile
```

Если сертификат не выпускается, смотреть в этом порядке: домен резолвится не в
этот IP; порт 80 закрыт файрволом или занят другим процессом; домен упёрся в
недельный лимит Let's Encrypt (в логе Caddy — `too many certificates`).

Возврат к режиму без TLS — обратная замена `DOMAIN=:80` и тот же перезапуск.
Но браузеры, уже получившие HSTS, год будут ходить только по HTTPS: откат
после боевого запуска пользователям бесплатно не даётся.

## Обновление

```bash
git pull
cd deploy
docker compose --env-file .env.production up -d --build
```

## Откат

Реестр багов 09.07.2026: раньше вернуться было некуда — образы жили под одной
меткой `latest`, и сборка затирала единственный работающий. Теперь автоматический
выкат (`.github/workflows/ci.yml`) перед каждой сборкой помечает работающие образы
меткой `previous` и записывает слепок кода в `deploy/.last-known-good`.

```bash
sh /home/aemr/dash/deploy/rollback.sh
```

Скрипт возвращает образы предыдущей сборки, поднимает их **без пересборки** (иначе
собрался бы тот же сломанный код), откатывает рабочее дерево на запомненный слепок
и проверяет здоровье изнутри контейнера. Сломанные образы не выбрасываются — они
остаются под меткой `failed` для разбора. База данных живёт в томе `server_data`
и откатом не затрагивается.

Точка возврата появляется только после первого прошедшего выката: если
`aemr-server:previous` ещё нет, скрипт честно об этом говорит и ничего не делает.

Обновление руками (`git pull` + `up -d --build`) точку возврата НЕ создаёт —
поставьте метку сами, иначе откатываться будет не к чему:

```bash
git -C /home/aemr/dash rev-parse HEAD > /home/aemr/dash/deploy/.last-known-good
for img in aemr-server aemr-web; do docker tag "$img:latest" "$img:previous"; done
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
