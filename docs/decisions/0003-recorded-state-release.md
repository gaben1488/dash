# Выпуск подтверждённого состояния учёта

Требование продукта: при корректных обязательных данных выпуск должен состояться;
конкретный пробел доказательства не заменяется выдуманным событием. Исторический
ответ на рекомендацию, исчезновение строки и результат торгов не доказывают
заключение, исполнение или оплату контракта.

Безусловные запреты `IDENTITY_HISTORY_SCOPE_INCOMPLETE`,
`RECOMMENDATION_CURRENT_EVIDENCE_NOT_APPROVED` и
`PROCEDURE_EVENT_OVERLAY_NOT_INTEGRATED` не являются проверками данных: они
блокируют любой набор. Заменяем их проверяемым контрактом состояния учёта.

Обязательны: полный неизменяемый снимок зарегистрированных источников, закрытые
зависимости формул, сохранённые наблюдения идентичности, отсутствие ошибок QA,
независимый пересчёт, все разделы ReportModel, происхождение показателей и
согласованность проекций. Последний барьер версий, целостность файлов и атомарная
фиксация остаются обязанностью PublicationStore.

Денежные показатели и количество позиций берутся из первичных master-строк.
Процедуры и доли имеют отдельные сущности и проверяются по оперативному реестру.
Результат торгов не накладывается на денежный факт master-строк. Отсутствие такого
наложения — установленная семантика, а не незавершённая реализация.

Неразрешённая идентичность не исключает строку из текущего расчёта и не создаёт
событие её исполнения или отмены. Она ограничивает доказуемую историю конкретных
строк. Реестр рекомендаций сохраняется целиком; для каждой активной записи
перечисляются наблюдения и пробел связи. Без подтверждения текущий статус остаётся
UNKNOWN. Такие ограничения показываются в обоих документах и дают предупреждение.
Пропавший обязательный раздел, ошибка суммы или неподтверждённое утверждение дают
блокировку, даже если остальные проверки зелёные.

Положительный тест обязан пройти настоящий capture → build → render → publish →
read путь без подмены ReportModel или принудительного снятия блокировок. Отдельные
отрицательные тесты сохраняют предыдущий выпуск при ошибках источников и модели.
Это не заменяет приёмку реальных данных и производственного расписания.


## Полное восстановление состояния R07/R09

`restore-state` восстанавливает весь явно назначенный остановленный том,
включая основной SQLite, WAL/SHM, operational snapshots, reports, Word и историю.
Это отдельная операция восстановления, не допуск выпуска. Контроллер обязан
закрыть ingress, остановить всех writers и удерживать проверенный EX maintenance
lock до успешной квитанции; helper не останавливает службы и не запускает их.

Обязателен точный `verified_manifest_sha256`, полученный после независимого
полного scratch-verify этой же неизменяемой private backup. До любого удаления
проверяются digest, состав/байты архива, безопасные пути/атрибуты, отсутствие
пересечения и symlink, возможность сохранить ownership и свободный резерв.
Поддерживаются существующие форматы 1 и 2. Недостаток доказательства запрещает
мутацию; сам вычисленный hash не заменяет внешнюю приёмку и EX-контроллер.

Восстановление идёт непосредственно в назначенном томе, без второй полной
копии. Удаляется содержимое только этого тома; private backup и соседние пути
неизменны. Резерв проверяется с учётом освобождаемого замещаемого содержимого.
При прерывании том остаётся offline; повтор с тем же verified backup заново
восстанавливает его до точного manifest inventory. Это идемпотентность recovery,
а не атомарное переключение работающего приложения.

После проверки SQLite/Word любые созданные SQLite sidecars восстанавливаются
к зафиксированным байтам и атрибутам из той же копии. Финальная квитанция требует
полного exact inventory. До неё запрещены восстановление ingress и запуск
служб; production rollback и реальная проверка контроллера остаются отдельной
незавершённой эксплуатационной приёмкой. История и документы не переписываются.


### Резерв попытки копирования R06

Дешёвый read-only disk-budget admission работающего тома разрешает лишь попытку
backup window: он не доказывает размер сжатого архива, целостность или frozen
состояние. После graceful quiescence выполняется одна фактическая полная
сжатая копия. `create --reserve-bytes` задаёт сохраняемый дисковый резерв
(целое число не меньше 128 MiB; прежний default 128 MiB); существующий
`--reserve-scratch` дополнительно сохраняет место полного scratch restore.
Фактический compressed writer ограничен этим бюджетом, plain capture сохраняет
проверку места для копии и scratch. Частичная неудачная копия удаляется без
изменения исходного тома. Недостаток места, изменение источника или ошибка
копирования запрещают дальнейший выпуск и требуют восстановления исходного
runtime контроллером окна. Независимый scratch-verify и финальный source-match
той же immutable backup обязательны; admission бюджета не заменяет их.

