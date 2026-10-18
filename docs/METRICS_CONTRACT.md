# Metrics Contract

Исходная сверка:2026-06-05. Уточнения18.10.2026 ниже относятся к проверенным
трактам и целевому программному разрезу; это не повторная приёмка всех метрик.

This document is the contract from Google Sheet cells to dashboard numbers. If code, UI labels, or docs disagree with this file, the metric is not production-ready.

## Rule

- `amount_deviation` is `fact_total - plan_total` — the sign of the source
  sheet (`СВОД ТД-ПМ` column `P`), where under-execution is negative.
  Corrected 2026-08-08: this file previously stated the opposite order while
  the engine (`calc-engine.ts`, `STANDARD_DERIVED`) and its guard test
  (`exec-count-pct.test.ts`, expects −550) had always followed the sheet.
  A delta whose sign disagrees with the source sheet reads as growth where
  there is a shortfall, so the sheet's direction wins for every delta metric.
- `savings_pct` is a legacy key for `СВОД ТД-ПМ` column `Q`: `fact_total / plan_total` ("Потрачено, %"). It is not savings/economy.
- `economy_total` is approved economy from columns `Z + AA + AB` only when the row has `fact_date` and `AD = "да"`.
- The UI must not call `amount_deviation` economy. Economy cards and economy percentages must use `economy_total`.
- Procurement method buckets use the shared classifier, not raw string equality.

## Source value boundary (18.10.2026)

`parseEditableAmount` / `parseSheetNumber` is the common strict numeric parser.
It consumes the whole finite value: `1 234,56` and negative amounts are valid;
`123abc`, `Infinity`, booleans and malformed grouping (`1 23`) are invalid.
Missing input remains null at this boundary. Legacy optional budget components
may explicitly use zero after parsing; that is not proof that a required cell
was read successfully. Currency normalization stores thousands of rubles;
source and display units are declared and converted independently. Exact
minor-unit/decimal aggregation is separate work (C08.19).

Percentages use declared `fraction` or `points` encoding, never a magnitude
heuristic. Google UNFORMATTED_VALUE percentages are fractions; a literal `%`
is explicit points. `1.5` as a fraction is 150%, `1.5` as points is 1.5%.
Calendar dates require a real full day, or a supported Sheets serial. A bare
`2026` or `31.02.2026` does not establish a plan/fact date or period.
TS/Python boundary examples share `packages/shared/fixtures/source-value-cases.json`.

## Source Column Map

### Financial meaning and observation grain (18.10.2026)

Column K is the recorded plan amount and Y the recorded fact amount. Their
financial meaning must be established by the source profile and evidence;
the column letter or planning stage does not establish LBO, NMCK or a unique
contract price. The scatter response declares `plan_K_vs_recorded_fact_Y`.
Legacy names `limitTotal`, `contractTotal`, `limitReductionPercent` and the
older basis remain readable for compatibility, without granting those meanings.
Its ratio is descriptive `1 − ΣY/ΣK` over eligible plan positions. It does not
establish price reduction at auction, approved economy or an anti-dumping case.

LBO/appropriations, procurement financing by year, justified initial price,
contract price and amendments, accepted performance, monetary obligations and
payments are separate facts with their own entity, period, evidence and units.
Do not add NMCK and contract price as independent expenditure, or call the
unpaid contract amount free funds. A plan position, supplier-selection attempt,
contract, acceptance and payment have different counting grains. Several item
names do not prove several lots; electronic form does not prove competition.
The source's applicable regime determines official plan and contract terminology.

The ordinary price ≤ initial price ≤ financing relationship is not a universal
validation rule: comparable scope, units, years, price version and known quantity
must be established; multiannual and uncertain-quantity cases need their own
profile. AD approval remains a separate recorded decision and does not prove
the economic cause of the difference. These domain profiles are planned under
C02.03/C04.05/C08.19; this update corrects the scatter's declared interpretation,
without inventing new financial facts or modifying source workbooks.

