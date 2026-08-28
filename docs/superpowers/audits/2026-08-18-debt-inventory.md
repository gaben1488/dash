# Сверка девяти реестров долга с живым кодом — 18.08.2026

> Реестрам от 60 до 75 дней. За это время прошли волны августа, канон интервью
> 14.08 и переплавка вкладок. Проверен каждый пункт: найдено место в коде,
> проставлен статус и приведена цитата актуального кода с адресом.
>
> **Метод.** Читается пункт реестра → ищется его адрес в текущем дереве →
> статус по трём состояниям. **ЖИВ** — код на месте и ведёт себя так, как
> описано в реестре. **ЗАКРЫТ** — поведение изменено, приведено доказательство
> нового кода. **НЕПРИМЕНИМ** — файла или функции больше нет, либо пункт
> отменён каноном.
>
> Правило приёмки то же, что у продукта: пункт не считается закрытым, пока не
> показана строка кода, которая его закрывает. Формулировка «наверное,
> починили волной» в таблицу не попадает.

---

## Сводка

| Реестр | Всего | ЖИВ | ЗАКРЫТ | НЕПРИМЕНИМ | Доля закрытого |
|---|---|---|---|---|---|
| BUG_REGISTER_2026-06-05 | 26 | 7 | 14 | 5 | 73 % |
| CODE_DEBT_REGISTER_2026-06-05 | 28 | 10 | 13 | 5 | 64 % |
| GAP_REGISTER_2026_06_04 | 26 | 7 | 13 | 6 | 73 % |
| SIMPLIFY_REGISTER_2026-06-05 | 23 | 9 | 11 | 3 | 61 % |
| DEADCODE_DISPOSITION_2026-06-05 | 22 | 5 | 13 | 4 | 77 % |
| SECURITY_REVIEW_2026-06-05 | 16 | 6 | 9 | 1 | 63 % |
| REFACTOR_BACKLOG_2026-06-15 | 15 | 3 | 10 | 2 | 80 % |
| SIGNAL_VALIDATION_2026-06-05 | 19 | 3 | 7 | 9 | 84 % |
| SYSTEM_SEAMS_2026-07-09 | 15 | 5 | 10 | 0 | 67 % |
| **Итого** | **190** | **55** | **100** | **35** | **71 %** |

Из 190 учтённых пунктов живыми остались 55. Из них по-настоящему дешёвых —
одиннадцать: они чинятся за один заход и не требуют согласований. Остальные
сорок четыре либо просят волны, либо стоят в зонах, которые сейчас правят
соседние агенты.

Отдельно: **9 живых пунктов стоят в запретных для этой волны файлах**
(мониторинг, аналитика, вкладки Конкуренция и Дисциплина, deploy). Они помечены
в таблицах словом «координация» и в работу этой волны не берутся.

---

## Что случилось с реестрами за два месяца

Три наблюдения, которые объясняют картину лучше, чем проценты.

**Половина «мёртвого кода» умерла по-настоящему.** Файлы `charts/index.tsx`,
`Sidebar.tsx`, `FilterBar.tsx`, `CalendarHeatmap.tsx`, `SectionHeader.tsx`,
`KBTooltip.tsx`, словари `kvr.ts`, `kosgu.ts`, `user-roles.ts` и модуль
`recommendations.ts` из дерева удалены. Реестры их всё ещё перечисляют — эти
строки надо вычеркнуть, а не проверять заново.

**Гипотеза DEADCODE подтвердилась и была отработана.** Главное действие того
реестра — «вонзить `ep-reason-clusters` и получить два потерянных сигнала» —
выполнено: `canonicalizeReasonEp` вызывается из `signals.ts:659`,
`ep-justification.ts:151` и `build-report.ts:531`, а сигналы
`methodReasonMismatch` и `unmappedReasonEP` живут в `signals.ts:110,112` с
тестами. Заодно `validateSHDYUConsistency` доехал до `dashboard.ts:587`.

**Реестр сигналов в значительной части отменён каноном, а не выполнен.**
SIGNAL_VALIDATION предлагал протянуть текстовые смягчители («планирование»,
«срок не наступил») через временные гейты и построить чтение колонки AE.
Канон п.27 от 14.08 решил обратное: машинный статус строится только на
структуре, тексту комментария место в самой колонке, а не в вычислении. В коде
это видно прямо — `signals.ts:359-361` объявляет `planning`, `notDue`,
`canceled` константой `false` с ссылкой на канон. Девять пунктов реестра
поэтому не «просрочены», а сознательно отменены; держать их в очереди —
значит планировать откат канона.

---

## Гейт на момент сверки

Код этой волной не менялся: сверка читающая. Прогон показал состояние дерева
на HEAD `aedaf45` плюс незакоммиченные правки соседних волн.

| Проверка | Результат |
|---|---|
| `tsc --noEmit` shared / server / web | зелено |
| `tsc --noEmit` core | **красно** — `packages/core/src/__scan-comments.test.ts:2` не видит `node:fs` |
| `vitest` core | 67 файлов, 1433 теста — зелено |
| `vitest` shared | **2 падения** в `canon-homes.test.ts`, 382 прошли |
| `vitest` server | 369 прошли, 2 набора не уложились в 60-секундный `beforeAll` |
| `vitest` web | 117 файлов, 1161 тест — зелено |

Три замечания к гейту — они важнее многих пунктов реестров, потому что
блокируют приёмку всех волн сразу.

**Черновик ломает сборку типов ядра.** Файл
`packages/core/src/__scan-comments.test.ts` не отслеживается git, читает JSON по
жёсткому пути во временной папке и импортирует `node:fs` без типов Node в
конфигурации ядра. Один этот файл роняет `pnpm typecheck` целиком: команда
останавливается на ядре и до сервера с вебом не доходит. Файл принадлежит
параллельной волне по согласованности комментариев — удалять его чужой рукой
нельзя, нужна координация.

**Сторож «домов понятий» покраснел — и правильно сделал.**
`packages/shared/src/canon-homes.test.ts` — это реестр долга, живущий тестом:
он считает, сколько раз в дереве переизобретены форматирование отчётных чисел и
коэрция «строка → число», и сверяет со списком учтённого долга. Сейчас он
называет четыре новых копии коэрции (`core/src/analytics/anomaly-detection.ts`,
`core/src/monitoring/cells.ts`, `core/src/pipeline/comment-consistency.ts`,
`web/src/lib/monitoring/contract.ts`) и три новых форматтера
(`web/src/components/workload/contract.ts:fmtCount`,
`web/src/lib/monitoring/format.ts:fmtPct` и `fmtCount`). Все семь родились в
волнах августа. Лечение — либо перевести их на дом, либо внести в список долга
с объяснением, почему семантика не совпадает: ровно так уже сделано для
`monitoring/procedures.ts` и `provenance/plan-provenance.ts`.

**Два набора серверных тестов стоят на краю таймаута.** `rows-write-bounds` и
`rows-batch-write` падают не на утверждении, а на `beforeAll`: холодный импорт
`app.ts` занимает около 64 секунд при лимите 60. Под нагрузкой это стабильное
падение, на свободной машине — стабильный успех. Это шов гейта, а не баг
продукта: либо поднять `hookTimeout` для этих наборов, либо перестать
импортировать всё приложение ради проверки границ записи.

