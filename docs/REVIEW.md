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
