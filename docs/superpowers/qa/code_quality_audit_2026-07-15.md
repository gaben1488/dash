# Технический аудит кода по пластам — 2026-07-15

> Verified-аудит: все числа получены командами на HEAD `be5063f`
> (после свежих коммитов: `readDeptSheet` в rows.ts ×5, `findDept` в snapshot,
> `parseSheetDate`-канон, `scripts/signal_audit.ts`, снятый осиротевший импорт).
> Методика: `wc -l` по не-тестовым `.ts/.tsx` в `packages/*/src`; тесты —
> `npx vitest run` per package (все зелёные); грязь — `grep -c ": any|as any"`,
> `@ts-ignore|@ts-expect-error`, `eslint-disable`, `TODO|FIXME|HACK`;
> мертвечина — кросс-грep экспортов/роутов/функций api.ts против потребителей,
> сверено с verified-инвентарями `consolidation-sweep-2026-07-14.md` и
> `2026-07-14-raised-workplan.md` (Трек F). `pnpm lint`: **0 ошибок, 279
> warnings — все `no-explicit-any`**.

---

## §1. Сводная таблица

| Пакет | Файлов (src, не тест) | LOC | Тест-файлов | Тестов (прошло) | `any` (src, не тест) | God-файлов >500 | Оценка /10 |
|---|---:|---:|---:|---:|---:|---:|---:|
| shared | 33 | 7 842 | 14 | 110 | 0 | 5 | **8.5** |
| core | 40 | 10 396 | 29 | 751 | 2 | 6 | **8** |
| server | 25 | 6 117 | 13 | 40 | 31 | 3 | **6** |
| web | 51 | 17 323 | 14 | 63 | 165 | 14 | **5** |
| **Итого** | **149** | **41 678** | **70** | **964** | **198** | **28** | **6.5** |

Дополнительно: `@ts-ignore`/`@ts-expect-error` — **0 во всех пакетах**;
`eslint-disable` — core 7, web 3, остальные 0; TODO/FIXME/HACK — shared 27
(все — заглушки словарей, см. §4), server 1, web 4, core 0.

---

## §2. По пакетам

### 2.1 shared — 8.5/10

Факты. 33 файла / 7 842 LOC; 110 тестов в 14 файлах (отношение тест-файлов к
модулям 0.42 — лучший точечный охват канонов: `parse-sheet-date`, `fact-date`,
`sheet-classifier`, `column-map`, `product-dictionary`, `report-map` — все с
тестами). 0 `any`, 0 `ts-ignore`, 0 `eslint-disable`. 27 TODO — целиком в
`dictionaries/` (kosgu, kvr, subordinate-registry, user-roles, legal-refs,
grbs-registry): справочники-заглушки «заполнить из официального источника».

Крупные модули без единого теста: `rule-book.ts` (653), `unified-class-system.ts`
(603, но покрыт характеризационным `core/pipeline/god-file-surface.test.ts`),
`check-registry.ts` (510), `types.ts` (593 — типы, тест не нужен).

Топ-5 улучшений:
1. `dictionaries/kosgu.ts`, `kvr.ts`, `user-roles.ts`, `grbs-registry.ts` — **0
   потребителей вне shared** (проверено grep по core/server/web). Либо заполнить
   и подключить, либо вынести из публичной поверхности — сейчас это мёртвый груз
   с 27 TODO, создающий иллюзию наличия справочников.
2. `shdyu-map.ts:275 QUARTER_MONTHS` — дубль с `web/store.ts:138` (ключи UPPER vs
   lower, tuple vs number[]). Свести к одному экспорту с ключами `q1..q4`
   (семья №10 свепа), web импортирует из shared.
3. `product-dictionary.ts:62 SIGNAL_LABELS` — самопризнанное «зеркало,
   скопировано из web/core»; сделать единственным источником и убрать копии в
   `web/pages/DataBrowser.tsx:52` и `web/components/RowDetailCard.tsx:22`
   (семья №8: сейчас **три** копии лейблов сигналов).
4. `rule-book.ts` (653) и `check-registry.ts` (510) — добавить хотя бы
   инвариант-тесты (уникальность id, консистентность severity/групп) — это
   реестры, на которых стоит сигнальная система, а тестов ноль.
