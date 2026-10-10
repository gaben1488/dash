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

## Архив исходных E:G (до очистки конфликтующих ручных записей)

Эти значения фактических подсказочных списков зафиксированы **до** технической починки динамических формул. Копия используется только для отката и провенанса. Авторитетные рабочие списки остаются в `'_Настройки'!H:J`; код Apps Script не изменяется. Не подставлять архивные значения в рабочие списки без отдельной предметной проверки.

```json
{
  "bookSnapshot": "2026-10-10",
  "purpose": "backup of _Настройки E:G raw CellData before spill-repair",
  "books": [
    {
      "name": "УЭР",
      "id": "15NEAE1zK0qc5li4BCwT4Jq-MH6uuA_SFFMG22ZrM4t4",
      "main": "ВСЕ",
      "sheetId": 1691299052,
      "rowCount": 1000,
      "entries": [
        {
          "address": "E1",
          "raw": {
            "stringValue": "Учреждения (факт)"
          },
          "display": "Учреждения (факт)"
        },
        {
          "address": "F1",
          "raw": {
            "stringValue": "Программы (факт)"
          },
          "display": "Программы (факт)"
        },
        {
          "address": "G1",
          "raw": {
            "stringValue": "Мероприятия (факт)"
          },
          "display": "Мероприятия (факт)"
        },
        {
          "address": "E2",
          "raw": {
            "stringValue": "МКУ «ЦЭР»"
          },
          "display": "МКУ «ЦЭР»"
        },
        {
          "address": "F2",
          "raw": {
            "formulaValue": "=SORT(UNIQUE(FILTER('ВСЕ'!D4:D; 'ВСЕ'!D4:D<>\"\")))"
          },
          "display": "Создание условий для развития отдельных направлений экономики Елизовского муниципального района на 2025–2029 годы"
        },
        {
          "address": "G2",
          "raw": {
            "formulaValue": "=SORT(UNIQUE(FILTER('ВСЕ'!E4:E; 'ВСЕ'!E4:E<>\"\")))"
          },
          "display": "2.3.2. Организация выставочной и/или ярмарочной деятельности субъектов малого и среднего предпринимательства"
        }
      ]
    },
    {
      "name": "УИО",
      "id": "1qCBY5EDSASxK6_ZPQbxzdF8cKIjcwcuykbnOc45Ukn8",
      "main": "УИО",
      "sheetId": 509983877,
      "rowCount": 1000,
      "entries": [
        {
          "address": "E1",
          "raw": {
            "stringValue": "Учреждения (факт)"
          },
          "display": "Учреждения (факт)"
        },
        {
          "address": "F1",
          "raw": {
            "stringValue": "Программы (факт)"
          },
          "display": "Программы (факт)"
        },
        {
          "address": "G1",
          "raw": {
            "stringValue": "Мероприятия (факт)"
          },
          "display": "Мероприятия (факт)"
        },
        {
          "address": "E2",
          "raw": {
            "formulaValue": "=SORT(UNIQUE(FILTER('УИО'!C4:C; 'УИО'!C4:C<>\"\")))"
          },
          "display": "Х"
        },
        {
          "address": "F2",
          "raw": {
            "formulaValue": "=SORT(UNIQUE(FILTER('УИО'!D4:D; 'УИО'!D4:D<>\"\")))"
          },
          "display": "«Совершенствование управления муниципальным имуществом Елизовского муниципального района на 2025 – 2029 годы»"
        },
        {
          "address": "G2",
          "raw": {
            "formulaValue": "=SORT(UNIQUE(FILTER('УИО'!E4:E; 'УИО'!E4:E<>\"\")))"
          },
          "display": "Пункт 1.1.1. задачи 1 подпрограммы 1. Проведение кадастровых работ, изготовление технической документации в отношении объектов недвижимого имущества, принадлежащих на праве собственности Елизовскому муниципальному району, а также объектов, находящихся в частной собственности, с целью распоряжения земельными участками, принадлежащими Елизовскому муниципальному району."
        }
      ]
    },
    {
      "name": "УАГЗО",
      "id": "1DgO0t_Zx-PXmtLBp5ddkQvb2_pTkmyFKP_PaDqjOyXk",
      "main": "ВСЕ",
      "sheetId": 516797824,
      "rowCount": 1000,
      "entries": [
        {
          "address": "E1",
          "raw": {
            "stringValue": "Учреждения (факт)"
          },
          "display": "Учреждения (факт)"
        },
        {
          "address": "F1",
          "raw": {
            "stringValue": "Программы (факт)"
          },
          "display": "Программы (факт)"
        },
        {
          "address": "G1",
          "raw": {
            "stringValue": "Мероприятия (факт)"
          },
          "display": "Мероприятия (факт)"
        },
        {
          "address": "E2",
          "raw": {
            "stringValue": "МКУ «Елизовское РУС»"
          },
          "display": "МКУ «Елизовское РУС»"
        },
        {
          "address": "F2",
          "raw": {
            "formulaValue": "=SORT(UNIQUE(FILTER('ВСЕ'!D4:D; 'ВСЕ'!D4:D<>\"\")))"
          },
          "display": "Муниципальная программа «Развитие градостроительства и земельных отношений на территории Елизовского муниципального района на 2025-2029 годы\""
        },
        {
          "address": "G2",
          "raw": {
            "formulaValue": "=SORT(UNIQUE(FILTER('ВСЕ'!E4:E; 'ВСЕ'!E4:E<>\"\")))"
          },
          "display": "1.2.1. Проведение кадастровых работ по формированию земельных участков для подготовки документов для организации и проведения торгов"
        }
      ]
    },
    {
      "name": "УФБП",
      "id": "14A7vvvvPFxY3SKwtYnMsNfmn_kkxbxWSkN78cYBfszQ",
      "main": "УФБП",
      "sheetId": 89832808,
      "rowCount": 1000,
      "entries": [
        {
          "address": "E1",
          "raw": {
            "stringValue": "Учреждения (факт)"
          },
          "display": "Учреждения (факт)"
        },
        {
          "address": "F1",
          "raw": {
            "stringValue": "Программы (факт)"
          },
          "display": "Программы (факт)"
        },
        {
          "address": "G1",
          "raw": {
            "stringValue": "Мероприятия (факт)"
          },
          "display": "Мероприятия (факт)"
        },
        {
          "address": "E2",
          "raw": {
            "formulaValue": "=SORT(UNIQUE(FILTER('УФБП'!C4:C; 'УФБП'!C4:C<>\"\")))"
          },
          "display": "Х"
        },
        {
          "address": "F2",
          "raw": {
            "formulaValue": "=SORT(UNIQUE(FILTER('УФБП'!D4:D; 'УФБП'!D4:D<>\"\")))"
          },
          "display": "«Управление муниципальными финансами в Елизовском муниципальном районе на 2025-2029 годы»"
        },
        {
          "address": "G2",
          "raw": {
            "formulaValue": "=SORT(UNIQUE(FILTER('УФБП'!E4:E; 'УФБП'!E4:E<>\"\")))"
          },
          "display": "#REF!"
        },
        {
          "address": "G3",
          "raw": {
            "stringValue": "Подпрограмма 1. «Организация бюджетного процесса в Елизовском муниципальном районе».3"
          },
          "display": "Подпрограмма 1. «Организация бюджетного процесса в Елизовском муниципальном районе».3"
        },
        {
          "address": "G4",
          "raw": {
            "stringValue": "Подпрограмма 2. «Управление муниципальным долгом Елизовского муниципального района»."
          },
          "display": "Подпрограмма 2. «Управление муниципальным долгом Елизовского муниципального района»."
        }
      ]
    },
    {
      "name": "УД",
      "id": "1zrpgVaCyS4S4KBNMFuDleMJS-PSTonHmPY_bRLgTVsg",
      "main": "ВСЕ",
      "sheetId": 1286754396,
      "rowCount": 1000,
      "entries": [
        {
          "address": "E1",
          "raw": {
            "stringValue": "Учреждения (факт)"
          },
          "display": "Учреждения (факт)"
        },
        {
          "address": "F1",
          "raw": {
            "stringValue": "Программы (факт)"
          },
          "display": "Программы (факт)"
        },
        {
          "address": "G1",
          "raw": {
            "stringValue": "Мероприятия (факт)"
          },
          "display": "Мероприятия (факт)"
        },
        {
          "address": "E2",
          "raw": {
            "stringValue": "МКУ «ЕДДС»"
          },
          "display": "МКУ «ЕДДС»"
        },
        {
          "address": "F2",
          "raw": {
            "formulaValue": "=SORT(UNIQUE(FILTER('ВСЕ'!D4:D; 'ВСЕ'!D4:D<>\"\")))"
          },
          "display": "«Обеспечение защиты населения от чрезвычайных ситуаций и совершенствование гражданской обороны, профилактика правонарушений, экстремизма и терроризма в Елизовском муниципальном районе на 2025–2029 годы»"
        },
        {
          "address": "G2",
          "raw": {
            "formulaValue": "=SORT(UNIQUE(FILTER('ВСЕ'!E4:E; 'ВСЕ'!E4:E<>\"\")))"
          },
          "display": "#REF!"
        },
        {
          "address": "G3",
          "raw": {
            "stringValue": "8.1.2.1. Обеспечение деятельности подведомственных учреждений Управления делами Администрации Елизовского муниципального района 904 0412 0880009951 244"
          },
          "display": "8.1.2.1. Обеспечение деятельности подведомственных учреждений Управления делами Администрации Елизовского муниципального района 904 0412 0880009951 244"
        },
        {
          "address": "G4",
          "raw": {
            "stringValue": "8.1.2.1. Обеспечение деятельности подведомственных учреждений Управления делами Администрации Елизовского муниципального района 904 0412 0880040280244"
          },
          "display": "8.1.2.1. Обеспечение деятельности подведомственных учреждений Управления делами Администрации Елизовского муниципального района 904 0412 0880040280244"
        },
        {
          "address": "G5",
          "raw": {
            "stringValue": "8.1.2.1. Обеспечение деятельности подведомственных учреждений Управления делами Администрации Елизовского муниципального района 904 0412 0880040280 244"
          },
          "display": "8.1.2.1. Обеспечение деятельности подведомственных учреждений Управления делами Администрации Елизовского муниципального района 904 0412 0880040280 244"
        },
        {
          "address": "G6",
          "raw": {
            "stringValue": "8.1.2.1. Обеспечение деятельности подведомственных учреждений Управления делами Администрации Елизовского муниципального района 90404120880009951244, 90404120880040280244"
          },
          "display": "8.1.2.1. Обеспечение деятельности подведомственных учреждений Управления делами Администрации Елизовского муниципального района 90404120880009951244, 90404120880040280244"
        },
        {
          "address": "G9",
          "raw": {
            "stringValue": "8.1.1.1. Обеспечение деятельности Управления делами Администрации Елизовского муниципального района"
          },
          "display": "8.1.1.1. Обеспечение деятельности Управления делами Администрации Елизовского муниципального района"
        },
        {
          "address": "G10",
          "raw": {
            "stringValue": "8.1.1.1. Обеспечение деятельности Управления делами Администрации Елизовского муниципального района 10060880040260244"
          },
          "display": "8.1.1.1. Обеспечение деятельности Управления делами Администрации Елизовского муниципального района 10060880040260244"
        },
        {
          "address": "G11",
          "raw": {
            "stringValue": "8.1.1.1. Обеспечение деятельности Управления делами Администрации Елизовского муниципального района 10060880040260244, 01040880040100244"
          },
          "display": "8.1.1.1. Обеспечение деятельности Управления делами Администрации Елизовского муниципального района 10060880040260244, 01040880040100244"
        },
        {
          "address": "G12",
          "raw": {
            "stringValue": "8.1.1.1. Обеспечение деятельности Управления делами Администрации Елизовского муниципального района 904 0104 0880010010 242"
          },
          "display": "8.1.1.1. Обеспечение деятельности Управления делами Администрации Елизовского муниципального района 904 0104 0880010010 242"
        },
        {
          "address": "G24",
          "raw": {
            "stringValue": "8.1.2.1. Обеспечение деятельности подведомственных учреждений Управления делами Администрации Елизовского муниципального района 904 0412 0880009951 244, 904 0412 0880040280244"
          },
          "display": "8.1.2.1. Обеспечение деятельности подведомственных учреждений Управления делами Администрации Елизовского муниципального района 904 0412 0880009951 244, 904 0412 0880040280244"
        },
        {
          "address": "G51",
          "raw": {
            "stringValue": "МСОН 1.1.2. Создание, развитие и содержание муниципальной автоматизированной системы экстренного оповещения населения Елизовского муниципального района при угрозе возникновения или о возникновении чрезвычайных ситуаций природного и техногенного характера ЕМР"
          },
          "display": "МСОН 1.1.2. Создание, развитие и содержание муниципальной автоматизированной системы экстренного оповещения населения Елизовского муниципального района при угрозе возникновения или о возникновении чрезвычайных ситуаций природного и техногенного характера ЕМР"
        },
        {
          "address": "G52",
          "raw": {
            "stringValue": "МСОН 1.1.2. Создание, развитие и содержание муниципальной автоматизированной системы экстренного оповещения населения Елизовского муниципального района при угрозе возникновения или о возникновении чрезвычайных ситуаций природного и техногенного характера ЕМР 90403100009990244"
          },
          "display": "МСОН 1.1.2. Создание, развитие и содержание муниципальной автоматизированной системы экстренного оповещения населения Елизовского муниципального района при угрозе возникновения или о возникновении чрезвычайных ситуаций природного и техногенного характера ЕМР 90403100009990244"
        },
        {
          "address": "G77",
          "raw": {
            "stringValue": "Подпрограмма 4. «Поддержка общественных и гражданских инициатив в Елизовском муниципальном районе». 904 0113 0840040840 244; 904 0113 08400T0840 244"
          },
          "display": "Подпрограмма 4. «Поддержка общественных и гражданских инициатив в Елизовском муниципальном районе». 904 0113 0840040840 244; 904 0113 08400T0840 244"
        }
      ]
    },
    {
      "name": "УДТХ",
      "id": "1bxh-mRLQ_ODsdpZ4JW2JJ8sOMjg4zJRhPydR6vjzqb4",
      "main": "УДТХ",
      "sheetId": 1650929221,
      "rowCount": 1000,
      "entries": [
        {
          "address": "E1",
          "raw": {
            "stringValue": "Учреждения (факт)"
          },
          "display": "Учреждения (факт)"
        },
        {
          "address": "F1",
          "raw": {
            "stringValue": "Программы (факт)"
          },
          "display": "Программы (факт)"
        },
        {
          "address": "G1",
          "raw": {
            "stringValue": "Мероприятия (факт)"
          },
          "display": "Мероприятия (факт)"
        },
        {
          "address": "E2",
          "raw": {
            "formulaValue": "=SORT(UNIQUE(FILTER('УДТХ'!C4:C; 'УДТХ'!C4:C<>\"\")))"
          },
          "display": "Х"
        },
        {
          "address": "F2",
          "raw": {
            "formulaValue": "=SORT(UNIQUE(FILTER('УДТХ'!D4:D; 'УДТХ'!D4:D<>\"\")))"
          },
          "display": "«Развитие дорожно-транспортной системы, коммунального хозяйства, улучшение санитарно-экологического состояния территории Елизовского муниципального района на 2025-2029»"
        },
        {
          "address": "G2",
          "raw": {
            "formulaValue": "=SORT(UNIQUE(FILTER('УДТХ'!E4:E; 'УДТХ'!E4:E<>\"\")))"
          },
          "display": "#REF!"
        },
        {
          "address": "G11",
          "raw": {
            "stringValue": "1.2.3. Изготовление и размещение информационных материалов по вопросам повышения экологической культуры населения Елизовского муниципального района. 3.1.5 Изготовление и размещение информационных материалов о необходимости соблюдения гражданами безопасности дорожного движения 4.1.1. Изготовление и размещение информационных материалов по вопросам соблюдения населением пожарной безопасности в лесах"
          },
          "display": "1.2.3. Изготовление и размещение информационных материалов по вопросам повышения экологической культуры населения Елизовского муниципального района. 3.1.5 Изготовление и размещение информационных материалов о необходимости соблюдения гражданами безопасности дорожного движения 4.1.1. Изготовление и размещение информационных материалов по вопросам соблюдения населением пожарной безопасности в лесах"
        }
      ]
    },
    {
      "name": "УКСиМП",
      "id": "1aFAw9AfNxkTVCqwp6G6fchn3ZeDi8FwFu5-xgRSo7aI",
      "main": "ВСЕ",
      "sheetId": 316734208,
      "rowCount": 1000,
      "entries": [
        {
          "address": "E1",
          "raw": {
            "stringValue": "Учреждения (факт)"
          },
          "display": "Учреждения (факт)"
        },
        {
          "address": "F1",
          "raw": {
            "stringValue": "Программы (факт)"
          },
          "display": "Программы (факт)"
        },
        {
          "address": "G1",
          "raw": {
            "stringValue": "Мероприятия (факт)"
          },
          "display": "Мероприятия (факт)"
        },
        {
          "address": "E2",
          "raw": {
            "stringValue": "МБУ ДО «КДМШ»"
          },
          "display": "МБУ ДО «КДМШ»"
        },
        {
          "address": "F2",
          "raw": {
            "formulaValue": "=SORT(UNIQUE(FILTER('ВСЕ'!D4:D; 'ВСЕ'!D4:D<>\"\")))"
          },
          "display": "#REF!"
        },
        {
          "address": "G2",
          "raw": {
            "formulaValue": "=SORT(UNIQUE(FILTER('ВСЕ'!E4:E; 'ВСЕ'!E4:E<>\"\")))"
          },
          "display": "#REF!"
        },
        {
          "address": "E3",
          "raw": {
            "stringValue": "МБУ ДО «НДШИ»"
          },
          "display": "МБУ ДО «НДШИ»"
        },
        {
          "address": "F3",
          "raw": {
            "stringValue": "МП «Развитие культуры, физической культуры, спорта и молодежной политики в Елизовском муниципальном районе на 2025-2029 годы»"
          },
          "display": "МП «Развитие культуры, физической культуры, спорта и молодежной политики в Елизовском муниципальном районе на 2025-2029 годы»"
        },
        {
          "address": "G3",
          "raw": {
            "stringValue": "Задача 1 программы 3. Профилактика преступности, правонарушений, в том числе среди несовершеннолетних в Елизовском муниципальном районе.\n3.1.1.1. Районный конкурс учащихся муниципальных бюджетных учреждений дополнительного образования ЕМР \"Путь к успеху\""
          },
          "display": "Задача 1 программы 3. Профилактика преступности, правонарушений, в том числе среди несовершеннолетних в Елизовском муниципальном районе.\n3.1.1.1. Районный конкурс учащихся муниципальных бюджетных учреждений дополнительного образования ЕМР \"Путь к успеху\""
        },
        {
          "address": "E4",
          "raw": {
            "stringValue": "МБУ ДО «РДМШ»"
          },
          "display": "МБУ ДО «РДМШ»"
        },
        {
          "address": "G4",
          "raw": {
            "stringValue": "Задача 1 программы 3. Профилактика преступности, правонарушений, в том числе среди несовершеннолетних в Елизовском муниципальном районе.\n3.1.1.2. Фестиваль \"Салютует детство\""
          },
          "display": "Задача 1 программы 3. Профилактика преступности, правонарушений, в том числе среди несовершеннолетних в Елизовском муниципальном районе.\n3.1.1.2. Фестиваль \"Салютует детство\""
        },
        {
          "address": "E5",
          "raw": {
            "stringValue": "МБУ ДО «ДШИ п. Термальный»"
          },
          "display": "МБУ ДО «ДШИ п. Термальный»"
        },
        {
          "address": "G5",
          "raw": {
            "stringValue": "Задача 3 подпрограммы 3. Проведение профилактических мероприятий по сокращению незаконного потребления наркотических средств и психотропных веществ, злоупотребления алкогольной продукцией среди населения Елизовского муниципального района.\n3.3.1.1.4. Огранизация и проведение Всероссийского дня физкультурника"
          },
          "display": "Задача 3 подпрограммы 3. Проведение профилактических мероприятий по сокращению незаконного потребления наркотических средств и психотропных веществ, злоупотребления алкогольной продукцией среди населения Елизовского муниципального района.\n3.3.1.1.4. Огранизация и проведение Всероссийского дня физкультурника"
        },
        {
          "address": "G6",
          "raw": {
            "stringValue": "п/п 1. «Сохранение и развитие сферы культуры на территории ЕМР»\n\n1.4. Реализация мероприятий региональных проектов «Семейные ценности и ифраструктура культуры»"
          },
          "display": "п/п 1. «Сохранение и развитие сферы культуры на территории ЕМР»\n\n1.4. Реализация мероприятий региональных проектов «Семейные ценности и ифраструктура культуры»"
        },
        {
          "address": "G7",
          "raw": {
            "stringValue": "п/п 5. «Осуществление отдельных государственных полномочий, обеспечение реализации муниципальной программы и деятельности муниципальных учреждений культуры и спорта в Елизовском муниципальном районе».\n\n5.1.3. Обеспечение деятельности МКУ «Центр бухгалтерского и административно-хозяйственного обеспечения учреждений культуры и спорта»."
          },
          "display": "п/п 5. «Осуществление отдельных государственных полномочий, обеспечение реализации муниципальной программы и деятельности муниципальных учреждений культуры и спорта в Елизовском муниципальном районе».\n\n5.1.3. Обеспечение деятельности МКУ «Центр бухгалтерского и административно-хозяйственного обеспечения учреждений культуры и спорта»."
        },
        {
          "address": "G8",
          "raw": {
            "stringValue": "\"п/п 5. «Осуществление отдельных государственных полномочий, обеспечение реализации муниципальной программы и деятельности муниципальных учреждений культуры и спорта в Елизовском муниципальном районе».\n\n5.1.4. Обеспечение деятельности учреждений культуры на территории Елизовского муниципального района.\""
          },
          "display": "\"п/п 5. «Осуществление отдельных государственных полномочий, обеспечение реализации муниципальной программы и деятельности муниципальных учреждений культуры и спорта в Елизовском муниципальном районе».\n\n5.1.4. Обеспечение деятельности учреждений культуры на территории Елизовского муниципального района.\""
        },
        {
          "address": "E9",
          "raw": {
            "stringValue": "МБУ ДО СШ «Лидер»"
          },
          "display": "МБУ ДО СШ «Лидер»"
        },
        {
          "address": "G9",
          "raw": {
            "stringValue": "2.1.1. Организация и проведение спортивно-массовых мероприятий Елизовского муниципального района, согласно календарному плану в том числе расходы по подготовке соревнований, 2\"Развитие физ.культуры и спорта в ЕМР.\" (награждение участников команд \"Кубок ЕМР по волейболу \"Играем за СВОих-100000, Кубок ЕМР по мини-футболу-175000)"
          },
          "display": "2.1.1. Организация и проведение спортивно-массовых мероприятий Елизовского муниципального района, согласно календарному плану в том числе расходы по подготовке соревнований, 2\"Развитие физ.культуры и спорта в ЕМР.\" (награждение участников команд \"Кубок ЕМР по волейболу \"Играем за СВОих-100000, Кубок ЕМР по мини-футболу-175000)"
        },
        {
          "address": "E10",
          "raw": {
            "stringValue": "МБУ ДО СШ «Ратибор»"
          },
          "display": "МБУ ДО СШ «Ратибор»"
        },
        {
          "address": "G10",
          "raw": {
            "stringValue": "2.1.1. \"Развитие физ.культуры и спорта в ЕМР.\" (приобретение формы баскетб)"
          },
          "display": "2.1.1. \"Развитие физ.культуры и спорта в ЕМР.\" (приобретение формы баскетб)"
        },
        {
          "address": "E11",
          "raw": {
            "stringValue": "МБУ ДО СШОР единоборств «КРЕЧЕТ»"
          },
          "display": "МБУ ДО СШОР единоборств «КРЕЧЕТ»"
        },
        {
          "address": "G13",
          "raw": {
            "stringValue": "3.1.1.5. Ежегодная премия одарённым детям и талантливой молодежи Елизовского муниципального района"
          },
          "display": "3.1.1.5. Ежегодная премия одарённым детям и талантливой молодежи Елизовского муниципального района"
        },
        {
          "address": "E14",
          "raw": {
            "stringValue": "МБУК «Елизовский районный зоопарк»"
          },
          "display": "МБУК «Елизовский районный зоопарк»"
        },
        {
          "address": "E15",
          "raw": {
            "stringValue": "МБУК «ЕРКМ» (Музей)"
          },
          "display": "МБУК «ЕРКМ» (Музей)"
        },
        {
          "address": "G17",
          "raw": {
            "stringValue": "Задача 3 подпрограммы 1. Модернизация и совершенствование материально-технической базы учреждений культуры и искусства Елизовского муниципального района в соответствии с современными требованиями.\n1.3.1.1.1. Приобретение компьютерной техники, звуковой,световой и музыкальной аппарвтуры и мебели для учреждений культуры и дополнительногот образования, подведомственных УКСиМП"
          },
          "display": "Задача 3 подпрограммы 1. Модернизация и совершенствование материально-технической базы учреждений культуры и искусства Елизовского муниципального района в соответствии с современными требованиями.\n1.3.1.1.1. Приобретение компьютерной техники, звуковой,световой и музыкальной аппарвтуры и мебели для учреждений культуры и дополнительногот образования, подведомственных УКСиМП"
        },
        {
          "address": "G18",
          "raw": {
            "stringValue": "Задача 3 подпрограммы 1. Модернизация и совершенствование материально-технической базы учреждений культуры и искусства Елизовского муниципального района в соответствии с современными требованиями.\n1.3.1.1.2. Приобретение компьютерной техники, звуковой, световой и музыкальной аппаратуры и мебели для учреждений культуры и дополнительного образования, подведомственных УКСиМП"
          },
          "display": "Задача 3 подпрограммы 1. Модернизация и совершенствование материально-технической базы учреждений культуры и искусства Елизовского муниципального района в соответствии с современными требованиями.\n1.3.1.1.2. Приобретение компьютерной техники, звуковой, световой и музыкальной аппаратуры и мебели для учреждений культуры и дополнительного образования, подведомственных УКСиМП"
        },
        {
          "address": "E19",
          "raw": {
            "stringValue": "МБУК МДКМ «Юность»"
          },
          "display": "МБУК МДКМ «Юность»"
        },
        {
          "address": "G19",
          "raw": {
            "stringValue": "Задача 3 подпрограммы 1. Модернизация и совершенствование материально-технической базы учреждений культуры и искусства Елизовского муниципального района в соответствии с современными требованиями.\n1.3.1.1.3. Приобретение компьютерной техники, звуковой,световой и музыкальной аппаратуры и мебели для учреждений культуры и дополнительногот образования, подведомственных УКСиМП"
          },
          "display": "Задача 3 подпрограммы 1. Модернизация и совершенствование материально-технической базы учреждений культуры и искусства Елизовского муниципального района в соответствии с современными требованиями.\n1.3.1.1.3. Приобретение компьютерной техники, звуковой,световой и музыкальной аппаратуры и мебели для учреждений культуры и дополнительногот образования, подведомственных УКСиМП"
        },
        {
          "address": "G20",
          "raw": {
            "stringValue": "Задача 3 подпрограммы 1. Модернизация и совершенствование материально-технической базы учреждений культуры и искусства Елизовского муниципального района в соответствии с современными требованиями.\n1.3.1.1.4. Приобретение компьютерной техники, звуковой,световой и музыкальной аппаратуры и мебели для учреждений культуры и дополнительногот образования, подведомственных УКСиМПП"
          },
          "display": "Задача 3 подпрограммы 1. Модернизация и совершенствование материально-технической базы учреждений культуры и искусства Елизовского муниципального района в соответствии с современными требованиями.\n1.3.1.1.4. Приобретение компьютерной техники, звуковой,световой и музыкальной аппаратуры и мебели для учреждений культуры и дополнительногот образования, подведомственных УКСиМПП"
        },
        {
          "address": "E21",
          "raw": {
            "stringValue": "МКУ «Центр бухгалтерского и административно-хозяйственного обеспечения учреждений культуры и спорта»"
          },
          "display": "МКУ «Центр бухгалтерского и административно-хозяйственного обеспечения учреждений культуры и спорта»"
        },
        {
          "address": "G21",
          "raw": {
            "stringValue": "Задача 1 подпрограммы 1. Создание условий для сохранения, развития, поддержки системы дополнительного образования, молодых дарований и самодеятельного народного художественного творчества в сфере культуры на территории Елизовского муниципального района.\n1. 1.1.4.3. Подготовка и проведение районных культурно-массовых мероприятий (День работника культуры, День космонавтики) (СУБСИДИЯ НА ИНЫЕ ЦЕЛИ)."
          },
          "display": "Задача 1 подпрограммы 1. Создание условий для сохранения, развития, поддержки системы дополнительного образования, молодых дарований и самодеятельного народного художественного творчества в сфере культуры на территории Елизовского муниципального района.\n1. 1.1.4.3. Подготовка и проведение районных культурно-массовых мероприятий (День работника культуры, День космонавтики) (СУБСИДИЯ НА ИНЫЕ ЦЕЛИ)."
        },
        {
          "address": "G22",
          "raw": {
            "stringValue": "Задача 1 подпрограммы 1. Создание условий для сохранения, развития, поддержки системы дополнительного образования, молодых дарований и самодеятельного народного художественного творчества в сфере культуры на территории Елизовского муниципального района.\n1.1.1.2. Ежегодная премия одаренным детям,талантливой молодежи Елизовского муниципального района"
          },
          "display": "Задача 1 подпрограммы 1. Создание условий для сохранения, развития, поддержки системы дополнительного образования, молодых дарований и самодеятельного народного художественного творчества в сфере культуры на территории Елизовского муниципального района.\n1.1.1.2. Ежегодная премия одаренным детям,талантливой молодежи Елизовского муниципального района"
        },
        {
          "address": "G23",
          "raw": {
            "stringValue": "Задача 1 подпрограммы 1. Создание условий для сохранения, развития, поддержки системы дополнительного образования, молодых дарований и самодеятельного народного художественного творчества в сфере культуры на территории Елизовского муниципального района.\n1.1.1.4.2. Подготовка и проведение районных культурно-массовых мероприятий (Елизовский спирнт - 2026) (СУБСИДИЯ НА ИНЫЕ ЦЕЛИ)"
          },
          "display": "Задача 1 подпрограммы 1. Создание условий для сохранения, развития, поддержки системы дополнительного образования, молодых дарований и самодеятельного народного художественного творчества в сфере культуры на территории Елизовского муниципального района.\n1.1.1.4.2. Подготовка и проведение районных культурно-массовых мероприятий (Елизовский спирнт - 2026) (СУБСИДИЯ НА ИНЫЕ ЦЕЛИ)"
        },
        {
          "address": "G24",
          "raw": {
            "stringValue": "Задача 1 подпрограммы 1. Создание условий для сохранения, развития, поддержки системы дополнительного образования, молодых дарований и самодеятельного народного художественного творчества в сфере культуры на территории Елизовского муниципального района.\n1.1.1.4.4. Подготовка и проведение районных культурно-массовых мероприятий (\"Библионочь\") (СУБСИДИЯ НА ИНЫЕ ЦЕЛИ)."
          },
          "display": "Задача 1 подпрограммы 1. Создание условий для сохранения, развития, поддержки системы дополнительного образования, молодых дарований и самодеятельного народного художественного творчества в сфере культуры на территории Елизовского муниципального района.\n1.1.1.4.4. Подготовка и проведение районных культурно-массовых мероприятий (\"Библионочь\") (СУБСИДИЯ НА ИНЫЕ ЦЕЛИ)."
        },
        {
          "address": "G25",
          "raw": {
            "stringValue": "Задача 1 подпрограммы 1. Создание условий для сохранения, развития, поддержки системы дополнительного образования, молодых дарований и самодеятельного народного художественного творчества в сфере культуры на территории Елизовского муниципального района.\n1.1.1.4.5. Мероприятие «Ночь музеев» - Расходы согласно смете запланированы на приобретение тематической сувенирной продукции"
          },
          "display": "Задача 1 подпрограммы 1. Создание условий для сохранения, развития, поддержки системы дополнительного образования, молодых дарований и самодеятельного народного художественного творчества в сфере культуры на территории Елизовского муниципального района.\n1.1.1.4.5. Мероприятие «Ночь музеев» - Расходы согласно смете запланированы на приобретение тематической сувенирной продукции"
        },
        {
          "address": "G26",
          "raw": {
            "stringValue": "Задача 1 подпрограммы 1. Создание условий для сохранения, развития, поддержки системы дополнительного образования, молодых дарований и самодеятельного народного художественного творчества в сфере культуры на территории Елизовского муниципального района.\n1.1.1.4.6. Подготовка и проведение районных культурно-массовых мероприятий (Цикл праздничных мероприятий, посвященных 81-годовщине Победы в ВОВ 1941-1945 гг.) (СУБСИДИЯ НА ИНЫЕ ЦЕЛИ)"
          },
          "display": "Задача 1 подпрограммы 1. Создание условий для сохранения, развития, поддержки системы дополнительного образования, молодых дарований и самодеятельного народного художественного творчества в сфере культуры на территории Елизовского муниципального района.\n1.1.1.4.6. Подготовка и проведение районных культурно-массовых мероприятий (Цикл праздничных мероприятий, посвященных 81-годовщине Победы в ВОВ 1941-1945 гг.) (СУБСИДИЯ НА ИНЫЕ ЦЕЛИ)"
        },
        {
          "address": "G27",
          "raw": {
            "stringValue": "Задача 1 подпрограммы 1. Создание условий для сохранения, развития, поддержки системы дополнительного образования, молодых дарований и самодеятельного народного художественного творчества в сфере культуры на территории Елизовского муниципального района.\n1.1.1.4.7. Подготовка и проведение районных культурно-массовых мероприятий (согласно календарному плану) (СУБСИДИЯ НА ИНЫЕ ЦЕЛИ). «Мы славяне»"
          },
          "display": "Задача 1 подпрограммы 1. Создание условий для сохранения, развития, поддержки системы дополнительного образования, молодых дарований и самодеятельного народного художественного творчества в сфере культуры на территории Елизовского муниципального района.\n1.1.1.4.7. Подготовка и проведение районных культурно-массовых мероприятий (согласно календарному плану) (СУБСИДИЯ НА ИНЫЕ ЦЕЛИ). «Мы славяне»"
        },
        {
          "address": "G28",
          "raw": {
            "stringValue": "Задача 1 подпрограммы 1. Создание условий для сохранения, развития, поддержки системы дополнительного образования, молодых дарований и самодеятельного народного художественного творчества в сфере культуры на территории Елизовского муниципального района.\n1.1.1.4.9. Чевствование трудовых и творческих коллективов, работников с профессиональными празниками, юбилейными датами, победой в конкурсах и т.д.(СУБСИДИЯ НА ИНЫЕ ЦЕЛИ)."
          },
          "display": "Задача 1 подпрограммы 1. Создание условий для сохранения, развития, поддержки системы дополнительного образования, молодых дарований и самодеятельного народного художественного творчества в сфере культуры на территории Елизовского муниципального района.\n1.1.1.4.9. Чевствование трудовых и творческих коллективов, работников с профессиональными празниками, юбилейными датами, победой в конкурсах и т.д.(СУБСИДИЯ НА ИНЫЕ ЦЕЛИ)."
        },
        {
          "address": "G29",
          "raw": {
            "stringValue": "Задача 1 подпрограммы 6. Выполнение работ по капитальному ремонту, реконструкции и строительству объектов социальной сферы культуры и спорта на территории Елизовского муниципального района.\n6.1.1.1. Капитальный ремонт крыльца здания Муниципального бюджетного учреждения дополнительного образования «Елизовская детская художественная школа» имени Лузина Михаила Александровича (СУБСИДИЯ НА ИНЫЕ ЦЕЛИ)"
          },
          "display": "Задача 1 подпрограммы 6. Выполнение работ по капитальному ремонту, реконструкции и строительству объектов социальной сферы культуры и спорта на территории Елизовского муниципального района.\n6.1.1.1. Капитальный ремонт крыльца здания Муниципального бюджетного учреждения дополнительного образования «Елизовская детская художественная школа» имени Лузина Михаила Александровича (СУБСИДИЯ НА ИНЫЕ ЦЕЛИ)"
        },
        {
          "address": "G30",
          "raw": {
            "stringValue": "Задача 1 подпрограммы 1. Создание условий для сохранения, развития, поддержки системы дополнительного образования, молодых дарований и самодеятельного народного художественного творчества в сфере культуры на территории Елизовского муниципального района.\n1.1.1.1. Поддержка молодых дарований для детей и работников учреждений культуры, школ дополнительного образования подведомственных УКС и МП, путем обеспечения их участия во всероссийских и международных конкурсах, теоретических олимпиадах, фестивалях, выставках и иных мероприятиях (СУБСИДИЯ НА ИНЫЕ ЦЕЛИ)."
          },
          "display": "Задача 1 подпрограммы 1. Создание условий для сохранения, развития, поддержки системы дополнительного образования, молодых дарований и самодеятельного народного художественного творчества в сфере культуры на территории Елизовского муниципального района.\n1.1.1.1. Поддержка молодых дарований для детей и работников учреждений культуры, школ дополнительного образования подведомственных УКС и МП, путем обеспечения их участия во всероссийских и международных конкурсах, теоретических олимпиадах, фестивалях, выставках и иных мероприятиях (СУБСИДИЯ НА ИНЫЕ ЦЕЛИ)."
        },
        {
          "address": "G31",
          "raw": {
            "stringValue": "Задача 1 подпрограммы 1. Создание условий для сохранения, развития, поддержки системы дополнительного образования, молодых дарований и самодеятельного народного художественного творчества в сфере культуры на территории Елизовского муниципального района.\n1.1.1.1. Поддержка молодых дарований для детей и работников учреждений культуры, школ дополнительного образования подведомственных УКС и МП, путем обеспечения их участия во всероссийских и международных конкурсах, теоретических олимпиадах, фестивалях, выставках и иных мероприятиях (СУБСИДИЯ НА ИНЫЕ ЦЕЛИ)."
          },
          "display": "Задача 1 подпрограммы 1. Создание условий для сохранения, развития, поддержки системы дополнительного образования, молодых дарований и самодеятельного народного художественного творчества в сфере культуры на территории Елизовского муниципального района.\n1.1.1.1. Поддержка молодых дарований для детей и работников учреждений культуры, школ дополнительного образования подведомственных УКС и МП, путем обеспечения их участия во всероссийских и международных конкурсах, теоретических олимпиадах, фестивалях, выставках и иных мероприятиях (СУБСИДИЯ НА ИНЫЕ ЦЕЛИ)."
        },
        {
          "address": "G32",
          "raw": {
            "stringValue": "Задача 1 подпрограммы 1. Создание условий для сохранения, развития, поддержки системы дополнительного образования, молодых дарований и самодеятельного народного художественного творчества в сфере культуры на территории Елизовского муниципального района.\n1.1.1.1. Поддержка молодых дарований для детей и работников учреждений культуры, школ дополнительного образования подведомственных УКС и МП, путем обеспечения их участия во всероссийских и международных конкурсах, теоретических олимпиадах, фестивалях, выставках и иных мероприятиях (СУБСИДИЯ НА ИНЫЕ ЦЕЛИ)."
          },
          "display": "Задача 1 подпрограммы 1. Создание условий для сохранения, развития, поддержки системы дополнительного образования, молодых дарований и самодеятельного народного художественного творчества в сфере культуры на территории Елизовского муниципального района.\n1.1.1.1. Поддержка молодых дарований для детей и работников учреждений культуры, школ дополнительного образования подведомственных УКС и МП, путем обеспечения их участия во всероссийских и международных конкурсах, теоретических олимпиадах, фестивалях, выставках и иных мероприятиях (СУБСИДИЯ НА ИНЫЕ ЦЕЛИ)."
        },
        {
          "address": "G33",
          "raw": {
            "stringValue": "Задача 1 подпрограммы 1. Создание условий для сохранения, развития, поддержки системы дополнительного образования, молодых дарований и самодеятельного народного художественного творчества в сфере культуры на территории Елизовского муниципального района.\n1.1.1.3. Поддержка национальных и казачьих ансамблей, работающих на базе учреждений культуры, подведомственных УКС и МП, для укрепления материально-технической базы и участия во всероссийских, международных и краевых конкурсах и фестивалях (оплата проезда, проживания, оформления выездных документов) (СУБСИДИЯ НА ИНЫЕ ЦЕЛИ)"
          },
          "display": "Задача 1 подпрограммы 1. Создание условий для сохранения, развития, поддержки системы дополнительного образования, молодых дарований и самодеятельного народного художественного творчества в сфере культуры на территории Елизовского муниципального района.\n1.1.1.3. Поддержка национальных и казачьих ансамблей, работающих на базе учреждений культуры, подведомственных УКС и МП, для укрепления материально-технической базы и участия во всероссийских, международных и краевых конкурсах и фестивалях (оплата проезда, проживания, оформления выездных документов) (СУБСИДИЯ НА ИНЫЕ ЦЕЛИ)"
        },
        {
          "address": "G35",
          "raw": {
            "stringValue": "Задача 1 подпрограммы 2. Развитие физической культуры и спорта, привлечение к регулярным занятиям физической культурой и массовым спортом населения Елизовского муниципального района.\n2.1.1.1.2. Организация и проведение спортивно-массовых мероприятий Елизовского муниципального района, согласно календарного плана в том числе, подведение спортивных итогов года, чевствование юбиляров спорта, приобретение патронов и т.д. (СУБСИДИЯ НА ИНЫЕ ЦЕЛИ)."
          },
          "display": "Задача 1 подпрограммы 2. Развитие физической культуры и спорта, привлечение к регулярным занятиям физической культурой и массовым спортом населения Елизовского муниципального района.\n2.1.1.1.2. Организация и проведение спортивно-массовых мероприятий Елизовского муниципального района, согласно календарного плана в том числе, подведение спортивных итогов года, чевствование юбиляров спорта, приобретение патронов и т.д. (СУБСИДИЯ НА ИНЫЕ ЦЕЛИ)."
        },
        {
          "address": "G36",
          "raw": {
            "stringValue": "Задача 1 подпрограммы 2. Развитие физической культуры и спорта, привлечение к регулярным занятиям физической культурой и массовым спортом населения Елизовского муниципального района.\n2.1.1.1.3. Организация и проведение спортивно-массовых мероприятия \"Елизовский спринт-2026\" (СУБСИДИЯ НА ИНЫЕ ЦЕЛИ)."
          },
          "display": "Задача 1 подпрограммы 2. Развитие физической культуры и спорта, привлечение к регулярным занятиям физической культурой и массовым спортом населения Елизовского муниципального района.\n2.1.1.1.3. Организация и проведение спортивно-массовых мероприятия \"Елизовский спринт-2026\" (СУБСИДИЯ НА ИНЫЕ ЦЕЛИ)."
        },
        {
          "address": "G37",
          "raw": {
            "stringValue": "Задача 1 подпрограммы 2. Развитие физической культуры и спорта, привлечение к регулярным занятиям физической культурой и массовым спортом населения Елизовского муниципального района.\n2.1.1.1.4. Организация участия сборной команды ЕМР в краевых \"Сельских играх\" (СУБСИДИЯ НА ИНЫЕ ЦЕЛИ)."
          },
          "display": "Задача 1 подпрограммы 2. Развитие физической культуры и спорта, привлечение к регулярным занятиям физической культурой и массовым спортом населения Елизовского муниципального района.\n2.1.1.1.4. Организация участия сборной команды ЕМР в краевых \"Сельских играх\" (СУБСИДИЯ НА ИНЫЕ ЦЕЛИ)."
        },
        {
          "address": "G38",
          "raw": {
            "stringValue": "Задача 1 подпрограммы 2. Развитие физической культуры и спорта, привлечение к регулярным занятиям физической культурой и массовым спортом населения Елизовского муниципального района.\n2.1.1.1.5. Приобретение наградной атрибутики с официальной символикой ВФСК ГТО для награждения участников фестивалей и акций комплекса ГТО, проводимых на территории ЕМР (СУБСИДИЯ НА ИНЫЕ ЦЕЛИ)."
          },
          "display": "Задача 1 подпрограммы 2. Развитие физической культуры и спорта, привлечение к регулярным занятиям физической культурой и массовым спортом населения Елизовского муниципального района.\n2.1.1.1.5. Приобретение наградной атрибутики с официальной символикой ВФСК ГТО для награждения участников фестивалей и акций комплекса ГТО, проводимых на территории ЕМР (СУБСИДИЯ НА ИНЫЕ ЦЕЛИ)."
        },
        {
          "address": "G39",
          "raw": {
            "stringValue": "Задача 1 подпрограммы 2. Развитие физической культуры и спорта, привлечение к регулярным занятиям физической культурой и массовым спортом населения Елизовского муниципального района.\n2.1.1.1.6. Приобретение патронов для проведения мероприятий"
          },
          "display": "Задача 1 подпрограммы 2. Развитие физической культуры и спорта, привлечение к регулярным занятиям физической культурой и массовым спортом населения Елизовского муниципального района.\n2.1.1.1.6. Приобретение патронов для проведения мероприятий"
        },
        {
          "address": "G40",
          "raw": {
            "stringValue": "Задача 1 подпрограммы 3. Создание условий для гражданского становления, патриотического, духовно-нравственного воспитания молодежи, развитие волонтерства и добровольчества в Елизовском муниципальном районе.\n3.1.1.1. Проведение торженственных митингов, возложений, патрниотических акций (согласно календарного плана мероприятий) (СУБСИДИЯ НА ИНЫЕ ЦЕЛИ)."
          },
          "display": "Задача 1 подпрограммы 3. Создание условий для гражданского становления, патриотического, духовно-нравственного воспитания молодежи, развитие волонтерства и добровольчества в Елизовском муниципальном районе.\n3.1.1.1. Проведение торженственных митингов, возложений, патрниотических акций (согласно календарного плана мероприятий) (СУБСИДИЯ НА ИНЫЕ ЦЕЛИ)."
        },
        {
          "address": "G41",
          "raw": {
            "stringValue": "Задача 1 подпрограммы 3. Создание условий для гражданского становления, патриотического, духовно-нравственного воспитания молодежи, развитие волонтерства и добровольчества в Елизовском муниципальном районе.\n3.1.1.2. Проведение мероприятий по молодежной политике (Молодежный фестиваль Косплей) (СУБСИДИЯ НА ИНЫЕ ЦЕЛИ)."
          },
          "display": "Задача 1 подпрограммы 3. Создание условий для гражданского становления, патриотического, духовно-нравственного воспитания молодежи, развитие волонтерства и добровольчества в Елизовском муниципальном районе.\n3.1.1.2. Проведение мероприятий по молодежной политике (Молодежный фестиваль Косплей) (СУБСИДИЯ НА ИНЫЕ ЦЕЛИ)."
        },
        {
          "address": "G42",
          "raw": {
            "stringValue": "Задача 1 подпрограммы 3. Создание условий для гражданского становления, патриотического, духовно-нравственного воспитания молодежи, развитие волонтерства и добровольчества в Елизовском муниципальном районе.\n3.1.1.3. Проведение мероприятий по молодежной политике (согласно календарного плана мероприятий) (СУБСИДИЯ НА ИНЫЕ ЦЕЛИ)."
          },
          "display": "Задача 1 подпрограммы 3. Создание условий для гражданского становления, патриотического, духовно-нравственного воспитания молодежи, развитие волонтерства и добровольчества в Елизовском муниципальном районе.\n3.1.1.3. Проведение мероприятий по молодежной политике (согласно календарного плана мероприятий) (СУБСИДИЯ НА ИНЫЕ ЦЕЛИ)."
        },
        {
          "address": "G43",
          "raw": {
            "stringValue": "Задача 1 подпрограммы 3. Создание условий для гражданского становления, патриотического, духовно-нравственного воспитания молодежи, развитие волонтерства и добровольчества в Елизовском муниципальном районе.\n3.1.1.4. Проведение мероприятий по молодежной политике (День Российской молодежи, Молодежный форум) (СУБСИДИЯ НА ИНЫЕ ЦЕЛИ)."
          },
          "display": "Задача 1 подпрограммы 3. Создание условий для гражданского становления, патриотического, духовно-нравственного воспитания молодежи, развитие волонтерства и добровольчества в Елизовском муниципальном районе.\n3.1.1.4. Проведение мероприятий по молодежной политике (День Российской молодежи, Молодежный форум) (СУБСИДИЯ НА ИНЫЕ ЦЕЛИ)."
        },
        {
          "address": "G44",
          "raw": {
            "stringValue": "Задача 1 подпрограммы 4. Приведение зданий и инженерных коммуникаций учреждений культуры и спорта в соответствие с требованиями строительных норм и правил, предъявляемых к содержанию зданий и инженерных коммуникаций.\n4.1.1.2.1. Ремонт отмостки здания с/з п. Зеленый, ул. Атласова 12/4"
          },
          "display": "Задача 1 подпрограммы 4. Приведение зданий и инженерных коммуникаций учреждений культуры и спорта в соответствие с требованиями строительных норм и правил, предъявляемых к содержанию зданий и инженерных коммуникаций.\n4.1.1.2.1. Ремонт отмостки здания с/з п. Зеленый, ул. Атласова 12/4"
        },
        {
          "address": "G45",
          "raw": {
            "stringValue": "Задача 1 подпрограммы 4. Приведение зданий и инженерных коммуникаций учреждений культуры и спорта в соответствие с требованиями строительных норм и правил, предъявляемых к содержанию зданий и инженерных коммуникаций.\n4.1.1.2.2. Ремонт отмостки и устройство крыльца запасного входа здания с/з п. Раздольный, ул. Лесная, д.1"
          },
          "display": "Задача 1 подпрограммы 4. Приведение зданий и инженерных коммуникаций учреждений культуры и спорта в соответствие с требованиями строительных норм и правил, предъявляемых к содержанию зданий и инженерных коммуникаций.\n4.1.1.2.2. Ремонт отмостки и устройство крыльца запасного входа здания с/з п. Раздольный, ул. Лесная, д.1"
        },
        {
          "address": "G46",
          "raw": {
            "stringValue": "Задача 1 подпрограммы 4. Приведение зданий и инженерных коммуникаций учреждений культуры и спорта в соответствие с требованиями строительных норм и правил, предъявляемых к содержанию зданий и инженерных коммуникаций.\n4.1.1.2.3. Ремонт с/з \"Смена\" г. Елизово, ул.Уральская, д.17"
          },
          "display": "Задача 1 подпрограммы 4. Приведение зданий и инженерных коммуникаций учреждений культуры и спорта в соответствие с требованиями строительных норм и правил, предъявляемых к содержанию зданий и инженерных коммуникаций.\n4.1.1.2.3. Ремонт с/з \"Смена\" г. Елизово, ул.Уральская, д.17"
        },
        {
          "address": "G47",
          "raw": {
            "stringValue": "Задача 1 подпрограммы 4. Приведение зданий и инженерных коммуникаций учреждений культуры и спорта в соответствие с требованиями строительных норм и правил, предъявляемых к содержанию зданий и инженерных коммуникаций.\n4.1.1.2.4. Ремонт крыльца здания с/з п. Зеленый, ул. Атласова 12/4"
          },
          "display": "Задача 1 подпрограммы 4. Приведение зданий и инженерных коммуникаций учреждений культуры и спорта в соответствие с требованиями строительных норм и правил, предъявляемых к содержанию зданий и инженерных коммуникаций.\n4.1.1.2.4. Ремонт крыльца здания с/з п. Зеленый, ул. Атласова 12/4"
        },
        {
          "address": "G49",
          "raw": {
            "stringValue": "Задача 1 программы 3. Профилактика преступности, правонарушений, в том числе среди несовершеннолетних в Елизовском муниципальном районе.\n3.1.1.2. Организация и проведение спортивно-массовых мероприятий на территории Елизовского муниципального района, направленных на профилактику правонарушений"
          },
          "display": "Задача 1 программы 3. Профилактика преступности, правонарушений, в том числе среди несовершеннолетних в Елизовском муниципальном районе.\n3.1.1.2. Организация и проведение спортивно-массовых мероприятий на территории Елизовского муниципального района, направленных на профилактику правонарушений"
        },
        {
          "address": "G52",
          "raw": {
            "stringValue": "Задача 2 подпрограммы 1. Создание условий для сохранения и развития кадрового потенциала в сфере культуры и искусства Елизовского муниципального района.\n1.2.1.1. Компенсация расхов работникам учреждений культуры, школ дополнительного образования,арботающих в учреждениях,подведомственных УКС и МП, связанных с коммерческим наймом (поднаймом) жилых помещений\n(СУБСИДИЯ НА ИНЫЕ ЦЕЛИ)."
          },
          "display": "Задача 2 подпрограммы 1. Создание условий для сохранения и развития кадрового потенциала в сфере культуры и искусства Елизовского муниципального района.\n1.2.1.1. Компенсация расхов работникам учреждений культуры, школ дополнительного образования,арботающих в учреждениях,подведомственных УКС и МП, связанных с коммерческим наймом (поднаймом) жилых помещений\n(СУБСИДИЯ НА ИНЫЕ ЦЕЛИ)."
        },
        {
          "address": "G53",
          "raw": {
            "stringValue": "Задача 2 подпрограммы 1. Создание условий для сохранения и развития кадрового потенциала в сфере культуры и искусства Елизовского муниципального района.\n1.2.1.1. Компенсация расходов работникам культуры и искусства, работающим в учреждениях, подведомственных УКС и МП, связанных с коммерческим наймом (поднаймом) жилых помещений (СУБСИДИЯ НА ИНЫЕ ЦЕЛИ)."
          },
          "display": "Задача 2 подпрограммы 1. Создание условий для сохранения и развития кадрового потенциала в сфере культуры и искусства Елизовского муниципального района.\n1.2.1.1. Компенсация расходов работникам культуры и искусства, работающим в учреждениях, подведомственных УКС и МП, связанных с коммерческим наймом (поднаймом) жилых помещений (СУБСИДИЯ НА ИНЫЕ ЦЕЛИ)."
        },
        {
          "address": "G54",
          "raw": {
            "stringValue": "Задача 2 подпрограммы 2. Развитие физической культуры и спорта, спорта высших достижений, системы подготовки спортивного резерва и совершенствование кадровой политики в сфере физической культуры и спорта в Елизовском муниципальном районе."
          },
          "display": "Задача 2 подпрограммы 2. Развитие физической культуры и спорта, спорта высших достижений, системы подготовки спортивного резерва и совершенствование кадровой политики в сфере физической культуры и спорта в Елизовском муниципальном районе."
        },
        {
          "address": "G56",
          "raw": {
            "stringValue": "Задача 2 подпрограммы 2. Развитие физической культуры и спорта, спорта высших достижений, системы подготовки спортивного резерва и совершенствование кадровой политики в сфере физической культуры и спорта в Елизовском муниципальном районе.\n2.2.1.2. Обеспечение развития физической культуры и спорта совершенствование кадровой политики сфере физической культуры и спорта в Елизовском муниципальном районе"
          },
          "display": "Задача 2 подпрограммы 2. Развитие физической культуры и спорта, спорта высших достижений, системы подготовки спортивного резерва и совершенствование кадровой политики в сфере физической культуры и спорта в Елизовском муниципальном районе.\n2.2.1.2. Обеспечение развития физической культуры и спорта совершенствование кадровой политики сфере физической культуры и спорта в Елизовском муниципальном районе"
        },
        {
          "address": "G59",
          "raw": {
            "stringValue": "Задача 2 подпрограммы 2. Развитие физической культуры и спорта, спорта высших достижений, системы подготовки спортивного резерва и совершенствование кадровой политики в сфере физической культуры и спорта в Елизовском муниципальном районе.\n2.2.2.1. Проведение спортивных мероприятий (спортивные соревнования, тренировочные мероприятия) с выездом за пределы Камчатского края спортсменов, тренеров-преподавателей Елизовского муниципального района"
          },
          "display": "Задача 2 подпрограммы 2. Развитие физической культуры и спорта, спорта высших достижений, системы подготовки спортивного резерва и совершенствование кадровой политики в сфере физической культуры и спорта в Елизовском муниципальном районе.\n2.2.2.1. Проведение спортивных мероприятий (спортивные соревнования, тренировочные мероприятия) с выездом за пределы Камчатского края спортсменов, тренеров-преподавателей Елизовского муниципального района"
        },
        {
          "address": "G62",
          "raw": {
            "stringValue": "Задача 2 подпрограммы 4. Проведение мероприятий по пожарной безопасности учреждений культуры и спорта на территории Елизовского муниципального района, профилактика возникновения пожаров на территории Елизовского муниципального района в рамках полномочий, предусмотренных действующим законодательством.\n4.2.1.2.1. Огнезащитная обработка деревянных конструкций чердачного помещения"
          },
          "display": "Задача 2 подпрограммы 4. Проведение мероприятий по пожарной безопасности учреждений культуры и спорта на территории Елизовского муниципального района, профилактика возникновения пожаров на территории Елизовского муниципального района в рамках полномочий, предусмотренных действующим законодательством.\n4.2.1.2.1. Огнезащитная обработка деревянных конструкций чердачного помещения"
        },
        {
          "address": "G63",
          "raw": {
            "stringValue": "Задача 3 подпрограммы 2. Реализация Государственных программ и региональных проектов, реализуемых на территории Елизовского муниципального района.\n2.3.2.1.Приобретение оборудования и инвентаря для приведения организаций спортивной подготовки в нормативное состояние (СУБСИДИЯ НА ИНЫЕ ЦЕЛИ)."
          },
          "display": "Задача 3 подпрограммы 2. Реализация Государственных программ и региональных проектов, реализуемых на территории Елизовского муниципального района.\n2.3.2.1.Приобретение оборудования и инвентаря для приведения организаций спортивной подготовки в нормативное состояние (СУБСИДИЯ НА ИНЫЕ ЦЕЛИ)."
        },
        {
          "address": "G72",
          "raw": {
            "stringValue": "п/п 5. «Осуществление отдельных государственных полномочий, обеспечение реализации муниципальной программы и деятельности муниципальных учреждений культуры и спорта в Елизовском муниципальном районе».\n\n5.1.4. Обеспечение деятельности учреждений культуры на территории Елизовского муниципального района."
          },
          "display": "п/п 5. «Осуществление отдельных государственных полномочий, обеспечение реализации муниципальной программы и деятельности муниципальных учреждений культуры и спорта в Елизовском муниципальном районе».\n\n5.1.4. Обеспечение деятельности учреждений культуры на территории Елизовского муниципального района."
        }
      ]
    },
    {
      "name": "УО",
      "id": "1AGvXDSKSjpPc11ce4NDK262qySM4W6nFTq2YcgQ6Sds",
      "main": "ВСЕ",
      "sheetId": 682612875,
      "rowCount": 1001,
      "entries": [
        {
          "address": "E1",
          "raw": {
            "stringValue": "Учреждения (факт)"
          },
          "display": "Учреждения (факт)"
        },
        {
          "address": "F1",
          "raw": {
            "stringValue": "Программы (факт)"
          },
          "display": "Программы (факт)"
        },
        {
          "address": "G1",
          "raw": {
            "stringValue": "Мероприятия (факт)"
          },
          "display": "Мероприятия (факт)"
        },
        {
          "address": "E2",
          "raw": {
            "formulaValue": "=SORT(UNIQUE(FILTER('ВСЕ'!C4:C; 'ВСЕ'!C4:C<>\"\")))"
          },
          "display": "#REF!"
        },
        {
          "address": "F2",
          "raw": {
            "formulaValue": "=SORT(UNIQUE(FILTER('ВСЕ'!D4:D; 'ВСЕ'!D4:D<>\"\")))"
          },
          "display": "Муниципальная программа «Развитие образования в Елизовском муниципальном районе на 2025–2029 годы»"
        },
        {
          "address": "G2",
          "raw": {
            "formulaValue": "=SORT(UNIQUE(FILTER('ВСЕ'!E4:E; 'ВСЕ'!E4:E<>\"\")))"
          },
          "display": "#REF!"
        },
        {
          "address": "G14",
          "raw": {
            "stringValue": "Мероприятие 1.1.2: \"Организация и обеспечение охранных, организационных, инженерно-технических и иных антитеррористических услуг и мероприятий\""
          },
          "display": "Мероприятие 1.1.2: \"Организация и обеспечение охранных, организационных, инженерно-технических и иных антитеррористических услуг и мероприятий\""
        },
        {
          "address": "G15",
          "raw": {
            "stringValue": "Мероприятие 1.1.2: \"Организация и обеспечение охранных, организационных, инженерно-технических и иных антитеррористических услуг и мероприятий\" - Охрана лиценз."
          },
          "display": "Мероприятие 1.1.2: \"Организация и обеспечение охранных, организационных, инженерно-технических и иных антитеррористических услуг и мероприятий\" - Охрана лиценз."
        },
        {
          "address": "E44",
          "raw": {
            "stringValue": "Муниципальное казённое учреждение «Центр бухгалтерского обслуживания и материально-технического обеспечения»"
          },
          "display": "Муниципальное казённое учреждение «Центр бухгалтерского обслуживания и материально-технического обеспечения»"
        },
        {
          "address": "G46",
          "raw": {
            "stringValue": "Мероприятие 2.5.3: \"Организация и обеспечение организационных, инженерно-технических и иных антитеррористических мероприятий\" - СКУД видеодомофон."
          },
          "display": "Мероприятие 2.5.3: \"Организация и обеспечение организационных, инженерно-технических и иных антитеррористических мероприятий\" - СКУД видеодомофон."
        }
      ]
    }
  ]
}
```

