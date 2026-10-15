# AEMR — план и контрольный список покрытия

**Статус:** канонический план. Поглощает `PRODUCT_PLAN.md`, `AGENT_*_HARNESS_*.md`,
`PROJECT_KNOWLEDGE_HANDOFF_*.md` (история сохраняется; устаревшие решения отмечаются явно). Новых планировочных файлов не заводить.

---

### Текущая приёмка Header и выпуска — 15.10.2026

PR #79: source SHA `1118899d`, CI38692995115 — три обязательных
source jobs PASS (включая C07 и memory fix); read-only runtime job не зелёный. Release38687954214
прошёл сборку и настоящий latest/3Word preflight, но остановился ДО stage,
freeze и backup: installer не принимал сохранённые Compose memory limits
строками байтов. Исправление сохраняет policy bytes/inode/owner; 5 тестов
установщика, включая реальные root-проверки, PASS. Предыдущая ошибка
Selected-versus-latest исправлена в 30cfd691 и проверена на живом ответе.

Диагностика38691770346 (15.10 06:20 UTC): API healthy, 0 рестартов с13.10;
воркер a2b6a1b9 перезапущен429 раз, Docker events подтверждают OOM/137.
Текущее OOMKilled=false после нового старта не опровергает предыдущий OOM.
687 статусов попыток занимают1 557 253 252 байта; startup recovery удерживает
полные JSON вместо нужных полей. Три bounded-process RED регрессии подтверждают
накопление статусов в recovery/retention и удержание прошлого payload при
проверке следующего. Минимальный fix сохраняет только нужные поля в памяти,
освобождает предыдущий объект; исходные JSON, порядок, protections и hash-checks
не меняются. Независимые28 tests и differential old/new PASS; Root full1074 PASS
(192.35s), 5 root-installer cases отдельно приняты source3b3c2ba7.
Общий новый exact-SHA CI и live ещё открыты.
Диск: 0 свободных байт при3 626 530 свободных inode; published27 201 253 376,
attempts4 262 563 840, archives385 130 496 байт. Cache38691885273 PASS, но
кэш пуст:0 байт освобождено; контейнеры/образы/тома сохранены.
Диагностика38692225313: backups9 519 890 432 байта, из них две копии12.10
по2,439GB и принятая13.10 копия4,591GB. Подготовлена retirement-операция
ТОЛЬКО двух старых archive blobs, с проверкой принятого архива38349415596,
maintenance EX, отсутствия pending/quiescent; все receipts остаются. Фактический
run38693046852/job116283156947 SUCCESS: 2 старых blobs удалены,
4 877 082 741 logical bytes; доступный free вырос0→2 636 230 656 байт.
Архив38349415596 и receipts сохранены; это не свежий backup cut15.10.
Выпуск остановлен до устранения нехватки места и памяти.

Операционная граница перед следующим выпуском: quarantine применяется только
к доказанному a2b6a1b9 OOM worker, под EX и при свободных run/weekly locks;
API/образы/данные не откатываются. Первый live run38695409469 не принят,
readback06:58 подтверждает прежний running worker453restarts и API0restarts.
Добавлена безопасная диагностика типа ошибки/номера строки без её содержимого.
Остановка не объявляется выполненной до durable quarantine receipt.
Сначала offline recovery закрепляет сохранённый weekly input, затем retention
удаляет только прежние transient payloads; процесс изолирован от API, без сети,
сам удерживает реальный EX и ограничен420s. Native old-code+3module cold smoke,
14 admission negatives и реальные child-EX/lifetime checks PASS;11 repo wrapper
checks PASS. После полного принятого release отдельный worker-start проверяет
точный accepted SHA/новые images/конфигурацию/native API+3Word;27 worker checks
PASS. Запуск не является приёмкой двух самостоятельных циклов.

R08: две принятые автономные итерации12.10 остаются историческим
доказательством; установленный15.10 runtime из-за OOM НЕ принят.
Backup38349415596 — историческая копия, новой копией15.10 не является.
Root не останавливал API/worker и не заменял application containers в этих
двух неудавшихся release attempts; загрузка candidate images не есть rollout.

U02/U03/U07: реальный hit-test обнаружил перекрытие заголовка журнала нижней
glass-линией. Scoped z-context только открытого журнала исправляет его, не
двигая controls/rails. RED по elementFromPoint →78 layout/route states и
52 motion states PASS; 28 affected component tests и11 builder/probe tests PASS.
Проверяются title/3tabs, filter popup, keyboard/Escape, outside close, миллионы,
offline HTML/ZIP self-download/reopen и13вкладок/12семейств палитр. Прежняя имитация масштаба через
body.style.zoom ошибочно называлась browser zoom. Product body zoom не задаёт;
200%-equivalent layout теперь CSS640×450/DPR2 при физических1280×900.
Unsupported CSS bodyzoom2/offscreen Radix diagnostic сохранён отдельно.
Синтетический preview не объявляется live Google mutation или полной UI-приёмкой
всех страниц. Existing CI выдаёт HTML/ZIP artifact exact PR HEAD, synthetic only.

R07/R09: private producer/guardian workflow реализован; текущий допуск
остановлен проверкой до rollout. Реальные negative tests нашли отсутствие восстановления при
пропавшем контейнере и потерю EX дочерней CLI после SIGKILL owner; исправления
проверяются до любого stop/recreate VPS. Accepted candidate data нельзя
перезаписывать checkpoint после открытия ingress. Целевые W1–W5 и56 ID не
закрываются этим Header/release-блоком; новые пожелания не расширяют текущий
выпуск, если не устраняют воспроизведённый дефект.


R07/R09 current source: trusted stage/base-plan/prepare/trial/deploy connected
in existing maintenance workflow, opt-in owner label only for PR79/exact current
HEAD, with a second current-head check after the independent trial. Legacy CI
manual deploy declines before SSH; it cannot invoke its historical unsafe path.
All private backup/config/previous images stay off public artifacts/logs. One
full independent clone runs candidate native reader/API/3Word, then the exact
previous runtime, then full in-place restore; no second full clone is needed.
The same guardian retains EX throughout freeze → prepare → deploy/recovery.
Cancellation requests immediate same-owner resume; accepted releases never
restore a pre-release checkpoint over new user data.

Independent review produced concrete RED cases: missing containers during
interrupted recreation, child Docker CLI outliving the lock owner, mutable active
Caddy bind source, Compose dollar double escaping, prior policy replacement and
root Python importing an operator-directory json.py. Fixes preserve incomplete
recovery custody, immutable SHA-addressed Caddy config, single Compose decoding,
exact approved policy bytes/inode and isolated inline Python imports. This is
source verification, not a claim of actual Docker daemon RPC cancellation or
production rollback. Closed-ingress acceptance reuses real shared schemas and
existing Header validators for actual latest report, Dashboard and four Header APIs;
only startup503 repeats. Bad auth/schema/oversize fails before durable ACCEPT.
Local frozen full report engine1075 PASS (193.13s), four-package TypeScript
and lint PASS (304 existing warnings). Guardian23, backup32 and recovery32 source checks PASS. Latest-envelope
correction: window38 and controller39 PASS, including real reader/native Zod
negative cases and exact staged Word proof with a legitimately newer latest. Actual image clone/live release remain required.

### Управление текущим выпуском и зависимостями — 13.10.2026