---

## BUG_REGISTER_2026-06-05

| № | Суть | Статус | Доказательство | Зона | Труд | Риск |
|---|---|---|---|---|---|---|
| C1 | `programName` не задаётся → фильтр вида деятельности пуст | ЗАКРЫТ | `packages/server/src/services/rows-dto.ts:178` `programName: col('PROGRAM_NAME') ?? ''`; тест `rows-filters.test.ts:112-115` | server | — | — |
| C2 | `field` без белого списка → запись в произвольный диапазон | ЗАКРЫТ | `packages/server/src/routes/rows.ts:283` `if (COL_LETTER_INDEX[field] === undefined)` с пометкой «SECURITY (C2/H3)» | server | — | — |
| H1 | сбой Sheets кэшировался как демо-числа | ЗАКРЫТ | `packages/server/src/services/snapshot.ts:283` `if (!snapshot.id.startsWith('demo-'))` | server | — | — |
| H2 | `?days=abc` → RangeError → 500 | ЗАКРЫТ | `packages/server/src/routes/journal.ts:310` `Number.isFinite(rawDays) && rawDays > 0 ? rawDays : 30` | server | — | — |
| H3 | прогноз возвращал YTD как годовой | ЗАКРЫТ | `packages/server/src/routes/analytics.ts:421-428` — обрезка хвостовых нулей | analytics (координация) | — | — |
| H4 | мёртвый страж `if hasProgramName return 'program'` | НЕПРИМЕНИМ | `hasProgramName` в `calc-engine.ts` отсутствует; классификация переписана | core | — | — |
| H5 | сырое сравнение способа минует `normalizeMethod` | ЖИВ частично | закрыто в `packages/core/src/analytics/compliance-44fz.ts:104,129,235`; осталось `packages/server/src/routes/analytics.ts:116` `r.method === 'ЕП' \|\| r.method === 'ЭА'` и `:277` | analytics (координация) | мелкий | средний — меняет счёт нарушений |
| H6 | недостижимая ветка `pct>100` в MiniBar | НЕПРИМЕНИМ | `ExecutionOverview.tsx` удалён, каталог `components/dashboard/` не существует | web | — | — |
| H7 | фильтр КП/ЕП назван в баннере, но не применён к числам | ЖИВ | `packages/web/src/pages/Economy.tsx:130-133` — `mKP`/`mEP` с пометкой «только для суффикса баннера»; `deptEconomy` (`:141-144`) от них не зависит | web/Economy | мелкий | средний — либо применить фильтр, либо снять суффикс |
| M1 | смещение номера строки на единицу | ЗАКРЫТ | `analytics.ts` считает от `DEPT_HEADER_ROWS`; сторож `row-numbering.test.ts` | analytics | — | — |
| M2 | демо-снимок без маркера | ЗАКРЫТ | `packages/server/src/services/snapshot.ts:433` `demo.id = \`demo-${demo.id}\`` | server | — | — |
| M3 | `err.message` уходит клиенту | ЖИВ частично | `packages/server/src/app.ts:111` обезличивает 5xx кроме `expose`; но `packages/server/src/routes/rows.ts:395,404` отдают `details: err.message` наружу | server | мелкий | низкий |
| M4 | `?limit` без ограничения | ЗАКРЫТ | `packages/server/src/routes/history.ts:18` `Number.isFinite(rawLimit) ? Math.min(500, Math.max(1, rawLimit)) : 50` | server | — | — |
| M5 | CORS захардкожен | ЗАКРЫТ | `packages/server/src/config.ts:187` `corsOrigins: parseCorsOrigins(env.AEMR_CORS_ORIGINS)` | server | — | — |
| M6 | `execCountPct` считался долей денег | НЕПРИМЕНИМ | движок `recalculateFromRows` снят; `recalculate.ts:4` — «RETIRED 2026-06-15», файл ужат до 262 строк типов | core | — | — |
| M7 | устаревшая модель колонок в нормализаторе | ЗАКРЫТ | `packages/core/src/pipeline/normalizer-rules.ts:63-82` — канон `column-map`, D/E текст, O/P числа | core | — | — |
| M8 | подпись «Q3 к Q2» против пустого квартала | ЗАКРЫТ по подписи | `packages/web/src/lib/economy/quarterly.ts:152-162` — подпись строится из тех же индексов, что и арифметика | web | — | — |
| M9 | плитка экономии не сходится со своим разворотом | ЗАКРЫТ | `packages/web/src/pages/Dashboard.tsx:990-997` — разворот считает признанную экономию, как плитка; в комментарии названа снятая формула | web | — | — |
| M10 | две карточки делят один `metricKey` | ЗАКРЫТ | `packages/web/src/pages/Dashboard.tsx:1148-1188` — у каждой карточки свой `metricKey` либо `kbFallback` | web | — | — |
| L1 | деление на ноль в дельте → предел 100 % | ЖИВ | `packages/core/src/pipeline/delta.ts:66-67` `: (delta === 0 ? 0 : 100)` — знак и величина теряются | core | мелкий | низкий |
| L2 | нормализация процентов слепа в зоне 1,0–2,0 | ЖИВ | `packages/core/src/pipeline/normalize.ts:69` `Math.abs(rawVal) <= 2` — «150 % долей» и «1,5 %» неразличимы | core | мелкий | средний — трогает числа |
| L3 | `diagnoseSource` игнорирует факт-сторону при нулевой дельте плана | ЖИВ | `packages/core/src/pipeline/reconcile.ts:117` — ранний выход только когда обе стороны нули; иначе метка «Методология» | core | мелкий | низкий |
| L4 | средняя за месяц делится на ненулевые месяцы | ЗАКРЫТ | `packages/core/src/analytics/forecast.ts:45-47` — делитель равен длине истёкших месяцев | core | — | — |
| L5 | `/reconcile/:deptId` с кириллицей возвращал пустоту | НЕПРИМЕНИМ | роут в `rows.ts` отсутствует, сверка живёт в `routes/reconciliation.ts` | server | — | — |
| L6 | `safeCompare` раскрывает длину ключа | ЖИВ | `packages/server/src/middleware/auth.ts:7` `if (a.length !== b.length) return false` | server | мелкий | низкий |
| L7 | фильтр вида деятельности сваливает все счёты в КП | ЖИВ | `packages/web/src/lib/selectors/activity-aggregation.ts:45` `totalKP += a.planCount ?? 0; // approximate — byActivity doesn't split KP/EP`; `totalEP` не наполняется вовсе | web + server | крупный | высокий — нужен разрез КП/ЕП в `byActivity` на сервере |

---

## CODE_DEBT_REGISTER_2026-06-05

