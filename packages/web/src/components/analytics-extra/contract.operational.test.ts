import { describe, expect, it } from 'vitest';
import { uniqueOperationalAbsences, type OperationalAbsenceDto } from './contract';

const record = (rowSeq: string, dept = 'УО'): OperationalAbsenceDto => ({
  dept, rowSeq, wasAtSheetRow: 18, subject: 'Ремонт',
  observedAt: '2026-10-22T08:00:00Z',
});

describe('оперативные наблюдения и недельные срезы', () => {
  it('не удваивает номер, совпавший с недельным срезом', () => {
    const result = uniqueOperationalAbsences(
      [record('12/1'), record('12/01'), record('12/1', 'УД')],
      [{ dept: 'УО', vanished: [{ rowSeq: '12/1' }] }],
    );
    expect(result.corroboratedCount).toBe(1);
    expect(result.only.map(entry => entry.dept + '/' + entry.rowSeq))
      .toEqual(['УО/12/01', 'УД/12/1']);
  });

  it('повторные live-события без недельной пары не удваивают счёт', () => {
    const result = uniqueOperationalAbsences([record('173/18'), record('173/18')], []);
    expect(result.only).toHaveLength(1);
    expect(result.corroboratedCount).toBe(0);
  });
});
