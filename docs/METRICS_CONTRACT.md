# Metrics Contract

Last verified: 2026-06-05.

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

Production row-level calculations use department workbooks. The same layout is mirrored in the department tabs of `СВОД_ДЛЯ_GOOGLE`.

| File | Sheet | Column | Semantic field | Ingest mapping | Core metric key | API DTO | UI label |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Department workbook | `УЭР`, `УИО`, `УАГЗО`, `УФБП`, `УДТХ`, or `ВСЕ` for aggregated subordinate books | `A` | Source position label (text, not physical row) | `DEPT_COLUMNS.ID` | source alias | `rows[].id` | `№` |
| Department workbook | same | `C` | Subordinate organization | `DEPT_COLUMNS.SUBORDINATE` | dimension `subordinate` | `departmentSummaries[].subordinates` | Organization drilldown |
| Department workbook | same | `D` | Program / PM name | `DEPT_COLUMNS.PROGRAM_NAME` | program context for activity | `rows[].description` | Subject/detail |
| Department workbook | same | `E` | Subprogram name | `DEPT_COLUMNS.SUBPROGRAM` | subprogram context | `byActivity.*` | Activity filter |
| Department workbook | same | `F` | Activity type | `DEPT_COLUMNS.TYPE` | activity classifier input | `byActivity.*` | `ПМ`, `ТД-ПМ`, `ТД` |
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

Unknown methods must surface through validation/data quality. Procedure-specific analytics must distinguish a known competitive method from the official non-EP partition. Current source identity uses physical row separately from the text label in A. TD-PM program context is D, not E.

## Activity Classification

UI filters use internal keys, not Russian labels:

| UI label | Internal key | Source values |
| --- | --- | --- |
| `ПМ` | `program` | `ПМ`, `Программное мероприятие` |
| `ТД-ПМ` | `current_program` | current activity with a program context |
| `ТД` | `current_non_program` | `ТД`, `Текущая деятельность` without program context |

Navigation filters must synchronize both legacy single-value fields and the Set-based filters used by `useFilteredData`.

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
