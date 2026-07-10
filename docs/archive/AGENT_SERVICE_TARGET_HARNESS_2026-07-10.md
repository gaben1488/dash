# AEMR Service Target Harness And Knowledge Transfer

> Для агентов: это не список "починить всё одним PR". Это карта целевого состояния сервиса, баг-реестр и декомпозиция на независимые агентские треки. Перед кодом используйте TDD и выполняйте только выбранный трек.

**Дата:** 2026-07-10  
**Рабочая директория:** `C:\Users\filat\dash`  
**Основные источники:** `CLAUDE.md`, `README.md`, `docs/PRODUCT_PLAN.md`, `docs/CODEMAP.md`, `docs/PROJECT_KNOWLEDGE_HANDOFF_2026-07-10.md`, `memory/audit/2026-06-13-product-model/*.md`, `docs/AGENT_HANDOFF_REVIEW_HARNESS_2026-07-10.md`.

---

## 0. Canonical Product Plan

The canonical product roadmap and quality bar live in `docs/PRODUCT_PLAN.md`.

This harness is an execution and knowledge-transfer wrapper around that plan. If this file and `docs/PRODUCT_PLAN.md` disagree, treat `docs/PRODUCT_PLAN.md` as the product source of truth and update the stale supporting doc.

Agent rules:

- do not add charts without metric registry coverage;
- do not add signals without signal registry, evidence and action semantics;
- do not fix discrepancies without filter/source/explanation evidence;
- do not build UI that silently ignores global filters;
- do not add new business entities outside the product model;
- do not perform broad refactors before contracts are stabilized.

Target pipeline:

```text
raw data -> normalized entities -> verified facts -> multidimensional metrics
-> explainable UI -> actionable signals -> issues/recommendations -> history/provenance
```

---

## 1. Человеческое целевое видение

AEMR должен быть не просто dashboard над Google Sheets, а доверительный слой контроля закупок:

- пользователь видит число и сразу понимает, почему оно такое: формула, источник, фильтры, gate-условия, numerator/denominator, row count, snapshot/source mode, last refresh;
- все вкладки считают один и тот же срез данных: год/период/метод/активность/ГРБС/бюджет должны идти единым контрактом от UI до core;
- Google Sheets остаются production input и слоем сверки, но истиной расчета становится `CalcEngine`/core, а не формулы отдельных листов;
- история должна быть не "когда pipeline запустили", а "какой отчетный срез/неделя/дата данных смотрим";
- источник данных должен быть управляемым: production vs archive/copy/demo не должны смешиваться молча;
- security MLP должен эволюционировать от shared API key в `localStorage` к нормальному login/session flow.

Главная продуктовая цель из `docs/CODEMAP.md`: **KPI Explainability Drawer v1**. Причина: главная проблема MLP сейчас не новая метрика, а доверие пользователя к цифрам.

---

## 2. Обнаруженный баг-реестр

Ниже не утверждение "это все баги в математическом смысле". Это все существенные баги/риски, найденные в текущих документах, аудитах и быстром grep-проходе по коду. Перед фиксом каждый пункт нужно перепроверить на текущем HEAD.

### P0: Ломает доверие к цифрам

| ID | Проблема | Evidence | Что сделать |
|---|---|---|---|
| P0-1 | `year=all` молча превращается в текущий год | `memory/audit/.../B-server-api.md`, `dashboard.ts` parsing `year` | Ввести явный `TimeScope`: `all` = все годы, `year` = конкретный год; либо возвращать 400, если all-time еще не реализован. |
| P0-2 | Dashboard режется по году, rows/analytics год игнорируют | `rows.ts`/`analytics.ts` вызывают `getDeptSheetValues()`/`getSnapshot()` без targetYear | Сквозной filter contract: store -> API query -> snapshot/recalc -> rows/analytics. |
| P0-3 | Reconciliation monthly/quarterly не уважает год/активность | аудит A/B: recon endpoints вызывают `getSnapshot()` без параметров | Добавить `?year=&activity=` и считать recalc в том же срезе, что и UI/книга. |
| P0-4 | `crossVerifyQuarterly` может считать блок `all` вместе с 8 ГРБС | `memory/audit/.../A-parsing-sources.md`, `reconcile.ts` | Добавить тест: `all + dept` не должны удваивать квартальную сверку; исключить `all` из quarterly dept iteration. |
| P0-5 | SHDYU formula detector дает ложные high mismatch для ссылок на `ВСЕ` | `formulaIssuesForMonthlyBlock`, `shdyu-map.ts` registry | Сверять с фактическим sheetName, а для агрегата `ВСЕ` допускать корректные ссылки. |
| P0-6 | SHDYU формат/месяцы определяются хрупко | `detectSHDYUFormat` по одной ячейке; `MONTH_TEXT_MAP` не используется для проверки | Привязать формат к выбранному sheet candidate; сверять текст месяца с ожидаемым месяцем. |
| P0-7 | Реестр пропускает строки без даты при выбранном периоде | аудит C: `DataBrowser.tsx` period filter `if (!d) return true` | При фильтре периода строки без релевантной даты должны исключаться или попадать в явный bucket `без даты`. |
| P0-8 | Economy игнорирует method/activity в расчетах | аудит C: `Economy.tsx` `mKP`/`mEP` вычислены, но не фильтруют данные | Применить единый filter contract или убрать UI-обещание фильтрации, пока она не реализована. |
| P0-9 | КП/ЕП toggle несимметричен | `Header.tsx` + `store.ts` `toggleMethod` clears when size >= 2 | Заменить на предсказуемую семантику: single-select buttons or explicit `setMethods`. |
| P0-10 | `SvodView` не читает store-период | аудит product-model | Подключить единый period/year contract к `SvodView`; не держать локальную семантику периода отдельно. |

