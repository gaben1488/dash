# Technical sheets consolidation — compatibility release (2026-10-10)

Status: **deployed presentation/diagnostics layer; legacy technical storage intentionally retained**. Scope: eight live GRBS plan-register workbooks, live procurement procedures workbook, and live consolidated workbook. This is **not** a completed physical cutover and does **not** authorize deleting legacy tabs.

## Why this release is conservative

The user requested a compact, carefully designed technical workspace while other edits were underway, and explicitly deferred Apps Script changes. Work was therefore limited to:
- adding one non-authoritative, read-only-by-design `СИСТЕМА` tab to each of ten live workbooks;
- referencing existing `Контроль`, `_Настройки`, master and QA calculations instead of copying business data or introducing parallel formulas as a second source of truth;
- excluding the new `СИСТЕМА` tab from the eight GRBS books' configured Apps Script monitored sheets;
- hiding legacy `Settings` / `Контроль` only where formerly visible;
- warning-on-edit protection of each new dashboard.

No Apps Script source, triggers, `_ChangeLog` contents or visibility, department primary data, native C:E validation, conditional formatting of working tabs, named ranges, supplier/customer directories, or `IMPORTRANGE` formulas were changed.

The live source IDs must be resolved through `packages/server/src/config.ts` / `packages/shared/src/department-registry.ts`; do not select similarly named archive copies. The procedures book is the active MONITORING_SPREADSHEET_ID, not the September archive.

## Deployed workbook classes

| Group | New view | Old tabs intentionally retained |
|---|---|---|
| УЭР, УИО, УАГЗО, УФБП, УД, УДТХ, УКСиМП, УО | `СИСТЕМА` immediately after primary tab | `_Настройки`, `Settings`, `Контроль`, `_ChangeLog` |
| Procurements procedures | `СИСТЕМА` immediately after first tab | `Справочник заказчиков`, `_Поставщики`, `_Проверки`, and all content/analytics tabs |
| Consolidated SVOD | `СИСТЕМА` immediately after first tab | `Settings`, `Контроль`, `NVScriptsProperties`, `_ChangeLog` and eight import mirrors |

The new view uses a 12-column restrained navy/pearl design, frozen top three rows, live KPI cells, specific diagnosis/action rows, direct source hyperlinks where source sheets are visible, a dependency map, and an explicit warning that zero counters are not full acceptance. It has warning-on-edit protection, **not** user-identity-specific edit denial.

Eight GRBS workbooks: `СИСТЕМА!A8` reads `Контроль!B2` (existing source-row counter); `E8` sums existing controls `B3:B11` (counts *checks triggered*, not unique defective procurements); `I8` catches actual error results in `_Настройки!E2:G2` (this is not a whole-workbook formula scan). The quality/action table references existing `Контроль` expressions directly and links to the relevant *field's start*, not a proven first faulty row. `K24` flags numeric values in lookup-list `H2:J250` for manual review, without silently converting them. `E38:E45` shows active legacy settings read-only; for УО ignored-tabs setting lives in `_Настройки!B6`, not `B2`.

For Apps Script exclusion the eight GRBS `_Настройки` setting `Игнорируемые листы` was changed **only** by appending `, СИСТЕМА` to existing `Settings, GOOGLE_ФОРМУЛЫ`; no other configuration value was modified. This aligns with the documented CSV ignore-list contract but **does not replace an audit of the actual bound Apps Script projects**.

Visibility changes (content unchanged):
- `Settings` hidden in УЭР, УАГЗО, УД and УО; remained already hidden in УИО, УФБП, УДТХ, УКСиМП.
- `Контроль` hidden in УАГЗО; remained already hidden in the other seven books.
- `_Настройки` deliberately remains visible to administrators so adding valid local H:J values remains possible.
- `_ChangeLog` retained its **pre-existing** visibility (visible in six GRBS books; hidden in УДТХ and УКСиМП).

## Live verification immediately after deployment

