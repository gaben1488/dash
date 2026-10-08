import { emptySlices, type SliceState, type SortDir, type SortKey } from './slices';
export const WORKSPACE_KEY = 'monitoring:workspace:v1';
export interface WorkspaceState { modeId: string; slices: SliceState; sortKey: SortKey; sortDir: SortDir }
export function encodeWorkspace(state: WorkspaceState): string { return JSON.stringify({ version: 1, ...state }); }
export function decodeWorkspace(raw: string | null): WorkspaceState | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object') return null;
    const v = value as Record<string, unknown>;
    if (v.version !== 1 || !['work', 'all', 'svod', 'journal', 'directory', 'ancestors'].includes(String(v.modeId))) return null;
    if (!['row', 'code', 'customer', 'nmck', 'publicationDate', 'auctionDate', 'auctionPrice', 'savingsTotal', 'reductionPct'].includes(String(v.sortKey)) || !['asc', 'desc'].includes(String(v.sortDir))) return null;
    if (!v.slices || typeof v.slices !== 'object' || Array.isArray(v.slices)) return null;
    const input = v.slices as Record<string, unknown>;
    const slices = emptySlices();
    for (const key of ['dept', 'stage', 'method', 'customer', 'winnerInn', 'nmckBucket', 'reductionBucket'] as const) {
      const field = input[key]; if (field !== undefined && field !== null && typeof field !== 'string') return null;
      slices[key] = typeof field === 'string' ? field : null;
    }
    for (const key of ['periodYear', 'periodQuarter', 'periodMonth', 'procedureYear'] as const) {
      const field = input[key]; if (field !== undefined && field !== null && (typeof field !== 'number' || !Number.isInteger(field))) return null;
      slices[key] = typeof field === 'number' ? field : null;
    }
    if (slices.periodQuarter !== null && (slices.periodQuarter < 1 || slices.periodQuarter > 4)) return null;
    if (slices.periodMonth !== null && (slices.periodMonth < 1 || slices.periodMonth > 12)) return null;
    if (input.periodBasis !== 'publication' && input.periodBasis !== 'auction') return null;
    if (typeof input.query !== 'string' || typeof input.defectsOnly !== 'boolean') return null;
    slices.periodBasis = input.periodBasis; slices.query = input.query; slices.defectsOnly = input.defectsOnly;
    if (input.view !== undefined) {
      if (!['all', 'withoutContract', 'joint', 'successful'].includes(String(input.view))) return null;
      slices.view = input.view as SliceState['view'];
    }
    if (input.moneyCategory !== undefined && input.moneyCategory !== null) {
      if (!['realized', 'work', 'unrealized', 'reissued', 'unknown'].includes(String(input.moneyCategory))) return null;
      slices.moneyCategory = input.moneyCategory as SliceState['moneyCategory'];
    }
    return { modeId: String(v.modeId), slices, sortKey: v.sortKey as SortKey, sortDir: v.sortDir as SortDir };
  } catch { return null; }
}
export function readWorkspace(): WorkspaceState | null {
  try { return decodeWorkspace(new URL(window.location.href).searchParams.get('monitoring')) ?? decodeWorkspace(localStorage.getItem(WORKSPACE_KEY)); } catch { return null; }
}
export function saveWorkspace(state: WorkspaceState): void {
  try { localStorage.setItem(WORKSPACE_KEY, encodeWorkspace(state)); } catch { /* Private browsing does not block monitoring. */ }
  try { const url = new URL(window.location.href); url.searchParams.set('monitoring', encodeWorkspace(state)); window.history.replaceState(window.history.state, '', url); } catch { /* Optional shareable view. */ }
}
