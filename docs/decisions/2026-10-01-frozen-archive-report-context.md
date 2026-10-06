# Frozen weekly report materialization (candidate rc12)

## Requirement and recovered gap

The native report page and the two existing Word actions must support a selected weekly archive, plan year and quarter. `GET /api/report` reads the legacy dashboard snapshot, whereas the existing Word reader only searched already published Python releases. There was no command or native route to build a missing archived release. Those are separate functions: reading an old DOCX does not prove generation from a saved weekly input.

A read-only inventory found legacy snapshots containing department rows and the parsed summary, but not the original procedure matrices, dated recommendation ledger or acquisition/formula contract. Full Python captures and published bundles currently start on 30 September 2026. Dates in the inventory log are UTC timestamps; product cutoff dates must be derived with Asia/Kamchatka, not by taking ten characters of the UTC string.

## Decision

`proc-report run-archive` restores only the exact dated, complete frozen input bundle. It reuses the normal calculator, source audit, content planner and atomic publisher. It does not contact Google, read today's private registry or ledger, reuse the live identity database, or manufacture revision reads. It copies the identity database enclosed in the archive to a private temporary working directory. An explicit `report_scope` selects plan year and quarter independently of the original observation cutoff. That scope and the archive origin are hashed snapshot payloads.

`POST /api/report-releases/prepare` accepts only date, year and quarter. Filesystem locations are server configuration, never request input. The existing Word hook requests preparation when an archived selection has no published pair, and rejects late responses from a previously selected context. GET remains read-only. Archive attempt state and locking are separate from the live worker state. Both downloads pin one immutable release ID.

The publisher checks the original archive bytes again immediately before committing. The receipt says `FROZEN_ARCHIVE_HASHES`, preserves the original source revision information as acquisition evidence, and records the old snapshot ID, cutoff and bundle digest separately from the new publication time. It does not claim a current Google revision check. Archive replay does not enforce header progression against a different, later live release; the original archived schema and raw-source audits still apply.

No fallback to current sources or a different week is allowed for Word. When a legacy page snapshot is the only available evidence, preparation names the missing archived input sections. This is an archive restoration task, not an instruction to re-enter current data or manually compose a report. A full original bundle can be placed in the configured archive store; old incomplete dashboard JSON alone is not sufficient to reconstruct absent procedures or recommendations.

## Compatibility and limits

The deployed rc9 reports are not rewritten. New rules can generate a distinct immutable archived release. Prior source context and document-plan contracts retain their replay path. rc12 adds a versioned compact context projection: complete source context remains in the model, while business documents group identical explanations for pending current-year and next-year positions with all member provenance. This avoids bulk replication of already completed history without deleting source information.

This change does not establish full parity between the legacy live/dashboard calculator and the Python report model. The legacy page still has its own source-selection policy. Nor does it restore historical procedure matrices which were never included in the old dashboard snapshots. Original weekly files need to be recovered and admitted through the source contract before that missing history can be called a complete verified report.

## Acceptance

Tests must cover: exact date selection; independent year/quarter; no current-source access; no writes to live status/identity; no following-week substitution; old original immutability; idempotent pair reuse; duplicate request locking; source change at final barrier; interrupted-job status; missing archived sections; context changes during preparation/download; mandatory domain contracts on all new renderer patch versions; grouped explanation provenance; both native Word downloads.

Required before deployment: full Python and application CI plus read-only replay on a real saved production bundle, not just test counts. A successful archive materialization is not evidence of restored older missing inputs or closure of every remaining report-engine task.

## Archive/live isolation

An archived recomputation is indexed for exact date/year/quarter retrieval but is
excluded from the live latest release, live period-delta baseline and live header
continuity baseline. Its frozen cutoff is not the time it was recomputed.
The legacy page no longer fills a missing historical selection with live rows:
it returns an explicit missing-archive result, including for the current week.
Original dated Drive folders are a different evidence format from full snapshots;
this commit does not claim their imported records are already registered.