## Исправление автокода процедуры ЭЗК367-26

* Источник: действующая книга процедур, `Рабочий реестр процедур!A450`. До исправления: ручной текст `ЭЗК367-26` (подтверждено также предмиграционной копией R-E); `G450` начинается на тот же код, а `Y450` сообщает `Ошибка: Автокод в A перезаписан — A`.
* Исправление: копирование только формулы из соседней эталонной `A449` в `A450` с коррекцией относительной ссылки на `G450`. Формат, `G450`, другие строки и именные диапазоны не меняются; вычисляемый код должен остаться `ЭЗК367-26`.
* Откат: вернуть в `A450` строку `ЭЗК367-26`.

## Второй этап — исправления и независимая сверка (10.10.2026, после первого аудита)

Внимание: предыдущий раздел «Independent follow-up audit» — **исторический снимок до этого исправления**. Ниже — более поздние результаты живого чтения и сделанные изменения. Физическое удаление `_Настройки`, `Settings`, `Контроль`, `_ChangeLog` и зависимых листов **по-прежнему не разрешено**: пользователь отложил работы с Apps Script, а его исходники/триггеры непосредственно не проаудированы.

### Что реально исправлено
1. В восьми книгах ГРБС формулы фактических подсказочных списков `_Настройки!E2:G2` снова работают. Перед чисткой сохранён полный машинно-читаемый снимок **всех пользовательских значений и формул E1:G1000** — см. раздел «Архив исходных E:G» выше, с исходными адресами, типами и точными текстами. Удалены только заархивированные ручные литералы из старых факт-списков E:G, мешавшие проливу массива; где E2 ранее был ручным вариантом названия, восстановлена формула `SORT(UNIQUE(FILTER(...)))` из канона. Авторитетные справочники `_Настройки!H:J`, правила проверки данных C:E и бизнес-строки не менялись. **Семь ранее известных ошибок REF устранены**; `СИСТЕМА!I8 = 0` в каждой книге.
2. УЭР `_Настройки!J6`: до правки содержало числовую дату **46027** с форматом `d.m.` и показом `5.1.`; независимое сравнение с `ВСЕ!E46/E70` подтвердило, что `5.1.` — текстовый код. Сохранено как строка `5.1.` и установлен текстовый тип ячейки. `СИСТЕМА!K24` теперь не находит чисел в H2:J250.
3. В действующем реестре процедур `Рабочий реестр процедур!A450` значение `ЭЗК367-26` было вручную введено, а формула проверки Y450 выявляла подмену автоматического кода. Перенесена только формула из A449 с коррекцией относительной ссылки на G450. `A450` остался `ЭЗК367-26`, `Y450` больше не выдаёт «Ошибка: Автокод ...», `СИСТЕМА!I8` уменьшился с 1 до **0**. Исходное значение и откат документированы в разделе «Исправление автокода процедуры ЭЗК367-26».
4. Сводная книга `Контроль!B5`: неисправную `=COUNTA(d!A:A)` заменили на `=IF(AND(COUNT('СВОД ТД-ПМ'!D9:U12)>0;SUMPRODUCT(--ISERROR('СВОД ТД-ПМ'!D9:U12))=0);1;0)`; `A5` оставили без изменения («Свод заполнен»), `C5` переписали, чтобы ясно сказать: это **техническая готовность** контрольного диапазона, а не независимое совпадение с ГРБС. Прочитанное значение B5=1, ошибок вычисления нет. Откат: прежняя формула выше.
5. В `СИСТЕМА` убрана статическая надпись «Сохранён» рядом с `_ChangeLog`. Первоначальный счётчик записей был впоследствии заменён на облегчённую проверку существования заголовка `=IF(LEN('_ChangeLog'!A1)>0;"Лист доступен";"Проверьте журнал")` (актуально при контрольном чтении восьми книг). Она **не свидетельствует о полноте журнала или доставке уведомлений**. Предупреждения о конфликте списков теперь выводятся по состоянию `I8`.

