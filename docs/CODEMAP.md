# CODEMAP — AEMR Dash

> Рабочий инженерный реестр проекта. Не README. MLP Release Stabilization — Slice 0.
> Ветка: `feature/svod-rebrand-ui` · актуализировано: 2026-06-05.
> Все выводы — из фактического кода (цитаты `file:line`). Неподтверждённое помечено `UNCLEAR`.
> Связанные канон-доки: `docs/METRICS_CONTRACT.md`, `docs/DATA_SOURCES.md`, `docs/ARCHITECTURE.md`, `docs/SECURITY.md`, `docs/RUNBOOK.md`, `docs/REVIEW.md`.

---

## 1. Executive map

**Что это.** Аналитический дашборд контроля закупок 44-ФЗ для АЕМР (Камчатка). Источник истины — Google Sheets (СВОД ТД-ПМ + 8 листов управлений). Сервер читает их через Sheets API, прогоняет пайплайн (нормализация → классификация → пересчёт → сигналы → сверка → trust), отдаёт REST; React-фронт рисует KPI, реестр, экономию, контроль/сверку.

**Пакеты (pnpm monorepo, TS ESM):**
- `@aemr/shared` — типы, константы, источники, словари, REPORT_MAP, svod-view, rule-book (source of truth для контрактов и справочников).
- `@aemr/core` — пайплайн расчёта: `CalcEngine`, orchestrator (`runPipeline`), ingest, signals, validate, reconcile (ШДЮ), trust scorer, analytics.
- `@aemr/server` — Fastify (Node 22): routes + services (snapshot, google-sheets), auth, SQLite (drizzle) для истории снимков.
- `@aemr/web` — React 19 + Vite: store (zustand), хуки агрегации, страницы.

**Главный data flow:**
```
Google Sheets (СВОД ТД-ПМ + 8 dept книг)
  → server/services/google-sheets.ts (Sheets API, UNFORMATTED_VALUE)
  → server/services/snapshot.ts: createSnapshot → core runPipeline()
        orchestrator: ingest official cells → normalize → per dept: CalcEngine.compute → adaptToRecalcMetrics
        → mergeSummaryMetrics → computeDeltas → computeTrustScore → reconcile(ШДЮ)
  → DataSnapshot { officialMetrics, calculatedMetrics, deltas, issues, trust, recalcResults, shdyuData }
  → routes/dashboard.ts: собирает DashboardData DTO
  → web api.getDashboard → store.dashboardData
  → useFilteredData / useMultiDimMetrics (клиентская агрегация под 6 фильтров)
  → страницы (Dashboard, Economy, Quality/Recon/Trust, SvodView, …)
```

**Самые рискованные зоны (детали — §12):**
1. **P0 — пользователь пока не видит “почему это число такое”**: KPI должны раскрываться до формулы, источника, фильтров, gate, numerator/denominator, row count, snapshot/source mode.
2. **P1 — фронт всё ещё имеет клиентскую реагрегацию мимо core**, но прежний P0 по economy закрыт: Economy использует AD-gated `economyTotal/economyFB/KB/MB`, а plan/fact остаток показывается только как остаток лимита, не как экономия.
3. **P0/P1 — ШДЮ/monthly source naming требует аккуратного follow-up**: новый лист помесячной динамики называется `СВОД с месяцами`; текущий кодовый logical name всё ещё `ШДЮ` с fallback `ШДЮ старый` (не меняется в Slice 0).
4. **P0 — нет разделения production/archive источников в коде** (только запрет «лишних ID» через тест).
5. **P1 — runtime source mutation**: `journal.ts` может перенацелить источник после auth; нужен governance flow, не в Slice 0.
6. **P1 — большие будущие риски**: `useFilteredData.ts`, `services/pipeline.ts`, typed API/DTO boundaries.

---

## 2. Repository layout

| path | purpose | owner layer | status | notes |
|---|---|---|---|---|
| `package.json`, `pnpm-workspace.yaml` | monorepo root, скрипты gates | root | clean in Slice 0 scope | `typecheck` идёт через `scripts/typecheck-workspaces.mjs` |
| `eslint.config.js` | ESLint config | root | clean in Slice 0 scope | lint warnings по `any` остаются known debt |
| `.github/workflows/ci.yml` | CI gates | infra | clean in Slice 0 scope | — |
| `scripts/` | python/cjs утилиты + root typecheck runner | infra/data-audit | mixed | XLSX helpers классифицированы ниже; НЕ production input |
| `deploy/` | `docker-compose.yml` + README (прод-деплой) | infra | clean in Slice 0 scope | canonical prod stack в `deploy/` |
| `docs/` | канон-доки + data-audit artifacts | docs | mixed | `docs/data-audit/` — forensic/spec corpus, не runtime input |
| `packages/shared/src` | контракты, источники, словари | shared | clean in current dirty tree | source of truth; SHDYU naming follow-up documented only |
| `packages/core/src` | пайплайн расчёта | core | clean in current dirty tree | CalcEngine = канон расчёта; не менять в Slice 0 |
| `packages/server/src` | Fastify API | server | clean in Slice 0 scope | runtime source mutation remains risk |
| `packages/web/src` | React UI | web | Slice 0 touches Economy copy only | 5 unit-тестов, покрытие тонкое |

Slice 0 hygiene status:

- `packages/web/tsconfig.tsbuildinfo` exists locally, is not tracked by `git ls-files`, and is covered by `.gitignore` via `*.tsbuildinfo`; keep ignored/untracked, do not commit.
- XLSX helper scripts are not runtime/product input. Current classification: `xlsx_full_extract.py`, `xlsx_formula_dump.py`, `xlsx_metadata_map.py`, `plan_reestr_summarize.py` = product data-quality/audit tools; `xlsx_style_extract.py`, `xlsx_to_html.py`, `xlsx_peek.py`, `xlsx_risk_scan.py` = one-off/local probes until promoted with docs/tests.
- Existing dirty SHDYU/SvodView, source-inventory, docs/data-audit, and scripts changes are outside this Slice 0 and should not be mixed with KPI Explainability Drawer work.

