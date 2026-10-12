import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { CommentWitness } from './google-comment-witnesses.js';

let store: typeof import('./comment-witness-store.js');
const oldEnvironment = { ...process.env };
beforeAll(async () => {
  vi.resetModules(); process.env = { ...oldEnvironment, NODE_ENV: 'test', SQLITE_PATH: ':memory:' };
  store = await import('./comment-witness-store.js');
}, 60_000);
afterAll(() => { process.env = oldEnvironment; vi.resetModules(); });
const witness: CommentWitness = { kind: 'cell_note', fileId: 'file', sourceId: '17:AF7',
  sheetId: 17, sheet: 'ВСЕ', cell: 'AF7', author: null, content: 'Первое', posts: [],
  readAt: '2026-10-12T01:00:00Z', sourceRevision: null,
  sourceRevisionUnavailableReason: 'Не предоставлена.', raw: { note: 'Первое' } };

describe('comments family history', () => {
  it('retains changed and reverted original evidence, and repeated reads are idempotent', () => {
    expect(store.storeCommentWitness('УКСиМП', witness)).toBe(true);
    expect(store.storeCommentWitness('УКСиМП', { ...witness, readAt: '2026-10-12T01:01:00Z' })).toBe(false);
    store.storeCommentWitness('УКСиМП', { ...witness, content: 'Второе', raw: { note: 'Второе' }, readAt: '2026-10-12T02:00:00Z' });
    store.storeCommentWitness('УКСиМП', { ...witness, readAt: '2026-10-12T03:00:00Z' });
    const rows = store.listCommentWitnesses('УКСиМП');
    expect(rows).toHaveLength(3);
    expect(rows.map(r => r.evidence.content)).toEqual(['Первое', 'Второе', 'Первое']);
    expect(rows.every(r => r.evidence.author === null && !('fileId' in r.evidence))).toBe(true);
  });
  it('preserves three transitions in one millisecond and deduplicates the final observation', () => {
    const first = { ...witness, sourceId: '17:AF8', cell: 'AF8', readAt: '2026-10-12T04:00:00.123Z' };
    const changed = { ...first, content: 'Второе', raw: { note: 'Второе' } };
    const before = store.countCommentWitnesses('same-time');
    expect([first, changed, first].map(value => store.storeCommentWitness('same-time', value))).toEqual([true, true, true]);
    expect(store.countCommentWitnesses('same-time') - before).toBe(3);
    const rows = store.listCommentWitnesses('same-time');
    expect(rows.map(row => row.evidence.content)).toEqual(['Первое', 'Второе', 'Первое']);
    expect(new Set(rows.map(row => row.id)).size).toBe(3);
    expect(rows.every(row => row.evidence.author === null)).toBe(true);
    expect(store.storeCommentWitness('same-time', first)).toBe(false);
    expect(store.countCommentWitnesses('same-time') - before).toBe(3);
  });
  it('persists unavailable rather than a successful zero reading', () => {
    store.storeWitnessReading('УИО', 'other', 'threads', {
      status: 'unavailable', reason: 'Нет доступа.', scope: [], records: [],
    }, '2026-10-12T01:00:00Z');
    expect(store.listCommentWitnesses('УИО')[0]?.evidence).toMatchObject({ status: 'unavailable', count: null });
  });
  it('reading diagnostics do not displace original comments at a bounded limit', () => {
    store.storeCommentWitness('bounded', { ...witness, sourceId: 'bounded-note' });
    for (let i = 0; i < 3; i++) store.storeWitnessReading('bounded', 'bounded-file', 'threads', {
      status: 'unavailable', reason: 'Нет доступа.', scope: [], records: [],
    }, `2026-10-12T0${i + 2}:00:00Z`);
    expect(store.listCommentWitnesses('bounded', 1, true)[0]?.evidence.content).toBe('Первое');
    const readings = store.listCommentReadings('bounded');
    expect(readings).toHaveLength(1);
    expect(readings[0].readAt).toBe('2026-10-12T04:00:00Z');
  });
  it('preserves reverted legacy projections with equal recordedAt', () => {
    const original = { commentId: 'legacy-same', content: 'Первое', recordedAt: '2026-10-12T05:00:00.123Z' };
    store.archiveLegacyComment('legacy-same-time', original);
    store.archiveLegacyComment('legacy-same-time', { ...original, content: 'Второе' });
    store.archiveLegacyComment('legacy-same-time', original);
    store.archiveLegacyComment('legacy-same-time', original);
    expect(store.listCommentWitnesses('legacy-same-time').map(row => (row.evidence.original as { content: string }).content))
      .toEqual(['Первое', 'Второе', 'Первое']);
  });
  it('archives legacy projected evidence without assigning an unproven source file ID', () => {
    store.archiveLegacyComment('УО', { commentId: 'old', content: 'Прежнее пояснение',
      author: 'Исторический автор', recordedAt: '2026-08-22T00:00:00Z' });
    const evidence = store.listCommentWitnesses('УО')[0]?.evidence;
    expect(evidence).toMatchObject({ sourceFileId: null, origin: 'LEGACY_LOCAL_PROJECTION',
      original: { content: 'Прежнее пояснение' } });
  });
});