Бюджет является best-effort admission и ограничением потока архива, а не
абсолютной гарантией против параллельных writers на том же диске. После fsync
manifest и до приёмки backup проверяется фактически наблюдаемый свободный
floor: requested reserve плюс полный scratch, если он запрошен. Это учитывает
manifest и filesystem overhead; недостаточный floor удаляет staging и блокирует
приёмку. Новые внешние записи после проверки могут изменить свободное место,
поэтому независимый verify и контроль runtime остаются обязательными.

### Полный release recovery controller: исходный контракт R09

`deploy/release_recovery.py` предназначен для отдельного, явно вооружённого
release window. Обычный `NOT_ISSUED` или ошибка бизнес-публикации не создаёт
pending receipt. Trusted controller сохраняет root-owned 0700 каталог
`/var/lib/aemr/release-runtime` и 0600 resolved Compose, candidate Compose,
env и Caddyfile; все digest связаны с точным release SHA, manifest SHA и
четырьмя прежними image ID. Независимые full scratch, in-place restore и
previous-runtime compatibility proofs обязательны. Названия состояний без
этой связи не являются доказательством. Receipt не содержит команд или
произвольных путей; private конфигурация не выводится в диагностику.

Arming и recovery требуют фактического kernel EX-lock существующего
maintenance inode. Перед arming запрещены прямые API/web published ports и
host networking; ingress закрывается до candidate writes. Recovery сначала
останавливает owned runtime и отвергает стороннего RW writer тома. Полный
restore выполняется проверенным stdlib helper **в самом lock-owning host
процессе**, в Docker-validated local server_data Mountpoint: detached Docker
restore не используется. SIGKILL прекращает filesystem writer вместе с
владельцем EX; следующий владелец повторяет interrupted restore из того же
immutable checkpoint без второй полной scratch копии.

Прежние services создаются из digest-bound resolved конфигурации и image pins.
После exact state receipt проверяются old API health и три native Word hashes;
до запуска worker/ingress fsync сохраняет private `runtime_resume` progress,
связанный с полным pending plan hash. После этой границы повторный recovery
не перезаписывает данные checkpoint заново: новые записи уже возвращённого
runtime должны сохраниться. Pending удаляется только после восстановления
captured running/stopped состояния services. Ошибка сохраняет pending и
закрывает ingress; ordinary guard start до recovery запрещён.

Это исходный executor и synthetic filesystem/process приёмка, а не утверждение
о production rollout. Ещё обязательны интеграция trusted controller/guard,
фиксированный root executable, systemd read/write bindings к approved backup
и owned volume, достаточный recovery timeout, независимое review и реальный
закрытый release drill. Сам executor не подтверждает происхождение внешних
proofs и не заменяет проверку их trusted workflow producer.

Если процесс погиб после durable удаления pending, оставшийся progress удаляется
только при совпадении completed receipt по full plan SHA, manifest и exact restore
proof. Неподтверждённый orphan блокирует новый arm до runtime mutations. Очистка
progress также fsync; он никогда не удаляется раньше pending. Проверка сторонних
writers охватывает canonical RW bind paths самого тома, его потомков и предков;
RO mounts не объявляются writers.

### Trusted producer, independent trial и durable ACCEPT

`release-controller.py prepare` вызывается под уже удерживаемым fd9 EX; stdin
содержит строго bound plan, а не команды. Workflow до него root-приватно
сохраняет prior resolved Compose/env/Caddyfile, candidate resolved Compose и
`candidate-Caddyfile`, image IDs и `source-ci.json`. Последний содержит реальные
CI run/jobs и exact source SHA → candidate image map от trusted image-build
workflow; существующий `source_ci_gate.py` проверяет три immutable source jobs.
Producer дополнительно сравнивает prior environment/command/entrypoint/user/
working directory/mounts с actual owned Docker runtime и выполняет source-match.
Он создаёт только private `trial-plan.json`, не pending и не новый runtime.
Структурные proof labels в input plan до trial не являются эксплуатационной
приёмкой и никогда не заменяют actual trial receipt.

