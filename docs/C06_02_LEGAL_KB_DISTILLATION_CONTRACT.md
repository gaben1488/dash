# C06.02 — Legal knowledge-base distillation contract (44-FZ)

Status: **architecture specification / not a certified complete legal corpus**. Source baseline: user-supplied GARANT PDF of Federal Law 44-FZ, marked current **2026-10-19**, 211 pages. This PDF alone does not verify subordinate legislation or the applicability of a norm to a specific procurement.

## Non-negotiable boundaries

1. **Source text is immutable evidence**: preserve original PDF bytes, SHA-256, publication/source metadata, pages, article/part/point anchors, and exact extracts. Do not place the copyrighted full-text PDF in this repository without redistribution rights.
2. **No number without a subject**: unit, numerator, denominator, customer scope, contract/procedure/plan-position grain, time window, comparator and inclusivity are part of the rule, not UI metadata.
3. **Separate four layers**: source (what was published), legal interpretation (what the norm means), executable condition (what facts are required), and decision (what the product can actually conclude). Human interpretations cannot silently overwrite primary text.
4. **Temporal legal truth**: immutable editions with valid_from/valid_to, source_verified_at, applicability_date_basis, transitional provisions, and links to amending acts. Snapshot results pin legal_release_id and rules_version; never recompute historical results using today's defaults.
5. **Legal conclusion is fail-closed**: absent dependent act, unclear exception, missing denominator, unknown contract grain, unconfirmed legal edition or missing evidence => insufficient_data / requires_review. No inferred violation and no false 'compliant' state.
6. **Internal heuristics are not law**: reference thresholds, suspicion scores and operational recommendations use separate namespaces, status and labels.
7. **One consumer API**: analytic panels, API, Word generator, signals, recommendations and exports receive the same typed assessment with source anchors, not hard-coded numeric copies.
8. **Migration over duplication**: adapters around legacy snapshots and consumers, contract tests, explicit deprecation; no parallel legal rule engines or silent rewrite of source history.

## Corpus model (normalized, append-only)

- `LegalSource`: id, title, jurisdiction, issuer, kind, source_uri, source_format, sha256, obtained_at, source_as_of, authoritative_level, license, verification_status.
- `LegalEdition`: source_id, edition_id, publication_date, valid_from, valid_to, effective_for_event, amendment_ids, supersedes, transitional_clause_ids, digest.
- `LegalProvision`: provision_id, edition_id, article, part, point, subpoint, text_span, page_anchor, content_digest, repeal_state.
- `LegalAtom`: atom_id, provision_id, modality (obligation/prohibition/permission/definition/exception/procedure/deadline/threshold/formula/delegation), actor, action, object, preconditions, exceptions, outcome, temporal_scope, jurisdiction_scope.
- `LegalDependency`: from_atom, to_atom_or_external_act, kind (implements/qualifies/excepts/defines/amends/overrides/requires), verification_state, effective_window.
- `LegalQuantity`: atom_id, amount_decimal_string, currency, unit, comparator, inclusive, metric_id, measurement_basis, numerator, denominator, customer_id_scope, period, rounding_policy.
- `LegalInterpretation`: id, atom_ids, question, reasoning, assumptions, reviewer, reviewed_at, confidence, competing_interpretations; no claim that model extraction equals legal verification.
- `ExecutableRule`: id, atom_ids, version, applicability_predicate, required_fact_types, required_dependent_acts, decision_table, result_schema, test_vectors.
- `RuleAssessment`: snapshot_id, procurement_entity_id, entity_grain, rule_id, rule_version, legal_release_id, source_facts, evidence_refs, evaluated_at, applicability_status, result, explanation, unresolved_reasons, provenance.
- `ConsumerBinding`: consumer_id, rule_id, rendered_field, fallback_policy, last_contract_test.

Identifiers remain stable across editions; text changes are represented by edition links, not destructive updates.

## Canonical decision semantics

`applicability` = applicable | not_applicable | unknown.
`result` = satisfied | breached | insufficient_data | requires_review | informational.
A `breached` decision is permitted only for an applicable, source-verified rule with all mandatory facts and verified external dependencies. `not_applicable` is not equivalent to `satisfied`.
Evaluation must return: input provenance, exact legal provisions and edition, numeric derivation, applied exceptions, missing evidence and legal certainty level.

## First extraction domains (from the supplied 44-FZ PDF)

