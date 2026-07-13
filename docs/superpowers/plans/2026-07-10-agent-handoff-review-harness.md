# Agent Handoff Review Harness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce the highest-risk security and verification gaps found in the current AEMR codebase and give agents a repeatable harness for review, implementation, and acceptance.

**Architecture:** Keep changes scoped to existing package boundaries: server security in `packages/server`, browser API/auth behavior in `packages/web`, cross-package contracts in `packages/shared`/`packages/core`. Use existing Vitest tests and the canonical repo gate from `CLAUDE.md`.

**Tech Stack:** pnpm workspaces, TypeScript ESM, Fastify, React 19, Vite 6, Vitest, ESLint, Biome.

---

## Current Review Findings

### P1: Dev Vite server can expose the API proxy to arbitrary hosts

**Evidence:** `packages/web/vite.config.ts` sets `server.host = true` and `server.allowedHosts = true`, while `/api` is proxied to `http://localhost:3000`.

**Risk:** When a developer starts `pnpm -F @aemr/web dev` on a machine with a public tunnel or reachable LAN interface, any host accepted by Vite can reach the SPA and proxy API calls through the dev server. This is especially risky because the app uses bearer keys and the comment explicitly mentions demo tunnels.

**Fix direction:** Make unrestricted host exposure opt-in through an environment variable such as `AEMR_VITE_ALLOW_PUBLIC_HOSTS=true`; keep localhost-only defaults.

### P1: Browser API key is stored in `localStorage`

**Evidence:** `packages/web/src/api.ts` reads `localStorage.getItem('aemr_api_key')` and sends it as `Authorization: Bearer ...`; `packages/server/src/app.ts` comments treat CSP as the main mitigation for localStorage exfiltration.

**Risk:** A single XSS or unsafe inline script path can read the API key. The server CSP currently allows `'unsafe-inline'` for scripts/styles, so CSP cannot be treated as a strong token-confidentiality boundary.

**Fix direction:** Short term: isolate all token access behind one client module and document the residual risk in `docs/REVIEW.md`. Medium term: replace localStorage bearer bootstrap with an HttpOnly SameSite cookie/session flow.

### P2: `fetchJSON` can silently drop auth/content headers when callers pass `init.headers`

**Evidence:** `packages/web/src/api.ts` calls `fetch(..., { headers, ...init })`; any future `init.headers` replaces the constructed `Content-Type` and `Authorization` object.

**Risk:** Future endpoint wrappers that pass custom headers can accidentally remove the bearer token or JSON content type, producing confusing auth failures or malformed requests.

**Fix direction:** Merge headers after `init`, preserving caller-provided headers while adding defaults unless explicitly overridden.

### P2: Full verification is not runnable inside the current shell session

**Evidence:** Several PowerShell commands returned output but then timed out or hit sandbox setup / out-of-memory errors. `git diff --name-only -- . ':!node_modules'` returned empty output before completing successfully.

**Risk:** Agents need a deterministic harness that can distinguish product failures from local shell/sandbox failures.

**Fix direction:** Run targeted package tests first, then the canonical gate. If shell instability repeats, use a fresh terminal or CI runner and record exact command output.

---

## Handoff Harness

Run from repository root: `C:\Users\filat\dash`.

### Baseline commands

- `pnpm -F @aemr/server exec vitest run src/app-security.test.ts`
  - Expected: PASS. Covers auth fail-closed, CSP/security headers, protected API behavior.
- `pnpm -F @aemr/web exec vitest run src/store.test.ts src/store.subordinates.test.ts src/lib/economy-metrics.test.ts`
  - Expected: PASS. Quick web smoke on state and derived metrics.
- `pnpm -F @aemr/shared test`
  - Expected: PASS. Shared schemas/dictionaries/contract tests.
- `pnpm -F @aemr/core test`
  - Expected: PASS. Core pipeline and analytics tests.

### Canonical gate

These commands are required before claiming completion, per `CLAUDE.md`:

- `pnpm lint`
- `pnpm typecheck`
- `pnpm -r test`
- `pnpm build`
- `pnpm audit --audit-level moderate`

If the local PowerShell session fails with sandbox setup refresh, timeout after useful output, or out-of-memory, rerun in a fresh shell or CI and attach the exact failure mode to the final report.