5. Держать линию «0 any» — shared единственный полностью чистый пакет; при
   резке god-файлов других пакетов канон выносить сюда (как сделано с
   `parseSheetDate`).

### 2.2 core — 8/10

Факты. 40 файлов / 10 396 LOC; **751 тест** в 29 файлах (0.73 — лучший охват в
репо, включая характеризационный `god-file-surface.test.ts` для разрезаемых
god-файлов). `any` — 2 в src (23 с тестами), 7 `eslint-disable`, 0 TODO.

Крупные модули без прямого теста: `calc-engine.ts` (796), `orchestrator.ts`
(629), `seasonal.ts` (косвенно через silent-drop). `reconcile.ts`, `signals.ts`,
`dataset-signals.ts`, `metrics/registry.ts` — тесты есть.

Топ-5 улучшений:
1. `pipeline/recommendations.ts` — **мёртвый модуль** (не экспортируется из
   `core/src/index.ts`, ни одного импортёра во всех пакетах; verified и в Треке
   F). Бинарное решение: подключить движок «ЕП→ЭА» вместо клиентской лепки
   рекомендаций в `web/pages/Recs.tsx`, либо удалить.
2. Публичная поверхность `index.ts` раздута: **37 из 56 value-экспортов не имеют
   ни одного импортёра в server/web** (не-тест). Из них часть жива внутри core
   (`analyzeDataset`, `classifyRows`, `computeDeltas`, `ingest*`,
   `normalizeMetrics`, `validateData`…), но ~25 (`quarterExecution*`,
   `sentimentFor`, `validateInput`, `getMetricTooltip`, `isEditableColumn`,
   `normalizeDate/Money/Status`, `sliceResults`, `getValue`,
   `getMetricsByCategory`, `ALL_METRIC_KEYS`…) не зовёт никто, кроме тестов.
   Сузить API или провести в UI (Трек F: «построено и висит — недопустимо»).
3. `calc-engine.ts:796` без прямого теста — перед резкой (Трек A) снять
   характеризационную страховку по образцу god-file-surface.
4. `orchestrator.ts:629` — резка по стадиям 0-4 (план Трека A); стадии уже
   именованы, шов очевиден.
5. Убрать 7 `eslint-disable` и 2 остаточных `any` — пакет в шаге от строгого
   нуля, как shared.

### 2.3 server — 6/10

Факты. 25 файлов / 6 117 LOC; 40 тестов в 13 файлах — самый тонкий охват
относительно критичности (auth, write-bounds, dept-errors покрыты; но
`routes/dashboard.ts` 600 LOC — **0 тестов**, `routes/analytics.ts`,
`journal.ts`, `reconciliation.ts` — 0 прямых тестов). `any` — 31; suite идёт
44.86 c (медленно для 40 тестов — интеграционный вес).

Класс «резолв листа» закрыт свежими коммитами: `readDeptSheet` ×11 в rows.ts,
`findDept` в snapshot.ts:105. **Но хвост остался**: `rows.ts:14
getDeptSheetName` жив и используется на **write-путях** (rows.ts:477, 593) —
одно-кандидатный резолв: запись в лист УАГЗО с реальной вкладкой `'Все'`
промахнётся мимо `'ВСЕ'`. Читающие default-book пути (rows.ts:95, 334) идут
через `getSheetData(sheetName)` мимо dept-канона.

Топ-5 улучшений:
1. `routes/rows.ts:477,593` — перевести write-пути на кандидатный резолв
   (`departmentSheetNameCandidates`), удалить `getDeptSheetName` окончательно;
   это последний представитель семьи №2 свепа.
2. Роуты-сироты (см. §4): `/api/analytics/scorecard`, `/api/analytics/
   anticorruption`, `/api/reconcile*`, `/api/history/diff|snapshots`,
   `/api/load-all`, `/api/reconciliation/quarterly`, `/api/sources/:name/test` —
   без единого клиента. Каждому — проводка (Трек F ценит scorecard и
   centralization выше всего) или снос.
3. `routes/dashboard.ts` (600 LOC, главный DTO-сборщик) — 0 тестов; добавить
   snapshot-тест формы DTO до любой резки.
4. `rows.ts:876,941,1082-1126` — magic-индексы `row[2]/row[24]…` мимо
   `DEPT_COLUMNS` (семья №6, ~8 обращений): сдвиг колонки сломает молча.