Production row-level calculations use department workbooks. The same layout is mirrored in the department tabs of `СВОД_ДЛЯ_GOOGLE`.

| File | Sheet | Column | Semantic field | Ingest mapping | Core metric key | API DTO | UI label |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Department workbook | `УЭР`, `УИО`, `УАГЗО`, `УФБП`, `УДТХ`, or `ВСЕ` for aggregated subordinate books | `A` | Source position label (text, not physical row) | `DEPT_COLUMNS.ID` | source alias | `rows[].id` | `№` |
| Department workbook | same | `C` | Subordinate organization | `DEPT_COLUMNS.SUBORDINATE` | dimension `subordinate` | `departmentSummaries[].subordinates` | Organization drilldown |
| Department workbook | same | `D` | Название программы / исходное отнесение | `DEPT_COLUMNS.PROGRAM_NAME` | самостоятельный программный разрез ещё не подключён | `RowDto.programName` | Программный контекст |
| Department workbook | same | `E` | Исходное описание подпрограммы/мероприятия; уровень требует проверки | `DEPT_COLUMNS.SUBPROGRAM` | будущий программный разрез, не `byActivity` | отдельное поле в `RowDto` пока отсутствует | Будущий состав программы |
| Department workbook | same | `F` | Вид деятельности | `DEPT_COLUMNS.TYPE` + `classifyActivity` | `byActivity.*` | `RowDto.type` и общая ось активности | `ПМ`, `ТД`; все — без ограничения |
| Department workbook | same | `G` | Procurement subject | `DEPT_COLUMNS.SUBJECT` | row context/signals | `rows[].subject` | Subject |
| Department workbook | same | `H/I/J/K` | Plan budget: FB/KB/MB/total | `FB_PLAN`, `KB_PLAN`, `MB_PLAN`, `TOTAL_PLAN` | `plan_fb`, `plan_kb`, `plan_mb`, `plan_total` | `planFB`, `planKB`, `planMB`, `planTotal` | `План`, budget slices |
| Department workbook | same | `L` | Procurement method | `DEPT_COLUMNS.METHOD` + `classifyMethodGroup` | `competitive_count`, `ep_count`, method totals | `competitiveCount`, `soleCount`, `kpCount`, `epCount` | `КП`, `ЕП` |
| Department workbook | same | `N/O/P` | Planned date/quarter/year | `PLAN_DATE`, `PLAN_QUARTER`, `PLAN_YEAR` | period dimensions | `quarters`, `months` | Period filters |
| Department workbook | same | `Q/R/S` | Fact date/quarter/year | `FACT_DATE`, `FACT_QUARTER`, `FACT_YEAR` | `fact_count`, fact gates | `factCount` | `Факт`, execution |
| Department workbook | same | `V/W/X/Y` | Fact budget: FB/KB/MB/total | `FB_FACT`, `KB_FACT`, `MB_FACT`, `TOTAL_FACT` | `fact_fb`, `fact_kb`, `fact_mb`, `fact_total` | `factFB`, `factKB`, `factMB`, `factTotal` | `Факт`, budget slices |
| Department workbook | same | `Z/AA/AB/AC` | Approved economy: FB/KB/MB/total | `ECONOMY_FB`, `ECONOMY_KB`, `ECONOMY_MB`, `ECONOMY_TOTAL` | `economy_fb`, `economy_kb`, `economy_mb`, `economy_total` | `economyFB`, `economyKB`, `economyMB`, `economyTotal` | `Экономия` |
| Department workbook | same | `AD` | Economy approval flag | `DEPT_COLUMNS.FLAG` | gate for economy metrics | included in calculated metrics | Economy gate |
| `СВОД_ДЛЯ_GOOGLE` | `СВОД ТД-ПМ` | `D/E/F/G/H:U` by configured rows | Official summary cells | `REPORT_MAP` | official metrics and fallback | `kpiCards`, `summaryByPeriod` | Svod/Reconciliation |