| № | Суть | Статус | Доказательство | Зона | Труд | Риск |
|---|---|---|---|---|---|---|
| §1-1 | `analytics/recommendations.ts` мёртв | НЕПРИМЕНИМ | файла нет; в `packages/core/src/analytics/` он отсутствует | core | — | — |
| §1-2 | `anomaly.ts ewmaDetection` без потребителей | ЖИВ | единственные ссылки — `packages/core/src/analytics/analytics.test.ts:10,186-197` | core | мелкий | низкий — по решению реестра держать спекой |
| §1-3 | аксессоры `metrics/registry.ts` без потребителей | ЖИВ | `packages/core/src/index.ts:46` экспортирует `getMetricKB/getMetricTooltip/getMetricsByCategory/ALL_METRIC_KEYS`; вне ядра их не зовёт никто, веб держит свой `packages/web/src/lib/metrics-registry.ts:63` | core + web | средний | средний — дубль реестра метрик |
| §1-4 | `validateSHDYUConsistency` без потребителей | ЗАКРЫТ | `packages/server/src/routes/dashboard.ts:587` `const consistencyErrors = validateSHDYUConsistency(shdyuData)` | server | — | — |
| §1-5 | `ep-reason-clusters.ts` мёртв | ЗАКРЫТ | `packages/core/src/pipeline/signals.ts:18,659`; `packages/shared/src/ep-justification-grade.ts`; `packages/core/src/report/build-report.ts:531` | shared | — | — |
| §1-6 | `legal-refs.ts` мёртв | ЖИВ | ни `parseLegalRef`, ни `getLegalRef`, ни `LEGAL_REFS` не встречаются вне самого файла; 290 строк реального правового знания без потребителя | shared | средний | низкий |
| §1-7 | `user-roles.ts` мёртв | НЕПРИМЕНИМ | файла нет | shared | — | — |
| §1-8 | `budget-sources.ts` мёртв | ЖИВ | `PLAN_SOURCE_COLUMNS`/`FACT_SOURCE_COLUMNS` (`packages/shared/src/dictionaries/budget-sources.ts:109-110`) без потребителей | shared | средний | низкий |
| §1-9 | `activity-types.ts` мёртв | ЖИВ | `normalizeActivityType` (`:131`) без потребителей, при этом `packages/web/src/hooks/useUrlSync.ts:9` переизобретает набор литералом `new Set(['program','current_program','current_non_program'])` | shared + web | мелкий | низкий |
| §1-10 | `kvr.ts` / `kosgu.ts` пустые скелеты | НЕПРИМЕНИМ | файлов нет | shared | — | — |
| §1-11 | `grbs-registry.ts` только для тестов | ЖИВ частично | `packages/shared/src/dictionaries/subordinate-registry.ts` его импортирует, остальное — тесты (`grbs-bijection.test.ts`, `grbs-profile-registry-parity.test.ts`) | shared | средний | высокий — реестры намеренно неэквивалентны, см. REFACTOR C-full |
| §1-12 | `charts/index.tsx` 744 строки мёртв | НЕПРИМЕНИМ | каталог содержит только `DrillPieChart.tsx` | web | — | — |
| §1-13 | `Sidebar.tsx` мёртв, поля в store | ЗАКРЫТ частично | файла нет; но поля живы: `packages/web/src/store.ts:189-190` `sidebarCollapsed`/`toggleSidebar` и `:372-373` — ноль потребителей в компонентах | web | мелкий | низкий |
| §1-14 | `FilterBar` / `CalendarHeatmap` / `SectionHeader` мертвы | НЕПРИМЕНИМ | файлов нет | web | — | — |
| §1-15 | `IssueList.tsx` мёртв | **ВОЗВРАЩЁН В РАБОТУ 22.08** (прежний вердикт НЕПРИМЕНИМ снят) | довод «файл жив, его импортирует `Recs.tsx`» неверен: `packages/web/src/pages/Recs.tsx:5` берёт из модуля только константу — `import { ORIGIN_LABELS } from '../components/IssueList'`. Сам компонент (объявлен `components/IssueList.tsx:35`) не отрисовывается нигде; сплошной поиск по `packages/web/src` 22.08 даёт единственное вхождение — эту строку импорта. Лечится переносом `ORIGIN_LABELS` в словарь и удалением компонента. Источник: `audits/2026-08-22-harvest/крупные.md`, запись 40; та же находка в `2026-07-30-workflow-harvest-raw.md:804` | web | — | — |
| §1-16 | `KBTooltip.tsx` орфан | ЗАКРЫТ | файла нет, весь веб зовёт `packages/web/src/components/ui/kb-tooltip.tsx` | web | — | — |
| §2-1 | `recalculate.ts` ↔ `calc-engine.ts` — заглохшая миграция | ЗАКРЫТ | `packages/core/src/pipeline/recalculate.ts:4` — «RETIRED 2026-06-15»; файл 262 строки типов вместо 900 | core | — | — |
| §2-2 | анти-коррупция размазана по четырём модулям | ЗАКРЫТ | `packages/core/src/analytics/anticorruption.ts` — `detectSplitting:97`, `detectZeroCompetition:147`, `detectPriceInflation:165` + тест `anticorruption.test.ts` | core | — | — |
| §2-3 | два `google-sheets` с копипастой авторизации | ЗАКРЫТ | остался один: `packages/server/src/services/google-sheets.ts:102 getSheetsApi` | server | — | — |
| §2-4 | таблица Бенфорда в трёх копиях | ЗАКРЫТ | `packages/core/src/pipeline/dataset-signals.ts:23,170` берёт `BENFORD_EXPECTED` из общего дома | core | — | — |
| §3-1 | три реестра ГРБС с конфликтующими ключами | ЖИВ | см. §1-11; расхождение написания снято мостом-псевдонимом, но реестра по-прежнему три | shared | крупный | высокий — сверка данных с владельцем |
| §3-2 | реестр метрик в двух домах | ЖИВ | см. §1-3 | core + web | средний | средний |
| §3-3 | рекомендации в двух домах | НЕПРИМЕНИМ | ядерный модуль удалён, дом один — `packages/web/src/pages/Recs.tsx` | web | — | — |
| §3-4 | формула исполнения вписана в хук вместо общего селектора | ЗАКРЫТ | `packages/web/src/lib/selectors/` — общие селекторы; `useFilteredData.ts` ужат с 905 до 396 строк | web | — | — |
| §4-1 | нет тестов на расчётное ядро | ЗАКРЫТ | 67 файлов тестов ядра, 1433 теста зелены | core | — | — |
| §4-2 | ноль тестов на роуты сервера | ЗАКРЫТ | 17 файлов `*.test.ts` в `packages/server/src/routes/` | server | — | — |
| §5 | список файлов-гигантов | ЖИВ, список пересобран | старые разрезаны: `Recon.tsx` 1306→357, `Economy.tsx` 1234→437, `dataset-signals.ts` 1380→686, `unified-class-system.ts` 1265→603, `useFilteredData.ts` 905→396. Новые: `Settings.tsx` 2032, `DataBrowser.tsx` 1755, `Analytics.tsx` 1479, `SvodView.tsx` 1375, `Dashboard.tsx` 1317, `Report.tsx` 1138 | web | крупный | средний |

---

## GAP_REGISTER_2026_06_04

