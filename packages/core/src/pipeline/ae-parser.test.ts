import { describe, it, expect } from 'vitest';
import { parseAE } from './ae-parser.js';

describe('parseAE — дата контракта/выплаты в комментарии', () => {
  it('находит dd.mm.yyyy', () => {
    const r = parseAE('01.02.2026 заключен контракт №17');
    expect(r.hasContractDate).toBe(true);
    expect(r.dates).toContain('01.02.2026');
  });

  it('находит dd.mm.yy (2-значный год, напр. «26.01.26»)', () => {
    const r = parseAE('заключен 26.01.26');
    expect(r.hasContractDate).toBe(true);
  });

  it('нет даты — hasContractDate false', () => {
    const r = parseAE('приобретение канцелярских товаров');
    expect(r.hasContractDate).toBe(false);
  });

  it('пустой/невалидный ввод безопасен', () => {
    expect(parseAE('').hasContractDate).toBe(false);
    expect(parseAE(null).hasContractDate).toBe(false);
    expect(parseAE(undefined).hasContractDate).toBe(false);
  });
});

describe('parseAE — правовое основание ЕП', () => {
  it('находит «п.4 ч.1 ст.93»', () => {
    const r = parseAE('Не учитывается по п.4 ч.1 ст.93, оплачивается из МП');
    expect(r.hasLegalBasis).toBe(true);
  });

  it('находит «ст. 93»', () => {
    expect(parseAE('закупка по ст. 93').hasLegalBasis).toBe(true);
  });

  it('находит монополию', () => {
    expect(parseAE('МОНОПОЛИСТ').hasLegalBasis).toBe(true);
  });

  it('обычный предмет — нет основания', () => {
    expect(parseAE('поставка офисной бумаги').hasLegalBasis).toBe(false);
  });
});
