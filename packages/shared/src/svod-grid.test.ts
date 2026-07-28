import { describe, expect, it } from 'vitest';
import { parseSvodGrid, SVOD_GRID_COLS } from './svod-grid';

/**
 * Ре-реверс СВОД ТД-ПМ (16.07): лист содержит ВСЕ 4 квартала × 2 года + итоги
 * «2025+2026»/«2026» по каждому блоку ЭА|ЕП × (ВСЕ + 8 ГРБС) — старый report-map
 * мапил только 1 кв-2026 и годовой итог (~треть листа). parseSvodGrid — структурный
 * ридер: НЕ адресные ячейки, а сканер блоков (высота блоков РАЗНАЯ: у части ГРБС
 * нет строки 1 кв-2025). Структура-фикстура повторяет живой лист (проба 16.07).
 */

/** Строка листа шириной 21 (A..U). */
function row(cells: Record<string, unknown>): unknown[] {
  const r: unknown[] = new Array(21).fill('');
  const idx: Record<string, number> = { A: 0, B: 1, C: 2, D: 3, E: 4, F: 5, G: 6, H: 7, K: 10, O: 14, Q: 16, U: 20 };
  for (const [col, v] of Object.entries(cells)) r[idx[col]] = v;
  return r;
}

function buildSheet(): unknown[][] {
  const rows: unknown[][] = [];
  // стр.1-6: шапки (содержимое не важно ридеру, важны позиции данных)
  for (let i = 0; i < 2; i++) rows.push(row({}));
  rows.push(row({ A: 'ГРБС', B: 'Квартал', C: 'Год', D: 'ЭА, ЭЗК, ЭК и аналоги' }));
  for (let i = 0; i < 3; i++) rows.push(row({}));
  // Блок ЭА «ВСЕ»: 2 строки 2025, 4 строки 2026, два итога (как в живом листе 7-14)
  rows.push(row({ A: 'ВСЕ', B: 1, C: 2025, D: 2, E: 2, G: 1, K: 834.65, O: 834.65, U: 0 }));
  rows.push(row({ B: 4, C: 2025, D: 133, E: 133, G: 1, K: 332164.46, O: 297755.79, U: 19063.92 }));
  rows.push(row({ B: 1, C: 2026, D: 137, E: 137, G: 1, K: 284930.75, O: 248354.75, U: 29503.84 }));
  rows.push(row({ B: 2, C: 2026, D: 126, E: 121, G: 0.96, K: 172528.23, O: 155807.32, U: 6933.99 }));
  rows.push(row({ B: 3, C: 2026, D: 103, E: 37, G: 0.359, K: 413607.85, O: 117296.42, U: 1527.71 }));
  rows.push(row({ B: 4, C: 2026, D: 17, E: 1, G: 0.058, K: 73710.45, O: 50.46, U: 0 }));
  rows.push(row({ A: 'Итого ЭА 2025+2026', D: 518, E: 431, K: 1277776.4, O: 820099.42, U: 57029.48 }));
  rows.push(row({ A: 'Итого ЭА 2026', D: 383, E: 296, K: 944777.29, O: 521508.96, U: 37965.55 }));
  // Блок ЕП «ВСЕ» — заголовок + 1 строка 2025 (высота другая!) + 1 строка 2026 + итоги
  rows.push(row({ A: 'ГРБС', B: 'Квартал', C: 'Год', D: 'ЕП' }));
  for (let i = 0; i < 3; i++) rows.push(row({}));
  rows.push(row({ A: 'ВСЕ', B: 4, C: 2025, D: 393, E: 393, G: 1, K: 188097.79, O: 187078.26, U: 16.51 }));
  rows.push(row({ B: 1, C: 2026, D: 1314, E: 1314, G: 1, K: 378338.73, O: 375215.18, U: 1414.08 }));
  rows.push(row({ A: 'Итого ЕП 2025+2026', D: 2818, E: 2390, K: 688083.4, O: 629197.79, U: 1537.91 }));
  rows.push(row({ A: 'Итого ЕП 2026', D: 2421, E: 1993, K: 499765.99, O: 441899.92, U: 1521.4 }));
  // Блок ЭА «УЭР» — проверка ГРБС-скоупа
  rows.push(row({ A: 'ГРБС', B: 'Квартал', C: 'Год', D: 'ЭА, ЭЗК, ЭК и аналоги' }));
  rows.push(row({ A: 'УЭР', B: 1, C: 2026, D: 15, E: 6, G: 0.4, K: 100, O: 40, U: 1 }));
  rows.push(row({ A: 'Итого ЭА 2026', D: 15, E: 6, K: 100, O: 40, U: 1 }));
  return rows;
}

describe('parseSvodGrid — структурный ридер СВОД ТД-ПМ', () => {
  const blocks = parseSvodGrid(buildSheet());

  it('находит все блоки: ВСЕ×(КП,ЕП) + УЭР×КП', () => {
    expect(blocks.map(b => `${b.scope}:${b.method}`)).toEqual(['ВСЕ:КП', 'ВСЕ:ЕП', 'УЭР:КП']);
  });

  it('КП ВСЕ: все 6 период-строк с годом и кварталом', () => {
    const kp = blocks[0];
    expect(kp.periods.map(p => `${p.year}q${p.quarter}`)).toEqual(
      ['2025q1', '2025q4', '2026q1', '2026q2', '2026q3', '2026q4'],
    );
    const q3 = kp.periods.find(p => p.year === 2026 && p.quarter === 3)!;
    expect(q3.planCount).toBe(103);
    expect(q3.factCount).toBe(37);
    expect(q3.planTotal).toBeCloseTo(413607.85);
    expect(q3.factTotal).toBeCloseTo(117296.42);
    expect(q3.economyTotal).toBeCloseTo(1527.71);
    expect(q3.execPct).toBeCloseTo(0.359);
  });

  it('итоги блока: 2025+2026 и 2026 отдельно', () => {
    const kp = blocks[0];
    expect(kp.totalBothYears?.planCount).toBe(518);
    expect(kp.totalY2026?.planCount).toBe(383);
    expect(kp.totalY2026?.planTotal).toBeCloseTo(944777.29);
  });

  it('блоки разной высоты: ЕП ВСЕ имеет только 2 период-строки', () => {
    const ep = blocks[1];
    expect(ep.periods).toHaveLength(2);
    expect(ep.periods[0].year).toBe(2025);
    expect(ep.periods[0].quarter).toBe(4);
  });

  it('ГРБС-скоуп: УЭР q1-2026 читается', () => {
    const uer = blocks[2];
    expect(uer.scope).toBe('УЭР');
    expect(uer.periods[0].planCount).toBe(15);
    expect(uer.periods[0].factCount).toBe(6);
  });

  it('колонк-карта канонична (D=план-ед, K=план-итого, O=факт-итого, U=экономия-итого)', () => {
    expect(SVOD_GRID_COLS.planCount).toBe(3);
    expect(SVOD_GRID_COLS.planTotal).toBe(10);
    expect(SVOD_GRID_COLS.factTotal).toBe(14);
    expect(SVOD_GRID_COLS.economyTotal).toBe(20);
  });
});
