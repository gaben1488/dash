/**
 * Итоговый ярус листа СВОД — то, что лист считает сам, а продукт до
 * 29.07.2026 не читал ни разу: остаток к заключению, «ИТОГО» по скоупам,
 * доли КП/ЕП и «Расч. экономия» (та самая, что печатается в ручном отчёте).
 *
 * Геометрия фикстуры повторяет живой лист: подпись остатка в K2, блок
 * периодов, «ИТОГО …:» ЗАГЛАВНЫМИ (из-за регистра эти строки и были
 * невидимы), затем строки долей, где у района рядом стоит расч. экономия.
 */
import { describe, it, expect } from 'vitest';
import { parseSvodExtras } from './svod-grid.js';

/** Пустая строка листа нужной ширины. */
const empty = (): unknown[] => new Array(21).fill('');

function cell(row: unknown[], index: number, value: unknown): unknown[] {
  row[index] = value;
  return row;
}

/** Лист-фикстура: район «ВСЕ» и одно управление. */
function sheet(): unknown[][] {
  const rows: unknown[][] = [];
  rows.push(cell(empty(), 11, 'ФБ')); // строка 1 — шапка
  // строка 2: «Остаток к заключ.» в K, числа в L/M/N/O
  const r2 = empty();
  cell(r2, 10, 'Остаток к заключ.');
  cell(r2, 11, 86965.19);
  cell(r2, 12, 117518.12);
  cell(r2, 13, 90963.95);
  cell(r2, 14, 295447.27);
  rows.push(r2);
  // строки 3–6: заголовки секции
  rows.push(cell(cell(empty(), 0, 'ГРБС'), 3, 'ЭА, ЭЗК, ЭК и аналоги'));
  rows.push(empty());
  rows.push(empty());
  rows.push(empty());
  // строка 7: период района
  const r7 = empty();
  cell(r7, 0, 'ВСЕ'); cell(r7, 1, 1); cell(r7, 2, 2026); cell(r7, 3, 140); cell(r7, 4, 140);
  rows.push(r7);
  // строка 8: ИТОГО 2025+2026 — ЗАГЛАВНЫМИ, с двоеточием
  const r8 = empty();
  cell(r8, 0, 'ИТОГО 2025+2026:'); cell(r8, 3, 3355); cell(r8, 4, 2966); cell(r8, 10, 1849012.43);
  rows.push(r8);
  // строка 9: ИТОГО 2026
  const r9 = empty();
  cell(r9, 0, 'ИТОГО 2026:'); cell(r9, 3, 2823); cell(r9, 4, 2434);
  rows.push(r9);
  rows.push(empty()); // строка 10
  // строка 11: доля КП + заголовок расч. экономии
  const r11 = empty();
  cell(r11, 3, 'Доля ЭА, ЭЗК, ЭК и аналогов:'); cell(r11, 6, 0.537); cell(r11, 7, 0.6194);
  cell(r11, 12, 'Расч. экономия');
  rows.push(r11);
  // строка 12: доля ЕП + числа расч. экономии
  const r12 = empty();
  cell(r12, 3, 'Доля ЕП:'); cell(r12, 6, 0.463); cell(r12, 7, 0.3806);
  cell(r12, 12, 23635.78); cell(r12, 13, 6957.22); cell(r12, 14, 9401.45); cell(r12, 15, 7277.12);
  rows.push(r12);
  // строка 13: период управления
  const r13 = empty();
  cell(r13, 0, 'УЭР'); cell(r13, 1, 1); cell(r13, 2, 2026); cell(r13, 3, 15);
  rows.push(r13);
  // строка 14: ИТОГО управления
  const r14 = empty();
  cell(r14, 0, 'ИТОГО 2026:'); cell(r14, 3, 72); cell(r14, 4, 46);
  rows.push(r14);
  // строка 15: доля ЕП управления — без расч. экономии (её лист даёт только району)
  const r15 = empty();
  cell(r15, 3, 'Доля ЕП:'); cell(r15, 6, 0.198); cell(r15, 7, 0.2415);
  rows.push(r15);
  // строки 16–18: переключатель периметра в колонке X (индекс 23),
  // как на живом листе X36:X38 — подпись, значение, расшифровка.
  rows.push(cell(empty(), 23, '↓↓↓ ПЕРЕКЛЮЧАТЕЛЬ ↓↓↓'));
  rows.push(cell(empty(), 23, '*'));
  rows.push(cell(empty(), 23, '* = ТД + ПМ'));
  return rows;
}

describe('parseSvodExtras — ярус, который лист считает сам', () => {
  const x = parseSvodExtras(sheet());

  it('остаток к заключению читается из шапки листа с адресом строки', () => {
    expect(x.remainderToConclude).toEqual({
      fb: 86965.19, kb: 117518.12, mb: 90963.95, total: 295447.27, row: 2, cell: 'O2',
    });
  });

  it('«ИТОГО» ЗАГЛАВНЫМИ больше не теряется (из-за регистра пропадали 18 строк)', () => {
    const all = x.scopes.find((s) => s.scope === 'ВСЕ')!;
    expect(all.totalBothYears?.planCount).toBe(3355);
    expect(all.totalBothYears?.factCount).toBe(2966);
    expect(all.totalBothYears?.row).toBe(8);
    expect(all.totalY2026?.planCount).toBe(2823);
    expect(all.totalY2026?.row).toBe(9);
  });

  it('доли КП и ЕП: подписи по шапке листа — факт и план, не «за два года»', () => {
    const all = x.scopes.find((s) => s.scope === 'ВСЕ')!;
    expect(all.shareCompetitive).toEqual({ fact: 0.537, plan: 0.6194, row: 11 });
    expect(all.shareEp).toEqual({ fact: 0.463, plan: 0.3806, row: 12 });
  });

  it('расчётная экономия района — та самая строка ручного отчёта', () => {
    const all = x.scopes.find((s) => s.scope === 'ВСЕ')!;
    expect(all.calcEconomy).toEqual({
      total: 23635.78, fb: 6957.22, kb: 9401.45, mb: 7277.12, row: 12, cell: 'M12',
    });
    // Инвариант листа: сумма по бюджетам сходится с итогом. Допуск копеечный,
    // потому что в фикстуре числа живого листа округлены до сотых — на самом
    // листе они полные, и сумма там точная.
    const e = all.calcEconomy!;
    expect(Math.abs(e.fb + e.kb + e.mb - e.total)).toBeLessThan(0.02);
  });

  it('ярус управления читается отдельно от районного', () => {
    const uer = x.scopes.find((s) => s.scope === 'УЭР')!;
    expect(uer.totalY2026?.planCount).toBe(72);
    expect(uer.shareEp?.plan).toBe(0.2415);
    // Расч. экономии у управлений лист не считает — честно undefined, не ноль.
    expect(uer.calcEconomy).toBeUndefined();
  });

  it('скоупы идут в порядке листа: район, затем управления', () => {
    expect(x.scopes.map((s) => s.scope)).toEqual(['ВСЕ', 'УЭР']);
  });

  it('переключатель периметра X37 читается: снимок знает свой срез (№13)', () => {
    expect(x.perimeterSwitch).toEqual({ value: '*', row: 17 });
  });
});
