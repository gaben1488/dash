# AEMR Product Plan

**Status:** canonical product direction, 2026-07-10.  
**Purpose:** define how AEMR should evolve from the current Google Sheets dashboard into a procurement intelligence, verification and explainability product.

---

## 1. Product North Star

AEMR is not a chart dashboard. It is a procurement intelligence and verification system.

The product must transform raw procurement inputs into trustworthy operational insight:

```text
Google Sheets / source files
-> normalized entities
-> verified facts
-> multidimensional metrics
-> explainable KPI, charts and tables
-> signals
-> issues, recommendations and actions
-> history, diffs and provenance
```

Quality bar:

- every number must be explainable;
- every discrepancy must be either justified or treated as a bug;
- every signal must be necessary, understandable, evidence-backed and actionable;
- every metric must be multidimensional and traceable from source rows to UI;
- every tab must be a strong operational module, not a decorative view;
- no chart, page, signal or calculation should exist outside the shared entity model, filter contract, metric registry, source verification and user-action model.

---

## 2. What We Keep From The Current Codebase

### Shared

Keep `packages/shared` as the contract layer:

- `constants.ts`, `data-sources.ts`, `report-map.ts`;
- `schemas.ts`, `types.ts`;
- live dictionaries that are actually used by core/server/web.

Dead or scaffold dictionaries should not silently remain product truth. Each must be either integrated into the source of truth or marked/removed in a dedicated cleanup slice.

### Core

Keep `packages/core` as the calculation and verification layer:

- `pipeline/calc-engine.ts` is the main calculation engine;
- `pipeline/reconcile.ts` is the base for source reconciliation;
- `pipeline/signals.ts` and `pipeline/dataset-signals.ts` are the base for signal detection;
- `analytics/*` remains the base for anomaly, compliance, forecast and profile modules;
- `metrics/registry.ts` should evolve into a complete metric and knowledge registry, not just UI copy.

Principle: CalcEngine/core is calculation truth; Google Sheets formulas are source evidence and reconciliation material, not the primary computational authority.

### Server

Keep `packages/server` as the ingestion, snapshot and API layer:

- `services/google-sheets.ts` for source ingestion;
- `services/snapshot.ts` as the live snapshot path;
- route modules as current API surface.

Large route files such as `dashboard.ts`, `rows.ts` and `analytics.ts` should be split only through tested behavior slices, not cosmetic moves.

### Web

Keep the current app and tabs, but move them toward shared contracts:

- Dashboard;
- Economy;
- DataBrowser;
- Recon;
- SvodView;
- Analytics;
- Quality/Trust;
- Issues/Recs;
- Journal/History;
- Settings.

`useFilteredData.ts` and page-level recalculation should be reduced gradually after shared DTO/filter/metric contracts exist.

---

## 3. Product Phases

### Phase 1: Canonical Product Model

Goal: stop reasoning by pages and define product entities.

Create/update:

- `docs/PRODUCT_MODEL.md`;
- `packages/shared/src/entities.ts`;
- relevant schemas in `packages/shared/src/schemas.ts`.

Canonical entities:

- `Source`;
- `SourceSnapshot`;
- `ProcurementRow`;
- `Department`;
- `Subordinate`;
- `Activity`;
- `ProcurementMethod`;
- `BudgetSource`;
- `DataSliceFilter`;
- `Metric`;
- `MetricValue`;
- `Signal`;
- `Issue`;
- `Recommendation`;
- `ReconciliationResult`;
- `KnowledgeEntry`.

Expected behavior:

- every raw Sheets row becomes a normalized `ProcurementRow`;
- every normalized row carries provenance: workbook, sheet, row index, source cells;
- all calculations consume these entities or typed projections of them;
- UI pages do not invent private shapes for business-critical concepts.

Acceptance:

- `PRODUCT_MODEL.md` maps each entity to current files and intended owner;
- shared schemas cover the cross-package entities used by server and web;
- no implementation PR introduces a new business entity without adding it to the model.

### Phase 2: Unified Filter Contract

Goal: all tabs operate on the same data slice.

Create/update:

- `packages/shared/src/filter-contract.ts`;
- `packages/shared/src/filter-contract.test.ts`;
- `packages/server/src/lib/filter-contract.ts`;
- `packages/web/src/lib/filter-contract.ts`.

Initial contract:

```ts
export type TimeScope =
  | { kind: 'all' }
  | { kind: 'year'; year: number };

export type PeriodScope =
  | { kind: 'year' }
  | { kind: 'quarter'; quarter: 1 | 2 | 3 | 4 }
  | { kind: 'month'; month: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 };

export interface DataSliceFilter {
  time: TimeScope;
  period?: PeriodScope;
  methods?: Array<'competitive' | 'single'>;
  activities?: Array<'td' | 'pm' | 'td_pm' | 'other'>;
  departments?: string[];
  subordinates?: string[];
  budgetSources?: Array<'fb' | 'kb' | 'mb'>;
}
```

