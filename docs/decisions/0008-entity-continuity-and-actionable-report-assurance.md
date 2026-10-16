# ADR-008: entity continuity, historical evidence and actionable assurance

Status: candidate, requires frozen-production and live acceptance.

The canonical row fingerprint remains immutable for replay. A price or planned-date
change must not, by itself, lose a previously observed procurement identity. New
imports may reuse a UID only when a non-empty business number, complete entity key
(source, department, customer, subject, activity, known plan year, program) and
unique occurrence in both snapshots agree. Price, method, planned day, fact and
comments are state, not identity. A missing amount is separately a quality issue.
The entity key is a nullable SQLite migration column. Legacy columns and frozen
results are not rewritten. Backfill requires the sealed original normalized rows.
A duplicated entity, changed subject/customer/year, or simultaneous renumbering
and state change remains unresolved; identical price is not an identity proof.

Historical reference matching uses the exact full subject explicitly associated
with the position number in the verified original, department and source period,
and a current UID established by the observation ledger. Current price no longer
has to equal the historical price. This is not fuzzy matching, and it does not
establish fulfillment. A missing/ambiguous full reference remains engine work.

For null UIDs left by the old matcher, recovery requires a gap-free sequence of
unique same-anchor observations with the same complete entity signature and
business number, ending in an already proved UID. Entity signatures of legacy
observations are recovered only from sealed source bundles whose row fingerprints
and saved UIDs match the identity database. Old observation UIDs/results are not
rewritten. A missing source version, renumbering, stable-key change, ambiguity or
unverified donor prevents automatic recovery.

Warnings are structured decisions, not a hidden instruction to finish the engine.
Each exposes a cause, affected row/field, report impact, owner, exact action and
resolution condition. Engine defects and unsupported wording are engine work,
not blanket requests that the user "confirm the link". Fact-bearing statements
remain attributed to the source and cannot create a completion date.

## 2026-10-12 — mutable plan-calendar continuity clarification

This clarification supersedes the earlier known-plan-year identity condition for
new adjacent observations; the original persisted fingerprints remain legacy evidence.
The owner's current register rule makes planned date, month, quarter and year
mutable views of one position, not procurement identity. For new observations
with `allow_plan_updates=True`, the existing ledger may therefore retain a UID
across a date/year change and physical-row move only with the same non-empty exact
business number and permanent source file ID, unique in both adjacent snapshots,
and the same complete customer, subject, activity, program and subprogram. A
reused number with changed meaning, duplicate number, missing observation or
missing legacy entity proof remains unresolved/new; a number alone is no proof.

The implementation compares the existing complete legacy entity fingerprint by
substituting its prior anchor year into the current otherwise identical entity.
It does not remove year from saved signatures, change snapshot digests, rewrite
results or migrate historical UIDs. Exact composite numbers remain distinct.
A missing row remains an observation of absence, not confirmed deletion.

Calendar acquisition is a separate compatibility step: current N should supply
year/quarter/month, while stale O/P are diagnostic formula metadata. The adapter
still uses legacy O/P in this bounded change because sealed replay, backfill and
section_audit reproduce those historical fingerprints and 159 ledger chains.
Changing that default requires a declared existing source/reader compatibility
boundary across raw_pipeline, section_audit and calendar consumers. That part is
not implemented or accepted live by this identity-continuity correction.

## 2026-10-16 — textual addresses in plan provenance (implementation in progress)

The A-column label is a source address within its book, not a permanent entity ID.
`173`, `173/1` and `173/18` must remain distinct throughout issue transport,
journal matching, API routes and the row panel. Physical sheet row is separate.
Existing issue IDs, raw observations and historical hashes do not change.

One shared boundary reader preserves textual labels, including leading zeroes,
and accepts the historical integral Google forms (`94`, `94.0`, `94,0`). The
current provenance key is a string. Legacy numeric caller inputs are adapted
once when building provenance; calculations do not gain parallel version paths.
Composite labels are URL-encoded as a single route segment. A duplicate exact
label remains ambiguous; absent journal row keys are not reconstructed from cell
coordinates, subject similarity or amount.

Acceptance requires distinct-label journal/API/UI tests, physical-row movement,
duplicate-label ambiguity and issue-schema round-trip. No new fields are written
to source books. This clarification is not evidence of live acceptance.

## 2026-10-16 — plan-history witnesses and financial transitions

The existing plan-provenance reader must retain the changed sheet, author,
both known-value flags and all original `_ChangeLog` row addresses. A source
address is bound to the immutable source book ID and the particular reading;
it locates evidence, not a permanent event/entity ID across sorted or compacted
logs. The source array index is recorded before headers/blank rows are skipped.
The reading clock is the read-window start, not an edit time or a source revision.
Raw source payloads, historical identities and source columns are not rewritten.

Exact semantic repeats may share one displayed event only while retaining every
source address. Replaying the same book/log-row/reading fact does not add a
witness; distinct source rows and readings remain. Different authors, known-value states, changed sheets and physical
cells remain distinct witnesses. Counts of source witnesses and confirmed
financial transitions are separate. Multiple conflicting observations for one
cell at the same recorded moment cannot acquire a fabricated ordering or be
summed as independently proved transitions. Their evidence remains visible and
the financial summary explicitly reports incompleteness, including row, book and
cross-book consumers. It must never turn that condition into “no plan reduction”.
Unambiguous history continues to use the existing classification and arithmetic;
agreed source values remain visible even when event multiplicity is uncertain.
In particular, merging identical author/value/time observations for display is
not proof of one financial transition when they occupy different original log
rows. Those groups (and unaddressed legacy repeats) remain financially incomplete.
Repeated readings of the same original log row retain their reading addresses,
but cannot manufacture additional business events. Neither row order nor a
read-window timestamp establishes stable event identity across log rearrangement.
A duplicate current A-label cannot duplicate a shared history in book totals or
lend one chosen current row's fact date to historical witnesses. Existing source
links open the original book and log row rather than the current configured book.
This diagnostic projection is not official AD-gated economy or a KPI penalty.

Tests must cover original row addresses through parser/API/UI, exact repeats,
authors/known flags/sheets/physical cells, conflicting equal-time observations,
input permutations and an independent arithmetic example. This change is a
bounded witness-preservation vertical, not acceptance of the complete journal.