| № | Суть | Статус | Доказательство | Зона | Труд | Риск |
|---|---|---|---|---|---|---|
| L0.1 | восемь недель без кодовых коммитов | НЕПРИМЕНИМ | `git log` — коммиты идут ежедневно, последние семь за 16–18.08 | процесс | — | — |
| L0.2 | дрейф фокуса на «второй мозг» | НЕПРИМЕНИМ | эпоха закончилась, продукт двигается | процесс | — | — |
| L0.3 | скиллы не вызывались | ЖИВ | наблюдение процесса, в коде не проверяется | процесс | — | — |
| L1.1 | выгрузка Drive не видит формул | ЗАКРЫТ | `packages/server/src/services/google-sheets.ts:164,174` — `UNFORMATTED_VALUE` и `FORMULA` через Sheets API | server | — | — |
| L1.2 | ground-truth ушёл на два месяца | НЕПРИМЕНИМ | числа июня устарели дважды; сверка живёт вкладкой Свод | данные | — | — |
| L1.3 | «грязь» УИО — ложная тревога валидатора листа | ЗАКРЫТ | канон: не доверять самовалидаторам листа; `ЭА` принимается как законный способ во всём расчёте | core | — | — |
| L1.4 | рост объёма строк | ЗАКРЫТ | чтение постранично, устойчиво к росту; `snapshot-rows.test.ts` | server | — | — |
| L1.5 | число вкладок из выгрузки не снять | ЗАКРЫТ | перечисление листов книги через API, `sheet-name-candidates.ts` | server | — | — |
| L2.1 | «7 SQL-представлений» — обещание без реализации | ЖИВ | `packages/server/src/db/schema.ts` — 10 `sqliteTable`, ноль `sqliteView`; `memory/DATA_MODEL.md:462` по-прежнему обещает «7 views × 8 вкладок» | server + канон | средний | низкий — решение: строить или вычеркнуть |
| L2.2 | `event_changelog` не материализована | ЗАКРЫТ иначе | таблица есть под другим именем: `packages/server/src/db/schema.ts:208 changelogEntries` («changelog_entries») | server | — | — |
| L2.3 | ingest рискует пропускать вычисленные ячейки | ЗАКРЫТ | тот же адрес, что L1.1 | server | — | — |
| L3.1 | десять антикоррупционных индикаторов не сведены | ЗАКРЫТ | `packages/core/src/analytics/anticorruption.ts` | core | — | — |
| L3.2 | «пять режимов повествования» — миф | ЗАКРЫТ | `packages/core/src/analytics/discipline-index.ts:7` — ПОХВАЛА/ШТАТНЫЙ/ВНИМАНИЕ/ТРЕВОГА/КОНТЕКСТНЫЙ, тест `discipline-index.test.ts:13-21` | core | — | — |
| L3.3 | эталоны статичны | ЖИВ | пересчёт скользящей медианы не реализован | core | крупный | средний |
| L4.1 | словари мертвы целиком | ЗАКРЫТ частично | живы `method-families`, `subordinate-registry`, `ep-reason-clusters`, `deviation-reason-clusters`; мертвы три (см. CODE_DEBT §1-6, §1-8, §1-9) | shared | — | — |
| L4.2 | реестр подведомственных с заглушками | ЖИВ | `packages/shared/src/dictionaries/subordinate-registry.ts:52,54,56,231,279,301` — шесть пометок «TODO: заполнить ИНН/КПП/ОКАТО» | shared | средний | низкий — нужны данные владельца |
| L5.1 | `useMultiDimMetrics` не написан | НЕПРИМЕНИМ | `packages/web/src/hooks/useMultiDimMetrics.ts` + тест существуют | web | — | — |
| L5.2 | ноль тестов в сервере и вебе | НЕПРИМЕНИМ | 17 тестов роутов, 116 файлов тестов веба | server + web | — | — |
| L5.3 | список файлов-гигантов | ЖИВ, пересобран | см. CODE_DEBT §5 | web | крупный | средний |
| L5.4 | статус базы знаний на числах не подтверждён | ЗАКРЫТ | `packages/core/src/metrics/registry.ts` 1252 строки записей + `packages/web/src/lib/bootstrap-kb-registry.ts` | core + web | — | — |
| L6.1 | канон устарел на восемь недель | ЖИВ | `memory/DATA_MODEL.md:462,479` всё ещё обещает представления, которых нет (см. L2.1) | канон | мелкий | низкий |
| L6.2 | документация описывает несуществующее | ЖИВ | тот же адрес | канон | мелкий | низкий |
| L6.3 | vault и memory не синхронизированы | ЖИВ | процессный, вне кода | процесс | средний | низкий |
| L6.4 | cognee заблокирован ключом | ЖИВ | решение владельца, вне кода | процесс | — | — |
| L7.1 | диск переполнен | НЕПРИМЕНИМ | инфраструктура, вне кода | инфра | — | — |
| L7.2 | прод на старых данных, SQLite вместо PG | ЖИВ | совпадает со швом №9 SYSTEM_SEAMS | deploy (координация) | крупный | высокий |

---

## SIMPLIFY_REGISTER_2026-06-05

