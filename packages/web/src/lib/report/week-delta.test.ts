import { describe, it, expect } from 'vitest';
import { dayNumberOf } from '@aemr/shared';
import { pickWeekSnapshots, type SnapshotRef } from './week-delta';

// Срез — четверг 23.07.2026; прошлый четверг (asOfDay − 7) — 16.07.2026
const THURSDAY = dayNumberOf('2026-07-23')!;

const snap = (id: string, createdAt: string): SnapshotRef => ({ id, createdAt });

describe('pickWeekSnapshots — пара снимков для «Что изменилось за неделю»', () => {
  it('обычная пара: to — последний ≤ четверга, from — последний ≤ прошлого четверга', () => {
    const pair = pickWeekSnapshots(
      [
        snap('old', '2026-07-09T10:00:00.000Z'),
        snap('prev', '2026-07-15T10:00:00.000Z'),
        snap('cur', '2026-07-22T10:00:00.000Z'),
      ],
      THURSDAY,
    );
    expect([pair?.from.id, pair?.to.id]).toEqual(['prev', 'cur']);
  });

  it('нет снимков вообще → null', () => {
    expect(pickWeekSnapshots([], THURSDAY)).toBeNull();
  });

  it('один снимок: второй точки для сравнения нет → null', () => {
    const only = [snap('cur', '2026-07-22T10:00:00.000Z')];
    expect(pickWeekSnapshots(only, THURSDAY)).toBeNull();
  });

  it('снимки будущего отсеяны: пятница после среза не годится в to', () => {
    const pair = pickWeekSnapshots(
      [
        snap('future', '2026-07-24T05:00:00.000Z'),
        snap('prev', '2026-07-16T10:00:00.000Z'),
        snap('cur', '2026-07-21T10:00:00.000Z'),
      ],
      THURSDAY,
    );
    expect([pair?.from.id, pair?.to.id]).toEqual(['prev', 'cur']);
  });

  it('только будущие снимки → null', () => {
    const future = [
      snap('f1', '2026-07-24T05:00:00.000Z'),
      snap('f2', '2026-07-30T05:00:00.000Z'),
    ];
    expect(pickWeekSnapshots(future, THURSDAY)).toBeNull();
  });

  it('граница: снимок позднего вечера четверга (UTC) входит в to — конец суток среза', () => {
    // Машина в поясе восточнее Гринвича увидела бы локально уже пятницу —
    // сравнение обязано идти по UTC-компонентам строки createdAt
    const pair = pickWeekSnapshots(
      [
        snap('prev', '2026-07-16T10:00:00.000Z'),
        snap('thu-late', '2026-07-23T23:59:59.000Z'),
      ],
      THURSDAY,
    );
    expect([pair?.from.id, pair?.to.id]).toEqual(['prev', 'thu-late']);
  });

  it('граница: снимок ровно в прошлый четверг входит в from', () => {
    const pair = pickWeekSnapshots(
      [
        snap('prev-thu', '2026-07-16T23:00:00.000Z'),
        snap('cur', '2026-07-22T10:00:00.000Z'),
      ],
      THURSDAY,
    );
    expect([pair?.from.id, pair?.to.id]).toEqual(['prev-thu', 'cur']);
  });

  it('единственный старый снимок попадает в оба окна → null (дифф с самим собой — не пара)', () => {
    const stale = [snap('stale', '2026-07-01T10:00:00.000Z')];
    expect(pickWeekSnapshots(stale, THURSDAY)).toBeNull();
  });

  it('несколько снимков в один день: последний по createdAt', () => {
    const pair = pickWeekSnapshots(
      [
        snap('prev', '2026-07-15T10:00:00.000Z'),
        snap('thu-early', '2026-07-23T02:00:00.000Z'),
        snap('thu-late', '2026-07-23T10:00:00.000Z'),
      ],
      THURSDAY,
    );
    expect([pair?.from.id, pair?.to.id]).toEqual(['prev', 'thu-late']);
  });

  it('порядок входного массива не важен', () => {
    const pair = pickWeekSnapshots(
      [
        snap('cur', '2026-07-22T10:00:00.000Z'),
        snap('old', '2026-07-02T10:00:00.000Z'),
        snap('prev', '2026-07-14T10:00:00.000Z'),
      ],
      THURSDAY,
    );
    expect([pair?.from.id, pair?.to.id]).toEqual(['prev', 'cur']);
  });
});