### Независимая проверка расчётных столбцов в ГРБС
Во всех восьми **основных листах** прочитаны исходные CellData, тип каждой заполненной строки A и 11 обязательных формульных столбцов `K, O, P, R, S, T, Y, Z, AA, AB, AC` (с учётом разных нижних границ книг). **4091 заполненная строка × 11 = 45 001 проверенная ячейка**. Во всех 45 001 ячейках стоит формула (не пустота/константа), и при чтении не обнаружены `effectiveValue.errorValue`. Это *структурный контроль*, не доказательство правильности каждой экономической или правовой формулы.

Разбивка заполненных строк: УЭР 76; УИО 70; УАГЗО 74; УФБП 49; УД 222; УДТХ 76; УКСиМП 695; УО 2829.

### Проверка равенства источников и зеркал свода
Снова считаны из действующих книг ГРБС и восьми соответствующих импортированных вкладок `Сводный план-реестр закупок АЕМО` все эффективные значения **A1:AH** до рабочей глубины каждого основного листа; сравнение прошло по строкам и 34 столбцам, с нормализацией только отсутствующих пустых значений и машинной точностью чисел. **Во всех восьми парах найдено 0 различий**, количество заполненных строк и суммы числовых `K/Y/AC` совпали. Замер относится только к прочитанному срезу 10.10.2026; обновление другого агента/задержка IMPORT могут изменить это позднее. Это проверка зеркала, но **не** независимая проверка формул агрегатов `СВОД ТД-ПМ`, двойного счёта, расчёта KPI или полноты журнала.