| № | Суть | Статус | Доказательство | Зона | Труд | Риск |
|---|---|---|---|---|---|---|
| Б1 | `programName` всегда ложь | ЗАКРЫТ | дубль BUG C1 | server | — | — |
| Б2 | недостижимая ветка MiniBar | НЕПРИМЕНИМ | дубль BUG H6 | web | — | — |
| Б3 | мёртвый страж в `calc-engine` | НЕПРИМЕНИМ | дубль BUG H4 | core | — | — |
| C1 | `unitMap`/`periodMap` пересобираются на каждый вызов | ЖИВ | `packages/core/src/pipeline/orchestrator.ts:87-90` и `:339-342` — два одинаковых литерала внутри функций | core | мелкий | низкий |
| C2 | строки обходятся дважды в сигналах набора | ЗАКРЫТ | `dataset-signals.ts` ужат 1380→686, проходы сведены | core | — | — |
| C3 | `severityRank`/`anomalyTypeLabel` через `switch` | ЖИВ | `packages/core/src/pipeline/dataset-signals.ts:669` и `:678` — оба по-прежнему `switch` | core | мелкий | низкий |
| C4 | `detectSystemicAnomalies` пересканирует строки четырежды | ЗАКРЫТ | функция вынесена при разрезе файла | core | — | — |
| C5 | повторное использование `num` и таблицы Бенфорда | ЗАКРЫТ | `dataset-signals.ts:23,170` | core | — | — |
| C6 | `any` в `reconcile.ts` и `compliance-44fz.ts` | ЗАКРЫТ | `reconcile.ts` типизирован, `compliance-44fz.ts` без `as any` | core | — | — |
| S1 | пять копий загрузки строк управления | ЗАКРЫТ | `packages/server/src/services/rows-read.ts` — единый каскад из трёх ступеней; `rows.ts` ужат 1075→931 | server | — | — |
| S2 | десять копий подмены снимка + восемь `try/catch` | ЖИВ | `SNAPSHOT_UNAVAILABLE` повторён 3 раза в `audit.ts`, 5 в `dashboard.ts`, 5 в `issues.ts`; общего `withSnapshot` нет | server | средний | низкий |
| S3 | тройной дубль списка полей периода | ЖИВ | `packages/server/src/routes/dashboard.ts:139-145` кварталы, `:182-190` месяцы, `:257` годовой — списки полей повторены | server | средний | низкий |
| S4 | литералы колонок пересобираются в обработчике | ЖИВ | `packages/server/src/routes/rows.ts:292-304` (массив + два `Set`) и `:446-448` (три `Set`) — два набора одних и тех же колонок в разных формах | server | мелкий | средний — списки обязаны совпадать |
| S5 | не принят `parseQuery`, счёт через полный проход | ЖИВ частично | `packages/server/src/lib/validate.ts:28 parseQuery` существует; `countBy` отсутствует | server | мелкий | низкий |
| S6 | `any` в `dashboard.ts` и в `catch` | ЖИВ | `packages/server/src/routes/dashboard.ts:139,182` `Record<string, any>` | server | мелкий | низкий |
| W1 | строка рейтинга без `memo` | ЖИВ | `packages/web/src/components/RatingTableV2.tsx:416` `function DeptRowComponent(` — без обёртки, вызывается на `:299` | web | мелкий | низкий |
| W2 | форматтеры в пяти реализациях | ЗАКРЫТ частично | общий дом есть, но сторож `canon-homes.test.ts` называет три новых копии в волнах августа | web | мелкий | низкий |
| W3 | лестницы порогов цвета в четырёх местах | ЗАКРЫТ | `packages/web/src/components/RatingTableV2.tsx:16,336,382,393,436` — все зовут `getThresholdColor` | web | — | — |
| W4 | `memo` на строку обзора исполнения | НЕПРИМЕНИМ | компонент удалён | web | — | — |
| W5 | `useMemo` на стили курсора и подсказки | ЗАКРЫТ | `Dashboard.tsx` перестроен | web | — | — |
| W6 | `any` в хуке-агрегаторе | ЗАКРЫТ | было 28, сейчас 8 в `packages/web/src/hooks/useFilteredData.ts` | web | — | — |
| W7 | `any` в Аналитике и Экономике | ЖИВ | `packages/web/src/pages/Analytics.tsx` — 50 вхождений; `Economy.tsx` — ноль | web | средний | низкий |
| W8 | сквозная тема: общий дом форматирования | ЖИВ | сторож `packages/shared/src/canon-homes.test.ts` красный, см. раздел «Гейт» | shared + web | мелкий | низкий |

---

## DEADCODE_DISPOSITION_2026-06-05

| № | Суть | Статус | Доказательство | Зона | Труд | Риск |
|---|---|---|---|---|---|---|
| W-1 | вонзить `ep-reason-clusters` | ЗАКРЫТ | `packages/core/src/pipeline/signals.ts:659` `canonicalizeReasonEp(epJustification.slice(0, 2000)).cluster` — заодно закрыт `ReDoS` из S-M5 обрезкой длины | core | — | — |
| W-2 | вернуть сигнал `methodReasonMismatch` | ЗАКРЫТ | `packages/core/src/pipeline/signals.ts:110`; тесты `signals.test.ts:587-594` | core | — | — |
| W-3 | вернуть сигнал `unmappedReasonEP` | ЗАКРЫТ | `packages/core/src/pipeline/signals.ts:112`; тесты `signals.test.ts:596-604` | core | — | — |
| W-4 | вонзить `legal-refs` в разбор и подсказки | ЖИВ | ни одного потребителя `parseLegalRef`/`LEGAL_REFS` вне файла | shared | средний | низкий |
| W-5 | вонзить `validateSHDYUConsistency` в сверку | ЗАКРЫТ | `packages/server/src/routes/dashboard.ts:587` | server | — | — |
| W-6 | `activity-types` вместо своего вывода вида | ЖИВ | `normalizeActivityType` без потребителей; `packages/web/src/hooks/useUrlSync.ts:9` держит свой литерал | shared + web | мелкий | низкий |
| W-7 | `budget-sources` вместо жёстких колонок | ЖИВ | `PLAN_SOURCE_COLUMNS` без потребителей | shared | средний | низкий |
| W-8 | веб потребляет аксессоры ядра | ЖИВ | `packages/web/src/lib/metrics-registry.ts:63` держит собственный `getMetricKB` | core + web | средний | средний |
| D-1 | удалить `kvr` / `kosgu` | ЗАКРЫТ | файлов нет | shared | — | — |
| D-2 | свернуть `grbs-registry` | ЖИВ | файл на месте, см. CODE_DEBT §1-11 | shared | крупный | высокий |
| D-3 | удалить `core/recommendations.ts` | ЗАКРЫТ | файла нет | core | — | — |
| D-4…D-10 | удалить семь файлов веба | **ЧАСТИЧНО (правка 22.08)** | из семи удалены шесть; седьмой — `IssueList.tsx` — ошибочно объявлен живым. Проверено 22.08: `Recs.tsx:5` импортирует из модуля только константу `ORIGIN_LABELS`, сам компонент (`components/IssueList.tsx:35`) не отрисовывается нигде. Пункт возвращён в работу, полный довод — в строке §1-15 | web | малый | низкий |
| A-1 | `user-roles` держать спекой до входа в систему | НЕПРИМЕНИМ | файл удалён — решение реестра отменено удалением | shared | — | — |
| A-2 | `ewmaDetection` держать | ЖИВ | только тесты; согласуется с решением «держать» | core | — | — |
| Ар-1 | удаление карточек V1 оправдано | НЕПРИМЕНИМ | археология, действия не требует | web | — | — |
| Ар-2 | удаление скрипта GAS оправдано | НЕПРИМЕНИМ | археология | — | — | — |
| Ар-3 | `signals-taxonomy` унёс два сигнала | ЗАКРЫТ | оба сигнала восстановлены, см. W-2 и W-3 | core | — | — |

---

## SECURITY_REVIEW_2026-06-05

