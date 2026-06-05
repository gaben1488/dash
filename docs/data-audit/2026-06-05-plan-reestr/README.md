# ПЛАН-РЕЕСТР: канонический аудит исходных данных и продуктовая карта

Дата прохода: 2026-06-05.

Локальный источник: `C:\Users\filat\Downloads\ПЛАН-РЕЕСТР-20260604T034235Z-3-001\ПЛАН-РЕЕСТР`.

Drive-источник: `1nacsNZYgUKLyeSfqEPH1GPveg56cFUJm`.

Этот документ — входная точка к аудиту исходных данных. Его цель не пересказать все строки таблиц вручную, а зафиксировать каноническую модель исходных данных, связь с текущим кодом и фронт работ, чтобы продукт можно было довести до надежного MLP.

Tracked commit scope: summary + audit tooling. Полный raw corpus (`xlsx-csv/`, `docx-text-by-path/`, full JSON/MD profiles) был изучен и остается локальным evidence corpus; его нельзя смешивать с runtime/product commits без отдельного решения по чувствительности данных, размеру и `git diff --check` policy.

## Что изучено

Покрытие по локальному архиву:

- XLSX: 16 книг, 209 листов, 39 535 активных строк, 441 067 формульных ячеек.
- Google/exported formulas: 308 060 ячеек с `__xludf.DUMMYFUNCTION`/Google-формулами.
- Метаданные XLSX: 328 комментариев, 100 групп формульных аномалий, 4 733 скрытых строки, 1 скрытый столбец.
- DOCX: 53 документа извлечены в текст без коллизий имен.
- Drive: просмотрена live-структура верхнего уровня и вложенные папки `Архитектура`, `Генератор Отчетов`, `ОТЧЕТЫ`, `документация`, `схемы`, `Архив-Буфер тест`.

Ключевые артефакты:

- `canonical-source-audit-summary.md` — компактный машинно-собранный свод.
- Local/generated evidence corpus: `xlsx-full-profiles.md/json`, `xlsx-formulas.md/json`, `xlsx-metadata-map.md/json`, `xlsx-csv/`, `docx-text-by-path/`.
- Audit tools: `scripts/docx_to_text.py`, `scripts/plan_reestr_summarize.py`, `scripts/xlsx_style_extract.py`.

Важно: ранняя плоская DOCX-выгрузка дала 52 текста из 53, потому что два документа имели basename `260315_Отчет_шаблон_для_AppsScript_v3`. Инструмент `scripts/docx_to_text.py` исправлен: recursive-режим теперь строит имя из относительного пути.

## Каноническая картина источников

Production-источник текущего приложения — не весь архив, а 1 главная Google-книга и 8 книг управлений:

- `СВОД_ДЛЯ_GOOGLE`: `1i692JdP-FqWMSfVgBjTmDCoUakacbJpZMq9tJhQlRhg`.
- Управления: `УЭР`, `УИО`, `УАГЗО`, `УФБП`, `УД`, `УДТХ`, `УКСиМП`, `УО`.
- Этот набор закреплен в `packages/shared/src/constants.ts`, `packages/shared/src/data-sources.ts`, `packages/shared/src/department-registry.ts` и проверяется `packages/server/src/source-inventory.test.ts`.

Локальный XLSX-архив — не production-источник, а экспортный снимок/исторический корпус. Его нельзя подставлять в runtime молча. Но его нельзя считать мусором: он содержит спецификацию поведения, которую текущий продукт перенес только частично.

`СВОД_ДЛЯ_GOOGLE.xlsx` — не просто таблица `СВОД ТД-ПМ`. Это рабочий data product:

- `СВОД ТД-ПМ` — официальный квартально-годовой свод.
- `СВОД с месяцами` — месячная/недельная логика ближе к управленческим отчетам.
- `ШДЮ старый` — старая помесячная динамика.
- 8 вкладок управлений — зеркало/агрегация управленческих данных.
- `КОНТЕКСТ`, `РАСЧЕТ`, `ИСТОРИЯ`, `ОТЛАДКА`, `Settings`, `Контроль`, `NVScriptsProperties` — операционный контекст, расчетная память и техподдержка.

