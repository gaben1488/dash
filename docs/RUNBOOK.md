# Runbook

Основная историческая редакция: 05.06.2026. Релизные ограничения актуализированы 12.10.2026 (Asia/Kamchatka). Текущее состояние кандидата и допуски — issue #69 / PR #79; этот документ не подтверждает готовность production.

## Local Development

```bash
corepack pnpm --version # packageManager:10.33.0
corepack pnpm install --frozen-lockfile
cp .env.example .env
corepack pnpm dev
```

Менеджер берётся из `packageManager`, а не из случайного глобального PATH.
Для команд ниже при несовпадении глобальной версии используйте `corepack pnpm`.
В защищённом режиме API незаданная/неизвестная `NODE_ENV` требует непустого `AEMR_API_KEY`; без ключа
разрешены только явно названные `development` и `test` (guard в кандидате,
статус установки проверяется отдельно по #69/#93).

Expected endpoints:

- Web: http://localhost:5173
- API health: http://localhost:3000/api/health

## Verification

Runtime18.10.2026 — `ed3e4589`,
[release39091352612](https://github.com/gaben1488/dash/actions/runs/39091352612)
SUCCESS03:24:37UTC, controller ACCEPTED/API/3Word/health/resume PASS.
Keeper `worker-39091352612/backup`:21 357 882 917logicalB/3767entries,
archive3 228 754 890B; manifest4eb324382ee31ec7…/trialff524a8fb42a25fe…;
оба actual restores111SQLite/266DOCX. Полные хэши/images — текущий PLAN.
Desktop39093548595 и WebKitGTK39093550073 full13/Header/Undo/journal3/3Word
PASS. Это не физический iPhone/Safari и не все права/правки. Observer39093234709
ещё IN_PROGRESS: установка не равна полной приёмке.
Metadata39093724973:4running/OOMfalse/restarts0; API03:23:30,
worker03:24:14UTC, свободно5 603 995 648B в этом чтении. Контейнеры и
штатный900sпослеfinish таймер сохранять до terminal observer proof.
Early observer390919 истёк до активации; history follow-upFAIL в maintenance
не переносится на историю принятого приложения. Не запускать новый generation
в ответ на настоящий отказ цикла без разбора его evidence.

OPS c91b57b0 повторно использует проверенные exact-source образы; нет новой
сборки, съедающей подготовленный capacity floor. Reference-aware cleanup
удалил только два доказанных unreferenced failed-build images; free delta
+1 464 008 704B измерен, данные/volumes/rollback images не удалялись.
43actual-root checks PASS; весь legacy OPS suite зелёным не объявляется.
Не переносить целиком OPS ci.yml в приложение: downstream release/recovery
выполнялись из exacted3, операторская ветка отдельно. Прежний checkpoint
и historical source proofs не подменять доказательствами нового выпуска.
Кандидат3a249ede (master/scorer) пока отдельно, не установлен.

История78d (следующая запись не является текущим runtime):

Runtime17.10.2026 — `78d293b2`, release39029386193 SUCCESS12:17UTC.
Keeper worker-39029386193/backup:21 063 718 219logicalB/3621entries,
archive3 185 621 581B; manifestd3d8284f…/triald35ff48d…; оба restore
110SQLite/263DOCX, native API/3Word/health/resume PASS. Точные хэши, образы,
версионные границы и native parity — текущий раздел PLAN/#93.
Observer39031123999 SUCCESS:71ba141d и76011432 VERIFIED_WITH_WARNINGS,
double host FLOCK/интервал≥900сек/native context/snapshot/3Word после каждого.
1638sealed неизменны, schema history9v2/1absent/0invalid PASS. Metadata39034110032
подтвердил атрибуции и неизменные StartedAt. Не повторять принятую worker проверку
без смены её зависимостей. Первый retained INLINE8914636B, второй REFERENCE4083B
с roundtrip; global4459296B совместим. Не объявлять все payload дедуплицированными.
Desktop39033965684 полный сценарий PASS; предыдущий39033073610 отказал на
Word readiness и остаётся свидетельством нестабильности. iPhoneGTK39033074571
отказал на перекрытом нажатии Word после13страниц/фильтров/Undo. Native
selectedGET200 за2,595–3,718с не закрывает этот отказ. Полная приёмка не заявлена.
Последующий полный iPhoneGTK39034507227 PASS13:05:21UTC:13страниц/Header/
периоды/Undo/3journal/3Word с native hashes. Ранний отказ сохранён; ни physical
iPhone/Safari, ни все права/записи/сложные таблицы этим не приняты. Browser
responseStart23263,4ms/bodyEnd24115,7ms, native3,126–3,681с при worker — разные
условия; предзаголовочная задержка остаётся открытой диагностикой C05.11.
Новые Header35363516 и comment parser18b2ef3d проверены локально и в exact
CI39036210982 наbb207046 (оба browser engine/types/tests/build/audit SUCCESS
13:35:50UTC), не установлены. [Рабочий реестр](PLAN.md#improvement-register)
сохраняет конечный состав ближайшей поставки R09.01 и отдельную программу миграции.
Не подменять установленную78d новым исходным HEAD при чтении старых receipts.

История8d (следующая запись не является текущим состоянием):

Текущий runtime17.10.2026 — `8d552262`; release39023590292 SUCCESS,
но fullacceptance FAIL: APIguardrestart10:48:30, desktopWordstatus502,
iPhone dashboard502, observer39024988744 REJECTED/historyFAIL.
Keeper worker-39023590292/backup:21 063 685 503B/3613files,
archive3 185 654 302B; manifest7efb5460…; trialcb06c456…;
два restore110SQLite/263DOCX/API3Word/resume PASS. Подробные полные хэши,
images и границы — PLAN/#93. Нельзя повторять приёмку неизменного кода:
сначала устранить оставшееся синхронное чтение исторических JSON в GET.
Nativeprofile39027655565:6поисков/12671ms на копии0.5CPU; новый predicate
для известныхpipeline producers пока не установлен и требует equivalence proof.
Сохранённые legacyдела без producer, перемещения строк и конфликтующие версии
не должны теряться ради ускорения. Текущий backup не заменяет постоянную
резервную копию вне зоны отказаVPS.

Исторические результаты283 (не приёмка8d):

Установленная ранее версия17.10.2026 — `283a2b0e`; её полная приёмка отказала.
Release38993968988 SUCCESS02:40UTC; keeper worker-38993968988/backup:
21 019 313 886B/3559entries, архив3 181 544 574B;
manifest28114ce0811fd863ff4822b693d5fd029f65a812b19dbc636759fe5508864f36,
trial701c508058fa3e216ef87529d8a2c0670242abaa12fcaacdc6dbf553708de1a2.
Два restore по110SQLite/263DOCX/API/3Word/health/resume PASS.
Metadata39019779832 подтверждает API/worker image
e214a60112f3e527d1cbb05caf6b08ccec37371ffd9b55c26579ca0b7b0e22ae,
web87876b6cdf0ec2094449006122d4bbce0d5d37d784adef583ed8c8d4ae4d257f.
Desktop39019229256:13/Header/Undo/journal PASS, Word2timeout. iPhoneGTK39019272796:
dashboard/journal502; observer39019013301 IO_FAILED/historyFAIL.
Guard подтвердил restart API08:58:57, worker не перезапущен; API healthy09:05.
Не повторять deploy/restore и тяжёлые browser gates до разбора причины.
Read-only incident39019902807 и query39020098574, следующий ограниченный
metadata-index fix/доказательства — PLAN/ADR0012. Приёмка прежних циклов ниже
не переносится на283. Старый d402 архив retired по подтверждённому receipt;
история/attempt payload не удалялись. Все реальные stop/restore/rollout остаются
под одним maintenance flock и существующим контроллером выпуска.

История d402,17.10.2026,00:42UTC:
Release38982892729 SUCCESS; keeper `worker-38982892729/backup`:
21 019 285 305B/3545entries, архив3 181 287 126B,
manifest a41e37740b9afbe3dea8458cf3bb61c3383a75aaca149090a7caa70185b773bd,
trial995bde944ba8e9cee468dc55bc71e4b79a417549d72cef0b8d029183ebb6cac0.
Два restore по110SQLite/263DOCX; API/3Word/health/resume PASS00:19UTC.
Observer38984598658 SUCCESS: eb539acd/3f5e35d6, doubleFLOCK/≥900сек/native5
после каждого/два reference proof/1638sealed. Metadata38987627897 PASS.
Desktop38985868522 PASS, включая четыре значения operations из того же GET.
WebKit mobile пока не принят; исходный FAIL и локальный Undo-fix в PLAN.
API/worker image084554aaf05ab541bb95cc9ff756246d9ba4c454061945e419dcbe39c2a658e6;
webc43753ecb016803d3457f1b67d31410f7da1ca9b2e403ddebc01f8cee2168683.
Прежний b96 backup archive штатно retired после двух новых restore; manifest
и receipt сохранены. Это не удаление report history или attempt payload.

История b96,16.10.2026,23:40UTC:
Release38975748581 SUCCESS: checkpoint21 019 256 685B/3537entries,
archive3 181 420 526B; manifest09d9c5b717439f06ff971d742e7a7563fb8a5764869c1edc6d72f4f2bedd1ba5,
trial a1e7434292ef3acec36c77c92a6359a7fdebfb9255bb2bea5da9204e593f5267.
Keeper `/home/aemr/.dash-private-backups/worker-38975748581/backup`.
Два restore: каждый110SQLite/263DOCX; API/3Word22:59:12, health22:59:13,
resume/cleanup PASS. Browser38978982855/38978992935 PASS:13разделов/Header/3journal/3Word,
0page errors/blocked, одинаковые native DOCX hashes. Эмуляция не physicalSafari.
Worker observer38978975046 SUCCESS: `ebb2f94f` и `e6bb0c4b`, двойная host FLOCK,
интервал924,260619с, native context/snapshot/3Word после каждого PASS;
оба retained-proof roundtrip PASS,1638 sealed неизменны. История8v2/1absent/0invalid.
Ранний `26376dc9` начался до observation_since и не засчитан.
Metadata38982529550 подтвердил source/checkpoint/атрибуции, все4running,
APIhealthy/OOM=false/restarts0. Новые retained status по4083B/4096allocatedB;
старые payload не удалялись, full global status сохранён. Полный cold benchmark,
историческое переиздание#REF!, весь journal/KPI/mobile UX этим не принимаются.
API/worker image9e833a1cd435c21defc4bfda1ab91913b364585357711db215faaae89fbd1667;
web69f5e128aef4fb48f9a466054df2b9196db5c36c11ef3dc9d0133e2158d0e8d8.

История предыдущего полностью принятого Bae на21:30UTC:
[Release38961726925](https://github.com/gaben1488/dash/actions/runs/38961726925)
завершён: checkpoint 20 996 960 205 B / 3527 файлов, архив 3 179 828 006 B;
два независимых полных restore по 110 SQLite / 263 DOCX. Exact-SHA API и три
Word прошли в 21:04:22 UTC, health/resume — PASS. Keeper:
`/home/aemr/.dash-private-backups/worker-38961726925/backup`; manifest
`ed9379b46a0803375b6bfbd2ad19fc4f4c669a089cc5fdfafe2559b613d3597d`, proof
`3759edfa245cfe04436620ffa613ab3ef8622f60410c616c59889896ef2316fe`.
API/worker image `694f6553c4d8135a9b5344eb98982f2844173b9e75b04f4a5d8a701c47bcc580`;
web image `33bfe861d66a821b145de985a0af44ff01b37bc978db9d2caddfe2cf560b9c98`.
Observer38961801554 SUCCESS: 189502ea (21:05:08–21:08:59 UTC) и60fa2873
(21:24:28–21:27:24 UTC), оба VERIFIED_WITH_WARNINGS, double host FLOCK,
интервал 929,218 с; context/snapshot/три Word после каждого PASS.
Sealed1638 неизменны, history8v2/1absent/0invalid, current selected200/PASS.
Metadata38969648844 независимо подтвердила исходник/образы/две атрибуции;
all4 running/API healthy/restarts0/State.OOMKilled=false; free13640134656B
в21:28:58 UTC. Повтор приёмки Bae не требуется; новый runtime принимает
собственный набор сценариев, старые циклы ему автоматически не засчитываются.

Desktop38967077524 / WebKit38967333129 проверили 13 разделов, Header,
журнал и три Word; это не весь UX и не физический Safari. Provenance38966956109
проверил восемь книг и пять исходных свидетелей в выборке; весь журнал не принят.
Native status38968602253: 1,518 с, same-release / одна проверка файлов;
HTTP38968752151: 1,690 / 1,641 с на том же 17.10.2026 / 2026 / Q4.
Не объявлять эти прогретые результаты исправлением browser21,262 с или cold-read.

Стадии выпуска: capture 20:30:12–20:36:29 UTC, независимые restore
20:36:29–21:01:38, установка/приёмка 21:01:38–21:04:24. Примерно 34 минуты
capture→health не равны измеренному API downtime: точный момент stop отдельно
не измерялся. Новые phase timers оснастки относятся только к будущим прогонам,
не измеряют transfer и не ослабляют restore/source/rollback gate.

Текущий b96e169d (4f630e74/0d155e1d/32e9ad6e) установлен;
release38975748581 подтвердил два restore нового21 019 256 685B checkpoint,
manifest09d9c5b717439f06ff971d742e7a7563fb8a5764869c1edc6d72f4f2bedd1ba5.
Старый accepted Bae trial3759 не относится к этому checkpoint.
Установленный код сохраняет новые
historical reused-attempt status с hash-ссылкой на опубликованное assurance;
global status остаётся полным для старого API/оператора. Для полного исторического
доказательства используется `PublicationStore.read_attempt` под обычной reader
lease, а не HTTP alias выбранного выпуска. Missing/corrupt reference — явный
отказ; SQLite unavailable остаётся отдельной ошибкой. Старые файлы не преобразуются.
Первый inline-отказ читается и до каталога/fence, без bootstrap или создания БД;
существующий каталог либо fence, включая dangling paths, требует reader lease.
Metadata-only retention/health/weekly recovery не должны гидрировать весь payload.
После следующей установки нужно отдельно подтвердить eligible repeated-attempt
на настоящем runtime и совместимое чтение прежним reader. Два принятых цикла
Bae не заменяют эту проверку. GET cancellation относится только к native чтению;
POST archive/refresh продолжают принятую операцию после ухода клиента.

История предыдущей установленной версии:
На16.10.2026,19:54UTC установленbfd625fc: release38949403808 SUCCESS,
checkpoint20979114829B/3519entries, archive3178137569B; два независимых полных
restore110SQLite/263DOCX, API/3Word19:25:51UTC/publichealth/resume PASS.
Keeper:/home/aemr/.dash-private-backups/worker-38949403808/backup;
manifest66b2ec2b0b81ebf0410d45d518dc88eba437977309d1b6661dff78048acd5983;
trialproofdca0632fff74f5eb275338c6bb5acb516482eb48d696f67a7545fcc660e7c756.
Observer38949805075 SUCCESS:647e16e4(start19:26:50Z)/6657e1cc(start19:46:28Z),
doublehostFLOCK/interval≥900с; context/snapshot/3Word после каждого PASS,
sealed1638unchanged. History8v2/1absent/0invalid/currentselected200PASS.
Metadata38958075523 подтвердила sourcebfd, оба receipts/attribution иcheckpoint;
all4running/APIhealthy/restarts0/State.OOMKilledfalse, free15149236224B19:52UTC.
API/worker image d2f366681cceb21233202cf45165c1fc2049fc2c4d4b1ba62b3e996fd8d7ae14;
web328a705690451e82804adbd13b82164c564c304968c6e05a7201edf727c35e5a.
CI38948625747 attempt2 SUCCESS: только oldfailedlivejob повторён после установки.
Desktop full38956025769 иMobile38955093647 PASS13страниц/Header/3journal/3Word;
раннийdesktop38955068166 FAILWordCHECKING30с сохранён. Instrumented selectedGET
19587ms — открытая стоимость, nextreaderfix ещё не установлен. Первый journal
изstartup-лога4.617с, внешние повторные2.714/3.285с; это не host-cold benchmark.

История предыдущего выпуска (его checkpoint не подставлять вместо текущего):
Предыдущий принятый выпуск `19289667` (PR #79): release38927016449 SUCCESS,
независимые restore с кандидатом/прежним runtime, exact-SHA API/три Word и public
health16:25:58UTC PASS. Observer38930502207 SUCCESS16:49:26UTC: два новых
36d28700/d396cb45, RUNNING/double host FLOCK, interval≥900s, context/snapshot/
три Word после каждого. Sealed1638 entries unchanged; checked history8v2/
1absent/0invalid, current selected200/PASS. Metadata38935012162 подтверждает
source192, попытки и образыa848c114 API/worker/9feff3f7web, все4running/noOOM/noRestart.
Checkpoint20943366733B/3503entries, archive3176285073B; оба restore110SQLite/263DOCX.
Keeper /home/aemr/.dash-private-backups/worker-38927016449/backup;
manifest11706825c56574fef8d1e3af36f74a3d935dd8df66f582fe0ff6ccbd7276c4c2.
Free16714596352B/MemAvailable2588721152B измерены16:50UTC.
B13 source CI38945039207: engine1127tests/image/live API PASS, verify FAIL
на первой QA-кнопке WebKit5с; приложение192 не пересоздавалось.
Парный CI38946188061/job117125775449 на том же b13: GTK9PASS/WPE FAIL/
WPE9PASS/GTK9PASS. Полный fixture теперь WebKit GTK под Xvfb, с прежними
эффектами/реальными click/tap/assertions/5с. Chromium и auth isolation остаются
headless. Это замена нестабильного renderer оснастки, не исправление продукта
и не доказательство физического iPhone или cold latency. Exact-head CI нужен.
Bounded native38941504634 SUCCESS: current build/audit/twoDOCX/projection PASS;
weekly ready=true, historical_replay_verified=false: неизменный старый #REF!
не исправлен. 1.5GiB RAM/1.75GiB total/1CPU/128PIDs хватило этому входу.
B13 native38945039201 SUCCESS18:37:50, worker explicitNOT_RUN. Bfd tree/workflow
идентичны; повтор38948625759 отменён до frozen, не PASS. Не переносить component proof на
новые входы/правила без точной привязки; итог weekly не содержит input digests.
Frozen633 single worker poll FAIL оказался чтением RUNNING ff0236ce,
завершившегося успешно17:49:05UTC (readback38944127527). Replay больше не
заявляет worker acceptance: NOT_RUN. Running-process availability guard и
отрицательные тесты сохранены; два attributed autonomous cycles/native Word
нужны после каждого нового установленного кандидата.
Native weekly index38935736313: тот же selector1096.623→0.312ms, build1127.75ms,
production index не создан. Native installed validation38938184833 отдельно:
selector14383.390ms wall/2177ms CPU на0.5CPU;23MB baseline validation4–5s.
Разные условия wall timing не превращать в общий cold HTTP benchmark.
Census38939051025: после cancelled CI остался unbounded read-only replay.
Remote3e0/2783/a7: exact run+attempt+job labels, caps/internal timeout, cleanup,
serial schema→replay, newheads queue. Bounded native38941504634 schema/diagnostics
PASS; frozen SUCCESS в указанной выше области. При отмене CI не считать Docker
автоматически завершённым. Cleanup только собственных labelled disposable;
старые unlabelled процессы нельзя выбирать по одному image ID.
Read-only диагностика сохраняет15с gate и печатает fixed stage/reason/elapsed,
без сообщений исключений/payload. Работающий192 не пересоздавался.

Cold latency и вся продуктовая программа не закрыты этими результатами.
iPhone/WebKit38932318516 PASS13touch-разделов/все периоды/reset/Undo/журнал/3Word;
это эмуляция. Desktop38933155485 PASS16:37:55UTC на тех же сценариях.
Первый desktop38932107962 FAIL сохранён. Compiled Header RED в desktop/touch:
pressed64 совпали, асинхронные aria-label availability пояснения отличались.
Оснастка теперь сравнивает все выделения + active year/week context; не требует
неизменных availability labels. Inert/month-change/week-change negatives PASS;
local Chromium8/Ruff PASS. Приёмка всех прав/сохранения решений остаётся открыта.
Ordinary dashboard38932040065:5.652/4.473s, refreshing/captured15:26:42Z;
journal38932221489:3.347/2.027s. Cold latency и общая свежесть ещё не приняты.
CI38923925347 attempt2 SUCCESS после повторения только failed live job на
установленном192:425metric nodes/0contradictions, Header endpoints и browser
schema PASS. Attempt1 FAIL старого83 сохранён отдельно. Frozen38923925267 SUCCESS.
Последующий ordinary38933996505 подтвердил advancement captured_at до16:37:42Z,
4.833/4.139s. Не выдавать это за cold latency proof.
Старый дополнительный Python shape diagnostic обрезал9171500B JSON на2MiB;
удалён только этот не блокирующий duplicate. Полный candidate schema guard и
oversize/malformed negatives сохранены; JSON лимит не увеличен.
Недельный результат — доказанный неизменный отказ #REF! обоих генераторов,
не успешная публикация исторической недели. Старый FAIL38914725365 сохранён.
До downtime index-copy38924567639 PASS:434049024B consistent SQLite copy,
index1952ms, exact scopes/results; production index не создавался этим probe.
Journal-only38926925837:15.022s cold/2.116s repeat, HTTP200/hash equality;
dashboard read-model correction не считается доказательством быстрого журнала.
[Выпуск 38905551150](https://github.com/gaben1488/dash/actions/runs/38905551150)
прошёл свежий checkpoint и два независимых restore: 111 SQLite и 266 DOCX
в каждом; API/worker `sha256:9aa3c5eb…`, web `sha256:18efa368…`.
[Наблюдение 38906488066](https://github.com/gaben1488/dash/actions/runs/38906488066)
подтвердило два самостоятельных цикла, host FLOCK, API/три Word после каждого,
неизменность 1638 sealed entries и совместимость исторических форматов.
Циклы UTC: 13:43:56–13:47:35 и 14:03:04–14:06:20, оба VERIFIED_WITH_WARNINGS;
интервал после первого finish — 929,661 секунды. Это два запуска, не обещание
двух новых выпусков при одинаковых входах.

[Desktop 38910751084](https://github.com/gaben1488/dash/actions/runs/38910751084)
и [iPhone/WebKit 38911238949](https://github.com/gaben1488/dash/actions/runs/38911238949)
прошли 13 разделов, журнал и три Word. Эмулированный iPhone/WebKit использует touch, проверяет
единицы/способ/деятельность/бюджет/тему/поиск и popover. Сохранение решений,
права, все периоды, Undo и сложные таблицы этим не приняты. Настоящий iPhone/Safari
на физическом устройстве этим не проверен.
Cold dashboard по журналу запуска — 18,798 с; обычные GET — 3,834/3,561 с.

Последующая расширенная WebKit-проверка38914580133 отказала на чтении dashboard
до календарных действий; live consumer38914725430 также получил timeout.
Принятые сценарии выше не доказывают стабильную задержку каждого GET.
Причина ожидания импорта воспроизведена; ADR0012/read model fix ещё не установлен.
Frozen rehearsal38914725365 прошёл current replay, но weekly replay обоих
engine отказал UPSTREAM_IMPORT_FRESHNESS_NOT_PROVEN. Не повторять сборки без
диагноза зависимости и не объявлять историческую совместимость полностью закрытой.

Storage: pre-readback38903432153, finalize38904202760, независимый
post-readback38905123990 PASS. Все 99 выпусков/249 Word/99 dashboard сохранены,
92 уплотнены, 7 защищены. Освобождено 12 001 247 232 B физических блоков.
Свежий backup: 21 244 275 001 B, архив 3 222 981 097 B, manifest
`9ef7ce604aebc3eb4c5259ff8abb1372e51653245543b55acbe1b5c7892b4bcd`.
Keeper `worker-38905551150/backup` сохранён. Недельная автоматическая политика
уплотнения публикаций ещё не включена. Старые 43-pins ops-инструментов не дают
допуска на мутацию установленного 83. Операции только под прежним maintenance
flock; фактически принятые проверки 83 без новой причины не повторять.


Run before handoff or deployment:

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
