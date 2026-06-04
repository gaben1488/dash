# SHDYU Reconciliation Contract

Last verified: 2026-06-04.

This document defines the product contract for monthly reconciliation between the logical `ШДЮ` control sheet and the row-by-row `CalcEngine` recalculation.

Production tab names:

- Preferred tab: `ШДЮ`.
- Current production fallback verified on 2026-06-04: `ШДЮ старый`.
- Code source: `SHDYU_SHEET_NAME_CANDIDATES` in `packages/shared/src/shdyu-map.ts`.

## Runtime Path

1. `packages/server/src/services/google-sheets.ts` reads the first available SHDYU candidate tab from the main SVOD workbook using explicit A1 ranges.
2. `packages/core/src/pipeline/shdyu-ingest.ts` parses SHDYU blocks into monthly KP/EP values, budget breakdowns, totals, quarterly data, and formula evidence. It auto-detects current vs legacy tab format:
   - current format: no explicit year column;
   - legacy production format: column C is year, data starts at column D, blocks are 33 rows.
3. `packages/core/src/pipeline/reconcile.ts::reconcileMonthly` compares SHDYU monthly values with `recalcResults`.
4. `packages/server/src/routes/dashboard.ts` returns the monthly reconciliation DTO from `/api/reconciliation/monthly`.
5. `packages/web/src/pages/Recon.tsx` shows the monthly SHDYU table and expandable root-cause details.

## Monthly Row Contract

Each monthly row contains:

| Field | Meaning |
| --- | --- |
| `deptId`, `deptName`, `month` | Department and month being reconciled. |
| `compPlan`, `compFact`, `compPlanTotal`, `compFactTotal` | KP count and amount comparison cells. |
| `epPlan`, `epFact`, `epPlanTotal`, `epFactTotal` | EP count and amount comparison cells. |
| `compBudget`, `epBudget` | Optional FB/KB/MB breakdown for plan/fact/economy. |
| `warnings` | Data gaps such as missing SHDYU month while CalcEngine has rows. |
| `rootCause` | Evidence-based probable cause, not an absolute assertion. |

Comparison cell:

```ts
{
  shdyu: number;
  calc: number;
  delta: number;      // calc - shdyu
  deltaPct: number;   // delta / max(abs(shdyu), 1)
  status: 'ok' | 'warning' | 'high' | 'empty';
}
```

## Root Cause Contract

`rootCause` shape:

```ts
{
  id: SHDYUReconRootCauseId;
  label: string;
  severity: 'warning' | 'critical';
  confidence: 'low' | 'medium' | 'high';
  evidence: string;
  suggestedAction: string;
}
```

Rules:

- Root cause is probable and evidence-based; it must not be phrased as guaranteed truth unless row-level evidence exists.
- UI must show at least label, confidence, evidence, and suggested action.
- Missing or unclassified cause is valid; the row still shows numeric deltas.

## Implemented Causes

| ID | Status | Trigger | Evidence |
| --- | --- | --- | --- |
| `formula_scope_limited` | implemented | SHDYU has department block but not the month; CalcEngine has plan rows | dept, month, calc plan count |
| `department_alias_mismatch` | implemented | CalcEngine has department/month rows but SHDYU has no department block for that id | dept id/name, month, calc plan count |
| `economy_flag_gated` | implemented | Plan/fact totals align, but budget economy cells differ | AD gate explanation, month |
| `procurement_method_mismatch` | implemented | Same count/amount pair appears on opposite KP/EP sides between SHDYU and CalcEngine | month, KP/EP direction |
| `formula_source_mismatch` | implemented | A SHDYU formula in a department block references another department sheet and the row has a numeric mismatch | source row, expected sheet, actual referenced sheet(s), month, KP/EP block |

## Catalogued But Not Auto-Inferred Yet

These causes are in the product catalog but require row-level evidence before automatic inference:

| ID | Needed evidence |
| --- | --- |
| `activity_filter_hidden_rows` | Row activity classification and filter state proving hidden ТД/ПМ rows. |
| `contract_split_rows` | Shared procurement/contract identifier across multiple rows. |
| `reserve_status_excluded` | Status-level exclusion evidence from both SHDYU and row source. |

## Verification

Current tests:

- `packages/core/src/pipeline/reconcile.test.ts`
  - root cause catalog order;
  - missing SHDYU month -> `formula_scope_limited`;
  - missing SHDYU department -> `department_alias_mismatch`;
  - economy-only budget mismatch -> `economy_flag_gated`;
  - cross-method KP/EP flips -> `procurement_method_mismatch`;
  - wrong SHDYU formula references -> `formula_source_mismatch`;
  - no root cause is exposed for formula notes when all numeric cells match;
  - budget breakdown discrepancies included in status counts;
  - no crash on empty inputs.
- `packages/core/src/pipeline/shdyu-ingest.test.ts`
  - empty sheet guard;
  - legacy production tab with explicit year column;
  - formula source mismatch evidence from legacy formulas.

Current runtime check on 2026-06-04:

- `/api/reconciliation/monthly`: 96 rows; status counts `ok=771`, `warning=0`, `high=72`, `empty=1653`.
- Top-level high rows without `rootCause`: 0.
- Root-cause rows: `formula_source_mismatch=6`, `procurement_method_mismatch=7`.
- Formula-source evidence currently flags:
  - `УАГЗО` months 11-12: SHDYU EP formulas reference `УФБП`;
  - `УФБП` months 10-12: SHDYU EP formulas reference `УД`;
  - `УИО` month 12: SHDYU EP formula references `УАГЗО`.

Current UI:

- `packages/web/src/pages/Recon.tsx` shows monthly SHDYU rows.
- Expanding a row shows root-cause label, confidence, evidence, suggested action, warnings, and budget breakdown deltas.