Rollout order:

1. Dashboard.
2. DataBrowser.
3. Economy.
4. Recon.
5. SvodView.
6. Analytics.

Expected UX:

- when the user selects `2026 + ЕП + УО + КБ`, every tab displays that same slice;
- if a tab cannot support part of the slice yet, it must say so explicitly instead of silently ignoring it;
- `all` and concrete year are distinct states, never implicit fallbacks.

Acceptance:

- route tests prove `year=all` does not silently become current year;
- rows, analytics, reconciliation and dashboard use the same serialized filter contract;
- UI tests cover method/activity/period changes across at least two tabs.

### Phase 3: Multidimensional Metrics Engine

Goal: turn isolated KPI into a coherent metrics model.

Create/update:

- `packages/core/src/metrics/engine.ts`;
- `packages/core/src/metrics/dimensions.ts`;
- `packages/core/src/metrics/registry.ts`;
- `docs/METRICS_CONTRACT.md`.

Every metric must define:

- id;
- human name;
- formula;
- supported dimensions;
- source columns/cells;
- gates;
- numerator/denominator where applicable;
- allowed aggregations;
- risk interpretation;
- UI usage;
- tests.

Example target:

```text
exec_count_pct
dimensions: year, period, department, subordinate, method, activity
formula: fact_count / plan_count
plan gate: valid procurement row
fact gate: has fact date
source: plan/fact date columns, method, activity, budget columns
```

Expected UX:

- charts do not manually recalculate business metrics;
- chart drill-down can explain exactly which rows and dimensions contributed;
- Dashboard/Economy/Analytics ask the same metric system for values.

Acceptance:

- top KPI use metric registry metadata;
- at least three major metrics have formula, gates, source mapping and tests;
- `docs/METRICS_CONTRACT.md` is the canonical metric reference, not duplicated page copy.

### Phase 4: Verification Layer

Goal: discrepancies are explained or treated as bugs/issues.

Create/update:

- `docs/VERIFICATION_MODEL.md`;
- `packages/core/src/verification/source-verification.ts`;
- `packages/core/src/verification/reconciliation-verification.ts`;
- `packages/core/src/verification/rule-verification.ts`.

Verification types:

- source completeness;
- sheet format;
- month row alignment;
- formula reference correctness;
- Svod vs CalcEngine;
- SHDYU vs CalcEngine;
- row-level anomalies;
- impossible totals;
- stale cache/source mode.

Expected UX:

- Recon shows root cause, confidence, evidence and suggested action;
- Dashboard can show whether KPI are reliable, partially reliable or require review;
- no reconciliation delta appears without an explanation state.

Acceptance:

- `crossVerifyQuarterly` cannot double-count aggregate `all` plus departments;
- SHDYU formula validation uses actual source sheet names;
- month text drift is detected with evidence;
- verification outputs are typed and usable by UI.

### Phase 5: Signal Registry And Signal UX

Goal: every signal is useful, understandable and actionable.

Create/update:

- `docs/SIGNAL_KB.md`;
- `packages/shared/src/signal-registry.ts`;
- `packages/core/src/signals/signal-engine.ts`.

Every signal must define:

- id;
- human name;
- severity;
- why it matters;
- detection rule;
- evidence fields;
- false-positive notes;
- recommended action;
- owning module;
- related metrics.

Expected UX:

- DataBrowser shows row-level signals with clear evidence;
- Quality groups signals by data-quality impact;
- Issues turns important signals into work items;
- Dashboard shows signal aggregates;
- Trust uses signals as part of confidence, not separate magic.

Acceptance:

- no new signal can be added without registry entry and test;
- duplicate signal catalogs in pages are removed or bridged to shared registry;
- signal text is understandable without reading code.

### Phase 6: Knowledge Base

Goal: make product knowledge complete and machine-usable.

Create/update:

- `docs/KNOWLEDGE_BASE.md`;
- `packages/shared/src/knowledge-base.ts`.

Knowledge base covers:

- metrics;
- signals;
- legal/methodological references;
- source contracts;
- procurement procedures;
- common discrepancy root causes;
- operator actions.

Expected UX:

- tooltips, drawers, recommendation text and agent prompts come from the same knowledge entries;
- users can understand what a metric/signal means without leaving the product;
- knowledge gaps are explicit product backlog, not hidden in comments.

Acceptance:

- the first KPI drawer and first signal set use KB entries;
- legal/method references are linked from registry entries;
- docs and UI copy do not drift.

### Phase 7: KPI Explainability Drawer V1

Goal: any important number opens to its proof.

Create/update:

- `packages/shared/src/metric-explanation.ts`;
- `packages/server/src/routes/explain.ts`;
- `packages/web/src/components/MetricDrawer.tsx`;
- tests for schema, route and render behavior.