Slice 0 verification status (2026-06-05):

- Requested selector `pnpm -F aemr/web ...` matches no workspace package; canonical package selector is `@aemr/web`.
- Passed: `pnpm -F @aemr/web typecheck`, `pnpm -F @aemr/web test` (5 files / 15 tests), `pnpm typecheck`, `pnpm -r test` (shared 52, core 660, server 14, web 15 tests), `pnpm lint` (0 errors, 278 warnings), `pnpm build` (Vite main JS chunk warning remains), `pnpm audit --audit-level moderate`, `git diff --check` (CRLF warnings only).
- Toxic economy wording search found no live legacy limit-minus-contract-price copy. Remaining plan/fact wording is scoped to `amount_deviation = plan_total - fact_total` and must not be reused as economy language.

---

## 3. Data source map

| source | type | production? | id/path | used by | risks | tests/docs |
|---|---|---|---|---|---|---|
| СВОД_ДЛЯ_GOOGLE (главная книга) | Google Sheet | **PROD** | `1i692JdP-FqWMSfVgBjTmDCoUakacbJpZMq9tJhQlRhg` — `shared/constants.ts:13` (`SVOD_SPREADSHEET_ID`) | snapshot.ts (official cells + dept-листы + ШДЮ) | env `GOOGLE_SHEETS_SPREADSHEET_ID` может переопределить (config.ts:100); journal route может перезаписать в рантайме (journal.ts:429) | `source-inventory.test.ts:6`; `DATA_SOURCES.md:13` |
| лист `СВОД ТД-ПМ` | tab | **PROD** | `SVOD_SHEET_NAME` — `constants.ts:16` | report-map / official metrics | — | report-map.test.ts |
| логический лист monthly/`ШДЮ` | tab (в той же книге) | **PROD** | current code: `SHDYU_SHEET_NAME_CANDIDATES=['ШДЮ','ШДЮ старый']` — `shdyu-map.ts`; current product naming note: новый лист называется `СВОД с месяцами` | reconcile (monthly) | Slice 0 doc-only: code still resolves `ШДЮ`/`ШДЮ старый`; align to `СВОД с месяцами` in a dedicated SHDYU slice | source-inventory.test.ts; shdyu-ingest.test.ts; reconcile.test.ts |
| лист(ы) `ВСЕ` / `Все` | tab | **PROD** | dept sheetName для УАГЗО/УД/УКСиМП/УО (`department-registry.ts`) | dept ingest | title-case вариативность → sheet-name-candidates | `google-sheets-sheet-candidates.test.ts`; `source-inventory.test.ts` |
| УЭР | Google Sheet | **PROD** | `15NEAE1zK0qc5li4BCwT4Jq-MH6uuA_SFFMG22ZrM4t4` — `data-sources.ts:4` | fetchDepartmentSpreadsheets | — | source-inventory.test.ts |
| УИО | Google Sheet | **PROD** | `1qCBY5EDSASxK6_ZPQbxzdF8cKIjcwcuykbnOc45Ukn8` — `data-sources.ts:5` | — | данные «грязные» (валидатор листа даёт ложные срабатывания, см. GAP L1.3) | source-inventory.test.ts |
| УАГЗО | Google Sheet | **PROD** | `1DgO0t_Zx-PXmtLBp5ddkQvb2_pTkmyFKP_PaDqjOyXk` — `data-sources.ts:6` | лист `ВСЕ` | metadata 2026-06-04: вкладки `УАГЗО` нет, aggregate `ВСЕ` есть | source-inventory.test.ts |
| УФБП | Google Sheet | **PROD** | `14A7vvvvPFxY3SKwtYnMsNfmn_kkxbxWSkN78cYBfszQ` — `data-sources.ts:7` | — | — | source-inventory.test.ts |
| УД | Google Sheet | **PROD** | `1zrpgVaCyS4S4KBNMFuDleMJS-PSTonHmPY_bRLgTVsg` — `data-sources.ts:8` | лист `ВСЕ` | — | source-inventory.test.ts |
| УДТХ | Google Sheet | **PROD** | `1bxh-mRLQ_ODsdpZ4JW2JJ8sOMjg4zJRhPydR6vjzqb4` — `data-sources.ts:9` | — | — | source-inventory.test.ts |
| УКСиМП | Google Sheet | **PROD** | `1aFAw9AfNxkTVCqwp6G6fchn3ZeDi8FwFu5-xgRSo7aI` — `data-sources.ts:10` | лист `ВСЕ` | — | source-inventory.test.ts |
| УО | Google Sheet | **PROD** | `1AGvXDSKSjpPc11ce4NDK262qySM4W6nFTq2YcgQ6Sds` — `data-sources.ts:11` | лист `ВСЕ` | самый большой (~2368 строк) | source-inventory.test.ts |
| demo | sentinel | НЕ-prod | `DEMO_SPREADSHEET_ID='demo-spreadsheet-no-credentials'` — `services/demo-data.ts:17` | fallback при недоступности Sheets | снимок помечается `demo-*` | — |
| XLSX exports / СВОД-25-26 / копии УКСиМП / Архитектура / Генератор Отчетов / ОТЧЕТЫ | архив/копии | **НЕЛЬЗЯ в prod** | в коде НЕ зарегистрированы | — | **в коде нет фильтра/реестра, отделяющего их** — только тест запрещает «лишние» главные ID | строки встречаются лишь в комментариях `dictionaries/*` |

**Вывод по §3:** production input = 1 главная книга + 8 dept-книг (+ demo sentinel). Полный grep ID (`1[A-Za-z0-9_-]{43}`) по `*.ts` даёт **ровно эти 9**. Явного production-vs-archive разделения в коде **нет** (только `source-inventory.test.ts` фиксирует «единственная главная книга + ровно 8 dept»). Это P0-риск управляемости источников (Sprint 6 — Source Governance).

---

## 4. Shared layer map

