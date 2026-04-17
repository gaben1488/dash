/**
 * Bootstrap the KBTooltip registry with the canonical METRIC_KB from @aemr/core.
 *
 * Called once at app init (see main.tsx) before ReactDOM.createRoot().
 * After this, any <KBTooltip metric="<key>" /> can resolve its 10-block content
 * from the single source of truth (packages/core/src/metrics/registry.ts).
 */
import { METRIC_KB } from '@aemr/core';
import { setKBRegistry } from '@/components/ui/kb-tooltip';

export function bootstrapKBRegistry() {
  setKBRegistry(METRIC_KB as any);
}