### Нерешённое намеренно (не маскировать зелёным)
- `_Проверки!G157:G158` в реестре процедур по `ЭАС339-26`: ожидания «нет наследника» и «Не состоялась» не совпадают с записанным наследником `ЭАС343-26` и вычисляемой стадией `Переоформлена`. Проверена связанная строка наследника (основной код, U-ссылка на ЭАС339-26, итог торгов «Состоялась»), однако старый отчёт от 18.09 прямо требовал определить судьбу отменённой ЭАС339-26. **Не обновлять ожидания регрессионных тестов только ради PASS** без принятого источника/решения по цепочке.
- `_ChangeLog` продолжает быть источником истории Apps Script; ни запись/отправка/ретраи, ни триггеры, ни полнота фиксации массовых API-изменений не подтверждены этим этапом. `СИСТЕМА` защищена предупреждением (`warningOnly`), а не строгими правами. Совместимость с живыми скриптами остаётся незакрытым гейтом.
- `Settings` и `Контроль` пока намеренно сохранены как скрытые технические адаптеры; в рабочей книге по-прежнему существуют несколько физически отдельных технических вкладок. Консолидация в точные 1–2 физические вкладки без рефакторинга внешних потребителей и Apps Script не подтверждена и **не должна достигаться удалением источников**.
- Системный пульт проверен по формуле, цветам, типографии и метаданным Google Sheets API, но не просмотрен в полноценном интерактивном интерфейсе Google Sheets. Любая заявка о «полной визуальной приёмке» была бы неверна.

