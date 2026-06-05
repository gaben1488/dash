import { describe, expect, it } from 'vitest';
import { recalculateFromRows } from './recalculate';

let idc = 0;
/** Минимальная валидная dept-строка (проходит classifyRow: метод+тип+деньги). */
function mkRow(f: string, method: string): unknown[] {
  idc++;
  const row: unknown[] = new Array(32).fill('');
  row[0] = String(idc);        // A id
  row[5] = f;                  // F тип деятельности
  row[6] = `Закупка ${idc}`;   // G предмет
  row[7] = 100;                // H ФБ план
  row[9] = 50;                 // J МБ план
  row[10] = 150;               // K ИТОГО план
  row[11] = method;            // L способ
  row[13] = '2026-03-15';      // N план-дата
  row[15] = 2026;              // P год
  row[16] = '2026-03-20';      // Q факт-дата
  row[21] = 100;               // V ФБ факт
  row[23] = 50;                // X МБ факт
  row[24] = 150;               // Y ИТОГО факт
  return row;
}

describe('recalculateFromRows — ось активности ТД/ПМ/ТД-ПМ (фильтр AN4)', () => {
  // 2 ПМ (ЕП+ЭА) + 2 ТД (ЕП+ЭА); первые 3 строки — заголовки (startRow=3).
  const rows: unknown[][] = [
    [], [], [],
    mkRow('Программное мероприятие', 'ЕП'),
    mkRow('Программное мероприятие', 'ЭА'),
    mkRow('Текущая деятельность', 'ЕП'),
    mkRow('Текущая деятельность', 'ЭА'),
  ];

  it('all (ТД-ПМ) — все строки (бэк-совместимое поведение по умолчанию)', () => {
    const m = recalculateFromRows(rows, 'УО', 3, 2026);
    expect(m.dataRowCount).toBe(4);
    expect(m.totalCompetitive).toBe(2);
    expect(m.totalEP).toBe(2);
  });

  it('pm — только программные мероприятия', () => {
    const m = recalculateFromRows(rows, 'УО', 3, 2026, 'pm');
    expect(m.dataRowCount).toBe(2);
    expect(m.totalCompetitive).toBe(1);
    expect(m.totalEP).toBe(1);
  });

  it('td — только текущая деятельность', () => {
    const m = recalculateFromRows(rows, 'УО', 3, 2026, 'td');
    expect(m.dataRowCount).toBe(2);
    expect(m.totalCompetitive).toBe(1);
    expect(m.totalEP).toBe(1);
  });
});
