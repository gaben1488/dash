/**
 * Стражи ответа по сигналу. Проверяются обещания, а не форма разбора: адрес
 * ячейки и адрес строки — обе законные формы продукта, чужая книга ГРБС не
 * должна притворяться ненайденной строкой, а найденная строка обязана быть
 * ТОЙ САМОЙ (лист и номер вместе, а не номер сам по себе: в книге УО нумерация
 * идёт дважды, и совпадение по одному номеру — не совпадение).
 */
import { describe, expect, it } from 'vitest';
import type { RegistryProcedure } from './contract';
import {
  addressKey, answerForAddress, indexByAddress, parseSignalAddress,
} from './signal-answer';

function proc(sheet: string, row: number, code: string): RegistryProcedure {
  return { sheet, row, code, customer: 'МБОУ СОШ № 1', subject: 'Ремонт' } as RegistryProcedure;
}

describe('разбор адреса сигнала', () => {
  it('читает адрес ячейки ядра', () => {
    expect(parseSignalAddress('8. УО!D34')).toEqual({ sheet: '8. УО', row: 34, column: 'D' });
  });

  it('читает адрес строки, найденной экраном', () => {
    expect(parseSignalAddress('8. УО · строка 34')).toEqual({ sheet: '8. УО', row: 34 });
  });

  it('чужую книгу ГРБС за адрес реестра не принимает', () => {
    expect(parseSignalAddress('УО:412')).toBeNull();
    expect(parseSignalAddress('МБОУ СОШ № 1')).toBeNull();
  });
});

describe('ответ по адресу', () => {
  const rows = [proc('8. УО', 34, 'ЭА152-26'), proc('1. УЭР', 34, 'ЭА901-26')];
  const index = indexByAddress(rows);

  it('находит строку по листу и номеру вместе, а не по номеру', () => {
    const a = answerForAddress('8. УО!D34', index);
    expect(a.kind).toBe('row');
    expect(a.procedure?.code).toBe('ЭА152-26');

    const b = answerForAddress('1. УЭР · строка 34', index);
    expect(b.procedure?.code).toBe('ЭА901-26');
  });

  it('различает «адрес не про реестр» и «строки на листе нет»', () => {
    expect(answerForAddress('УО:412', index).kind).toBe('not-registry');
    expect(answerForAddress('8. УО!D999', index).kind).toBe('row-missing');
  });

  it('ключ указателя один и тот же с обеих сторон', () => {
    expect(addressKey(' 8. УО ', 34)).toBe(addressKey('8. УО', 34));
  });
});
