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

## 2026-10-21: reviewed customer-name migration

The saved 20 October release reproduces 2,388 included rows without UIDs. The
large discontinuity starts at observation 118 (11 October), after the documented
R→E customer-directory migration. Shared's `SUBORDINATE_REGISTRY` already records
the approved old/current spellings; the report identity ledger did not use it.

New rules package those same reviewed aliases, with a parity test against shared.
Only customer spelling is projected for matching; raw rows, legacy fingerprints,
old observation results and issued documents remain unchanged. The evidence scope
is current state plus sealed weekly Thursday-evening cuts, as confirmed by the
owner on 21 October. Intermediate daily readings (including 6 October) are not
required archives; their absent metadata is not a defect. The retained cuts
must agree on source, department, reviewed customer, full subject, activity, year,
program/subprogram and non-empty business number. The complete compound key must
be unique in each retained cut. Distinct business numbers may distinguish repeated
subjects; a number alone, price, fuzzy name, missing retained weekly evidence or changed context
cannot establish continuity. Missing legacy entity fingerprints remain unresolved.
A unique complete current compound key may establish a new current identity
when historical continuity cannot be proved. An empty A-label is acceptable when
the complete current entity itself is unique. This is explicitly labelled
`CURRENT_IDENTITY_ESTABLISHED`, with `historical_uid_recovered=false`; it does not
confirm old recommendation links. The new matching path is explicitly enabled
for new raw-pipeline snapshots.

Assurance v3 preserves repeated-A groups and every address as observations rather
than assigning a generator defect from a non-unique label alone. Actual missing
UIDs remain separate engine work. Published assurance v1/v2 is replayed with its
original rules and is never rewritten to make counts smaller.


Measured on the saved 20 October release
`REL-fa210259823dafab603bc5e6da0444c43d71cce1b81fa9bf3618e4eaeaac0673`
(source model SHA256 `0d87001a30f874d2dee3d80d81b7fe07ab2a19b655de8fdba497461f15514d05`),
using only its current observation and verified WEEKLY-2026-10-01/08/15 inputs:
2,335 of the 2,388 included rows recover their previous identity; 53 establish
current identity without claiming historical continuity. No included row remains
without a current UID, and all 702 previously assigned UIDs are preserved.
The 14 repeated-A groups retain all 28 locations as neutral observations.
No missing intermediate archive is required; weekly/current metadata recovery
reports zero missing donors. These are isolated identity/assurance measurements,
not acceptance of recommendation execution or a production installation.
The full publication validator passed an earlier candidate before the final weekly
scope/current-identity changes; that result is not a release gate for this final
candidate. Production tables, identity state and issued Word files were untouched.


## 2026-10-21: department labels and working forecast-rate context

Owner confirms current labels УФ and УДТХиБ. Keep persisted department/source
keys stable; resolve both old/current names and use registry labels for display.
Source scope lookup uses identity keys, never mutable display labels.

Live source read, confirmed by the owner, locates the forecast at R30:U32,
shares at A30:E32 and its EA plan-minus-fact base at K1:O2. The previous
claim that the tier was deleted was stale and is superseded. Restore these
readers with legacy layout compatibility. Forecast = the same table base ×
selected rate / 100, per budget and total; never substitute a different pending
plan definition. This is a scenario, not NMCK or AD-approved saving.
The live rate uses money-weighted awarded procedures with an auction date in the
12 calendar months ending at the monitoring source's Kamchatka as-of day. Return
window, dates, count and monetary denominator. Do not mix the current live rate
into an archived report; missing rate/partial source is explicit, never a hidden
8% substitution. Read failures can be retried and stale requests cannot overwrite
an invalidated source. Existing switches and page geometry remain.

## Owner correction: fresh baseline and no periodic source polling

The owner explicitly authorizes resetting all application archives and history
and starting from current Google data. This supersedes retaining old weekly
archives in the active service. Keep Google data, source credentials and explicit
mapping/yearlong-kind decisions. Historical continuity cannot be claimed across
this reset. A private technical rollback tree is kept outside the active volume.

Keep Google Drive webhook and the browser notification stream. Disable both
periodic source refresh and periodic report capture in production. Worker interval
zero waits for accepted durable commands without reading Google or scanning old
archives. Local command checks are not source reads. Fresh reset is an explicit
offline maintenance operation under the shared lock after all writers stop;
`reset-current-state.py` prepares a new database first and restores moved entries
if cutover fails. It never writes to Google. Install and reset acceptance must be
recorded from actual production, not inferred from these tests.
