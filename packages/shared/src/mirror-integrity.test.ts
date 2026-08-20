import { describe, expect, it } from 'vitest';
import { checkMirrorIntegrity, type MirrorBook, type MirrorRow } from './mirror-integrity.js';

const row = (o: Partial<MirrorRow> & { rowSeq: string; sheetRow: number }): MirrorRow => ({
  subordinate: 'МБОУ «Елизовская средняя школа № 7»',
  subject: 'Теплоснабжение',
  planSum: 15678.53,
  ...o,
});

describe('целостность зеркал книги', () => {
  it('исправная книга: строка в строку, расхождений нет', () => {
    const book: MirrorBook = {
      all: [row({ rowSeq: '100', sheetRow: 120 })],
      sheets: { 'МБОУ школа № 7': [row({ rowSeq: '100', sheetRow: 12 })] },
    };
    const r = checkMirrorIntegrity(book);
    expect(r.findings).toEqual([]);
    expect(r.matched).toBe(1);
    expect(r.note).toContain('исправны');
  });

  it('зеркало оборвалось: строка есть в общем листе, у учреждения нет', () => {
    // Живой случай школы № 7 (19.08.2026): 66 строк с номерами 212–302 в общий
    // лист попали, на лист школы — нет; крупнейшая из них — теплоснабжение.
    const book: MirrorBook = {
      all: [row({ rowSeq: '214', sheetRow: 214 })],
      sheets: { 'МБОУ школа № 7': [] },
    };
    const r = checkMirrorIntegrity(book);
    expect(r.findings).toHaveLength(1);
    const f = r.findings[0];
    expect(f.kind).toBe('missing-in-sheet');
    expect(f.mechanism).toContain('не отражена ни на одном листе');
    expect(f.action).toContain('протянуть формулы');
    expect(f.addresses).toEqual(['ВСЕ!A214']);
    expect(f.planSum).toBe(15678.53);
  });

  it('строка живёт только у учреждения — свод её не считает', () => {
    const book: MirrorBook = {
      all: [],
      sheets: { 'МБДОУ ДС № 5': [row({ rowSeq: '900', sheetRow: 40, planSum: 120 })] },
    };
    const f = checkMirrorIntegrity(book).findings[0];
    expect(f.kind).toBe('missing-in-all');
    expect(f.mechanism).toContain('Свод района');
    expect(f.addresses).toEqual(['МБДОУ ДС № 5!A40']);
  });

  it('номер совпал, сумма разошлась — формула заменена ручным значением', () => {
    // Живой случай: № 2283, 18,27 против 18,28 — расхождение в копейку.
    const book: MirrorBook = {
      all: [row({ rowSeq: '2283', sheetRow: 1981, planSum: 18.28, subject: 'Кухонный инвентарь' })],
      sheets: { 'МБОУ школа № 3': [row({ rowSeq: '2283', sheetRow: 98, planSum: 18.27 })] },
    };
    const f = checkMirrorIntegrity(book).findings[0];
    expect(f.kind).toBe('plan-mismatch');
    expect(f.mechanism).toContain('18.27');
    expect(f.mechanism).toContain('18.28');
    expect(f.addresses).toHaveLength(2);
  });

  it('копеечная разница в пределах допуска расхождением не считается', () => {
    const book: MirrorBook = {
      all: [row({ rowSeq: '1', sheetRow: 5, planSum: 10.001 })],
      sheets: { 'Лист': [row({ rowSeq: '1', sheetRow: 2, planSum: 10 })] },
    };
    expect(checkMirrorIntegrity(book).findings).toEqual([]);
  });

  it('один номер на двух листах учреждений — адрес перестал быть однозначным', () => {
    // Живой случай: 33 номера общих у «Ромашки» и «Радуги».
    const book: MirrorBook = {
      all: [row({ rowSeq: '783', sheetRow: 800 })],
      sheets: {
        'МБДОУ ДС № 5 «Ромашка»': [row({ rowSeq: '783', sheetRow: 30 })],
        'МБДОУ ДС № 10 «Радуга»': [row({ rowSeq: '783', sheetRow: 44 })],
      },
    };
    const r = checkMirrorIntegrity(book);
    const dup = r.findings.find((f) => f.kind === 'duplicate-across-sheets');
    expect(dup).toBeDefined();
    expect(dup!.addresses).toEqual(['МБДОУ ДС № 5 «Ромашка»!A30', 'МБДОУ ДС № 10 «Радуга»!A44']);
    expect(dup!.mechanism).toContain('однозначной');
  });

  it('строки без номера считаются отдельно и объявляются вслух', () => {
    const book: MirrorBook = {
      all: [row({ rowSeq: '', sheetRow: 7 }), row({ rowSeq: '5', sheetRow: 8 })],
      sheets: { 'Лист': [row({ rowSeq: '5', sheetRow: 3 }), row({ rowSeq: '  ', sheetRow: 4 })] },
    };
    const r = checkMirrorIntegrity(book);
    expect(r.unkeyed).toEqual({ all: 1, sheets: 1 });
    expect(r.note).toContain('без номера по порядку');
  });

  it('разбор идёт от крупных денег', () => {
    const book: MirrorBook = {
      all: [
        row({ rowSeq: '1', sheetRow: 10, planSum: 5 }),
        row({ rowSeq: '2', sheetRow: 11, planSum: 5000 }),
        row({ rowSeq: '3', sheetRow: 12, planSum: 500 }),
      ],
      sheets: {},
    };
    expect(checkMirrorIntegrity(book).findings.map((f) => f.rowSeq)).toEqual(['2', '3', '1']);
  });

  it('пустая книга не ломает проверку', () => {
    const r = checkMirrorIntegrity({ all: [], sheets: {} });
    expect(r.findings).toEqual([]);
    expect(r.totals).toEqual({ all: 0, sheets: 0, sheetCount: 0 });
  });
});
