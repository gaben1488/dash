import { describe, expect, it } from 'vitest';
import { unifiedKey, type DataSnapshot, type NormalizedMetric } from '@aemr/shared';
import { attachUnifiedGrid } from './snapshot.js';

/**
 * Тест формы Task 5: attachUnifiedGrid строит unifiedGrid + unifiedReconciliation
 * из sheetRows (карта имя-листа → строки) и кладёт их в snapshot.
 *
 * Проверяем именно server-склейку (не ядро):
 *  - имя dept-листа маппится в grbsId (Cyrillic 'УО' → 'uo' через CYRILLIC_TO_LATIN);
 *  - лист СВОД ТД-ПМ исключается из атомов сетки;
 *  - сверка (срез ВСЕ) сравнивается с ячейками officialMetrics (competitive/sole, 1 кв/Год).
 */

// Атом dept-листа: плоский массив колонок (0-based по канону).
function row(o: Partial<Record<number, unknown>>): unknown[] {
  const r = new Array(30).fill('');
  for (const k of Object.keys(o)) r[Number(k)] = o[Number(k) as unknown as keyof typeof o];
  return r;
}

const metric = (numericValue: number): NormalizedMetric =>
  ({ numericValue } as unknown as NormalizedMetric);

function baseSnapshot(officialMetrics: Record<string, NormalizedMetric>): DataSnapshot {
  return {
    id: 'test',
    spreadsheetId: 'test',
    createdAt: new Date().toISOString(),
    officialMetrics,
    calculatedMetrics: {},
    deltas: [],
    issues: [],
    trust: { overall: 0, grade: 'F', components: {} } as unknown as DataSnapshot['trust'],
    rowCount: 0,
    metadata: { sheetsRead: [], cellsRead: 0, readDurationMs: 0, pipelineDurationMs: 0 },
  };
}

describe('attachUnifiedGrid (server Task 5 wiring)', () => {
  // Два КП-атома 1 кв/2026 в листе 'УО': ПМ (план ФБ 100) + ТД (план ФБ 30).
  const sheetRows: Record<string, unknown[][]> = {
    'УО': [
      row({ 0: '1', 3: 'Программа A', 5: 'Программное мероприятие', 6: 'Закупка X', 11: 'ЭА', 13: '2026-02-01', 14: 1, 15: 2026, 16: '2026-03-01', 7: 100, 21: 90, 25: 10, 29: 'да' }),
      row({ 0: '2', 3: 'X', 5: 'Текущая деятельность', 6: 'Закупка Y', 11: 'ЭА', 13: '2026-03-01', 14: 1, 15: 2026, 16: 'Х', 7: 30 }),
    ],
    // Лист СВОД ТД-ПМ должен быть исключён из атомов (иная раскладка) — кладём мусор.
    'СВОД ТД-ПМ': [row({ 0: 'IGNORED', 5: 'Программное мероприятие', 11: 'ЭА', 14: 1, 7: 999999 })],
  };

  it('кладёт unifiedGrid с ключами unifiedKey и держит ВСЕ = ПМ + ТД (1 кв, кол-во)', () => {
    const snap = baseSnapshot({});
    attachUnifiedGrid(snap, sheetRows, 2026);

    expect(snap.unifiedGrid).toBeDefined();
    const grid = snap.unifiedGrid!;
    // grbsId получен из Cyrillic-имени листа, СВОД исключён.
    expect(grid.grbsIds).toContain('uo');
    expect(grid.grbsIds).not.toContain('СВОД ТД-ПМ');
    expect(grid.grbsIds).not.toContain('свод тд-пм');

    // Срезов три (канон п.30: ТД-ПМ упразднён).
    const cell = (s: 'all' | 'pm' | 'td') => grid.cells[unifiedKey('uo', s, 'kp', 'q1')];
    expect(cell('all')?.planCount).toBe(2);
    expect((cell('pm')?.planCount ?? 0) + (cell('td')?.planCount ?? 0)).toBe(2);
    // Лист СВОД исключён: план ФБ среза ВСЕ = 100 + 30, без 999999.
    expect(cell('all')?.planFB).toBe(130);
  });

  it('строит unifiedReconciliation против ячеек officialMetrics (срез ВСЕ vs СВОД ТД-ПМ)', () => {
    // Официальная ячейка совпадает с расчётом (Δ=0 → ok); намеренное расхождение → high.
    const official: Record<string, NormalizedMetric> = {
      'competitive.q1.count': metric(2),          // совпадает → ok
      'competitive.q1.total_plan': metric(130),   // совпадает → ok
      'competitive.year.total_plan': metric(200), // расхождение ((130-200)/200 = -35%) → high
    };
    const snap = baseSnapshot(official);
    attachUnifiedGrid(snap, sheetRows, 2026);

    const recon = snap.unifiedReconciliation!;
    expect(Array.isArray(recon)).toBe(true);
    expect(recon.length).toBeGreaterThan(0);

    const byKey = Object.fromEntries(recon.map((r) => [r.key, r]));
    expect(byKey['competitive.q1.count']?.status).toBe('ok');
    expect(byKey['competitive.q1.count']?.calc).toBe(2);
    expect(byKey['competitive.q1.total_plan']?.status).toBe('ok');
    expect(byKey['competitive.year.total_plan']?.status).toBe('high');
    expect(byKey['competitive.year.total_plan']?.official).toBe(200);
    // Метрики без официальной ячейки (sole.*) не порождают строк сверки.
    expect(recon.every((r) => r.official != null)).toBe(true);
  });
});