Read back ten new tab titles and formula results using the Google Sheets API. Verify the C4:E4 native validation in each GRBS still reads the original `'_Настройки'!$H$2:$H`, `I2:I`, `J2:J` respectively, with `ONE_OF_RANGE` rules. Re-read all eight `СИСТЕМА!E40` values after settings change; each displays `Settings, GOOGLE_ФОРМУЛЫ, СИСТЕМА`. Seven known formula spill errors were successfully surfaced dynamically by the new dashboards: УФБП 1, УД 1, УДТХ 1, УКСиМП 2, УО 2. They were **not** fixed as part of this compatibility release; their roots are `_Настройки!E2:G2`. УЭР shows a review flag for `_Настройки!J6` (numeric raw value displayed as programme code).

Live procedures console: `A8` uses actual nonempty subject `G3:G1002` and excludes `B="доля"`; initial `COUNTIFS(A;"<>")` was found to overcount empty formula outputs and corrected within the **new console only**. Readback gives **442 procedure rows excluding six share rows**; `E8` shows **2** test-result mismatches; `I8` shows **1** Y-column issue row. `_Проверки` remains the primary QA evidence, not an editable staging area. The two mismatches may represent changed legitimate expectations; do not automatically alter master procedure status. `_Поставщики` (203 P-codes) and `Справочник заказчиков` (85 entries at this snapshot) remain in place. Named range dependencies (`ДанныеМастера`, `Поставщики`, `Сегодня`) remain unmodified.

Live consolidated SVOD console: `A8=8` configured URLs, `E8=8` import mirrors with some row data, `I8=0` errors in mirror anchor A1 formulas. These are *availability checks only*: **not** independent recalculation or proof of equality of all financial totals. The legacy `Контроль!B5` check relying on `d!A:A` remains flagged as unreliable; do not use its displayed value as acceptance evidence. `NVScriptsProperties` and all `IMPORTRANGE` remain untouched.

## Blockers to a real 1+1(+ChangeLog) cutover

Do not rename, relocate or delete `_Настройки`, `Settings`, `Контроль`, `_ChangeLog`, `_Проверки`, `_Поставщики`, `NVScriptsProperties` or any of the procedure/Dash source tabs until:
1. all attached Apps Script source and installable triggers are inventoried, including potential sheet visibility / activate() assumptions;
2. full-volume data validation and defined named ranges, protections and chip appearance are verified, not only row 4;
3. each original formula is mapped to an equally tested replacement or deliberately retained compatibility cell;
4. edits via both UI and Sheets API are recorded losslessly in an external append-only event log, with historic import verified before retiring any `_ChangeLog`;
5. real source-row identity remains external to employee worksheets (no new manual UUID columns), with optimistic concurrency and rollback;
6. original SVOD mirrors, procedure master/QA, department sums and all historical events pass **same-snapshot** parity checks;
7. a short structural change window is coordinated with simultaneous spreadsheet/Dash work and a rehearsed rollback exists.

For the deferred script phase, `_Настройки` is the actual compatibility adapter. Do **not** create a parallel independent `_ОПОРА` dictionary now: it would duplicate the H:J source of truth. Future choices are (a) reuse/rename `_Настройки` while preserving identities and adapting every consumer, or (b) replace it with new `_ОПОРА` after an atomic validation/script cutover. `_ChangeLog` stays a separate working sheet until reliable log migration is proven.

## Revert plan for changes in this release

Nothing in business grids needs restoration because it was not modified. If required, remove only `, СИСТЕМА` from the eight *verified* `Игнорируемые листы` values; unhide only the original `Settings` sheets of УЭР, УАГЗО, УД, УО and `Контроль` in УАГЗО; then hide or delete the newly added `СИСТЕМА` tabs after confirming they contain no new primary data. Do **not** touch `_ChangeLog`, `_Настройки!H:J`, primary tabs or named ranges in rollback.

## Source code to preserve

