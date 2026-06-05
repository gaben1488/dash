# Data Sources

Last verified: 2026-06-05.

This document separates production inputs from archives, copies, generated reports, and reference material. Production code must not silently switch to a copy or archive.

## Production Sources

Main summary workbook:

| Role | Google Sheets title | Spreadsheet ID | Code source |
| --- | --- | --- | --- |
| Main SVOD | `СВОД_ДЛЯ_GOOGLE` | `1i692JdP-FqWMSfVgBjTmDCoUakacbJpZMq9tJhQlRhg` | `SVOD_SPREADSHEET_ID` in `packages/shared/src/constants.ts` |

The server uses `GOOGLE_SHEETS_SPREADSHEET_ID` if explicitly set; otherwise it uses the shared default above. A production `.env` must point to this same spreadsheet unless the source change is intentional and documented.

SHDYU control tab in the same workbook:

| Logical role | Preferred tab | Current production fallback | Code source |
| --- | --- | --- | --- |
| Monthly SHDYU reconciliation | `ШДЮ` | `ШДЮ старый` | `SHDYU_SHEET_NAME_CANDIDATES` in `packages/shared/src/shdyu-map.ts` |

Metadata verified on 2026-06-04: the workbook currently exposes `ШДЮ старый` and does not expose `ШДЮ`. The loader keeps `ШДЮ` first, then falls back to `ШДЮ старый`; this is a tab-name fallback inside the same production workbook, not a switch to another source.

Department workbooks:

| Department | Full name | Spreadsheet ID | Production sheet |
| --- | --- | --- | --- |
| `УЭР` | Управление экономического развития | `15NEAE1zK0qc5li4BCwT4Jq-MH6uuA_SFFMG22ZrM4t4` | `УЭР` |
| `УИО` | Управление имущественных отношений | `1qCBY5EDSASxK6_ZPQbxzdF8cKIjcwcuykbnOc45Ukn8` | `УИО` |
| `УАГЗО` | Управление архитектуры, градостроительства и земельных отношений | `1DgO0t_Zx-PXmtLBp5ddkQvb2_pTkmyFKP_PaDqjOyXk` | `ВСЕ` |
| `УФБП` | Управление финансово-бюджетной политики | `14A7vvvvPFxY3SKwtYnMsNfmn_kkxbxWSkN78cYBfszQ` | `УФБП` |
| `УД` | Управление делами | `1zrpgVaCyS4S4KBNMFuDleMJS-PSTonHmPY_bRLgTVsg` | `ВСЕ` |
| `УДТХ` | Управление дорожно-транспортного хозяйства | `1bxh-mRLQ_ODsdpZ4JW2JJ8sOMjg4zJRhPydR6vjzqb4` | `УДТХ` |
| `УКСиМП` | Управление капитального строительства и молодёжной политики | `1aFAw9AfNxkTVCqwp6G6fchn3ZeDi8FwFu5-xgRSo7aI` | `ВСЕ` |
| `УО` | Управление образования | `1AGvXDSKSjpPc11ce4NDK262qySM4W6nFTq2YcgQ6Sds` | `ВСЕ` |

Department IDs are configured in `packages/server/src/config.ts` as `DEPARTMENT_SPREADSHEETS`. Runtime overrides are stored in `data/sources.json`; any override must be treated as a production source change.

Runtime source changes must pass `validateSpreadsheetIdForSourceChange()` in `packages/server/src/config.ts`: the API accepts only raw Google Sheets IDs, rejects URLs/file names, and rejects demo sentinel IDs.

## Runtime Read Path

1. Main workbook read:
   `packages/server/src/services/google-sheets.ts::fetchWorkbook()` reads `ALL_SHEETS` from the main SVOD spreadsheet: `СВОД ТД-ПМ` plus mirrored department tabs.
2. Department row read:
   `fetchDepartmentSpreadsheets(DEPARTMENT_SPREADSHEETS)` reads each department workbook using `DEPARTMENT_REGISTRY.sheetName`.
3. Aggregated subordinate books:
   `УАГЗО`, `УД`, `УКСиМП`, and `УО` use the aggregate sheet `ВСЕ`. The loader also tolerates the legacy title-case spelling `Все`.
4. SHDYU monthly reconciliation:
   `fetchSHDYUSheet(SHDYU_SPREADSHEET_ID)` reads `SHDYU_SHEET_NAME_CANDIDATES` with explicit A1 ranges (`'<tab>'!A:ZZ`). `parseSHDYUSheet()` supports both the current no-year-column layout and the legacy production tab with an explicit year column.
5. API assembly:
   `packages/server/src/routes/dashboard.ts` prefers calculated metrics from row-level department data and uses official SVOD cells as fallback/reconciliation.

## Local Export Reviewed

The local export used for this pass was:

```text
C:\Users\filat\Downloads\ПЛАН-РЕЕСТР-20260604T034235Z-3-001.zip
C:\tmp\dash-export-20260604-1544\ПЛАН-РЕЕСТР
```

Observed current files:

| File/folder | Classification | Production use |
| --- | --- | --- |
| `СВОД_ДЛЯ_GOOGLE.xlsx` | current main SVOD export | production reference for main spreadsheet |
| `УЭР.xlsx`, `УИО.xlsx`, `УАГЗО.xlsx`, `УФБП.xlsx`, `УД.xlsx`, `УДТХ.xlsx`, `УКСиМП.xlsx`, `УО.xlsx` | current department exports | production reference for department workbooks |
| `СВОД -25-26.xlsx` | historical/archive workbook | not a production input |
| `Копия_ УКСиМП – 22 мая, 18_43.xlsx` | copy/test snapshot | not a production input |
| `Копия_ УКСиМП – 29 мая, 10_54.xlsx` | copy/test snapshot | not a production input |
| `Архитектура/` | source/reference architecture and EIS/contract files | reference only |
| `Генератор Отчетов/` | Apps Script/report generator artifacts | not used by dashboard runtime |
| `ОТЧЕТЫ/` | generated reports | output/reference only |

Copies, archive workbooks, generated reports, and `Архитектура/` files must not be used as production dashboard sources unless the source contract is explicitly changed.

## Source Change Checklist

Before changing any spreadsheet ID or production sheet name:

1. Update `packages/server/src/config.ts`.
2. Update `packages/shared/src/department-registry.ts` if the sheet name changed.
3. Update `packages/shared/src/shdyu-map.ts` if the SHDYU tab name or layout changed.
4. If changing a runtime source through `/api/sources/:name`, submit only the raw spreadsheet ID, not a Google Sheets URL or exported file name.
5. Update this document.
6. Run `pnpm typecheck`, `pnpm -r test`, and a dashboard refresh against the new source.
7. Verify that `METRICS_CONTRACT.md` still maps every displayed KPI to source columns.