| file | exports | source of truth? | imported by | tests | risks |
|---|---|---|---|---|---|
| `constants.ts` | `SVOD_SPREADSHEET_ID` (:13), `SVOD_SHEET_NAME` (:16), `ALL_SHEETS` (:22) | **да** (главный ID + имена листов) | server config, snapshot, report-map | report-map.test | env override главного ID (config.ts:100) |
| `data-sources.ts` | `DEPARTMENT_SPREADSHEET_IDS` (:3-12) | **да** (8 dept ID) | server config | source-inventory.test | — |
| `department-registry.ts` | `DEPARTMENT_REGISTRY` (latinId/fullName/shortName/sheetName/svod rows), `ALL_LATIN_IDS`, `CYRILLIC_TO_LATIN` | **да** (реестр 8 ГРБС) | report-map, svod-view, orchestrator, google-sheets | report-map.test, grbs-profile-parity, source-inventory.test | УАГЗО/УД/УКСиМП/УО → sheetName `ВСЕ` |
| `report-map.ts` | `REPORT_MAP` (>200 ячеек СВОД), `DEPARTMENT_ROWS`, `buildSvodView`-смежные, helpers | **да** (карта ячеек СВОД→metricKey) | snapshot ingest, dashboard, svod-view | report-map.test, bijection.test | — |
| `svod-view.ts` | `buildSvodView`, `hasSvodData`, типы (Sprint-предыдущий, мой) | да (сборка панели СВОД из officialMetrics) | web SvodView | svod-view.test (46 в shared) | — |
| `shdyu-map.ts` | `SHDYU_SHEET_NAME`, `SHDYU_SHEET_NAME_CANDIDATES`, `SHDYU_BLOCKS`/`SHDYU_ALL_BLOCK`, `SHDYU_LEGACY_BLOCKS`/`SHDYU_LEGACY_COLS`, `SHDYUFormulaIssue` | **да** (раскладка листа ШДЮ + formula evidence contract) | core shdyu-ingest, server source tests | shdyu-ingest.test, reconcile.test (косвенно), source-inventory.test | current/legacy геометрия по позиции строк; fallback `ШДЮ старый` должен быть удалён после переименования prod-вкладки |
| `dictionaries/index.ts` | методы/алиасы (`normalizeMethod`,`isCompetitive`), активности, EP-причины, legal-refs, CHECK_REGISTRY, grbs/subordinate registry | **да** (нормализация + правила) | core (calc-engine, validate, signals), web | method-alias-integration, analytics, parity | `subordinate-registry` — 13 TODO, неполные 72 учреждения (GAP L4.2) |
| `types.ts` | `NormalizedMetric` (:414), `DataSnapshot` (:493+), DTO-типы | **да** (контракт server↔web) | везде | schemas.test | `any` на границах (P1) |
| `rule-book.ts` | `RULE_BOOK` (12 правил), `getActiveRules` | **да** (валидационные правила) | core validate | validate.test, report-map.test | severity переопределяется CHECK_REGISTRY |

---

## 5. Core layer map

**Канон расчёта = `CalcEngine` — единственный движок. Легаси-движок `recalculateFromRows` удалён (2026-06-15, chunk A): эквивалентность была доказана calc-engine-regression 8/8, после чего движок и parity-тест retired. В `recalculate.ts` остались только result-shape типы + `getMonthFromDate`.**

| file | key functions | input | output | metrics/signals | tests | risks |
|---|---|---|---|---|---|---|
| `pipeline/orchestrator.ts` | `runPipeline` (:428), `mergeRecalcIntoMetrics` (:44), `mergeSummaryMetrics` (:291), `detectSignalsToIssues` (:573) | `PipelineInput` | `DataSnapshot` | пишет все metricKey; emit `signal:*` | `exec-count-pct.test.ts` covers `amount_dev` contract; нет прямого full e2e (`UNCLEAR`) | **`amount_dev` и year-роллапы КП/ЕП считаются ЗДЕСЬ, не в CalcEngine** (:96-117,:183-202); sign теперь `planSum-factSum`, как в METRICS_CONTRACT |
| `pipeline/calc-engine.ts` | `CalcEngine.compute`, `STANDARD_METRICS`/`STANDARD_DERIVED`, `classifyMethodGroup` (:199-206), gates | raw rows | `GroupedResults` (14 разрезов) | plan/fact count, суммы, экономия, derived % | exec-count-pct, method-alias | single-pass, config-driven (golden) |
| `pipeline/calc-engine-adapter.ts` | `adaptToRecalcMetrics` | `GroupedResults` | `RecalculatedMetrics` (legacy shape) | year/quarter/month/sub/activity | exec-count-pct | **год-итоги: plan=Σкварталов, fact=Σкварталов + `_orphan`** → возможен exec>100% по штукам; `UNCLEAR`/требует сверки со СВОД-семантикой (Sprint расчётов) |
| `pipeline/recalculate.ts` | только типы (`RecalculatedMetrics` и суб-типы) + `getMonthFromDate` (:193) | — | типы result-shape | — | через exec-count-pct (adapter) | движок retired (chunk A, 2026-06-15); файл — tombstone типов, потребители: adapter, orchestrator, grbs-profile, unified-svod (getMonthFromDate) |
| `pipeline/ingest.ts` | `ingestBatchGetResponse` (:287), `ingestSheetRows` (:359) | Sheets batchGet | cell-map `Sheet!A1` | — | `UNCLEAR` (нет ingest.test) | пустые/null ячейки отбрасываются (:196) |
| `pipeline/signals.ts` | `detectSignals` (:245), `classifyRowState` (:563), `getSignalBadges` (:609) | `{col:value}` | 26-флаговый `RowSignals` | `signal:*` | signals.test | статус читается из U+AE эвристикой; `budgetMismatch` всегда false (deprecated, :449) |
| `pipeline/validate.ts` | `validateData` (:31) | rows + RULE_BOOK | `Issue[]` | 12 правил | validate.test | severity берётся из CHECK_REGISTRY, переопределяя правило |
| `pipeline/reconcile.ts` | `reconcile`, `reconcileMonthly`, `crossVerifyQuarterly`, `inferSHDYURootCause` | recalcResults + shdyuData | `MonthlyReconSummary` (= API shape) | rootCause, budget breakdown | reconcile.test (46) | **является и расчётом, и контрактом API** — переименование поля = breaking change; rootCause: auto-inferred 5 из 8 |
| `pipeline/shdyu-ingest.ts` | `parseSHDYUSheet`, `validateSHDYUConsistency` | лист ШДЮ values + optional formulas | `SHDYUDeptData` {months,comp/ep,total,quarterly,formulaIssues} | formula source mismatch evidence | shdyu-ingest.test (3) | месяц = позиция строки (имя месяца advisory); formulaIssues не поднимаются в rootCause, если числовая строка полностью совпала |
| `metrics/registry.ts` | `METRIC_KB` (KB-тексты 10-блочных тултипов) | — | строки документации | **ничего не считает** | `UNCLEAR` (нет теста) | прозаический KB может дрейфовать от гейтов |
| `trust/scorer.ts` | `computeTrustScore` (5 компонент, веса 30/25/20/15/10) | metrics+issues+deltas | trust score+grade | trust | scorer.test | веса/grade в коде; UI дублирует формулы |
| `analytics/*` | Benford, EWMA, z-score, forecast, compliance-44fz, centralization, grbs-profile | snapshot/rows | аналитика | dataset-signals | analytics.test, dataset-signals.test | baselines статичны (GAP L3.3) |

