import { describe, expect, it } from 'vitest';
import type { SnapshotRow } from '@aemr/core';
import {
  compareVerifiedWeeklyControls,
  selectWeeklyControls,
  type VerifiedLineageControl,
} from './weekly-lineage.js';

const row = (seq: string, subject = 'Ремонт кровли'): SnapshotRow => ({
  rowSeq: seq, sheetRow: Number(seq), subject,
  subordinate: 'МБОУ школа', planSum: 100, method: 'ЕП',
});
const control = (
  id: string, createdAt: string, records: SnapshotRow[], error: string | null = null,
): VerifiedLineageControl => ({
  id, createdAt, rows: new Map([['uo', records]]), error,
});
const old = control('oct01', '2026-10-01T06:00:00.000Z', [row('10')]);
const next = control('oct08', '2026-10-08T06:00:00.000Z', [row('15')]);

describe('история недельного провенанса', () => {
  it('в истории два четверга и гипотеза смены номера с сохранением источников', () => {
    const r = compareVerifiedWeeklyControls([next, old], 12, 'УО');
    expect(r.periods).toMatchObject([{
      fromId: 'oct01', toId: 'oct08', status: 'checked',
    }]);
    expect(r.totalEvents).toBe(1);
    expect(r.events[0].entry).toMatchObject({
      kind: 'row-identity-candidate',
      rowSeq: '10', relatedRowSeq: '15', at: null, author: null,
      comparisonEvidence: {
        baselineId: 'oct01',
        controlAt: old.createdAt,
        observedAt: next.createdAt,
      },
    });
  });

  it('смена контекста с сохранённым номером остаётся наблюдением, а не удалением', () => {
    const changed = control('oct08', next.createdAt, [row('10', 'Канцтовары')]);
    const r = compareVerifiedWeeklyControls([changed, old], 12);
    expect(r.events.map(e => e.entry.kind)).toEqual(['subject']);
    expect(r.events[0].entry.origin).toBe('snapshot-diff');
  });

  it('пропущенную неделю нельзя сшить с другой и объявить «ничего не произошло»', () => {
    const october15 = control('oct15', '2026-10-15T06:00:00.000Z', [row('15')]);
    const r = compareVerifiedWeeklyControls([october15, old], 12);
    expect(r.periods[0].status).toBe('unavailable');
    expect(r.periods[0].notes[0]).toContain('отсутствуют');
    expect(r.events).toEqual([]);
  });

  it('повреждение любой стороны исключает выдуманный дифф', () => {
    const broken = { ...old, error: 'атомы не совпадают' };
    const r = compareVerifiedWeeklyControls([next, broken], 12);
    expect(r.totalEvents).toBe(0);
    expect(r.periods[0].status).toBe('unavailable');
    expect(r.periods[0].notes.join(' ')).toContain('атомы не совпадают');
  });

  it('дубли № или безномерные строки обозначают неполное доказательство', () => {
    const dup = control('oct08', next.createdAt, [row('10'), { ...row('10'), sheetRow: 42 }]);
    const r = compareVerifiedWeeklyControls([dup, old], 12);
    expect(r.periods[0].status).toBe('partial');
    expect(r.periods[0].notes.join(' ')).toContain('повторяющиеся');
  });

  it('дата среза берётся в продуктовой временной шкале, не в UTC', () => {
    const items = selectWeeklyControls([
      { id: 'wed-utc-thu-kam', createdAt: '2026-10-07T17:00:00Z' },
      { id: 'thu-late', createdAt: '2026-10-08T06:00:00Z' },
      { id: 'friday', createdAt: '2026-10-09T06:00:00Z' },
      { id: 'prior', createdAt: old.createdAt },
    ], Date.parse('2026-10-10T00:00:00Z'), 12);
    expect(items.map((v) => v.id)).toEqual(['thu-late', 'prior']);
  });
});

describe('честное отсутствие результатов', () => {
  it('без двух архивных контролей нет доказанного нуля изменений', () => {
    const result = compareVerifiedWeeklyControls([], 12);
    expect(result.coverage).toBe('no-control-pair');
    expect(result.coverageNote).toContain('не означает');
    expect(result.totalEvents).toBe(0);
  });

  it('неделя с пробелом в архивах не выдаётся за полный охват', () => {
    const result = compareVerifiedWeeklyControls([
      control('oct15', '2026-10-15T06:00:00.000Z', [row('15')]),
      control('oct01', '2026-10-01T06:00:00.000Z', [row('10')]),
    ], 12);
    expect(result.coverage).toBe('partial');
    expect(result.totalEvents).toBe(0);
    expect(result.coverageNote).toContain('неполная');
  });
});

