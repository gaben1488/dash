import { describe, expect, it } from 'vitest';
import type { ChangeEntry } from '@aemr/core';
import type { RowChange } from '../../hooks/useLiveEvents';
import {
  bookClockOf,
  changeStoryUrl,
  entriesFromLiveRows,
  mergeStoryWithLive,
} from './change-story-client';

/** Момент эфира, приведённый к часам машины, — та же подпись, что у книги. */
const at = (h: number, m: number): string => {
  const d = new Date(2026, 7, 21, h, m, 0);
  return d.toISOString();
};

const live = (over: Partial<RowChange>): RowChange => ({
  book: 'УО', sheetRow: 177, rowSeq: '38', column: 'K', columnLabel: 'ИТОГО 1',
  before: '100', after: '120', author: 'ivanova@aemr.ru', at: at(11, 33),
  ...over,
});

describe('адрес запроса подробной глубины', () => {
  it('пустой отбор не отправляет ни одной оси', () => {
    expect(changeStoryUrl({})).toBe('/api/change-story');
  });

  it('оси отбора едут списками, поиск — отдельным параметром', () => {
    const url = changeStoryUrl({ since: '2026-08-14', books: ['УО', 'УД'], kinds: ['money'], search: '  кровля  ' });
    expect(url).toContain('since=2026-08-14');
    expect(url).toContain('book=%D0%A3%D0%9E');
    expect(url).toContain('kind=money');
    expect(url).toContain('q=%D0%BA%D1%80%D0%BE%D0%B2%D0%BB%D1%8F');
  });

  it('пустой поиск не отправляется вовсе', () => {
    expect(changeStoryUrl({ search: '   ' })).toBe('/api/change-story');
  });
});

describe('эфир переводится в те же записи, что приходят с сервера', () => {
  it('род правки берётся из колонки тем же каноном, что на сервере', () => {
    const [e] = entriesFromLiveRows([live({})]);
    expect(e.kind).toBe('money');
    expect(e.rowSeq).toBe('38');
    expect(e.origin).toBe('live-stream');
  });

  it('момент эфира приводится к подписи часов книги, без пояса', () => {
    const [e] = entriesFromLiveRows([live({})]);
    expect(e.at).toMatch(/^2026-08-21T\d{2}:\d{2}:\d{2}$/);
    expect(bookClockOf('мусор')).toBeNull();
  });

  it('заполнение целой строки в эфире сворачивается в «новая закупка»', () => {
    const rows = ['A', 'C', 'G', 'H', 'J', 'K', 'L'].map((c) =>
      live({ column: c, columnLabel: undefined, before: '', after: 'значение', sheetRow: 300, rowSeq: '90' }));
    const folded = entriesFromLiveRows(rows);
    expect(folded).toHaveLength(1);
    expect(folded[0].kind).toBe('row-added');
  });

  it('колонка вне канона не получает выдуманного рода', () => {
    const [e] = entriesFromLiveRows([live({ column: 'AZ', columnLabel: undefined })]);
    expect(e.kind).toBe('other');
    expect(e.columnLabel).toBeNull();
  });
});

describe('склейка ответа сервера с эфиром', () => {
  const fromServer: ChangeEntry[] = [{
    id: 'УО|ВСЕ|K177|2026-08-21T11:33:00|ivanova@aemr.ru',
    book: 'УО', sheet: 'ВСЕ', rowSeq: '38', sheetRow: 177,
    column: 'K', columnLabel: 'ИТОГО 1', kind: 'money',
    before: '100', after: '120', author: 'ivanova@aemr.ru',
    at: '2026-08-21T11:33:00', atMs: Date.parse('2026-08-21T11:33:00Z'),
    subject: 'Услуги почтовой связи', subordinate: null, origin: 'book-journal',
  }];

  it('одна и та же правка не показывается дважды', () => {
    const fromLive = entriesFromLiveRows([live({ at: at(11, 33) })]);
    const merged = mergeStoryWithLive(fromServer, fromLive);
    expect(merged).toHaveLength(1);
    // Победитель дубля — сервер: у него есть предмет закупки из ключа журнала.
    expect(merged[0].origin).toBe('book-journal');
    expect(merged[0].subject).toBe('Услуги почтовой связи');
  });

  it('правка, которой в ответе сервера ещё нет, из списка не пропадает', () => {
    const fromLive = entriesFromLiveRows([live({ at: at(12, 0), sheetRow: 200, rowSeq: '41' })]);
    const merged = mergeStoryWithLive(fromServer, fromLive);
    expect(merged).toHaveLength(2);
    // Свежая — сверху.
    expect(merged[0].rowSeq).toBe('41');
  });
});