1. Scope, terminology, customer types and SGOZ (arts. 1–4; art. 3 part 1 point 16). SGOZ includes current-year financing for earlier contracts: it cannot be inferred from the sum of plan rows.
2. Planning, plan-schedule, amendments, norm-setting and NMCK methodology (arts. 16, 19, 22–23).
3. Procurement method eligibility, centralization and role boundaries (arts. 24–26, 38).
4. National regime and linked Government measures (art. 14); these require a separate verified subordinate-act corpus.
5. SMP/SONKO volume and exclusions (art. 30 parts 1, 1.1, 1.2, 4); 25% is not simply 25% of all plan rows.
6. Participant requirements, contract terms, notices and guarantees (arts. 31–34, 42–45).
7. Anti-dumping decision tree (art. 37): 25% reduction threshold, separate paths above 15 million RUB and at/below 15 million RUB, exemptions, security and advance restrictions.
8. Single-supplier procurement (art. 93): each point and annual aggregate is a separate atom with contract grain, customer-year scope and exceptions; never treat one planned row as one contract.
9. Contract execution, amendment and control (arts. 94–95, 99, 103–104) to be extracted against full provision text, not assumed from heading.
10. Transitional and effective-date provisions (including art. 2 part 5 and final provisions), plus explicit repeal markers.

## Distillation pipeline

`ingest -> checksum -> structure segmentation -> cross-reference resolution -> atomization -> quantity normalization -> external-act dependency inventory -> temporal edition resolution -> legal human review -> compile typed rules -> golden tests -> immutable release -> downstream impact graph -> deploy gates`.

Every stage emits a machine-readable artifact and rejects ambiguous transformations into legal conclusions. LLM extraction produces **candidate** atoms only. Publication to the verified legal corpus requires reviewer signoff and independent source/edition checking.

## Example: art. 30, not a flat 25% threshold

- Atom: obligation to procure from SMP/SONKO at least 25% of **adjusted** SGOZ.
- Denominator: SGOZ calculated with part 1.1 exclusions; numerator: eligible procurements including qualifying subcontracts under part 5 and relevant special cases.
- Facts: customer, financial year, actual contract values and statuses, exclusion categories, participant type, subcontracting shares, exception applicability.
- Output when only planning totals are present: `insufficient_data`, not `breached` or `satisfied`.
- Evidence: art. 30 parts 1, 1.1, 1.2, 4–6, in 2026-10-19 PDF edition.

## Example: art. 37 anti-dumping

- Requires actual tender method, NMCK or initial unit price sum, winning offer, reduction fraction, advance, security requirement, participant good-faith documents and exemptions.
- Decision tree distinguishes NMCK > 15m RUB from <= 15m RUB and reduction >= 25%, with separate security/experience options.
- A percentage computed from unrelated plan and contract fields is not legally comparable.
- Evidence: art. 37 parts 1–3, 9, 12–13.

## Repository integration plan

- `packages/shared`: legal DTOs, source IDs, units, metric basis, serialization and compatibility adapters; do not make shared the place where domain logic proliferates.
- `packages/core`: one pure evaluator with typed inputs, explainable decision tables, no DB/network calls.
- `packages/server`: legal-edition resolver, signed frozen releases, snapshot persistence, evidence retrieval and audit trail.
- `packages/report-engine`: consumes persisted `RuleAssessment`; never implements a second Python legal rule.
- `packages/web`: renders explanation and uncertainty from the same assessment, no hard-coded threshold.
- Historical `threshold-registry.ts` becomes a compatibility facade over the canonical legal-quantity registry; internal competition heuristics remain separate.
- Any release includes impact report for analytics, signals, recommendations, reports, API, cached snapshots and UI.

## Acceptance gates

- Source integrity and span anchors; no invented effective dates.
- Every executable rule resolves all referenced external acts or fails closed.
- Exact unit, scope, denominator, grain, comparison operator and temporal edition.
- Tests at threshold boundaries, absent facts, conflicting evidence, exceptions, historical editions and unverified subordinate acts.
- Legacy snapshot replay without changed historical results; controlled v1/v2 migration.
- Consumer parity across API, analytics, Word and UI.
- Human legal review and explicit release_id; **no automatic claim of legal completeness**.

## Known work not yet done

This document is a design contract, **not** proof of full 211-page atomization, dependent-NPA verification, a migrated evaluator, green CI, a merged PR or production deployment. The current threshold/evidence refactor is partial and must be validated and reconciled with the whole-product contract before merge.
