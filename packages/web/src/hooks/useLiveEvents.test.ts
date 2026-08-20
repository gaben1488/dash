// @vitest-environment jsdom
/**
 * Стражи приёма живого потока.
 *
 * Что здесь защищается:
 *   • служебные записи потока (приветствие, «пульс») до экрана НЕ доходят —
 *     иначе в полной тишине полоса оповещения выскакивала бы каждые 20 секунд;
 *   • события копятся, а не заменяют друг друга: две правки подряд до нажатия
 *     «обновить» — это пять строк, а не две;
 *   • обрыв связи лечится переподключением сам, и продукт при этом молчит:
 *     обрыв потока не делает числа на экране неверными;
 *   • подсветка изменившихся строк гаснет со временем, а не остаётся навсегда.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  parseStreamRecord,
  reduceLive,
  pruneRecentRows,
  hasLiveNews,
  openLiveEvents,
  closeLiveEvents,
  acknowledgeLiveEvents,
  resetLiveEvents,
  getLiveState as currentState,
  FLASH_MS,
  type LiveState,
} from './useLiveEvents';

const EMPTY: LiveState = {
  connected: false,
  lastEventAt: null,
  books: [],
  newIssues: 0,
  snapshotRebuilt: false,
  recentRows: [],
};

const bookEvent = (changedRows: number, at = '2026-08-18T04:00:00.000Z') => ({
  kind: 'book-updated',
  book: 'УО',
  changedRows,
  addedRows: 0,
  removedRows: 0,
  rowsTotal: 512,
  origin: 'webhook',
  at,
});

afterEach(() => {
  resetLiveEvents();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('разбор записей потока', () => {
  it('запись с данными разбирается в событие', () => {
    const raw = 'id: 7\nevent: book-updated\ndata: {"id":7,"kind":"book-updated","book":"УО"}';
    expect(parseStreamRecord(raw)).toMatchObject({ id: 7, kind: 'book-updated', book: 'УО' });
  });

  it('служебный пульс — не событие: в тишине экран ничего не показывает', () => {
    expect(parseStreamRecord(': пульс 2026-08-18T04:00:00.000Z')).toBeNull();
    expect(parseStreamRecord('retry: 5000\n: поток открыт')).toBeNull();
  });

  it('обрывок записи не рушит поток', () => {
    expect(parseStreamRecord('data: {"kind":"book-upda')).toBeNull();
  });
});

describe('накопление изменений', () => {
  it('две правки одной книги складываются, а не заменяют друг друга', () => {
    const once = reduceLive(EMPTY, bookEvent(2));
    const twice = reduceLive(once, bookEvent(3, '2026-08-18T04:01:00.000Z'));

    expect(twice.books).toHaveLength(1);
    expect(twice.books[0].changedRows).toBe(5);
    expect(twice.lastEventAt).toBe('2026-08-18T04:01:00.000Z');
  });

  it('разные книги живут отдельными строками', () => {
    const s1 = reduceLive(EMPTY, bookEvent(2));
    const s2 = reduceLive(s1, { ...bookEvent(1), book: 'УКСиМП' });

    expect(s2.books.map((b) => b.book).sort()).toEqual(['УКСиМП', 'УО']);
  });

  it('прирост замечаний копится, снимок помечается пересобранным', () => {
    const s1 = reduceLive(EMPTY, { kind: 'issues-appeared', added: 2, total: 216, at: '2026-08-18T04:00:00.000Z' });
    const s2 = reduceLive(s1, { kind: 'issues-appeared', added: 1, total: 217, at: '2026-08-18T04:02:00.000Z' });
    const s3 = reduceLive(s2, { kind: 'snapshot-rebuilt', rows: 3854, issues: 217, at: '2026-08-18T04:02:00.000Z' });

    expect(s3.newIssues).toBe(3);
    expect(s3.snapshotRebuilt).toBe(true);
    expect(hasLiveNews(s3)).toBe(true);
  });

  it('неизвестное событие состояние не трогает — вперёд совместимо', () => {
    const next = reduceLive(EMPTY, { kind: 'нечто-новое', at: '2026-08-18T04:00:00.000Z' });
    expect(next).toBe(EMPTY);
  });

  it('чистое состояние новостей не имеет — полоса не показывается', () => {
    expect(hasLiveNews(EMPTY)).toBe(false);
  });
});

describe('подсветка изменившихся строк', () => {
  it('строка живёт ограниченное время и гаснет', () => {
    const now = Date.parse('2026-08-18T04:00:00.000Z');
    const rows = [
      { book: 'УО', sheetRow: 155, column: 'L', before: 'ЕП', after: 'ЭА', at: '2026-08-18T04:00:00.000Z' },
      { book: 'УО', sheetRow: 156, column: 'L', before: 'ЕП', after: 'ЭА', at: '2026-08-18T03:50:00.000Z' },
    ];
    expect(pruneRecentRows(rows, now + 1000).map((r) => r.sheetRow)).toEqual([155]);
    expect(pruneRecentRows(rows, now + FLASH_MS + 1000)).toEqual([]);
  });
});

/* ── Соединение и переподключение ──────────────────────── */