Drawer shows:

- metric definition;
- formula;
- active filter;
- source rows/cells;
- gates;
- numerator/denominator;
- row count;
- source mode;
- snapshot id;
- last refresh;
- related signals;
- reconciliation status;
- suggested next action.

Expected UX:

- user clicks a KPI card or chart value and sees why the number exists;
- drawer links to DataBrowser rows and Recon evidence;
- unresolved discrepancies are visible, not buried.

Acceptance:

- first version supports at least `exec_count_pct`, `economy_total` and one trust/quality metric;
- drawer data comes from shared/core/server contracts, not handwritten page-only strings;
- tests prove filter context is preserved in explanations.

### Phase 8: Rebuild Tabs As Strong Modules

Goal: each tab becomes a powerful operational surface.

Dashboard:

- command center;
- explainable KPI;
- source/health status;
- critical signals;
- cross-module navigation.

Economy:

- economy by dimensions;
- budget source analysis;
- method/activity slicing;
- AD-gated economy only;
- no confusion with plan-fact residual limit.

DataBrowser:

- high-power row registry;
- row-level provenance;
- row signals;
- saved filters;
- drill-down target from every graph.

Recon:

- professional source reconciliation;
- root cause;
- confidence;
- evidence;
- action queue.

SvodView:

- canonical Svod view over CalcEngine;
- source Svod as verification matrix;
- all discrepancies explained.

Analytics:

- anomaly, compliance, forecast and profile analysis;
- multidimensional explorer;
- charts powered by metrics engine.

Quality/Trust:

- source quality;
- completeness;
- contradictions;
- confidence by module and source.

Issues/Recs:

- operational issue flow;
- issues from signals/verification;
- recommendations from KB and context.

Journal/History:

- slice history;
- diffs;
- provenance;
- who/what/when changed.

Acceptance:

- every tab states its input slice and source mode;
- every chart has drill-down and explanation path;
- no tab silently ignores a supported global filter.

### Phase 9: Snapshot, History And Provenance

Goal: history is based on reporting slices, not pipeline run time.

Create/update:

- DB migration for `periodKey`, `cutDate`, `reportWeek`;
- calculated metric persistence in `metric_history`;
- snapshot reader endpoint;
- snapshot diff endpoint;
- history UI.

Expected UX:

- user opens a weekly/reporting slice;
- compares two slices;
- sees which rows, metrics and signals changed;
- can trace source of change.

Acceptance:

- deterministic snapshot key by reporting period;
- calculated KPI history is stored with scope tags;
- snapshot blob has a reader or is no longer persisted;
- diff endpoint is covered by core and server tests.

### Phase 10: Maintainability Refactor

Only after stable contracts:

- retire or clearly deprecate `packages/server/src/services/pipeline.ts`;
- split `dashboard.ts`, `rows.ts`, `analytics.ts` by behavior;
- replace `fetchJSON<any>` with typed API DTO;
- reduce `useFilteredData.ts`;
- consolidate dictionaries;
- consolidate signal registries;
- add route-level code splitting.

Acceptance:

- every refactor preserves behavior through tests;
- no cosmetic split without ownership/contract improvement;
- docs point to canonical files, not stale handoff notes.

---

## 4. Documentation Organization

Canonical docs:

- `docs/PRODUCT_PLAN.md` — this product roadmap and quality bar.
- `docs/PRODUCT_MODEL.md` — entities and ownership.
- `docs/METRICS_CONTRACT.md` — metric definitions and traceability.
- `docs/SIGNAL_KB.md` — signal definitions and actions.
- `docs/VERIFICATION_MODEL.md` — source/reconciliation/rule verification.
- `docs/DATA_SOURCES.md` — production/archive/demo source contract.
- `docs/ARCHITECTURE.md` — technical architecture.
- `docs/SECURITY.md` — auth, secrets, deployment security.
- `docs/RUNBOOK.md` — operations.
- `docs/CODEMAP.md` — current code map and risks.

Historical/handoff docs:

- `docs/PROJECT_KNOWLEDGE_HANDOFF_2026-07-10.md`;
- `docs/AGENT_*`;
- `memory/audit/*`.

Rule: handoff and memory docs should point to canonical docs once stable facts are extracted. They should not become the permanent source of truth.

---

## 5. Agent Rules

Agents must not:

- add charts without metric registry coverage;
- add signals without signal registry and action semantics;
- fix discrepancies without filter/source/explanation evidence;
- build UI that silently ignores global filters;
- add new business entities outside `PRODUCT_MODEL.md`;
- perform broad refactors before contracts are stabilized.

Agents must:

- prove current behavior before changing it;
- write failing tests before runtime fixes;
- preserve source provenance;
- connect UI work to entity, metric, verification and knowledge contracts;
- update canonical docs when stable product truth changes.
