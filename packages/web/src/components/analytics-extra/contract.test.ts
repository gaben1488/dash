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

describe('контроль пропавших: сводка соответствует видимому управлению', () => {
  const sequence = (gapCount: number, duplicateCount: number, countableWithoutSeq: number): SequenceReportDto => ({
    rows: 20,
    countable: 15,
    numbered: 15 - countableWithoutSeq,
    countableWithoutSeq,
    coveragePct: 100,
    range: null,
    gaps: [],
    gapCount,
    duplicates: Array.from({ length: duplicateCount }, (_, index) => ({
      rowSeq: String(index + 1), sheetRows: [4, 5], subjects: ['a', 'b'],
    })),
    unnumbered: [],
    note: '',
  });

  it('показывает только счётчики выбранных книг, не районный итог', () => {
    const uo = { sequence: sequence(3, 1, 2) };
    const ud = { sequence: sequence(9, 2, 4) };
    expect(scopedIntegrityTotals([uo, ud])).toEqual({
      gapCount: 12, duplicates: 3, countableWithoutSeq: 6,
    });
    expect(scopedIntegrityTotals([uo])).toEqual({
      gapCount: 3, duplicates: 1, countableWithoutSeq: 2,
    });
    expect(scopedIntegrityTotals([ud])).toEqual({
      gapCount: 9, duplicates: 2, countableWithoutSeq: 4,
    });
  });

  it('не считает непрочитанную книгу ни подтверждённым нулём, ни нарушением', () => {
    expect(scopedIntegrityTotals([{ sequence: null }, { sequence: sequence(2, 1, 3) }])).toEqual({
      gapCount: 2, duplicates: 1, countableWithoutSeq: 3,
    });
    expect(scopedIntegrityTotals([])).toEqual({
      gapCount: 0, duplicates: 0, countableWithoutSeq: 0,
    });
  });
});
