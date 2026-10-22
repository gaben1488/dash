import { describe, expect, it } from 'vitest';
import type { JournalRecord } from '@aemr/core';
import { correlateChangelogWithCurrent } from './changelog-integrity.js';

const CONTROL = Date.parse('2026-10-15T06:00:00.000Z');
const CURRENT = Date.parse('2026-10-22T08:00:00.000Z');
const LIVE_READ = Date.parse('2026-10-22T09:00:00.000Z');
const WHEN = 46315.70350991898; // verified 20.10.2026 16:53:03 UTC
const row = (number: string, value: string): unknown[] => {
  const cells = new Array<unknown>(34).fill('');
  cells[0] = number;
  cells[2] = 'Школа';
  cells[6] = 'Ремонт';
  cells[10] = 100;
  cells[11] = value;
  return cells;
};
const reading = (...values: unknown[][]) => [[], [], [], ...values];
const entry = (overrides: Partial<JournalRecord> = {}): JournalRecord => ({
  sheet: 'ВСЕ', cell: 'L178', column: 'L', row: '173/18',
  was: 'ЕП', became: 'ЭА', at: WHEN, author: 'unknown', ...overrides,
});

describe('журнал _ChangeLog как дополнительное, не единственное доказательство', () => {
  it('связывает запись по устойчивому № с текущей строкой, а не с историческим L178', () => {
    const result = correlateChangelogWithCurrent('УД', [entry()], reading(row('173/18', 'ЭА')),
      CONTROL, CURRENT, LIVE_READ);
    expect(result.entriesSinceControl).toBe(1);
    expect(result.matchesCurrent).toBe(1);
    expect(result.needsReview).toBe(0);
    expect(result.examples[0]).toMatchObject({
      rowSeq: '173/18', sourceCell: 'L178', currentCell: 'L4', status: 'matches-current',
    });
  });

  it('шестиколоночная запись без ключа не приписывается строке по адресу', () => {
    const result = correlateChangelogWithCurrent('УАГЗО', [entry({
      sheet: '', row: '', cell: 'L4',
    })], reading(row('173/18', 'ЭА')), CONTROL, CURRENT, LIVE_READ);
    expect(result.withoutStableKey).toBe(1);
    expect(result.matchesCurrent).toBe(0);
    expect(result.needsReview).toBe(1);
    expect(result.examples).toEqual([]);
  });

  it('12/1 и 12/01 не становятся одной закупкой из-за похожего номера', () => {
    const result = correlateChangelogWithCurrent('УО', [entry({ row: '12/1' })],
      reading(row('12/01', 'ЭА')), CONTROL, CURRENT, LIVE_READ);
    expect(result.matchesCurrent).toBe(0);
    expect(result.examples[0]?.status).toBe('row-not-found');
  });

  it('повторный номер, отличное новое значение и противоречивый журнал требуют проверки', () => {
    const duplicate = correlateChangelogWithCurrent('УО', [entry()],
      reading(row('173/18', 'ЭА'), row('173/18', 'ЭА')), CONTROL, CURRENT, LIVE_READ);
    expect(duplicate.examples[0]?.status).toBe('ambiguous-number');

    const mismatch = correlateChangelogWithCurrent('УО', [entry({ became: 'ЕП' })],
      reading(row('173/18', 'ЭА')), CONTROL, CURRENT, LIVE_READ);
    expect(mismatch.examples[0]?.status).toBe('different-current');

    const conflict = correlateChangelogWithCurrent('УО', [
      entry(), entry({ became: 'ЕП' }),
    ], reading(row('173/18', 'ЭА')), CONTROL, CURRENT, LIVE_READ);
    expect(conflict.examples[0]?.status).toBe('conflicting-log');
    expect(conflict.matchesCurrent).toBe(0);
  });

  it('берёт последнюю правку ячейки, не считает старое промежуточное значение расхождением', () => {
    const first = entry({ at: '20.10.2026 16:53:03', became: 'ЕП' });
    const last = entry({ at: '21.10.2026 16:53:03', was: 'ЕП', became: 'ЭА' });
    const result = correlateChangelogWithCurrent('УД', [first, last],
      reading(row('173/18', 'ЭА')), CONTROL, CURRENT, LIVE_READ);
    expect(result.entriesSinceControl).toBe(2);
    expect(result.matchesCurrent).toBe(1);
    expect(result.needsReview).toBe(0);
  });

  it('не допускает даты после текущего чтения и другие листы к подтверждению', () => {
    const result = correlateChangelogWithCurrent('УД', [
      entry({ at: '23.10.2026 12:00:00' }),
      entry({ sheet: 'Зеркало', at: WHEN }),
    ], reading(row('173/18', 'ЭА')), CONTROL, CURRENT, LIVE_READ);
    expect(result.entriesSinceControl).toBe(0);
    expect(result.matchesCurrent).toBe(0);
  });

  it('пустой журнал не является доказательством отсутствия удалений', () => {
    const result = correlateChangelogWithCurrent('УД', [],
      reading(row('12/1', 'ЭА')), CONTROL, CURRENT, LIVE_READ);
    expect(result.entriesSinceControl).toBe(0);
    expect(result.matchesCurrent).toBe(0);
    expect(result.note).toContain('Пропавшие №');
  });
});
