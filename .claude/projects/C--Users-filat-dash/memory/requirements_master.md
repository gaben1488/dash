---
name: requirements_master
description: Complete list of user requirements extracted from all conversations — functional, architectural, UX
type: project
---

## R1. End-to-End Filtering
Every filter combination must propagate to EVERY widget, metric, graph, card, diagram.
Example: "Центр Луч + ЕП + Текущая деятельность + Q3 2026" → every page reflects this.
- Department filter (ГРБС)
- Subordinate filter (подведы из колонки C)
- Procurement type (КП / ЕП / Все)
- Activity type (Текущая деятельность, Программное мероприятие, etc.)
- Period (quarter / month / year)
- Search (text across subjects, orgs, issues)

**Why:** User's primary use case is drilling into specific dept + subordinate + procurement type + period combos.
**How to apply:** useFilteredData must filter ALL collections. Every page must use useFilteredData, not raw dashboardData.

## R2. Row-Level Data (Построчные данные)
DataBrowser must show actual procurement rows from department spreadsheets.
- Each dept has its own spreadsheet (8 total)
- Sheet name: "Все" for depts with subordinates, dept short name for depts without
- Rows must show signals/badges (20 signals per row)
- Rows must be filterable by all filters
- Must support pagination, sorting, search

**Why:** Row-level access is how the user verifies aggregate numbers and finds specific procurements.

## R3. Reconciliation (Сверка)
Real comparison: СВОД official cells vs calculated-from-rows values.
- Per-department view with plan/fact/economy deltas
- Per-metric view with all REPORT_MAP entries
- Summary metrics (competitive.*, sole.*) must have calculated > 0
- Expandable rows with recommendations
- Drill-down to source cell

**Why:** Detects formula errors, data entry mistakes, and systemic discrepancies.

## R4. Source Status & Validation
Settings/Sources page must show:
- Real load status for each of 9 sources (СВОД + 8 depts)
- Last read timestamp
- Row count
- Validation results (data type errors, missing fields, signal counts)
- "Загрузить все" must refresh this info

**Why:** User needs to verify all data sources are connected and healthy.

## R5. Monthly Analytics
Pipeline must produce per-month (m1-m12) metrics, not just per-quarter.
MonthStrip already exists in UI but backend doesn't compute monthly data.

**Why:** User needs month-level granularity for tracking procurement execution.

## R6. Drill-Down Everywhere
Every metric, KPI card, chart bar, table cell must be clickable.
Click → navigate to relevant detail with filter context preserved.
- KPI card → Recon or metric detail
- Trust gauge → Trust page with dept pre-selected
- Bar chart bar → DataBrowser for that dept
- BlindSpots → Issues with category filter
- Any cell value → source cell in spreadsheet with edit capability

**Why:** Static dashboards are useless for decision-making. User needs to trace any number to its source.

## R7. Export & Reports
Must be able to export:
- Problem reports (issues per dept, formatted table)
- Reconciliation results
- Filtered data views
Beautiful formatting, suitable for meetings.

**Why:** User presents findings to leadership, needs polished exports.

## R8. Organizations Hierarchy
Not just 8 ГРБС — each ГРБС has subordinate organizations.
- ГРБС → подведы (from column C of dept sheets)
- Classified by type: МКУ, МБУ, школы, детские сады
- OrgTreePicker: hierarchical selection
- Depts without subordinates: no expand arrow
- Select ГРБС = select all its subordinates

**Why:** УО has many subordinates, each needs individual control like УФБП.

## R9. Signals & Badges
20 signals per row, visible in DataBrowser and influencing trust/issues.
Signals: overdue, factExceedsPlan, emptySubject, duplicateSubject, etc.
Must be shown as colored badges in row view.

**Why:** Visual indicators help identify problems at a glance.

## R10. ШДЮ Integration (NEW)
Spreadsheet ID: 1i692JdP-FqWMSfVgBjTmDCoUakacbJpZMq9tJhQlRhg
Not yet in system. Structure unknown — needs analysis.

**Why:** User provided this as an additional data source.

## R11. No Regressions
- v26 = stable baseline from GPT era
- v27 = severe regression (Babel/Twind removal broke rendering)
- Every change must be verified to not break existing functionality
- 0 TS errors, 0 console errors

## R12. UI Language
- Russian management terms, not developer jargon
- UI_LABELS dict in shared/constants.ts
- Period labels: "1 квартал", not "Q1"
- Status labels: "Критично", not "critical"

## R13. Единый контур контроля (мандат 10.10.2026, высокое значение)

Все проверки, сигналы, замечания, проблемы, предупреждения, стадии, назначения и рекомендации должны быть связаны с единой канонической сущностью вопроса/дела; разные сырые детекторы остаются доказательствами одной причины, если это подтверждено. Одна первопричина не должна порождать несколько независимых штрафов, поручений и конкурирующих карточек. Исторические issue ID, события, алиасы, официальные рекомендации УЭР и исходные данные сохранять. Старый долг Д2 (шесть жалоб 20.08) **не закрыт** наличием прежнего enum.

**Где полная постановка:** docs/superpowers/specs/2026-10-10-unified-control-architecture.md.  
**Статус:** целевая модель, реализации и независимой приёмки нет.

## R14. Смысл KPI и справедливая оценка (мандат 10.10.2026)

- Отдельные измерения: надёжность расчётов, миграционная готовность, дисциплина, подтверждённый прогресс, риск.
- Критичность технической ошибки определяется воздействием на вычисления/отчёт/зависимости/миграцию, а не числом красных меток.
- Учитывать реальный объём *результативных подтверждённых действий* с доказательством, сложность и снятый эффект; не начислять баллы за клики, простые промежуточные статусы и искусственное дробление.
- Нормировать по **содержательным применимым** записям и реальной сложности ГРБС/подведов, показывать абсолютные блокеры, покрытие и статистическую неопределённость; большая таблица не автоматически хуже маленькой.
- Ни одно необъяснённое пороговое число, псевдонаучный общий A–F и юридический ярлык не считать утверждённым.

**Статус:** новое требование, не реализовано. **Приёмка:** docs/superpowers/plans/2026-10-10-control-rollout-acceptance.md.

## R15. Управляемое исправление «за руку» (мандат 10.10.2026)

Каждое actionable дело должно отвечать: что не так, доказано ли, какие реальные числа испорчены, где первичная ячейка, кто вправе действовать, что именно делать, можно ли безопасно исправить, подтвердилось ли сохранение, прошёл ли независимый повторный расчёт, закрылась ли первопричина. Все экраны показывают одно и то же дело и статус, а не собственные выдуманные списки. Законные стадии и аналитические гипотезы не выдавать как «требуется исправление».

**Статус:** новая постановка, не реализовано.

## R16. Не терять контекст и верифицировать до изменения (мандат 10.10.2026)

Подготовить сплошной актуальный инвентарь всех производителей и мест показа, сопоставить с live-восемью книгами, СВОДом, реестром процедур, рабочими изданиями, ролями/решениями и существующими PR #72/#74/#75/#77/#78. Изолированный теневой пересчёт и независимые орacles до cutover; никакой правки рабочих книг или production из-за новой эвристики. Результаты централизовать в трёх Markdown-документах, указанных в R13 и CLAUDE.md.

**Статус:** документальная фиксация сделана в отдельной ветке; перенос, код, тесты и приёмка впереди.