## Key Metrics

| Russian name | Source | Gate | Formula | Core key | API DTO | UI usage |
| --- | --- | --- | --- | --- | --- | --- |
| План, кол-во | Department rows | data row passes classifier | `COUNT(rows)` | `plan_count` | `planCount`, `totalPlanCount` | Dashboard execution, RatingTable |
| Факт, кол-во | `Q` fact date | `Q` not empty | `COUNT(rows with fact_date)` | `fact_count` | `factCount`, `totalFactCount` | Dashboard execution |
| Исполнение, кол-во | `plan_count`, `fact_count` | denominator > 0 | `fact_count / plan_count` | `exec_count_pct` | `execCountPct`, `overallExecCountPct` | Main execution KPI |
| План, сумма | `H/I/J/K` | none beyond data row | `SUM(K)` or `SUM(H+I+J)` if total is absent | `plan_total` | `planTotal`, `totalPlan` | Plan/fact charts, RatingTable |
| Факт, сумма | `V/W/X/Y` | `Q` not empty | `SUM(Y)` or `SUM(V+W+X)` | `fact_total` | `factTotal`, `totalFact` | Plan/fact charts |
| Исполнение, сумма | `plan_total`, `fact_total` | denominator > 0 | `fact_total / plan_total` | `execution_pct` | `executionPct` | Secondary execution value |
| Отклонение, сумма | `plan_total`, `fact_total` | none | `fact_total - plan_total` (sheet sign, column `P`) | `amount_deviation` | calculated metric only | Diagnostics, not economy |
| Потрачено, % | `plan_total`, `fact_total` | denominator > 0 | `fact_total / plan_total` | `savings_pct` legacy key for SVOD `Q` | official metrics | Svod/Reconciliation; not economy |
| Экономия ФБ/КБ/МБ | `Z/AA/AB` | `Q` not empty and `AD="да"` | `SUM(Z)`, `SUM(AA)`, `SUM(AB)` | `economy_fb`, `economy_kb`, `economy_mb` | `economyFB`, `economyKB`, `economyMB` | Economy page, budget slices |
| Экономия итого | `Z/AA/AB` | `Q` not empty and `AD="да"` | `economy_fb + economy_kb + economy_mb` | `economy_total` | `economyTotal`, `totalEconomy` | Economy KPI, SvodView |
| Экономия, % | `economy_total`, `plan_total` | denominator > 0 | `economy_total / plan_total` | UI metric `economy_rate` | derived in web from `economyTotal` | Dashboard economy KPI |
| КП, кол-во | `L` method | `classifyMethodGroup(method)=competitive` | `COUNT(rows)` | `competitive_count` | `competitiveCount`, `kpCount`, `totalKP` | Method pie, filters |
| ЕП, кол-во | `L` method | `classifyMethodGroup(method)=ep` | `COUNT(rows)` | `ep_count` | `soleCount`, `epCount`, `totalEP` | Method pie, EP share |
| Факт КП | `L`, `Q` | competitive and `Q` not empty | `COUNT(rows)` | `comp_fact_count` | `kpFactCount` | Reconciliation/period details |
| Факт ЕП | `L`, `Q` | ep and `Q` not empty | `COUNT(rows)` | `ep_fact_count` | `epFactCount` | Reconciliation/period details |
| Доля ЕП | method counts | denominator > 0 | `ep_count / (competitive_count + ep_count)` | `ep_share_pct` | derived in web/core | Dashboard, analytics |

## Method Classification

`classifyMethodGroup` is the only allowed way to put a row into `ep` or `competitive`.

| Raw examples | Group |
| --- | --- |
| `ЕП`, `еп`, `Ед. поставщик`, `ЭЕП`, `ЕП (ст.93)` | `ep` |
| `ЭА`, `ЭК`, `ЭЗК` and aliases normalized by `normalizeMethod` | `competitive` |
| empty method | `competitive`, for legacy compatibility with the official `L<>"ЕП"` SVOD formulas |
| unknown non-empty method | `competitive` only for the official non-EP SVOD partition; not proof of a competitive procedure |

