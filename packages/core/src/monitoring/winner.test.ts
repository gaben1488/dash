/**
 * winner.test.ts — составная ячейка «Победитель» (спека §1.1).
 *
 * В одной ячейке живут три разные вещи: наименование поставщика, его ИНН и —
 * вместо них — исход процедуры. Живые формы книги: перевод строки «\n» (340
 * ячеек), пара «\r\n» (семь), повторённый ИНН (одна), наименование без ИНН
 * (27), текст исхода (21).
 */
import { describe, expect, it } from 'vitest';
import { normalizeSupplierName, parseWinnerCell, supplierKey } from './winner.js';

describe('parseWinnerCell', () => {
  it('разбирает имя и ИНН организации из десяти цифр', () => {
    const w = parseWinnerCell('ООО «АТС»\nИНН 4100022887');
    expect(w).toMatchObject({ name: 'ООО «АТС»', inn: '4100022887', outcome: 'supplier' });
  });

  it('двенадцатизначный ИНН предпринимателя не обрезается до десяти', () => {
    const w = parseWinnerCell('ИП ДОЙНЯК-НОВЫЙ ДМИТРИЙ ОЛЕГОВИЧ\nИНН 541003717453');
    expect(w.inn).toBe('541003717453');
    // Хвост из двух цифр не должен приклеиваться к наименованию.
    expect(w.name).toBe('ИП ДОЙНЯК-НОВЫЙ ДМИТРИЙ ОЛЕГОВИЧ');
  });

  it('пара «\\r\\n» из чужой вставки читается так же, как обычный перевод строки', () => {
    const w = parseWinnerCell('ООО «БИТ»\r\nИНН 4101100000');
    expect(w).toMatchObject({ name: 'ООО «БИТ»', inn: '4101100000' });
  });

  it('повторённый ИНН помечается признаком, а не удваивает поставщика', () => {
    const w = parseWinnerCell('ИП Иванов\nИНН 410100000011 ИНН 410100000011');
    expect(w.inn).toBe('410100000011');
    expect(w.innRepeated).toBe(true);
  });

  it('исход процедуры не выдаётся за поставщика', () => {
    const notHeld = parseWinnerCell('Не состоялся (0 заявок)');
    expect(notHeld).toMatchObject({ outcome: 'not_held', name: null });
    expect(notHeld.outcomeText).toBe('Не состоялся (0 заявок)');

    const repeat = parseWinnerCell('Размещение повторное (не прошёл контроль в УФК)');
    expect(repeat.outcome).toBe('repeat_placement');
  });

  it('наименование без ИНН остаётся поставщиком: ИНН просто не проставили', () => {
    const w = parseWinnerCell('ООО «Эксклюзив СТ»');
    expect(w).toMatchObject({ outcome: 'supplier', inn: null, name: 'ООО «Эксклюзив СТ»' });
  });

  it('пустая ячейка — отдельный исход «итога нет», а не отсутствие разбора', () => {
    expect(parseWinnerCell('')).toMatchObject({ outcome: 'empty', raw: '' });
    expect(parseWinnerCell(null).outcome).toBe('empty');
  });

  it('сырое написание сохраняется целиком — экран показывает книгу как есть', () => {
    const w = parseWinnerCell('ООО «АТС»\nИНН 4100022887');
    expect(w.raw).toBe('ООО «АТС»\nИНН 4100022887');
  });
});

describe('supplierKey — разрез «по победителю» ведётся по ИНН', () => {
  it('одно лицо в двух написаниях даёт один ключ', () => {
    const a = parseWinnerCell('ООО "БИТ"\nИНН 4101100000');
    const b = parseWinnerCell('ООО «БИТ»\nИНН 4101100000');
    expect(supplierKey(a)).toBe(supplierKey(b));
  });

  it('без ИНН ключ строится по нормализованному имени и об этом сказано в самом ключе', () => {
    const key = supplierKey(parseWinnerCell('ООО «Эксклюзив СТ»'));
    expect(key).toBe('имя:ооо эксклюзив ст');
  });

  it('исход процедуры ключа не получает — в разрез поставщиков он не идёт', () => {
    expect(supplierKey(parseWinnerCell('Не состоялся (0 заявок)'))).toBeNull();
    expect(supplierKey(parseWinnerCell(''))).toBeNull();
  });

  it('нормализация снимает регистр, кавычки и «ё»', () => {
    expect(normalizeSupplierName('ООО «Тёплый Дом», г. Елизово'))
      .toBe('ооо теплый дом г елизово');
  });
});
