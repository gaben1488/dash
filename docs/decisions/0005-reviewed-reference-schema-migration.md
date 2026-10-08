# Reviewed reference header migrations

Status: accepted for implementation, 2026-09-30.

A caption change in a registered formula dependency can block an otherwise
unchanged data layout. It must be reviewed, not silently accepted or edited in
the live source by the report process.

An optional private migration package supplies the old and new header matrices,
their hashes, the exact existing source identity and geometry, and a review reason.
The installer validates those proofs and reads the live headers under a revision
barrier. Only a registered formula dependency is eligible. Master and procedure
contracts, source identities, dimensions, units and historical ledger are unchanged.
Unrecognized schemas and source drift still block publication.

The previous registry and reviewed migration remain in private immutable history.
The registry change is atomic and idempotent. Its new digest participates in the
snapshot identity; existing releases keep their original contract and data.

A nonblocking local lock excludes concurrent migration processes. Digest checks
reject registry edits observed during acquisition instead of overwriting them.
History is keyed by both the previous registry and package hashes, so applying
the same package to a different reviewed base preserves both records. External
registry writers must coordinate with this lock to eliminate the final narrow
check-to-replace window; deployment stops the report worker before migration.

## Reviewed canonical monitoring update, 2026-10-06

The live canonical workbook changed after the last sealed report: the operational
queue now has active A:J rows and closed data checks in N:W; the filtered view
was renamed; one archive caption changed; five legacy support/control sheets
were removed. The eight primary plan books and primary procedure registry retain
their complete header hashes. A separate explicit deployment migration accepts
only the observed old/new hashes, existing physical identities and geometry.
It preserves the historical ledger and all previous releases, and records the
previous registry plus the review in immutable private history under the existing
migration lock. Missing required or unreviewed sources still block.

The Today value in analytics B1 and the filtered view's selection B1 and summary
values B2/D2/F2/H2/J2 are data, not column captions. Only these explicitly reviewed
header cells may vary; every static caption remains checked. Primary master
headers cannot opt out. Full frozen values, formulas and arithmetic remain
captured and audited, including those variable cells. New formula references to
retired sheets still fail dependency closure and prevent publication.

Queue checks retain their original physical cells and column offset. The current
source formula leaves publication/repair deadlines unset; application dates do
not become invented publication deadlines. Closed checks have no deadline field.
Legacy frozen queue formats remain supported with their original semantics.

## Reapplying a private migration after a reviewed successor, 2026-10-08

Deployment may be retried after the canonical migration has already changed a
reference source's fingerprint or width. An old private patch must not roll that
source back or reject its known successor. Skip it only when the exact private
patch is recorded, the exact current canonical review is recorded, its hashed
backup proves the installed private result, and the current source equals that
backup plus the explicitly reviewed canonical transition. Unknown edits, missing
history, identity/unit changes and broken backup proofs retain the existing
failure behavior. Live capture and publication gates remain mandatory.

## Reviewed queue task caption, 2026-10-08

The live queue changed only static O2 from `Уровень` to `Тип задачи`.
Native reads compared all 24 columns and both header rows; A1/O1 summary
formulas changed their wording to actions and remain the same two volatile
data cells. Column P still identifies the procedure; N remains the divider.
The reviewed transition retains sheet ID 2526400, width 24, two header rows,
roles and units. Its new masked raw/semantic hashes are
`d5a8ca1c915713c86af01eb3e712b88788e65a66bad5988b699bc5347663a4fb` and
`cd0140b397950845c3aea61c243ef26fc12d037c7dc0fa315a43b779eb266d61`.
The previous exact 24-column hashes remain an accepted migration predecessor.
Other static-label changes still fail; retries after this transition are no-ops.
The exact original v3 review remains available for recognition of its immutable
history. Private predecessor proof uses the matched recorded review, rather than
substituting today's review. Only the two explicit complete review definitions
are eligible; backup hashes, source identity and installed contracts still match.
