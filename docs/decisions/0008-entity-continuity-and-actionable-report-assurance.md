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