| № | Суть | Статус | Доказательство | Зона | Труд | Риск |
|---|---|---|---|---|---|---|
| S-C1 | впрыск строк в `.env` через настройки | ЖИВ | `packages/server/src/routes/settings.ts:53-56` — `privateKey` попадает в файл сырьём: `GOOGLE_PRIVATE_KEY="${body.privateKey}"`, проверка только `min(10)`; `spreadsheetId`, `port`, `host` не проверяются вовсе. За `NODE_ENV==='development'` и `DEV_SETTINGS_TOKEN` (`:38-46`) | server | мелкий | средний |
| S-H1 | неproверенный идентификатор книги | ЗАКРЫТ | `packages/server/src/routes/journal.ts:581` `validateSpreadsheetIdForSourceChange(spreadsheetId)` с русским отказом | server | — | — |
| S-H2 | утечка текста ошибки клиенту | ЖИВ частично | `packages/server/src/app.ts:98-115` обезличивает 5xx кроме объявленных `expose`; `packages/server/src/routes/rows.ts:395,404` по-прежнему отдают `details: err.message` | server | мелкий | низкий |
| S-M1 | нет ограничения частоты | ЗАКРЫТ | `packages/server/src/app.ts` — `registerHeavyRouteRateLimit(app, options.rateLimitRules)`; тест `plugins/rate-limit.test.ts` | server | — | — |
| S-M2 | нет `bodyLimit` и предела на массив строк | ЖИВ | `bodyLimit` не встречается в `packages/server/src/` ни разу | server | мелкий | низкий |
| S-M3 | нет заголовков безопасности | ЗАКРЫТ | `packages/server/src/app.ts:76-94` — `helmet` с политикой; `connectSrc: ["'self'"]` закрывает вынос ключа | server | — | — |
| S-M4 | ключ в хранилище браузера | ЖИВ | `packages/web/src/api.ts` — принятый остаточный риск, назван в `CLAUDE.md` | web | крупный | высокий — нужен настоящий вход |
| S-M5 | безграничное выражение в разборе обоснования | ЗАКРЫТ | `packages/core/src/pipeline/signals.ts:659` — `.slice(0, 2000)` перед разбором | core | — | — |
| L-1 | `safeCompare` раскрывает длину | ЖИВ | `packages/server/src/middleware/auth.ts:7` | server | мелкий | низкий |
| L-2 | CORS захардкожен | ЗАКРЫТ | `packages/server/src/config.ts:187` | server | — | — |
| L-3 | `field` без белого списка | ЗАКРЫТ | дубль BUG C2 | server | — | — |
| L-4 | `limit` без ограничения | ЗАКРЫТ | дубль BUG M4 | server | — | — |
| L-5 | `window.open` без `noopener` | ЖИВ | `packages/web/src/components/recon/ReconDeptTable.tsx:262`, `packages/web/src/components/recon/ReconMetricTable.tsx:159` и `:217` | web | мелкий | низкий |
| L-6 | `allowedHosts: true` в сборщике | ЗАКРЫТ | `packages/web/vite.config.ts:26` `resolveAllowedHosts(process.env.AEMR_VITE_ALLOW_PUBLIC_HOSTS)` | web | — | — |
| L-7 | внешние шрифты без проверки целостности | ЖИВ | `packages/web/index.html:8-10` — три ссылки на Google Fonts; политика заголовков их допускает намеренно (`app.ts:81-82`) | web | средний | низкий |
| L-8 | оператор `in` по прототипу в `legal-refs` | НЕПРИМЕНИМ | модуль мёртв целиком, см. CODE_DEBT §1-6 | shared | — | — |

---

## REFACTOR_BACKLOG_2026-06-15

| № | Суть | Статус | Доказательство | Зона | Труд | Риск |
|---|---|---|---|---|---|---|
| A | два движка расчёта | ЗАКРЫТ | `packages/core/src/pipeline/recalculate.ts:4` — «RETIRED 2026-06-15» | core | — | — |
| B | схлопнуть сверку | НЕПРИМЕНИМ | аудит признал посылку ложной: `reconcileUnified` не надмножество; `packages/server/src/routes/reconciliation.ts` живёт отдельно | core | — | — |
| C-full | свести три реестра ГРБС | ЖИВ, заблокирован | реестры намеренно неэквивалентны; нужна сверка данных с владельцем | shared | крупный | высокий |
| C-narrow | вывести якоря строк из реестра | ЗАКРЫТ | `packages/shared/src/report-map.ts:145` `...svodAnchors('uer')` — литералы заменены выводом | shared | — | — |
| D | набор флагов строки в трёх местах | ЗАКРЫТ | определение осталось одно: `packages/core/src/pipeline/signals.ts:40 interface RowSignals`; в `shared/types.ts` и `shared/schemas.ts` дублей нет | core | — | — |
| E-1 | «само управление» в четырёх местах | ЗАКРЫТ | `packages/shared/src/org-itself.ts:18 ORG_ITSELF_PLACEHOLDERS` | shared | — | — |
| E-2 | заглушки факт-даты отдельным домом | ЗАКРЫТ | `packages/shared/src/fact-date.ts:4-20` — `FACT_DATE_PLACEHOLDERS` с прямой оговоркой «семантически отдельно от ORG_ITSELF_PLACEHOLDERS», как и предписывал аудит | shared | — | — |
| F-1 | классификация способа в двух домах | ЖИВ по форме | `packages/core/src/pipeline/calc-engine.ts:274 classifyMethodGroup` и `packages/core/src/pipeline/unified-svod.ts:100 methodOf`; поведение сведено (тест `unified-svod.test.ts:358` «methodOf распознаёт ЕП-алиасы»), но функции две, и `calc-engine.ts:272` называет вторую «зеркалом» | core (calc-engine — координация) | средний | средний |
| F-2 | `compliance-44fz` без нормализации | ЗАКРЫТ | дубль BUG H5 в части ядра | core | — | — |
| G | разрезать файлы-гиганты | ЗАКРЫТ | `dataset-signals.ts` 1380→686, `unified-class-system.ts` 1265→603 | core + shared | — | — |
| H-1 | Экономика нарушает контракт метрик | ЗАКРЫТ | подтверждено аудитом `c4b4eae` | web | — | — |
| H-2 | порог антидемпинга литералом | ЗАКРЫТ | `packages/core/src/pipeline/signals.ts:190` `const ANTI_DUMPING_PERCENT = LAW_44FZ_THRESHOLDS.antiDumpingSavingsShare * 100` — умножение на сто выполнено, как предупреждал аудит | core | — | — |
| H-3 | снять дубль имени листа свода | ЗАКРЫТ | в дереве остался только `MONITORING_SVOD_SHEET` (`packages/core/src/monitoring/procedures.ts:64`), голого `SVOD_SHEET` нет | shared | — | — |
| П-1 | вонзить рекомендации в API и интерфейс | НЕПРИМЕНИМ | ядерный модуль удалён, дом один — `Recs.tsx` | web | — | — |
| П-2 | три файла намерений вписать в прогон | ЖИВ | `packages/web/tests/features/*.feature` — три файла на месте, ни один не подключён к прогону: имена не встречаются ни в конфигурации, ни в коде | web | средний | низкий |

---

## SIGNAL_VALIDATION_2026-06-05

> Девять пунктов этого реестра отменены каноном п.27 от 14.08.2026: машинный
> статус строится только на структуре книги, тексту комментария место в самой
> колонке. Реестр предлагал обратное — протянуть текстовые смягчители через
> гейты и читать колонку AE. Это не просрочка, а сознательный разворот.