Книги управлений тоже не плоские CSV:

- стандартный реестр A:AG с данными с 4-й строки;
- вкладки `ВСЕ`, `Контроль`, `GOOGLE_ФОРМУЛЫ`, `Settings`;
- подведомственные вкладки и фильтры;
- validations, comments/change history, hidden rows;
- формулы, которые моделируют подведы через `FILTER`, `REGEXREPLACE`, `TRIM`, `SUBSTITUTE`.

## Атомарная модель строки

Кодовая карта `packages/shared/src/column-map.ts` совпадает с ключевой структурой исходников:

- A: `ID`.
- B: реестровый номер.
- C: подведомственная организация.
- D/E/F: описание, программа, вид деятельности.
- G: предмет закупки.
- H/I/J/K: план ФБ/КБ/МБ/итого.
- L: способ закупки.
- N/O/P: плановая дата/квартал/год.
- Q/R/S: факт-дата/квартал/год.
- U: статус.
- V/W/X/Y: факт ФБ/КБ/МБ/итого.
- Z/AA/AB/AC: экономия.
- AD: признак экономии.
- AE/AF: комментарии ГРБС/УЭР.

Эта модель должна стать единственным контрактом для фильтров, редактора, расчетов, сигналов, snapshot diff и explainability. Любая логика, которая обходит эту карту, должна быть либо удалена, либо явно объяснена.

## Что текущий продукт уже решает

Продукт уже полезен как аналитический MLP:

- читает production Google Sheets;
- держит единый реестр 8 ГРБС и часть геометрии `СВОД`/`ШДЮ`;
- пересчитывает KPI и сравнивает с официальным `СВОД`;
- показывает economy, registry, reconciliation, issues, trust, journal;
- сохраняет snapshots/metric history/issues/audit в SQLite;
- имеет тесты на ключевые расчетные и source-инварианты.

Практически он уже отвечает на вопросы:

- где исполнение закупок проседает;
- где есть расхождение между расчетом и официальным сводом;
- какие строки имеют сигналы качества/риска;
- где видна экономия, факт, план, метод закупки;
- какие источники загрузились и какой snapshot используется.

## Что продукт пока не решает

Главный пробел — доверие к данным, а не количество экранов.

Не хватает:

- cell/row-level provenance: метрика должна раскрываться до формулы, источника, строк, фильтров и freshness;
- настоящей source governance: production/archive/demo/mirror/fallback должны быть runtime-политикой, не только документацией;
- точной недельной семантики: текущий `periodMode=week` в web-store фактически прокидывает месяцы, а не row-level недельный интервал;
- snapshot comparison по измененным таблицам/листам Google: сейчас есть snapshots и `metric_history`, но нет продукта “что поменялось в таблице X и какие KPI из-за этого изменились”;
- полноценной системы ГРБС -> управление -> подведы -> dept-only, одинаковой для всех страниц и API;
- registry как Google Sheets 2.0: видно строки и есть редактирование, но нет сильной cell history, comment ingestion, approval flow и explain-per-cell;
- единого Control Hub для сигналов, замечаний, доверия, сверки, рекомендаций и журнала;
- полноценного переноса старого генератора отчетов: недельные Google Docs, `РАСЧЕТ`, `ИСТОРИЯ`, `КОНТЕКСТ`, 44-ФЗ/антикоррупционные модули живут в архиве как спецификация, а не как завершенный runtime-флоу.

## Что продукт может создавать как риск

