import { describe, it, expect } from 'vitest';
import { thresholdAt } from '@aemr/shared';
import {
  detectSplitting,
  detectEpOverLimit,
  detectAnnualEpShare,
  detectSupplierConcentration,
  detectAntiCorruption,
  penaltyForSeverity,
  type AntiCorruptionRow,
} from './anticorruption.js';

const datedLaw = thresholdAt('law.epSmallSingleContract', '2026-10-21');

function row(o: Partial<AntiCorruptionRow>): AntiCorruptionRow {
  return { rowIndex: 0, method: 'ЕП', planTotal: 0, factTotal: 0, economy: 0, subject: '', ...o };
}

describe('anticorruption — splitting (#1 дробление)', () => {
  it('10 однородных ЕП в предлимитной полосе → индекс >60, флаг high', () => {
    const rows = Array.from({ length: 10 }, (_, i) =>
      row({ rowIndex: i + 1, method: 'ЕП', planTotal: 550_000, subject: 'Поставка канцтоваров' }),
    );
    const flags = detectSplitting(rows, datedLaw);
    expect(flags).toHaveLength(1);
    expect(flags[0].indicator).toBe('splitting');
    expect(flags[0].score!).toBeGreaterThan(60);
    expect(flags[0].severity).toBe('high');
  });
  it('3 ЕП → не флагуется (нужно ≥5)', () => {
    const rows = Array.from({ length: 3 }, (_, i) =>
      row({ rowIndex: i + 1, planTotal: 550_000, subject: 'Канцтовары' }),
    );
    expect(detectSplitting(rows, datedLaw)).toHaveLength(0);
  });
  it('конкурентные не учитываются (только ЕП)', () => {
    const rows = Array.from({ length: 10 }, (_, i) =>
      row({ rowIndex: i + 1, method: 'ЭА', planTotal: 550_000, subject: 'Канцтовары' }),
    );
    expect(detectSplitting(rows, datedLaw)).toHaveLength(0);
  });
});

describe('anticorruption — ep_over_limit (#8)', () => {
  it('сумма годовой позиции ЕП не является доказательством превышения цены отдельного договора', () => {
    const flags = detectEpOverLimit([row({ rowIndex: 1, method: 'ЕП', planTotal: 750_000 })]);
    expect(flags).toEqual([]);
  });
});

describe('anticorruption — annual share (#9) + concentration (#10 pluggable)', () => {
  it('доля ЕП > порога → флаг; ниже → нет', () => {
    expect(detectAnnualEpShare(6_000_000, 10_000_000, 0.5)).toHaveLength(1);
    expect(detectAnnualEpShare(4_000_000, 10_000_000, 0.5)).toHaveLength(0);
  });
  it('#10 без ИНН → спит (пусто)', () => {
    const rows = Array.from({ length: 5 }, (_, i) => row({ rowIndex: i + 1, method: 'ЕП', factTotal: 1_000_000 }));
    expect(detectSupplierConcentration(rows)).toHaveLength(0);
  });
  it('#10 с ИНН >50% → флаг (pluggable работает)', () => {
    const rows = [
      row({ rowIndex: 1, factTotal: 7_000_000, supplierInn: '111' }),
      row({ rowIndex: 2, factTotal: 3_000_000, supplierInn: '222' }),
    ];
    const flags = detectSupplierConcentration(rows);
    expect(flags).toHaveLength(1);
    expect(flags[0].message).toContain('111');
  });
});

describe('anticorruption — оркестратор + штраф дисциплины', () => {
  it('penaltyForSeverity: high −15, medium −10, low −5', () => {
    expect(penaltyForSeverity('high')).toBe(-15);
    expect(penaltyForSeverity('medium')).toBe(-10);
    expect(penaltyForSeverity('low')).toBe(-5);
  });
  it('detectAntiCorruption сохраняет сигналы без штрафа за неподтверждённые нарушения', () => {
    const rows = [
      ...Array.from({ length: 10 }, (_, i) =>
        row({ rowIndex: i + 1, method: 'ЕП', planTotal: 550_000, subject: 'Канцтовары' }),
      ),
      row({ rowIndex: 11, method: 'ЕП', planTotal: 750_000, subject: 'Ремонт кровли' }),
    ];
    const res = detectAntiCorruption('uo', { rows, epTotal: 6_000_000, totalPlan: 10_000_000, epShareLimit: 0.5,
      epSingleContractReference: datedLaw });
    expect(res.grbsId).toBe('uo');
    expect(res.flags.length).toBeGreaterThanOrEqual(2);
    expect(res.disciplinaryPenalty).toBe(0);
  });
});

describe('C06.02 anticorruption snapshots', () => {
  it('unknown older legal context cannot silently use the current reference', () => {
    const rows = Array.from({ length: 10 }, (_, i) => row({
      rowIndex: i + 1, method: 'ЕП', planTotal: 550, subject: 'Поставка канцтоваров',
    }));
    expect(detectSplitting(rows)).toEqual([]);
    const result = detectAntiCorruption('uo', { rows });
    expect(result.flags.some(f => f.indicator === 'splitting' || f.indicator === 'ep_over_limit')).toBe(false);
    expect(result.unavailableIndicators.map(e => e.indicator)).toEqual(
      expect.arrayContaining(['splitting', 'ep_over_limit']),
    );
  });

  it('changing frozen reference changes screening, never establishes a legal violation', () => {
    const rows = Array.from({ length: 10 }, (_, i) => row({
      rowIndex: i + 1, method: 'ЕП', planTotal: 550, subject: 'Поставка канцтоваров',
    }));
    const original = detectSplitting(rows, datedLaw);
    expect(original).toHaveLength(1);
    expect(original[0]?.message).toContain('не нарушение');
    expect(original[0]?.message).toContain('редакция нормы не подтверждена');
    const laterEdition = { ...datedLaw, value: 100 };
    expect(detectSplitting(rows, laterEdition)).toEqual([]);
    expect(detectEpOverLimit(rows)).toEqual([]);
  });
});
