# Runbook

Основная историческая редакция: 05.06.2026. Релизные ограничения актуализированы 12.10.2026 (Asia/Kamchatka). Текущее состояние кандидата и допуски — issue #69 / PR #79; этот документ не подтверждает готовность production.

## Local Development

```bash
pnpm install
cp .env.example .env
pnpm dev
```

Expected endpoints:

- Web: http://localhost:5173
- API health: http://localhost:3000/api/health

## Verification

Временная граница обслуживания установленного `43f10742` (16.10):
инструмент из `268f9e5a` staged38895891036 SUCCESS11:46:30UTC; code/dependencies
проверены в `/root/codex-fixes/weekly-38895891036`. Read-only preflight38896058189
SUCCESS11:54:40UTC:99pubs/keep7/retire92;28581079465B upper bound. Exact revision
`a9b010a8710e97634231f0beeb0086b7cf5986997dc91a598c67bf1af423db03`.
Trusted immutable target inventory прошёл gate,3unbacked roots защищены.
Independent review допустил только reversible apply, не finalize. Это версия инструмента, не новая версия рабочего приложения.
Прикладные образы, два принятых цикла38860353565, backup/restore38831492016
и root release proof остаются привязаны к `43f10742`.
Полный состав файлов сверяется с неизменяемой квитанцией
`weekly-38875479942/source-hashes.json`: допустимы ровно семь изменений
maintenance/reader/retention, плюс один вспомогательный canonical source-CI
qualifier. Его hash сверяется с принятым root release window ДО import.
Остальные identity/leases/backup modules должны совпадать побайтно.
API/worker проверяют reader behavior на одноразовых синтетических данных.

Три exact-SHA source jobs учитываются через существующий `source_ci_gate.py`;
owner workflow получает run/jobs через authenticated GitHub API, привязывает
каждый job к тому же run и сохраняет исходный общий conclusion. FAIL live browser
старого API не объявляется зелёным CI. Эта квалификация допускает только код
служебного инструмента, не приложение/UI и не удаление данных.
Первый preflight строит один свежий план под штатными locks, защищает корни,
которых нет в доверенном backup, и проверяет реальные файлы каждого target.
Уменьшенный marker+SQLite journal сохраняет v1 recovery compatibility; только
неизменяемые publication artifacts могут временно делиться inode.
Apply/recover/readback/finalize и независимая проверка сохранённых выпусков
остаются обязательны. Пока compaction не выполнялась. Owner-only apply transport требует отдельного
литерального reviewed plan revision; live marker не допускает
мутацию. Отдельный native readback требует exact original catalog revision, все original
download/dashboard/identity/ledger hashes, receipt whitelist и period по frozen
report_model. Пять consistent tamper кейсов RED→GREEN;3tests/11negatives и
independent exact43-reader replay PASS. При apply quarantine сохраняется.
Readback daemon child имеет внутренний590s timeout; CLI600s не считается
ограничением daemon lifetime. Native stable DB+WAL copy использует отдельный
RW disk scratch, primary volume RO; private receipt хранит hashes entries/marker.
Apply38897987071 ещё идёт. Новый выявленный CLI blocker partial-finalize resume
исправляется отдельно в main; до exact source qualification finalize запрещён.
Finalize transport пока отсутствует. После принятия полного
приложения временные pins заменяются одной совместимой точкой.

Для host maintenance `TMPDIR` явно направляется в приватный каталог на диске
`/var/lib/aemr/weekly-scratch`, с UID/GID1000 для временных SQLite clones.
Не предполагать, что системный `/tmp` — диск: первый dry-run38881943514
остановился на `PUBLICATION_CATALOG_SCRATCH_INSUFFICIENT` при clone identity,
а не на доказанном OOM. `MemoryPeak == MemoryMax` само по себе не доказывает OOM.
Тот же TMPDIR передаётся всем host children. При ошибке мутационной операции
scratch сохраняется для независимого recovery; после обычного read-only выхода
удаляются только созданные этим запуском временные копии. Exact-SHA source CI, свободное
место, backup coverage и отдельная приёмка apply/finalize остаются обязательны.