На независимом runner `release_trial.py` получает эту же private конфигурацию,
архив/manifest и загруженные exact old/candidate images. Fixed scratch root —
`/var/lib/aemr/release-trial-clone`. Один фактический full restore создаёт clone;
candidate-owned `initialize-publication-readers` выполняется только на нём.
Candidate native `createApp()` импортирует существующий additive SQLite DDL;
`app.inject()` обращается только к health, latest release и трём native DOCX,
проверяет actual shared schemas и всю published/weekly assurance history.
`preloadData()`, listen, Google/network, generation и refresh не вызываются.
Контейнеры network-none/read-only, clone RW, UID1000, no published ports.
Private env выводится из resolved environment, без повторной dotenv parsing.

Затем exact previous server image читает тот же candidate-modified clone через
тот же native GET boundary. После закрытия обоих runtimes реальный
`restore_state` возвращает этот же clone к exact manifest — второй полной
копии нет. Receipt привязан к полному plan hash, manifest, четырём old и
candidate image IDs, config/tool/source-CI/module/native-program hashes и
actual full/in-place restore counters. Workflow переносит его в fixed private
`trial-proof.json`; stdout receipt не публикуется в Actions logs/artifacts.
Ошибочный API/auth/schema/Word/previous runtime, interrupted container или
несовпадающий digest запрещает producer mutation. Helper admission места
использует фактический свободный объём runner уже после загрузки archive/images.

`release-controller.py deploy` снова проверяет все bindings, actual stopped
owned writers и fresh source-match под тем же EX. Только затем он вооружает
recovery, создаёт candidate services без запуска и запускает лишь API/web.
Candidate index владеет reader bootstrap до первого listen. Caddy и worker
закрыты до actual health/shared-schema/native-three-Word acceptance.

**До первого candidate worker/ingress start** fsync записывает строгую
`candidate_accept` phase с exact plan/candidate images/config/native Word
binding. `recover()` после неё никогда не распаковывает старый checkpoint и не
возвращает old images: только повторяет проверки и возобновляет accepted
candidate. Это сохраняет пользовательские записи при SIGKILL после открытия
perimeter. До этой phase ошибка использует полный verified old-state recovery.
Обычный NOT_ISSUED остаётся вне этого контура. Все pending/progress удаляются
только после durable completion; доказанный orphan очищается отдельной проверкой.

Synthetic tests выполняют реальные SQLite/DOCX restore, kernel EX/SIGKILL и
Node/Python ZIP driver с synthetic API mocks. Это не live browser/edge proof.
Реальные pinned image trial, trusted receipt transfer и fixed same-owner guardian
continuation остаются обязательной workflow приёмкой до первого production
выпуска. Учёт original running state не включает blanket worker admission:
workflow отдельно сохраняет и восстанавливает prior approved guard policy.

### Same-owner guardian continuation

Существующий backup guardian допускает release handoff только при двух явных
флагах `--quiesce-worker --release-controller`, root actor и fixed private backup
base. Прежние пять/шесть аргументов сохраняют 30-minute backup window; только
release opt-in имеет 45-minute deadline. До stops сверяются installed controller,
recovery, trial, backup и source-CI gate hashes с exact candidate Git blobs.
Перед dispatch проверяются те же hashes, boot/deadline и private plan hash;
минимум 15 минут должно оставаться. Fixed root0600 `guardian-request.json`
содержит лишь candidate SHA, run ID и plan hash — никаких команд/путей.

`request-release` лишь ставит запрос. Именно guardian вызывает fixed controller
как inherited-fd9 child; отдельный SSH requester не приобретает другой EX и не
может выполнить `release-dispatch`. Controller/CLI descendants сохраняют actual
lock descriptor, чтобы живой CLI не продолжал mutations после потери owner при
уже свободном EX. Сам data restore остаётся host-process operation.

После arming/recreation запрещён captured-old-container-ID resume. Наличие
pending ведёт только к fixed full recovery; matching strict accepted/recovered
completion завершает custody. Только pre-arm отказ с unchanged runtime разрешает
старый healthy same-ID resume. Неудавшийся pending recovery освобождает guardian
custody для systemd recovery, а не допускает ordinary start. Controller ограничен
оставшимся window timeout; full recovery имеет отдельный 35-minute timeout.
Продолжающийся daemon RPC после уничтожения самого Docker CLI не считается
доказанно отменённым: это обязательный actual Docker-clone operational drill,
который process/kernel tests не заменяют. Live activation всё ещё отдельно.