- Ложная уверенность: dashboard выглядит цельно, но source/fallback/фильтр/snapshot semantics пока не всегда раскрыты пользователю.
- Непрозрачная подмена источника: runtime source override есть, но нужен pending -> validate -> approve -> audit.
- Редактирование без достаточной управляемости: write endpoints пишут в Google Sheets и логируют audit, но old value местами не читается, роли/причины/аппрув не являются сильным контрактом.
- Дублирование логики: фильтры и агрегации частично в web, частично в core/server.
- Документарный дрейф: часть docs описывает будущую/старую Apps Script-систему, часть — текущий dashboard, и это легко спутать.
- Demo/fallback может быть воспринят как production, если UI не делает это громким.

## Найденные заблуждения и баги

1. Нельзя считать архивные XLSX production-источниками. Они нужны как спецификация и forensic corpus, но production должен идти из live Google Sheets.

2. Нельзя считать книги управлений плоскими таблицами. Формулы, comments, validations, hidden rows и subordinate tabs являются частью смысла данных.

3. Нельзя считать `СВОД_ДЛЯ_GOOGLE` только листом `СВОД ТД-ПМ`. Листы `СВОД с месяцами`, `РАСЧЕТ`, `ИСТОРИЯ`, `КОНТЕКСТ`, `ШДЮ старый` являются продуктовой памятью и должны быть либо перенесены, либо явно архивированы.

4. Недельный фильтр в текущем web-store является месячным proxy. Для управленческого продукта нужна дата-недельная фильтрация по `N/Q` и/или событийному snapshot timeline.

5. `savings_pct` исторически конфликтовал по смыслу. В метриках он должен трактоваться как `fact_total / plan_total` (`Потрачено, %`), не как экономия.

6. Hidden rows требуют явной политики. Google API обычно возвращает values независимо от UI-скрытия; значит продукт должен явно решить: hidden rows участвуют в расчетах или являются trust/evidence-сигналом.

7. DOCX extraction имел реальный баг коллизии имен. Исправлен в текущем проходе.

8. В `packages/server/src/routes/rows.ts` есть подозрительный дефект activity-фильтра: фильтр смотрит `(r as any).programName`, но `processedRows` не возвращает `programName` из колонки E. Это может ломать `current_program/current_non_program` на `/api/rows/:deptId`.

9. `dataset-signals.ts` содержит behavioral anomalies по `previousRows`, но в продукте это пока выглядит как недоведенная snapshot-comparison фича, а не законченный user-facing сценарий.

10. `services/pipeline.ts` выглядит как параллельный/мертвый pipeline относительно `services/snapshot.ts` и `core/orchestrator`. Его надо либо удалить, либо переоформить как официальный путь.

## Расширенный продуктовый план

### P0. Source Governance

Сделать `Source Registry` как runtime-объект:

- `sourceId`, `driveId`, `name`, `role`, `mode`, `owner`, `expectedSheets`, `loadedSheets`, `rowCount`, `formulaCount`, `commentCount`, `modifiedTime`, `cacheAge`, `lastSuccess`, `lastError`.
- `mode`: production, mirror, demo, archive, prototype, report, forbidden.
- Запрет archive/prototype/report в production не только тестом, но runtime validation.
- Source change: pending -> validate shape -> compare against known profile -> approve -> audit.
- UI source health strip на первом экране и в Settings.

### P0. Metric Contract

Для каждой KPI:

- key, label, business meaning, source columns/cells, formula, gate, filters, numerator/denominator, row count, freshness, source mode.
- `savings_pct` переименовать/объяснить как `spent_pct` или оставить legacy key только как alias.
- Сверить `REPORT_MAP`, `METRICS_CONTRACT.md`, UI labels и core formulas.
- Acceptance: UI, docs и расчет не могут разойтись без failing test.

### P0. Фильтры как продуктовая система

Сделать один `FilterContext` в shared/core:

- years/months/dateRange/weekStart/weekEnd;
- procurement methods: КП, ЕП, детальные ЭА/ЭК/ЭЗК;
- activity: ПМ, ТД в рамках ПМ, ТД вне ПМ;
- budgets: ФБ/КБ/МБ/итого;
- ГРБС, подведы, dept-only;
- source mode;
- snapshotFrom/snapshotTo.

Критично:

