# AEMR Production Deploy

Канонический production stack: Docker Compose, базовые сервисы ниже;
плановый `report-worker` подключается профилем `reports`.
Текущая установка и допуски — [PLAN](../docs/PLAN.md#current-execution).

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

Команды ниже — первоначальное создание пустого локального/тестового стенда.
На действующем сервере применять [обновление и выпускной допуск](#обновление-и-выпускной-допуск),
а не прямой `compose up --build`. Наличие этой инструкции не разрешает установку.

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

## Обновление и выпускной допуск

В интеграционной ветке PR #79 обычный push не устанавливает приложение.
Старый `CI → Run workflow` с `release_sha`, `backup_root`, `backup_name`
намеренно завершается `RELEASE_REQUIRES_CONTROLLED_CANDIDATE_WORKFLOW` до SSH.
Его оставшиеся шаги — исторический код, а не инструкция действующего выпуска.

Действующий путь — задача `controlled-candidate-release` в
[workflow обслуживания](../.github/workflows/vps-cache-cleanup.yml). Её запускает
событие добавления владельцем репозитория метки
`maintenance: controlled-candidate-release` к PR #79 из интеграционной ветки
того же репозитория. Workflow сверяет текущий SHA PR с кандидатом и использует
общую группу `deploy-vps` без отмены выполняющегося выпуска. Запуск меткой —
изменяющая production операция, не способ выполнить предварительный аудит.

До остановки служб проверяются исходный CI и точные образы. Архивы CI передаются
без повторного экспорта образов. Контроллер автоматически выбирает web-only,
если полный diff от исходной ревизии установленного backend затрагивает лишь
`packages/web/` и обычные Markdown-документы, а фактические конфигурации,
образы API/worker и Caddy неизменны. Неизвестная ревизия, изменение общих
контрактов, зависимостей, reader, схемы, инструментов или конфигурации выбирают
полный путь. Само первое внедрение этой оптимизации также требует полного пути.

В web-only заменяется только web. До замены записывается pending в существующем
механизме recovery; при потере владельца runtime guard восстанавливает прежний
web, а после durable acceptance сохраняет новый. API, worker, Caddy и рабочий
том не останавливаются и не откатываются. Приёмка проверяет неизменность ID
этих контейнеров, доступность интерфейса и API; паспорт сохраняет отдельную
ревизию backend. Запуск остаётся через ту же метку и тот же контроллер.

Для полного пути один владелец
maintenance lock останавливает writers и создаёт свежую полную копию. На отдельном
GitHub runner `release_trial.py` восстанавливает её в один изолированный каталог,
проверяет новый и прежний runtime на этой копии и повторяет полное восстановление.
`release-controller.py` связывает доказательство с SHA, manifest, образами,
конфигурацией и кодом проверяющих инструментов; одних структурных меток PASS
недостаточно. Production изменяется только после этих проверок.

Наличие кода и успешные синтетические тесты не доказывают прохождения выпуска
конкретного SHA. Нужны результаты фактического controlled run и приёмка runtime;
актуальное состояние кандидата фиксируется в [PLAN](../docs/PLAN.md#current-execution).
Обход через ручной `git pull && docker compose up -d --build` не заменяет этот путь.
`enable-reports.sh` также изменяет состояние и может публиковать Word, поэтому
его не используют как read-only диагностику.

**Предохранитель истории в PR #79.** `enable-reports.sh` проверяет доступность
отчётного движка **до остановки worker**. Автоматическая очистка старых попыток
и восстановление недельных архивов исключены из шага релиза: это самостоятельные
операции сопровождения, а не побочный эффект публикации. Для отдельного
ручного обслуживания сначала нужны проверенный полный снимок `server_data`,
контроль непрерывности истории и отдельный допуск. Наличие команды `prune-state`
не является разрешением запускать её с `--apply` на production.

**Граница этого изменения:** плановый `report-worker` по-прежнему выполняет
`recover_weekly_archives` и защищённое уплотнение *старых неконтрольных*
попыток при старте и после цикла. Его тесты сохраняют статус/ошибки каждой
попытки, непрерывность выпущенных документов, исходный набор подтверждённого
четверга и единственный независимый недельный источник. Это существующее правило
retention, а не полное отключение уплотнения. Не считать его фактически
проверенным на VPS до разрешённого восстановления и двух самостоятельных циклов.

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

## Полная резервная копия состояния и проверка восстановления

Полная копия теперь поддерживает сжатый формат 2: `stateful_backup.py create
--compressed --source /source --backup /private/backup-name`. Он сохраняет
каждый файл и пустой каталог с SHA-256, владельцами и разрешениями, включая
SQLite/WAL и DOCX. `verify --backup /private/backup-name --scratch-parent
/private/restore --source /source` проверяет архив и выполняет настоящее
полное восстановление. Источник должен оставаться остановленным для записи.
Проверка заранее требует свободное место под **несжатый** объём плюс 128 MiB;
размер сжатого архива не является размером необходимого scratch-диска.
Формат 1 остаётся совместимым. Сжатие не разрешает удаление исходного состояния.
Внешняя проверка на другом диске пока не заменяет существующий локальный
release gate: передача копии и привязанный к источнику допуск ещё не реализованы.

**Состояние: процедура подготовлена в PR, но на рабочем VPS не проводилась.**
Старый пример копирования одного `aemr.db` при работающем сервисе
**не является надёжным backup**: SQLite может использовать WAL, а отчёты
держат дополнительные базы, журнал рекомендаций, immutable releases, DOCX,
архивы и прочую историю в одном томе `server_data`.

Добавлен `deploy/verify-state-backup.sh`. Он работает только когда оператор
**уже остановил запись** и явно проверил согласованное окно, сам не выполняет
`stop`, `up`, `migrate`, `run-google` или публикацию. Он:

1. Fail-closed удостоверяет через Docker inspect, что `server` остановлен,
   а `report-worker` отсутствует либо тоже остановлен; закрепляет
   существующие container/image/volume (а не предполагает имя тома).
2. Читает весь том `server_data` через Docker mount **read-only** и делает
   отдельную копию вне тома с SHA-256 каждого файла, владельцами,
   разрешениями и сохранением пустых каталогов. Изменение источника
   во время копирования или неполнота обязательных файлов останавливает процесс.
3. В отдельном временном Docker volume пересоздаёт копию, сверяет
   содержимое и метаданные, проверяет SQLite `PRAGMA integrity_check`
   и целостность каждого DOCX. До и после восстановления сравнивает копию
   с остановленным источником через read-only mount, не открывая исходную
   SQLite и не создавая в ней WAL/SHM. Временный том удаляется.
4. Печатает только технические счётчики и фиксированные статусы, без
   исходных строк, комментариев, идентификаторов или секретов.

В согласованное окно **и только после отдельного допуска** оператор может
использовать следующие шаги (пути и ID копии выбрать до начала):

```bash
cd /home/aemr/dash/deploy
# /private/backups/aemr должен существовать, быть закрыт от посторонних
# и находиться вне repository/server_data. Скрипт не создаёт корневую папку.
docker compose --env-file .env.production --profile reports stop report-worker
docker compose --env-file .env.production stop server
bash verify-state-backup.sh /private/backups/aemr RELEASE-APPROVED-SHA
```

Не использовать пример выше как команду для запуска из этого аудита:
остановка двух служб — **production-операция**, требует отдельного решения.
Не хранить резервные копии и `manifest.json` в Git или публичном Actions.
Нужны независимое хранилище и проверка возможности восстановления данных
и образов старого рабочего выпуска.

Выпускной workflow повторяет проверку остановки `server` и `report-worker`,
извлекает фактический том из mount существующего сервера и проверяет копию
с `verify --source /source`. Исправная историческая копия, отличающаяся от
текущего состояния, не допускает выпуск (`BACKUP_SOURCE_MISMATCH`). Изменение
источника во время проверки также прерывает допуск. Отказ до начала
отчётного выпуска не запускает и не перезапускает worker. Режим `verify`
без `--source` остаётся проверкой исторической копии для восстановления,
но сам по себе не является выпускным допуском.

**Граница результата.** Успешная пробная распаковка и SQLite/DOCX integrity
показывают побайтовую сохранность `server_data`, но не подтверждают работающий
старый сервер, атомарность правок Google Sheets, сохранность всех внешних
зависимостей или успешный релизный rollback. Для допуска обязательны:
проверенный restore в отдельном старом runtime, все ссылки snapshot/receipt,
предыдущее image digest, контроль старых DOCX, проверка версии источников,
затем контролируемый запуск и два самостоятельных цикла worker.

Текущий `deploy/rollback.sh` возвращает **только код и образы**, но не
содержимое `server_data`. Его нельзя считать самостоятельным планом
восстановления после миграции БД. `enable-reports.sh` также пока меняет
report state и может публиковать новый выпуск — использовать только после
полного выпускного допуска.

### Полная копия при недостатке VPS для scratch

Owner-authorized maintenance label `maintenance: full-worker-backup` на
каноническом PR #79 требует exact-head CI, прекращает оба writer, создаёт
полную неизменяемую compressed копию вне checkout и тома данных. Manifest
и архив передаются по SSH на временный закрытый Actions scratch; UID/GID,
SQLite/WAL, DOCX и все байты проверяются существующим `verify`. Публичные
artifacts не создаются. Прежний Node возобновляется с проверкой health;
worker не запускается. Независимый30мин watchdog возвращает Node при
потере runner; source-match обязан проверить quiescence до и после scan.

`match-source` отдельно означает только сравнение с копией. Он не заменяет
restore и не разрешает deployment. Завершённый workflow доказывает копию
на момент quiescence; после resume источник может измениться. Допуск к
выпуску требует нового сопоставления текущего остановленного состояния,
доказанного rollback старого runtime и самостоятельных worker cycles.
Копия остаётся в приватном `.dash-private-backups`; временные runner copies
и SSH credentials удаляются даже после ошибки.

Техническое обслуживание использует единый EX-lock
`/run/lock/aemr-maintenance.lock`. Deploy, rollback и enable-reports держат
его до завершения операции; вложенный enable-reports принимает fd9 только
после проверки kernel fdinfo, а не флага окружения. У backup-window lock
держит отдельный guardian: READY проверяется до остановки API, исключение
сохраняется между prepare, переносом копии, match-source и healthy resume.
Watchdog через 30 минут запускает только исходный API; при ошибке Docker
сохраняет lock и повторяет ограниченный по времени запуск.

Worker recovery держит lock при изменении контейнеров, но освобождает его
на время наблюдения двух циклов. После проверки исходного состояния,
но до изменения runtime, а также перед намеренной остановкой worker
существующая runtime policy атомарно переводится в `worker_enabled:false`
без изменения остальных полей, владельца и прав. Автоматического обратного
допуска нет. Отсутствующая policy не создаётся; недоступная, чужая или
символьная ссылка блокирует остановку. Оператор должен иметь разрешённый
доступ к lock и policy; тестовая проверка этих механизмов не подтверждает
установку или работоспособность guard на VPS.

Независимый backup job полностью возобновляет исходный API и освобождает
свой guardian. Затем release CI получает собственный EX fd9, проверяет
исходный runtime и до остановки API допускает только реально доступный
объём для новой сжатой копии и одного полного scratch restore. Count-only
preview и release capture используют одинаковый быстрый gzip level 1;
внешние копии сохраняют прежний default level 9 и формат. Preview не является
снимком: capture отдельно ограничен запасом для scratch, а новый полный
checkpoint проверяется source-match до и после scratch restore.

Старая копия остаётся исторической, отдельно полностью проверяется и не
подменяется. Новый checkpoint/receipt имеет SHA, run и attempt, поэтому
повторный dispatch не переписывает историю. При Git/build/preflight ошибке
до замены контейнера возвращается именно исходный API с проверкой health.
Поздняя ошибка worker не запускает старый API или глобальный restore.
Выпуск требует активного установленного host guard с проверенным кодом,
unit и владением исходным API. Дочерние внешние процессы не сохраняют fd9
после смерти shell; независимый guard может восстановить API после освобождения
lock. Синтетические SIGKILL/process проверки не доказывают состояние VPS.

## Web Auth Bootstrap

Только локальный development/test с заданным ключом использует localStorage:

```js
localStorage.setItem('aemr_api_key', '<same-key-as-AEMR_API_KEY>')
```

Production-браузер входит через Basic Auth Caddy; proxy добавляет серверный
Bearer, JSON-клиент не отправляет локальный ключ. Публичный read-only —
отдельный режим. Точные границы — [SECURITY](../docs/SECURITY.md), включая
отсутствие персональной role/actor-модели. Не раздавать production-ключ браузерам.

### Одноразовое уплотнение опубликованных отчётов

`plan-weekly-publications.py` по умолчанию остаётся read-only census. Режимы
`apply`, `recover`, `rollback`, `finalize` используют тот же native PublicationStore.
Оператор не останавливает Node, не меняет Caddy, Basic/Bearer, HSTS, таймер или
контейнеры и не восстанавливает mutable state из старой резервной копии.

До live apply требуется отдельный выпуск совместимого report reader/runtime.
Установленный старый reader, требующий `report_model.json` в `select` и
`latest_for_period`, несовместим с уплотнённым выпуском: проверка поведения на
синтетическом выпуске и точных хешей установленного пакета должна отказать.
Новый runtime создаёт `publication-readers.lock` в каталоге report-state; read-only GET его не создаёт.
Report GET и архивный расчёт держат shared lease; обслуживание берёт locks в
порядке run → reader EX → publication. Новые GET получают 503 через существующий
маршрут, остальные API продолжают работать. Незавершённый retirement journal
сохраняет fail-closed fence после смерти процесса; GET ничего не исправляет.

Release gate должен получить CI-run JSON через авторизованный GitHub API для
точного кандидата и независимо подтвердить исходный trusted backup из успешного
`full-worker-backup` run **38178244703**, включая существующую проверку scratch
restore. Передача произвольного JSON или создание свежей копии mutable state не
заменяет этот внешний допуск. Код повторно проверяет SHA, чистоту candidate source,
установленный пакет и его поведение уже под lease; fresh plan защищает current,
previous и weekly, а identity gaps блокируют apply. Только выбранные retirement
roots сравниваются побайтно и по uid/gid/mode с trusted backup. Новые mutable
записи не становятся rollback target.

Пример параметров после прохождения внешнего release gate (пути приватные):

```sh
python deploy/plan-weekly-publications.py --state /private/reports --operation apply \
  --candidate "$REVIEWED_SHA" --ci-evidence /private/operator/ci-run.json \
  --reader-package /installed/procurement_engine --expected-revision "$PLAN_REVISION" \
  --backup /private/worker-38178244703/backup
```

Первый apply сохраняет quarantine. Обработанное исключение вызывает только
проверенное native recovery; независимый CLI watchdog отслеживает PID вместе с
Linux start token и выполняет тот же recovery после смерти владельца, снова
проверяя источник, runtime и backup. PID reuse не удерживает fence чужого процесса.
CI evidence, candidate checkout, package и backup должны оставаться доступными
watchdog; при изменении ownership/доказательств fence остаётся закрытым до явного
reviewed `recover`. Таймеров, конфигурации и чужого runtime watchdog не касается.

`finalize` — отдельная операция после независимого readback всех сохранённых
Word/dashboard и protected replay roots. Требуется отдельный reviewed аргумент
`--finalize-review "$REVIEWED_SHA:$PLAN_REVISION:$ENTRIES_SHA256:$MARKER_SHA256"`;
оба хеша берутся из независимого readback и повторно проверяются под native locks.
Apply/watchdog не вызывают finalize. При прерванном удалении повторный finalize
принимает тот же proof только для штатного перехода journal в `finalizing`;
изменившийся состав entries, marker или сохранённые файлы блокируют продолжение.
Без внешнего допуска, совместимого установленного runtime и независимого readback
эта команда не является разрешением на live очистку.

В существующем Docker runtime нет Git. Для Docker transport management job после
авторизованного чтения успешного CI вызывает `candidate_source_receipt` на exact
clean Git checkout: SHA кандидата, CI run ID, ID management job и хеши только
public `.py` package/tool/backup helper. Job передаёт эту ephemeral receipt и
`git archive` тех же public code paths read-only; апplier получает
`--source-receipt /private/operator/candidate-source.json`. Внутри image проверяются
CI context, полный точный набор хешей транспортированного package и обоих tools,
хеши реально импортированного установленного package и behavioral reader probe.
Самодельный `verified: true` не является допуском: доверие к receipt обеспечивается
аутентифицированным existing release gate. Никакого Git checkout, установки Git,
нового сервиса или зависимости в image не требуется. Gate отдельно связывает
actual Node `REPORT_ENGINE_BIN`, Node/worker image/package и mounted report volume;
сам native applier не меняет эти ресурсы и не заменяет такую проверку.

CLI apply требует доказуемую независимость watchdog: PID1 applier и one-off
Docker/tini container отклоняются (`WATCHDOG_LIFECYCLE_UNPROVEN`), поскольку exit
контейнера уничтожает sibling watchdog. Для resident Node exec PID1 Node остаётся
живым; backup/code/proof transport при этом должен быть доступен. Для one-off
management image existing host watchdog обязан владеть отдельным recovery вызовом
и может вызывать проверенный native `operate` под этим внешним жизненным циклом.
Не обходить этот отказ флагом «watchdog verified». Applier должен работать с UID
владельца published directory, совпадающим с actual report-reader/data owner;
иначе private journal/staged roots после обслуживания окажутся недоступны API.

Rollout нового reader теперь явно вызывает `initialize-publication-readers` в
Node startup **до createApp/listen/preload**, если существует legacy catalog;
worker может оставаться выключенным. Инициализатор не читает/переписывает catalog,
создаёт один пустой owned inode с fsync и повторно использует его без замены.
Symlink, чужой UID, непустой файл и подмена inode отклоняются; ошибка bootstrap
останавливает startup с фиксированным кодом. Старые readers/runtime должны быть
остановлены и drained до rollout/GC: bootstrap не делает старый код совместимым.
Read-only GET по-прежнему никогда не создаёт lease. Без published catalog сохраняется
старый development startup; первый native writer/archive создаёт lease до catalog.

Read-only candidate-overlay rehearsal запускает `check-publication-readers --state`
перед source-schema и frozen-replay (включая published-summary, подробную статистику,
weekly/history и archived source-schema). Проверка берёт только существующий shared
lease, не создаёт каталог/lock, не копирует release и не запускает worker. Без
старого lease печатает JSON `status=BLOCKED`,
`error_code=PUBLICATION_READER_LEASE_UNINITIALIZED`,
`required_action=AUTHORIZED_QUIESCENT_READER_BOOTSTRAP` и выходит с кодом 2;
CI остаётся заблокированным. `PUBLICATION_MAINTENANCE_ACTIVE` и незавершённое
retention recovery сохраняют отдельные коды, а не трактуются как нужда в bootstrap.

Для старого runtime это отдельный предварительный допуск оператора: остановить и
дождаться завершения старых readers/writers (проверить отсутствие RUNNING writer),
зафиксировать backup/rollback и точный кандидат; от UID владельца report-state
в approved maintenance выполнить существующий
`python -m procurement_engine.cli initialize-publication-readers --state <report-state>`.
Не выполнять эту запись внутри read-only workflow и не обходить fence при отсутствии
файла. После допуска readonly rehearsal повторяется на том же exact SHA; наличие
lease само по себе не подтверждает все результаты replay и не разрешает retention
под работающим старым runtime, который не знает shared lease. Runtime startup нового
кода по-прежнему инициализирует reader до listen в утверждённом rollout.

Историческая проверка ёмкости 12.10.2026 (CI38199188606) видела
12 113 375 232 B свободного места против 22 048 941 998 B прежней копии.
Эти числа не описывают нынешний диск после обслуживания 19.10 и не служат допуском.
Текущий controlled workflow переносит свежую копию на независимый runner для
проверки нового/прежнего runtime и полного восстановления; утверждение прежней
версии этой инструкции «схема ещё не введена» устарело. Реализация:
[release_trial.py](release_trial.py), [release-controller.py](release-controller.py),
[release_recovery.py](release_recovery.py). Допуск всё равно требует свежих замеров
ёмкости, точного proof и успешного фактического прогона кандидата. Исторический
restore или синтетический тест не заменяет проверку сегодняшнего checkpoint.

## Ограничение хранения: обслуживание 19.10.2026

По отдельному разрешению владельца удалены 114 старых комплектов; сохранены пять
рабочих публикаций и все три недельных среза. Политика и исключения описаны в
[ADR-0013](../docs/decisions/0013-bounded-report-storage.md). Это новое решение
владельца о сроке хранения, а не результат старого CI rehearsal.

На VPS установлен `aemr-storage-maintenance.timer`: каждый час он запускает
ограниченный по памяти и CPU контейнер под общим maintenance lock. Модули
`publication_retention.py`, `retention.py` и entrypoint `storage-maintenance.py`
лежат в root-owned `/usr/local/libexec/aemr/storage-budget-20261019/`.
Образ закреплён полным digest в `/etc/aemr/storage-maintenance.env` через
`AEMR_STORAGE_IMAGE`; замена образа приложения сама по себе не меняет обслуживающий
runtime. При обновлении нужно проверить совместимость модулей с новым образом,
повторить тесты, затем обновить pin. Образ из этого файла защищать при image cleanup.

После данных тот же service запускает `storage-images.py`. Он удаляет только
образы `aemr-server`, `aemr-web`, `aemr-worker` старше семи суток с единственным
тегом. Все контейнеры, три установленных compose-контекста восстановления и pin
обслуживания защищают свои image ID. Удаление выполняется по ID без `--force`;
неизвестные репозитории, образы с несколькими тегами и незавершённый release
исключают удаление. Результат — `/var/lib/aemr/storage-images-status.json`.

Проверка: `systemctl status aemr-storage-maintenance.service` и
`systemctl list-timers aemr-storage-maintenance.timer`. Последний агрегированный
результат находится в `reports/storage-maintenance-status.json`. Ошибка возвращает
ненулевой exit code; занятый общий lock пропускает запуск. Для остановки расписания:
`sudo systemctl disable --now aemr-storage-maintenance.timer` (уже идущий запуск
завершится отдельно). Обслуживание не требует перезапуска приложения.

Временные каталоги незавершённых попыток и `.pending-*` не удаляются по одному
возрасту: разовая очистка проверила отсутствие текущей/недельной ссылки,
сохранённую identity и эксклюзивные locks. Квитанция —
`reports/orphan-cleanup-20261019.json`. Автоматическая очистка сохраняет неизвестные
или повреждённые записи для разбора.

Полная рабочая попытка, из которой получен WEEKLY-срез, теперь удаляется после
проверки всех файловых хешей архива и его identity; диагностические статусы остаются.
При несовпадении хеша соответствующие четверговые попытки сохраняются. Это исключает
постоянное накопление второй полной копии каждой недели.

Лимиты journald установлены через `/etc/systemd/journald.conf.d/aemr-storage.conf`
(исходник `deploy/systemd/aemr-journald.conf`): 200 МБ persistent, 50 МБ runtime,
14 дней и резерв свободного места 2 ГБ. Контейнерные json-file логи имеют собственные
лимиты 10 МБ × 3. Эти ограничения не заменяют контроль размера рабочих БД.


## Целевой профиль VPS и приоритет фоновых работ — 20.10.2026

Рекомендованный профиль для совместной работы API, синхронизации, Word и
изолированных проверок: 4 vCPU / 8 GiB RAM, SSD с измеренной задержкой I/O.
Это инженерный запас, а не обещание двукратного ускорения и не автоматический
допуск к смене тарифа. Текущий замер выполнен при интеграционных тестах;
обычный режим необходимо измерять отдельно.

| Контур | Политика |
|---|---|
| API / SSE | Приоритет интерактивного чтения готовой принятой ревизии; тяжёлый пересчёт вне обработчика GET. |
| Источники | Устойчивая очередь по файлам, coalescing поколений, ограниченная параллельность с учётом Google quota. |
| Расчёты и Word | Ограниченные исполнители; дедупликация заданий; неизменные входы не создают полные новые копии. |
| SQLite | Короткие транзакции записи, согласованные read models, bounded WAL/checkpoint; дополнительные ядра не снимают ограничение одного writer. |
| Retention / backup | Общий допуск обслуживания и защищённые ссылки; I/O не конкурирует бесконтрольно с публикацией. |
| Эксперименты | Отдельный контейнер без production-томов и секретов; CPU1/RAM1400MiB для текущего TS-гейта, cpu-shares128 против API1024/worker256; удалить после сохранения результата. |

Действующие compose-потолки API1.75CPU/2560MiB и worker1CPU/2304MiB не
масштабируются сами при апгрейде. Не увеличивать их или число процессов вслепую:
проверить API p95/p99, CPU throttling, I/O PSI, peak RSS, активный swap-in/out,
WAL, время worker и неизменность результатов. Занятый swap сам по себе не
доказывает текущее вытеснение. CPU shares задают относительный вес при конкуренции,
не гарантируют выделенное ядро. Резерв RAM нужен также ОС, page cache и backup.

Официальные основания: [Docker resource constraints](https://docs.docker.com/engine/containers/resource_constraints/),
[Node worker threads](https://nodejs.org/api/worker_threads.html),
[SQLite WAL concurrency](https://www.sqlite.org/wal.html).
Календарь владельца: четверг18:00 Asia/Kamchatka; пятница оформляет этот срез;
LIVE сравнивается с четвергом предыдущей календарной недели. Включение правила
в план не означает, что нынешний weekly cron уже мигрирован.
