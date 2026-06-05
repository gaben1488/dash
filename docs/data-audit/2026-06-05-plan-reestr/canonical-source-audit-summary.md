# PLAN-REESTR Canonical Source Audit Summary

Generated from local extraction artifacts. This summary is intentionally derived, not hand-entered.

## Coverage

- XLSX workbooks: 16
- XLSX sheets: 209
- Active data rows: 39535
- Formula cells: 441067
- Google custom/exported formula cells: 308060
- Extracted comments: 328
- Formula anomaly groups: 100
- Hidden rows/columns: 4733/1
- DOCX-derived texts: 53

## Workbook Inventory

| workbook | sheets | active rows | formulas | gs custom | risks | comments | validations | formula anomalies | hidden rows/cols |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Копия_ УКСиМП – 22 мая, 18_43.xlsx | 26 | 3819 | 26539 | 19201 | 124 | 32 | 19 | 0 | 1/0 |
| Копия_ УКСиМП – 29 мая, 10_54.xlsx | 26 | 4013 | 26872 | 19442 | 126 | 32 | 19 | 0 | 1/0 |
| СВОД -25-26.xlsx | 12 | 411 | 4222 | 0 | 68 | 1 | 1 | 13 | 0/0 |
| СВОД_ДЛЯ_GOOGLE.xlsx | 19 | 3871 | 173069 | 163841 | 177 | 0 | 4 | 86 | 0/1 |
| УАГЗО.xlsx | 7 | 349 | 12694 | 1742 | 21 | 31 | 19 | 0 | 0/0 |
| УД.xlsx | 7 | 2505 | 11438 | 5719 | 28 | 31 | 30 | 0 | 140/0 |
| УДТХ.xlsx | 5 | 630 | 10813 | 9 | 14 | 32 | 19 | 0 | 949/0 |
| УИО.xlsx | 5 | 491 | 10958 | 9 | 14 | 30 | 19 | 0 | 0/0 |
| УКСиМП.xlsx | 26 | 4242 | 27049 | 19558 | 125 | 32 | 19 | 0 | 648/0 |
| УО.xlsx | 52 | 17657 | 99458 | 73345 | 271 | 31 | 24 | 1 | 2034/0 |
| УФБП.xlsx | 5 | 392 | 10851 | 9 | 17 | 30 | 18 | 0 | 0/0 |
| УЭР.xlsx | 7 | 323 | 13533 | 2579 | 25 | 32 | 16 | 0 | 960/0 |
| на вход cvs еис закупки OrderSearch(1-194)_09.04.2026.xlsx | 1 | 192 | 0 | 0 | 7 | 0 | 0 | 0 | 0/0 |
| на вход УЭР за 10.04.2026.xlsx | 7 | 217 | 13571 | 2606 | 24 | 14 | 19 | 0 | 0/0 |
| на вход сvs контракты ContractSearch(1-120)_09.04.2026.xlsx | 1 | 210 | 0 | 0 | 6 | 0 | 0 | 0 | 0/0 |
| на выход Сводный_реестр_и_УЭР_2.0_v4_1.xlsx | 3 | 213 | 0 | 0 | 24 | 0 | 0 | 0 | 0/0 |

## Repeated Source Shapes

- Department workbooks use a 33-column registry-like shape with data from row 4 and technical sheets such as `ВСЕ`, `Контроль`, `GOOGLE_ФОРМУЛЫ`, `Settings`, plus subordinate/department slices.
- Current canonical live source shape appears to be `СВОД_ДЛЯ_GOOGLE.xlsx`: `СВОД ТД-ПМ`, `СВОД с месяцами`, `ШДЮ старый`, 8 department tabs, `КОНТЕКСТ`, `РАСЧЕТ`, `ИСТОРИЯ`, `ОТЛАДКА`, support sheets.
- Earlier architecture folder captures a five-source merge model: plan schedule current/previous, EIS orders, EIS contracts, department sheet, output registry.

## Top Data Risks By Workbook

- `Копия_ УКСиМП – 22 мая, 18_43.xlsx`: blank x69, neg x26, mixed_type x26, num_as_text x2, ERR x1
- `Копия_ УКСиМП – 29 мая, 10_54.xlsx`: blank x69, neg x28, mixed_type x26, num_as_text x2, ERR x1
- `СВОД -25-26.xlsx`: blank x50, ERR x18
- `СВОД_ДЛЯ_GOOGLE.xlsx`: blank x124, mixed_type x26, neg x25, ERR x1, num_as_text x1
- `УАГЗО.xlsx`: blank x12, mixed_type x4, neg x2, num_as_text x2, ERR x1
- `УД.xlsx`: blank x16, neg x8, num_as_text x2, mixed_type x1, ERR x1
- `УДТХ.xlsx`: blank x5, mixed_type x3, ERR x3, num_as_text x2, neg x1
- `УИО.xlsx`: blank x5, neg x4, mixed_type x2, num_as_text x2, ERR x1
- `УКСиМП.xlsx`: blank x69, neg x29, mixed_type x24, num_as_text x2, ERR x1
- `УО.xlsx`: blank x164, mixed_type x61, neg x40, ERR x4, num_as_text x2
- `УФБП.xlsx`: blank x8, num_as_text x3, neg x2, mixed_type x2, ERR x2
- `УЭР.xlsx`: blank x13, mixed_type x6, neg x3, num_as_text x2, ERR x1
- `на вход cvs еис закупки OrderSearch(1-194)_09.04.2026.xlsx`: blank x6, num_as_text x1
- `на вход УЭР за 10.04.2026.xlsx`: blank x13, mixed_type x6, neg x3, num_as_text x1, ERR x1
- `на вход сvs контракты ContractSearch(1-120)_09.04.2026.xlsx`: blank x6
- `на выход Сводный_реестр_и_УЭР_2.0_v4_1.xlsx`: mixed_type x16, num_as_text x5, blank x3

