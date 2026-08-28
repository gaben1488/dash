# Code And Security Review

Review date: 2026-06-14.

## Scope Reviewed

- Workspace structure and package boundaries.
- Shared constants and 44-ФЗ thresholds.
- Core pipeline, analytics, reconciliation and trust tests.
- Server app bootstrap, route registration, auth middleware, health/debug exposure.
- Web lint-gate defects around hooks, unused code, dynamic deletes and dead handlers.
- Dependency tree at moderate audit severity.
- Production docker compose and env examples.
- Public documentation.

## Material Fixes Made

- Split Fastify app creation from server startup for testability.
- Added production auth fail-closed behavior for missing `AEMR_API_KEY`.
- Kept `/api/health` public but removed sensitive runtime leakage.
- Made `/api/debug/sheets` development-only.
- Added server security tests for auth and debug-route behavior.
- Updated vulnerable/outdated dependencies and pnpm overrides.
- Corrected 44-ФЗ p.4 ch.1 st.93 thresholds to the shared canonical constants.
- Removed stale `formulaContinuity` rule-book block after the code path was already removed.
- Removed tracked `*.tsbuildinfo` build artifacts.
- Fixed ESLint error-gate across `packages/**/*.{ts,tsx}`.
- Fixed a production SQLite path mismatch in `deploy/.env.production.example`.
- Removed stale root Docker files and non-product memory documentation.
- Updated GitHub CI to run lint, typecheck, tests, build and dependency audit.

## Verification Results

```text
pnpm lint                         passed, 0 errors, 274 warnings remain for any/hook-deps
pnpm typecheck                    passed
pnpm -r test                      passed: shared 72, core 720, server 18, web 25
pnpm build                        passed
pnpm audit --audit-level moderate passed; one Deno-only GHSA is ignored as documented below
git diff --check                  passed, line-ending warnings only
```

## Residual Risks

- `@typescript-eslint/no-explicit-any` is warning-only. There are many remaining `any` sites, especially in web data shaping and server route payloads.
- Web bundle is large; Vite reports the main minified chunk at about 1.365 MB.
- Auth is one shared API key stored in browser localStorage; this is acceptable only for internal MLP use.
- No rate limiting or per-user authorization exists yet.
- Biome remains advisory; ESLint is the primary gate.
- `xlsx` (SheetJS, dev-only dependency of `@aemr/server` used by the weekly
  backfill script) is pinned to the vendor CDN tarball
  `https://cdn.sheetjs.com/xlsx-0.20.2/xlsx-0.20.2.tgz` (2026-07-24). Reason:
  the last npm release is 0.18.5 and carries two HIGH advisories
  (prototype pollution GHSA-4r6h-8v6p-xvw6, ReDoS GHSA-5pgg-2g8v-p4x9); SheetJS
  publishes patched builds only on its own CDN. The 0.20.x API is compatible
  with the script's usage (`read`, `utils.sheet_to_json`). Re-pin by bumping the
  URL when upgrading.
- `pnpm audit --audit-level moderate` as of 2026-07-24 still reports advisories
  unrelated to `xlsx`: transitive `fast-uri`/`find-my-way` under `fastify`, and
  `brace-expansion`/`shell-quote` in dev tool chains. They predate the xlsx
  re-pin and are tracked as residual until the next dependency update pass.
- **Re-measured 2026-08-22** (`pnpm audit --audit-level moderate`, run in this
  repo): **16 vulnerabilities — 1 low, 2 moderate, 13 high**. The 2026-07-24 list
  above is incomplete. Two advisories it does not name:
  - `@fastify/static` — Authorization Bypass via Non-Canonical URL Paths
    (GHSA-8pvw-jcv7-9cmj), vulnerable `<=10.1.1`, patched `>=10.1.2`, path
    `packages__server>@fastify/static`. Installed version is 9.1.3, so the fix
    requires a major upgrade. Static serving turns on whenever a `public/`
    directory sits next to the server, while the auth hook guards only `/api/`
    paths — so static is open by construction and a path-traversal escape from
    `public/` could reach a deployment file such as `.env.production`. This is
    the highest-impact item in the current list, not a transitive detail.
  - `postcss` — incomplete fix of GHSA-6g55-p6wh-862q (GHSA-fxqj-rqcc-2cmp),
    vulnerable `<=8.5.22`, patched `>=8.5.23`, path `packages__web>postcss`.
  - `fast-uri` is held at the old version by the root pin `"fast-uri": "^3.1.2"`
    (`package.json:54`); `nanoid` is not exploitable here because the project
    calls it without a size argument.

  Source of the per-advisory triage: `docs/superpowers/audits/2026-08-22-harvest/средние.md`,
  note Н (record #95). Counts above were re-verified independently on 2026-08-22.
- `GHSA-gv7w-rqvm-qjhr` is ignored in `pnpm.auditConfig`: it affects esbuild's
  Deno binary download path via attacker-controlled `NPM_CONFIG_REGISTRY`, while
  AEMR builds and runs on Node 22. Forcing patched `esbuild@0.28.1` breaks the
  current Vite 6 production transform. Remove the exception when upgrading the
  Vite/tsx toolchain to versions compatible with esbuild 0.28.1 or newer.

## Recommended Next Hardening Pass

1. Replace high-traffic `any` surfaces with shared DTOs for dashboard, issues, rows and analytics.
2. Add route-level web code splitting.
3. Add a real login/session flow and remove localStorage API key bootstrap.
4. Add API rate limiting and security headers at Caddy/Fastify level.