- week mode должен быть точным `[weekStart, weekEnd]`, а не набором месяцев;
- фильтры должны применяться одинаково в dashboard/economy/reconciliation/issues/journal/registry/export;
- dept-only должен реально исключать subordinate rows во всех агрегациях, а не только ставить `_deptOnly`;
- фильтрация должна жить в shared/server pure functions с fixture matrix, а web должен в основном отображать.

### P0. ГРБС -> управление -> подведы

Сделать управляемую организационную модель:

- canonical department registry из `department-registry.ts`;
- subordinate registry, извлеченный из колонки C и subordinate tabs;
- aliases/normalization для NBSP, пробелов, кавычек, сокращений;
- статусы org-unit: active, stale, hidden, archived, unknown;
- покрытие: сколько строк каждого подведа загружено, из какого листа, с какими сигналами.

В UI:

- org tree с режимами “все управление”, “только управление”, “выбранные подведы”;
- объяснение выбранного фильтра;
- сохраненные filter presets для совещаний.

### P0. Weekly Filters и отчеты

Вернуть смысл старого недельного генератора в продукт:

- week selector должен работать по датам строк и snapshot timeline;
- weekly report pack должен выгружать состояние, дельты, замечания, доказательства;
- сравнить текущие weekly UX с документами из `Генератор Отчетов` и `ОТЧЕТЫ`;
- определить, что является weekly truth: дата плана N, дата факта Q, дата изменения source, дата snapshot или управленческий отчетный период.

Без этого “недельные фильтры” будут визуальным переключателем, а не управленческим инструментом.

### P0. Snapshot Comparison по изменениям Google Sheets

Сделать отдельную систему `SourceSnapshot`/`TableDiff`:

- snapshot хранит per-source/per-sheet digest: row count, non-empty count, formula digest, comment count, modifiedTime, loaded range;
- diff показывает changed sheets, changed rows, changed cells, formula changes, comment changes;
- metric diff связывает изменение KPI с изменившимися строками/листами;
- UI: “почему изменилась цифра с прошлого снимка?”;
- datasource: live Google modifiedTime + собственный normalized row hash.

Acceptance: пользователь видит не только `metric_history`, а конкретные изменения таблиц, которые сдвинули KPI.

### P0. Registry как Google Sheets 2.0

Реестр должен быть не просто таблицей строк, а продуктовым рабочим местом:

- просмотр строк с колонками A:AG, формулами, comments, validations, hidden-row status;
- cell drawer: source, formula/value, old/new, comments, row signals, linked KPI, edit history;
- inline edit только для разрешенных колонок;
- draft changes, batch review, approve/reject, reason;
- audit: actor, request id, old value, new value, source cell, snapshot before/after;
- undo/rollback или compensating edit.

Редактирование должно быть не “форма пишет в Google Sheets”, а управляемый data operation.

### P0. Control Hub

Сигналы, замечания, доверие, сверка, рекомендации и журнал надо собрать в один понятный hub:

- `Check`: правило/сигнал/сверка/метрика доверия.
- `Finding`: конкретное обнаружение с severity/status/owner/deadline.
- `Evidence`: строки, ячейки, формулы, sources, snapshot ids.
- `Recommendation`: что сделать и почему.
- `AuditEvent`: кто что поменял.

Текущие вкладки `trust/recon/issues/recs/journal` уже хороший черновик, но нужна общая таксономия и навигация “проблема -> доказательство -> действие -> история”.

### P1. 44-ФЗ и антикоррупционный модуль

Архивная документация описывает больше, чем текущий dashboard гарантированно показывает:

- модуль 44-ФЗ;
- антикоррупционные признаки;
- risk maps;
- decision engine.

Нужно сделать matrix: документированное правило -> код -> тест -> UI -> evidence. Все, что не реализовано, пометить как backlog, а не оставлять в docs как будто оно уже есть.

### P1. Reports / Meeting Pack

Старый Apps Script-генератор не мертвый, он хранит требования к отчетам:

