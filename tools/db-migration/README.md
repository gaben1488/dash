# Dash G1 — read-only crosswalk of procurement row observations

This is an isolated **audit tool**, not a migration, automatic UUID allocator,
synchronization engine, or replacement for Dash's production source adapters.
It makes ambiguity visible before a real database migration.

## Run

From the repository root:

    node --test tools/db-migration/tests/identity-crosswalk.test.mjs
    node tools/db-migration/compare-snapshots.mjs /secure/old.json /secure/new.json /secure/decisions.json /secure/report.json

The last two arguments are optional: an omitted decisions file means zero
approved identity links. Without the report path the CLI prints **aggregated
counts only**, not observation locators. With a report path, the full JSON
is written to a new file with permissions 0600; it never overwrites an
existing file. Exit 0 means fully linked; 1 means review/conflicts; 2 means
invalid input. **Never commit input files or live reports** to the public
repository.

Input observations in each JSON file are an array; example with invented
values:

    [
      {
        "snapshotId": "snapshot-2026-10-09", "sourceFileId": "SYNTHETIC-FILE",
        "sheetId": 42, "sourceRow": 174, "rowClass": "data",
        "displayNumber": "23/1", "organizationId": "ORG-1",
        "subject": "Test purchase", "entityId": null,
        "payloadHash": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
      }
    ]

Required **full-row SHA-256** should be computed by a trusted, documented
capture stage over canonical typed raw, formulas, formatted values and notes.
Do not mistake the example hash for verified provenance. Source observations
must already be classified by the actual production rules. In particular,
the tool must not infer class or year from empty cells. The companion CLI
does NOT fetch Google data, connect to SQLite, or create hashes.

Approved decisions are an array of
`{from,to,fromHash,toHash,entityId}` objects. `from` and `to` are the
JSON-encoded observation locators returned by `observationKey(row)`.
A decision MUST be approved and authenticated by the host workflow; the
tool only checks reference validity and exact frozen payload hashes, not
the human's identity or authority. No decisions means no natural-key
auto-matching.

## Deliberate semantics

- A known immutable, externally managed `entityId` present once in each
  snapshot is matched. Duplicate IDs or contradictory human decisions block.
- A stable **displayed** number A plus workbook/sheet is a *candidate only*,
  even with the same organization ID and subject. It **never** allocates or
  carries an ID automatically. `173`, `173/1` and `173/18` differ; a
  Google DATE serial like 46045 must not replace visible A=`23/1`.
- A natural-key collision on either side stops automated pairing. Empty A
  never creates a candidate. Different workbooks never match by A alone.
- `sourceRow` appears only in an observation locator. Inserting rows does
  not create an identity change; nor does it prove two purchases are the same.
- All unmatched items remain **unresolved** even when a review candidate is
  proposed. A pending or dismissed question is not a verified identity.
- This module intentionally handles only 1:1 continuations. A split,
  consolidation, ownership change or replacement needs a separate signed
  decision with a relationship type; none can be inferred by amount or text.

## Stage and limitations

The G0 gate is not passed: a coherent typed A:AH full snapshot from all eight
books and the procedures book and a restored backup of production SQLite are
still missing. The earlier limited A:G/P read is **not** adequate input.
This tool safely exercises G1 rules on synthetic fixtures only. A production
adapter, real crosswalk and live comparison are separate acceptance gates.

References: PR #70 document
`docs/superpowers/audits/2026-10-10-dash-foundation/DB-MIGRATION-READINESS.md`
and integrated remediation PR #79.