### P1: История, provenance, governance

| ID | Проблема | Evidence | Что сделать |
|---|---|---|---|
| P1-1 | `metric_history` пишет только `officialMetrics`; calculated KPI не попадают в историю | `snapshot.ts` audit B | Писать calculated metrics с `year`/scope tag; иначе trend главных KPI невозможен. |
| P1-2 | Snapshot `createdAt` = момент прогона, а не дата отчетного среза | audit B/product-model | Добавить `cutDate`/`reportWeek`/`periodKey`, deterministic key, upsert. |
| P1-3 | `snapshots.data` пишется, но нет reader endpoint | audit B | Добавить `GET /api/history/:id` или `GET /api/snapshot?periodKey=`; либо прекратить сохранять blob. Для week-scroll нужен reader. |
| P1-4 | Нет `/api/history/diff` в текущем prod tree | audit B/product-model | Использовать `packages/core/src/history/snapshot-diff.ts` как чистую функцию и добавить route tests. |
| P1-5 | `/api/issues/:id` возвращает `history: []`, хотя history endpoint есть | audit B | В detail endpoint подтянуть `issue_history` или убрать поле из контракта. |
| P1-6 | `saveSnapshot` глотает DB ошибки | audit B | Логировать через app logger/метрику health; решить, должен ли refresh падать при невозможности записать историю. |
| P1-7 | Runtime source mutation может перенацелить production source | `journal.ts`/`updateSpreadsheetId`, `CODEMAP.md` | Source governance: approval/audit/role, explicit production source change, no silent archive/copy switch. |
| P1-8 | Production/archive separation частично только в тесте/доках | `DATA_SOURCES.md`, `source-inventory.test.ts`, `CODEMAP.md` | Вынести source registry как кодовый контракт с role/status/kind и валидатором runtime overrides. |

### P1/P2: Поддерживаемость и рефакторинг

| ID | Проблема | Evidence | Что сделать |
|---|---|---|---|
| R-1 | `services/pipeline.ts` мертвый параллельный путь | `CODEMAP.md`: 0 импортов, иной DTO | Удалить или явно пометить deprecated после `rg` подтверждения; не путать с live `services/snapshot.ts`. |
| R-2 | Клиентская реагрегация в `useFilteredData.ts` дублирует core | `CODEMAP.md` | Не переписывать сразу; сначала typed DTO/filter contract, затем перенос вычислений в core/server. |
| R-3 | `any` на DTO/API/UI границах | `CLAUDE.md`, `CODEMAP.md` | Shared DTO schemas for dashboard/issues/rows/analytics; заменить `fetchJSON<any>` постепенно. |
| R-4 | God-files | `rows.ts`, `useFilteredData.ts`, `metrics/registry.ts`, `Settings.tsx`, `Analytics.tsx`, `Recon.tsx`, `Dashboard.tsx` | Резать только по behavior slices с тестами; не делать косметический split без контрактов. |
| R-5 | Мертвые/неинтегрированные словари | audit D: `subordinate-registry`, `ep-reason-clusters`, `activity-types`, `budget-sources`, `user-roles`, `kvr`, `kosgu` | Для каждого решить: integrate into SSOT или удалить/пометить scaffold. |
| R-6 | Несколько каталогов сигналов | audit C: DataBrowser/Dashboard/Trust | Единый signal registry in shared/core, UI только рендерит metadata. |
| R-7 | Web feature specs не исполняются | `docs/CODEMAP.md`: `web/tests/features/*.feature` no runner | Либо подключить runner, либо конвертировать ключевые cases в Vitest/Playwright. |
| R-8 | Vite bundle > 1.3 MB | README/CODEMAP | Route-level code splitting после стабилизации DTO/filter contract. |