Единственный кандидат — PR #79; единственный реестр результатов — #69.
SSH-пакет передан в [#93](https://github.com/gaben1488/dash/issues/93#issuecomment-6135986701).
Последнее уточнение владельца: второй SSH-агент недоступен, Root выполняет
runtime-сценарии самостоятельно через существующий Actions SSH-доступ.
Предыдущее задание не объявляется принятым/выполненным другим агентом;
runtime stop/recreate/update выполняет один владелец под maintenance lock.

Последовательность выпуска имеет конечные входы и выходы:

| Этап | Ответственный | Выход для следующего этапа |
|---|---|---|
| Установленный код и диагностика двух GET | Root через Actions SSH | Точные image/source pins, полный доступный программный diff, причина задержки journal/sources |
| Интеграция | Root, PR #79 | Один SHA, сохранённые runtime-исправления, проверки всех затронутых потребителей и исторических схем |
| Reader-fence и восстановление | Root под maintenance lock | Корректный owner/quiescent bootstrap, свежая согласованная копия, независимый restore и previous-runtime proof |
| Допуск | Root | READY для exact SHA после source/live/restore gates; не обещание выпуска |
| Выпуск и приёмка | Root; независимое source review до запуска | Установленный exact SHA, domain/browser/API/Word readback, сохранённый rollback |

Каждая зависимость привязана к конечному ID, SHA/revision, исполнителю,
проверяемому выходу и конкретному блокеру. Новый SHA или источник повторяет
только затронутые доказательства; принятые R08 циклы не повторяются. Новые
пожелания включаются в существующий ID и следующую волну, если не исправляют
дефект текущего выпуска. Целевая модель W1–W5 сохраняется и уточняется после
live-приёмки; выпуск не объявляется завершением всех 56 результатов.

Source-only передача установленного кода через существующий SSH CI при
недоступном прямом SSH: приватный scratch, allowlisted code roots,
AES-GCM CMS recipient encryption, стабильный полный inventory и текущие
owned container IDs до/после, cleanup при отказе. Это не backup данных и
не доказательство полной воспроизводимости образа: web assets/dependencies/
templates/config отдельно требуют handoff или точного image pin.

Source capture38332200765/job115084240155 SUCCESS, ciphertext SHA256
`21f6fb4de83ed38c07a1857e4a9058a207d2804c8a2a149e3a26906022f6cd52`:
361 программный файл, 353 blob уже есть в Git. После нормализации CRLF
неопубликованная полезная TS-разница — два preload closing guards и порядок
stopWebhook перед сбросом логгера. Python-разница для сохранения — derived
report-health index/status, без переноса старых reader/retention модулей.
API/worker actual image a2b6a1b9…, web1b325fc0…, restarts0; контейнеры не
пересоздавались. Capsule аутентифицирована перед распаковкой в private workspace,
не является backup бизнес-данных. Первую transport capsule отклонил SHA-гейт:
автоматическая маскировка короткого секрета повредила случайный base64 ciphertext.
Framing символов исправлен с RED→GREEN; секреты и plaintext не публиковались.

В текущем рабочем дереве паспорт /sources читает existing health source cache
без Google/pipeline IO, сохраняя индивидуальные clocks и настоящий0. Журнал
ключует оба кеша по immutable file ID и разделяет конкурирующие/поздние ответы.
Source tests и независимый review есть; установка/live latency ещё не приняты.
Report-engine1069 PASS относится к интегрированной observability; новый индекс
не участвует в publication eligibility и его отказ не отменяет проверенный выпуск.

Source-гейт текущего дерева: shared734/core1869(+1skip)/server971/web2275 —
5849 PASS,1skip; Python1069 PASS. Ruff проверяется закреплённой проектом
версией0.16.9: случайно установленная latest0.17 выявила43 новых диагностик
на прежнем коде, не была использована для массового переписывания. Runtime
source-job admission отличает три обязательных source jobs от наблюдения
прежнего installed API; проверяет repo/workflow path/event/SHA/уникальность
jobs. Три source jobs теперь явно checkout-ят PR HEAD, а не default merge tree.
Live и recovery gates сохраняют отдельные результаты, не объявляются PASS.

Последнее продуктовое уточнение по U03/U06/K06/K10: выбранные Header-кнопки
обязаны меняться на палитру «Зари» текущей вкладки; сам журнал виден справа,
не только в раскрытой панели. Native Google обсуждения показывают автора,
ответы и раздельные состояния «открыто/отвечено/закрыто» с исходным временем;
ответ в Google не закрывает Dash-case автоматически. Автоматическая история
ввода ячеек не входит в счётчик обсуждений; оригиналы доступны как метаданные
строки/ячейки реестра и редактора: hover/focus, click вне edit, контекстное меню
с keyboard/touch альтернативой. Смешанные/неопознанные notes нельзя молча
отбросить или назначить им автора по подписи внутри текста. Это требования
текущего выпуска; проверка actual HTML/API и отсутствие style/motion регрессий
обязательны, утверждённый «Пульс» не переделывается.

### Допуск к резервной копии и исправленный HTML — текущая итерация

Рабочее дерево: backup-window поддерживает только явный шестой аргумент
`--quiesce-worker`; прежний five-argument путь не запускает worker. TERM
дожидается завершения цикла/exit0; EX guardian проверяет исходные IDs/images/
volume. Read-only compressed capacity preview предшествует остановкам.
Failure/owner-loss/resume сначала подтверждают healthy API и только затем
возвращают ранее работавший worker. Реальный stdin-вызов `bash -s` охраняется
тестом; recovery script берётся из exact candidate Git blob. Root23 и independent23
синтетических/локальных kernel-lock теста PASS. Live окно ещё не запускалось;
30-минутный guardian включает preflight/drain/copy/transfer/restore, поэтому
истечение даёт безопасный resume и отказ source-match, не приёмку backup.

HTML обновлён на месте: actual Header и существующие stores/ThemeProvider,
без18статичных PNG. Reproducible source generator плюс synthetic-only fixtures
содержат13 интерактивных палитр/пресеты и видимый журнал. CSS одной строкой
привязывает только цветной Header halo к выбранной «Заре»; нейтральные границы,
геометрия/анимации/OrgStrip/«Пульс» сохранены. Public source/config/lock digest,
embeddedfonts/selfdownload HTML+ZIP; ~3.22MB вместо17.87MB. Author26palette×3
viewport/zoom/keyboard/negative panels/offline proof и независимый source review
PASS; Root повторяет browser/build проверки после интеграции. Артефакт учебный,
не доказательство production/auth/data и не часть public Git с бизнес-данными.

Root browser proof:78route/theme/viewport/zoom views, keyboard, panels,
HTML/ZIP selfdownload/reopen offline PASS; полный web2275 PASS и web build PASS.
CommentFeed дополнен явным наличием ответов отдельно от закрытия Google,
временем сообщения/изменения отдельно от сохранённого чтения;8tests и
independent8 PASS. «Отработано» не переводит OPEN в RESOLVED. HTML содержит
учебные состояния открытого/закрытого обсуждения, не имитирует production Google.
Полная метаистория всех ячеек ещё не принята: существующий timeline ограничен
поддерживаемыми столбцами и физической привязкой, автора не передаёт. Нельзя
объявлять этот неполный DTO полной историей или подменять автора текстом notes.

CI38337712402 на37485061: TS/image SUCCESS, Python5fail/1064PASS.
Причина — прежний guardian fixture с устаревшими аргументами: watchdog timeout
оставил lock и вызвал четыре вторичных отказа. Maintenance38337803397 отменён
до допуска, quiesce/copy SKIPPED, cleanup/resume SUCCESS: runtime не остановлен.
Fixture теперь вызывает actual recovery script/private record и освобождает
lock в finally;19consumer tests PASS, pinned Ruff PASS, independent review PASS.
Следующий backup требует свежие три source jobs на исправленном SHA; прежний
1069PASS до изменения backup ABI не переносится на этот новый код.

После исправления fixture Root полный report-engine1069 PASS (184.11s).
R07/R09 code prerequisite: restore-state восстанавливает полный остановленный
designated volume из форматов1/2 без дополнительного24GB scratch; перед первым
удалением проверяет verifiedmanifest/content/boundaries/ownership/netcapacity.
Root35 и independent35 filesystem tests PASS: badarchive/digest/paths не меняют
source, interrupted retry и реальный незавершённый WAL сохраняют полный exact
inventory/owner/mode; private backup неизменна. ADR0003 обновлён перед кодом.
Это ещё не production rollback: durable release-owner-loss recovery, внешнее
full-restore под тем же EX owner, previous-image compatibility и закрытый ingress
до acceptance требуют полного контроллера. Нельзя выпускать по одному helper
или запускать плохой candidate обычным guard после потери release-актора.

CI38339254633 на3392e6c0: все три exact-source jobs SUCCESS, native journal
по-прежнему несовместим со старым installed producer. Backup38339331538
остановился до preview/drain/API stop: BACKUP_GUARDIAN_FAILED. Read-only
38340260654/job115109424712 подтвердил actorUID1000, sudo-n доступен,
root-owned lock0600/writablefalse и настоящий Permission denied в watchdog;
guardian-ready отсутствует, APIhealthy/worker running/OOMfalse/restarts0.
Исправление использует sudo-n для трёх maintenance calls, Git делегирует
проверенному owner repo через runuser; lock/repo permissions не ослабляются.
Root0700 архив экспортируется sudo-cat только в private runner files.
Root29 kernel/fixture regressions и independent source review PASS;
NOT_ENTERED cleanup не утверждает API health и не маскирует начатое окно.

Google API сверена через Context7 и свежую официальную discovery revision
20261007: commentsViewMode/comments/commentAnchors действительно доступны.
403 чтения обсуждений отличается от доступности notes и не означает0comments.
Native Post использует commentAction, Drive — action; пустые RESOLVE/REOPEN
не считаются человеческим ответом, действия с текстом сохраняются.
RED1→GREEN10, independent10/type/lint PASS. Оригинальные posts/anchors/status
сохраняются; Google-closure не закрывает Dash-case. Источник спецификации:
https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets

Live checkpoint f25d465c: CI38341910345 три source jobs SUCCESS,
общий FAILURE — старый installed journal без row-identity-candidate.
Backup38342248590 дошёл до readonly capacity preview и отказал
BACKUP_PREFLIGHT_FAILED до TERM/API stop; guardian завершился после снятия
pre-window marker, поэтому внешний resume вернул GUARDIAN_UNAVAILABLE.
Public health HTTP200/statusok; read-only38343699815/job115120166320 подтвердил
оба runtime running, APIhealthy/OOMfalse/restarts0, root EX уже был доступен.
Его ограниченный preview прошёл inventory, затем завершился TimeoutError
на compression при120s/0.5CPU/256MiB. Это не доказательство причины прошлого
отказа или недостатка диска. Full copy/independent restore/source-match ещё
не приняты; source mutations/worker generation/recreate и удаление данных
Root не выполнял. Следующий шаг — надёжный bounded admission/capture protocol
для меняющегося состояния, затем same-owner release/rollback; не новый слепой
повтор полной генерации или глобальное восстановление API.

### Коррекция backup admission — 13.10.2026

До quiescence проверяется только свободный disk budget ≥4 GiB, без полного
чтения/hashing/compression живого тома. Это допуск попытки, не доказательство
размера или целостности. Одна фактическая frozen copy использует gzip level1,
archive-byte budget с резервом1 GiB и финальный observed floor после fsync
manifest; другие host writers не дают абсолютной гарантии будущего остатка.
Частичная ошибка удаляет только свой staging и возвращает исходный runtime.
После отказа до первого TERM/stop private candidate/run-bound not-entered
разрешает cleanup без ложного утверждения «API восстановлен»; started markers
и symlinks запрещают такой shortcut. RED4 + guardian-symlink RED1 → Root32
kernel/consumer tests PASS, reserve43 Root/independent PASS; полный Python
1069 PASS (213.38s). Проверки выполнены последовательно: общий /run/lock
не допускает конкурирующих kernel-fixtures.
Fresh production copy/independent restore/source-match пока не выполнены;
обязательность всех трёх сохраняется. R08 повторно не принимается.

### Fresh copy и возврат runtime приняты — 13.10.2026

SHA `abe5a4b4105b4d7102edaa7bd782226dc8f4c9c8`, CI38349045793:
три exact-source jobs SUCCESS; общий CI FAILURE относится к старому installed
journal, deployment SKIPPED. Backup38349415596/job115138139276 SUCCESS:
05:03:05UTC cheap budget admitted;05:07:55UTC полная копия,5416 entries,
31 246 433 430 logical bytes,4 589 649 313 archive bytes.05:19:26UTC
independent scratch-verify PASS:93SQLite/215DOCX;05:20:19UTC frozen source-match
PASS;05:20:36UTC original healthy API + authorized prior worker resumed.
Все private runner copies/keys удалены; archive сохранён наVPS, public artifacts
бизнес-данных отсутствуют. Public health после resume HTTP200/statusok.
Это R06 evidence текущего cut, не свежесть для более позднего изменившегося
состояния и не R07/R09 full production rollback/deployment acceptance.

Header normal/reduced motion:Root52states13pages×2themes×2motion PASS на
artifact58ced9b9/sourceDigestf3215792…,0HTTP/JS, OPEN→RESOLVED→OPEN не меняет
сам факт наличия ответа. Это Header-only/offline proof, не все13productionpages.
Native REOPEN mutation этим не подтверждается. Исходные78layoutviews сохраняются.

K06/K10/U06 metadata gap подтверждён: CommentFeed показывает всеcell_note,
а SQL LIMIT20 применяется до отделения pure history notes. Такие заметки могут
вытеснить настоящие native обсуждения. Legacy total считает только Drive-cache;
witnessHistoryTotal включает технические reading/legacy виды, неhuman threads.
Следующий concrete block: exact shared notation parser, discussion selection
до pagination и separate physical-cell metadata access Registry/editor. RAW и
mixed/human/malformed notes сохраняются; адрес/readAt не доказывает идентичность
закупки после переноса строки. RowDto ещё не содержит доказанных sheetId/fileId;
провенанс автора/перемещения не угадывается. Этот модуль PARTIAL, не DONE.

### Обсуждения и адресные метаданные — 13.10.2026

K06/K10/U06: exact parser отделяет только доказанную текстовую нотацию истории
значений от обсуждений до ограничения выдачи. Mixed/malformed notes и RAW
сохраняются; totals считаются версиями свидетельств, не числом уникальных
разговоров. Один SQLite iterator заменяет повторные OFFSET/sort; 420 history
versions не вытесняют human/native discussion. Старый API сохранён.
Registry/editor открывают сохранённые notes выбранного физического адреса;
неполный/отказанный reading не равен отсутствию истории. Открытие и закрытие
метаданных сохраняет draft/focus, не вызывает запись. История строки сбрасывает
cache/pending при смене управления или физической строки; два реальных RED
показывали старую историю в новой карточке, после keyed scope оба GREEN.
Связь с переместившейся закупкой, Google author и время ввода не домысливаются.
Native reply/closed status отделены от Dash case closure. Hover/context menu
и объединённая cell-level история журнала/diffs ещё не объявляются готовыми.

Root current source: последовательный полный TS-гейт 5876 PASS,1skip
(shared735/core1869/server977/web2295),4types PASS,lint0errors/304warnings;
independent17-file review PASS и private14 UI regressions. Предыдущий
параллельный прогон имел один 5s timeout Report.exports; отдельный4/4 и полный
последовательный прогон прошли без увеличения таймаутов. Root affected33 UI и
12 server PASS; Header motion52 остаётся отдельным offline proof. Эта стадия
«код проверен»; production rollout/новые native browser proofs ещё впереди.

### Terminal checkpoint source0f915d7d — 13.10.2026, Камчатка

Source `0f915d7d7e7342a0ce047184792bfe3afedf5069`, CI38256694762:
code/types/tests/lint/build/audit, Python и production image SUCCESS;
DB38256694754 SUCCESS. Общий CI FAILURE из-за двух Header GET, deployment
SKIPPED. Code-функциональность журнала находится в2c5c0c4d, гейт real-sized
receipt — в0f915d7d; docs-only следующие записи не заменяют эти source proofs.

13:36UTC реальный существующий Word context12.10.2026/2026/Q4:
HTTP200/9,188,711B, SHA256
`a75c48154814679e54edc1462015b6460e9ab9293307cdb06da7c065aa5acefb`;
**полная candidate-схема PASS, selected nonempty**. Это устранение прежнего
ложного bound-отказа и настоящий historical receipt proof, не браузерная
приёмка скачивания трёх DOCX. Журнал и sources READ_UNAVAILABLE; buckets и
comments CONTRACT_PASS. Metric consumer425/0 contradictions/77 recovery PASS.
Полный release остаётся BLOCKED на API доступности и прежних source/fence/restore
prerequisites #93; accepted R08 не повторяется. Никаких production/Google записей.

### Журнал и комментарии: исправление потери свидетельств — 13.10.2026

Source commit `2c5c0c4dcb2891a9fa6e2c66f8a6007d1f1292f0`: 734 shared /
1869 core (+1 skip) / 956 server / 2275 web, четыре normal-hook typecheck,
lint 0 errors/303 прежних warnings, web build и 18 Chrome состояний PASS.
DB CI38255712570 SUCCESS. Exact CI38255712494 ещё разделяется на source
и live результаты; общий статус не объявляется зелёным.

Новый live readback13:27UTC: buckets/comments CONTRACT_PASS, journal/sources
READ_UNAVAILABLE; metric consumer425/0 contradictions/77 recovered PASS.
Исторический Word GET ответил200/9,188,710B; прежний диагностический лимит2MiB
ошибочно отклонил ответ до схемы. Bound скорректирован до16MiB с negative
oversize/invalid JSON и реальным-sized9MiB regression; строгая v1/v2 схема,
требование nonempty selected и privacy гейт сохранены. Большой status DTO
помечен отдельным целевым дефектом производительности R02/C08; его исходные
assurance/провенанс нельзя молча удалить ради маленького ответа. Нужны компактная
проекция и подробный readback из того же выпуска после source handoff.
Readonly38255712512: diagnostics PASS, schema/replay BLOCK на неизменном
PUBLICATION_READER_LEASE_UNINITIALIZED / AUTHORIZED_QUIESCENT_READER_BOOTSTRAP.

K06/K10/C07/U07: исходная спецификация
`superpowers/specs/2026-06-05-change-history-design.md` актуализирована на месте.
Последние решения по Header сохраняются. Новый параллельный план не создаётся.

В кандидате исправлены: потеря второго свидетельства при слиянии журнала/эфира;
коллизия старого ID при разных значениях; свёртка разных авторов/физических
строк/неизвестных моментов и повторных правок одной ячейки; потеря содержимого
свёрнутых ячеек. Общий Core merger сохраняет оригиналы для обеих поверхностей.
Эфир сохраняет полные значения вместо 60 символов и явно показывает observedAt.
Опасный lookup автора по последней записи физической ячейки удалён: совпадение
перехода не доказывает автора нового действия. Подписи исходного журнала и Google
сообщений сохранены. SQLite legacy IDs не переименовываются; значение входит
в ключ новых записей, повторное чтение прежней записи не создаёт дубль.

Полный журнал применяет один отбор и окно контроля к ответу сервера и эфиру.
В комментариях исходные post times/status доступны отдельно от readAt; разные
версии legacy Drive не теряются. Reading-диагностика вынесена из bounded выборки
оригинальных комментариев и содержит последний результат каждого канала.
Исходные свидетельства раскрываются внутри карточек; navigation-qa обновлён
на месте с учебными примерами, исходными ответами и новыми состояниями.

Независимое source review подтвердило удаление ложной атрибуции, сохранение
legacy истории и безопасные группировки. RED→GREEN сохранены для каждого
исправляемого класса. Сквозная live-приёмка, полная история всех ячеек от
контроля, связь служебных note-claims с ChangeLog/событиями и полноценный
workflow решений Google/Dash остаются открытыми с конечными критериями в
существующей спецификации. Не выдавать bounded SSE за полный журнал.

Read-only public health 13:15UTC: HTTP200/status=ok,2.249s. Последние source,
fence и recovery зависимости #93 не закрыты; production не изменён, R08 не
повторялся. Точные SHA/итоги следующего CI добавляются в текущий checkpoint.


### Контрольная точка source814a0056 / live12:18UTC

Source814a00565babf3f717cd71250ca8efa4ed19badf: CI38248041885
code/types/lint/tests/build/audit, Python1064 и production image SUCCESS;
DB38248041855 SUCCESS. Общий CI FAILURE из-за обязательного live admission,
не объявляется зелёным. Readonly38248041868 сохраняет reader-fence блокер.

На реальном GET /dashboard?year=2026 candidate-селектор проверил425 узлов
периода,0 count/money contradictions, восстановил годовые counts77 узлов
с отсутствующим year DTO. Source-response hashes в sanitized CI receipts;
бизнес-значения/авторы/номера не публиковались. Это live consumer proof,
не установка нового frontend и не приёмка всех144 фильтров.

12:00UTC source/buckets/comments CONTRACT_PASS; journal — ровно отсутствующий
`digest.byKind.row-identity-candidate` у установленного предыдущего API.
12:18UTC четыре Header GET не завершились за15с; Dashboard proof PASS;
проверка существующего Word context12.10.2026/2026/Q4 остановилась по
REPORT_READ/TimeoutError. Пустой future-day selected ранее проходил схему,
но сознательно больше не считается Word proof. R02/U07/live не приняты.
Public health после диагностики HTTP200,status=ok,~2.2s; Root не запускал
refresh/generation/rollback и не пересоздавал контейнеры.

Release BLOCKED: точный installed source handoff74/216 из#93 не опубликован,
reader fence не bootstrap-нут разрешённой quiescent owner-операцией,
свежий same-owner checkpoint/independent restore/previous-image proof открыт.
Таймауты/native receipt и новый journal producer требуют SSH/source проверки
у владельца runtime; никакого общего API rollback или повторения R08.

### Продолжение 12.10: обязательные количества, лента и точная раскладка

Воспроизведён сквозной дефект годового рейтинга подведов: CalcEngine отдаёт
q1–q4, без блока year/верхнего factCount; общий селектор терял имеющиеся
количества и рисовал 0% рядом с известными суммами. Два RED-теста;
полная квартальная база теперь складывается тем же селектором для всех
потребителей. КП/ЕП старых DTO сохранены отдельным regression-тестом.
Замечания рейтинга считаются по canonical department/subordinateId;
непривязанные не размножаются по детям и поясняются в общем счёте книги.
Реальный ноль не заменяется; обязательный тракт не «чинится» UNKNOWN.
C03 целиком ещё не принят: независимый live replay всех144 сочетаний открыт.

Последнее расположение владельца: журнал справа сверху; прежние ЕП/КП,
ПМ/ТД, бюджеты и тыс/млн — отдельная нижняя строка; точечный фильтр справа
внизу, тема непосредственно слева. После ошибочной JSX-вложенности добавлены
негативный topology-тест и проверки фактических координат. Текст выбранной
недели перестал наследовать старый светлый цвет (Chrome RED→GREEN);
подсветка — ограниченная стеклянная линза, reflection9s, reduced-motion off.
Единая13-family палитра в существующем ThemeProvider: Header, ambient-фон
main и нейтральная сетка графиков; OrgStrip/семантические цвета не подменяются.

Журнал: оригинальный трёхстрочный барабан + подробная лента, три слоя
изменения/комментарии/источники, общий ChangeJournal, накопительный control
slice. Нативные обсуждения, Drive-проекция и заметки различаются; подпись
в заметке не становится Google-автором, «отработано» не закрывает Dash-кейс.
Самостоятельный navigation-qa.html обновляется на месте, все данные учебные.
18 раскрытых состояний +26 page/theme, шесть размеров,200%, контраст≥6.26,
Undo/переходы/самоскачивание/0HTTP PASS; на320×568 остаётся264px контента.
Полный web2272 PASS, source shared734/core1859+1skip/server954 PASS;
lint0errors/303existing warnings, web build PASS. Independent34+7 probe
и bounded review PASS; окончательный normal-hook/full exact-CI обязательны.

Первый новый диагностический CI на d306ab3b: DB38242843414 SUCCESS,
Python/image PASS; SSH diagnostic EOF до live-proof, web persistence assertion
ожидала вызов reload раньше отрисовки. Исправлено ожидание наблюдаемого UI,
без увеличения таймаутов. Candidate bundle передаётся как публичный код через
private-owned0700 scratch/SHA256/STDIN, не через слишком большой ssh command.
GET-проверка обязательна: отсутствующий bundle/пустые metric nodes не PASS.
Бизнес-данные/ключи не выгружаются; контейнеры и данные root не изменял.
R02/U07/live и выпуск ещё не приняты; source handoff/fence/свежий restore из#93
остаются prerequisites, R08 два принятых цикла не повторяются.


## Очередность текущего исполнения — продолжение W0 (12.10.2026, Камчатка)

Канонический реестр остаётся issue #69, кандидат — PR #79. Последняя
предыдущая source/browser точка86e63975584feed1d214f02575c73a2cac85d26e:
CI38214924770 SUCCESS (Python1064, TS5792, image/native Word/Caddy),
DB38214924645 SUCCESS. Read-only38214924631 отдельно BLOCKED
PUBLICATION_READER_LEASE_UNINITIALIZED; выпуск и новое UI этим не приняты.
Последующее усиление неизвестного паспорта API/GET-пробы в работе.
История предыдущего df0674/ba335837 CI сохраняется ниже и в issue#69.

Ruling: до завершения свежего backup/independent restore/проверки отката и
допуска выпуска не начинать новые функции W1–W5. Последние адресные исправления
по сообщениям владельца были выполнены раньше закрытия общего W0; это не
отменяет оставшиеся R01–R09. Цена дальнейшего переключения — задержка выпуска
и рассинхронизация проверенного SHA с production. Приоритет возвращён W0.

Передача инфраструктуры из #93/6117377836 получена; ACK root6117533469.
Последующее обновление исполнителя #93/6118006527 сообщает API/worker
sha256:a2b6a1b9… и web1b325fc0…; root эти production pins не менял.
Исходник основан на a1f4d78, но source-only ветка ещё не опубликована.
Заявленные изменения installed/branch-only принимаются раздельно; старые
0e4/c39 ниже сохраняют историю и не являются текущими разрешёнными pins.
ПК-исполнитель ещё завершает обслуживание, root параллельно не меняет
API/worker/web/Compose. После терминального handoff root принимает инфраструктуру,
затем консолидацию Dash/генератора и lossless оптимизацию. Исторически, по более раннему сообщению исполнителя,
API и worker использовали один immutable runtime0e4d68b3… с source-equivalence
и производным health index; native8tests PASS. Это новый handoff, не root live-proof
и не весь PR79. Принятые два цикла c39 сохраняются как история; проверка этого
узкого продолжения ограничена index/документами/одним новым циклом, без повторения
бесконечного recovery gate. Установка именно нового Header из PR79 ещё не объявлена завершённой;
новый reported web1b325fc0 не приравнивается к исходникам этой линейки.

Точный source handoff пока недоступен: GitHub ref codex/report-architecture-20261012
возвращает404 No commit found. Запрошен опубликованный SHA/очищенный source-only
patch; Windows-worktree напрямую недоступен облаку. До получения source нельзя
механически воспроизвести runtime0e4 или перезаписать установленный hotfix.

Ближайшая последовательность: законченный handoff/source review → свежий
coherent checkpoint и независимый restore → smoke прежнего точного образа
на изменённом candidate scratch → разрешённый exact-SHA выпуск/readback.
Текущий local22GB scratch не помещается при observed11.22GB; переиспользование
временного runner restore должно сохранять одного EX owner, свежесть и proof,
а не ослаблять gate. После W0 продолжаются W1–W5 из того же реестра.

## Ближайший выпуск: навигация, обновления и Google-комментарии (12.10.2026)

Последующее явное поручение владельца разрешает адресно устранить нечитаемую
навигацию до выпуска W0, используя уже существующие макеты/DesignLab. Это
исключение для текущего дефекта, не открытие всей волны W4. Источник геометрии —
трёхрядный цилиндр `pulse.html`; DesignLab #88@bf5971ee прямо сохраняет его,
а не заменяет цветовой сеткой. Группы, 13 маршрутов, стеклянные слои, исходные
цвета/подсветка, календарные барабаны, щит и угол остаются связанными с нынешним
Header. Центрирование, колесо/клавиши/сенсорные стрелки и цельные подписи
реализуются в существующем компоненте; на узком экране прокручивается ряд,
название группы остаётся на месте. Полный каталог настроек/39 палитр DesignLab
этим не объявляется подключённым. Браузерная проверка компонента и source CI
отдельны от production-деплоя и полной визуальной приёмки всех страниц.

Адресное продолжение по последним сообщениям владельца (U02/U03/U06/U07,
K06): верхняя общая стеклянная линейка сохраняет цилиндр и оба календарных
барабана; способ/вид/бюджет/единицы/ставка расположены горизонтально ниже.
На узком экране применяется видимая горизонтальная прокрутка, без разрыва
подписей. Заря находится внутри выбранных объектов, палитра линейки следует
разделу; оформление OrgStrip отдельно. Угол — рекомендованный прибор B из
`ugol-varianty.html`: 3×4 точки, действующие оси, отдельное снятие и общий
сброс с 6-секундной отменой; отмена проверяет срок, текущую страницу и состояние
прямо при клике, не затирает следующий отбор. Журнал — единый узел с вкладками
изменений/источников, накопленным серверным digest и подробным существующим
журналом. Обе глубины используют контрольный срез, не «семь дней назад» и не
последнее обновление. Поздний ответ не заменяет новый; отказ перечитки не
показывает старый паспорт как текущий. Общий API-клиент применяет `/api` ровно
один раз: прежние `/api/api/change-story` и `/api/api/sources` воспроизведены
отрицательными тестами. Источники/авторы/отсутствие данных не выдумываются;
офлайн-макет помечает учебные события и не подключается к Google/VPS.
Это ограниченное внедрение линейки/журнала, не приёмка 13 тел страниц,
полного каталога DesignLab, Figma и production-деплоя.

Последующий release/coordination запрос владельца: исходная UI-партия имеет
семь проверенных source-групп (навигация/барабаны; две стеклянные линейки;
13 палитр линейки; выделение/анимация; B-прибор/Undo; журнал/API;
keyboard/mobile/reduced motion) и восьмую группу «deploy + live readback».
7/8 = 87,5% именно этой партии. Это не процент готовности всего проекта и
не эксплуатационная приёмка семи групп на сайте. До live не объявлять100%.
Автономный Header поддерживает явные сценарии и изображения раскрытых
панелей в обеих темах; все сведения там учебные. Бек-фронт дополнительно
проверяется существующим read-only CI через настоящие GET Header endpoints,
с выдачей только категорий/хешей, без исходных сведений/токенов. Неполный
refresh passport даёт unknown, а не выдуманное окно/false/нулевой интервал.

Зависимости выпуска централизованы в существующем #93: installed-source
handoff/pins → интеграция/review #79 → reader bootstrap в разрешённом
serialized maintenance → свежий coherent checkpoint/independent restore и
previous-runtime compatibility → exact-main-SHA dispatch → live UI/API/Word.
#58 сохраняет исторические доказательства, не требует повторять generator/R08.
#69 — каноническое покрытие56; новые параллельные issue-реестры не создаются.

U01–U03/U06/U07: подключение Liquid Glass к существующей навигации и углу с фильтрами/щитом входит в ближайший выпуск. Сохраняются исходная геометрия, барабаны, 13 маршрутов и утверждённый Пульс. Каталоги DesignLab #83/#88 не подменяют работающий интерфейс; текущий #88 не имеет зелёного общего CI.

K06/K10/S07/C01: уточнение владельца касается обсуждений Google с ответами сотрудников/координатора и заметок ячеек, а не только текстовых граф реестра. В PR #79 подключено native чтение полных discussion threads/posts, исходных commentAnchors и заметок ячеек с раздельным append-only провенансом; старое production-чтение этим не считается автоматически обновлённым. Код и readback-тесты пройдены, эксплуатационная приёмка нового чтения ещё открыта. Официальный Sheets comments API теперь предоставляет threads/posts и commentAnchors; августовское ограничение адресации сохраняется как история, не как вечный блокер. Требуются подтверждённые авторы постов, оригиналы ответов, статусы, исходные IDs/диапазоны и версия чтения; у CellData.note встроенного автора/времени нет. Ответ «отработано», resolved Google и решение Dash показываются раздельно. Не угадывать автора по роли, адрес по цитате или законность по тексту.

Владелец поручил подготовить актуальную совместимую оптимизированную версию Apps Script. Сначала действующий исходник, триггеры, права и все потребители; затем проверяемая версия и изолированные испытания. Развёртывание в рабочих книгах, новые листы/колонки или переписывание исходных данных этим не выполняются. Webhook — уведомление для подтверждённой перечитки, не источник значения/автора ячейки; исправляются существующие регистрация каналов и применение общего состояния.

Операционный VPS/SSH-контроль передан инфраструктурному исполнителю из чата 01a12b19-19a3-7ef2-a4c1-740c35812c56; интегратор #79 не делает параллельных Docker-перезапусков. Критерии и текущая передача поддерживаются в issue #93. Реальные memory.peak API≈2,08 GiB/worker≈1,71 GiB опровергли предварительные лимиты1792/1024 MiB: они не применены. Инфраструктурный исполнитель уже подтвердил ротацию10MiB×3 всех четырёх контейнеров и установку guard/boot-lock. После worker-only hotfix проверяется новая отдельная пара самостоятельных циклов; точные image/attempt и время приведены в последней контрольной точке ниже.

## Состояние финансирования и замечания — разные счётчики (12.10.2026)

C05/C06/U06: полный счёт «Не обеспеченные» на Пульсе берётся из `/api/registry/buckets`, как в навигации: оба потребителя используют один полный принятый ответ в существующем store с source/asOf. Перечитка выполняется после принятия Dashboard, старый/конкурирующий ответ не заменяет более новый, отказ делает оба счётчика неизвестными; инициативные строки остаются внутри общего числа и показаны отдельной подгруппой. Замечания по финансированию подписаны отдельно как проверки выбранного среза, с собственной датой снимка. Источник и время чтения корзины явные; разные чтения не объявляются контрольной парой. Ни число замечаний, ни сумма плана не подгоняются под счёт состояния. Недоступный источник остаётся 503/неопределённостью, не нулём. Правило финансирования и решения владельца не изменены.


## Уточнения владельца и сокращение хранения — 12.10.2026

K01/K10/U06: в интеграционную ветку включено подтверждение пользовательского решения: PUT проверяет ACK, затем GET проверяет сохранённые id/status, после чего применяется обновление общего состояния. Локальный override удалён: он скрывал более новое решение. Ошибка или проигравший запрос не подтверждают успех; введённая причина сохраняется. Коммит автора `6dfd892b`, интеграция `ba2d632b`; независимые 32 targeted tests PASS, четыре typecheck и 5596 tests PASS + 1 skip у автора. Это код и техническая проверка, не live-приёмка записи в Dash или Sheets.

R10/C06/K01/K02/U06: последняя жалоба на 2547 пунктов технического сопровождения включена в работу. На сохранённой попытке состав: 2409 связностей записей, 136 связей рекомендаций и два прочих пункта; интерфейс выводит все действия отдельно. Требуется группировка по причине/влиянию/действию с сохранением исходного receipt и доказательств. 33 суммы без даты факта сами по себе не доказывают ошибку сотрудника: годовые серии и отдельные договоры должны различаться, неподтверждённый вид требует уточнения, без выдуманной даты. Старые детерминированные assurance-v2 не переписывать ради нового отображения; их совместимость проверяется отдельно.

R01/R03/R06/C07: совместимая компактация опубликованных суточных выпусков включена в интеграционную ветку. Общий `PublicationStore` сохраняет текущий/предыдущий и недельные контрольные выпуски; старые ссылки скачивания, документы и необходимые доказательства идентичности/решений остаются. У компактных выпусков явно отсутствует полный пересчёт. Подготовка, восстановление после аварии, обратимый карантин, проверка защищённых корней и запрет symlink проверены; независимое ревью разрешает интеграцию кода. Live-компактация ещё не выполнена: нужны ограждение читателей/писателей отчётного контура, актуальная проверка идентичностей и резервной копии. Политика общего источника данных и Word по кнопке остаётся целью существующего ADR, не объявляется уже внедрённой.

C05/C06/K01/K02/K08/K10/S10/U06: новые примеры владельца включены в существующий реестр требований: 509/597 необеспеченных позиций, дубли подведов УКСиМП и актуальность сокращений, этапность/итоги комментариев, 14 критичных ЕП-рисков при наличии объяснений, сохранение решения «ложное срабатывание», преждевременная отметка экономии, специфика монополистов и различие назначения питания. Не объявлять все комментарии достаточным объяснением и не снимать критичность массово без исходных доказательств. На сохранённом срезе число 509 воспроизведено как 597 строк без плановой даты минус 88 инициативных; интерфейс смешивает характеристику финансирования и число замечаний. Требуется общая модель счётчиков с явным составом/периметром, единая идентичность организаций и сквозная запись/readback решений; приёмка на текущем live-источнике ещё открыта. Последнее правило владельца сохраняется: отсутствие плановой даты означает необеспеченность финансированием, включая инициативные позиции.

## Загрузка Dashboard — HTTP-представление снимка (12.10.2026)

C05/U07: `/api/dashboard` передавал полный внутренний снимок, включая строки книг и недельный контекст, которые фронтенд получает через отдельные маршруты. Ответ теперь содержит явный список полей экранов: идентичность/время/метаданные, официальные и расчётные метрики с provenance, полный список замечаний, отклонения, доверие и `datasetAnalyses` для аналитики. `recentIssues`, счётчики и решения сохранены. Полные снимки, исторический JSON в SQLite, отчёты, сверки и записи источников не изменены.

Страж `dashboard-payload.test.ts`: большой синтетический внутренний контекст не попадает в HTTP; контракт `DashboardDataSchema` проходит; исходный и сохранённый исторический снимки остаются побайтно прежними. Число 15 751 033 Б из прошлого live-замера не выдаётся за объём по сети или доказательство ускорения: для повторной приёмки нужны exact SHA, ревизия источника, `Accept-Encoding`, `Content-Encoding`/`Content-Length`, TTFB, время получения и разбора JSON. Сжатие gzip/br и ETag уже существуют. Live-приёмка этой оптимизации ещё не выполнена.

## Продолжение выпуска — 12.10.2026 (Камчатка)

API восстановлен; повторная worker-only процедура 38184331772 на exact SHA
1e4dfdb03a489404b895116d969baa9d9a08a786 прошла CI и независимое внешнее
восстановление backup. Первый самостоятельный цикл и три native Word прошли;
второй00:04:45–00:11:32UTC отказал SOURCE_CHANGED_BEFORE_PUBLICATION.
В00:23:06UTC наблюдение завершилось WORKER_ACCEPTANCE_PENDING/exit3:
worker/API продолжают работать, два успешных цикла не приняты. Read-only38188046266
подтвердил healthy API, running worker/sameimage/OOMfalse/restarts0 и nativeWord PASS.
Отдельный шаг38188258290 проверил фактическую историю схем кандидатом e7b9a85f:
24absent/9v1/26v2, invalid0, currentselected200/PASS. Общий run FAILURE из-за
отсутствующего timer-result.json; совместимость схем не подменяет приёмку циклов.
Эта процедура не останавливает API.
Ниже сохранена точка предшествующего инцидента: API восстановлен, worker Created.
Второй цикл22:53:10–22:59:02UTC отказал безопасно:
NOT_ISSUED/SOURCE_CHANGED_BEFORE_PUBLICATION на стадии publication.
Старый acceptance-оператор ошибочно запустил глобальный откат и остановил API;
Node resumed23:04:47UTC. Read-only38183214317: reports/ совпадают с backup,
5 native smoke PASS. Внешний dashboard200/schema PASS:15 751 033B/3,405s.
На72e3b9c CI38183200251 SUCCESS; frozen-replay38183200282 FAILURE
(после rollback нет failed attempt в восстановленном reports/). Это не green gate.
Исправление процедуры: точный attributed source-change не засчитывается и
сохраняет таймер; RO match не останавливает Node; pending не принимается за
готовность; при аварии останавливается только собственный worker, без data restore.
22 отрицательных/регрессионных проверок — локальный gate; production-повтор
требует exact-head CI и независимого ревью. R08 остаётся частично выполненным.

Последнее уточнение владельца: Word — кнопка скачивания через браузер, а не
постоянный архив файлов на VPS. Целевой путь — on-demand из выбранного sealed
source revision/недельного среза, короткий cache и дедупликация задач. Текущие
artifact routes до этой совместимой миграции не ломать удалением файлов.
Уточнение включено в существующий ADR-001; это ещё целевой этап, не live функция.

Ниже сохранена история предыдущих процедур; описанный там автоматический
reports-only rollback с остановкой Node отменён текущим протоколом RUNBOOK.

Минимальное восстановление #93 выделено из общего выпуска: запустить только
report-worker на точном immutable image уже работающего Node, без замены
Node/web, bootstrap, миграции схем или записи в Google. Backup38171945386
SUCCESS:3967 entries,22 054 396 941 B→2 438 837 780 B compressed; полный
внешний scratch restore (66SQLite,133DOCX), source-match и возврат прежнего
Node healthy PASS. Installed-image acquisition38172548530 SUCCESS (rc25,17source contracts,
history read). Следующий gate — точный CI и повторное независимое
восстановление с пробным reports-only rollback. Новый оператор сохраняет
core SQLite, откатывает только reports/, проверяет два разных timer-цикла
с FLOCK-атрибуцией реальному worker PID и три native Word после каждого.
Независимое ревью исправило stop/finally, lookup rollback, короткие Docker IDs,
manual-lock turnover и повторный Compose отказ после успешного data restore.
Recovery38174351649: exact-head5a1f27b2 CI38174342202 SUCCESS,
повторный полный scratch restore + reports-only rollback drill SUCCESS,
но предварительный `docker top -eo args` отказал до любых изменений runtime.
Read-only38175835890 подтвердил: default top=0, PID top=0, args top=1,
Node healthy/image unchanged, прежний worker exited, native Word5PASS.
Исправлен только несовместимый формат process probe; отрицательный тест
воспроизведён,16 worker guard +22 backup теста PASS. Повторный запуск
ещё не принят: два самостоятельных цикла остаются обязательным gate.
R08/R02/R07 не закрыты.

Recovery38176081446 остановлен до runtime на manual-writer guard;
Recovery38176811396 остановлен до runtime на BACKUP_REPORT_SCOPE_MISMATCH.
Read-only38177526291 доказал точное отличие: два новых entries попытки,
новый status и изменённый root status; прежние published/archive/registry/ledger
побайтово неизменны. Старый backup корректен исторически, но не является
текущим rollback checkpoint. Новая полная копия38178244703 на
exact-head d8a7dfa015a531f5653640427836bf535d87ff79 (CI38177512771 SUCCESS)
проверена:3970entries,22 048 941 998B→2 438 244 961B compressed,
66SQLite/133DOCX, внешний scratch restore и still-quiesced source-match PASS.
Прежний Node возобновлён22:16:19UTC и healthy; hotfix web сохранён.
Recovery38178313782 на5094505944da1f3701cb5e468234c1f4f43d8b31:
CI38178298350 SUCCESS, повторный полный restore/reports-only drill PASS;
quiesced report-match и первый самостоятельный цикл +3 native Word PASS
(step5 SUCCESS на22:39UTC). Worker StartedAt22:31:17UTC/RestartCount0;
attempt fdd77a5d06bc47f7974e7a61566d212b finished22:38:05UTC,
VERIFIED_WITH_WARNINGS/error_code=null. Второй цикл отказал:23:05:36UTC
WORKER_NEW_CYCLE_FAILED; recovery38178313782 завершён FAILURE. Защитный
reports-only rollback возобновляет исходный Node; внешний health23:07UTC
HTTP200/status=ok. Два цикла не приняты, R08 не закрыт. Сохранённые failure-status
и attempt-error читаются приватно до следующего восстановления; повторный
запуск без установления причины не выполняется.

Независимая согласованная проверка после backup: health HTTP200/ok;
существующий REL-3958a9401e5f4c582012db641443eb0d37c9aae928bc1639c3e1203440f79a58
принимается webhotfix actionable-assurance-v2; три DOCX200+ZIP,
107508/64891/41656B,~0,44–0,50s. Hotfix image
sha256:43520e97cb59f2f27aeec7144fbf7d19ce9405ab883d0db6c62ced7d12f46334
не заменять при worker-only recovery. Это проверка web/API/скачивания,
не доказательство совместимости строгой v2-схемы нового candidate со всей
историей. Диагностический CI probe импортирует старый installed Node shared
и сообщает CONTRACT_FAIL наv2; зелёный CI не подменяет клиентскую приёмку.

Историческая диагностика до указанного выше восстановления worker #93: live read-only
38170496420 на dd267377 подтвердил exited(0), разные server/worker image
и нехватку VPS для полного scratch restore: source22 054 396 941 B,
free21 541 068 800 B. CI38170475213 SUCCESS; source-schema38170475150
SUCCESS. Причина остановки: docs deploy ae6ef74d выключил worker перед
MONITORING_SCHEMA_LIVE_GEOMETRY_MISMATCH и не восстановил расписание.
На момент этой диагностики native Word PASS, browser Zod FAIL на automation_assurance.contract;
последующий webhotfix и его доказательства указаны выше.
Подготовлено закрытое полное compressed backup/restore окно с временным
scratch на Actions через SSH, без публичных artifacts. При отказе/завершении
возвращается прежний Node-контейнер с health-check, worker не запускается.
Независимый VPS-watchdog ограничивает quiescence30мин; нарушение окна
блокирует source-match до/после проверки. Полная live копия38171945386 и независимый restore завершены; этот инструмент не является worker/release acceptance.

Последнее уточнение минимального хранения: общий source revision для Dash/Word,
история изменений вместо полных копий каждого обновления, недельные маркеры и
ограниченные checkpoints. Архитектура изучена на фактических source-refresh,
snapshot.ts, runtime/raw_pipeline/PublicationStore/IdentityStore. В существующие
ARCHITECTURE.md и ADR-001 внесён проект перехода с альтернативами, атомарностью,
GC и совместимой последовательностью; это не live-внедрение. Связи требований:
C07/C08/K03–K06/R01/R03/R06/R10; разовая cleanup не ждёт полной миграции.
Замер38167757661: последний release298 213 451 B, snapshot payload128 471 852 B,
identity proof7 430 144 B, два DOCX172 399 B (~0,058%). Большая директория
published — упаковка данных/проекций, не 18 GB полезных Word-документов.
Независимое read-only архитектурное ревью PASS; уточнён retirement GCroots:
retained воспроизводимый release удерживает source graph, artifact-only история
не обещает пересчёт, экспертные proofs не удаляются вместе с daily bundle.
Приватный синтетический delta probe:30/30 точных реконструкций,11 проверок
ошибок/формы/типов; уменьшение bytes доказано только для synthetic input.
Текущий runtime не изменён. Exact-head CIaf959405 run38169790135 SUCCESS.
Context7 SQLite/PostgreSQL использован без private content. PostgreSQL MVCC/WAL
не считается постоянной бизнес-историей; выбор SQL engine не подменяет redesign.


Уточнение владельца: «ядро» означает всю кодовую базу и взаимодействие
подсистем. Область ALL56 сохраняется; порядок остаётся Word/worker/безопасный
выпуск → достоверность сигналов и связей → реестры/редактор/UI. По последнему
поручению очистка VPS и минимальное хранение выполняются сейчас, до выпуска.
Скорость загрузки страниц, таблиц и API — отдельная задача: сначала замеры
latency/размера ответов/рендера, затем адресные оптимизации; освобождение диска
не считается доказательством её выполнения.

Хранение — фактическая очистка VPS на f77660c8: удалено 5,358 GB
регенерируемого Docker build-cache (run38165297190; первоначальный readback
не прошёл из-за исчезнувшего oneoff-контейнера). Исправленный readback
run38165659030 SUCCESS: постоянные контейнеры и образы сохранены, повторное
удаление 0B. Run38165658779 SUCCESS: удалены payload семи старых attempts,
2 578 247 824 байта; status/error, текущий attempt и недельные источники
сохранены. После этого прохода free=21 770 911 744 байта; это замер того
момента, а не гарантия текущего остатка: параллельные сборки занимают место.
Одноразовые maintenance labels сняты. Основные опубликованные комплекты
(~17,3 GiB по предыдущему замеру) ещё НЕ сокращены до недельных.

Новая штатная политика transient: две последние полные попытки вместо 12,
плюс текущая и защищённые недельные источники. Отрицательный регрессионный
тест воспроизведён, 7 адресных и 946 полных Python-тестов PASS. До выпуска
нового runtime это изменение не является штатной live-политикой.

Read-only weekly census [38166827139](https://github.com/gaben1488/dash/actions/runs/38166827139)
на f6e029ff SUCCESS: 57 публикаций, 3 недельных группы, 4 keep / 53 retire,
16 940 526 250 потенциально освобождаемых байт. Это план, не удаление.
Первый census дал 8 126 NULL plan/entity signatures в сумме по версиям
публикаций; это не гарантированно 8 126 независимых строк. Новый отрицательный
тест воспроизвёл повторный счёт одного snapshot в разных releases; подсчёт
исправлен на уникальные snapshot IDs. Missing snapshots в первом срезе=0. Архивные доноры пока необходимы, чтобы
восстановить производные сигнатуры без изменения UID и frozen results.
Maintenance label снят. Exact-head CI f6e029ff run38166778725 SUCCESS.

Подготовлено расширение существующего IdentityStore recovery: явный набор
исторических snapshot IDs, только sealed published/archive donors; обычный
latest/chain контракт не меняется. Empty set не означает fallback; неизвестные
и пустые targets блокируются. Отрицательные тесты и независимые 15 identity
тестов PASS; общая Python-регрессия 952 PASS. Exact-head CI a456ae46 run38167757659 SUCCESS. Private scratch proof
[38167780078](https://github.com/gaben1488/dash/actions/runs/38167780078) SUCCESS:
8 126 производных строк восстановлены, missing=0, unrecovered=0;
backup/restore identity-копии проверен, frozen state и живая база неизменны.
Это не полный R06 backup. Live repair ещё не выполнялся; следующий шаг —
защищённая запись производных сигнатур и readback, затем согласованное
сокращение каталога и комплектов.

Повторный cache-run38168738611 FAILURE: prune=0B, protected-state hash изменился.
Причина не доказана; это не PASS и не дополнительное освобождение места.
Добавлен read-only runtime probe: два чтения без prune, отдельно реальные
mount/runtime/tag/dangling изменения и перестановка массива mounts;
никаких путей, environment или данных реестра в выводе. Старый отказ не
переклассифицируется по догадке. Read-only run38169599746 на4677756d SUCCESS:
runtime/mount/tag/dangling changes=0, raw_mount_order_changed=true;
free=22 266 314 752 байта. Подтверждена нестабильная сериализация массива
mounts. Новый shell integration test воспроизвёл ложный CACHE_PROTECTED_STATE_CHANGED
на одной перестановке; cleanup helper теперь нормализует порядок массива/ключей,
сохраняя все mount-поля и запрет реальных изменений. 7 cache + 3 probe tests PASS.
Это не устанавливает причину прошлого отказа и не означает удаления архивов.
Rehearsal38167757661 FAILURE: 159/159 recommendation chains сохранены,
weekly archive остаётся UNCHANGED_LEGACY_ARCHIVE_BLOCKER, worker
RUNNING_REPORT_WORKER_NOT_FOUND. Зелёный CI не означает готовность live worker.
Локальный pnpm full gate остановился до tsc: установленный pnpm требует
переустановки node_modules и отказывается без TTY; результат не записан как PASS.
Изменения только Python/shell/workflow/docs; штатный pre-commit carve-out
для non-TS соблюдён без --no-verify.

R06/R09: подготовлен полный сжатый backup формата 2 без потери файлов,
метаданных, SQLite/WAL и документов; старый формат совместим. Воспроизведён
отказ проверки места до распаковки и исправлен: scratch требует несжатый объём
плюс резерв. 17 синтетических тестов PASS, независимое read-only ревью PASS.
Реальная производственная копия и восстановление ещё не выполнены;
допуск внешнего scratch-диска пока не реализован.

Хранение отчётов: потоковый compact JSON уменьшает повторную сериализацию;
семантическое содержимое/hash сохраняются. Отрицательный тест подтвердил
потерю private mode при атомарной замене с umask022; обе записи исправлены,
7 адресных тестов PASS. Исторические публикации и исходные книги не переписаны.

R08: read-only rehearsal на 48e7816b завершился FAILURE после успешного
replay и независимого аудита Word: worker остаётся остановленным. Отказ
compose lookup прежде терял финальную диагностику из-за set -e; воспроизведён
реальным shell-тестом и теперь сообщает фиксированный BLOCKED, сохраняя
неуспешный итог проверки. Release-scope/SSH harness: 20 PASS.

C06/K02: исправление годовых агрегатов ЕП ещё не принято. Ревью выявило
зависимость от даты последнего договора, игнорирование пользовательской
разметки и косвенный штраф через концентрацию ЕП. До сквозного устранения
этих швов блок не считается готовым к выпуску. TypeScript четырёх пакетов
PASS; shared 696, core 1815 (+1 skip), server 911, Python 945 PASS.
Первый общий TS-запуск дал два web timeout: Word export и Monitoring.
Без изменения тестов отдельный запуск 22 PASS; полная web-регрессия
с maxWorkers=2 — 2159 PASS (198 файлов). Новый exact-SHA CI обязателен.

## Приоритетный выпуск и покрытие невыпущенных PR — 12.10.2026 (Камчатка)

R08/R09: воспроизведён механизм потери восстановления worker: drone-ssh 1.8.0 (ssh-action v1.2.0) при script_stop:true вставляет exit-code guard внутри определения EXIT-handler и выходит до команды запуска. Исторический stop совпадает с неудачным deploy 38042951188 (10.10 09:57 UTC); точная первоначальная ошибка deployment не доказана из-за недоступного job-log. В существующем CI выключены пер-строчные guards, сохранён set -euo pipefail и проверка того же контейнера после восстановления. Отрицательный тест исполняет фактический trap через SSH-преобразование: RED не запускает старый worker, GREEN запускает и проверяет его. Это исправление класса отказов в коде, не фактическое восстановление production.

Локальная проверка текущего пакета: TypeScript всех четырёх пакетов PASS; shared 695, core 1814 (+1 skip), server 910, web 2158; Python 932; инструменты идентичности 21; release scope/SSH recovery 19. Все тестовые исходные сведения синтетические, production не изменён. Проверка браузера макета выполнена в Chromium на 390/1440 px и масштабе 200%; это не приёмка всех 13 страниц.

Проверка VPS на 583fab1c (read-only rehearsal 38159880948, 11.10 17:30 UTC): native Word HTTP PASS; браузерная старая схема не принимает automation_assurance v2 (selected присутствует), следовательно R02 ещё требует runtime-выпуска и браузерной приёмки. Worker всё ещё exited(0). Каталог storage READ без unsafe/mismatch: published 18 607 057 877 байт, attempts 4 279 190 613, archives 248 878 748, inputs 361 157, other 1 491 731 569; hardlinks не обнаружены. Каталожные предполагаемые повторы 2 561 069 583 байт; из-за лимита 512 мелких файлов доказаны только 8 637 501 байт. Это не разрешение удаления 2,56 GB. Ограниченная проверка теперь сначала проверяет группы с наибольшим потенциальным выигрышем; отрицательный бюджетный тест RED→GREEN, 5 PASS.

K07–K10: в прежний закрытый документ предложений добавлен §37, итерация 1 предметного графа: 551 узел /555 связей, 465 буквальных текстов, 14 семейств, 66 вложенных групп, 25 смысловых пар и 6 процессных типов. Проверены исходные SHA, все адреса включённых членов и целостность концов связей; фактический результат существующего SubjectRelation приложен отдельно от экспертного предложения. Добавлено визуальное представление; native readback подтверждает полный текст и inline image, PDF страницы 140 проверен на отображение. Это предложение по выбранному полностью прочитанному фрагменту, не исчерпывающая нормализация всего массива и не одобрение региональных классов/объединения закупок.

На 179228b7 exact-head CI 38160486990 SUCCESS. Повторный read-only rehearsal 38160486998: источники не прошли Google-auth refresh, поэтому новый source-schema PASS не объявляется; HTTP Word перемежающийся (предыдущая проверка PASS, следующая BLOCKED), scheduled worker остановлен. Prioritized storage probe доказал 1 723 133 567 повторных байт в пределах 2 GiB hash-budget: mismatch/unsafe/unstable=0, полнота false. Введена отдельная read-only OAuth-диагностика с фиксированными классами timeout/connection/TLS/provider grant и разрешёнными HTTP-кодами; не выводит исключение, URL, ответ, почту, ключ или token. 5 отрицательных privacy/classification tests RED→GREEN; вместе с существующими credential/retry tests 11 PASS. Общий auth-retry не добавлен до выяснения причины — invalid_grant и ошибки TLS нельзя маскировать.

Приоритет владельца уточнён: восстановление генератора и report-worker предшествует продуктовому расширению. Объём постоянного состояния должен уменьшаться за счёт доказанного устранения повторного хранения, а не удаления необходимой истории или автоматического увеличения диска. Для K07–K10 требуется граф итерационной группировки в существующем документе: отдельные связи идентичности, текстовой эквивалентности, предметной категории, процедуры, годового ассигнования/дочерних контрактов и версии изменения. Нюансы УИО (допсоглашения), УКСиМП (несколько контрактов в течение года), УДТХиБ (возможные лимиты вместо НМЦК, последующие корректировки плана) — вопросы к источникам, а не универсальные предположения. Инициативные закупки уже существующая сущность: новые уточнения проверяются по её потребителям, без создания дубля. Версионные reader/adapters и семантика суммы должны сохранять старые снимки при переходе на «Закупки 2.0»; миграция БД без ADR, доказательства необходимости и отката не запускается.

Кандидат остаётся PR #79; актуальный проверенный базовый SHA — `68bf507eb7bf8c5f7fdff37d89a4550e84728c95`. Exact-head CI 38156133691 SUCCESS. Read-only rehearsal 38156133689: текущий replay/audit PASS; общий FAIL — RUNNING_REPORT_WORKER_NOT_FOUND. Историческая недельная проверка не принята: duplicate procedure code совпал у baseline/candidate и классифицирован UNCHANGED_LEGACY_ARCHIVE_BLOCKER. Это не новый дефект текущего отчёта. Владелец разрешил выпуск; безопасность данных, реальный restore/rollback и два самостоятельных worker-цикла остаются обязательными.

R01: перечитаны актуальные 18 открытых PR (17 смежных и #79). #89/#87 runtime покрыт; #86/#85/#90/#94/#75/#82 содержат альтернативы, уже усиленные интеграцией — механический merge регрессирует revision/read-after-write, алиасы sheetId и математические guards. Из #43 перенесена ограниченная диагностика заголовков с двумя privacy-тестами, с сохранением volatile_header_cells. Из #91 перенесены изолированные read-only инструменты идентичности: 21 синтетический тест; исправлен обнаруженный при интеграции вывод приватных фрагментов JSON/путей в stderr. Миграция не запускается и ID в Sheets не добавляются. #81 интегрируется по контрактам: ошибка dataQualityScore устранена через настоящий CHECK_REGISTRY/trust-component и знаменатель содержательных исходных строк; регламентные состояния не штрафуют дисциплину. ControlCase/portfolio #81/#84, дизайн-библиотека #88 и синтетическая browser-сборка #96 ещё требуют адаптации, не объявлены принятыми. #83 замещён #88; #70/#80 сохраняют историю требований.

C06/K02: общий predicate отличает доказанную историческую диагностику нумерации шапки от дефекта закупки. Старые записи сохраняют ID, серьёзность и статус в снимке; request-time доверие, действующие critical-бейджи/сигналы и UI-счётчики исключают её. Интерфейс объясняет неприменимость вместо рекомендации протянуть формулу поверх номера колонки. Несогласованные row/cell, неизвестный лист и настоящий AA4 продолжают проверяться. DB/history/source не переписываются.

U01/U06/C04: пять состояний распоряжения экономией уже утверждены (owner-week §86). Исправлена передача рублей в форматтер тысяч рублей; устаревшая плашка заменена честной пометкой интерактивного макета. Выбор состояния, контекст и связь исходной закупки/заявки/решения доступны; настоящая финансовая запись не имитируется без прав и хранилища. Браузерная проверка Chromium 1440/390/200%: выбор работает, horizontal overflow и page errors отсутствуют, кнопки не меньше 44px. Это приёмка компонента, не всех 13 экранов или Figma.

K07–K10: полностью вычитаны все 5 576 различных строк корпуса 25 захваченных чтений восьми плановых книг с выбранными зеркалами: 43 297 вхождений. Повторы сжаты только для чтения, все адреса сохранены. SHA корпуса c8c48ab15686ba610c760baf280dba9226cfbe10402172463a1325d54307a3b6; наблюдение 12.10.2026 01:44 по Камчатке, неатомарно. Вердикты: 253 mechanical, 165 ambiguous, 1 941 context_required, 1 892 classifier_candidate, 1 325 clean. Это редакторские предложения, не число доказанных ошибок или объединённых закупок. Девятый источник, вся история и экспертная приёмка остаются открытыми. Выявлена реальная смысловая ошибка машинной сверки доли участника с общей НМЦК; источник/producer и потребители проверяются, Apps Script не переписывается.

Историческая диагностика R06–R09/C08 до разовой очистки и уточнения недельной политики (актуальный статус выше): по уточнению владельца храниться должно только необходимое. Главный объём — повторные snapshot/model bundles, а не Word-файлы. reports/published: 18 177 708 KiB, attempts: 4 284 178 432 bytes; retention dry-run подтвердил 0 bytes для удаления. Docker buildcache ~5 GiB потенциально освобождаем, rollbackimages сохраняются. Нужна измеренная экономия дублей с сохранением каждого исторического пути/хеша; схема catalog и история не ломаются. Добавлен ограниченный metadata/duplicate-byte probe (без исходных текстов, ID, путей, SHA в публичном выводе). Он различает заявленные catalog дубли, реально проверенные bytes и уже существующие hardlinks. Очистка/дедупликация живой истории пока не выполняется. Полная backup+isolated restore и вместимость scratch не доказаны; деплой ещё не выполнен.

Реестр остаётся связкой редактора, диапазонного ввода, revision/conflict/readback, истории/Undo, комментариев, провенанса, базы знаний, сигналов, Пульса и отчётов. Отдельные примеры не заменяют требования всех MD и 56 конечных результатов. Переходы статуса до «принят» требуют соответствующей сквозной/live приёмки; оставшийся техдолг и самостоятельные O/G-контуры не закрываются этими локальными исправлениями.

## Дополнительные сигналы и контекст — 12.10.2026 (Камчатка)

C06/U06/K02: присланные 11 замечаний AA1/AB1/AC1/K1/O1/P1/R1/S1/T1/Y1/Z1 содержат значения, совпадающие с порядковыми номерами колонок. Текущий producer исключает числовой предмет шапки; сохранённые старые замечания могли прикрепляться к настоящей закупке №1 только по книге и rowSeq. Отрицательный UI-тест воспроизвёл это; индекс теперь исключает адреса трёх строк шапки, сохраняя исходное замечание для исторической диагностики. Read-only native CellData первичного листа ВСЕ книги УЭР (sheetId 1344447365) подтвердил все 11 значений нумерации в строке 1 и настоящие формулы в строке 4. Production SHA и показанный snapshot ещё не подтверждены: исправление не объявлено выпущенным.

C05/C06: свежий read-only расчёт восьми книг завершён 11.10.2026 16:17:55 UTC и дал 597 строк planYearMissing вместо показанных 599. Чтение не атомарное, версия/время скриншота неизвестны. Последнее явное уточнение владельца сохраняет проектный регламент: отсутствие плановой даты означает «не обеспечено финансированием»; название класса не переименовывается. Хотелки остаются отдельным состоянием, не ошибкой и не рисковым замечанием (п.137(3)). Свежая проверка подтвердила отсутствие обеих дат у всех 597 отобранных строк; это ещё не семантическая приёмка каждого случая. В строке №340 УКСиМП (физическая 343) текущие план/факт нулевые, даты Х, комментарий ГРБС фиксирует возврат средств в бюджет. Исходник сохраняется; статус не выводится автоматически из свободного комментария. Устранён независимо воспроизведённый дефект provenance: время API-запроса и время пустого/частичного обновления больше не выдаются за время чтения всех книг. Используется самый ранний подтверждённый loadedAt среди возвращённых книг; при отсутствии метаданных — исторический fallback, а не выдуманная свежесть. Разновременные источники не объявляются атомарным freeze.

R02/U07: выгрузка CSV сверки переведена с прямой ссылки на общий авторизованный fetchBlob. Проверяются успешные байты и 401/403; тело отказа не сохраняется как CSV. При смене контекста/размонтировании запрос отменяется. Проверка на production-домене остаётся отдельной приёмкой.

C08/R01: дополнение владельца включает улучшение архитектуры при обоснованном переходе на PostgreSQL и закрытие прежнего технического долга. Требуется оценить границы модулей, конкурентную запись, историческую совместимость, обратимость и измеримое преимущество; автоматическая production-миграция не разрешена.

Восстановление чатов: доступный ChatGPT Space connector после полного обхода доступных Spaces и Pages возвращает только вводную страницу, без проектных бесед. read_page_transcript относится к записям встреч, а не к произвольной истории ChatGPT. Полного доступа ко всем прошлым чатам этот интерфейс не предоставляет; их полное прочтение не заявляется. Продолжается восстановление доступных решений из репозитория, GitHub и существующих документов.

Локальная приёмка этой итерации: server 906 PASS, web 2153 PASS; 29 адресных web-тестов и 10 server-тестов PASS; server typecheck и web production build PASS. При независимом review найден и закрыт случай частичного/пустого цикла чтения. Начальные полные прогоны выявили устаревшие тестовые координаты шапки и недатированный fixture; исправлены реальные fixtures, отрицательные сценарии сохранены. Первый импорт pipeline/SQLite в недельном тесте получил отдельный 15-секундный бюджет; общий timeout не увеличен. Критические исторические замечания ещё остаются в общих счётчиках/trust старого snapshot: исправлена привязка к закупке, полная совместимая классификация исторической диагностики остаётся открытой.

## Подтверждение записи — 12.10.2026 (Камчатка)

C01/C02: воспроизведены четыре отрицательных сценария, в которых успешный HTTP записи ранее подтверждал чужую строку, прежнее значение или недоступный readback; одиночный PUT вовсе не перечитывал результат. Оба пути теперь проверяют весь защищённый набор исходных полей после каждой ячейки. При несовпадении/отказе чтения нет подтверждённого revision, обновления кэша и успеха; остальные ячейки строки не записываются. Дата допускает лишь эквивалентное календарное представление, A/B/C/G и остальные исходные поля остаются защищёнными. Параллельная перечитка кэша не позволяет отразить правку в другой закупке.

Локально: server 902 PASS, web 2149 PASS; 34 адресных теста включают 173/173/1/173/18, B/C-подмену, чужой post-write readback, неизменённое значение, недоступность чтения, остановку следующих ячеек, две подтверждённые ячейки, формат даты и последовательность дата → сумма. Независимое read-only ревью существенных дефектов не выявило. Исходные книги не изменялись.

Граница: Google Sheets values API не предоставляет атомарный compare-and-swap. Перестановка между preflight и записью может уже изменить чужую строку; readback обнаруживает неподтверждённое состояние, но автоматический откат без доказанного адресата был бы опасен. Полная live-приёмка C01 и управляемое восстановление не объявлены завершёнными.

Exact-SHA CI b831dd25 / 38153336554 — SUCCESS; deployment не выполнялся. CI предыдущего 8168ae3b завершился FAILURE из-за 5-секундного timeout нового комбинированного UI-теста под параллельной нагрузкой, а не из-за неверного результата. Адресные запросы в тесте упрощены; для нескольких реальных рендеров таблицы установлен отдельный 15-секундный предел. Общая повторная web-регрессия проходит; новый exact-SHA CI обязателен после коммита.

## Дополнение владельца и ложные проверки СВОД — 12.10.2026 (Камчатка)

C06/K02: присланные 101 карточка (88 критических) относятся к строкам дополнительных аналитических блоков СВОД. Read-only чтение живых заголовков и формул подтверждает: «Анализ экономии», «Операционная нагрузка» и «Дисциплина планирования» имеют другую геометрию, а движок применяет к ним D/E количества и H:I:J→K, L:M:N→O основной таблицы. Это дефект области проверки, а не доказательство ошибки исполнителя. На одном новом read-only чтении 320 строк старый код воспроизводит ровно 101 карточку: 25 плана, 21 факта, 23 процента, 19 отклонения и 13 количества; новая область — 0 таких карточек. Отрицательные тесты сохраняют настоящее нарушение после возобновления первичного блока и дают одну диагностику неизвестной шапки даже без данных. Область определяется названиями/заголовками, не номером 280. Полная core-регрессия: 1813 PASS, один skip; 44 адресных теста PASS. Это исправление области, не полная верификация D:U геометрии. Старые фрагменты без шапки сохраняют прежний контракт, архивные snapshots не переписываются. Финансовые значения источника не изменяются.

U01/U04/U06/U07/C01/C05/K06/K10: целевой интерфейс раскрывает полезное содержание всего ядра через единый контекст строки, провенанс, актуализацию источника/webhook, все виды комментариев, базу знаний и закупочный смысл. Редактор требует диапазонного ввода, предварительной проверки вставки, истории/Undo, защищённого подтверждения записи, персональных представлений и переходов к источникам. Это критерии существующих ID, а не параллельный проект. Полная интерактивная Figma Current/Target должна подтверждаться реальным файлом и поведением, не кодом импорта.

K07–K10: чтение 57 302 текстовых позиций и 41 682 непустых значений не равно индивидуальной смысловой приёмке. Полная итерационная проверка адекватности, различных уровней сходства, справочных соответствий и вариантов типизации ещё не завершена. Существующий документ предложений Google Drive поддержан разделом 35 с revision check и последующим чтением результата: текущий SHA/CI, ограничения C01, первопричина 101 сигнала, честно незавершённая смысловая приёмка и требования редактора/Figma. Оригиналы, решения и история сохранены; рабочие книги не переписывались.

## Консолидация найденных противоречий — 12.10.2026 (Камчатка)

Полное чтение исходных Markdown служит восстановлению требований, а не повторной реализации старых закрытых багов. Старые заявления deployed/accepted сверяются с фактическим SHA и источником. Дополнения к существующим ID:

- C03/C04/C05/R10: старая матрица «144» имеет другие оси и не доказывает нынешние бюджеты/ПМ–ТД/ЕП–КП/периоды/ГРБС/подведы. Неизвестный знаменатель не заменяется единицей; агрегированная доля экономии управления не является снижением НМЦК торгов. Торговая, официальная, перераспределённая и оставшаяся экономия имеют разные периметры. Арифметические расхождения исторических аналитических записок проверяются, а не закрепляются тестами как норматив.
- K01/K02/C06: годовая закупка без даты факта и инициативная заявка — состояния процесса; неизвестное основание ЕП — задача справочника. Сходство распределений сигналов не доказывает их смысловую идентичность. Benford, вероятность участия, прогноз и контрфактическая экономия не объявляются нарушением или установленным фактом.
- K05/K06/K07–K10/O03/O04: номер со слешем допустим; ИКЗ, одинаковое имя и частота не гарантируют один контракт. Победитель и цена процедуры не доказывают заключение договора; число участников не выводится из ИНН победителя. Все виды комментариев, скрытые диапазоны, зеркала и durable история сохраняют источник/время/автора только при доказательстве. Отсутствие _ChangeLog не доказывает отсутствие изменения.
- C07/K03/K04/R10: исторический отчёт использует исторические источники обеих сторон; текущая живая книга не подставляется в архив. Недельные и месячные границы — Камчатка, год кода и год закупочного факта различаются. Неизвестные связи подтверждаются человеком, архив не удаляется ради нового reader.
- C01/U01/U06/U07: черновики сохраняются при сортировке/страницах/фильтрах; подтверждённое сохранение и Undo требуют authoritative readback. Export охватывает полный активный отбор, а не одну видимую страницу. Browser Back/Escape/focus, клавиатура, touch, масштабирование, оба режима, источник каждой цифры и контекст комментариев обязательны. API/IP или время чтения не доказывают автора изменения.
- U02/U03/U04/U05: прежние исследовательские запреты объёма/крема/синего не отменяют поздний Liquid Glass и четыре палитры. Реальная геометрия барабана/щита/угла/OrgStrip, переключатели с multi-select и утверждённые «Пульс»/«Заря» проверяются в браузере и реальной Figma. Исторические draft-макеты не считаются утверждением.
- S06/S07/C08/R06/R09: отсутствие ссылок в старом дампе не доказывает отсутствие Apps Script/external потребителей; новые поля/листы, массовые переименования и изменения скриптов не разрешены старой запиской. SQLite оценивается с нынешними writer/search/history требованиями; PostgreSQL не выбирается автоматически. Прямой deploy, эфемерная история и public-readonly для служебных данных больше не являются эксплуатационными инструкциями.

Дополнительные явные требования C04/C05/U01/R10: аналитика по программам и подпрограммам D/E, единый периметр НМЦК/цены, сохранение отрицательных значений экономии и раздельные архивные источники. C08/K07: масштабирование ЕИС требует замера квадратичных сравнений на нынешнем коде; историческая оценка нагрузки не является текущим benchmark.

README, DESIGN, CODEMAP, архивный PRODUCT_PLAN и исторический DEPLOY-RENDER получили явные ссылки на действующий канон/ограничения; прежнее содержимое и его даты сохраняются. Постоянный конкурирующий реестр не создан.

## Исполнительная точка — 12.10.2026 (Камчатка)

Канонические issue #69 и PR #79 сохраняются. PR #97 интегрирован в #79 коммитом `265b92e18bca15af17b869ce48a556bd9a094be1`, без повторной миграции книг и без публикации исходных ведомственных ячеек. На объединённом коде: 5508 тестов прошли, один пропущен; четыре typecheck прошли; lint — 0 ошибок, 302 предупреждения. Это техническая проверка, не принятие production и не завершение K07–K10.

Exact-SHA CI `38150406067` на 265b92e1 завершён SUCCESS, deployment SKIPPED. Read-only rehearsal `38150406060`: source-schema и runtime-диагностика PASS; frozen daily replay и независимый аудит PASS, два DOCX пересобраны, 159 исторических цепочек рекомендаций сохранены без потери/добавления ID и без изменения подтверждённых связей. Недельный архив остаётся `UNCHANGED_LEGACY_ARCHIVE_BLOCKER`; общий rehearsal FAILURE из-за `RUNNING_REPORT_WORKER_NOT_FOUND`. Это не доказательство двух самостоятельных циклов worker или полной Word-приёмки R10. Производственное состояние не исправлялось.

Текущий следующий блок K07/K09/U06/U07: открытая гигиена перечитывает результат после принятия нового snapshot ID; только ручная кнопка принудительно перечитывает Google. Таблицы дефектов и орфографии выводят по 100 находок, сохраняя полный знаменатель, фильтры и доступ ко всем страницам. Регрессионные сценарии включают поздний ответ старого снимка и последнюю страницу. Синтетический Chromium-набор 4000 находок: DOM уменьшился с 80059 до 2064 узлов; это не измерение production или времени Google. Статус: локальный код и проверки, live-приёмка открыта.

Полностью прочитаны все 253 tracked Markdown проекта: 80 спецификаций/планов, 92 аудита и 81 прочий документ. Приватные proof фиксируют SHA256 и полное чтение, а для изменённых после чтения файлов — исходный Git-blob и полный прочитанный diff с текущим hash. Это завершение чтения доступных MD, не завершение реализации всех их требований и не доказательство восстановления недоступных исходных переписок. Найденные дополнительные требования включаются в существующие ID:

- C04/K05/K06: разные семантики плановой суммы, годовая потребность и несколько фактических контрактов, история перераспределения; единое правило «план равен факту» не переносить на все строки.
- K07–K10/C08: Закупки 2.0, смысловые предложения и региональная классификация, существующие словари/формы/журналы; частотное сходство не подтверждает юридическую идентичность, источник не переписывается автоматически.
- C03/C05/U01/U06: полный экспорт активного среза, паспорт и переход к строкам каждой цифры; общий и текущий годы отчётов различаются.
- S06/S07/C07/K06: формулы, скрытые диапазоны, webhook, durable история; отсутствие записи _ChangeLog не доказывает отсутствие изменения.
- R06/R09: эксплуатационные инструкции актуализируются под резервирование всего постоянного состояния, проверку восстановления и exact-SHA gate. Прямой `compose up --build` не является разрешённым выпуском.

Старые предложения добавлять ручные ID/листы, повторять переименования/защиты, автоматически менять Apps Script, извлекать финансирование/статус из комментария или автоматически выкатывать не выполняются. Исторические документы сохраняются, их утверждения об исправленности проверяются заново по текущему SHA и источнику. Самостоятельные контуры оперативок и ОКРУГ 20/30 не считаются принятыми по изменениям Dash.

## Контрольная точка УКСиМП — 11.10.2026

Основа: PR #79, исходный SHA 96afe3eedf320dcf8f5caed45439a1871a4f1cce; единый реестр требований — существующий комментарий issue #69 (6107363839). Новый разбор не заменяет 56 результатов реестра.

| Инцидент | Состояние и проверяемый результат | Остаток |
|---|---|---|
| 1, 13–15: область/оценки | Исправлена подстановка общей Trust-оценки в пустую локальную область; FP исключён из доверия/активных счётчиков/Layer B | Не все экраны и выгрузки приняты; 69 — корректное округление 68,5, 91 — другой показатель |
| 3, 4, 8: решения/адреса | Общий readback решений, устойчивый якорь A/B/C/G, однозначное восстановление старого случая, сохранение доказательных снимков; UI объясняет статус | Нельзя восстановить уже удалённые архивы; неоднозначность не разрешается автоматически; реальный цикл источника ещё требует приёмки |
| 5, 11, 12: годовая потребность | Финансовые сигналы требуют закрывающую дату Q; ЕП не требует искусственно выравнивать план; антидемпинговый индикатор помечен эвристикой | Правовые основания, детализация договоров и принадлежность полей требуют подтверждённой методики |
| 7: формулы | Семантический гейт служебных строк и единый счётчик проверенных строк; отсутствие обязательной формулы/константа проверяются | Полная приёмка девяти источников и зависимостей не завершена |
| 10: копирование | Проверены два fallback-пути в Chromium, полный ручной текст при отказе | Браузер сотрудника и production ещё не проверены |
| 2, 9: организации/гигиена | Живой справочник 85 строк: AH соответствует R, иначе E; PR #97 содержит проверенные защитные изменения | Интеграция #97 и содержательная приёмка кандидатов; массовые замены не выполнялись |
| 6: финансирование | Выявлено различие signal N/P, отчётной корзины P и отдельного нулевого плана | Правило не менялось: signal требует пустые N и P, способ и положительный план; отчётная корзина требует пустую P и положительный план; lifecycle без денег требует нулевой план. Нужны адреса/скриншоты четырёх случаев. Пустая дата не доказывает отсутствие денег |
| 16–19: переносы/категории/регламент/OnlyOffice | Первичная переписка закрепляет связи ПФХД, остатки и историю переносов; жалоба OnlyOffice не воспроизведена | Модель связей и сравнительная группировка не завершены; исходные XLSX/ODS не предоставлены |

Дополнительные факты: при адресном чтении ВСЕ!694 УКСиМП и ВСЕ!187 УД бюджетные итоги сходятся до 0,01; старые сообщения о расхождении не подтверждены этим срезом. Это не атомарный freeze. Предоставленный Apps Script изучен без изменений: cleanup может удалять обработанные записи _ChangeLog старше 14 дней; его нельзя считать полным неизменяемым архивом. Развёртывание этого файла в каждой книге не подтверждено. SSH порт 22 из текущей среды отвечает Connection refused; read-only GitHub runtime-диагностика доступна отдельно. Production не изменялся.

**Уточнение 12.10 — два штатных типа Google.** Подготовлен bounded reader notes
и native threads/posts/anchors через текущий официальный Sheets API. История
расширяет существующее семейство комментариев; старые IDs и cache projection
не переписываются без сохранённого наблюдения. Многострочные `Было` сохраняются
как script-note claims, не как доказанные Google edit author/time. Разрешение
владельца теперь включает подготовку совместимой редакции Apps Script, но не
живую установку/триггеры. Оригинал упомянутого cleanup пока не восстановлен:
локальный поиск и адресный Drive-поиск дали старые материалы отчётности,
а не этот исходник. Остаток: точный исходный файл или projectId/getContent,
действующие triggers/consumers; после восстановления — ревизия batch/lock/
idempotence/quota/history/reentrancy с сохранением контрактов. До этого полная
замена не выдумывается; native Dash-credential readback и пользовательское
отображение ряд/журнал/ячейка остаются отдельной приёмкой.

## Актуализация 11.10.2026 — задачи № 12/13 «смысловая гигиена текста»

**Статус: защитные исправления #97 прошли собственный CI на a87f24a4; интегрированы в #79 коммитом 265b92e1 с общей регрессией. Полная содержательная и production-приёмка не завершена.**
Этот раздел обновляет устаревшие выводы июля, но сохраняет их ниже как исторический
контекст. Интегратор — [PR #79](https://github.com/gaben1488/dash/pull/79);
защитный [PR #97](https://github.com/gaben1488/dash/pull/97) уже интегрирован **в #79**. Не повторять интеграцию и не деплоить без приёмки.

**Один результат:** полный адресный корпус первичных и производных формулировок и
предложения по смысловым соответствиям сопровождаются в уже существующем рабочем
документе владельца на Google Drive (не копировать ведомственные ячейки в публичный
репозиторий). Этот план хранит карту исполнителей/статусов, не второй «словарь».

**Измеренный периметр:** 8 текущих закупочных книг = 4 093 содержательные строки;
в 14 полях B/C/D/E/F/G/L/M/U/AD/AE/AF/AG/AH — 57 302 потенциальных позиции,
41 682 непустые ячейки, включая X/Х, маркеры и короткие справочные значения;
число 37 414 из предыдущего замера имело иной фильтр и не является тем же
знаменателем (не использовать для оценки прогресса). G: 170 групп вариантных форм (945 первичных употреблений), M:
16 групп (2 620 употреблений), A/C/D/E/F/M/U/AE/AF/AG/AH — отдельные роли.
Зеркала считаются отдельно; две одинаковые категории не означают одну закупку.
Сохранять исходный текст и правовой/финансовый смысл.

**Основные 32 проверки (6 пакетов; вместе с пунктами 33–48 — конечная программа из 48, без бесконечного порождения задач):**
- А1–А5 — актуальный SHA/источники/колонки/потребители/унаследованные гипотезы
  (инвентаризация частичная; производные не пройдены полностью);
- Б6–Б15 — десять полных содержательных прочтений всех оригинальных, производных,
  исторических и процедурных текстов, с адресами, частотой и контекстом
  (G/M замерены, полный смысловой проход — не закрыт);
- В16–В20 — поэлементное сравнение подтверждённых исторических версий/журналов,
  смысловых искажений, временных и юридических изменений, проверка первички
  (подтверждён конфликт УО A336: AE «не оплачено» ↔ AF «оплачено»,
  факт оплаты по обязательствам не доказан);
- Г21–Г25 — многослойный разбор высказываний, поиск кандидатов, строгие
  положительные и отрицательные связи, отличать одинаковый предмет/разные
  закупки/различия в объёме, дате и норме;
- Д26–Д30 — встроить в действующие comment-consistency, text-hygiene,
  CHECK_REGISTRY и единый кейс контроля; сохранять историю и понятный
  интерфейс человеческой проверки;
- Е31–Е32 — fail-closed тесты и негативный корпус, full TS/lint/build/audit,
  независимый live readback, сохранение старых release/rollback и отдельно
  санкционированный production gate.

**Дополнительные контрольные пункты 33–48 (4 ограниченных пакета; всего 48).**
Они расширяют проверяемый периметр без создания параллельных проектов;
каждый закрывается только адресным доказательством, отрицательным тестом
и сохранением исходных чисел, а не добавлением гипотез в бесконечную очередь.

- Ж33 — полный source→mirror→свод→процедура→отчёт lineage с типом производной связи;
- Ж34 — версии схем, физические колонки, история переименований и роли всех текстовых ячеек;
- Ж35 — отдельно проверить формулировки итоговых Word и аналитических карточек против первичного текста;
- Ж36 — защита ведомственных текстов: сырая текстовка остаётся вне публичного Git;
- З37 — разбор отрицаний, времён, намерений и фактических утверждений (включая «не оплачено»);
- З38 — различать сказанное автором, структурный факт, подтверждённый документ и вывод ИИ;
- З39 — предикат/объект/состав работ, адрес, период, количество, субъект — без first-regex;
- З40 — юридические нормы, точные реквизиты, версия права и документальный proof-gate;
- И41 — принимаемые/отклоняемые человеком нормализации с причиной и версией правила;
- И42 — независимый holdout и жёсткие отрицательные примеры, отдельно precision/recall;
- И43 — измерять источники шума, калибровку уверенности и drift при обновлениях книг;
- И44 — отзыв/пересмотр ошибочного вывода, инвалидация по source SHA/версии, воспроизводимость;
- К45 — read-only контракт во всех существующих consumers (старые и новые срезы);
- К46 — непротиворечивые результаты централизации, дробления, ЕП, тройной сверки, сигналов;
- К47 — единый понятный UI «предложение + доказательства + отвергнуть», без опасной массовой вставки;
- К48 — exact-head тесты/сборка/a11y, независимая живая сверка, безопасный rollback,
  разрешение на production и подтверждение на работающем сайте.

**Статус новых 16 пунктов:** не приняты. Есть частичные read-only доказательства
и первый чистый модуль `analytics/subject-relations.ts` с 11 регрессионными
примерами в draft #97; сами по себе они НЕ закрывают ни один сквозной пункт.

**Исторически воспроизведённый дефект:** частотная подсказка rare→common выдавала
«сменой→сметной», «вместе→месте», «заданий→зданий»; сравнение предметов
иногда использует первые 60/100 символов или общую подстроку ≥8 символов,
что недопустимо как доказательство identity. В comment-consistency regex
распознавал «оплачено» внутри «не оплачено»; интегрированный #97 добавляет
контекстное распознавание отрицаний и возможный конфликт между AE/AF/AH,
но не доказывает реальную оплату. Собственный CI #97 на a87f24a4 прошёл (38146561530); общая интеграционная проверка 265b92e1 прошла (38150406067). Эти защитные тесты не являются смысловой приёмкой всех текстовых ячеек.

**Уточнение старого раздела 4:** Dash уже читает `_ChangeLog` через
`server/services/changelog-source.ts` и `provenance-journal.ts`;
утверждение «dash его не читает» относится к истории. **Нельзя** добавлять
постоянные ручные UUID/ID или столбцы в рабочие план-реестры, даже если
исторический план ниже предлагал запись суррогатного ID в таблицу. Для
любого исключения нужно отдельное разрешение владельца.

## 0. Цель и критерий «готово»

Дашборд — это отчёт по закупкам, ставший живым. Он **содержит всё, что писали в отчёте руками**,
и умеет то, чего бумага не может: развернуть любое число до исходной ячейки, разрезать по шести
осям, показать причину расхождения.

Текущий контракт включает генерацию трёх Word-документов из проверенного замороженного среза: основной отчёт, дополнение и оперативный отчёт. Dash показывает согласованные показатели и доступные проверенные выпуски. Историческое ограничение «не генерирует .docx» заменено принятой реализацией по issue #58; эксплуатационный отказ worker рассматривается отдельно в #93.

Отдельная цель — **уход от таблиц**: dash обязан безупречно работать поверх Google Sheets, а затем
предложить миграцию на себя как на источник истины (см. §4).

**Критерий, а не вкус.** Эталон — реальный отчёт `ОТЧЕТЫ/Отчет по закупкам на 20.03.2026 итоговый
для АС к совещанию 26.03.2026.docx`. Каждое его утверждение — строка контрольного списка ниже.
Покрытие меряется в процентах и растёт. «Даже лучше» — это колонка «Сверх отчёта».

Качество не менее важно, чем полнота: **каждая метрика, карточка и страница обязаны стать логичнее,
удобнее и понятнее**, а не просто «содержать число».

---

## 1. Контрольный список покрытия (эталон → dash)

Колонки: **Данные** — умеет ли ядро посчитать. **Показано** — видно ли пользователю, объяснимо ли,
разрезается ли. **Сверх отчёта** — что даёт dash, чего в документе быть не могло.

Легенда: ✅ есть · ⚠ частично (куски есть, сборки нет) · 🔴 нет.

### Глобальный блок — конкурентные процедуры

| # | Утверждение отчёта | Данные | Показано | Сверх отчёта |
|---|---|:--:|:--:|---|
| 1 | Год: N процедур, сумма, ФБ/КБ/МБ | ✅ `plan_count`,`plan_total`,`plan_fb/kb/mb` | ⚠ | drill до строк |
| 2 | По кварталам Q1-Q4: N, сумма, бюджеты | ✅ `plan_fact_quarterly` | ⚠ | помесячно |
| 3 | Фактически заключено: N, сумма, бюджеты | ✅ `fact_count`,`fact_total` | ⚠ | провенанс ячейки |
| 4 | Крупные ЭА на 2-4 кв, сгруппированы по ГРБС (наименование + плановая дата + сумма) | ⚠ строки есть, вью нет | 🔴 | сортировка/порог, экспорт |
| 5 | Отклонение от плана Q1 (шт) + общее исполнение Q1 % | ✅ `deviation`,`exec_count_pct` | ⚠ | разрез по методу/активности |
| 6 | Исполнение Q1 по ГРБС, ранжировано (% + план кв / исполнено / план год) | ✅ `dept_exec_count_pct`,`dept_rank` | ⚠ RatingTableV2 | тренд-спарклайн, дельта к неделе |
| 7 | Остаток незаключённых до конца года | ⚠ выводится, метрики нет | 🔴 | по стадиям |
| 8 | В работе у отдела: по стадиям (извещение / итоговый протокол / подача заявок) | 🔴 стадии нет (`U` — свободный текст, 12%) | 🔴 | из ЕИС «Этап закупки» — точно |
| 9 | Расчётная экономия по оставшимся + бюджеты | ⚠ `avg_reduction_pct` есть, агрегата нет | 🔴 | сценарии прогноза |

### Глобальный блок — единственный поставщик

| # | Утверждение отчёта | Данные | Показано | Сверх отчёта |
|---|---|:--:|:--:|---|
| 10 | ЕП: год/квартал план, заключено | ✅ `ep_count`,`ep_plan_total` | ⚠ | |
| 11 | Распределение ЕП по ГРБС: % от фактической суммы + разбивка причин (монополисты / обучение / техника) | ⚠ `analyzeEPReasons` даёт count+сумму; «% от суммы ГРБС» — сборка | 🔴 | доля `UNMAPPED` как метрика качества |
| 12 | Анализ: N обоснованных vs M к централизации | ⚠ `findCentralizationOpportunities` + `is_legitimate` кластеров — сборка | 🔴 | построчное доказательство |
| 13 | Выводы: низкая заинтересованность / квалификация | 🔴 человеческий вывод | 🔴 | подпереть цифрами (доля ЕП, доля UNMAPPED) |

### По каждому ГРБС (×8)

| # | Утверждение отчёта | Данные | Показано | Сверх отчёта |
|---|---|:--:|:--:|---|
| 14 | КП: год, Q1 план+бюджеты, проведено, исп. Q1 %, исп. год %, экономия | ✅ | ⚠ | двойное исполнение рядом |
| 15 | Осталось отыграть (список позиций) | ⚠ сигнал `planWithoutExecution` есть, вью-списка нет | 🔴 | фильтр+экспорт |
| 16 | Планы подать заявки + стадия («заявка передана в уполномоченный орган») | 🔴 стадии нет | 🔴 | из ЕИС |
| 17 | ЕП: год, Q1, заключено, исп. %, экономия, осталось заключить | ✅ / ⚠ остаток | ⚠ | |
| 18 | Рекомендации: вынести на ЭА / объединить раздробленные | 🔴 `recommendations.ts` — 13 правил, **0 импортёров** | 🔴 | ранжирование по эффекту |
| 19 | Реакция ГРБС: «Позиция принята / не принята, так как…» | ✅ колонка `AE` заполнена на **91%** | 🔴 **0 упоминаний в web** | связать с рекомендацией |
| 20 | Совместные закупки подведов (УО: бумага −24.68% на 35 учреждений) | 🔴 модели нет | 🔴 | эффект совместной закупки |
| 21 | Оговорки и контекст ГРБС | ✅ `AE` 91% | 🔴 | привязка к строке и к числу |

### Базовая линия (замер 2026-07-10)

| | Данные | Показано |
|---|---:|---:|
| ✅ полностью | 7 / 21 (33%) | 0 / 21 (0%) |
| ⚠ частично | 8 / 21 (38%) | 9 / 21 (43%) |
| 🔴 нет | 6 / 21 (29%) | 12 / 21 (57%) |

**Вывод:** ядро считает больше, чем показывает. Самый дешёвый прирост — не новые расчёты,
а показ того, что уже посчитано (строки 19, 21: данные заполнены на 91%, в UI отсутствуют).

---

## 2. Порядок работ

1. **Рефакторы** (приоритет пользователя): чанки G → E → F → D → C-narrow.
   Порядок и запреты — верифицированный аудит (B и C-full заблокированы, не трогать).
2. **Дешёвый прирост покрытия**: показать `AE`/`AF` (строки 19, 21) и подключить
   `recommendations.ts` (строка 18). Данные и код существуют — цена в том, чтобы соединить.
3. **Сборки, где куски есть**: строки 11, 12, 9, 7.
4. **Стадии закупки** (строки 8, 16) — требует источника; точный ответ даёт ЕИС `Этап закупки`.
5. **Совместные закупки** (строка 20) — новая модель.
6. **Качество UI** — сквозная работа, не фаза: каждая карточка, метрика и страница проходят
   `impeccable-shape → audit → polish`, тексты — `/humanizer`. Число без объяснения не показываем.

---

## 2.1 Очередь исполнения (руки берут отсюда; протокол — AGENTS.md)

Правила очереди: одна задача = один коммит с зелёным гейтом. TDD на поведение,
characterization на move-only. Дорожки A/B/C независимы по файлам — можно параллельно
в worktree; внутри дорожки строго по порядку. Источник вердиктов — bug-hunt
wf_2da4b60c-e6f (43 CONFIRMED адверсариально; «✅» = уже закрыто).

### Дорожка A — рефакторы (продолжение чанка G, затем E/F/D/C-narrow)

- [x] G-1 `CHECK_REGISTRY` → `check-registry.ts` (f4a56b0)
- [x] G-2 legacy-конвертация → `issue-conversion.ts` (8c95f24)
- [x] G-3 `dataset-signals.ts` 1380 → 660 (−52%): `seasonal.ts` · `splitting.ts` ·
      `anomalies.ts` + общий `utils/row-cells.ts`. Обе barrel-ловушки живы и
      переэкспортированы. Побочно удалён `normalizeSub` — пустая обёртка вокруг
      `subordinateKey` (f027048, a6f4dcc, 2333571)
- [ ] **G-4** (опционально) остаток `dataset-signals` (660): вынести `benfordTest`+
      `detectOutliers` в `benford-outliers.ts`; ядро оставить оркестратором
      (`analyzeDataset`, composite, noise-map). Ниже 600 — уже не god-file.
- [x] E fact-empty → shared `fact-date.ts` (`FACT_DATE_PLACEHOLDERS`+`hasFactDate`),
      семантически отдельно от `ORG_ITSELF_PLACEHOLDERS`. RED-тест первым (92fa0b8).
- [x] F method KP/EP: `unified-svod methodOf` слеп к алиасам ЕП (`ЭЕП`/`Ед. поставщик`) →
      канон `normalizeMethod()`. Замер на 64 реальных файлах: 0 impact сегодня (только
      `ЕП`/`ЭА` в данных), баг латентный для будущих ГРБС/лет (38edb24).
- [x] D — **план был неточен**: аудит показал не 3 живых определения, а 1 живое
      (`RowSignals` signals.ts) + 2 мёртвых недостижимых (`RowSignal` types.ts — 0
      импортёров, не экспортирован; `RowSignalSchema` — 0 `.parse()`-вызовов). Оба
      удалены вместо z.infer-слияния (864f0ee).
- [x] C-narrow DEPARTMENT_ROWS: 32 row-anchor выведены из DEPARTMENT_REGISTRY[].svod
      через существующий `getDeptByLatin()` (abc94fd). Полная унификация реестров
      остаётся ЗАБЛОКИРОВАНА (не эквивалентны, см. аудит w8j5qi2aa).

**Дорожка A ЗАКРЫТА** (2026-07-11): G→E→F→D→C-narrow, все 6 пунктов. CI зелёный
на всей серии (6/6). Дальше — дорожка B.

### Дорожка B — подтверждённые баги (CONFIRMED, вне файлов дорожки A)

- [x] B-1 AD-gate `analytics.ts` ×3 сайта (5485fce)
- [x] B-2 границы записи `rows.ts` PUT+batch (de88199)
- [x] B-3 regex `EP_NOT_WORTHWHILE` (95d4c21)
- [x] B-4 `issues.ts:175` — оба INSERT в одной транзакции, `snapshotId:null` вместо
      несуществующего `'manual'`, ошибки не глотаются (500/success:false вместо лжи).
      `overlayPersistedStatus()` подмешивает статус из БД в GET-list/detail/export (все три
      читали только пересчитанный snapshot) (a163e7e).
- [x] B-5 `store.ts:306` — `setYear` синкает `activeMonths` из `monthsByYear[target]`
      как `toggleMonthInYear`/`toggleQuarterInYear`/`toggleYearFull` (4864935).
- [x] B-6 `google-sheets.ts:276,286` — `isNonRecoverableSheetError()` (429/403/5xx) больше не
      маскируется под «не найдено»; `errors[]` ключуется чистым deptName через zip по индексу
      вместо regex по тексту ошибки (b3ab012).
- [x] B-7 `demo-data.ts:429` — знак amount_dev в demo-агрегатах выправлен на fact−plan (d53d6cd).
- [x] B-8 `calc-engine.ts:415` — `GroupedResults.droppedRows` считает молча отброшенные
      строки (пустой слот / не прошли классификацию); `validate.ts:45` — unknown-лист теперь
      даёт issue `unclassified_sheet` (severity `warning`, подтверждено пользователем) вместо
      тихого пропуска всех svod/department-правил (eced5ee).
- [x] B-9 `snapshot.ts:101` `inFlightLoads` дедупит конкурентные force-refresh (без него —
      2× полная перечитка всех листов); `:19` `setDeptSheetCache(data, failedDeptNames)` —
      упавший в цикле dept удаляется из кэша, не остаётся молча как «свежий» (a52a23b).
- [x] B-10 ПЕРЕПРОВЕРЕН и ОПРОВЕРГНУТ — уже пофикшен в более ранней сессии. Лейбл
      `calc-engine.ts:358` = «Потрачено, %» (не «экономия»), `registry.ts:301-314` явно
      документирует legacy-семантику + pitfall, 2 guard-теста закрепляют, 6+ живых call sites
      маппят на реальную колонку Q листа СВОД. Действий не требуется (eced5ee, коммит-нота).

**Дорожка B ЗАКРЫТА** (2026-07-11): все 14 пунктов (B-1..B-14). CI зелёный на всей серии.
- [x] B-11 год теперь доходит до всех трёх reconciliation-эндпойнтов (`api.ts` +
      `Recon.tsx:247`, оба useEffect deps включают `year`) — сервер уже поддерживал `?year=`,
      UI просто не слал. `Header.tsx` PAGE_FILTERS проверен против App.tsx — не баг, фикс не
      нужен (5016ad4).
- [x] B-12 `vite.config.ts` — `allowedHosts` вынесен в `resolveAllowedHosts(env)`, дефолт
      Vite localhost-only, `AEMR_VITE_ALLOW_PUBLIC_HOSTS=true` включает permissive-режим
      (115fcae). `host:true` не тронут — отдельный класс риска (network bind, не Host-header).
- [x] B-13 `fetchJSON` (`api.ts`) — `new Headers(init?.headers)`, Content-Type/Authorization
      ставятся только если вызывающий их не задал (5016ad4).
- [x] B-14 zod выровнен: shared `^3.24.0` → `^3.25.76` (как server) (6560b3a).

### Дорожка C — покрытие отчёта (контрольный список §1)

- [ ] **C-1 показать AE** (строка 19/21, данные заполнены на 91%): DataBrowser — колонка
      «Комментарий ГРБС» с показом по клику; страница Issues — комментарий строки рядом с
      замечанием. Дизайн: `impeccable-shape` ДО кода (бриф: пользователь = УЭР, вопрос —
      «что ГРБС ответил по этой строке»), потом `impeccable-audit`.
- [ ] **C-2 wire recommendations.ts** (строка 18): экспорт из core/index → route
      `GET /api/recommendations` → секция на Recs.tsx «Рекомендации по правилам» рядом с
      issue-derived. 13 правил уже написаны и оттестированы паритетно с отчётом.
- [ ] **C-3 сборка «ЕП-причины по ГРБС»** (строка 11): % от фактической суммы + разбивка
      по 15 кластерам + доля UNMAPPED как метрика качества словаря.
- [ ] **C-4 «осталось отыграть»** (строки 7/15): вью списка по сигналу `planWithoutExecution`
      с суммой и сроком.

### Отложено (блокер — не мы)

- VPS не оплачен: TLS, Caddy-инъекция ключа (auth фактически выключен снаружи!), rollback-теги,
  мониторинг прода. При оплате — первым делом Caddyfile.
- RBAC/логин — предпосылка миграции (§4), отдельная волна после дорожек A-B.
- husky skip-гейт для не-TS коммитов — осознанный компромисс (иначе OOM блокировал ml sync);
  компенсация: CI на PR гоняет полный гейт всегда.

---

## 3. Инварианты (не режутся никогда)

Полный список — в корневом `AGENTS.md` (ponytail + carve-outs AEMR). Кратко: AD-gate экономии,
знак `amount_deviation` = факт − план, ТД-ПМ по столбцу D, пороги 44-ФЗ только из `@aemr/shared`,
`classifySheet` как единственный распознаватель листов, запрет тихих провалов, границы записи в лист.

---

## 4. Уход от таблиц (миграция)

Проверено по коду: таблица `procurement_rows` в схеме **есть**, но её никто не читает и не пишет,
и спроектирована она как проекция снапшота, а не как источник истины (нет автора, версии, времени).
Лист `_ChangeLog` в книге ГРБС ведётся (`Было|Стало|Время|Автор`), но dash его не читает.

**Настоящий блокер — идентичность строки.** Ключ сегодня `(departmentId, rowIndex)` — позиционный.
Сортировка или вставка строки в листе меняет смысл «строки №42». Поверх такого ключа можно считать,
но нельзя владеть данными.

Этапы:
0. **Идеально поверх таблиц** — точность, ноль необоснованных расхождений, объяснимость. Лист — источник истины.
1. **Двусторонний журнал** — dash пишет ячейку и фиксирует событие в формате их `_ChangeLog`;
   dash **читает** их `_ChangeLog` и видит правки мимо себя. Обе стороны восстановимы друг из друга.
2. **Смена владельца** — `procurement_rows` получает устойчивый ключ (ИКЗ, где он есть; иначе
   суррогатный id, записанный обратно в лист), версию, автора. Ввод — в dash. Лист — выгрузка.
3. **Отключение** — лист остаётся кнопкой «выгрузить», а не каналом.

**RBAC — предпосылка миграции, а не соседняя фаза:** восемь ГРБС не могут править данные без
логина и прав. Решение принято: multi-user RBAC (УЭР/ЦЭР — полный доступ, ГРБС — свой скоуп).

**ИКЗ нагружен дважды:** ключ связи с ЕИС и ключ идентичности при миграции. Заполнен на 24%
(замер по `Сводный_реестр_и_УЭР_2.0_v4_1.xlsx`). Требование к ГРБС проставлять его — самый
выгодный рычаг во всём плане: одна колонка делает сопоставление точным, а миграцию — возможной.


### Уточнение ЕП после жалоб УКСиМП, 12.10.2026

Решение владельца по 14 позициям уточняет п.137(2): распознанная дискреционная причина в M даёт предупреждение (`warning`) для проверки основания/документов, а не критическую констатацию нарушения. Законная безальтернативность и подтверждённая выгода остаются справкой; пустая причина требует строгой проверки; непустая нераспознанная причина даёт экспертное предупреждение и проверку покрытия справочника. Комментарий AF не заменяет M и не закрывает сигнал. Правовая приёмка оснований этим изменением не выполняется.

Доказанная годовая серия — структурно открытая ЕП с накопленным фактом и подтверждённым якорем `книга + № п/п + полный предмет` из существующей разметки. Она остаётся открытой информационной проверкой сумм отдельных договоров. Повторное использование номера, неизвестный/усечённый предмет и индивидуальная дата не доказывают серию. Первичные суммы, история, исходные severity исторических снимков неизменны.

Контрольный срез 11.10.2026 13:44 UTC (не атомарный): УКСиМП — 42 строки ЕП с планом выше порога; 27 оснований монополии не создают пороговый сигнал, одна доказанная серия информационная, 14 причин `EP_NOT_WORTHWHILE` остаются предупреждениями для разбора. Это сопоставление актуального среза, а не доказанное отождествление с недоступными 25 скриншотами.


Дополнительный сквозной страж: отрицание «не является монополистом» не должно становиться кластером законной безальтернативности. Единый предикат отрицания перенесён в существующий канонизатор причин; он исключает отрицательный матч монополии и продолжает проверку иных явных оснований. Без иного распознанного основания результат `UNMAPPED` требует экспертной проверки, а не утверждает отсутствие основания или нарушение; отдельное явное основание п.8 не стирается. Competition сохраняет денежный объём записи и перестаёт относить отрицание к законной безальтернативности.


Контракт старых текстовых сумм: контекст серии во всех потребителях использует существующий `toNumber` из `@aemr/shared`, включая `800,00` и `1 200,00`. Пустая/нераспознанная сумма остаётся неопределённой, а не становится доказанным нулём. GET списка/карточки строки, проверка источника и pipeline проверены на одной такой строке. Сохранение первичных сумм не меняется.

Граница K02/C06: снятие критического тона с непустого `UNMAPPED` не равно полной приёмке скоринга; для подтверждённого по исходному M UNMAPPED применяется существующая классификация диагностики словаря без штрафа; неизвестный исторический контекст не даёт права переписать прошлое. Прочие веса предупреждений требуют отдельной методической приёмки. Нераспознанная причина не объявляется отсутствующим правовым основанием.
### C05/C06/K06/U06 — push и единое принятое чтение, 2026-10-12

Исправлена фактическая цепочка startup → существующий persistent `webhook-channel` → durable очередь → чтение источника → SSE → принятое dashboard-чтение → общие bucket counts навигации. Прежнее имя `startDriveWatch` сохраняется как совместимый адаптер, без второго таймера регистрации. Stop/start инвалидирует поколение; регистрация сериализована, повторные reschedule дают один следующий подход, устаревший ответ не публикует канал и по возможности останавливает его в Drive. Срок продления берётся из ответа Google, ошибки сохраняют повтор и периодический опрос.

Тихое принятие SSE не перезаписывает более новое обычное чтение; новый event во время GET, включая одинаковое время события, остаётся непринятым до следующего чтения. Bucket counts обновляются общим store-fetch после принятия, без отдельного UI-запроса и без изменения геометрии «Пульса». Уведомление Drive не считается изменением ячейки или доказательством автора.

Кодовая проверка: отрицательные stop/start, reschedule-in-flight, одинаковые SSE timestamps и конкурирующий dashboard GET; интеграционные тесты startup/close и durable enqueue/read/retry. Live-приёмка ещё требуется: точный runtime SHA, HTTPS callback через Caddy, наличие WEBHOOK_PUBLIC_URL/WEBHOOK_SECRET без раскрытия секрета, права Drive на настроенные книги, подтверждённые каналы/сроки, очередь/readback и принятое SSE-чтение с едиными counts. Наличие конфигурации не доказывает успешной регистрации Google. Автоматического production-запуска из этой проверки нет. Runtime смена списка источников должна вызвать существующий reschedule; production-потребитель этой функции пока не подтверждён.

### R08/R09 — инфраструктурный handoff и изоляция отказов, 2026-10-12

Включены исходники реально установленного инфраструктурным исполнителем host guard,
systemd timer, online resource limits и bounded logging. Семь Linux-регрессий и Ruff
PASS. API/worker root этой интеграцией не пересоздавал. Операционный исполнитель позднее
под общим flock подтвердил bounded logging 10m×3 на всех четырёх прежних image IDs;
реальные пики памяти учтены, данные не откатывались. Default worker admission
остаётся false, публикационный source-change не запускает восстановление API/данных.
Новая инфраструктура не доказывает два принятых цикла: attempt 1051cf18296849b1b8e5bf4d5b434d46
на handoff атрибутирован RUNNING/FLOCK, завершился SOURCE_CHANGED; это не отказ API.
Новый после ротации 025a завершился VERIFIED_WITH_WARNINGS без ошибки, но отдельная
FLOCK sample отсутствует: два самостоятельных атрибутированных цикла ещё не приняты.

Следующий release gate обязан учитывать общий maintenance lock: многокомандное
backup-окно сохраняет владение между prepare/transfer/match/resume; deploy/rollback
не конкурируют с включённым guard. До независимой проверки этого допуска production
workflow не запускаются. Существующий RUNBOOK актуализирован; внешняя ветка копий/
Telegram отложена владельцем. Живой read-only webhook-state: 10 active, 0 expired,
142 received/0 rejected, 19 refreshRuns/0 refreshFailures; это свидетельство текущего
runtime, а не приёмка нового startup кандидата.
### K06/S08 — одинаковое время наблюдений комментариев, 2026-10-12

Actual SQLite негативный тест выявил потерю третьего свидетельства при A → B → A с одинаковым readAt: три положительных результата записи при двух сохранённых строках. Исправлена идентичность перехода с включением предыдущего observation ID; сортировка readAt имеет устойчивое разрешение равенства через SQLite rowid. Повтор того же последнего свидетельства сохраняет дедупликацию; неизменяемые payload, ответы, nullable author и source scope не переписываются. Аналогичный равновременный возврат проверен для legacy projection. Положительный результат store означает фактическую вставку, а не подавленный конфликт. Проверка локальная, без записей Google или production; существующие исторические идентификаторы не мигрируются.
### EP: уточнение цены договора и пояснений источника (12.10.2026)

K/Y в план-реестре — суммы позиции, а не доказанная цена одного договора. Чтение текущей строки передаёт единый read-only контекст `amountBasis=position-total`, M (основание), AE (необходимость), AF (история/пояснение). Заполненная Q не устанавливает количество договоров. Общая сумма выше порога остаётся открытой проверкой цены и основания, а не критическим доказанным нарушением; неопределённость исходных данных классифицируется существующими `mapping_error/completeness` без штрафа сотруднику во всех пяти компонентах доверия. Отдельные проверки действительно отсутствующих полей сохраняются.

AF не парсится в автоматическую законность, подтверждённую годовую серию или решение о закрытии. Поэтому чужой предмет, прошлый год, отрицание монополии, упоминание 223-ФЗ, компенсация или смешение п.12 ч.1 и ч.12 не дают ложного legal PASS. M/AE/AF сохраняются без изменения; новые индивидуальные цены не выдумываются. Отсутствие PDF/приложения само по себе не считается ошибкой. Статутные условия, отдельные цены и применимость основания остаются самостоятельной проверкой. Ранее сохранённая серьёзность исторических замечаний не переписывается. Существующая аналитика кластеров M и денежные показатели этим блоком не пересчитываются.

### Недельный контроль и уплотнение строк

K03/K05/K06/C07/U06 — 12.10.2026: в подготовленном исправлении сравнение живых чтений использует существующий Core diffSnapshots и уникальные номера A, включая дробные. Очистка позиции и уплотнение оставшихся строк дают отсутствие одного прежнего номера без мнимых изменений остальных; настоящая правка после сдвига сохраняет номер и новый адрес, автор старой физической ячейки не приписывается. Повтор номера, смена предмета/учреждения и возможная перенумерация требуют проверки человеком; межкнижный перенос автоматически не подтверждается. Журнал начинается в точном моменте последнего полностью проверенного недельного контроля по Камчатке. Новая неполная/несовместимая контрольная попытка не заслоняет более старую пригодную: каждый кандидат проходит прежнюю строгую проверку, причина пропуска видна. Если пригодного контроля нет, сравнение остаётся неизвестным с диагностикой. Свод журнала описывает записи/действия и недельные наблюдения, а не обещает чистую разницу всех ячеек. Локально: 122 server-файла/927 тестов PASS, server typecheck PASS; независимое ревью PASS. Полный интеграционный gate, браузерное подключение накопительного свода и live-приёмка остаются открытыми. Записи Google, форматирование, условные правила и архивные снимки этим исправлением не меняются.

### R05/R09 — prerequisite read-only upgrade rehearsal, 2026-10-12

Candidate-overlay source-schema/frozen-replay на legacy report-state без publication-readers.lock теперь имеет явный read-only preflight и машинный BLOCKED/код 2 с отдельным требованием authorized quiescent bootstrap. Lease не создаётся workflow; copied_catalog не считается заменой fencing immutable release files. Preflight стоит до source-schema и всех frozen-replay consumers (published summary, detailed stats, history/weekly/archive). CI не объявляется пройденным до отдельного допуска оператора и успешного повторного rehearsal; unfenced fallback и копирование 18 GB не добавлены. Missing lease, active maintenance и successful existing lease проверены с сохранением исходных bytes/inode.

### R08/R09 — восстановление maintenance-lock после reboot, 2026-10-12

Установщик guard берёт тот же EX lock до любых host mutations. Native tmpfiles
правило root:root/0600 и service prerequisite восстанавливают volatile lock после
reboot, сохраняя inode существующего владельца flock. RED на прежнем установщике
под конкурирующим владельцем воспроизведён; 19 настоящих Linux deployment tests,
включая isolated systemd-tmpfiles и повторное создание под действующим flock, PASS.
Ruff всего report-engine и изолированная проверка systemd unit syntax PASS;
независимое ревью PASS. Production maintenance actor должен быть privileged;
фактические SSH-права и live установка этой дополнительной защиты ещё не приняты.
Автоматический cross-job backup → deploy handoff остаётся явно BLOCKED, а не
обходится снятием lock; независимые source gates и API availability сохраняются.

### K06/U03/U06 — накопительная история в существующем барабане, 2026-10-12

Код 01cd4fee подключает LiveHistory к серверному журналу с последнего завершённого
недельного контроля. Mount/open и принятое новое dashboard-чтение обновляют свод;
15-секундного опроса нет. Закрытие и acknowledgement не обнуляют накопленный счётчик.
Ошибка или отсутствующий baseline остаются неизвестными, а не нулём; author берётся
только из свидетельства. Оригинальная трёхрядная геометрия и управление сохранены.
Локальные 9 целевых тестов и независимое ревью PASS; полный интеграционный CI,
live readback и продуктовая приёмка остаются открытыми.

### R08/C07 — scoped финальная проверка источников отчёта, 2026-10-12

Код d20f4509 после независимого ревью сравнивает значения, формулы, дополнительные
столбцы, schema/geometry и семантические метаданные зарегистрированных источников
при изменившейся Drive version. Presentation metadata одинаково нормализуются для
старого снимка и свежего чтения; hidden у посторонней вкладки не выдаётся за правку
данных. Реальные наблюдённые токены публикуются отдельно от captured; исходный raw
context не меняется. Локальный source contract, identity, recommendation history и
weekly evidence не обходятся. Автор: 1028 Python PASS, 132 targeted PASS; независимое
ревью 20 focused PASS, финальная дополнительная проверка late drift PASS. Полный
Ruff PASS. CI38192545231 пока FAILURE из-за устаревшего synthetic backup fixture
(guardian) и неиспользуемого присваивания weekly consumer; это не зелёный gate.
Перенос узкого diff на установленную 9df и live smoke/два самостоятельных цикла
принадлежат инфраструктурному исполнителю и ещё не приняты. Полные новые модули
storage/reader не переносятся как часть этого worker-only hotfix.

Дополнительно: полный UI 202 файла/2212 тестов PASS. Серверный прогон 945 PASS/1 FAIL
выявил старый положительный fixture серии без P; он уточнён P=2026, отрицательные
GET list/detail с пустым годом и 2027 сохраняют запрет ложной исторической идентичности.
Независимое ревью и 5 targeted PASS; 41 weekly/year targeted PASS. Lint всего проекта
после удаления лишнего присваивания PASS (существующие warnings сохранены).

### Проверенная интеграционная точка a1f4d78c, 2026-10-12

CI38193249638 SUCCESS: полный Python1052 PASS, 60 synthetic maintenance tests,
TS lint/types/tests/build/audit, server image/native reader и browser Word contract
PASS. DB identity38193249631 SUCCESS. Отдельный read-only upgrade38193249660
остаётся BLOCKED/PUBLICATION_READER_LEASE_UNINITIALIZED; это не скрытый PASS.

Инфраструктурный исполнитель установил worker-only image
sha256:c39f7c40c9e4b8f79b9bcb3926956c52d30f2bfc5d7672298b71093fbf90a319: узкий
порт основного d20f4509 на действующую9df, НЕ полные новые storage/reader модули
и НЕ последующий alias comparator a1f4d78c. На фактической9df RED скрытия/format
воспроизведён; patched39runtime/Ruff и исходный проблемный source recheck PASS.
API/web/caddy images и IDs сохранены. Новый2a39454f7e19440696b6e3ed80a95681
атрибутирован RUNNING/двойной host FLOCK и завершён01:57:47–01:59:21UTC
VERIFIED_WITH_WARNINGS; native context/snapshot/3Word PASS. Второй самостоятельный
цикл ожидается около02:14:21UTC; строгие2цикла пока НЕ приняты. Boot lock
tmpfiles/unit установлен исполнителем с сохранением inode; guard events=[].
Alias source-проверка подготовлена отдельно; S04/R05 не объявляются завершёнными.

Портировано инфраструктурное уточнение guard: при worker admission=false
различие worker-only image не отменяет resource protection; start/recovery
по-прежнему выключены, при включённом admission строгий image guard сохранён.
Локальные RED на старом guard и GREEN7/Ruff PASS; следующая source CI требуется.
Root не выполнял VPS mutations и не прерывает циклы.

### Повторная сверка PR и открытых границ, 2026-10-12

Проверены 18 открытых PR: вне #79 новые SHA относительно предыдущей сверки не
появились. #97 уже MERGED; его 48 критериев сопоставлены K07–K10 и связанным ID,
а не объявлены 48 принятыми исходами. Повторное объединение не выполняется.

C04/C05/C06: выявлен конкретный дефект объяснения reconciliation: значение
economy_total разбирается вкладом factMoney/Y вместо официальных AD/Z+AA+AB.
Исправление интегрировано 2c9a6cd4 после независимого ревью: используются
официальные AD/Z+AA+AB, знак и адреса; неподходящие эвристики оставляют причину
неизвестной. Устранены cross-year attribution и двойной вклад при пустых P/O.
34 core и 3 настоящих GET-теста независимо PASS; итоги расчёта не изменены.
C06: наличие будущей Q само не доказывает закрытие; проверяется единый clock
снимка для предиката «Экономия без отметки» и правила листа, без подмены
исторического времени текущим. Официальный AD-gate не меняется.

K02: trust/scorer.ts:209 ещё даёт 100 при отсутствии сравнимых дельт; unknown
coverage остаётся открытым. K08/K10: SubjectRelation не подключён к устойчивым
экспертным решениям/инвалидации правил. U04: настоящая редактируемая Figma
и приёмка всех 13 страниц не доказаны. K07/C07/R10: восьмикнижное чтение
с выбранными зеркалами не закрывает девятый источник, процедуры и всю историю.
Эти границы сохраняются в канонических 56 ID; нового реестра не создано.

### R08 — завершённая эксплуатационная приёмка worker-only hotfix

Инфраструктурный исполнитель подтвердил TWO_AUTONOMOUS_CYCLES_VERIFIED на
worker image c39f7c40: 2a39454f7e19440696b6e3ed80a95681,
01:57:47–01:59:21 UTC (идемпотентное повторное использование выпуска), и
c0190d00bf0f43f5affdeec0de04831a, 02:14:25–02:20:52 UTC
(полное создание и публикация). Интервал904с после завершения первого.
Оба RUNNING + host FLOCK подтверждены дважды; context/snapshot и три Word
после каждого PASS. Второй receipt содержит один реальный semantic equivalence
proof и фактические provider revisions. API10loaded/0failed, no OOM/restart;
все четыре контейнера имеют ротацию10MiB×3, boot/maintenance lock PASS.
Приватные provenance/activation/acceptance receipts сохранены на VPS в
/root/codex-fixes/source-proof/. Повторная приёмка этой пары не нужна.
Это принятие узкого d20f450 hotfix поверх native9df, не всего HEAD приложения.
Следующий общий выпуск должен сохранить его исправление и web-hotfix.

R09: 1fc6b6e6 сохраняет новый текущий полный checkpoint под одним владельцем
maintenance-lock; независимые32 scope+26 backup PASS, исходный API возвращается
при ошибке до замены контейнеров. Live gate ещё требует подтверждённой
ёмкости, привилегированного release actor и native reader-lease prerequisite.
CI38195975155 на28f43405: TS/lint/build/image/синтетические проверки PASS;
Python1051 PASS/1 FAIL — статический тест exact-SHA требует старый literal,
не учитывающий закрытие fd9. Исправляется тест без ослабления exact-SHA гейта.

### C06 — актуальная сверка дат и будущая подготовка решения

Свежая неатомарная read-only перечитка восьми книг02:26UTC: 4093 фактических
строки данных, Q отсутствует795, будущих0, прошедших3298. Предикат отметки
экономии на28f43405 и RULE_BOOK совпал: 29 замечаний, все с наступившей Q.
Шесть указанных строк УКСиМП не дают замечания; их расхождение ниже уже
существующего порога машинного шума. Текущие значения не доказывают состояние
источников на дату старого скриншота. Native API наблюдение запрошено отдельно.
Владелец подтвердил объяснение сотрудницы о будущей Q и поручил полезное
напоминание ГРБС/УФ заранее подготовить решение; это не официальная экономия,
не просроченная AD-отметка и не основание штрафа. Реализация идёт через
существующий канон/реестр с сохранением проверки настоящих описок и истории.

Общий локальный гейт интеграции2c9a6cd4: четыре TypeScript-пакета PASS,
shared719/core1839(+1skip)/server951/web2212 PASS; full Ruff по engine,
backup/runtimeguard и затронутым CI-тестам PASS. Это source-проверка,
не новый production rollout. Свежий actual API остаётся отдельным readback.

586a6fe4: статический deployment fixture синхронизирован с безопасным
закрытием fd9, exact-SHA/order проверка не ослаблена; полныйPython1052 PASS.
Exact CI38197036151 SUCCESS, DB38197036166 SUCCESS. Отдельный read-only
rehearsal38197036147 BLOCKED/PUBLICATION_READER_LEASE_UNINITIALIZED,
не обойдён. Browser job этого CI — диагностический installed-schema probe;
кандидатный historical schema probe38188258290 сохраняет применимость:
schemas.ts/department-registry/api consumer побайтово не менялись послеe7b.
Полная браузерная и смысловая приёмка Word остаётся отдельным гейтом.

C02/K05: новое уточнение владельца — логический адрес «№п/п + книга».
Внутри используется постоянный file ID; имя — изменяемый display alias.
Год, квартал и месяц — производные плановой даты N, не постоянная
идентичность. Год исторического среза/исходный лист остаются контекстом
провенанса; физическая строка может сдвигаться. «173», «173/1» и «173/18» сохраняются отдельными строковыми
номерами. Коллизии и перенумерация требуют доказанного контекста/lineage,
не автоматического слияния. Шесть текущих физических адресов из сверки выше
не объявлены доказанным совпадением с закупками старого скриншота.

Native GET03:18UTC на e7ab5068/CI38199188606 (job114648543284):
все шесть текущих адресов УКСиМП уникально сопоставлены с A в полной книге,
без сужения года. Q заполнена, futureFactDate=false; AD не определено;
economyFlagUndetermined/highEconomy/epFactDeviation=false на каждой строке.
Это наблюдение установленных API-правил, не атомарный снимок и не доказанная
идентичность закупок старого скриншота. Snapshot/checklist пока UNAVAILABLE
из-за ограниченного чтения старого большого DTO; sourceReadAt не выдуман.
GET не запускал refresh/генерацию/остановку/запись. У release-актора UID1000,
sudo-n доступен; существующий приватный backup-раздел свободен на
12 113 375 232B, capacity Docker-volume требует отдельного read-only proof.

C02/K05: воспроизведён разрыв identity при переносе планового года.
Узкий matcher1f265e0 проверяет полный прежний entity-hash с прежним годом,
точный file ID/строковый номер и уникальность номера в обоих состояниях.
При доказанной неизменности остальных полей сохраняет UID; старые хеши,
снимки и рекомендации не переписывает. 257 author +116 independent checks PASS.
Дубли, повторное использование номера, очищенные строки и неполное legacy
доказательство не дают автоматического объединения. Дыра в нумерации сама
по себе не доказывает удаление: требуется последнее достоверное состояние.
Отдельный N/O/P mismatch reader воспроизведён, но default historical adapter
не изменён: прежде требуется совместимость frozen replay/ledger/Dash/Word.

C06/K02: forward-reminder39719b6 требует будущую Q, явный положительный Y,
неопределённый AD и известный немонопольный способ. Пустой/нулевой Y не
подменяется V/W/X. Это информационная подготовка ГРБС/УФ, без признанной
экономии/свободных средств/штрафа. Временной guard общий для highEconomy и
epFactDeviation. Author shared728/core1856(+1skip)/server951 PASS;
четыре web load-timeout на конкурентном прогоне, те же файлы8/8 standalone
PASS без изменения таймаутов. Независимый strict review PASS; полный
последовательный web-гейт объединённого дерева ещё обязателен. UI companion
исправляет замечания независимого review по закрытым решениям/области фильтра.

Продолжение этого же кандидата: UI0466b53c после RED4→GREEN12 исключает
resolved/false_positive/wont_fix из активных поручений, явно показывает
ограничения отбора и сохраняет дробный номер в переходе к реестру.
Independent UI review PASS. Новый guard1dbc748b получает контекст года из N:
N2027/P2026 сохраняет предупреждение, N2026/P2027 допускает info только при
доказанном curated-контексте; неизвестная N не снижает серьёзность.
Independent shared17/core26/serverDTO22/web41/private4 PASS; старые
isAnnualEpAggregate/фильтры/frozen-парсер этим не переключены.

Повторная сверка того же неатомарного восьмикнижного capture02:26UTC:
4093 data rows =599 без обеих дат +196 с N без Q +3298 с обеими датами.
У3494 валидных N все O/P совпадают с вычисленным кварталом/годом;
невалидных дат и N/O/P mismatch не обнаружено. 599 — реально отсутствующие
даты; по уточнению владельца отсутствие N означает отсутствие обеспеченного
финансирования, но не само по себе ошибку сотрудника или повод удалить строку.
Weekly/live-diff уже используют точный A внутри книги, без года:
перенос календаря и физической строки не создаёт исчезновение/новую закупку.
Сохранение permanent file ID в Dash table-reading provenance остаётся
отдельным пробелом для source override; прежним снимкам его не дописываем.

Release admission остаётся отдельным: локального полного scratch22GB+
сжатого checkpoint при наблюдаемых12.1GB недостаточно; текущий preflight
должен отказать до API stop. Temporary runner full-restore уже доказан
историческим backup workflow, но не встроен в свежий same-owner release.
README/ADR001 теперь явно отделяют этот следующий шаг от существующего
reports-only restore; полный in-place state rollback ещё не доказан.
Прежний образ на candidate-modified scratch требует smoke, compaction
в этом rollback-окне не финализируется. Работающий R08 не откатывается.

Объединённый source-гейт этой итерации (baseline e7ab5068 + reviewed
identity1f265e0/economy39719b6/N-guard1dbc748/UI0466b53/probe1756964):
четыре types PASS; последовательный полный shared734/core1859(+1skip)/
server954/web2225 —5772 PASS,1skip, без изменения таймаутов. Полный Ruff PASS;
TS lint0errors/303existing warnings до N-followup, его exact targeted lint
0errors/2existing warnings. Root identity+section-audit99 и исправленный
unused-test-assignment59 PASS; mocked probe10response+2host scenarios PASS.
Identity root commit2cb25dbb сохраняет reviewed production diff; root
убрал только неиспользованную тестовую переменную. Normal hooks не обходятся.
Следующие exact-head CI/actual native readback будут относиться к итоговому SHA;
5772 source PASS не объявляется production/UI-fidelity/rollback acceptance.


### C07 — изолированный кандидат хранения снимков, следующая итерация

Статус код готов: независимый кандидат от30cfd691 интегрирован в10b77aac;
production не менялся. По последней инструкции
владельца отдельный ежедневный пул исключён: недельная история выбирается внутри
доказанной области (центральная книга + явный расчётный год/null), а самая свежая
голова каждой области сохраняется независимо от полноты старого контроля.
Legacy/missing/невалидные области и даты сохраняются консервативно. Старые корни
решений, их сырые версии и metadata/provenance не переписываются.

Связанный воспроизведённый дефект fallback: глобальный LIMIT 5 скрывал голову
нужного года или подставлял другую книгу. SQL теперь отбирает доказанную область
до bounded LIMIT; неизвестный all-year не угадывается. Реальный getSnapshot при
отказе Google покрыт проверкой после retention восьми разных heads.

Проверено локально: 72 targeted server tests PASS, полный server gate
132 файла/994 теста PASS, server typecheck PASS, общий TS lint без ошибок
(существующие warnings сохранены). Независимое повторное ревью PASS; интеграция и live-приёмка
остаются открытыми. Полная live+diff архитектура этим блоком не реализуется. Backfill
без metadata.targetYear сохраняется до доказанной миграции; ID центральной книги
не выдаётся за fingerprint всех девяти источников.

Обнаруженная независимым ревью регрессия читателей исправлена в этом кандидате:
сохранённые неизвестные попытки больше не расходуют сырые лимиты 50/52/500.
SQLite cursor обрабатывает метаданные последовательно; raw donor читается по
одному JSON до пригодного результата. Integrity использует прежнюю строгую
проверку до первого пригодного календарного контроля и сохраняет число
отклонённых попыток. Lineage ограничивает выбранные контрольные дни размером
запроса: внутри дня предпочитает последний проверенный срез, а при отсутствии
пригодного сохраняет разрыв. Отвергнутые новые попытки объясняются в notes,
фактические ID/даты выбранных срезов не подменяются. Cron также не считает
неполную попытку завершённым контролем. Публичный metadata history API сохранён.

Проверка контрольных доказательств перенесена без изменения семи тел функций
в services/weekly-control-validation.ts; прежние route exports сохранены.
До/после переноса 18 characterization tests PASS. Новые real-SQLite стражи
покрывают 50 пустых raw-кандидатов, 500 неполных weekly-попыток, проверенный
срез того же дня и cron; все legacy-строки остаются на месте. Полный gate:
132 server-файла/994 теста PASS, server typecheck и общий lint PASS.
Независимое повторное ревью PASS (64 теста); интеграционная/live-приёмка
ещё открыта. Холодный импорт тяжёлой fixture перенесён в beforeEach без
увеличения таймаутов; повторный exact full server gate: 132 файла/994 PASS.
