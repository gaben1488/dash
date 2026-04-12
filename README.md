# АЕМР Аналитика

BI-платформа непрерывного мониторинга закупочной деятельности Елизовского муниципального района.

8 управлений (ГРБС) | ~2500+ строк закупок | 9 Google Таблиц | Реальное время

---

## Быстрый старт (разработка)

### Предварительные требования

- **Node.js** 20+ ([nodejs.org](https://nodejs.org))
- **pnpm** 9+ (`npm i -g pnpm`)
- **Google Cloud** сервисный аккаунт с доступом к таблицам

### 1. Установка зависимостей

```bash
cd C:/Users/filat/dash   # или ваш путь к проекту
pnpm install
```

### 2. Настройка окружения

Создайте файл `.env` в корне проекта:

```env
# Google Sheets API
GOOGLE_SHEETS_SPREADSHEET_ID=1i692JdP-FqWMSfVgBjTmDCoUakacbJpZMq9tJhQlRhg
GOOGLE_SERVICE_ACCOUNT_EMAIL=your-service-account@project.iam.gserviceaccount.com
GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nВаш_приватный_ключ\n-----END PRIVATE KEY-----"

# Сервер
PORT=3000
HOST=0.0.0.0
LOG_LEVEL=info

# База данных
SQLITE_PATH=./data/aemr.db
# DB_PROVIDER=postgresql          # для продакшена
# DATABASE_URL=postgresql://...   # для продакшена
```

**Как получить Google credentials:**

1. Перейдите в [Google Cloud Console](https://console.cloud.google.com)
2. Создайте проект (или используйте существующий)
3. Включите **Google Sheets API** (`APIs & Services` → `Enable APIs`)
4. Создайте **Service Account** (`IAM & Admin` → `Service Accounts`)
5. Создайте ключ ��ля сервисного аккаунта (формат JSON)
6. Из JSON файла скопируйте `client_email` и `private_key` в `.env`
7. **Откройте каждую таблицу** в Google Sheets и расшарьте на `client_email` (права: Viewer)

### 3. Сборка и запуск

```bash
# Собрать shared и core (нужно перед первым запуском)
pnpm --filter @aemr/shared build
pnpm --filter @aemr/core build

# Запустить бэкенд (терминал 1)
pnpm --filter @aemr/server dev

# Запустить фронтенд (терминал 2)
pnpm --filter @aemr/web dev
```

Откройте в браузере:
- **Фронтенд**: http://localhost:5173
- **API**: http://localhost:3000/api/dashboard

### 4. Проверка работоспособности

```bash
# Проверка типов
pnpm typecheck

# Полная сборка
pnpm build

# Health check API
curl http://localhost:3000/api/health
```

---

## Деплой на сервер (продакшен)

### Вариант 1: PM2 + Nginx (рекомендуется)

```bash
# 1. Подготовка сервера (Ubuntu/Debian)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs git nginx
npm i -g pnpm pm2

# 2. Клонирование и сборка
git clone <repo-url> /opt/aemr
cd /opt/aemr
pnpm install --frozen-lockfile
pnpm build

# 3. Настройка окружения
cp .env.example .env
nano .env   # заполните Google credentials

# Для продакшена рекомендуется PostgreSQL:
# DB_PROVIDER=postgresql
# DATABASE_URL=postgresql://user:pass@localhost:5432/aemr

# 4. Запуск через PM2
pm2 start packages/server/dist/index.js --name aemr-server
pm2 save
pm2 startup   # автозапуск при перезагрузке

# 5. Настройка Nginx
sudo tee /etc/nginx/sites-available/aemr << 'NGINX'
server {
    listen 80;
    server_name aemr.your-domain.ru;

    # API проксирование
    location /api/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_cache_bypass $http_upgrade;
    }

    # Статика фронтенда
    location / {
        root /opt/aemr/packages/web/dist;
        try_files $uri $uri/ /index.html;
        expires 1d;
        add_header Cache-Control "public, immutable";
    }

    # Gzip
    gzip on;
    gzip_types text/plain application/json application/javascript text/css;
}
NGINX

sudo ln -sf /etc/nginx/sites-available/aemr /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

### Вариант 2: Docker

```bash
docker compose up -d
# Запустит: app (Node.js) + PostgreSQL
# Фронтенд на порту 80, API на /api/
```

### Обновление

```bash
cd /opt/aemr
git pull
pnpm install --frozen-lockfile
pnpm build
pm2 restart aemr-server
```

---

## Архитектура

```
packages/
├── shared/     Типы, константы, report-map, rule-book
├── core/       Pipeline: ingest → normalize → classify → validate → delta → trust
├── server/     Fastify API + Google Sheets + Drizzle ORM (SQLite/PostgreSQL)
└── web/        React 19 + Vite 6 + Tailwind CSS + Recharts + Zustand
```

### Страницы (10)

| Страница | Назначение |
|----------|-----------|
| Сводная панель | KPI + тренды + светофор отделов |
| Построчные данные | Мини-Excel: просмотр и редактирование строк |
| Экономика | Экономия, антидемпинг, конфликты (44-ФЗ) |
| Аналитика | ��рафики и визуализации |
| Сверка | СВОД vs пересчёт: дельты и расхождения |
| Надёжность | Trust Score: 5 компонент доверия к данным |
| Замечания | CRUD: lifecycle замечаний |
| Рекомендации | Умные советы по отделам |
| Журнал | Аудит-лог: кто что когда изменил |
| Настройки | Источники данных + маппинг ячеек |

### Pipeline обработки данных

```
Google Sheets → Ingest → Normalize → Classify → Validate → Delta → Trust Score
                  ↓          ↓           ↓          ↓         ↓
              Raw cells   Clean data   Signals   Issues    Official vs Calculated
```

### Таблицы данных

| ID | Таблица | Назначение |
|----|---------|-----------|
| СВОД | 1e8edy... | Сводная ��аблица ТД-ПМ |
| УЭР | 15NEAE... | Управление экономического развития |
| УИО | 1qCBY5... | Управление имущественных отношений |
| УАГЗО | 1DgO0t... | Управление по архитектуре |
| УФБП | 14A7vv... | Уп��авление финансов и бюджетной политики |
| УД | 1zrpgV... | Управление делами |
| УДТХ | 1bxh-m... | Упра��ление дорожно-транспортного хозяйства |
| УКСиМП | 1aFAw9... | Управление капитального строительства |
| УО | 1AGvXD... | Управление образования |

---

## Контакты

Елизовский муниципальный район
АЕМР — Аналитика единой модели расходования
