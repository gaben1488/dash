import { describe, it, expect } from 'vitest';
import { checkEPContractLimits, checkAntiDumping, analyzeEPReasons } from './compliance-44fz';

/** Минимальная RowData (структурно совпадает с внутренним интерфейсом). */
function row(over: Partial<{
  rowIndex: number; method: string; planTotal: number; factTotal: number; economy: number; subject: string;
}>) {
  return { rowIndex: 1, method: 'ЕП', planTotal: 0, factTotal: 0, economy: 0, subject: 'закупка', ...over };
}

// H5: сырое сравнение row.method === 'ЕП' минует normalizeMethod → алиасы ЕП
// («Ед. поставщик», «ЭЕП», «еп», «ЕП (ст.93)») молча выпадают из проверок.
describe('compliance-44fz — нормализация способа (алиасы ЕП)', () => {
  it('checkEPContractLimits ловит превышение по ЕП-алиасу «Ед. поставщик»', () => {
    const issues = checkEPContractLimits([row({ method: 'Ед. поставщик', planTotal: 50_000_000 })], 'УО');
    expect(issues).toHaveLength(1);
    expect(issues[0].ruleCode).toBe('ep_contract_limit');
  });

  it('checkEPContractLimits — канонический ЕП по-прежнему ловится (без регресса)', () => {
    expect(checkEPContractLimits([row({ method: 'ЕП', planTotal: 50_000_000 })], 'УО')).toHaveLength(1);
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

  it('checkAntiDumping исключает ЕП-алиас (антидемпинг только для конкурентных)', () => {
    const epAlias = checkAntiDumping([row({ method: 'Ед. поставщик', planTotal: 1_000_000, economy: 500_000 })], 'УО');
    expect(epAlias).toHaveLength(0); // ЕП-алиас исключён из антидемпинга
    const comp = checkAntiDumping([row({ method: 'ЭА', planTotal: 1_000_000, economy: 500_000 })], 'УО');
    expect(comp).toHaveLength(1); // конкурентная с экономией >25% — флаг
  });
});