**Ответы на ключевые вопросы §5:**
- **CalcEngine vs recalculateFromRows:** вопрос закрыт — recalculateFromRows удалён (chunk A). CalcEngine — единственный движок (orchestrator.ts:444,:463); 3 гейта (факт-дата notEmpty, AD=«да», methodGroup) живут только в нём и запинены standalone-тестами exec-count-pct.test.ts.
- **economy_total:** `sum(economy_fb/kb/mb)`, гейт `[HAS_FACT, AD='да']` (calc-engine.ts:326-351). НЕ «план−факт».
- **amount_deviation:** `planSum − factSum`, в **orchestrator** (:96-97 и др.), не в CalcEngine; контракт закреплён `exec-count-pct.test.ts`.
- **ЕП/КП:** `classifyMethodGroup` (calc-engine.ts:199-206): `normalizeMethod`; `ЕП→ep`; пусто→competitive (семантика `L<>"ЕП"`); неизвестно→null. Гейты `op:'methodGroup'`.
- **SHDYU rootCause:** `inferSHDYURootCause` (reconcile.ts) — auto-infers 5 causes; 3 остаются catalog-only до row-level evidence. `formula_source_mismatch` строится из формул ШДЮ, а не из догадки по нулям CalcEngine.
- **Тесты-защита:** exec-count-pct (count-based + economy AD-gated + amount_dev sign), method-alias, reconcile, validate, signals, dataset-signals, trust/scorer. (calc-engine-regression retired вместе с легаси-движком — parity доказана до удаления.)

---

## 6. Server layer map

| file | endpoint/service | input | output DTO | cache/config/env | tests | risks |
|---|---|---|---|---|---|---|
| `app.ts` | `createApp` (фабрика): CORS, error handler, auth hook, 9 route-плагинов; `GET /api/health` (:63), `GET /api/debug/sheets` (только non-prod, :69); статика SPA | — | FastifyInstance | CORS хардкод localhost (:36); `NODE_ENV` | app-security.test | CORS только localhost → прод-origin нужен через same-origin статику |
| `index.ts` | процесс-entrypoint (12 строк): `createApp→startServer→preloadData` | — | — | — | — | — |
| `config.ts` | env (zod), источники, `updateSpreadsheetId` (:87) | `.env` | config | `CACHE_TTL_SECONDS`=300, `AEMR_API_KEY`, `DB_PROVIDER` | (через app-security) | env может переопределить главный ID (:100) |
| `middleware/auth.ts` | `registerAuthHook`: fail-closed в prod, Bearer, `timingSafeEqual` | header | 401/ok | `AEMR_API_KEY` | app-security.test | `safeCompare` ранний выход при разной длине (leak длины, minor) |
| `services/snapshot.ts` | **LIVE** `getSnapshot`→`createSnapshot`→`runPipeline` | targetYear | `DataSnapshot` | per-year cache (TTL 300с) | нет прямого теста (`UNCLEAR`) | при ошибке Sheets → demo snapshot (`demo-*`) |
| `services/google-sheets.ts` | Sheets API: `batchGetCells`, `getSheetData`, `fetchDepartmentSpreadsheets`, `fetchSHDYUSheet`, `writeCellValue` | spreadsheetId | rows/cells | service-account/API key | source-inventory, sheet-candidates | **UNFORMATTED_VALUE** → формулы СВОД приходят числами (корректно) |
| `services/pipeline.ts` | **PARALLEL/DEAD** `refreshDashboard`/`getDataSnapshot` | — | `DashboardPayload` (иной DTO!) | свой кэш | нет, 0 импортёров | мёртвый код → удалить или явно пометить (Sprint 8) |
| `services/sheet-name-candidates.ts` | `departmentSheetNameCandidates` (ВСЕ/Все + dept) | sheetName | string[] | — | sheet-candidates.test | — |
| `routes/dashboard.ts` | **LIVE** `GET /api/dashboard` (+ /reconciliation, /reconciliation/monthly, /refresh, /trust/:id, /export) | year | `DashboardData` | через snapshot | нет прямого теста (`UNCLEAR`) | большой файл (god-route, P1); reconcile-структуры = wire shape |
| `routes/journal.ts` | журнал + `updateSpreadsheetId` (:429) | — | — | пишет data/sources.json | — | **аутентифицированный вызов может перенацелить главный источник в рантайме** (P0/P1 governance) |

**§6 критический вопрос — двойной путь:** живой `GET /api/dashboard` использует **`services/snapshot.ts`** (dashboard.ts:2,28 → snapshot.ts:98→188 runPipeline). **`services/pipeline.ts` — мёртвый** (0 импортёров, иной DTO `DashboardPayload`, свой кэш). Не UNCLEAR — разрешено однозначно. Рекомендация: пометить/удалить pipeline.ts (Sprint 8, с разрешения).

