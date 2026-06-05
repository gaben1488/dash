import { describe, it, expect } from 'vitest';
import {
  detectSplitting,
  detectZeroCompetition,
  detectPriceInflation,
  detectEpOverLimit,
  detectAnnualEpShare,
  detectSupplierConcentration,
  detectAntiCorruption,
  penaltyForSeverity,
  type AntiCorruptionRow,
} from './anticorruption.js';

function row(o: Partial<AntiCorruptionRow>): AntiCorruptionRow {
  return { rowIndex: 0, method: 'ЕП', planTotal: 0, factTotal: 0, economy: 0, subject: '', ...o };
}

describe('anticorruption — splitting (#1 дробление)', () => {
  it('10 однородных ЕП в предлимитной полосе → индекс >60, флаг high', () => {
    const rows = Array.from({ length: 10 }, (_, i) =>
      row({ rowIndex: i + 1, method: 'ЕП', planTotal: 550_000, subject: 'Поставка канцтоваров' }),
    );
    const flags = detectSplitting(rows);
    expect(flags).toHaveLength(1);
    expect(flags[0].indicator).toBe('splitting');
    expect(flags[0].score!).toBeGreaterThan(60);
    expect(flags[0].severity).toBe('high');
  });
  it('3 ЕП → не флагуется (нужно ≥5)', () => {
    const rows = Array.from({ length: 3 }, (_, i) =>
      row({ rowIndex: i + 1, planTotal: 550_000, subject: 'Канцтовары' }),
    );
    expect(detectSplitting(rows)).toHaveLength(0);
  });
  it('конкурентные не учитываются (только ЕП)', () => {
    const rows = Array.from({ length: 10 }, (_, i) =>
      row({ rowIndex: i + 1, method: 'ЭА', planTotal: 550_000, subject: 'Канцтовары' }),
    );
    expect(detectSplitting(rows)).toHaveLength(0);
  });
});

describe('anticorruption — zero_competition (#2)', () => {
  it('>50% конкурентных с нулевой экономией → флаг', () => {
    const rows = [
      ...Array.from({ length: 4 }, (_, i) =>
        row({ rowIndex: i + 1, method: 'ЭА', planTotal: 1_000_000, factTotal: 1_000_000, economy: 0 }),
      ),
      row({ rowIndex: 5, method: 'ЭА', planTotal: 1_000_000, factTotal: 900_000, economy: 100_000 }),
    ];
    const flags = detectZeroCompetition(rows);
    expect(flags).toHaveLength(1);
    expect(flags[0].indicator).toBe('zero_competition');
  });
  it('<5 конкурентных → нет флага', () => {
    const rows = Array.from({ length: 3 }, (_, i) =>
      row({ rowIndex: i + 1, method: 'ЭА', planTotal: 1_000_000, factTotal: 1_000_000, economy: 0 }),
    );
    expect(detectZeroCompetition(rows)).toHaveLength(0);
  });
});

describe('anticorruption — price_inflation (#4) + ep_over_limit (#8)', () => {
  it('экономия >25% → price_inflation', () => {
    const flags = detectPriceInflation([row({ rowIndex: 1, method: 'ЭА', planTotal: 1_000_000, economy: 300_000 })]);
    expect(flags.some(f => f.indicator === 'price_inflation')).toBe(true);
  });
  it('ЕП >600К → ep_over_limit high', () => {
    const flags = detectEpOverLimit([row({ rowIndex: 1, method: 'ЕП', planTotal: 750_000 })]);
    expect(flags).toHaveLength(1);
    expect(flags[0].severity).toBe('high');
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
  it('detectAntiCorruption агрегирует флаги + отрицательный штраф', () => {
    const rows = [
      ...Array.from({ length: 10 }, (_, i) =>
        row({ rowIndex: i + 1, method: 'ЕП', planTotal: 550_000, subject: 'Канцтовары' }),
      ),
      row({ rowIndex: 11, method: 'ЕП', planTotal: 750_000, subject: 'Ремонт кровли' }),
    ];
    const res = detectAntiCorruption('uo', { rows, epTotal: 6_000_000, totalPlan: 10_000_000, epShareLimit: 0.5 });
    expect(res.grbsId).toBe('uo');
    expect(res.flags.length).toBeGreaterThanOrEqual(2);
    expect(res.disciplinaryPenalty).toBeLessThan(0);
  });
});