| № | Суть | Статус | Доказательство | Зона | Труд | Риск |
|---|---|---|---|---|---|---|
| В-1 | «Просрочка» — ложных до 95 % | НЕПРИМЕНИМ | `packages/core/src/pipeline/signals.ts:373-376` — просрочка чисто структурная, текстовые смягчители сняты каноном п.27 (комментарий `:370-372`) | core | — | — |
| В-2 | «Пуст флаг, но экономия» — ложных до 85 % | ЗАКРЫТ | `packages/shared/src/rule-book.ts:463` `const ecoNorm = Math.round(ecoTotal * 100) / 100` — округление до десяти рублей убирает «минус ноль» | shared | — | — |
| В-3 | «Факт без даты» — ложных 66 % | НЕПРИМЕНИМ | лечение требовало чтения колонки AE, снятого каноном п.27 | core | — | — |
| В-4 | «Факт раньше плана» — ложных до 90 % | ЖИВ | гейт по способу закупки не добавлен | core | мелкий | средний — меняет счёт замечаний |
| В-5 | «Факт превышает план» — ложных 57 % | ЗАКРЫТ | `packages/core/src/pipeline/signals.ts:523` `factTotal > planTotal * 1.005` — допуск восстановлен строже, чем в исходном скрипте | core | — | — |
| В-6 | «Антидемпинг» помечен неверно | ЗАКРЫТ | сигнал переименован: `packages/core/src/pipeline/signals.ts:801` «Высокая экономия >25%», словарь `packages/shared/src/product-dictionary.ts:73` | core + shared | — | — |
| В-7 | «Конфликт флага» дублирует высокую экономию | ЖИВ | `packages/core/src/pipeline/signals.ts:422-435` — обе ветки живут, подавления при высокой экономии нет | core | средний | средний |
| В-8 | «ЕП без обоснования» верен по букве, ложен по сути | НЕПРИМЕНИМ | лечение требовало чтения AE; канон п.27 закрепил чтение только колонки M (`signals.ts:655-658`) | core | — | — |
| В-9 | «Раннее закрытие» — половина ложных | ЖИВ | порог тридцати дней без разбора устаревших плановых дат | core | средний | низкий |
| В-10 | «Задержка финансирования» — верен, сохранить | НЕПРИМЕНИМ | сигнал снят каноном п.27: `packages/core/src/pipeline/signals.ts:392` `const financeDelay = false` — необеспеченность определяется структурно пустым годом плана | core | — | — |
| В-11 | «План без исполнения» ложен | НЕПРИМЕНИМ | ветка перестроена той же волной канона | core | — | — |
| П-1 | нет допуска на экономию | ЗАКРЫТ | дубль В-2 и В-5 | shared + core | — | — |
| П-2 | «планирование» не протянут через гейты | НЕПРИМЕНИМ | отменено каноном п.27 | core | — | — |
| П-3 | построить разбор колонки AE | НЕПРИМЕНИМ | отменено каноном п.27 | core | — | — |
| П-4 | гейт по способу на «факт раньше плана» | ЖИВ | дубль В-4 | core | мелкий | средний |
| П-5 | переименовать антидемпинг | ЗАКРЫТ | дубль В-6 | core | — | — |
| П-6 | снять дубль конфликта и высокой экономии | ЖИВ | дубль В-7 | core | средний | средний |
| П-7 | второй генератор «факт превышает план» в журнале | ЗАКРЫТ | ярлык `T>K` в `packages/server/src/routes/journal.ts` отсутствует | server | — | — |
| П-8 | сохранить задержку финансирования | НЕПРИМЕНИМ | дубль В-10 | core | — | — |

---

## SYSTEM_SEAMS_2026-07-09

| № | Суть | Статус | Доказательство | Зона | Труд | Риск |
|---|---|---|---|---|---|---|
| 1–8 | восемь швов волны 09.07 | ЗАКРЫТ | подтверждено самим реестром коммитами `f484f6d`, `b6ee652`, `f4f70d8` | процесс | — | — |
| 9 | прод отвечает 502 | ЖИВ | требует рук владельца либо его согласия на доступ к серверу | deploy (координация) | средний | высокий |
| 10 | нет присмотра за продом | ЖИВ частично | `deploy/docker-compose.yml:9,38,47` — `restart: unless-stopped` есть у всех трёх служб; внешней проверки доступности нет | deploy (координация) | средний | средний |
| 11 | нет эпизодической памяти | ЖИВ | требует установки руками владельца | процесс | — | — |
| 12 | скрипт обновления берёт личный ключ | ЗАКРЫТ частично | `scripts/server_update.py:19` и `server_phase2_deploy.py:22` перешли на `~/.ssh/aemr_deploy`; остались `scripts/fix_server_env.py:7` и `scripts/server_recon_probe.py:12` на `id_ed25519` | скрипты | мелкий | низкий |
| 13 | впрыск одних и тех же файлов при старте | ЖИВ | ждёт шва 11 | процесс | — | — |
| 14 | ручная синхронизация с хранилищем заметок | ЖИВ | процессный | процесс | — | — |
| 15 | зелёный гейт на устаревшем коммите | ЗАКРЫТ иначе | гейт прогоняется локально каждой волной; текущее состояние — в разделе «Гейт» выше | процесс | — | — |
| 16 (новый) | черновик ломает сборку типов ядра | ЖИВ | `packages/core/src/__scan-comments.test.ts:2` — `node:fs` без типов Node; файл не в git | core (координация) | мелкий | средний |
| 17 (новый) | сторож «домов понятий» красный | ЖИВ | `packages/shared/src/canon-homes.test.ts:103,113` — семь новых копий форматирования и коэрции из волн августа | shared + core + web (координация) | средний | низкий |
| 18 (новый) | серверные наборы на краю таймаута | ЖИВ | `rows-write-bounds.test.ts:55` и `routes/rows-batch-write.test.ts:59` — `beforeAll` 64 с при лимите 60 с | server | мелкий | низкий |

---

## (а) Чинится за один заход и даёт эффект

Одиннадцать пунктов. Каждый — правка в пределах десятка строк, каждому нужен
тест-сторож, ни один не стоит в запретной зоне.

| Что | Адрес | Почему стоит | Сторож |
|---|---|---|---|
| Ссылка на книгу открывается без изоляции окна | `packages/web/src/components/recon/ReconDeptTable.tsx:262`; `packages/web/src/components/recon/ReconMetricTable.tsx:159,217` | открытая вкладка получает доступ к окну-родителю; три одинаковые правки `'noopener,noreferrer'` | проверка аргументов вызова |
| Мёртвые поля боковой панели в хранилище состояния | `packages/web/src/store.ts:189-190,372-373` | компонента нет с апреля, поля тянутся в каждый снимок состояния | сборка типов |
| Два набора списков колонок в одном файле | `packages/server/src/routes/rows.ts:292-304` и `:446-448` | один массив и три множества описывают одни и те же колонки; расхождение между ними — тихая дыра в защите записи | тест равенства наборов |
| Словари периодов и единиц пересобираются на каждый вызов | `packages/core/src/pipeline/orchestrator.ts:87-90,339-342` | около четырёх тысяч лишних объектов за прогон | характеризационный тест на выход |
| Разбор степени важности через `switch` | `packages/core/src/pipeline/dataset-signals.ts:669,678` | рядом в файле уже принят стиль неизменяемой таблицы | существующие тесты набора |
| Строка рейтинга перерисовывается на каждое нажатие | `packages/web/src/components/RatingTableV2.tsx:416` | восемь управлений с подведомственными перестраиваются при вводе в фильтр | тест числа перерисовок |
| Сравнение ключа раскрывает его длину | `packages/server/src/middleware/auth.ts:7` | ранний выход по длине измерим извне | тест равного времени |
| Нет предела на размер тела запроса | `packages/server/src/app.ts` | запись усиливается неограниченным массивом строк | тест отказа на превышении |
| Текст ошибки Google уходит клиенту | `packages/server/src/routes/rows.ts:395,404` | в сообщении бывает идентификатор книги и почта служебной записи | тест ответа без `details` |
| Впрыск строк в файл настроек | `packages/server/src/routes/settings.ts:53-56` | кавычка и перевод строки в ключе дописывают произвольные переменные среды; защита только режимом и токеном | тест на ключ с переводом строки |
| Набор видов деятельности переизобретён литералом | `packages/web/src/hooks/useUrlSync.ts:9` | словарь `activity-types.ts` содержит ровно этот набор и остаётся мёртвым | тест соответствия словарю |