5. Снизить 31 `any` — в основном тела роутов; типизировать через `@aemr/shared`
   schemas (zod уже в проекте).

### 2.4 web — 5/10

Факты. 51 файл / 17 323 LOC (42% всего кода репо); 63 теста в 14 файлах — **все
тесты на lib/** (economy-metrics, rows-filter, trust-metrics…), страницы и
компоненты не покрыты вовсе (отношение 0.27). `any` — **165** (83% всех any
репо; ровно они дают 279 lint-warnings). 14 god-файлов >500 LOC, из них 4
страницы >1000. Позитив: «сырых ключей» нет — grep `EP_[A-Z_]+` в JSX и
латиницы `uer|uio|uagzo` в видимых строках дал **0** (лейблы идут через
словари).

Архитектурные швы: web импортирует `@aemr/core` напрямую (6 файлов:
DeltaBadge, bootstrap-kb-registry, delta-format, metrics-registry + 2 теста) —
это **легально** (`@aemr/core` объявлен в dependencies web), но тянет
серверное ядро в бандл — известный residual «Split the large web bundle».

Топ-5 улучшений:
1. **`pages/Settings.tsx:176,425` — голый `fetch('/api/settings/...')` мимо
   `fetchJSON`**: не прикладывает Bearer-токен → в проде с обязательным
   `AEMR_API_KEY` статус и сохранение env получат 401. Два вызова перевести на
   `fetchJSON` — это баг, не стиль.
2. `api.ts`: **18 функций без единого вызова со страниц** (см. §4), включая
   весь блок analytics (6 из 7) и `testSource`. Каждой — потребитель или снос.
3. `hooks/useFilteredData.ts` (909 LOC, 0 тестов) — ядро всей фильтрации UI;
   резать на pure-селекторы с тестами (план Трека A) — первый кандидат, потому
   что от него зависят все страницы.
4. Кампания `any` (165): начать с `api.ts` (все `fetchJSON<any>`) — типизировать
   DTO через `@aemr/shared`, дальше типы протекут в страницы сами; это же
   закроет большинство из 279 lint-warnings.
5. Дубли лейблов/констант: `SIGNAL_LABELS` ×2 локальных копии
   (DataBrowser.tsx:52, RowDetailCard.tsx:22), `QUARTER_MONTHS` в store.ts:138,
   массивы месяцев в SvodView/Analytics — импортировать из shared (семьи №8/№10).

---

## §3. Карта god-файлов репо (>500 LOC, не тесты) — 28 шт.

| LOC | Файл | Тест есть? | Вердикт |
|---:|---|:---:|---|
| 1305 | web/pages/Recon.tsx | нет | **Резать сейчас** — крупнейший файл репо, 0 тестов, смешивает 2 сверки + экспорт |
| 1297 | web/pages/Settings.tsx | нет | **Резать сейчас** — плюс баг auth-bypass (§2.4-1) внутри |
| 1231 | web/pages/Economy.tsx | нет (lib покрыт) | **Резать сейчас** — вынести чарты/копирайт уже начато (economy-copy/metrics в lib) — дорезать страницу |
| 1127 | server/routes/rows.ts | частично (3 теста) | **Резать сейчас** — план Трека A: роут тонкий → сервисы; write-хвост getDeptSheetName |
| 1021 | web/pages/Analytics.tsx | нет | **Резать сейчас** — 4 независимых блока (forecast/scatter/labels) |
| 909 | web/hooks/useFilteredData.ts | нет | **Резать сейчас** — ядро фильтрации без тестов, any-рассадник |
| 902 | core/pipeline/reconcile.ts | да | Резать позже — шов известен (quarterly/monthly/cross), тест-страховка есть |
| 865 | core/metrics/registry.ts | да | Оставить — LOC = данные реестра, не логика |
| 819 | shared/report-map.ts | да | Оставить — декларативная карта отчёта, тест есть |
| 801 | web/pages/Dashboard.tsx | нет | Резать позже — после useFilteredData |
| 796 | core/pipeline/calc-engine.ts | нет прямого | Резать позже — **сначала характеризационный тест** |
| 779 | web/store.ts | да | Резать позже — zustand-слайсы (data/filter/ui), тесты есть |
| 778 | web/pages/SvodView.tsx | нет (lib покрыт) | Резать позже — view-логика уже в lib/unified-svod-view |
| 738 | web/pages/DataBrowser.tsx | нет | Резать позже — вытащить SIGNAL_LABELS/колонки |
| 727 | core/pipeline/signals.ts | да | Резать позже — по семьям детекторов, тест-страховка есть |
| 725 | web/components/charts/DrillPieChart.tsx | нет | Резать позже — один компонент, но 725 LOC чарт |
| 677 | web/components/TableEditor.tsx | нет | Резать позже — редактор-трек продукта |
| 660 | core/pipeline/dataset-signals.ts | да | **Оставить** — уже резался (chunk G), под характеризационным тестом |
| 653 | shared/rule-book.ts | нет | Оставить — реестр правил (данные); добавить инвариант-тест |
| 646 | web/components/HeroKPICard.tsx | нет | Резать позже — 646 LOC для одной карточки много |
| 629 | core/pipeline/orchestrator.ts | нет прямого | Резать позже — по стадиям 0-4 |
| 625 | web/pages/Trust.tsx | нет (lib покрыт) | Оставить — метрики уже в lib/trust-metrics |
| 619 | web/components/Header.tsx | нет | Резать позже — фильтр-панель → отдельные контролы |
| 603 | shared/unified-class-system.ts | да (характ.) | **Оставить** — уже резался (chunk G) |
| 600 | server/routes/dashboard.ts | **нет** | Резать позже — сначала snapshot-тест DTO, это главный контракт web |
| 593 | shared/types.ts | — | Оставить — типы |
| 516 | server/services/demo-data.ts | да | Оставить — данные демо-режима |
| 510 | shared/check-registry.ts | нет | Оставить — реестр (данные); инвариант-тест |

Итог по резке: **сейчас** — 6 файлов (4 страницы web >1000, rows.ts,
useFilteredData); **позже** — 13; **оставить** — 9 (реестры/данные/уже
разрезанное).

---

## §4. Мертвечина и дубли (с доказательствами)

### 4.1 Мёртвые функции web/api.ts (0 вызовов со страниц/store, grep `api.<fn>` по web/src без тестов)

`getMetrics`, `getMetric`, `getIssues`, `getTrust`, `getTrustDetail`,
`updateField` (вытеснен `saveRows`), `getSvodUnified`, `getJournalStats`,
`testSource`, `getReportMap`, `getHistory`, `exportAudit`,
`getAnalyticsProfiles`, `getAnalyticsCompliance`, `getAnalyticsEPReasons`,
`getAnalyticsAnomalies`, `getAnalyticsSubjects`, `getAnalyticsCentralization`,
`getCellRefs` — **19 из 43** функций клиента мертвы. Страницы живут с
dashboard-payload из store; отдельные роуты зовут лишь 24 функции.

### 4.2 Роуты server без потребителя в web (кросс-грep 55 зарегистрированных `/api/*` против api.ts + прямых fetch)

Совсем без клиентской обвязки: `/api/analytics/anticorruption`,
`/api/analytics/scorecard`, `/api/reconcile`, `/api/reconcile/:deptId`,
`/api/history/diff`, `/api/history/snapshots`, `/api/load-all`,
`/api/reconciliation/quarterly`, `/api/reconciliation/monthly/diagnostics`,
GET `/api/rows/:deptId/:rowIndex`, GET `/api/issues/:id`,
POST `/api/sources/:name/test` (journal.ts:378 — клиент `testSource` есть, но
сам мёртв). Плюс все роуты из 4.1, чья обёртка мертва (`/api/metrics*`,
`/api/trust*`, `/api/svod/unified`, `/api/journal/stats`, `/api/report-map`,
`/api/history`, `/api/export/audit`, `/api/cell-refs`, 6 analytics-роутов).
Совпадает с Треком F: «40 core-модулей → 24 ✅ / 15 🟡 / 1 ❌» — сутевка
построена, но не доезжает до экрана.

### 4.3 Мёртвый модуль core

`core/src/pipeline/recommendations.ts` — не в `core/src/index.ts`, 0 импортёров
во всех пакетах (grep `from.*recommendations`). Recs.tsx лепит рекомендации
клиентски из issues. Решение бинарное: подключить или удалить.

### 4.4 Раздутая API-поверхность core

37/56 value-экспортов `core/src/index.ts` без импортёров в server/web
(не-тест); из них ~25 не используются и внутри core вне своего модуля
(доказательство: grep по определяющему файлу, список в §2.2-2).

### 4.5 Словари-заглушки shared

`dictionaries/kosgu.ts`, `kvr.ts`, `user-roles.ts`, `grbs-registry.ts` — 0
упоминаний вне shared, 27 TODO «заполнить из официального источника». Мёртвый
груз в публичной поверхности.

### 4.6 Живые дубли (по свепу 2026-07-14, перепроверено на HEAD)

- `SIGNAL_LABELS` ×3: `shared/product-dictionary.ts:62` (канон),
  `web/pages/DataBrowser.tsx:52`, `web/components/RowDetailCard.tsx:22`.
- `QUARTER_MONTHS` ×2: `shared/shdyu-map.ts:275` (UPPER, tuple) vs
  `web/store.ts:138` (lower, number[]).
- Форматтеры денег/% (семья №5): `store.formatMoney`, `lib/delta-format.ts:20`,
  `SvodView fmt*`, `useMultiDimMetrics.safePct`, ~45 инлайн `toFixed` — единого
  `lib/format.ts` нет.
- Magic-индексы колонок `rows.ts:876,941,1082-1126` мимо `DEPT_COLUMNS`.
- classifySheet-литералы (семья №3): `source-validation.ts:148,156`,
  `journal.ts:383,385,432` — `===` литералы имён листов мимо SSOT.

### 4.7 Закрыто свежими коммитами (не числить в долге)

Семья №1 (serial-дата: `parseSheetDate` канон в shared, seasonal делегирует),
семья №2-read (rows.ts ×5 через `readDeptSheet`, `getSheetDataFromSpreadsheet`
импорт снят в be5063f), семья №4 (snapshot через `findDept`). Остаточный хвост
№2 — только write-пути (rows.ts:477,593).

---

## §5. Общий вердикт: 6.5/10

Ядро (shared+core) — крепкое: канонизация идёт классами, 861 тест на расчётную
логику, 2 any на 18 тыс. LOC, характеризационная дисциплина резки работает.
Оценку тянут вниз (а) web: 165 any, нулевое покрытие страниц, 14 god-файлов,
пятая часть клиентского API мертва; (б) server: тонкие тесты на главных роутах
и хвосты резолва на write-путях; (в) системная «построено и висит»: ~20 роутов
и 19 клиентских функций без потребителя при готовой сутевке.

Топ-10 действий (по ценности):

1. **Починить auth-bypass в Settings.tsx:176,425** — голый fetch без Bearer,
   в проде 401. Полчаса работы, единственный найденный прод-баг аудита.
2. **Закрыть write-хвост семьи №2**: rows.ts:477,593 → кандидатный резолв,
   удалить `getDeptSheetName` (rows.ts:14).
3. **Провести или снести сироты одним решением на пару** (роут+api-функция):
   первыми — scorecard и centralization (Трек F: максимум ценности при
   минимуме работы), затем /reconcile*, /history/*, analytics-остаток.
4. **recommendations.ts — бинарно**: подключить в Recs.tsx или удалить.
5. **Типизировать api.ts** (все `fetchJSON<any>` → DTO из shared) — гасит
   корень 165 web-any и большинство из 279 lint-warnings.
6. **Резать useFilteredData.ts (909)** на pure-селекторы с тестами — от него
   зависят все страницы; затем 4 страницы >1000 LOC.
7. **Резать rows.ts (1127)** по плану Трека A (роут тонкий → сервисы), заодно
   убрать magic-индексы `row[N]` → `DEPT_COLUMNS`.
8. **Snapshot-тест DTO dashboard.ts** (600 LOC, 0 тестов, главный контракт
   web) — до любой резки серверного слоя.
9. **Свести дубли лейблов/констант в shared**: SIGNAL_LABELS ×3,
   QUARTER_MONTHS ×2, месяцы, `lib/format.ts` для денег/%.
10. **Сузить публичную поверхность**: core/index.ts (37 экспортов без внешних
    потребителей), словари-заглушки shared (0 потребителей, 27 TODO) —
    заполнить или вынести.