Run before handoff or deployment:

16.10 identity metadata: copy-only38889251691 восстановил два старых снимка,
8126 наблюдений/16252 nullable signatures. Protected digest до/после совпал;
UID/raw/history/frozen results не менялись. Private root600 prepared proof:
`weekly-38881380220/identity-prepared-38889251691.json`.
Первый live38890817567 отказал на занятом native run.lock ДО connect/write.
Bounded480s idle wait отпускает EX9 и повторяет весь admission после захвата;
сам CAS заново берёт прежний native lock. Live38891326813 SUCCESS11:04:29UTC:
одна BEGIN IMMEDIATE/FULL transaction, NULL-only, snapshot/locator/signature/UID
CAS; весь конфликт откатывает транзакцию, equal replay идемпотентен.
DB/sidecars/lock regular/native-owner/single-link/stable-inode, без symlink.
Независимый native readback38891473586 SUCCESS11:05:42UTC:95target snapshots,
0affected/0missing_plan/0missing_entity/0missing_snapshots. Это принятый ремонт
производных identity metadata; не публикационная очистка и не общая приёмка
идентичности. Старый tool/proof pin сохранён; повторное применение не требуется.
Backup index coverage38891425973:92из95корней совпали по file map,3защищаются.
Это index check, не замена свежей проверки bytes/archive/restore.
Ограничение публичного Python source transport40KiB отделено от приватного
prepared evidence8MiB; общий лимит произвольных trust files остаётся1MiB.

```bash
pnpm lint
pnpm typecheck
pnpm -r test
pnpm build
pnpm audit --audit-level moderate
```

## Source And Metric Contract Checks

Before changing spreadsheet IDs, sheet names, or metric formulas:

1. Check [DATA_SOURCES.md](DATA_SOURCES.md) for the production source set.
2. Check [METRICS_CONTRACT.md](METRICS_CONTRACT.md) for the source column, gate, formula, DTO field and UI label.
3. Add or update regression coverage for the changed source or metric.
4. Run `pnpm -F @aemr/server test source-inventory.test.ts` for source defaults and runtime spreadsheet ID validation.
5. Run the full verification block above before handoff.

## Выпуск в production

Для действующего сервера применяется проверяемый exact-SHA release gate из
[deploy/README.md](../deploy/README.md), а не прямой `compose up --build`.
Перед выпуском обязательны отдельный допуск владельца, проверенная полная
резервная копия и воспроизводимый откат к прежнему runtime и данным.
Перед downtime release workflow проверяет точный source CI, одинаковый Docker
engine/image-store на builder и VPS и перенос малого image туда-обратно без
изменения immutable ID. Привилегированный restore trial обязан использовать тот
же daemon, что builder; идентичность прежних runtime images проверяется после
переноса до остановки писателей. Ошибка этих проверок отменяет выпуск при живом
API. Private diagnostics сохраняются до очистки transport; в публичные Actions
попадают фиксированные коды, без env, первичных данных и содержимого отчётов.

`enable-reports.sh` не является диагностической командой: он может применять
миграции и публиковать документы. Без допуска выполняется только read-only
проверка. Обновление Caddy/доменного режима ниже также относится к разрешённому
эксплуатационному окну; сами примеры не дают разрешения менять production.

Required production variables:

- `NODE_ENV=production`
- `AEMR_API_KEY`
- `GOOGLE_SHEETS_SPREADSHEET_ID`
- `GOOGLE_SERVICE_ACCOUNT_EMAIL`
- `GOOGLE_PRIVATE_KEY`
- `SQLITE_PATH=/app/packages/server/data/aemr.db`

## Домен и TLS