### Следующий безопасный гейт
Изучить реально привязанные Apps Script-проекты/триггеры, определить протокол журнала и владельцев каждой настройки, создать тестовый стенд параллельного запуска, выполнить выравнивание `Settings/Контроль` в `СИСТЕМА + _Настройки + _ChangeLog` с откатом. Нельзя сокращать физические вкладки лишь ради счётчика или создавать второй конкурирующий `_ОПОРА` с теми же H:J.

### Дополнительное контрольное чтение
Полный просмотр отображаемых формул основных листов ГРБС (≈ 100 тыс. формульных ячеек включая заготовленные строки) не обнаружил прямых ссылок на `Settings!`, `Контроль!`, `_Настройки!`, `_ChangeLog!` или `СИСТЕМА!` внутри самих основных строк закупок. Это **не** означает отсутствия нативных валидаций C:E (они доказанно ссылаются на H:J), именных диапазонов, внешних инструментов или обращений из Apps Script. Нельзя трактовать этот факт как разрешение на удаление старых технических листов.

При последнем чтении интерфейса `_ChangeLog` живой тест ограничен доступностью заголовка `A1`; подпись рядом обновлена так, чтобы не создавать ложного впечатления проверки доставки. Последовательность изменений фиксирована в этом же файле, а не в новом отчёте-копии.

