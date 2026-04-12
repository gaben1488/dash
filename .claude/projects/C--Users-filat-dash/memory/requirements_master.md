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