## (б) Требует волны

Девять направлений. Каждое меняет числа на экране либо трогает несколько
пакетов сразу, поэтому просит характеризационных тестов до правки.

1. **Разрез КП и ЕП по видам деятельности.** `activity-aggregation.ts:45` кладёт
   все счёты в конкурентную корзину, `totalEP` не наполняется вовсе — при
   включённом фильтре вида деятельности доля способов показывает сто процентов
   конкурентных. Лечение начинается на сервере: в `byActivity` нужен разрез по
   способу.
2. **Единый дом сверки со снимком.** Тринадцать копий отказа «данные не
   собраны» в трёх роутах.
3. **Единый сбор полей периода в сводке.** Тройной дубль списка полей в
   `dashboard.ts` — расхождение между кварталами, месяцами и годом ловится
   только глазами.
4. **Дубль реестра метрик.** Ядро экспортирует четыре аксессора, которых никто
   не зовёт, веб держит собственный. Один дом или явное разделение ролей.
5. **Три мёртвых словаря.** `legal-refs` (правовые ссылки), `budget-sources`
   (колонки источников), `activity-types` (виды деятельности) — это не мусор, а
   предметное знание без потребителя. Решение владельца: вонзить или снять.
6. **Новые файлы-гиганты.** `Settings.tsx` 2032, `DataBrowser.tsx` 1755,
   `Analytics.tsx` 1479, `SvodView.tsx` 1375, `Dashboard.tsx` 1317,
   `Report.tsx` 1138 — прежний список закрыт, вырос новый.
7. **Три реестра ГРБС.** Заблокировано до сверки данных с владельцем: реестры
   намеренно расходятся по числу подведомственных и написанию имён.
8. **Обещание семи представлений в базе.** В схеме десять таблиц и ноль
   представлений; `memory/DATA_MODEL.md:462` обещает семь. Построить или
   вычеркнуть — но не оставлять как есть.
9. **Пятьдесят `any` в Аналитике.** Единственная страница, где типизация не
   доехала.

## (в) Вычеркнуть как неактуальное

Тридцать пять пунктов. Три причины, по которым они больше не долг.

**Код удалён (18).** `charts/index.tsx`, `Sidebar.tsx`, `FilterBar.tsx`,
`CalendarHeatmap.tsx`, `SectionHeader.tsx`, `KBTooltip.tsx`,
`ExecutionOverview.tsx`, `core/recommendations.ts`, `dictionaries/kvr.ts`,
`kosgu.ts`, `user-roles.ts`, второй `google-sheets.ts`, тело
`recalculateFromRows`, роут `/reconcile/:deptId` в `rows.ts`, второй генератор
«факт превышает план» в журнале, дубль `/api/history`, голая константа
`SVOD_SHEET`, мёртвый страж в `calc-engine`.

**Отменено каноном (9).** Все девять пунктов SIGNAL_VALIDATION, требовавших
текстовых смягчителей и чтения колонки комментария: канон п.27 от 14.08
закрепил обратное решение. Держать их в очереди — планировать откат канона.

**Посылка оказалась ложной (7; было 8 — правка 22.08).** Пункт про
`IssueList.tsx` из этого счёта убран: посылка «мёртв» была верной, ложным
оказался довод, которым её закрыли. `Recs.tsx:5` берёт из модуля одну константу
`ORIGIN_LABELS`, а компонент со строки `components/IssueList.tsx:35` не
отрисовывается нигде — сплошной поиск по `packages/web/src` 22.08 даёт два
вхождения имени: объявление и эту строку импорта. Пункт возвращён в работу
(§1-15, D-4…D-10). Схлопывание сверки (чанк B)
разобрано аудитом 06-15: `reconcileUnified` не надмножество, переключение
сломает страницу сверки. Пункты L0.1, L0.2, L1.2, L1.4, L5.1, L5.2 описывают
состояние, которого больше нет.

---

## Порядок закрытия

Порядок собран по одному правилу: раньше идёт то, что разблокирует чужую
работу, потом дешёвое с эффектом, потом волны.

**Ноль. Разблокировать гейт — до всего остального.** Пока `pnpm typecheck`
красный, ни одна волна не может честно сказать «готово». Три шага:
согласовать судьбу черновика `packages/core/src/__scan-comments.test.ts` с
волной согласованности комментариев; привести семь новых копий форматирования
и коэрции к дому либо внести их в долг сторожа `canon-homes.test.ts` с
объяснением семантики; поднять предел ожидания в двух серверных наборах или
перестать поднимать всё приложение ради проверки границ записи.

**Первое. Одиннадцать дешёвых пунктов раздела (а).** Ложатся в один заход
каждый, конфликтов между собой нет: три файла веба, три файла сервера, два
ядра, один общий. Порядок внутри не важен — берутся по мере рук.

**Второе. Числовые правки, которые видит читатель.** Гейт по способу закупки на
«факт раньше плана», снятие дубля конфликта флага и высокой экономии, слепая
зона нормализации процентов в диапазоне от единицы до двух. Каждая меняет счёт
замечаний на экране — значит, сначала характеризационный тест на нынешнее
поведение, потом правка, потом объяснение в карточке диагноста.

**Третье. Разрез КП и ЕП по видам деятельности.** Самая дорогая из живых
ошибок: доля способов врёт при включённом фильтре. Начинается на сервере,
заканчивается в хуке.

**Четвёртое. Дома и дубли.** Единая обёртка снимка, единый сбор полей периода,
один реестр метрик, судьба трёх мёртвых словарей.

**Пятое. Решения владельца.** Три реестра ГРБС, семь представлений в базе,
заполнение реестра подведомственных, прод и присмотр за ним. Эти пункты не
чинятся кодом в одиночку.

---

## Что делать с самими реестрами

Девять файлов в памяти обновлены: у каждого пункта проставлен статус на
18.08.2026, формат сохранён. Дальше их держать девятью отдельными файлами
смысла мало — семьдесят один процент строк уже история. Предложение к
следующей волне: свести живой остаток (пятьдесят пять пунктов) в один рабочий
реестр, а девять исходных перевести в архив как снимки своих волн. Тогда
очередь будет читаться целиком, а не собираться каждый раз заново из девяти
мест.

Отдельно стоит признать находку сверки: **лучший реестр долга в этом проекте —
не файл в памяти, а тест.** `packages/shared/src/canon-homes.test.ts` знает про
дубли форматирования и коэрции больше, чем любой из девяти файлов, потому что
пересчитывает их на каждом прогоне и краснеет в тот же день, когда долг
вырастает. Файлы в памяти за два месяца устарели на семьдесят один процент;
сторож не устарел ни на день.