**Server entry:** `index.ts` (бутстрап) → `app.ts` `createApp` (фабрика, тестируемый composition root). `app-security.test.ts` проверяет: fail-closed без `AEMR_API_KEY` в prod; `/api/health` публичен и не течёт секреты; Bearer обязателен на защищённых; `/api/debug/sheets` = 404 в prod. Заголовки безопасности (HSTS/CSP) **не ставятся** (`UNCLEAR`/gap для Sprint security).

---

## 7. Web layer map

| file | page/hook/store | API input | derived (browser) | filters | UI output | tests | risks |
|---|---|---|---|---|---|---|
| `store.ts` | zustand: page, 6 фильтров, dashboardData, fetch | `GET /api/dashboard` | — | все (источник фильтров) | — | store.test (3 кейса) | `any` (P1) |
| `hooks/useFilteredData.ts` | центральная агрегация под фильтры | dashboardData | totals/barData/summaryByPeriod пересобираются (:320-705) | dept/sub/method/activity/budget/period/month/search | — | useMultiDimMetrics.test (косвенно) | большая клиентская реагрегация (D9/D10) |
| `hooks/useMultiDimMetrics.ts` | обогащение per-dept (orgSelf/subs/budget/method/quarters) | через fd | ExecutionMetrics, epShare, economyPct, deltas (:135-343) | 6 осей | — | useMultiDimMetrics.test | `safePct` округление 1 знак (D11) |
| `lib/economy-metrics.ts` | `getFilteredEconomyTotal`/`selectedEconomy` | fd | экономия budget-aware, **предпочитает AD-gated economyTotal** | budget | — | через useMultiDimMetrics.test | «правильный» путь экономии |
| `lib/metrics-registry.ts` | прокси над core `METRIC_KB` + цветовые пороги | — | — | — | — | нет | цветовые бэнды — вторая копия порогов (D, косметика) |
| `pages/Dashboard.tsx` (802) | `dashboard` | dashboardData | `buildHeroKPIs`: amountPct, спарки, economy %, trust binary (:425-523); rating fbExecPct (:116) | dept, procurement, period | StatusLine, 4 HeroKPI, RatingTable, Plan/Fact chart, экзек-бар, BlindSpots | нет direct; `.feature` не запускаются | дублирует экзек/economy-арифметику core (D1/D2/D6/D8) |
| `pages/Economy.tsx` | `economy` | fd.depts | `deptEconomy`: limit/fact/economy/pct, economy from `economyTotal/economyFB/KB/MB`, never `plan−fact` | ВСЕ 6 | hero strip, charts, dept table (ст.37/22), subs | economy-metrics.test + economy-copy.test | progress bar shows fact vs remaining limit; remaining limit is not labeled economy |
| `pages/Quality.tsx` (57) | `quality` (хаб) | — | — | — | 5 sub-tab → Trust/Recon/Issues/Recs/Journal | store.test (default tab=recon) | — |
| `pages/Recon.tsx` (1090) | sub-tab `recon` | `/api/reconciliation`, `/reconciliation/monthly`, export | `diagnoseDelta` эвристика; `deltaPct` fallback (:233-235) | dept, period; view-toggle | 4 вида: dept/metrics/monthly(ШДЮ)/subs; диагностика с СВОД-ячейками | core reconcile.test (бэк) | `DEPT_SVOD_CELLS` (:10-19) + dept→row map хардкод в UI (дубль REPORT_MAP) |
| `pages/Trust.tsx` (604) | sub-tab `trust` | `dashboardData.trust` | под dept-фильтром использует `buildTrustViewModel`: component average + backend-style weighted overall | dept/sub | gauge+grade, 5 компонент, per-dept таблица | trust-metrics.test, core scorer.test | page всё ещё содержит много `any`, но weighted formula закреплена |
| `pages/SvodView.tsx` | `svod` (мой Sprint-предыдущий) | dashboardData.snapshot.officialMetrics | `buildSvodView` (из shared) | period(q1/year), budget | таблица СВОД 1:1 | svod-view.test (shared) | — |
| `App.tsx` | роутер switch (:109-125) | — | — | — | рендер страниц + ErrorBoundary | — | legacy-алиасы recon/trust/issues/recs/journal → Quality |

**§7 ключевое:**
- **Что пересчитывается на фронте** (риск дрейфа с core) — см. §12 таблицу D1–D13. Прежние P0 по Economy/Trust закрыты; остаются дубли формул и фильтров в UI.
- **Фильтры** ТД/ПМ/method/dept/period/budget: входят через `store.ts`, применяются в `useFilteredData.ts` (клиентская реагрегация, т.к. API отдаёт полнодатасетные summary).
- **Контрольная зона:** `Quality` — хаб; `Recon`/`Trust` — его sub-tab’ы (не отдельные роуты). Порядок табов: recon, trust, issues, recs, journal; дефолт `recon` (store.ts:328).

---

## 8. Metric flow map

> Подробный контракт — `docs/METRICS_CONTRACT.md`. Здесь — поток источник→core→API→UI + gaps. Live = CalcEngine→adapter→orchestrator.