Unknown methods must surface through validation/data quality. Procedure-specific analytics must distinguish a known competitive method from the official non-EP partition. Физическая строка хранится отдельно от текстового номера A. Прежняя формулировка
«ТД-ПМ определяется по D» устарела: D/E — программная принадлежность, F — вид
деятельности; заполненная D не исключает ТД из её состава.

## Activity Classification

Действующее правило канона п.30 от14.08.2026, повторно подтверждённое
владельцем18.10: `matchesActivityScope` и `classifyActivity` используют F.
D/E не делят текущую деятельность на отдельные пользовательские категории.

| Отбор | Ключ оси | Источник и результат |
|---|---|---|
| Все | `all` | Ограничение F не применяется; неизвестные значения остаются видимыми |
| ПМ | `pm` | Распознанное «Программное мероприятие»; ключ движка `program` |
| ТД | `td` | Распознанная «Текущая деятельность», включая заполненную D; ключ движка `current_non_program` |

`current_program`, «ТД-ПМ» и «ТД чистая» сохранены для чтения старых ссылок/
снимков и нормализуются в ТД. Новый классификатор их не выдаёт. Нераспознанная
F возвращает null, не зачисляется в ПМ или ТД по догадке. Прежняя таблица
трёх категорий была описанием старой модели, а не текущим правилом интерфейса.
Навигация синхронизирует legacy поля и Set-отборы `useFilteredData`.

## Limit comparison and refusal scenario (C04.03, 18.10.2026)

`GET /api/rows/scatter` returns `basis=plan_K_vs_recorded_fact_Y` and
`unit=thousand_rubles`. Each point has `limitReductionPercent = 100×(1−Y/K)`;
`approvedEconomy` separately uses the core AD-gated signed Z+AA+AB definition.
K is not NMCK. Point ranges are descriptive, not an anti-dumping or savings
alarm. Known competitive methods come from `normalizeMethod`; unknown methods
are counted explicitly and cannot enter a competitive-only sample.

Both N and Q must be real dates, Q must have arrived in Asia/Kamchatka, and K/Y
must be complete finite positive numbers. Year/month/quarter derive from N;
contradictory O/P cannot reassign the point. Departments, institutions, the
canonical TD/PM activity scope, search and department-only mode narrow rows.
The maximum 2500 displayed points does not truncate the aggregate: summary is
weighted `100×(1−ΣY/ΣK)` over all eligible rows, with exclusions and source coverage.

The existing refusal-cost card uses that same selected comparison as a
**conditional scenario** `EP plan × limit reduction`, explicitly without a
causal claim or NMCK substitution. A partial source perimeter does not yield
an overall estimate. Actual tender reduction uses the monitoring registry's
separate NMCK/auction-price contract; official economy uses AD/Z/AA/AB.

## Worked Example

Three source rows:

| Row | Method | Plan `K` | Fact date `Q` | Fact `Y` | Economy `Z+AA+AB` | `AD` |
| --- | --- | ---: | --- | ---: | ---: | --- |
| 1 | `ЭА` | 1000 | set | 700 | 35 | `да` |
| 2 | `Ед. поставщик` | 500 | set | 450 | 300 | empty |
| 3 | `ЭА` | 200 | empty | 0 | 150 | `да` |

Result:

| Metric | Calculation | Value |
| --- | --- | ---: |
| `plan_count` | all 3 rows | 3 |
| `fact_count` | rows 1 and 2 have `Q` | 2 |
| `exec_count_pct` | `2 / 3` | `66.7%` |
| `plan_total` | `1000 + 500 + 200` | 1700 |
| `fact_total` | `700 + 450` | 1150 |
| `amount_deviation` | `1150 - 1700` (sheet sign) | −550 |
| `savings_pct` | legacy SVOD `Q`: `1150 / 1700` | `67.6%` |
| `economy_total` | only row 1 has `Q` and `AD="да"`: `35` | 35 |
| `economy_rate` | `35 / 1700` | `2.1%` |
| `competitive_count` | rows 1 and 3 | 2 |
| `ep_count` | row 2 alias normalized to EP | 1 |
| `comp_fact_count` | row 1 | 1 |
| `ep_fact_count` | row 2 | 1 |
| `ep_share_pct` | `1 / (2 + 1)` | `33.3%` |

