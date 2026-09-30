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