| metric | source columns (dept-лист) | core calculation | API field | frontend hook | UI location | tests | caveats |
|---|---|---|---|---|---|---|---|
| plan_count | строки (gate row-filter) | CalcEngine count | `grbs.{d}.{p}.plan_count` | useFilteredData | Dashboard/Economy | exec-count-pct | — |
| fact_count | + факт-дата Q notEmpty | CalcEngine count [HAS_FACT] | `…fact_count` | useFilteredData | Dashboard | exec-count-pct | плейсхолдеры Х/X/«-» отсекаются |
| exec_count_pct | — | derived pct(fact_count, plan_count) | `…exec_count_pct` | useFilteredData (+ спарк пересчёт D6) | HeroKPI (главный) | exec-count-pct | **главный KPI, по штукам** |
| plan_total | H+I+J (или K) | CalcEngine sum | `…plan_total` | useFilteredData | Economy/Dashboard | bijection | лимиты программ, не НМЦК |
| fact_total | V+W+X (или Y), [HAS_FACT] | CalcEngine sum | `…fact_total` | useFilteredData | — | — | — |
| execution_pct | — | derived pct(fact_total, plan_total) | `…execution_pct` | Dashboard `buildHeroKPIs` (пересчёт D1) | HeroKPI (вторично) | — | по деньгам (≠ exec_count_pct) |
| amount_deviation | — | **orchestrator** `planSum−factSum` (:96-117) | `…amount_dev` | — | Economy | exec-count-pct.test | НЕ в CalcEngine; НЕ называть экономией |
| economy_total | Z+AA+AB, [HAS_FACT, AD=«да»] | derived sum gated | `…economy_total` | lib/economy-metrics / Economy.tsx | Economy | exec-count-pct, economy-metrics.test, economy-copy.test | НЕ `plan−fact`; UI progress bar may show remaining limit, but must not call it economy |
| competitive_count | L (метод) | count [methodGroup=competitive] | `…year.competitive_count` | useMultiDimMetrics | Dashboard | method-alias | `L<>"ЕП"` (пусто→КП) |
| ep_count | L | count [methodGroup=ep] | `…year.ep_count` | useMultiDimMetrics | Dashboard | method-alias | — |
| comp_fact_count | L + Q | count [HAS_FACT, comp] | (через comp_exec_count_pct) | — | — | exec-count-pct | G-столбец СВОД |
| ep_fact_count | L + Q | count [HAS_FACT, ep] | (через ep_exec_count_pct) | — | — | — | — |
| ep_share_pct | — | derived pct(ep, comp+ep) | `…year.ep_share_pct` | useMultiDimMetrics (D11) | Dashboard | — | ≠ ep.percent (бюджетная доля) |
| SHDYU monthly recon | ШДЮ vs recalc | reconcileMonthly (count/total/budget cells, статус) | `/api/reconciliation/monthly` rows | Recon.tsx | Recon monthly | reconcile.test | budget breakdown теперь в counts (Sprint 0 fix) |
| rootCause | — | inferSHDYURootCause | в строках recon (verbatim) | Recon.tsx expandable monthly row | Recon | reconcile.test, SHDYU_RECONCILIATION.md | 5 из 8 auto-inferred; action/evidence видны в UI; formula-source evidence идёт из parser formulas |

Gaps vs METRICS_CONTRACT.md: `amount_dev`/year-роллапы живут в orchestrator; rootCause для 3 row-level причин ещё неполон.

---

## 9. Reconciliation and SHDYU map

- **Парсинг ШДЮ:** `parseSHDYUSheet(values, formulas?)` → `Record<grbsId, SHDYUDeptData>`; auto-detect current/legacy формат. Current: no year column, 40-row blocks + quarterly section. Legacy production tab `ШДЮ старый`: column C = year, data starts at D, 33-row blocks, no quarterly section. Месяц определяется **позицией строки**. Optional formulas are scanned for department-sheet reference mismatches and stored in `formulaIssues`.
- **Структуры:** `SHDYUDeptData {months:1..12{comp,ep + legacy flat}, compTotal, epTotal, summary, quarterly}`; ячейка = 18-полевой `SHDYUBlockMetrics`.
- **Monthly reconciliation:** `reconcileMonthly` (reconcile.ts:443) — сверяет ШДЮ vs recalc по count/total + побюджетным (ФБ/КБ/МБ) ячейкам; `counts` теперь включает budget breakdown (исправлено в Sprint 0); статусы ok/warning/high/empty.
- **Quarterly cross-check:** `crossVerifyQuarterly` — Σ(3 мес ШДЮ) vs СВОД-квартал.
- **rootCause:** определено 8 (`SHDYU_RECON_ROOT_CAUSES`), auto-inferred **5** (`formula_scope_limited`, `department_alias_mismatch`, `economy_flag_gated`, `procurement_method_mismatch`, `formula_source_mismatch`). Доходит до API дословно (reconcile-структуры = wire shape; dashboard.ts→reply.send) и виден в expandable monthly UI.

| feature | implemented? | file | test | missing piece |
|---|---|---|---|---|
| ШДЮ ingest current/legacy (месяцы/КП/ЕП/итоги/quarterly где есть) | ✅ | shdyu-ingest.ts | shdyu-ingest.test + reconcile.test (косв.) | — |
| monthly reconcile (count/total) | ✅ | reconcile.ts:443 | reconcile.test | — |
| budget breakdown в counts | ✅ (Sprint 0) | reconcile.ts | reconcile.test:470 | — |
| quarterly cross-check | ✅ | reconcile.ts | reconcile.test | — |
| rootCause `formula_scope_limited` | ✅ | reconcile.ts | reconcile.test | — |
| rootCause `department_alias_mismatch` | ✅ | reconcile.ts | reconcile.test | — |
| rootCause `economy_flag_gated` | ✅ | reconcile.ts | reconcile.test | — |
| rootCause `procurement_method_mismatch` | ✅ | reconcile.ts | reconcile.test | row-level evidence повысит confidence |
| rootCause `formula_source_mismatch` | ✅ | shdyu-ingest.ts + reconcile.ts | shdyu-ingest.test + reconcile.test | flags only mismatch rows; matching numeric rows keep formula notes internal |
| rootCause др. 3 причин (`activity_filter_hidden_rows`, `contract_split_rows`, `reserve_status_excluded`) | catalog-only | reconcile.ts | — | требуется row-level evidence |
| rootCause в UI (Recon monthly) | ✅ | Recon.tsx | web typecheck | label/confidence/evidence/suggestedAction в expanded row |
| `.feature` ШДЮ (Gherkin) | ❌ не запускается | web/tests/features/reconciliation-shdyu.feature | нет раннера | подключить раннер или конвертировать |

---

## 10. Signals and quality map