### Security P1 from previous handoff

| ID | Проблема | Evidence | Что сделать |
|---|---|---|---|
| S-1 | Vite dev host is public by default | `packages/web/vite.config.ts` | Gate via `AEMR_VITE_ALLOW_PUBLIC_HOSTS=true`; default localhost. |
| S-2 | API key in `localStorage` | `api.ts`, `README.md`, `SECURITY.md` | Short-term document residual risk; medium-term real login/session with HttpOnly SameSite cookies. |
| S-3 | `fetchJSON` header merge is fragile | `api.ts` | Use `new Headers(init?.headers)` and merge defaults explicitly. |

---

## 3. Target architecture path

### Phase 0: Stabilize trust risks

Do first because these are small and reduce immediate security/verification risk:

- Vite public host opt-in.
- API header merge.
- Auth residual-risk docs.
- Fix quarterly double count if still reproducible.
- Add targeted tests for `year=all` current behavior before changing semantics.

### Phase 1: Unified filter contract

Create one typed object, probably in `packages/shared/src`:

```ts
export type TimeScope =
  | { kind: 'all' }
  | { kind: 'year'; year: number };

export interface DataSliceFilter {
  time: TimeScope;
  period?: 'year' | 'q1' | 'q2' | 'q3' | 'q4' | `m${number}`;
  methods?: Array<'competitive' | 'single'>;
  activities?: Array<'td' | 'pm' | 'td_pm' | 'other'>;
  departments?: string[];
  budgetSources?: Array<'fb' | 'kb' | 'mb'>;
}
```

Then route through:

`store.ts` -> `api.ts` query serialization -> server route parser -> `getSnapshot`/`runPipeline`/rows/analytics/reconciliation.

Acceptance:

- `year=all` has one explicit behavior across Dashboard, Rows, Analytics, Economy, SvodView, Reconciliation.
- no route silently falls back to current year when user selected all-time.
- tests cover dashboard + rows + analytics + reconciliation with the same fixture.

### Phase 2: Source validation and reconciliation correctness

Focus on SHDYU and production source governance:

- current sheet candidate should be `СВОД с месяцами`; legacy fallback remains documented until workbook rename is complete.
- formula reference validation must know actual source sheet name, not only `grbsShort`.
- monthly parser validates month text, not only row position.
- quarterly cross-check excludes aggregate `all` rows from dept iteration.
- source registry separates production, archive, copy, demo, runtime override.

### Phase 3: Snapshot/provenance

Make history useful:

- add `periodKey`/`cutDate`/`reportWeek` to snapshot persistence;
- persist calculated KPI history, not only official Svod cell metrics;
- expose snapshot reader endpoint;
- expose diff endpoint;
- integrate event changelog/provenance only after period model is stable.

### Phase 4: Explainability Drawer v1

Build the product slice from `CODEMAP.md`:

- every KPI card opens a drawer;
- drawer shows formula, source columns/cells, active filters, gates, numerator/denominator, row count, snapshot id/source mode, last refresh;
- drawer is backed by shared/core metadata, not hand-written UI copy.

### Phase 5: Maintainability cleanup

Only after phases 1-4 have tests:

- retire `services/pipeline.ts`;
- reduce `any` at API boundaries;
- split god files by behavior;
- consolidate signal/dictionary registries;
- add route-level code splitting.

---

## 4. Agent tracks

### Track A: Evidence refresh

Goal: verify the bug registry on current HEAD.

Commands:

```bash
rg "year=all|getSnapshot\\(|metric_history|history:\\[\\]|crossVerifyQuarterly|formulaIssuesForMonthlyBlock|detectSHDYUFormat|MONTH_TEXT_MAP|toggleMethod|mKP|mEP|allowedHosts|localStorage" packages docs memory -n
pnpm -F @aemr/core test
pnpm -F @aemr/server test
pnpm -F @aemr/web test
```

Deliverable:

- `docs/AUDIT_REFRESH_YYYY-MM-DD.md` with confirmed/stale/false-positive status for each bug ID.

### Track B: Security stabilization

Use `docs/AGENT_HANDOFF_REVIEW_HARNESS_2026-07-10.md`.

Scope:

- S-1 Vite host gate.
- S-2 auth residual-risk docs.
- S-3 API header merge.

Do not start login/session rewrite in this track.

### Track C: Reconciliation correctness quick wins

Scope:

- P0-4 quarterly double count.
- P0-5 formula sheet mismatch.
- P0-6 month text/format detection.

Required tests:

- `packages/core/src/pipeline/reconcile.test.ts`
- `packages/core/src/pipeline/shdyu-ingest.test.ts`
- `packages/server/src/google-sheets-sheet-candidates.test.ts`

Acceptance:

- false high mismatches for valid `ВСЕ` references are gone;
- `all` aggregate block does not double-count quarterly verification;
- month row drift produces warning/evidence, not silent wrong parse.

### Track D: Unified filter contract design spike

This is a plan/spec task before implementation.

Deliverable:

- `docs/FILTER_CONTRACT_PLAN_YYYY-MM-DD.md`
- exact affected files;
- DTO shape;
- migration order;
- tests to pin `all`, `year`, quarter/month, method, activity, department.

Do not rewrite `useFilteredData.ts` in this spike.

### Track E: Snapshot/provenance design spike

Deliverable:

- `docs/SNAPSHOT_PROVENANCE_PLAN_YYYY-MM-DD.md`
- schema migration plan;
- endpoint contract for snapshot reader/diff;
- what to do with existing `snapshots.data`;
- how `metric_history` stores calculated metrics with scope tags.

### Track F: KPI Explainability Drawer v1 spec

Deliverable:

- `docs/KPI_EXPLAINABILITY_DRAWER_PLAN_YYYY-MM-DD.md`
- first 3 KPIs to support;
- metadata source in shared/core;
- UI drawer contract;
- tests: schema, server DTO, web render.

---

## 5. Global harness

Before claiming a track is complete, run the relevant targeted commands plus the canonical gate from `CLAUDE.md`.

Canonical gate:

```bash
pnpm lint
pnpm typecheck
pnpm -r test
pnpm build
pnpm audit --audit-level moderate
```

If local shell fails with timeout/OOM/sandbox setup refresh, do not report PASS. Record exact command and failure mode, then rerun in a fresh shell or CI.

Manual browser smoke after web/server changes:

```bash
pnpm -F @aemr/server dev
pnpm -F @aemr/web dev
```

Check:

- `GET /api/health` is public.
- Protected `/api/*` returns 401 without auth when `AEMR_API_KEY` is set.
- Dashboard, Rows/DataBrowser, Economy, SvodView, Reconciliation show coherent filter state.

---

## 6. Ready-to-copy agent prompt

```text
Рабочая директория: C:\Users\filat\dash

Сначала прочитай:
1. CLAUDE.md
2. docs/PRODUCT_PLAN.md
3. docs/AGENT_SERVICE_TARGET_HARNESS_2026-07-10.md
4. docs/AGENT_HANDOFF_REVIEW_HARNESS_2026-07-10.md
5. docs/CODEMAP.md
6. memory/audit/2026-06-13-product-model/00-PRODUCT-MODEL.md

Твоя задача: выполнить только один назначенный track из docs/AGENT_SERVICE_TARGET_HARNESS_2026-07-10.md.

Правила:
- Не пытайся чинить весь проект одним PR.
- Держи `docs/PRODUCT_PLAN.md` как canonical product direction.
- Не добавляй графики без metric registry coverage.
- Не добавляй сигналы без registry, evidence и action semantics.
- Не чини расхождения без filter/source/explanation evidence.
- Перед изменением кода напиши failing test, затем минимальную реализацию.
- Не трогай unrelated files и generated artifacts.
- Если аудит говорит о баге, сначала перепроверь его на текущем HEAD.
- Не удаляй reconcile/reconcileUnified/pipeline код без rg-доказательства и тестов: часть старых "dead code" гипотез уже была отозвана.
- Для docs/spec tracks не делай runtime-code changes.
- В финале дай: файлы, что изменено, какие bug IDs закрыты, какие команды запускались, точный результат, residual risks.

Canonical gate перед "готово":
pnpm lint
pnpm typecheck
pnpm -r test
pnpm build
pnpm audit --audit-level moderate

Если shell/sandbox падает, честно запиши command + failure mode и не заявляй PASS.

Назначенный track: <ВСТАВИТЬ Track A/B/C/D/E/F>.
```

---

## 7. Coordinator notes

Recommended order:

1. Track A: evidence refresh, because several audits are from 2026-06-13 and current HEAD may differ.
2. Track B: security stabilization from existing handoff.
3. Track C: reconciliation quick wins if Track A confirms them.
4. Track D: unified filter contract spec.
5. Track E: snapshot/provenance spec.
6. Track F: KPI drawer spec.

Do not start phases 3-5 before Phase 1 filter semantics are settled. Otherwise history, provenance and explainability will encode inconsistent slices.
