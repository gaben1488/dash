import { describe, it, expect } from 'vitest';
import { threshold, thresholdAt, capturedThreshold } from '@aemr/shared';
import { checkEPContractLimits, checkAntiDumping, analyzeEPReasons } from './compliance-44fz';

/** Минимальная RowData (структурно совпадает с внутренним интерфейсом). */
function row(over: Partial<{
  rowIndex: number; method: string; planTotal: number; factTotal: number; economy: number; subject: string;
}>) {
  return { rowIndex: 1, method: 'ЕП', planTotal: 0, factTotal: 0, economy: 0, subject: 'закупка', ...over };
}

/** A recorded but not yet legally verified threshold, never an undated current setting. */
const savedScreening = thresholdAt('law.epSmallSingleContract', '2026-10-21');

// H5: сырое сравнение row.method === 'ЕП' минует normalizeMethod → алиасы ЕП
// («Ед. поставщик», «ЭЕП», «еп», «ЕП (ст.93)») молча выпадают из проверок.
describe('compliance-44fz — нормализация способа (алиасы ЕП)', () => {
  it('checkEPContractLimits ловит превышение по ЕП-алиасу «Ед. поставщик»', () => {
    const issues = checkEPContractLimits([row({ method: 'Ед. поставщик', planTotal: 50_000_000 })], 'УО', savedScreening);
    expect(issues).toHaveLength(1);
    expect(issues[0].ruleCode).toBe('ep_contract_limit');
    expect(issues[0].severity).toBe('info');
    expect(issues[0].description).toContain('превышение цены договора не доказано');
  });

  it('checkEPContractLimits — канонический ЕП по-прежнему ловится (без регресса)', () => {
    expect(checkEPContractLimits([row({ method: 'ЕП', planTotal: 50_000_000 })], 'УО', savedScreening)).toHaveLength(1);
  });

  it('analyzeEPReasons считает ЕП-алиасы (ЭЕП, еп, Ед. поставщик), но не конкурентные', () => {
    const rows = [
      row({ rowIndex: 1, method: 'ЭЕП', subject: 'монополия' }),
      row({ rowIndex: 2, method: 'еп', subject: 'образование' }),
      row({ rowIndex: 3, method: 'Ед. поставщик', subject: 'аренда имущества' }),
      row({ rowIndex: 4, method: 'ЭА', subject: 'конкурентная — не ЕП' }),
    ];
    expect(analyzeEPReasons(rows).total).toBe(3);
  });

  it('экономия и план не доказывают антидемпинг при любом способе', () => {
    const epAlias = checkAntiDumping([row({ method: 'Ед. поставщик', planTotal: 1_000_000, economy: 500_000 })], 'УО');
    expect(epAlias).toHaveLength(0); // ЕП-алиас исключён из антидемпинга
    const comp = checkAntiDumping([row({ method: 'ЭА', planTotal: 1_000_000, economy: 500_000 })], 'УО');
    expect(comp).toHaveLength(0); // НМЦК и предложенная цена отсутствуют
  });
});

describe('C06.02 — legal thresholds are frozen to the historical release', () => {
  it('does not consult today\'s statutory constant without a captured context', () => {
    expect(checkEPContractLimits([row({ planTotal: 750 })], 'УО')).toEqual([]);
    expect(checkEPContractLimits([row({ planTotal: 750 })], 'УО', {
      ...savedScreening, unit: 'percent',
    })).toEqual([]);
  });

  it('uses the exact dated captured edition, not the current registry value', () => {
    const historicalDefinition = { ...threshold('law.epSmallSingleContract')!, editions: [
      { id: 'fixture-older', validFrom: '2025-01-01', validUntil: '2026-07-01',
        value: 100, verification: 'verified' as const, sourceRef: 'synthetic legal fixture' },
      { id: 'fixture-newer', validFrom: '2026-07-01',
        value: 1_000, verification: 'verified' as const, sourceRef: 'synthetic legal fixture' },
    ] };
    const old = thresholdAt('law.epSmallSingleContract', '2026-06-30', historicalDefinition);
    const newer = thresholdAt('law.epSmallSingleContract', '2026-07-01', historicalDefinition);
    const source = [row({ planTotal: 750 })];
    expect(checkEPContractLimits(source, 'УО', old)).toHaveLength(1);
    expect(checkEPContractLimits(source, 'УО', newer)).toEqual([]);
    expect(old.unit).toBe('thousandRub');
    expect(old.source).toBe('law44');
    expect(checkEPContractLimits(source, 'УО', capturedThreshold({
      'law.epSmallSingleContract': old,
    }, 'law.epSmallSingleContract', 'thousandRub'))).toHaveLength(1);
  });
});
