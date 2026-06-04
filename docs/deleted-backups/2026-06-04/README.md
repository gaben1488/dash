# Deleted File Backup 2026-06-04

This directory preserves files that were deleted during an earlier Codex pass and then restored or merged back.

Evidence:
- Transcript directory: `C:\Users\filat\.codex\sessions\2026\06\04`
- Transcript file: `rollout-2026-06-04T02-44-47-019e8df1-b2e1-71f1-9334-56b47ecb67ad.jsonl`
- Relevant transcript line found locally: an `apply_patch` deleted `dash/Dockerfile`, `dash/docker-compose.yml`, and `dash/docs/mulch-cognitive-operations.md`.

Backups:
- `mulch-cognitive-operations.before-deletion.md` is the tracked `HEAD` version before deletion.
- `Dockerfile.before-restore` is the tracked `HEAD` Dockerfile that was restored.
- `docker-compose.before-restore.yml` is the tracked `HEAD` Compose file that was restored.

Current merge decision:
- Root `Dockerfile` and `docker-compose.yml` were restored as-is from the tracked version.
- Tracked TypeScript build info files under `packages/*/tsconfig.tsbuildinfo` were restored as-is from `HEAD`; they are not copied here because they are generated cache artifacts, not source documentation.
- `docs/mulch-cognitive-operations.md` was restored as a merged working document: it keeps the original cognee-inspired operating model and adds a 2026-06-04 safety/restoration note.
- This backup directory is intentionally separate from metric, source, SHDYU, and UI work so it can be packaged independently.
