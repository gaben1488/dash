// @vitest-environment jsdom
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useChangeStory } from './useChangeStory';
import { fetchChangeStory } from '../lib/changes/change-story-client';
vi.mock('../lib/changes/change-story-client', async importOriginal => ({
  ...await importOriginal<typeof import('../lib/changes/change-story-client')>(), fetchChangeStory: vi.fn(),
}));
vi.mock('./useLiveEvents', () => ({ useLiveEvents: () => ({ recentRows: [
  { book: 'УО', sheetRow: 4, rowSeq: '173/1', column: 'K', before: '100', after: '120', at: '2026-10-12T01:00:00Z' },
  { book: 'УД', sheetRow: 5, rowSeq: '173/18', column: 'K', before: '100', after: '120', at: '2026-10-12T01:00:00Z' },
  { book: 'УО', sheetRow: 6, rowSeq: '174', column: 'K', before: '100', after: '120', at: '2026-10-01T01:00:00Z' },
] }) }));
afterEach(() => { cleanup(); vi.mocked(fetchChangeStory).mockReset(); });
it('live observations respect selected books and the same completed weekly window', async () => {
  vi.mocked(fetchChangeStory).mockResolvedValue({ since: '2026-10-08', entries: [], gaps: [],
    digest: { entries: 0, books: 0, rows: 0, booksNamed: [], authors: [], firstAt: null, lastAt: null, emptiness: 'quiet', byKind: {} },
    facets: { books: [], authors: [] }, total: 0, shown: 0, note: '', comparison: null, deletionsUnobservable: true,
  } as unknown as Awaited<ReturnType<typeof fetchChangeStory>>);
  const { result } = renderHook(() => useChangeStory({ books: ['УО'] }));
  await waitFor(() => expect(result.current.response).not.toBeNull());
  expect(result.current.entries.map(e => e.rowSeq)).toEqual(['173/1']);
});
