import { describe, it, expect } from 'vitest';
import { thresholdAt } from '@aemr/shared';

const EP_LIMIT = thresholdAt('law.epSmallSingleContract', '2026-10-22');
const ROLE_LIMIT = thresholdAt('competition.epRoleOperationalShare', '2026-10-22');
import {
  detectSplitting,
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
    const flags = detectSplitting(rows, EP_LIMIT);
    expect(flags).toHaveLength(1);
    expect(flags[0].indicator).toBe('splitting');
    expect(flags[0].score!).toBeGreaterThan(60);
    expect(flags[0].severity).toBe('high');
  });
  it('3 ЕП → не флагуется (нужно ≥5)', () => {
    const rows = Array.from({ length: 3 }, (_, i) =>
      row({ rowIndex: i + 1, planTotal: 550_000, subject: 'Канцтовары' }),
    );
    expect(detectSplitting(rows, EP_LIMIT)).toHaveLength(0);
  });
  it('конкурентные не учитываются (только ЕП)', () => {
    const rows = Array.from({ length: 10 }, (_, i) =>
      row({ rowIndex: i + 1, method: 'ЭА', planTotal: 550_000, subject: 'Канцтовары' }),
    );
    expect(detectSplitting(rows, EP_LIMIT)).toHaveLength(0);
  });
});

describe('anticorruption — ep_over_limit (#8)', () => {
  it('ЕП: большая плановая позиция — лишь справочный сигнал, не доказанный лимит договора', () => {
    const flags = detectEpOverLimit([row({ rowIndex: 1, method: 'Ед. поставщик', planTotal: 750_000 })], EP_LIMIT);
    expect(flags).toHaveLength(1);
    expect(flags[0].severity).toBe('low');
    expect(flags[0].message).toContain('превышение нормы не доказано');
    expect(flags[0].message).toContain('не подтверждена');
  });
  it('версия из снимка определяет число, но не доказывает применимость к договору', () => {
    const captured = { value: 800, unit: 'thousandRub' as const, status: 'verified' as const, edition: 'test', sourceRef: 'fixture' };
    expect(detectEpOverLimit([row({ method: 'ЕП', planTotal: 750 })], captured)).toHaveLength(0);
    const detected = detectEpOverLimit([row({ method: 'ЕП', planTotal: 801 })], captured);
    expect(detected).toHaveLength(1);
    expect(detected[0].message).toContain('применимость основания — нет');
  });
});

describe('anticorruption — annual share (#9) + concentration (#10 pluggable)', () => {
  it('доля ЕП > порога → флаг; ниже → нет', () => {
    const flags = detectAnnualEpShare(6_000_000, 10_000_000, 0.5);
    expect(flags).toHaveLength(1);
    expect(flags[0]).toMatchObject({ severity: 'low' });
    expect(flags[0].message).toContain('неподтверждённого внутреннего ориентира');
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
  it('missing historical references disable threshold-dependent flags, not rebase to today', () => {
    const rows = [row({ rowIndex: 1, method: 'ЕП', planTotal: 999 })];
    const result = detectAntiCorruption('uo', { rows, epTotal: 80, totalPlan: 100 });
    expect(result.flags.filter(f => f.indicator === 'ep_over_limit' || f.indicator === 'ep_annual_share')).toEqual([]);
    expect(result.unavailableIndicators.map(i => i.indicator)).toContain('ep_over_limit');
    expect(result.unavailableIndicators.map(i => i.indicator)).toContain('ep_annual_share');
    expect(detectEpOverLimit(rows, { ...EP_LIMIT, unit: undefined })).toEqual([]);
    expect(detectSplitting(rows, { ...EP_LIMIT, unit: 'ratio' })).toEqual([]);
  });

  it('detectAntiCorruption сохраняет сигналы без штрафа за неподтверждённые нарушения', () => {
    const rows = [
      ...Array.from({ length: 10 }, (_, i) =>
        row({ rowIndex: i + 1, method: 'ЕП', planTotal: 550_000, subject: 'Канцтовары' }),
      ),
      row({ rowIndex: 11, method: 'ЕП', planTotal: 750_000, subject: 'Ремонт кровли' }),
    ];
    const res = detectAntiCorruption('uo', { rows, epTotal: 6_000_000, totalPlan: 10_000_000, epShareThreshold: ROLE_LIMIT, epSingleThreshold: EP_LIMIT });
    expect(res.grbsId).toBe('uo');
    expect(res.flags.length).toBeGreaterThanOrEqual(2);
    expect(res.disciplinaryPenalty).toBe(0);
  });
});
