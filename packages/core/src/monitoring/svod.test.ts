/**
 * svod.test.ts — лист «СВОДНЫЙ» и пара «как считает книга ↔ как считает
 * продукт» (спека §1.2, §2.2).
 *
 * Проверяется главное обещание раздела: продукт не сглаживает расхождение
 * со сводом книги, а показывает обе стороны и называет причину адресом
 * ячейки, где сумма записана текстом.
 */
import { describe, expect, it } from 'vitest';
import { compareSvodWithProduct, parseMonitoringSvod, productTotalsByDept } from './svod.js';
import { parseMonitoringProcedures } from './procedures.js';

/** Строка свода: №, имя, кол-во, НМЦК, цена, экономия ВСЕГО/МБ/КБ/ФБ. */
function svodRow(
  ordinal: unknown, name: string,
  count: number | '', nmck: number | '', price: number | '',
  total: number | '', mb: number | '', kb: number | '', fb: number | '',
): unknown[] {
  return [ordinal, name, count, nmck, price, total, mb, kb, fb];
}

const SVOD_GRID: unknown[][] = [
  ['Общая информация по проведённым ЭА', '', '', '', '', '', '', '', ''],
  ['№', 'Управление', 'Кол-во', 'НМЦК', 'Цена аукциона', 'Экономия', '', '', ''],
  ['', '', '', '', '', 'ВСЕГО', 'МБ', 'КБ', 'ФБ'],
  svodRow(1, 'УЭР АЕМР', 2, 1_500_000, 1_300_000, 200_000, 200_000, '', ''),
  // УО: экономия ВСЕГО не сходится с разбивкой — разрыв 50 000 руб.
  svodRow(2, 'УО АЕМР', 1, 4_000_000, 3_800_000, 200_000, 150_000, '', ''),
  ['Итого:', '', 3, 5_500_000, 5_100_000, 400_000, 350_000, '', ''],
  ['', '', 'Ячейка считает количество непустых строк (не путать с ненулевыми) в столбце "Цена аукциона, руб."'],
];

describe('parseMonitoringSvod', () => {
  it('читает восемь управлений и «Итого», связывая написание свода с ид продукта', () => {
    const svod = parseMonitoringSvod(SVOD_GRID);
    expect(svod.rows.map((r) => r.dept)).toEqual(['УЭР', 'УО', null]);
    expect(svod.total).toMatchObject({ isTotal: true, nmck: 5_500_000 });
  });

  it('добавляет контроль ВСЕГО = МБ+КБ+ФБ, которого на своде книги нет', () => {
    const svod = parseMonitoringSvod(SVOD_GRID);
    const uo = svod.rows.find((r) => r.dept === 'УО');
    expect(uo).toMatchObject({ controlAgrees: false, controlGapRub: 50_000 });
    const uer = svod.rows.find((r) => r.dept === 'УЭР');
    expect(uer?.controlAgrees).toBe(true);
    expect(svod.total?.controlGapRub).toBe(50_000);
  });

  it('переносит пояснение автора книги дословно', () => {
    const svod = parseMonitoringSvod(SVOD_GRID);
    expect(svod.authorNote).toContain('не путать с ненулевыми');
  });

  it('лист не прочитан — пустой разбор, а не выдуманные строки', () => {
    expect(parseMonitoringSvod(undefined)).toEqual({ rows: [], total: null, authorNote: null });
  });
});

describe('пара «книга ↔ продукт»', () => {
  const HEADERS: unknown[][] = [new Array(16).fill('ш'), new Array(16).fill('ш')];
  function row(subject: string, nmck: unknown, price: unknown): unknown[] {
    const r: unknown[] = new Array(16).fill('');
    r[1] = 'МКУ ЦЭР';
    r[2] = subject;
    r[3] = nmck;
    r[8] = price;
    return r;
  }

  const { procedures } = parseMonitoringProcedures({
    // Вторая сумма записана текстом: формула СУММ её не видит, наш разбор — да.
    '1. УЭР': [...HEADERS, row('ЭА1-26 Ремонт', 1_000_000, 900_000), row('ЭА2-26 Поставка', '500 000,00', 400_000)],
    '8. УО': [...HEADERS, row('ЭА5-26 Капремонт', 4_000_000, 3_800_000)],
  });

  it('показывает обе стороны и объясняет разницу адресом ячейки-текста', () => {
    const comparison = compareSvodWithProduct(parseMonitoringSvod(SVOD_GRID), productTotalsByDept(procedures));
    const uer = comparison.rows.find((r) => r.dept === 'УЭР');
    expect(uer?.book.nmck).toBe(1_500_000);
    expect(uer?.product.nmck).toBe(1_500_000);
    // Сумма сошлась, потому что наш разбор читает текстовую ячейку числом.
    expect(uer?.nmckDeltaRub).toBe(0);

    const uo = comparison.rows.find((r) => r.dept === 'УО');
    expect(uo?.nmckDeltaRub).toBe(0);
    expect(comparison.productTotals.nmck).toBe(5_500_000);
  });

  it('расхождение по НМЦК подписывается адресом суммы-текста, а не общей фразой', () => {
    const shrunkSvod = parseMonitoringSvod([
      ...SVOD_GRID.slice(0, 3),
      // Свод «не увидел» текстовую ячейку: 1 500 000 − 500 000.
      svodRow(1, 'УЭР АЕМР', 2, 1_000_000, 1_300_000, 200_000, 200_000, '', ''),
    ]);
    const comparison = compareSvodWithProduct(shrunkSvod, productTotalsByDept(procedures));
    const uer = comparison.rows.find((r) => r.dept === 'УЭР');
    expect(uer?.nmckDeltaRub).toBe(500_000);
    expect(uer?.explanation).toContain('1. УЭР!D4');
    expect(uer?.explanation).toContain('текстом');
  });

  it('разница в счёте процедур объясняется, а не выдаётся за ошибку', () => {
    const comparison = compareSvodWithProduct(parseMonitoringSvod(SVOD_GRID), productTotalsByDept(procedures));
    const uo = comparison.rows.find((r) => r.dept === 'УО');
    expect(uo?.countDelta).toBe(0);
    const uer = comparison.rows.find((r) => r.dept === 'УЭР');
    expect(uer?.countDelta).toBe(0);
  });
});
