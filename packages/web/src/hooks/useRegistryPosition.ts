import { useCallback, useEffect, useRef, useState } from 'react';

type ObservedRow = { dept?: unknown; rowIndex?: unknown; rowRevision?: unknown };
type Locator = { dept: string; rowIndex: number; revision: string };
type Position = { page: number; row: Locator | null };
const empty = (): Position => ({ page: 1, row: null });
function read(bucket: string): Position {
  try {
    const saved = JSON.parse(new URL(location.href).searchParams.get('registry') ?? 'null');
    if (saved?.bucket !== bucket || !Number.isInteger(saved.page) || saved.page < 1 || saved.page > 1_000_000) return empty();
    const row = saved.row;
    return { page: saved.page, row: row && typeof row.dept === 'string' && row.dept.length <= 160 &&
      Number.isInteger(row.rowIndex) && row.rowIndex >= 0 && typeof row.revision === 'string' && row.revision.length <= 160
      ? { dept: row.dept, rowIndex: row.rowIndex, revision: row.revision } : null };
  } catch { return empty(); }
}
function write(bucket: string, position: Position, push: boolean) {
  const url = new URL(location.href);
  url.searchParams.set('registry', JSON.stringify({ bucket, ...position }));
  if (url.href !== location.href) history[push ? 'pushState' : 'replaceState'](history.state, '', url);
}
/** A view cursor, never a business ID. Reopening requires the exact observed row revision. */
export function useRegistryPosition<T extends ObservedRow>(bucket: string, rows: T[], ready: boolean) {
  const [position, setPosition] = useState(() => read(bucket));
  const latest = useRef(position);
  const commit = useCallback((next: Position, push: boolean) => { latest.current = next; write(bucket, next, push); setPosition(next); }, [bucket]);
  const [opened, setOpened] = useState<T | null>(null);
  useEffect(() => {
    const restore = () => { const next = read(bucket); latest.current = next; setPosition(next); setOpened(null); };
    window.addEventListener('popstate', restore);
    return () => window.removeEventListener('popstate', restore);
  }, [bucket]);
  const setPageNum = useCallback((page: number) => commit({ ...latest.current, page }, false), [commit]);
  const setSelectedRow = useCallback((row: T | null) => {
    setOpened(row);
    commit({ ...latest.current, row: row && typeof row.dept === 'string' && Number.isInteger(row.rowIndex) && typeof row.rowRevision === 'string'
      ? { dept: row.dept, rowIndex: Number(row.rowIndex), revision: row.rowRevision } : null }, true);
  }, [commit]);
  const locator = position.row;
  const observed = locator ? rows.find(row => row.dept === locator.dept && row.rowIndex === locator.rowIndex && row.rowRevision === locator.revision) : null;
  return { pageNum: position.page, setPageNum, selectedRow: opened ?? observed ?? null, setSelectedRow,
    selectionUnavailable: ready && locator !== null && !opened && !observed };
}