- `packages/server/src/services/google-sheets.ts` — controlled GRBS read / formula monitoring.
- `packages/server/src/services/monitoring.ts` / `packages/core/src/monitoring/procedures.ts` — live four-source procedure contract.
- `scripts/etalon-sync/canon.cjs` — explicit `_Настройки!H:J` validation dependencies.
- `packages/server/src/routes/rows.ts` — existing write/audit asymmetry; not yet a replacement for sheet ChangeLog.
- `docs/DATA_SOURCES.md` / `docs/METRICS_CONTRACT.md` — source and official KPI contracts.

No code runtime or Apps Script changes were deployed by this release.

## Independent follow-up audit — 2026-10-10

**Verdict: NOT ACCEPTED AS TECHNICAL-SHEET CONSOLIDATION.** This release successfully deployed ten informational dashboards, not the requested reduction of technical sheets. Each book has **one additional tab**; the original utility sheets remain. Do not report this as completed consolidation, full dependency parity or verified live Apps Script compatibility. The former "10/10" statement establishes only creation and formula readback of the new consoles.

Follow-up Google Sheets API reads after the rollout:

- All ten `СИСТЕМА` tabs are present at index 1; their own displayed/formula cells (A1:L50) currently show **zero evaluation errors**, not proof that their source systems are healthy.
- The existing GRBS `_Настройки` spill errors still exist: **УФБП G2; УД G2; УДТХ G2; УКСиМП F2/G2; УО E2/G2** (7 confirmed `#REF!`). **УЭР _Настройки!J6** is entered as a date serial 46027 although rendered as programme code `5.1.`. These inputs were not repaired.
- All eight primary GRBS C:E dropdown validation rules were read at row 4 and still point to `_Настройки!H:J`. Whole-column validation, chip presentation, append/sort edge cases and all dependent Apps Script triggers were **not** acceptance-tested.
- GRBS setting `Игнорируемые листы` was read back and contains `Settings, GOOGLE_ФОРМУЛЫ, СИСТЕМА`. This reflects configuration, **not an execution test of the actual Apps Script code**. Installation triggers, scheduled notifications and `_ChangeLog` append/send/retry behavior have not been audited. The static dashboard text "Сохранён" for `_ChangeLog` must **not** be interpreted as a live monitor of event delivery.
- The pults' `addProtectedRange` is `warningOnly=true`. It gives edit warnings, **not access denial**. The dashboards also link to *start-of-column* locations rather than the exact offending data rows.
- The dashboard's `E8` check-sum measures counts from the **legacy** `Контроль` only; `I8` detects errors only at `_Настройки!E2:G2`. Zero is therefore **not** full formula, validation, QA or cross-book acceptance.
- Procedures console was corrected during deployment: `A8` now counts **442** non-share live subjects (not the initial erroneous **994** formula-result overcount), with **2** QA expectation mismatches and **1** master diagnostic row. That is a limited count/check, not a sign-off on procedure completeness.
- SVOD console reports **8 configured URLs, 8 mirrors with some rows, 0 mirror A1 anchor errors**. This does not prove source URLs are canonical, imports are fresh, mirror row counts match or plan/fact/economy and monthly views reconcile. Legacy `Контроль!B5` remains suspect.
- The design has been verified as cell data, formulas and metadata, **not in the actual Google Sheets rendered application**. Typography, clipping, mobile layout and aesthetic quality cannot yet be treated as accepted.
- Existing `Settings` and `Контроль` sheets were hidden in selected GRBS books, but script behavior depending on sheet visibility is unverified; their content was not changed.

**Acceptance gates for the deferred cutover:** (1) inspect the actual Apps Script source and installed triggers; (2) inventory every range/validation/named-range/protection/integration consumer; (3) test journal append and notification flows; (4) unify legacy settings/lookup logic into the minimum useful sheets without duplicating truth; (5) independent same-snapshot parity for all books and Dash/Word consumers; (6) visual inspection in native Google Sheets; (7) rollback; (8) only then retire redundant tabs. Do not touch bound scripts in the present phase, per the owner's instruction.

**Immediate product decision:** keep the deployed read-only-by-convention dashboards, retain `_ChangeLog` and the legacy compatibility tabs, and do **not** claim the reduction to 1–2 technical tabs is achieved. Do not delete legacy tabs merely to reach a numeric target.
