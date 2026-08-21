/**
 * Стражи отпечатка листа.
 *
 * Отпечаток решает, будет ли вообще перечитан снимок и уйдёт ли событие в
 * прямой эфир. Ошибка в любую сторону дорога: ложное «совпало» прячет правку
 * от читателя, ложное «не совпало» гоняет пересборку впустую.
 */
import { describe, expect, it } from 'vitest';
import { bookFingerprints, changedSheets, sheetFingerprint } from './sheet-fingerprint.js';

describe('отпечаток листа', () => {
  it('совпадает для одинаковых чтений', () => {
    const a = [['№', 'Предмет'], [1, 'Ремонт кровли'], [2, 'Поставка мебели']];
    const b = [['№', 'Предмет'], [1, 'Ремонт кровли'], [2, 'Поставка мебели']];
    expect(sheetFingerprint(a)).toBe(sheetFingerprint(b));
  });

  it('расходится, если изменилась одна ячейка', () => {
    const before = [['№', 'Предмет'], [1, 'Ремонт кровли']];
    const after = [['№', 'Предмет'], [1, 'Ремонт фасада']];
    expect(sheetFingerprint(before)).not.toBe(sheetFingerprint(after));
  });

  it('расходится, если строка добавлена', () => {
    const before = [[1, 'Ремонт']];
    const after = [[1, 'Ремонт'], [2, 'Поставка']];
    expect(sheetFingerprint(before)).not.toBe(sheetFingerprint(after));
  });

  it('различает сдвиг значения между колонками', () => {
    expect(sheetFingerprint([['а', 'б']])).not.toBe(sheetFingerprint([['аб', '']]));
  });

  it('различает перестановку строк', () => {
    expect(sheetFingerprint([['а'], ['б']])).not.toBe(sheetFingerprint([['б'], ['а']]));
  });

  it('различает число и текст с тем же начертанием только по содержанию ячейки', () => {
    // Сервер читает лист в UNFORMATTED_VALUE: 1 и «1» приходят разными типами,
    // но для сравнения содержимого это одно и то же значение — важно, что
    // отпечаток не падает и остаётся устойчивым.
    expect(sheetFingerprint([[1]])).toBe(sheetFingerprint([['1']]));
  });

  it('различает пустую книгу и отсутствие чтения', () => {
    expect(sheetFingerprint([])).not.toBe(sheetFingerprint(null));
  });

  it('различает пустую ячейку и дописанную пустую колонку', () => {
    expect(sheetFingerprint([['а']])).not.toBe(sheetFingerprint([['а', null]]));
  });

  it('устойчив на листе из тысяч строк', () => {
    const grid = Array.from({ length: 3000 }, (_, i) => [i, `Закупка ${i}`, i * 1000]);
    const same = Array.from({ length: 3000 }, (_, i) => [i, `Закупка ${i}`, i * 1000]);
    expect(sheetFingerprint(grid)).toBe(sheetFingerprint(same));
    same[2999] = [2999, 'Закупка 2999', 1];
    expect(sheetFingerprint(grid)).not.toBe(sheetFingerprint(same));
  });
});

describe('какие листы изменились', () => {
  it('на первом чтении не объявляет изменившимся ничего', () => {
    const after = bookFingerprints({ 'УО': [['а']], 'УД': [['б']] });
    expect(changedSheets(null, after)).toEqual([]);
    expect(changedSheets({}, after)).toEqual([]);
  });

  it('называет только изменившийся лист', () => {
    const before = bookFingerprints({ 'УО': [['а']], 'УД': [['б']] });
    const after = bookFingerprints({ 'УО': [['а']], 'УД': [['в']] });
    expect(changedSheets(before, after)).toEqual(['УД']);
  });

  it('считает изменением исчезновение листа', () => {
    const before = bookFingerprints({ 'УО': [['а']], 'УД': [['б']] });
    const after = bookFingerprints({ 'УО': [['а']] });
    expect(changedSheets(before, after)).toEqual(['УД']);
  });

  it('молчит, когда книга прочитана заново и совпала', () => {
    const before = bookFingerprints({ 'УО': [['а'], ['б']] });
    const after = bookFingerprints({ 'УО': [['а'], ['б']] });
    expect(changedSheets(before, after)).toEqual([]);
  });
});
