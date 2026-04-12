---
name: spreadsheet_sources
description: All Google Spreadsheet IDs for AEMR data sources — СВОД_для_Google (main), and 8 department sheets
type: reference
---

## Data Sources

### СВОД_для_Google (ЕДИНСТВЕННАЯ основная таблица)
- ID: `1i692JdP-FqWMSfVgBjTmDCoUakacbJpZMq9tJhQlRhg`
- Содержит листы:
  - **СВОД ТД-ПМ** — сводные итоговые метрики (27 ячеек reportMap)
  - **ШДЮ** — помесячная динамика (Sheet within same spreadsheet)
  - **Все** — данные по УЭР, УИО, УД, УКСиМП, УО (управления с подведомственными)
  - **УАГЗО** — данные УАГЗО (отдельный лист)
  - **УФБП** — данные УФБП (отдельный лист)
  - **УДТХ** — данные УДТХ (отдельный лист)

**КРИТИЧНО**: Старый ID `1e8edyfuScFtjgAqqiDZ1w26-QAAdLofHcT3f-TnCoc0` НЕ ИСПОЛЬЗОВАТЬ НИКОГДА.

### Department Spreadsheets (отдельные таблицы 8 управлений)
| Dept | Spreadsheet ID | Sheet name |
|------|---------------|------------|
| УЭР | `15NEAE1zK0qc5li4BCwT4Jq-MH6uuA_SFFMG22ZrM4t4` | Все |
| УИО | `1qCBY5EDSASxK6_ZPQbxzdF8cKIjcwcuykbnOc45Ukn8` | — |
| УАГЗО | `1DgO0t_Zx-PXmtLBp5ddkQvb2_pTkmyFKP_PaDqjOyXk` | УАГЗО |
| УФБП | `14A7vvvvPFxY3SKwtYnMsNfmn_kkxbxWSkN78cYBfszQ` | УФБП |
| УД | `1zrpgVaCyS4S4KBNMFuDleMJS-PSTonHmPY_bRLgTVsg` | Все |
| УДТХ | `1bxh-mRLQ_ODsdpZ4JW2JJ8sOMjg4zJRhPydR6vjzqb4` | УДТХ |
| УКСиМП | `1aFAw9AfNxkTVCqwp6G6fchn3ZeDi8FwFu5-xgRSo7aI` | Все |
| УО | `1AGvXDSKSjpPc11ce4NDK262qySM4W6nFTq2YcgQ6Sds` | Все |

## Architecture
- `config.ts` defines `SVOD_SPREADSHEET_ID` and `SHDYU_SPREADSHEET_ID` (same value)
- `snapshot.ts` loads СВОД + ШДЮ in parallel, supplements with cached dept sheet data
- Pipeline: Ingest → Normalize → Classify → Validate → Recalculate → Delta → Trust
- Reconciliation: summary-level (СВОД vs recalc) + monthly (ШДЮ vs recalc)