## Documentation Corpus Signals

| theme | matched lines |
| --- | ---: |
| filters | 1702 |
| law | 766 |
| reports | 702 |
| source | 681 |
| history | 322 |
| signals | 318 |
| trust | 141 |

## High-Signal Documents

- `ОТЧЕТЫ__Отчет по закупкам на 20.03.2026 итоговый для АС к совещанию 26.03.2026.txt`: 50324 chars, 434 lines; filters:82, history:6, law:27, reports:7, signals:4, source:11, trust:6
- `Генератор Отчетов__Архив-Буфер тест__260315_Отчет_шаблон_для_AppsScript_v3.txt`: 37275 chars, 327 lines; filters:73, history:6, law:16, reports:6, signals:2, source:8, trust:2
- `ОТЧЕТЫ__260315_Отчет_шаблон_для_AppsScript_v3.txt`: 37275 chars, 327 lines; filters:73, history:6, law:16, reports:6, signals:2, source:8, trust:2
- `ОТЧЕТЫ__Отчет по закупкам на 27.03.2026.txt`: 36733 chars, 327 lines; filters:73, history:6, law:20, reports:6, signals:2, source:8, trust:2
- `ОТЧЕТЫ__Отчет по закупкам на 30.03.2026.txt`: 36733 chars, 327 lines; filters:73, history:6, law:21, reports:6, signals:2, source:8, trust:2
- `ОТЧЕТЫ__Отчет по закупкам на 26.03.2026.txt`: 36725 chars, 327 lines; filters:73, history:6, law:19, reports:6, signals:2, source:8, trust:2
- `ОТЧЕТЫ__Отчет по закупкам на 26.03.2026(1).txt`: 36724 chars, 327 lines; filters:73, history:6, law:19, reports:6, signals:2, source:8, trust:2
- `ОТЧЕТЫ__Отчет по закупкам на 25.03.2026.txt`: 36719 chars, 327 lines; filters:73, history:6, law:21, reports:6, signals:2, source:8, trust:2
- `Генератор Отчетов__документация__03_паспорт_decision_engine.md.txt`: 36044 chars, 411 lines; filters:77, history:34, law:22, reports:13, signals:42, source:49, trust:22
- `Генератор Отчетов__Архив-Буфер тест__ОТЧЕТ ПО ЗАКУПКАМ от 24.03.2026(3).txt`: 31623 chars, 237 lines; filters:33, history:18, law:12, reports:21, signals:1, source:18
- `Генератор Отчетов__Архив-Буфер тест__Отчёт по закупкам 05.04.2026 (УМНЫЙ, ТЕСТОВЫЙ)(3).txt`: 29417 chars, 350 lines; filters:51, history:7, law:81, reports:25, signals:13, source:7
- `Генератор Отчетов__Архив-Буфер тест__ОТЧЕТ ПО ЗАКУПКАМ от Tue Mar 24 2026 00_00_00 GMT+1200 (Петропавловск-Камчатский, стандартное время).txt`: 29235 chars, 154 lines; filters:22, history:5, law:12, reports:14, signals:1, source:7
- `Генератор Отчетов__Архив-Буфер тест__ОТЧЕТ ПО ЗАКУПКАМ от 25.03.2026.txt`: 29025 chars, 234 lines; filters:23, history:15, law:12, reports:13, signals:1, source:8
- `Генератор Отчетов__документация__02_паспорт_модулей.md.txt`: 27926 chars, 284 lines; filters:45, history:34, law:17, reports:39, signals:22, source:78, trust:25
- `Генератор Отчетов__документация__05_инструкция_исполнителю.md.txt`: 27475 chars, 354 lines; filters:63, history:16, law:14, reports:78, signals:15, source:54, trust:11
- `Генератор Отчетов__документация__06_карта_рисков.md.txt`: 23580 chars, 302 lines; filters:49, history:21, law:2, reports:76, signals:30, source:83, trust:31

## Immediate Interpretation

1. The source archive contains more product/domain knowledge than the current dashboard docs: it documents a weekly report generator, history snapshots, context sheet, risk modules, 44-FZ checks, and anti-corruption indicators.
2. `СВОД_ДЛЯ_GOOGLE.xlsx` is not just an input table; it is a working data product with calculation, history, context, old SHDYU, monthly summary, and debug sheets.
3. Department workbooks are not flat CSV sources. They carry formulas, validations, conditional formatting, comments/change history, hidden rows, subordinate slices, and Google custom formula exports.
4. Any reliable rewrite/refactor must preserve formula semantics: `COUNTIFS/SUMIFS`, `AD = да` economy gate, fact-date exclusions `Q <> Х/X/blank`, method split ЕП vs non-ЕП, month/quarter/year dimensions, and subordinate filtering by column C.
5. Current code should be audited against the archived Apps Script promises: named range/header lookup resilience, BOEVOY/TEST/DEMO modes, `РАСЧЕТ`/`ИСТОРИЯ`/`КОНТЕКСТ`, 44-FZ and anti-corruption modules, and report generation fallback.