Режим периметра задаёт одна переменная `DOMAIN` в `deploy/.env.production`.
`:80` — открытый HTTP, пароль периметра идёт по сети текстом (только отладка).
Имя домена — рабочий режим: Caddy сам выпускает сертификат Let's Encrypt, сам
продлевает его и сам поднимает редирект с HTTP на HTTPS.

Что сделать для перехода:

1. A-запись домена → IP сервера; порты 80 и 443 открыты наружу (80 нужен
   ACME-проверке и при каждом продлении, закрывать его нельзя).
2. В `deploy/.env.production` заменить `DOMAIN=:80` на `DOMAIN=aemr.example.ru`.
3. `docker compose --env-file .env.production up -d` из каталога `deploy/`
   (пересборка образов не нужна).

Проверка:

```bash
docker compose --env-file .env.production exec caddy caddy validate --config /etc/caddy/Caddyfile
docker compose --env-file .env.production logs caddy | grep -i "certificate obtained"
curl -I http://aemr.example.ru/api/health            # 308 → https
curl -sI https://aemr.example.ru/api/health | head -n 12
```

По HTTPS в ответе обязаны быть `Strict-Transport-Security: max-age=31536000`,
`X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`. По HTTP
первого нет намеренно: HSTS по незащищённому соединению браузер игнорирует.

Сертификаты живут в томе `caddy_data` — удалять том нельзя, повторные выпуски
упрутся в недельный лимит Let's Encrypt. Подробный разбор отказов выпуска —
`deploy/README.md`, раздел «Домен и TLS».

## Снимок недели: предупреждение об устаревшем источнике

Четверговый cron архивирует недельный срез из кэша книг ГРБС. Кэш обновляют
стартовый preload, ручной `POST /api/refresh` и обработчик Drive webhook.
Получение webhook не доказывает успешного чтения: сверять очередь, refreshFailures
и фактический sourceReadAt. Снимок проверяет давность чтения и пишет одно из двух:

- `Еженедельный снимок четверга отложен` — источник устарел, но день ещё не
  кончился. Лечение: `POST /api/refresh` (или открыть Пульт и нажать обновление)
  — следующий тик, раз в час, снимет снимок уже по свежим книгам.
- `снят ПО УСТАРЕВШЕМУ ИСТОЧНИКУ` — наступил вечер четверга, неделю терять
  нельзя, снимок снят с честной пометкой. Числа этой недели читать как состояние
  книг на дату снимка нельзя: в сообщении указано, на сколько часов отстаёт
  самая старая книга.

Обе строки видно в `docker compose --env-file .env.production logs server`.

## Health Check

```bash
curl http://127.0.0.1/api/health
```

Expected:

```json
{"status":"ok","service":"aemr-server","timestamp":"..."}
```

Health intentionally does not reveal Google credential status, spreadsheet IDs or auth configuration.

## API Auth Check

```bash
curl -i http://127.0.0.1/api/dashboard
curl -i -H "Authorization: Bearer $AEMR_API_KEY" http://127.0.0.1/api/dashboard
```

Without token: `401`. With token: `200` or an application-level data loading response.

## Logs

```bash
cd deploy
docker compose --env-file .env.production logs -f server
docker compose --env-file .env.production logs -f caddy
```

## Резервная копия и восстановление постоянного состояния

Копирование только `aemr.db` из работающего тома не является согласованной
резервной копией: необходимо сохранить WAL, все SQLite-базы, RecommendationLedger,
исторические входы, архивы, публикации и Word-документы из `server_data`.
Исторические инструкции одиночного `cp` заменены этим контрактом.

Используется существующий [verify-state-backup.sh](../deploy/verify-state-backup.sh)
с закрытым каталогом вне репозитория и production-тома. Скрипт сам не останавливает
писателей: согласованная остановка Node server, report-worker и отсутствие
ручного запуска предварительно подтверждаются в разрешённом окне. Он проверяет
полную копию и восстановление в изолированный scratch volume; исходный том
монтируется только для чтения. Подробные условия и команда — в разделе
«Полная резервная копия» [deploy/README.md](../deploy/README.md).