- weekly procurement report;
- smart/template modes;
- fallback generation;
- `РАСЧЕТ`, `КОНТЕКСТ`, `ИСТОРИЯ`;
- документы для совещаний.

В новом продукте это лучше делать не как Apps Script, а как export pack из приложения: PDF/DOCX/CSV/JSON, включающий KPI, source health, filters, deltas, issues, evidence links.

### P1. Typed API и frontend quality

- Закрыть DTO `DashboardData` без `any`.
- Убрать `fetchJSON<any>` на ключевых endpoints.
- Перенести критичные фильтры/агрегации из web hook в shared/server.
- Разбить большие файлы: `useFilteredData.ts`, `Recon.tsx`, `index.css`.
- Route-level code splitting для web chunk.
- E2E/visual smoke для registry, dashboard, economy, control hub, source health.

### P1. Operations

- Health должен проверять не только процесс, но source coverage/freshness/demo mode.
- Backup/restore SQLite/config.
- Runtime runbook для source errors, Google permissions, stale cache, failed writes.
- CORS/security headers/auth roles.

## Dead code и unfinished features

Предварительная классификация:

- Реальный dead/parallel code: `packages/server/src/services/pipeline.ts`, если он не импортируется и дублирует `snapshot.ts`/core orchestrator.
- Не dead, а legacy spec: Apps Script generator, DOCX reports, architecture GraphML/BPMN, 9 module passports.
- Не dead, а unfinished feature: `dataset-signals.ts` behavioral comparison по `previousRows`.
- Не dead, а unexecuted acceptance layer: `.feature` сценарии.
- Archive/prototype sources: `СВОД -25-26`, `Архитектура`, EIS exports, old copies. Их нельзя подключать в prod, но они нужны для source archaeology and regression fixtures.
- Уже удаленный код нужно проверять отдельным tombstone-pass по `git log`, старым sessions и diff history. По текущим данным большая часть “удаленного” вокруг генератора отчетов похожа не на мусор, а на недоперенесенные продуктовые требования.

## Переписывать ли с нуля

Нет, полный rewrite сейчас был бы хуже.

Причины:

- В коде уже закодированы важные доменные правила: `AD=да`, `Q <> X/Х/blank`, method split, row geometry `СВОД`/`ШДЮ`, registry 8 ГРБС.
- Есть тесты, source contracts, SHDYU/reconciliation/trust groundwork.
- Риск rewrite — потерять spreadsheet quirks, накопленные edge cases и уже исправленные расхождения.

Что стоит переделать радикально:

- filter engine;
- source governance;
- registry/editor product model;
- control hub taxonomy;
- snapshot diff;
- API DTO contracts;
- UI information architecture around “доверие к цифрам”.

Оптимальная стратегия — strangler refactor: оставить core invariants и тесты, вынести новые shared/server контракты, постепенно переводить UI и endpoints на них, после чего удалить параллельные пути.

## Оценка текущего продукта

Как технический MLP: примерно 6.5/10. Он уже работает, читает данные, считает, показывает, тестируется.

Как управленческий продукт доверия: примерно 4.5/10. Главный экран и ключевые метрики еще не всегда объясняют источник, фильтр, fallback, row count и причину изменения.

Как база для сильного продукта: 8/10. Доменное ядро и корпус исходников богатые; переписывать с нуля не нужно, нужно жестко канонизировать данные и убрать двусмысленность.

## Ближайший максимум работ

1. Зафиксировать `Source Registry` и runtime запрет archive/demo/fallback без явного UI.
2. Вынести `FilterContext` и одну матрицу filter parity.
3. Исправить подозрительный `programName` bug в `/api/rows/:deptId`.
4. Сделать `SourceSnapshot`/`TableDiff` дизайн и fixture из текущего архива.
5. Описать old generator capability matrix: docs/spec -> current code -> missing.
6. Спроектировать Registry 2.0 и Control Hub как единый продуктовый слой.
7. Запустить отдельный dead-code/tombstone audit по `git log` и sessions.