- **Где живут:** row-сигналы — `core/pipeline/signals.ts` (26 флагов `RowSignals`); датасет-сигналы — `core/pipeline/dataset-signals.ts` (Benford MAD, z-score, outliers, EP-risk, seasonal, splitting, systemic); валидация — `core/pipeline/validate.ts` исполняет `shared/rule-book.ts` (12 правил); severity/группы — `CHECK_REGISTRY` (shared/dictionaries).
- **Реально считаются (row):** signed, planning, notDue, canceled, overdue, hasFact, planSoon, financeDelay, economyFlag, economyConflict, epRisk, dataQuality, formulaBroken, singleParticipant, highEconomy, lowCompetition, earlyClosure, factExceedsPlan, stalledContract, factWithoutDate, dateWithoutFact, factDateBeforePlan, planWithoutExecution, epJustificationMissing, budgetUnderallocation, budgetSourceMissing. (`budgetMismatch` — deprecated, всегда false.)
- **Правила (12):** budget_sum_plan/fact, execution_percentage, deviation_calc, q1_leq_year, fact_leq_plan, method_validation, type_validation, status_on_data_rows, economy_sign_check, dept_fact_sum, dept_economy_sum.
- **Связь с trust/quality UI:** сигналы→`Issue[]` (orchestrator `SIGNAL_ISSUE_MAP`), trust считается `scorer.ts` (5 компонент); UI — `Quality`/`Trust`/`Issues`.
- **Gaps до продукта:** анти-корр индикаторы не консолидированы (GAP L3.1, ~7 размазаны); narrative-движок 5 режимов — миф (есть типы рекомендаций, не движок, GAP L3.2); `subordinate-registry` неполон (L4.2).

---

## 11. Tests map

