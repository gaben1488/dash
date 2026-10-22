import { describe, expect, it } from 'vitest';
import { liveDetail } from './live-text';

describe('события исчезновения закупочных номеров', () => {
  it('называет исчезновение № кандидатом, не утверждая удаления физической строки', () => {
    const message = liveDetail([{
      book: 'УО', changedRows: 0, addedRows: 1, removedRows: 2,
      rowsTotal: 100, origin: 'webhook', at: '2026-10-22T06:00:00Z',
    }], 0);
    expect(message).toContain('прежних № п/п не найдено: 2 — требуется сверка');
    expect(message).toContain('появились новые № п/п: 1');
    expect(message).not.toContain('убрано');
  });
});
