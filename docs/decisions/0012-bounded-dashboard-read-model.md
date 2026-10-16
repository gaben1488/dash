# 0012 — Чтение дашборда не ждёт импорта источников

Статус: реализовано и установлено поэтапно: background read model в192,
weekly metadata index вBfd, условное переиспользование проверки payload вBae.
Это не приёмка cold latency или общего входа TS/Python; версии и доказательства — PLAN.

## Причина

На установленном83 первый GET после старта прошёл за18,8с, но расширенная
WebKit-проверка38914580133 и live consumer38914725430 отказали на чтении API.
`getSnapshot(false)` после invalidation ждёт `createSnapshot`: Google,
пересчёт, сохранение и retention. Просмотр зависит от всей цепочки импорта.
Это отдельный дефект; принятые два цикла/Word/restore83 остаются доказанными.

## Решение

Обычное чтение использует последний пригодный материализованный снимок строго
того же года/общего периметра. Просроченный срез возвращается немедленно с
исходным `createdAt` и явным HTTP-only `metadata.readModel.state`:
`refreshing` или `stale`. Общий request-scoped HTTP marker передаёт состояние
и исходное время также проекциям `/metrics`, аналитике и остальным потребителям
`getSnapshot`, которые не возвращают metadata в теле. Он не разбирает payload
повторно и не переносит состояние между запросами. Background task выполняется
вне контекста HTTP-чтения. Обновление идёт одним общим background promise на
периметр; явная команда обновления продолжает ждать результата.

Поиск холодного/отсутствующего года использует expression index существующих
`spreadsheet_id`, guarded JSON type/value `metadata.targetYear`, `created_at`.
Индекс хранит только метаданные и row pointers; payload/хэши/формат записи не
меняются. `CASE json_valid` допускает старые некорректные payload, не выдавая их
за нужный период. Без индекса EXPLAIN показывает scan истории и JSON parse
в пути GET; cursor сам по себе эту стоимость не устраняет. Индекс совместим
со старым приложением, строится один раз при миграции после checkpoint;
стоимость на копии рабочей БД должна быть измерена до остановки API.

У журнала есть отдельный metadata selector: `iterateWeeklySnapshotHistory`
ищет кандидатов по `instr(data, '"weeklyTableContext"') > 0`. Это не проверка
пригодности недели; полная проверка JSON/контекста/атомов выполняется позже.
Частичный индекс `(created_at DESC, id DESC)` с тем же predicate сохраняет
состав и порядок кандидатов, убирая повторное сканирование тяжёлых payload.
Он не меняет этот predicate, не исключает повреждённого кандидата заранее
и не заменяет `verifiedBaselineRows`. Создание и физическая стоимость должны
быть проверены на согласованной рабочей копии перед следующей установкой.
Это дополнение не входит в уже запущенный кандидат19289667 и не доказывает
устранение времени Google-чтения холодного журнала.

Invalidation помечает срез просроченным, а не уничтожает последнюю пригодную
модель. При отсутствии совместимого среза —503 с подготовкой модели в фоне,
без чужого года, демо, нулей и притворной полноты. Исторический JSON, подписи,
исходные ревизии и publication gate не переписываются. Входы/правила/формулы
не меняются. Неподтверждённая свежесть видна в интерфейсе; событие обновления
не подтверждается, пока чтение отдаёт прежний срез.

## Границы и проверка

Это переход существующего модульного монолита к чтению готовой модели,
не новая БД/брокер и не полная миграция канонического входа. Публичный период
остается вычисляемым по плановым датам. Force/materialization и безопасное
возвращение последнего снимка при отказе источника сохраняются отдельно.

Регрессия: задержанный источник не задерживает пригодный read model;
concurrent reads запускают один пересчёт; invalidation сохраняет данные;
чужой год не возвращается; stale не помечается новым временем; исходный
снимок в SQLite не меняется; UI не гасит ещё не применённое обновление.
Локальные полные наборы: shared737/core1869(+1skip)/server1012/web2301;
lint/tsc/build PASS. Независимый review подтвердил memoization/ALS и выявил
SSE race; delayed-response regression RED→GREEN. Затем API/WebKit на точном
установленном кандидате; локальные доказательства не означают установку.