/** Управляемый поток: тест сам решает, когда придёт запись и когда будет обрыв. */
function makeStream() {
  let push!: (chunk: string) => void;
  let finish!: () => void;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      push = (chunk) => controller.enqueue(encoder.encode(chunk));
      finish = () => controller.close();
    },
  });
  return { body, push: (c: string) => push(c), finish: () => finish() };
}

describe('соединение с сервером', () => {
  beforeEach(() => {
    resetLiveEvents();
  });

  it('поток открывается и доставленное событие попадает в состояние', async () => {
    const stream = makeStream();
    const fetchSpy = vi.fn(async () => new Response(stream.body, { status: 200 }));
    vi.stubGlobal('fetch', fetchSpy);

    openLiveEvents();
    await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));

    stream.push(`data: ${JSON.stringify(bookEvent(3))}\n\n`);
    await vi.waitFor(() => {
      expect(hasLiveNews(currentState())).toBe(true);
    });
    expect(currentState().books[0]).toMatchObject({ book: 'УО', changedRows: 3 });
  });

  it('обрыв потока лечится переподключением — продукт молчит и подключается сам', async () => {
    const first = makeStream();
    const second = makeStream();
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(new Response(first.body, { status: 200 }))
      .mockResolvedValueOnce(new Response(second.body, { status: 200 }));
    vi.stubGlobal('fetch', fetchSpy);

    openLiveEvents();
    await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));

    // Сервер перезапустился — поток кончился.
    first.finish();

    await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(2), { timeout: 4000 });

    // После переподключения событие снова доходит до экрана.
    second.push(`data: ${JSON.stringify(bookEvent(1))}\n\n`);
    await vi.waitFor(() => expect(currentState().books).toHaveLength(1));
  });

  it('переподключение просит досылку с номера последнего события', async () => {
    const first = makeStream();
    const second = makeStream();
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(new Response(first.body, { status: 200 }))
      .mockResolvedValueOnce(new Response(second.body, { status: 200 }));
    vi.stubGlobal('fetch', fetchSpy);

    openLiveEvents();
    await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    first.push(`data: ${JSON.stringify({ id: 42, ...bookEvent(1) })}\n\n`);
    await vi.waitFor(() => expect(currentState().books).toHaveLength(1));

    first.finish();
    await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(2), { timeout: 4000 });

    const headers = fetchSpy.mock.calls[1][1].headers as Record<string, string>;
    expect(headers['Last-Event-ID']).toBe('42');
  });

  it('закрытие снимает соединение и попыток больше нет', async () => {
    const stream = makeStream();
    const fetchSpy = vi.fn(async () => new Response(stream.body, { status: 200 }));
    vi.stubGlobal('fetch', fetchSpy);

    openLiveEvents();
    await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));

    closeLiveEvents();
    stream.finish();
    await new Promise((r) => setTimeout(r, 1500));

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('принятие новостей гасит накопленное, но момент обновления остаётся', async () => {
    const stream = makeStream();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(stream.body, { status: 200 })));

    openLiveEvents();
    stream.push(`data: ${JSON.stringify(bookEvent(3))}\n\n`);
    await vi.waitFor(() => expect(hasLiveNews(currentState())).toBe(true));

    acknowledgeLiveEvents();

    expect(hasLiveNews(currentState())).toBe(false);
    expect(currentState().lastEventAt).toBe('2026-08-18T04:00:00.000Z');
  });
});
