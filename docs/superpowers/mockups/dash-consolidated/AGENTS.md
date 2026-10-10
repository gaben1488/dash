# Prototype Instructions

Run the local server yourself and open the preview in the browser available to this environment. Do not give the user server-start instructions when you can run it.

Before making substantial visual changes, use the Product Design plugin's `get-context` skill when the visual source is unclear or no longer matches the current goal. When the user gives durable prototype-specific design feedback, preferences, or decisions, record them in `AGENTS.md`.

When implementing from a selected generated mock, treat that image as the source of truth for layout, component anatomy, density, spacing, color, typography, visible content, and hierarchy.

Build app UI in `src/`. Keep `.openai/hosting.json`, `worker/index.js`, `scripts/prepare-sites-build.mjs`, and `tests/sites-worker.test.mjs` intact so the same local prototype can be handed to Sites. Before a Sites handoff, run `npm run build` and `npm run test:sites`; the build must leave `dist/client/index.html`, `dist/server/index.js`, and `dist/.openai/hosting.json`.

## Owner feedback, 2026-10-10

The owner explicitly rejected the first Codex composition: a 2×2 navigation grid replaced the existing drum and degraded the established design. Preserve the repository HTML as the visual and interaction basis. `src/source-shell/navigation.html` and `original.css` carry actual source material; do not replace them with an imitation. Extend the established concept to cover requirements. The rejected screenshot is evidence of what not to repeat. No design here is implicitly approved by the owner; Pulse content remains excluded.