### UI/UX-polish of existing _Настройки — 2026-10-10

Completed in-place Google Sheets changes across all eight GRBS books:
- The EXISTING _Настройки tabs now share a restrained navy header, readable A-C and H-J column widths, frozen top row, hidden gridlines, improved row heights, and three explanatory header notes for H-J.
- Computed auxiliary columns E:G and empty K:Z are HIDDEN as dimensions, NOT deleted. Primary manually maintained dictionary H:J, source values, legacy key/value settings, formulas, data validations, and sheet identities are intact.
- The existing SVOD Settings tab has a frozen heading, adjusted widths/row heights, and readable URL rows. All eight original source URLs / IMPORTRANGE formulas remain unchanged.

Post-change verification against LIVE Sheets API:
- All eight GRBS _Настройки!H1:J1 retain headers and three contextual notes.
- C4:E4 in each source book remains native ONE_OF_RANGE validation against _Настройки!H:J.
- All eight new СИСТЕМА views show A53,D53,G53,J53 = 0 in this snapshot. E2:G2 currently show zero #REF! evaluation errors. This does not prove future changes cannot introduce problems.
- All eight hidden _Справочник copies were compared across 85 data entries and 170 formulas each (A:P): identical at inspection time. The parallel organizations-migration work is left untouched.
- All eight primary books previously passed 4091 filled rows * 11 mandated formula columns without missing formulas or calculation errors; seven priority mirrored fields in SVOD compared 28805 cells with no mismatches. These checks are time-scoped, not an exhaustive acceptance of all integrations.