## 16.10.2026 — isolate rehearsal work from the online service

Native census38939051025 found three concurrent same-image read-only diagnostic
containers without memory/CPU/PID limits. One rehearsal started17:17:31UTC and
was still running17:21UTC after its workflow38937993041 had been cancelled.
This proves missing operation bounds, not that it alone caused every API timeout.

The existing source-schema and frozen-replay workflow gains per-container
1536MiB RAM/1792MiB total memory+swap,1CPU/128PIDs; its existing smaller512MiB
probe retains that limit. Source-schema and frozen replay run sequentially in
one workflow. New heads queue behind active native work rather than cancelling
its SSH session. Only the latest pending candidate is needed. This leaves the service's own limits unchanged. Full execution
must demonstrate whether the chosen rehearsal budget is sufficient; OOM or a
budget refusal remains FAIL, never a reason to weaken the data check.

Each run labels only its disposable containers with numeric workflow-run,
execution attempt and fixed job role. A rerun cannot inherit the old attempt
cleanup scope. Its EXIT/HUP/INT/TERM cleanup removes only those exact labelled
containers. Python entrypoints also run under timeout1200s with5s termination,
inside the container, so losing SSH cannot leave unbounded replay work. The
existing26minute SSH/28minute job deadlines are not raised. Production data stays
read-only; anonymous scratch is discarded with its container. This closes a
resource-ownership defect in the existing operator, not a second orchestration
system or a change to publication/source validity.

### Candidate replay is not installed-worker acceptance

Frozen633 replay38938876490 completed its build, independent audit and qualified
historical refusal, then failed on one read of the installed worker's global
status. The nearby readback38942301087 was RUNNING, not a terminal failure.
`check_worker_cycle(..., attempts=1)` rejects RUNNING by contract. Replaying the
whole candidate until this unrelated observation lands between cycles cannot
prove candidate automation. The frozen job therefore stops claiming scheduled
cycle acceptance. Its output explicitly says NOT_RUN and requires two cycles
of the exact deployed candidate. The separate read-only worker diagnostics and
post-deployment attributed two-cycle/native-Word observer remain in place.
Historical acceptance stays bound to its installed source/image; RUNNING is
neither a new acceptance nor a terminal worker failure. Real failed attempts
remain visible in diagnostics and stop the dedicated acceptance observer.


### Reference browser renderer for the full glass fixture

The paired Ubuntu CI38946188061/job117125775449 used immutable b13cd9e5 and
GTK→WPE→WPE→GTK ordering:9PASS179.687s,FAIL45.217s,9PASS56.929s,9PASS169.174s.
The WPE failure was actual5s button stability, not a network or assertion failure.
Both GTK positions passed the unchanged real desktop/touch actions, including
negative controls. Run this synthetic full fixture in WebKit GTK under Xvfb.
Keep Chromium and auth isolation headless, all effects, input actionability and
assertions intact. This changes the reference renderer, not the app or thresholds.
The previous failures remain evidence; this does not certify physical Safari,
cold HTTP performance, or acceptance of an uninstalled candidate.

Bounded native38941504634 subsequently passed current replay/audit/twoDOCX and
qualified the unchanged historical literal#REF! refusal. Its final weekly output
says ready=true/historical_replay_verified=false and omits exact frozen hashes;
never cite that summary as a digest it does not contain. Identical engine/deploy
trees permit scoped component comparisons, not transfer of full candidate
installation/restore/two-cycle acceptance. Those remain bound to the exact release.

### One selected-status read verifies an unchanged bundle once

The selected and live-fallback selectors both retain their existing ordering,
archive exclusions and period checks. Within one native status call under its
shared reader lease, an exact unchanged catalog receipt/files pair may reuse its
already successful full artifact verification. The memo contains only the last
checked pair, remains local to this call and is never reused by another request.
Different fallback releases or changed catalog payloads are verified normally;
ordinary standalone store reads retain their original checks. This removes a
reproduced duplicate full hash traversal, not the remaining model JSON reads or
a proved cause of the production browser's intermittent timeout.