The critical distinction is visible here: `amount_deviation = −550` (550 of the
plan not yet contracted, negative because the sheet subtracts plan from fact),
legacy `savings_pct = 67.6%` spent, but approved `economy_total = 35`.

## Implementation References

- Column map: `packages/shared/src/column-map.ts`
- Department registry: `packages/shared/src/department-registry.ts`
- Source IDs: `packages/server/src/config.ts`
- Calculator: `packages/core/src/pipeline/calc-engine.ts`
- Legacy recalc adapter: `packages/core/src/pipeline/recalculate.ts`
- API DTO assembly: `packages/server/src/routes/dashboard.ts`
- Web filtering: `packages/web/src/hooks/useFilteredData.ts`
- Economy helper: `packages/web/src/lib/economy-metrics.ts`


## Эксплуатационные наблюдения генератора — 16.10.2026

Единый объект `operations` уже формируется `report_health.py` и передаётся
в `/report-releases` для обычного и выбранного выпуска. Типизированный
`ReportOperationsSchema` сохраняет его на обеих границах. Расширение совместимо
с прежним ответом без `operations`; отсутствие текущих сведений явно диагностируется,
не заменяется нулями. Это сведения о процессе, не показатели качества сотрудников.

| Ключ каталога METRIC_KB | Определение и единицы | Основание и ограничения |
|---|---|---|
| `api_read_available` | Пригодный ответ последней проверки API; бинарное наблюдение | HTTP и проверка контракта в существующем `useReportExport`; это не uptime за период и не доказательство работы worker |
| `report_check_age_seconds` | checked_at минус last_success_at, секунды | Успешная попытка генератора, в том числе ручная и reused; не возраст Word-среза |
| `worker_cycle_duration_seconds` | finished_at минус started_at последней завершённой попытки, секунды | Успех или отказ, включая ручной запуск; не интервал расписания. Текущая длительность передаётся отдельно |
| `worker_last_failure` | Время и безопасный код последнего записанного отказа | Успех не стирает отказ; failure_resolved означает последующую успешную проверку, не закрытие бизнес-дела |

Источники — сохранённые времена попыток и `report-health.json`. Автономность
и host FLOCK доказываются отдельной эксплуатационной приёмкой: этот индекс
сам по себе не атрибутирует таймер. `check_stale` вычисляет генератор; UI не
дублирует порог. Значения `null` сохраняются как отсутствие наблюдения, не ноль.
Время `checked_at` не является временем правки Google и не обновляется при
подготовке архивного Word. Ответ prepare без `operations` сохраняет только
предыдущие same-context сведения GET с исходным checked_at. Смена контекста
очищает их; ошибка чтения оставляет прежние сведения с явной отметкой.
Отказ POST подготовки архива виден вместо бесконечного «собираем» и не
переименовывает предшествовавший успешный GET в недоступность API.

Один React-компонент `ReportOperationsStatus` использует существующий опрос;
дополнительного GET, генерации, SQL-схемы и самостоятельного расчётного контура
нет. Его локальные учебные browser-сценарии не являются production-приёмкой.


<a id="program-metrics-20261018"></a>

## Закупочная часть программ — целевой контракт18.10.2026