Boundary: _ChangeLog visibility and contents, Apps Script/triggers, _Справочник values/IDs, working business grids and all formula/validation mechanisms were left unchanged. The resulting visible technical UI is СИСТЕМА and _Настройки, plus _ChangeLog where historically visible. No physical deletion of legacy Settings/Контроль/_Справочник/_ChangeLog until all external consumers are verified. This is not a completed 1–2 physical tab cutover.

### Завершающая независимая приёмка технического контура — 10.10.2026

В этой итерации не создавались новые книги, копии, вкладки или пользовательские ID-поля; доработаны **существующие** технические источники в действующих книгах:

- Строгие локальные словари дополнены тремя **буквальными значениями, уже присутствовавшими в исходных строках**, без изменения рабочих закупок: УД `_Настройки!J78` соответствует `ВСЕ!E187`; УКСиМП `_Настройки!I5` и `J74` соответствуют `ВСЕ!D694` и `E694`. Каждая запись снабжена `note` об источнике и ограничении (это восстановление совместимости validation, а не утверждение новой нормативной классификации).
- Повторно прочитаны живые `СИСТЕМА!A53,D53,G53,J53` в восьми ГРБС: все **32 независимые проверки = 0** после указанной синхронизации. Не означает доказанную безошибочность любой закупки.
- В существующих пультах восьми ГРБС в свободной строке 35 отражён уже существующий скрытый `_Справочник` миграции R/E: навигационно-концептуально учтена его роль без изменения значений, ID, формул и видимости.
- Проведена новая независимая зеркальная сверка **A1:AH** между всеми восьмью действующими ГРБС и соответствующими листами сводной книги — **0 расхождений во всех ячейках до фактической глубины основного листа**, суммы K/Y/AC и 4091 заполненная строка совпадают; хвосты зеркал за границей основного листа не содержат дополнительных значений. Это не атомарный межкнижный снимок и не контроль бизнес-формул свода, только установленный паритет текущих значений.
- По живому мастеру процедур пересчитаны 442 основных строки и 6 «долей». Независимый просмотр `A3:Y1002` не нашёл дублей основных кодов, долей без единственного родителя, заполненных победителей без ИНН или ошибок в Y.
- Контрольный случай `ЭАС339-26` (**`_Проверки!G157:G158`, 2 расхождения**) не замаскирован исправлением ожидаемых значений: при наличии указания на наследника `ЭАС343-26` примечание к `Рабочий реестр процедур!U426` прямо требует **первичного подтверждения**. Документ от 02.10.2026 называет преемника состоявшимся, но не заменяет первичный документ. Для сотрудника пульт `СИСТЕМА!C16` теперь ведёт на `U426`, а `K16` показывает *«Подтвердить • 2»*, а не ошибочное распоряжение «Исправить».
- `_ChangeLog`, Apps Script, триггеры, исходные формулы, рабочие закупки и проектные ID-связи не менялись. Физическое удаление совместимых старых листов **не проводится** до отдельного согласованного Apps Script cutover. Текущая работа по интерфейсу и техническим словарям закончена, физическая оптимизация числа вкладок — сознательно отложенный отдельный этап.

