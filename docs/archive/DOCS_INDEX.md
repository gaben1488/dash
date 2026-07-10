# AEMR Documentation Index

**Status:** documentation organization guide, 2026-07-10.

This file prevents the documentation set from growing into overlapping handoff notes. Stable product and technical facts belong in canonical docs. Handoff and audit docs may reference them, but should not become permanent sources of truth.

---

## Canonical Docs

| Doc | Purpose |
|---|---|
| `docs/PRODUCT_PLAN.md` | Product north star, phased roadmap, quality bar. Start here for product direction. |
| `docs/PRODUCT_MODEL.md` | Planned canonical entity model and ownership. Create during Phase 1 of `PRODUCT_PLAN.md`. |
| `docs/METRICS_CONTRACT.md` | Metric formulas, gates, source columns, DTO/UI traceability. |
| `docs/SIGNAL_KB.md` | Planned canonical signal registry and action semantics. Create during signal-registry work. |
| `docs/VERIFICATION_MODEL.md` | Planned source/reconciliation/rule verification model. Create during verification-layer work. |
| `docs/DATA_SOURCES.md` | Production/archive/demo source contract and source-change rules. |
| `docs/ARCHITECTURE.md` | Runtime architecture and data flow. |
| `docs/CODEMAP.md` | Current code map, risks, module ownership and implementation notes. |
| `docs/SECURITY.md` | Auth, secrets and deployment security posture. |
| `docs/RUNBOOK.md` | Operations, local/prod checks, recovery steps. |
| `docs/REVIEW.md` | Current code/security review status and residual risks. |

---

## Design And Domain Notes

These are useful design inputs, but should be consolidated into canonical docs when their decisions become stable:

| Doc | Current role |
|---|---|
| `docs/UNIFIED_SVOD_DESIGN.md` | Unified Svod design: CalcEngine as truth, sheets as verification. |
| `docs/UNIFIED_SVOD_PLAN.md` | Older implementation plan for unified Svod work. |
| `docs/SVOD_MODES_DESIGN.md` | Direction for two Svod modes and year behavior. |
| `docs/SHDYU_RECONCILIATION.md` | SHDYU reconciliation behavior and constraints. |
| `docs/mulch-cognitive-operations.md` | Memory/documentation hygiene method. |

---

## Handoff And Historical Docs

These are not canonical. Use them for context, then update canonical docs if they contain stable truth:

| Doc | Role |
|---|---|
| `docs/PROJECT_KNOWLEDGE_HANDOFF_2026-07-10.md` | One-chat project handoff and historical context. |
| `docs/AGENT_HANDOFF_REVIEW_HARNESS_2026-07-10.md` | Security/review handoff harness. |
| `docs/AGENT_SERVICE_TARGET_HARNESS_2026-07-10.md` | Agent execution wrapper around `PRODUCT_PLAN.md`. |
| `memory/audit/*` | Historical audit evidence and bug discovery. Re-check on current HEAD before acting. |
| `docs/deleted-backups/*` | Deleted backup material. Do not cite as current product truth. |

---

## Update Rules

1. Put new stable product direction in `PRODUCT_PLAN.md`.
2. Put new business entities in `PRODUCT_MODEL.md`.
3. Put metric math and traceability in `METRICS_CONTRACT.md`.
4. Put signal definitions in `SIGNAL_KB.md`.
5. Put source/reconciliation/rule verification semantics in `VERIFICATION_MODEL.md`.
6. Put source IDs and production/archive/demo rules in `DATA_SOURCES.md`.
7. Put operational commands and recovery steps in `RUNBOOK.md`.
8. Put temporary agent instructions in `AGENT_*`, but link back to canonical docs.
9. When a handoff/audit fact becomes stable, move it to the canonical doc and leave only a pointer in the handoff.
10. Before adding a new `docs/*.md`, check this index and decide whether an existing canonical doc should be updated instead.

---

## Current Gaps To Close

These canonical docs are referenced by `PRODUCT_PLAN.md` but intentionally not created yet:

- `docs/PRODUCT_MODEL.md`;
- `docs/SIGNAL_KB.md`;
- `docs/VERIFICATION_MODEL.md`.

Create them as part of their corresponding phases, not as empty placeholders.
