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

## Обновление и выпускной допуск

**В ветке PR #79** автоматическое развёртывание от обычного push в main
отключено: такой push только выполняет CI и классификацию изменений.
Развёртывание возможно лишь через явный запуск GitHub Actions
**CI → Run workflow**, на точной текущей ревизии `main`, с тремя параметрами:

- `release_sha` — полный 40-значный SHA `main` (должен совпасть с `github.sha`);
- `backup_root` — абсолютный непубличный каталог вне репозитория и `server_data`;
- `backup_name` — каталог уже созданной полной резервной копии внутри `backup_root`.

Задача имеет `environment: production`. Дополнительное согласование через
reviewers работает **только при отдельно настроенной защите GitHub Environment**,
одно название окружения не считается approval. Без явного запуска задачу
развёртывания workflow не выполняет.

До любого `docker image prune`, сборки, запуска контейнеров, миграции или
публикации запускается **read-only scratch восстановление** указанной копии
кандидатной версией проверяющего кода из заданного SHA. Отсутствующая,
неполная или повреждённая копия блокирует выпуск. При неудаче restore
предыдущего worker проверяется по Docker ID и состоянию `running`, а не
только по коду возврата `docker start`.

**Запрещено** обходить эти ворота ручным `git pull && docker compose up -d
--build` без отдельного аварийного разрешения. Эта документация описывает
возможный управляемый выпуск, но **не свидетельствует**, что backup на VPS
создан, старые данные восстановлены в отдельном рабочем runtime или два
самостоятельных цикла worker прошли. До этого релиз #79 остаётся draft.
Существующий `enable-reports.sh` по-прежнему делает изменения состояния
и может опубликовать Word; нужен отдельный операторский допуск.

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

Независимый внешний backup guardian не передаёт fd9 последующему CI job.
Пока он держит quiescence, отдельный CI EX-lock корректно блокируется:
эта цепочка ещё требует согласованного release handoff и не принята.
Нельзя завершать guardian или отпускать lock при остановленном API ради
прохождения gate. Допустимый путь должен сохранить одного владельца lock
на всём выпуске либо сначала подтвердить healthy resume, затем заново
получить EX-lock и доказать соответствие остановленного источника копии.
Последний вариант обязан отклонить изменившийся источник и обеспечить
восстановление доступности при потере runner до разрешения deployment.

## Web Auth Bootstrap

Пока полноценного login-flow нет, web client берёт API key из browser localStorage:

```js
localStorage.setItem('aemr_api_key', '<same-key-as-AEMR_API_KEY>')
```

Это MLP-режим для внутреннего контура. Для публичного доступа нужен отдельный login/session слой.

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
`--finalize-review "$REVIEWED_SHA:$PLAN_REVISION"`; apply/watchdog его не вызывают.
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