При последующей правке этого документа следует **актуализировать именно эти разделы**, а не плодить FINAL-перепечатки.

### Дополнение: статус очередей _ChangeLog

Финальная проверка показывает, что работоспособность контрольной части не доказывает доставку уведомлений. Только `_ChangeLog` (без исполнения скриптов) дал:
- **УКСиМП**: по `_ChangeLog!J2:J` 4160 `sent`, 1539 `pending`, 2 `logged`; последние строки тоже `pending`. Это реальная очередь, которую следует проверить при отдельной работе с Apps Script.
- **УО**: 34639 `sent`, 4578 исторических `error`, 1 `logged`; последние строки имеют `sent`. Исторические неуспешные записи сами по себе **не доказывают текущую неработоспособность** всего скрипта и не должны бессмысленно повторно отправляться без проверки идентичности событий.
- В существующих `СИСТЕМА!E5` этих двух книг исправлены тексты на соответственно **«Очередь журнала требует внимания»** и **«Есть исторические ошибки журнала»**. `СИСТЕМА!E59` сохраняет счётчик истории и пометку «Запуск Apps Script не проверен». Ни одна строка `_ChangeLog`, разрешение и триггер не менялись.

Статус: **завершена техническая консолидация интерфейса и безопасная проверка данных без изменения скриптов**. Остаются явно вынесенные предметные вопросы: подтверждение ЭАС339-26 ↔ ЭАС343-26 первичкой и дальнейшая модернизация/доставка Apps Script журнала. **Чистку физических вкладок, от которых могут зависеть скрипты, считать неисполненной до этой фазы.**