### Browser/manual smoke

Only after the relevant package tests pass:

- Start API: `pnpm -F @aemr/server dev`
- Start web: `pnpm -F @aemr/web dev`
- Open `http://localhost:5173`
- Verify `/api/health` succeeds without a key.
- With `AEMR_API_KEY` set on the server, verify a protected endpoint returns 401 without `localStorage.aemr_api_key`.
- Set `localStorage.aemr_api_key` to the test key and verify the protected endpoint succeeds.

---

## Agent Work Queue

### Task 1: Lock Down Vite Public Host Exposure

**Files:**
- Modify: `packages/web/vite.config.ts`
- Test: `packages/web/vite.config.test.ts`

- [ ] **Step 1: Add a failing config test**

Create `packages/web/vite.config.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';

async function loadConfigWithEnv(value: string | undefined) {
  vi.resetModules();
  if (value === undefined) {
    delete process.env.AEMR_VITE_ALLOW_PUBLIC_HOSTS;
  } else {
    process.env.AEMR_VITE_ALLOW_PUBLIC_HOSTS = value;
  }
  const mod = await import('./vite.config');
  return mod.default;
}

describe('vite dev server host policy', () => {
  it('does not allow arbitrary hosts by default', async () => {
    const config = await loadConfigWithEnv(undefined);
    expect(config.server?.host).toBe('localhost');
    expect(config.server?.allowedHosts).toBeUndefined();
  });

  it('allows public hosts only when explicitly requested', async () => {
    const config = await loadConfigWithEnv('true');
    expect(config.server?.host).toBe(true);
    expect(config.server?.allowedHosts).toBe(true);
  });
});
```

- [ ] **Step 2: Run the failing test**

Run: `pnpm -F @aemr/web exec vitest run vite.config.test.ts`

Expected: FAIL because current `vite.config.ts` always sets `host: true` and `allowedHosts: true`.

- [ ] **Step 3: Implement the config gate**

Modify `packages/web/vite.config.ts`:

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

const allowPublicHosts = process.env.AEMR_VITE_ALLOW_PUBLIC_HOSTS === 'true';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
      '@aemr/shared': resolve(__dirname, '../shared/src/index.ts'),
      '@aemr/core': resolve(__dirname, '../core/src/index.ts'),
    },
  },
  server: {
    port: 5173,
    host: allowPublicHosts ? true : 'localhost',
    allowedHosts: allowPublicHosts ? true : undefined,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
```

- [ ] **Step 4: Verify**

Run:

```bash
pnpm -F @aemr/web exec vitest run vite.config.test.ts
pnpm -F @aemr/web build
```

Expected: both PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/web/vite.config.ts packages/web/vite.config.test.ts
git commit -m "fix(web): gate public vite hosts"
```

### Task 2: Make API Header Merging Explicit

**Files:**
- Modify: `packages/web/src/api.ts`
- Test: `packages/web/src/api.test.ts`

- [ ] **Step 1: Add a failing API header test**

Create `packages/web/src/api.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';

describe('api client headers', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('preserves auth and content type when request options include headers', async () => {
    localStorage.setItem('aemr_api_key', 'secret');
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true }),
    } as Response);

    const { api } = await import('./api');
    await api.updateIssueStatus('issue-1', 'resolved', 'done');

    expect(fetchMock).toHaveBeenCalledWith('/api/issues/issue-1/status', expect.objectContaining({
      method: 'PUT',
      headers: expect.objectContaining({
        Authorization: 'Bearer secret',
        'Content-Type': 'application/json',
      }),
    }));
  });
});
```

- [ ] **Step 2: Run the test**

Run: `pnpm -F @aemr/web exec vitest run src/api.test.ts`

Expected: PASS on current callers. If it passes immediately, extend the test by importing a test-only wrapper or refactor `fetchJSON` to export `__private__fetchJSON` for direct coverage of `init.headers`.

- [ ] **Step 3: Refactor `fetchJSON` safely**

Modify the request construction in `packages/web/src/api.ts`:

```ts
async function fetchJSON<T>(url: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);

  if (init?.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const apiKey = typeof localStorage !== 'undefined' ? localStorage.getItem('aemr_api_key') : null;
  if (apiKey && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${apiKey}`);
  }

  const res = await fetch(`${API_BASE}${url}`, {
    ...init,
    headers,
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`API error ${res.status}: ${body}`);
  }
  return res.json() as Promise<T>;
}
```

- [ ] **Step 4: Verify**

Run:

```bash
pnpm -F @aemr/web exec vitest run src/api.test.ts
pnpm -F @aemr/web test
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/api.ts packages/web/src/api.test.ts
git commit -m "fix(web): merge api request headers"
```

### Task 3: Document Auth Residual Risk and Migration Path

**Files:**
- Modify: `docs/REVIEW.md`
- Modify: `CLAUDE.md` if the canonical verification set changes
- Optional Test: `packages/server/src/app-security.test.ts`

- [ ] **Step 1: Inspect current review document**

Run: `Get-Content -Path docs\REVIEW.md | Select-Object -First 220`

Expected: existing security posture and verification notes are visible.

- [ ] **Step 2: Add a factual residual-risk section**

Add this text to `docs/REVIEW.md` under the security/auth section:

```md
### Residual risk: browser API key bootstrap

