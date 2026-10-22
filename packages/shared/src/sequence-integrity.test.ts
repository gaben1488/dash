import { describe, expect, it } from 'vitest';
import { checkSequenceIntegrity, readProcurementSequence, type SequenceRow } from './sequence-integrity.js';

describe('procurement source address', () => {
  it('keeps composite and zero-prefixed labels distinct', () => {
    expect(['173', '173/1', '173/18', '00173'].map(readProcurementSequence))
      .toEqual(['173', '173/1', '173/18', '00173']);
    expect([94, '94.0', '94,00', ' 94 '].map(readProcurementSequence))
      .toEqual(['94', '94', '94', '94']);
  });

  it('does not invent an address from an invalid value', () => {
    for (const value of [null, undefined, '', 0, -1, 1.5, Infinity, {}, 'без номера',
      '0', '000/1', '173//1', '173/1/']) {
      expect(readProcurementSequence(value)).toBeNull();
    }
  });
});

const row = (o: Partial<SequenceRow> & { sheetRow: number; rowSeq: string }): SequenceRow => ({
  countable: true,
  subject: 'Поставка бумаги',
  planSum: 100,
  ...o,
});

describe('целостность нумерации рабочего листа', () => {
  it('сквозная нумерация без пропусков — тишина', () => {
    const r = checkSequenceIntegrity([
      row({ sheetRow: 4, rowSeq: '1' }),
      row({ sheetRow: 5, rowSeq: '2' }),
      row({ sheetRow: 6, rowSeq: '3' }),
    ]);
    expect(r.gapCount).toBe(0);
    expect(r.duplicates).toEqual([]);
    expect(r.countableWithoutSeq).toBe(0);
    expect(r.coveragePct).toBe(100);
    expect(r.note).toContain('Нумерация сквозная');
  });

  it('пропуски сворачиваются в отрезки и объясняются следом удалённой строки', () => {
    const r = checkSequenceIntegrity([
      row({ sheetRow: 4, rowSeq: '1' }),
      row({ sheetRow: 5, rowSeq: '5' }),
      row({ sheetRow: 6, rowSeq: '6' }),
      row({ sheetRow: 7, rowSeq: '9' }),
    ]);
    expect(r.gapCount).toBe(5);                       // 2, 3, 4 и 7, 8
    expect(r.gaps).toEqual([
      { from: 2, to: 4, count: 3 },
      { from: 7, to: 8, count: 2 },
    ]);
    expect(r.note).toContain('след');
    expect(r.range).toEqual({ min: 1, max: 9 });
  });

  it('повтор номера назван с обеими строками', () => {
    // Живой случай 19.08: у дорожного хозяйства № 39 в строках 47 и 67.
    const r = checkSequenceIntegrity([
      row({ sheetRow: 47, rowSeq: '39', subject: 'Содержание дорог' }),
      row({ sheetRow: 67, rowSeq: '39', subject: 'Уборка снега' }),
    ]);
    expect(r.duplicates).toHaveLength(1);
    expect(r.duplicates[0].sheetRows).toEqual([47, 67]);
    expect(r.note).toContain('однозначной');
  });

  it('число «531» и текст «531» — один адрес, а не два', () => {
    const r = checkSequenceIntegrity([
      row({ sheetRow: 10, rowSeq: '531' }),
      row({ sheetRow: 11, rowSeq: ' 531 ' }),
    ]);
    expect(r.duplicates).toHaveLength(1);
  });

  it('оба пути совпадают по нормализации 94,00 и 94, но сохраняют 00173 отдельно', () => {
    const report = checkSequenceIntegrity([
      row({ sheetRow: 4, rowSeq: '94' }),
      row({ sheetRow: 5, rowSeq: '94,00' }),
      row({ sheetRow: 6, rowSeq: '173' }),
      row({ sheetRow: 7, rowSeq: '00173' }),
      row({ sheetRow: 8, rowSeq: '173/1' }),
      row({ sheetRow: 9, rowSeq: '173/18' }),
    ]);
    expect(report.duplicates).toHaveLength(1);
    expect(report.duplicates[0]).toMatchObject({ rowSeq: '94', sheetRows: [4, 5] });
    expect(report.range).toEqual({ min: 94, max: 173 });
  });

  it('счётные строки без номера считаются и показываются от крупных денег', () => {
    const r = checkSequenceIntegrity([
      row({ sheetRow: 4, rowSeq: '1' }),
      row({ sheetRow: 5, rowSeq: '', planSum: 50, subject: 'Мелкая закупка' }),
      row({ sheetRow: 6, rowSeq: '', planSum: 5000, subject: 'Крупная закупка' }),
    ]);
    expect(r.countableWithoutSeq).toBe(2);
    expect(r.unnumbered[0].subject).toBe('Крупная закупка');
    expect(r.note).toContain('нет адреса');
  });

  it('несчётные строки без номера нарушением не считаются', () => {
    const r = checkSequenceIntegrity([
      row({ sheetRow: 4, rowSeq: '1' }),
      row({ sheetRow: 5, rowSeq: '', countable: false, subject: 'Итого по программе' }),
    ]);
    expect(r.countableWithoutSeq).toBe(0);
    expect(r.coveragePct).toBe(100);
  });

  it('нумерация почти не заполнена — говорим прямо, что адреса нет', () => {
    // Живой случай 19.08: у управления имущества номер есть у 70 строк из 989.
    const rows: SequenceRow[] = [];
    for (let i = 0; i < 70; i += 1) rows.push(row({ sheetRow: 4 + i, rowSeq: String(i + 1) }));
    for (let i = 0; i < 919; i += 1) rows.push(row({ sheetRow: 100 + i, rowSeq: '' }));
    const r = checkSequenceIntegrity(rows);
    expect(r.coveragePct).toBeLessThan(10);
    expect(r.note).toContain('как адрес нумерация');
  });

  it('ошибочно большой номер не расходует память пропорционально диапазону', () => {
    const r = checkSequenceIntegrity([
      row({ sheetRow: 4, rowSeq: '1' }),
      row({ sheetRow: 5, rowSeq: '100000000' }),
    ]);
    expect(r.gapCount).toBe(99999998);
    expect(r.gaps).toEqual([{ from: 2, to: 99999999, count: 99999998 }]);
  });

  it('составные номера остаются разными адресами', () => {
    const r = checkSequenceIntegrity([
      row({ sheetRow: 4, rowSeq: '173' }),
      row({ sheetRow: 5, rowSeq: '173/1' }),
      row({ sheetRow: 6, rowSeq: '173/2' }),
    ]);
    expect(r.duplicates).toEqual([]);
    expect(r.gapCount).toBe(0);
  });

  it('пустой лист не ломает проверку', () => {
    const r = checkSequenceIntegrity([]);
    expect(r).toMatchObject({ rows: 0, countable: 0, gapCount: 0, range: null, coveragePct: null });
  });
});