| test file | package | behavior protected | related prod file | status | gaps |
|---|---|---|---|---|---|
| store.test.ts | web | navigateTo sync; default qualityTab=recon | store.ts | ✅ active | только 3 кейса; нет dept/budget/period/URL |
| hooks/useMultiDimMetrics.test.ts | web | global totals AD-gated economy; quarterSpark | useMultiDimMetrics.ts, economy-metrics.ts | ✅ | один happy-path; нет фильтров/subs/deltas |
| shared/svod-view.test.ts | shared | КП/ЕП/ИТОГО, 8 ГРБС, null | svod-view.ts | ✅ | — |
| shared/schemas.test.ts | shared | zod-схемы, DashboardData shape | schemas.ts | ✅ | DashboardData smoke-only |
| shared/report-map.test.ts | shared | REPORT_MAP >200, ячейки, RULE_BOOK ≥12 | report-map.ts | ✅ | — |
| core/trust/scorer.test.ts | core | взвешенный trust, границы grade | trust/scorer.ts | ✅ | **не покрывает Trust.tsx re-average (D5)** |
| core/analytics/analytics.test.ts | core | Benford/EWMA/z/forecast/44-ФЗ/centralization | analytics/* | ✅ | — |
| core/analytics/grbs-profile-registry-parity.test.ts | core | baselines↔dictionaries паритет | analytics, dictionaries | ✅ | — |
| core/utils/statistics.test.ts | core | mean/stddev/z/benford | utils/statistics.ts | ✅ | — |
| core/pipeline/exec-count-pct.test.ts | core | exec_count_pct count-based; **economy AD-gated** | calc-engine*, adapter | ✅ | protects economy from `plan−fact` drift |
| core/pipeline/validate.test.ts | core | scope/header/rowFilter/severity | validate.ts | ✅ | — |
| core/pipeline/signals.test.ts | core | сигналы/state/badges | signals.ts | ✅ | — |
| core/pipeline/reconcile.test.ts | core | reconcile/monthly(ШДЮ)/quarterly/rootCause catalog | reconcile.ts | ✅ (46/46) | покрывает бэк Recon, не UI-эвристики |
| core/pipeline/shdyu-ingest.test.ts | core | empty sheet guard; legacy production tab C=year; formula reference evidence | shdyu-ingest.ts, shdyu-map.ts | ✅ (3/3) | нет fixture для полного реального XLSX |
| core/pipeline/delta.test.ts | core | computeDeltas tolerance/null/zero | …delta | ✅ | Recon fallback deltaPct (D7) не покрыт |
| core/pipeline/normalize.test.ts | core | normalizeMetrics | normalize* | ✅ | — |
| core/pipeline/normalizer-rules.test.ts | core | detectFieldType, money/date/status | normalizer-rules.ts | ✅ | — |
| core/pipeline/classify.test.ts | core | classifyRows | classify* | ✅ | — |
| core/pipeline/input-control.test.ts | core | formula/editable column | input-control.ts | ✅ | — |
| core/pipeline/calc-engine-regression.test.ts | core | **CalcEngine vs legacy recalculate parity** | calc-engine*, recalculate.ts | ✅ | — |
| core/pipeline/method-alias-integration.test.ts | core | method aliases → calc-engine | calc-engine.ts, dictionaries | ✅ | — |
| core/pipeline/bijection.test.ts | core | REPORT_MAP полнота/bijection | report-map.ts | ✅ | — |
| core/pipeline/dataset-signals.test.ts | core | benford/outliers/epRisk/anomalies | dataset-signals.ts | ✅ | — |
| server/app-security.test.ts | server | fail-closed/health/bearer/debug-off | app.ts, auth.ts, config.ts | ✅ | нет проверки security-заголовков |
| server/source-inventory.test.ts | server | 1 главная книга + 8 dept + ВСЕ | google-sheets.ts, data-sources.ts | ✅ | не отделяет archive |
| server/google-sheets-sheet-candidates.test.ts | server | кандидаты имени листа | google-sheets.ts, sheet-name-candidates.ts | ✅ | — |
| web/tests/features/*.feature (3) | web | 6-axis filter / exec-count KPI / ШДЮ | Dashboard, useFilteredData, Recon | ❌ **НЕ ЗАПУСКАЮТСЯ** (нет cucumber/раннера) | ключевое web-поведение без исполняемых тестов |

Итого активных unit-файлов по свежему core/server/web/shared прогону: shared 4 (52 tests), core 20 (660), server 3 (14), web 5 (15). Web покрытие **тонкое**; 3 `.feature` — документация без раннера. `packages/server/dist/*.test.js` — артефакты сборки в git (минорный hygiene-флаг, CLAUDE.md запрещает коммитить build-output).

---

## 12. Known risks

### P0 — может ломать доверие к цифрам
- **Frontend derived metrics drift** — фронт пересчитывает то, что core уже считает; формула может разойтись:

  | # | метрика | место | расхождение |
  |---|---|---|---|
  | D3 | resolved: экономия берётся из AD-gated `economyTotal/economyFB/KB/MB` | Economy.tsx + economy-metrics.test | больше не `план−факт`; остаётся дублирование logic в page/helper |
  | D5 | resolved: filtered trust overall = weighted components | Trust.tsx + trust-metrics.test | formula aligned with `computeTrustScore`; issue details still UI-local |
  | D1/D2/D4/D6/D8 | exec/economy %/спарки пересчёт | Dashboard.tsx:432,499,565,573,116 | дублируют core-формулы |
  | D7 | recon deltaPct fallback | Recon.tsx:233-235 | округление/zero может отличаться от computeDeltas |
  | D9–D13 | клиентская реагрегация под фильтры | useFilteredData/useMultiDimMetrics | by-design, но реимплементируют core |
- **ШДЮ rootCause неполон, но top-level high rows объясняются**: 5 из 8 причин auto-inferred; current runtime `/api/reconciliation/monthly` даёт 96 rows, counts `ok=771 warning=0 high=72 empty=1653`, 13 rootCause rows (`formula_source_mismatch=6`, `procurement_method_mismatch=7`), 0 top-level high rows without rootCause. Остальные 3 требуют row-level evidence.
- **Resolved in current working tree: `amount_dev` sign drift** — fixed to `plan_total - fact_total` and covered by regression test.
- **Source mapping risk**: нет production-vs-archive разделения в коде; `journal.ts:429` позволяет перенацелить главный источник в рантайме.
- **СВОД vs расчёт**: СВОД-лист канон и не пересчитывается; расхождения только показываются (reconcile/delta), не исправляются.
- **Current dirty tree discipline**: Slice 0 is only `docs/CODEMAP.md` + `packages/web/src/pages/Economy.tsx`; SHDYU/SvodView, source inventory, data-audit corpus/scripts, and product design docs stay outside this commit.

### P1 — поддерживаемость
- **god-файлы**: `dashboard.ts` (route), `Economy.tsx` (1234), `Recon.tsx` (1090), `recalculate.ts` (908), `orchestrator.ts` (630).
- **Два движка** (calc-engine live / recalculate legacy) — менять синхронно; legacy без прод-вызова → кандидат на удаление.
- **Мёртвый `services/pipeline.ts`** (0 импортёров).
- **`any` на границах DTO/API/UI** — 278 lint warnings (0 errors).
- **Dirty tree discipline**: не смешивать Slice 0 docs/UI wording с SHDYU/SvodView, source-inventory, data-audit, scripts, or design-doc changes; коммитить только после явного подтверждения.
- **Дублирование в UI**: DEPT_SVOD_CELLS (Recon), >25%/ст.37 (Economy), цветовые бэнды (metrics-registry), формулы trust (Trust) — ручная синхронизация.

### P2 — polish/performance
- Vite-бандл `index.js` 1,374.14 кБ (>500 кБ) — нет route-level code splitting.
- `dist/*.test.js` в git.
- UI polish.

---

## 13. Commit split recommendation (НЕ коммитить — только план)

| commit | files (примерно) | purpose | risk | tests required |
|---|---|---|---|---|
| **A** server/security hardening | `app.ts`, `index.ts`, `middleware/auth.ts`, `config.ts`, `app-security.test.ts`, `vitest.config.ts` | разнос app/index, auth fail-closed, debug-guard | средний (граница приложения) | app-security.test, typecheck |
| **B** metric correctness | `reconcile.ts` (Sprint 0 fix), calc-engine/adapter если трогались | счётчики/сверка | высокий (цифры) | reconcile, exec-count-pct, regression |
| **C** source governance | `data-sources.ts`, `constants.ts`, `source-inventory.test.ts`, `sheet-name-candidates.ts`, `google-sheets-sheet-candidates.test.ts` | production-источники | средний | source-inventory, sheet-candidates |
| **D** SHDYU reconciliation | `shdyu-ingest.ts`, `shdyu-map.ts`, `reconcile.ts`, root-cause | ШДЮ сверка | средний | reconcile.test |
| **E** Control UI | `Recon.tsx`, `Quality.tsx`, `Trust.tsx`, `store.ts` | контроль/сверка UI | средний (UI) | store.test, web typecheck |
| **F** docs/codemap/contracts | `docs/*` (CODEMAP, ARCHITECTURE, DATA_SOURCES, METRICS_CONTRACT, SECURITY, RUNBOOK, REVIEW) | документация | низкий | — |
| **G** cleanup | root `Dockerfile`/`docker-compose.yml` restoration decision, tsbuildinfo policy, `pnpm-lock.yaml`, `services/pipeline.ts` (мёртвый), `dist/*.test.js`, mulch backup/merge | гигиена | низкий-средний | full gates |
| **H** gate stability | `package.json`, `scripts/typecheck-workspaces.mjs` | root `pnpm typecheck` без Node OOM на Windows | низкий | `pnpm typecheck` |

Особое: текущий Slice 0 не включает SHDYU/SvodView, source inventory, data-audit corpus/scripts, or product design docs; эти изменения требуют отдельного split после Metric/Docs Hygiene.

---

## 14. Next product slice (не начинать без разрешения)

Следующий продуктовый slice: **KPI Explainability Drawer v1**.

Причина: главная MLP-проблема сейчас не новая метрика, а доверие пользователя к числу. Drawer v1 должен показывать formula, source cells/columns, filters, gate, numerator/denominator, row count, snapshot id/source mode and last refresh. SHDYU/monthly source rename to `СВОД с месяцами` is documented here but intentionally not changed in Slice 0.