### Исполнительный путь и устранённые пограничные ошибки — 15.10.2026

Existing maintenance workflow now содержит controlled-candidate-release только
для owner label на PR79 и разрешённой ветке. Source CI и OCI revision pins
проверяются до остановок. Stage сохраняет конфигурацию реально работающих
контейнеров; base-plan связывает её с новой private backup. Текущий PR HEAD
проверяется повторно непосредственно перед request-release. Исторический
manual CI deploy намеренно отказывает до SSH, чтобы не было второго runtime
writer path. Эта запись описывает исходники, не свидетельствует о live-выпуске.

Compose `config --format json` экранирует literal `$` как `$$`. Producer
декодирует этот транспорт ровно один раз до сравнения с Docker inspector;
повторный Compose replay кодирует literal один раз. Проверка использует
настоящий Compose CLI, synthetic bcrypt и shell arguments; строковые секреты
никогда не выводятся в отчёт. Активный Caddyfile монтируется из immutable
root-private `release-configs/<SHA>/`, а не из перезаписываемого staging path.
Изменение содержимого под тем же SHA блокируется. Стекло UI этой операцией
не управляет и не определяет source/release semantics.

Installer сохраняет весь утверждённый runtime-policy файл побайтно и с тем же
inode; небезопасная/некорректная прежняя policy запрещает замену executors.
Inline Python запускается isolated `-I`: actual root regression показал, что
`json.py` в operator-owned рабочем каталоге иначе выполнялся до валидации.
Trusted installed script CLI использует `-Es`, сохраняя imports только из своего
root-owned script directory, без PYTHONPATH/user-site override.

`request-resume` не крадёт EX: guardian приоритетно обрабатывает bound private
cancel-request, сам выполняет recovery/resume под тем же fd9 и не продлевает
окно. Отсутствие открытого окна не выдаётся за проверку здоровья. Наличие
accepted completion запрещает возврат к captured старым IDs. Полная независимая
проба и source-match остаются обязательными, даже если synthetic proof зелёный.


Уточнение 15.10.2026 после release38686544390: bare GET /api/report-releases
возвращает latest/attempt, тогда как date/year/quarter задают selected/attempt.
Релизный gate не должен подменять один ответ другим или выдумывать контекст.
Preflight/capture/trial/acceptance проверяют соответствующую реальную схему;
проверки периода остаются на SelectedReportReleaseStatusSchema. Тесты внешнего
ответа используют publication_reader вместо придуманного selected на bare GET.
Этот отказ произошёл до любых install/freeze; NO_OPEN_WINDOW в cleanup означает
только отсутствие сессии, а не доказанное здоровье production.


## C07 — области хранения снимков (подготовка следующей итерации)

По последнему решению владельца сохраняется недельная история, без отдельного
семидневного пула ежедневных версий. Недельные победители выбираются раздельно
по сохранённому spreadsheetId и явно записанному metadata.targetYear: null
означает все годы, целое число 2020–2100 — конкретный расчётный год, как у getSnapshot. Это область расчёта,
не постоянная идентичность закупки. Разные области не вытесняют друг друга.
Дополнительно сохраняется самая поздняя хронологическая голова каждой области,
даже если более ранний недельный контроль содержит более полные доказательства.

Отсутствующая/невалидная область старого снимка не угадывается: такой снимок
сохраняется до доказанной миграции. Нечитаемые даты, существующие корни решений
и их прежние версии также сохраняются. Метаданные, сырые факты и ссылки истории
не переписываются; автоматическая чистка не является допуском live-миграции.
Это исправление retention, а не реализация архитектуры полного live+diff.

Сохранение неизвестной legacy-области не даёт ей права заслонять контроль:
metadata SQLite cursor предшествует потребительскому отбору и результатному
лимиту. Raw-чтение проверяет кандидатов по одному до пригодного донора.
Integrity и cron используют прежнюю общую строгую проверку контекста/атомов;
она перенесена в service без изменения, route exports остаются совместимыми.
Lineage хранит только запрошенные контрольные дни: последний проверенный срез
дня имеет приоритет над более новой неполной попыткой. Если ни одна попытка
дня не пригодна, остаётся явный разрыв. Число отклонённых попыток объясняется,
ID и время выбранного доказательства остаются фактическими. Исторические
записи и metadata не переписываются; metadata API истории не меняет смысл.
