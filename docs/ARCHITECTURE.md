# Architecture

Last broad overview: 2026-06-04. Source/storage paths below rechecked: 2026-10-12 (Kamchatka).

## Уточнение цели 16.10.2026

Архитектура должна локализовать изменения. Адаптер нового источника не
переписывает математику, новый показатель не требует смены хранилища, новый
экран не копирует расчёт. Технические версии обеспечивают воспроизводимость;
это не параллельные продукты. Единственный план и приёмка остаются в
[PLAN](PLAN.md) и [#69](https://github.com/gaben1488/dash/issues/69).

18.10: [рабочий реестр перехода](PLAN.md#consolidated-mandate) связывает
142 подзадачи с прежними результатами #69, всеми13страницами, T001–T158 и обоими
наборами предложений владельца. Начальная редакция17.10 содержала134работы;
после сверки прежних требований уточнены8участков. У каждой — основание,
зависимости, приоритет исполнения и проверяемый итог;
пилоты БД/server-state не являются принятыми заменами стека. Реестр не означает,
что все142задачи реализованы или что исходники полностью проаудированы.

Выбран путь модульного монолита с существующим Word-worker. Ближайшая поставка
и переход к общему входу разделены в [ADR-001](decisions/0001-verified-report-publication.md).
Общий вход ещё не внедрён: TypeScript Dash и Python worker сейчас получают
источники независимо. Совпадение проекции одного ReportModel не доказывает
совпадение всех live-экранов с ним.

| Логическая граница | Существующее размещение | Условие целевого перехода |
|---|---|---|
| Первичные источники | server Google services; report-engine Google adapter | Один состав/профиль/ревизия приобретения; буквы колонок остаются на границе |
| Нормализация, валидация, происхождение | core ingestion; Python raw pipeline и source proof | Одна текущая типизированная модель; история через ограниченные adapters |
| Сущности, связи, история | identity store, procurement rows, expert decisions | Потребность/план/процедура/контракт/исполнение не сплющены; похожесть не identity |
| Правила и показатели | shared/core; report-engine rules и independent audit | Общие определения, единицы, период и зависимости; сравнение на одном input |
| Прикладные операции | Fastify routes, worker, publication store | Явные ACK/readback/idempotency и конечные состояния; отказ выпуска не restart API |
| BI, документы, компоненты | 13 web-разделов, Design Lab, DOCX renderer | Один компонент/селектор для preview и production; Word и BI на одном контексте |
| Хранение и эксплуатация | SQLite, source bundles, reader leases, deploy/systemd | Содержимое по отпечатку отдельно от наблюдений; restore/rollback/GC по ссылкам |

Таблица задаёт границы перехода, а не утверждает, что все они уже реализованы.
PostgreSQL остаётся отдельным решением C08: сначала замеры запросов, конкуренции,
пикового scratch и восстановления. Текущие source-read timeout и повторное
сохранение больших JSON не доказывают ограничение SQLite. Новые брокеры,
микросервисы и дополнительные базы без измеренной необходимости не вводятся.

Повторное чтение, одинаковые байты и идентичность закупки учитываются отдельно.
Наблюдение хранит фактическую provider revision, время/полноту/профиль и ссылку
на содержимое. Переиспользование результата зависит также от правил,
нормализации, календаря, шаблона и доступа. Авторство не выводится из времени
импорта. При исчезновении строки сравниваются пригодный live и последний
подтверждённый четверг Asia/Kamchatka, с сохранением обеих точек и неопределённости.

Существующая граница пока объединяет два разных ключа: `_snapshot_id` в
`report-engine/snapshot.py` включает provider revision вместе с content hash.
На действительной функции с одинаковыми synthetic content/rules/template
смена только revision даёт другой ID. Это подтверждает зависимость текущего
переиспользования от технической ревизии, а не объём лишних live-вычислений.
Исторические ID и доказательства менять нельзя. Общий вход должен отдельно
хранить идентичность наблюдения и ключ переиспользования вычисления со всеми
существенными профилями, правилами, календарём, шаблоном и доступом. Это
условие следующего перехода, не реализованная новая модель хранения.

### Проверяемый ближайший переход, 16.10.2026

Уточнение 21:30 UTC: установлен Bae73c20 (release38961726925), новый и прежний
runtime прошли два независимых восстановления; API/Word/13 разделов в
Chromium и WebKit прошли. Observer38961801554 принял два новых цикла с двойной host FLOCK и native
context/snapshot/3Word после каждого;1638 sealed неизменны, history0invalid.
Новый reader сохранил оба selectors, но повторно не хеширует один и тот же
receipt/files внутри GET. Измерение38968602253 на живом API: 1,518 с native,
два разбора модели 0,813 с, одна inventory 0,207 с; HTTP38968752151 на том же
контексте — 1,690 / 1,641 с. Это прогретые, а не cold измерения; причина
browser21,262 с не установлена. По этим данным нельзя обосновать смену SQLite.

Provenance теперь сохраняет оригинальную книгу, физическую строку журнала и
факт чтения каждого свидетеля. Неоднозначные повторы не складываются в
подтверждённый денежный итог; исходные неизвестные стороны остаются видимыми.
Живой sample38966956109 проверил восемь книг / пять свидетелей, но не встретил
multi-source/overlap. Это законченный ограниченный участок вход→модель→API→UI,
не весь модуль комментариев, не человеческое решение и не официальная экономия.
Перестройка общего acquisition/расчётного контекста остаётся отдельной вертикалью.

Установленный b96 (`4f630e74` / `0d155e1d`) локализует сохранение повторного
attempt и полное чтение evidence в runtime/publication store: наблюдение хранит
hash-ссылку на исходный опубликованный payload, глобальный status остаётся полным.
Это не новая acquisition-модель и не изменение identity/расчётов. Подмена ссылки,
compaction/finalize и restore проверяются на той же границе. До первой публикации
inline-отказ доступен без создания состояния; существующие каталог/fence требуют
lease. `32e9ad6e` задаёт отдельную границу владения: native child read-only GET
завершается при disconnect, принятые POST продолжаются. Release38975748581
установил b96 в22:59UTC после двух restore; observer38978975046 принял два
собственных цикла с точным восстановлением обеих retained-assurance ссылок;
metadata38982529550 подтвердил по4083 logical /4096 allocated B на попытку.
Глобальный status остался полным, старые данные не удалялись.
Chromium38978982855 и
WebKit38978992935 прошли13разделов/Header/3journal/3Word, не весь UX;
результаты и измерения до/после находятся в PLAN и ADR-001/0012.

Установленный d402 (`c0e96be4`) проводит уже существующие Python-наблюдения
генератора через общий typed contract и hook в один React-компонент, без
нового polling, хранилища и дублирования расчётов. Четыре определения находятся
в существующем каталоге метрик. Desktop38985868522 сверил четыре значения
действующего UI с тем же GET. Worker38984598658 принял два новых цикла;
общий вход TS/Python и полная мобильная приёмка этим не доказываются.

Предшествующие основания и измерения:
[ADR0012](decisions/0012-bounded-dashboard-read-model.md) отделяет обычное HTTP
чтение готовой модели от импорта. `ccbd4213` реализует background materialization,
строгий scope, исходное время и явную freshness. Bfd625fc добавил частичный
индекс по времени/ID для weekly-кандидатов, чтобы отсутствие нужного года не требовало разбора
JSON всей истории. Это не общий канонический вход и не доказательство полной
миграции. Предыдущий19289667 принят в своих install/restore/двухциклах/браузере.
Текущийbfd625fc установлен release38949403808: restore/API/3Word PASS19:25UTC,
новые два цикла observer38949805075 PASS,1638sealed неизменны. Индекс установлен; первое journal HTTP в
закрытой установочной приёмке4.617с (startup-log), повторные2.714/3.285с и
4Header15с PASS. Это не host-cold benchmark. Mobile13страниц/3Word PASS;
desktop full repeat PASS с selectedGET19587ms, ранний CHECKING30с сохранён.
Новый native selected-reader исключает доказанный повторный hash traversal
одинаковогоreceipt/files только внутри GET (ADR0012); production эффект не
доказан, исходный отказ не объявлен устранённым. Подробности PLAN.

Конкурирующие объяснения проверены разными материалами: deferred Google test
доказал coupling импорта/GET; SQLite expression counter и контроль без индекса
доказывают стоимость поиска в истории; live frozen diagnostic отделил сохранённые
unknown:REF от потери registered payload. Последний отказ не исправляется заменой
БД. Изменение qualification для исторического отказа отдельно обосновано в
[ADR0010](decisions/0010-canonical-weekly-report-archive.md); исходный FAIL и
непринятое переиздание сохраняются. Свежая установка/измерения ещё обязательны.

Следующая предметная вертикаль остаётся прежней: один зафиксированный вход →
официальная экономия → API/BI/Word, плюс общая проекция человеческих решений
для дела/показателей/журнала. Пригодность границ проверяется изменением адаптера
и правила на изолированном наборе, независимым пересчётом и сохранностью старых
результатов. Простое совпадение старого и нового API не является независимым
расчётом. До этой проверки гибкость всей системы не объявляется доказанной.

Уточнение17:20UTC: native38938184833 вызвал именно installed192 функции на
согласованной копии434122752B, без production mount/network в probe. При
лимите0,5CPU перечисление двух weekly candidates заняло14383,390ms wall/
2177ms CPU; две полные проверки23,34/22,61MB payload —5372,202/4385,457ms.
Последующее сравнение с пустым live cache — уже прогретое, не HTTP cold proof.
Ранее native38935736313 показал тот же selector после partial index0,312ms
вместо1096,623ms, с теми же ID/порядком. Разные wall times не являются
сопоставимым latency-бенчмарком; они показывают повторную тяжёлую работу в
синхронном GET. Classified probe38937411651 отдельно зафиксировал четыре
Header FETCH/TIMEOUT15с; быстрые следующие чтения не отменяют отказ.
Измерения обосновывают исправление границы metadata/payload, а не смену БД.
Индекс установлен вbfd625fc; первое записанное journal HTTP4.617с и
повторные2.714/3.285с измерены отдельно. Это разные условия, не paired benchmark.

### Один вход также требует одного временного контекста

16.10,19:05UTC на synthetic source-context fixture проверены действительные
CalcEngine/computeUnifiedGrid и Python canonical_metrics: план100, факт90,
AD=да/Z=10, N=10.10.2026, Q=20.10.2026, срез17.10.2026. Live TS безcutoff
возвращает fact1/economy10; тот же CalcEngine с явнымasOfDay и Python с тем
жеas_of возвращают fact0/economy0. Это не измерение живых закупок. Rawfixture
и результаты сохранены в /tmp/dash-economy-context-repro{.ts,-ts.json,-py.json}.
Исполняемые причины: orchestrator передаётasOf в сигналы, но compute вызывает
безasOfDay; attachUnifiedGrid также не передаётcutoff. Прежний CalcEngine
документирует «весь введённый факт» как совместимый режим, поэтому различие
контекстов нельзя молча назвать ошибкой одной суммы или перенести Word cutoff
на live без явного решения о смысле текущего факта.

Независимое чтение ADR0007:60 и week-regression:175 подтвердило намеренное
различие live/archive. У live report.ts:262 и economic-metrics.ts:424 cutoff
также явно отсутствует. Ни snapshot.createdAt, ни время webhook не доказывают
расчётныйcutoff (reconciliation.ts:136). Для абсолютного момента уже есть
shared/time-selection.ts:35 productCalendarDay; dayNumberOf(Date) использует
локальный календарь машины. Snapshot cache сейчас year/TTL, безprojectday.
Кроме этого, live report читаетdeptcache отдельно от snapshot/grid/issues,
а Python работает с frozenbundle. Один clock не является одной source revision.
МусорнаяQ тоже требует явной политики: TSfactCountsOn считает нераспознанный
текст фактом, Python normalize/date-aware completion — нет. До изменения
правила нужно сохранить прежнийконтракт, контрпримеры иhistorical reader.

Целевая миграция официальной экономии должна фиксировать один вход И один
контекст времени/правил: календарный день проекта отдельно от instant чтения,
границы периода отдельно от mutable identity, явныйcutoff у всех потребителей.
Нужны контрпримеры future/today/invalid dates, Kamchatka day-rollover, старые
снимки и одинаковое значение в API/BI/Word. Это уточнение критерия первого
вертикального перехода; новая модель времени ещё не реализована/не установлена,
исторические payload/хэши не переписываются. Состав текущего конечного выпуска
bfd625fc не расширяется этим исследованием.

## Layers

```text
Google Sheets
  -> packages/server services/google-sheets.ts
  -> packages/core pipeline and analytics
  -> packages/server snapshot + API routes
  -> packages/web React UI
```

## Packages

- `@aemr/shared`: shared domain types, constants, legal thresholds, dictionaries and rule book.
- `@aemr/core`: pure calculation layer: ingestion helpers, normalization, signal detection, reconciliation, analytics, trust scoring.
- `@aemr/server`: Fastify API, Google Sheets access, SQLite persistence, snapshot orchestration and auth.
- `@aemr/web`: React SPA, global Zustand store, filters, pages and charts.

## Server Runtime

`packages/server/src/index.ts` starts the app. `packages/server/src/app.ts` owns app creation and route registration so tests can instantiate the server without binding a port.

Registered route groups:

- `/api/dashboard`, `/api/refresh`
- `/api/metrics`
- `/api/audit`
- `/api/rows`
- `/api/issues`
- `/api/mapping`
- `/api/journal`, `/api/sources/*`
- `/api/settings`
- `/api/analytics`
- `/api/health`

`/api/debug/sheets` is registered only in explicitly declared development/test runtimes.

## Auth Boundary

`registerAuthHook` protects `/api/*` when `AEMR_API_KEY` is set. In production the server refuses to start without this key. `/api/health` is public.

Production browser access uses Caddy Basic authentication; Caddy injects the
server-side Bearer token. The production web client deliberately does not send
`localStorage.aemr_api_key` (see `web/src/api.ts`). Direct development API access
can use that local key. This is coarse service access, not proof of per-user or
per-organization authorization; the target roles in PRODUCT.md are not an
implemented permissions model.

## Data Sources

The main spreadsheet ID comes from `GOOGLE_SHEETS_SPREADSHEET_ID` or the shared default constant. Department spreadsheet defaults live in `packages/server/src/config.ts`; runtime overrides are saved in `data/sources.json`.

`ШДЮ` (месячный свод) на текущем серверном пути читается отдельно: `fetchSHDYUSheet(SHDYU_SPREADSHEET_ID)` → `parseSHDYUSheet()` → `snapshot.shdyuData`. В `pipelineInput.sheetRows` для `runPipeline()` он не добавляется. `ALL_SHEETS` основной книги включает `СВОД ТД-ПМ` и листы ГРБС, а не месячный ШДЮ. Это подтверждено проверкой `snapshot.ts` на 2026-10-10 (см. [верифицированный аудит](superpowers/audits/2026-10-10-dash-code-review-verified/README.md), DASH-011).

Production source classification is documented in [DATA_SOURCES.md](DATA_SOURCES.md). Metric-level traceability from sheet columns to API DTO and UI labels is documented in [METRICS_CONTRACT.md](METRICS_CONTRACT.md).

## Database

Current implementation is SQLite through `better-sqlite3`. Drizzle schema tables include snapshots, metric history, issues, issue history, audit log, input errors, mapping overrides and procurement rows.

Production compose persists SQLite at:

```text
/app/packages/server/data/aemr.db
```

## Web Runtime

Текущие 13 разделов в `packages/web/src/App.tsx` и Header:

- Пульс (`dashboard`), Отчёт (`report`), Свод (`svod`).
- Реестр (`data`), Не обеспеченные (`unfunded`), В течение года (`yearlong`), Мониторинг (`monitoring`).
- Экономия (`economy`), Конкуренция (`competition`), Дисциплина (`discipline`), Аналитика (`analytics`).
- Контроль (`quality`) и Система (`settings`).

Исторические `recon/trust/issues/recs/journal` читаются как пути Контроля;
это не дополнительные независимые расчётные экраны. Перечень исходников
не является приёмкой всех 13 браузерных сценариев.

Global state lives in `packages/web/src/store.ts`. Filter semantics: empty Set means "all"; period can be week-derived or explicit month/quarter/year selection.

## 44-FZ Thresholds

Canonical 44-ФЗ numeric thresholds are in `packages/shared/src/constants.ts` under `LAW_44FZ_THRESHOLDS`. Core analytics and signals should import those constants instead of duplicating numbers.


## Source versions and report storage — current and target

The operational Dash reader and Python report worker currently acquire Google
sources independently. Dash persists complete PipelineSnapshot JSON plus SQL
row/metric projections; Python persists snapshot payloads, one ReportModel and
several JSON projections, then PublicationStore copies the candidate directory.
The published Python dashboard projection is verified against its ReportModel;
this does not establish version parity with all live Dash routes.

Target: one sealed source revision used by both consumers; unchanged content
stored once, changes and bounded recovery checkpoints retained, weekly markers
referencing completed revisions in Asia/Kamchatka. A verified release references
that revision, rules/renderer versions and one frozen model. Derived views use
indexed current state or bounded caches; they do not retain new full source
copies per release. Human decisions and their minimal exact proofs survive GC.
The current live head may be newer than the verified release; consumers expose
both explicitly instead of silently changing historical document input.

```mermaid
flowchart LR
    G[Registered Google sources] --> I[One acquisition coordinator]
    I --> V[Sealed source revision and change history]
    V --> D[Dash indexed queries]
    V --> R[Report calculations and validation]
    V --> W[Weekly revision markers]
    H[Human decisions and exact proofs] --> D
    H --> R
    R --> P[Verified release references and frozen model]
    P --> DOC[Word documents]
    P --> VIEW[Published dashboard view]
```

This is a transition design, not deployed behavior. It does not move independent
Operational Tasks or OKRUG production data into Dash. See the existing
[ADR-001 revision](decisions/0001-verified-report-publication.md) for current
byte measurements, alternatives, migration stages, failure handling and tests.
PostgreSQL selection remains C08; changing the database alone cannot remove
application-level snapshot duplication or unify acquisition.
