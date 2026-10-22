/**
 * Страж подписи адреса и денег в двух разделах-новосёлах (21.08.2026).
 *
 * ЗАЧЕМ. Обе секции существуют ровно затем, чтобы у находки был адрес: какая
 * строка, что в ней, почему (канон п.119). Значит ломается раздел не тогда,
 * когда падает роут, а тогда, когда адрес тихо превращается в «строка 0» или в
 * пустой прочерк — читатель видит находку и не знает, куда идти. Здесь
 * охраняется именно эта граница: адреса нет — молчим честно, адрес есть —
 * называем его целиком, вместе с «№ п/п», который переживает сортировки листа.
 *
 * Разделитель разрядов русской локали — неразрывный пробел; в исходнике теста
 * он неотличим от обычного, поэтому сравнение идёт по разобранным частям, а не
 * по строке целиком: иначе тест врал бы о том, что именно он проверил.
 */
import { describe, expect, it } from 'vitest';
import { LEVEL_LABEL, SCALE_TITLE, addressText, fmtTys, scopedIntegrityTotals, type SequenceReportDto } from './contract';

/** Части подписи денег без оглядки на род пробела между разрядами. */
const moneyParts = (value: number): string[] => fmtTys(value).split(/\s+/u);

describe('адрес находки словами', () => {
  it('называет строку листа и «№ п/п» — второй адрес, переживающий сортировку', () => {
    expect(addressText(155, '39')).toBe('строка 155 (№ 39)');
  });

  it('без «№ п/п» называет одну строку листа, а не выдумывает номер', () => {
    expect(addressText(96, '')).toBe('строка 96');
    expect(addressText(96, '   ')).toBe('строка 96');
  });

  it('групповой признак адреса одной строки не получает — и молчит, а не пишет «строка 0»', () => {
    // 0 в ответе означает «признак про группу строк», null — «строки нет вовсе».
    expect(addressText(0, '39')).toBe('');
    expect(addressText(null, '39')).toBe('');
  });
});

describe('деньги под риском', () => {
  it('пишутся тысячами с группировкой разрядов по три', () => {
    expect(moneyParts(1234567)).toEqual(['1', '234', '567', 'тыс.', '₽']);
  });

  it('округляются до тысячи: копейки в разделе признаков ничего не решают', () => {
    expect(moneyParts(120.4)).toEqual(['120', 'тыс.', '₽']);
  });
});

describe('внутренние коды на экран не выходят (правила языка продукта)', () => {
  it('уровень аномалии назван по-русски у каждого рода', () => {
    for (const label of Object.values(LEVEL_LABEL)) {
      expect(label).toMatch(/[а-яё]/iu);
      expect(label).not.toMatch(/[A-Za-z_]/u);
    }
  });

  it('шкалы названы вопросом читателя, а не ключом', () => {
    expect(SCALE_TITLE.typo).toBe('Похоже на опечатку');
    expect(SCALE_TITLE.fitted).toBe('Похоже на подгон');
  });
});

describe('контроль: фильтр управления, охват и честная неизвестность', () => {
  const seq = (gap: number, dup: number): SequenceReportDto => ({
    rows: 10, countable: 10, numbered: 10, countableWithoutSeq: 0,
    coveragePct: 100, range: null, gaps: [], gapCount: gap,
    duplicates: Array.from({ length: dup }, (_, i) => ({
      rowSeq: String(i), sheetRows: [4, 5], subjects: ['A', 'B'],
    })),
    unnumbered: [], note: '',
  });
  it('не показывает районные нарушения внутри одного ГРБС', () => {
    const a = { sequence: seq(1, 2) };
    const b = { sequence: seq(9, 3) };
    expect(scopedIntegrityTotals([a, b])).toMatchObject({
      gapCount: 10, duplicates: 5, checkedBooks: 2, unreadBooks: 0,
    });
    expect(scopedIntegrityTotals([a])).toMatchObject({
      gapCount: 1, duplicates: 2, checkedBooks: 1, unreadBooks: 0,
    });
  });
  it('книги с неизвестной нумерацией исключены из знаменателя, но показаны', () => {
    expect(scopedIntegrityTotals([{ sequence: null }, { sequence: seq(0, 0) }])).toMatchObject({
      gapCount: 0, duplicates: 0, checkedBooks: 1, unreadBooks: 1,
    });
    expect(scopedIntegrityTotals([{ sequence: null }])).toMatchObject({
      checkedBooks: 0, unreadBooks: 1,
    });
  });
});