Это определения для существующих C02.03/C03.01/C05.01/C08.06 и концепции
[«Программы»](../DESIGN.md#programs-concept-20261018). Они ещё не объявлены
исполняемыми метриками приложения. Учебный HTML показывает взаимодействие;
его массивы и функции не становятся вторым финансовым ядром.

Единица основного состава — плановая позиция с установленной идентичностью,
источником, программной принадлежностью и плановым годом/неизвестным годом.
Запись источника, потребность, попытка процедуры, договор и платёж различны.
Программа/редакция и подпрограмма имеют собственные ключи; одинаковый текст
в разных программах не объединяет их. Неоднозначные D/E сохраняют raw-основание
и отдельную группу до подтверждённого соответствия. Самый крупный заказчик
не назначается координатором. Роли из паспорта не выводятся из B/C.

| Показатель | Состав и формула | Источник, ограничения и переход |
|---|---|---|
| Плановые позиции | Число уникальных позиций полного активного отбора | D/E и identity общего выпуска; не число строк на странице, процедур или договоров. Открывает тот же набор позиций. |
| Суммы по планам | Сумма известных сопоставимых K; при выборе бюджета — соответствующие H/I/J по общему денежному правилу | Экономическая роль, единицы и год обязательны; неизвестные обязательные деньги не становятся0. Раскрываются включённые/исключённые позиции и покрытие. Не полный бюджет программы. |
| Процедуры в работе | Число уникальных подтверждённо связанных попыток в объявленных активных состояниях | Из реестра процедур и доказанных связей; код или похожий предмет сами по себе не устанавливают связь. Счётчик открывает именно эти попытки. |
| Договоры | Число уникальных подтверждённых договоров выбранного состава | Собственные идентификаторы/события договора. Q плановой строки не является идентификатором договора. При отсутствии такого источника допустима иная метрика «Позиции со сведениями о договоре» со своим grain и покрытием. |
| Отнесённая стоимость договоров | Сумма подтверждённых распределений на выбранные позиции/программы/год | Полная цена общего договора не копируется в каждую программу. Нераспределённая часть видна; сумма частичных счётчиков договоров может пересекаться, общий счётчик — по объединению ID. |
| Требуют внимания | Число уникальных позиций с применимыми действующими деловыми вопросами общего каталога сигналов | У причины есть доказательство, адресат, действие и проверка результата; несколько причин одной позиции не умножают счётчик. Транспортная ошибка — технический инцидент, не нарушение ГРБС. |
| AD-экономия | Существующий `economy_total` в том же программном/календарном отборе и с его действующими gates | Signed Z+AA+AB при подтверждённом AD, не K−Y. Перераспределение не создаёт второй результат; основания открываются в общем досье. |

Канонический расчёт возвращает значение **вместе с его составом** и паспортом:
объект/формула/единицы, числитель/знаменатель (где применимы), as-of/период/
календарная ось, источник/колонки/фактические времена чтений, rule/mapping/version,
применённые/неприменимые оси, исключения/покрытие, основание порога и действие.
Программный фильтр добавляется в общий selector, DTO, URL и выгрузку; фронт
не пересчитывает официальный итог по загруженной странице строк. Периметр
показателя, расшифровки, процедуры, карточки и документа согласован.

Период N, управления B, организации C/«только управление», L, F и бюджеты
сужают соответствующие данные одинаково; неприменимость называется явно.
Плановая когорта и окно событий календаря раздельны. Неизвестная N не даёт
дату/год по догадке и не становится просрочкой. Наличие Q не доказывает
приёмку, оплату или исполнение всей программы. Для первоначального календаря
сохраняется исходная дата, для текущей работы — согласованная; перенос не
улучшает прежнюю когорту задним числом.

Сравнение двух выпусков сохраняет обе точки и совместимость. Изменения D/E,
состава знаменателя, сумм и новые результаты объясняются раздельно; неполное
предыдущее чтение не создаёт исчезновение. Достоверный0, отсутствие данных,
непрочитанная книга, отбор в0, неподключённый дополнительный источник и
недоступное сравнение имеют разные состояния. Каждая производная метрика
включается в исполняемый каталог с отрицательными проверками до её внедрения.
