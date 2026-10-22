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

it('filters pure note history before the discussion limit and preserves raw and mixed evidence', () => {
  const book = 'discussion-pagination';
  store.storeCommentWitness(book, { ...witness, kind: 'native_thread', sourceId: 'human-thread', content: 'Вопрос', readAt: '2026-10-01T00:00:00Z', raw: { status: 'OPEN' } });
  for (let i = 0; i < 20; i++) store.storeCommentWitness(book, { ...witness, sourceId: `history-${i}`, content: 'Было: 327 (21.05.2026 10:17, автор)', readAt: `2026-10-12T01:00:${String(i).padStart(2,'0')}Z` });
  const result = store.listDiscussionWitnesses(book, 1);
  expect(result.witnesses[0]?.evidence.sourceId).toBe('human-thread');
  expect(result.counts).toMatchObject({ eligible: 1, shown: 1, historyNotes: 20 });
  expect(store.listCommentWitnesses(book, 100)).toHaveLength(21);
  store.storeCommentWitness(book, { ...witness, sourceId: 'mixed', content: 'Было: 327 (21.05.2026 10:17, автор)\nПояснение', readAt: '2026-10-13T00:00:00Z' });
  const mixed = store.listDiscussionWitnesses(book, 1);
  expect(mixed.witnesses[0]?.evidence).toMatchObject({ content: expect.stringContaining('Было:'), discussionText: 'Пояснение' });
  expect(mixed.counts).toMatchObject({ eligible: 2, shown: 1 });
});

it('returns only original notes from the configured file and physical scope, keeping all versions and channel gaps', () => {
  const book = 'metadata-scope';
  store.storeCommentWitness(book, { ...witness, fileId: 'metadata-file', sourceId: '17:AF7', readAt: '2026-10-13T00:00:00Z' });
  store.storeCommentWitness(book, { ...witness, fileId: 'wrong-file', content: 'Чужое', readAt: '2026-10-13T01:00:00Z' });
  store.storeWitnessReading(book, 'metadata-file', 'notes', { status: 'unavailable', reason: 'Нет доступа', scope: [], records: [] }, '2026-10-13T02:00:00Z');
  const result = store.listCellNoteMetadata('metadata-file', 'ВСЕ', 7, 'AF');
  expect(result.status).toBe('unavailable');
  expect(result.notes).toHaveLength(1);
  expect(result.notes[0]?.evidence).toMatchObject({ cell: 'AF7', sheetId: 17, author: null });
  expect(result.notes[0]?.evidence).not.toHaveProperty('fileId');
  store.storeWitnessReading(book, 'metadata-file', 'notes', { status: 'read', reason: null, scope: ["'ВСЕ'!1:500"], records: [] }, '2026-10-13T03:00:00Z');
  expect(store.listCellNoteMetadata('metadata-file','ВСЕ',8,'AF')).toMatchObject({ status:'read', notes:[], identity:'physical-address-only' });
  expect(store.listCellNoteMetadata('metadata-file','ВСЕ',534,'AF').status).toBe('unavailable');
  expect(store.listCellNoteMetadata('metadata-file','Другой лист',7,'AF').status).toBe('unavailable');
});

it('keeps old unclassified cache as a labelled fallback without letting it displace original threads',()=>{
 const book='old-cache-fallback';
 store.storeCommentWitness(book,{...witness,fileId:'old-cache-file',kind:'native_thread',sourceId:'native',content:'Настоящий вопрос',readAt:'2026-10-01T00:00:00Z'});
 store.archiveLegacyComment(book,{commentId:'legacy',content:'Старый человеческий комментарий',recordedAt:'2026-10-13T00:00:00Z'});
 expect(store.listDiscussionWitnesses(book,1).witnesses[0]?.kind).toBe('native_thread');
 expect(store.listDiscussionWitnesses(book,20).witnesses.map(w=>w.kind)).toEqual(['native_thread','legacy_cache']);
});
it('evaluates the ordered discussion selection once even when hundreds of metadata notes precede a human thread',async()=>{
 const {db}=await import('../db/index.js');const book='one-pass-selection';
 store.storeCommentWitness(book,{...witness,fileId:'one-pass',kind:'native_thread',sourceId:'human',content:'Вопрос',readAt:'2026-10-01T00:00:00Z'});
 for(let i=0;i<420;i++)store.storeCommentWitness(book,{...witness,fileId:'one-pass',sourceId:`note-${i}`,content:'Было: 1 (21.05.2026 10:17, автор)',readAt:new Date(Date.UTC(2026,9,13,0,0,i)).toISOString()});
 const prepare=vi.spyOn(db.$client,'prepare');
 const result=store.listDiscussionWitnesses(book,20);
 const selections=prepare.mock.calls.filter(([query])=>query.includes('CASE WHEN')&&query.includes('drive_comment_observations'));
 expect(result.counts).toMatchObject({eligible:1,historyNotes:420});expect(result.witnesses[0]?.evidence.sourceId).toBe('human');
 expect(selections).toHaveLength(1);expect(selections[0]?.[0]).not.toMatch(/\boffset\b/i);
 const plan=db.$client.prepare('EXPLAIN QUERY PLAN '+selections[0]![0]).all(book,'reading:%') as {detail:string}[];
 expect(plan.filter(row=>row.detail.includes('TEMP B-TREE'))).toHaveLength(1);
 prepare.mockRestore();
});