Проверка scratch restore не означает принятый rollback приложения. До выпуска
нужен отдельный запуск прежнего runtime над копией, проверка прежних документов,
снимков и идентичности. `rollback.sh` возвращает код/образы, но сам по себе не
восстанавливает постоянное состояние. Два самостоятельных успешных цикла worker
и live-проверка трёх Word остаются отдельными критериями R07/R08/R10.

### Восстановление только report-worker (#93)

Первопричина инцидента: docs deployment остановил worker перед проверкой
схемы источника; MONITORING_SCHEMA_LIVE_GEOMETRY_MISMATCH прервал запуск без
возврата расписания. Проверка `deploy_scope` исключает чистые документационные
изменения; отказ runtime-preflight обязан сохранить прежний worker. Для SSH
скриптов с Bash trap используется `script_stop: false`: injected exits иначе
обходят обработку отказа. Запущенный контейнер сам по себе не доказывает работу.

Разрешённая owner-операция `maintenance: restore-current-worker` в PR79
требует exact-head CI, проверенную текущую полную приватную копию и совместимость
установленного Node image с источниками. Повторный independent restore проверяет
reports-only rollback над scratch с сохранением нового core state. Затем
оператор сверяет reports/ только read-only, сохраняет работающий Node и
меняет только worker на его immutable image. Это проверка свежести, а не новый
quiesced rollback checkpoint. Web/Caddy, bootstrap, миграции и записи Google не
затрагиваются. Detached supervisor сохраняет приватный терминальный receipt.

Точный attributed NOT_ISSUED / SOURCE_CHANGED_BEFORE_PUBLICATION на стадии
publication — защитный отказ; он не принимается за успешный цикл, worker
продолжает штатный таймер. Истечение окна наблюдения при running worker выдаёт
pending.json / NOT_ACCEPTED / exit3 и сохраняет API и worker. Настоящий отказ
сохраняет evidence и останавливает только worker с подтверждённым собственным
container ID. Автоматического восстановления reports/ или stop/start Node нет.
Ручное восстановление данных — отдельная согласованная операция с quiescence;
проверенный scratch rollback не разрешает затирать новые конкурентные данные.

Приёмка требует двух разных timer attempts, RUNNING+FLOCK/PID-атрибуции worker,
неизменного исходного Node image и PASS трёх native Word после каждого цикла.
Отдельный `maintenance: worker-acceptance-readback` сверяет runtime, receipts,
старые sealed деревья releases/weekly archives (набор путей, bytes, uid/gid/mode)
и сохранность согласованного webhotfix. Он также проверяет строгую candidate
схему assurance на исторических model presentations и текущем GET выпуска;
это не полная приёмка всех исторических contextual DTO. Данные и секреты
остаются на VPS, в Actions выводятся только агрегаты и фиксированные коды.

Backup38178244703 проверен наd8a7dfa015a531f5653640427836bf535d87ff79:
3970entries,66SQLite/133DOCX,22 048 941 998B→2 438 244 961B compressed;
scratch restore и still-quiesced source-match PASS. Node healthy после возврата
22:16:19UTC. Recovery38178313782 на50945059: full restore/reports-only drill,
quiesced match, первый самостоятельный цикл и3 native Word PASS.
Первый finished22:38:05UTC VERIFIED_WITH_WARNINGS/error_code=null.
Второй22:53:10–22:59:02UTC NOT_ISSUED/SOURCE_CHANGED_BEFORE_PUBLICATION,
failure_stage=publication. Старый оператор ошибочно счёл защитный отказ
аварией и восстановил reports/ с остановкой Node. Node resumed23:04:47UTC;
read-only38183214317 подтвердил полный match reports/ и5 native smoke PASS.
Это дефект процедуры приёмки, а не доказанный crash worker. Исправление
обработки source-change, pending и ownership проверяется отдельно; #93/R08
не закрыты до двух новых самостоятельных успешных циклов.