The current SPA reads `aemr_api_key` from `localStorage` and sends it as a bearer token to `/api/*`.
This is acceptable only as a temporary bootstrap for controlled deployments.
It is not a strong browser secret boundary: any XSS in the SPA origin can read localStorage.

Current mitigations:
- production requires `AEMR_API_KEY`;
- `/api/health` is public, other `/api/*` routes require `Authorization: Bearer <key>`;
- server CSP restricts `connect-src` to `'self'`.

Required migration:
- replace localStorage bearer bootstrap with a login/session flow;
- store session credentials in HttpOnly, Secure, SameSite cookies;
- keep `/api/health` public and require auth for all other `/api/*` routes.
```

- [ ] **Step 3: Verify docs are factual**

Run: `rg "localStorage|AEMR_API_KEY|Authorization|health" docs/REVIEW.md CLAUDE.md packages/server/src packages/web/src`

Expected: docs match implemented behavior; no claim says cookie login is already implemented.

- [ ] **Step 4: Commit**

```bash
git add docs/REVIEW.md
git commit -m "docs: record auth bootstrap risk"
```

### Task 4: Final Review Harness Run

**Files:**
- No code changes unless tests reveal a regression.

- [ ] **Step 1: Run targeted tests**

```bash
pnpm -F @aemr/server exec vitest run src/app-security.test.ts
pnpm -F @aemr/web exec vitest run vite.config.test.ts src/api.test.ts
pnpm -F @aemr/shared test
pnpm -F @aemr/core test
```

Expected: PASS.

- [ ] **Step 2: Run canonical gate**

```bash
pnpm lint
pnpm typecheck
pnpm -r test
pnpm build
pnpm audit --audit-level moderate
```

Expected: PASS or a documented pre-existing failure with exact command output.

- [ ] **Step 3: Produce final handoff note**

Include:

```md
## Verification

- pnpm -F @aemr/server exec vitest run src/app-security.test.ts: PASS
- pnpm -F @aemr/web exec vitest run vite.config.test.ts src/api.test.ts: PASS
- pnpm -F @aemr/shared test: PASS
- pnpm -F @aemr/core test: PASS
- pnpm lint: PASS
- pnpm typecheck: PASS
- pnpm -r test: PASS
- pnpm build: PASS
- pnpm audit --audit-level moderate: PASS

## Residual Risk

- Browser auth still uses localStorage until the dedicated session migration is implemented.
- Public Vite host exposure is now opt-in via `AEMR_VITE_ALLOW_PUBLIC_HOSTS=true`.
```

---

## Suggested Agent Assignment

- Agent A: Task 1, because it is isolated to Vite config and one test.
- Agent B: Task 2, because it is isolated to the web API client and one test.
- Agent C: Task 3, because it is documentation and factual consistency only.
- Coordinator: Task 4, because final verification should happen after all branches/tasks are integrated.

Do not run broad refactors, generated-output updates, or unrelated `any` cleanup as part of this handoff. Those are separate backlog items already acknowledged in `CLAUDE.md`.