### Независимое восстановление процессов и ресурсы VPS

Инфраструктурный handoff от 12.10 интегрирован в `deploy/runtime_guard.py`,
`runtime-policy.json`, systemd service/timer и Compose. Guard проверяет только
процессы своего Compose project/service; три последовательных HTTP-отказа
вызывают restart одного сервиса, cooldown 300 секунд ограничивает повторы.
Отказ публикации `SOURCE_CHANGED_BEFORE_PUBLICATION` не является probe и не
восстанавливает данные. `worker_enabled=false` сохраняется до отдельного допуска
воркера; одинаковый image сам по себе не доказывает два успешных цикла.

На VPS инфраструктурный исполнитель подтвердил online limits без смены
container IDs/images/StartedAt: API 2560 MiB RAM / 3072 MiB RAM+swap, CPU 1.75;
worker 2304 / 2816 MiB, CPU 1.0. Измеренные пики до ограничения — 2.08/1.71 GiB.
Предыдущие предложенные меньшие ограничения не применялись. Web/Caddy имеют
96/192 и 128/256 MiB; их logging уже ограничен 10 MiB × 3 на прежних образах.
Позднее 12.10 API/worker также пересозданы на прежних image IDs под maintenance
flock; readback всех четырёх служб подтвердил logging 10 MiB × 3. Это историческая
инфраструктурная проверка, не приёмка текущего candidate SHA. На15.10 прежний
worker a2b6a1b9 изолирован после подтверждённых OOM/137; policy worker_enabled=false.
Исправленный worker допускается только после принятого выпуска, native API/Word
и двух самостоятельных циклов на новом image. Старую приёмку12.10 не переносить
на другой runtime.

Установленный guard использует `/run/lock/aemr-maintenance.lock`. Операция
stop/recreate/restore должна владеть EX-lock весь срок обслуживания, включая
промежутки между SSH-командами backup/transfer/match/resume. Один локальный flock
в `prepare`, освобождённый при выходе, недостаточен. До интеграции и проверки
защиты всех таких путей старые production workflow запускать нельзя. Источник
этого ограничения — реально включённый host guard, а не новая процедура допуска.

Linux-регрессии `python .github/ci/test_runtime_guard.py` проверяют изолированный
restart, ownership, cooldown, image mismatch и сохранение ресурсов при выключенном
worker recovery. Установщик берёт limits из Compose с `--profile reports`.
Секреты, private stderr и payload закупок в journal не выводятся. Внешние копии,
Telegram и новые платные сервисы отложены по последнему уточнению владельца.

Production maintenance actor должен иметь привилегированный доступ к фиксированному
root0600 lock и policy. Это не право браузерного пользователя. `aemr-maintenance.conf`
восстанавливает lock после reboot; service повторяет tmpfiles create перед каждым
probe, не меняя inode существующего файла. Установщик владеет тем же lock на весь
сценарий. Доступ непривилегированного SSH-оператора не предполагается автоматически:
до выпуска требуется подтвердить actor либо настроить явно ограниченный privileged
maintenance путь. Не обходить недоступную policy или lock.

## Common Failures

- `AEMR_API_KEY is required when NODE_ENV=production`: set `AEMR_API_KEY`.
- API returns 401 in browser: set `localStorage.aemr_api_key` to the production key.
- Google Sheets returns permission errors: share every required spreadsheet with `GOOGLE_SERVICE_ACCOUNT_EMAIL`.
- Data disappears after container rebuild: verify `SQLITE_PATH` points to `/app/packages/server/data/aemr.db`.
- Vite warns about large chunk: build is valid; code splitting is a future optimization.
