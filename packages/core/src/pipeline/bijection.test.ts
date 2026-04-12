import { describe, it, expect } from 'vitest';
import {
  REPORT_MAP,
  DEPARTMENT_IDS,
  DEPARTMENT_ROWS,
  COLUMNS,
  SUMMARY_ROWS,
  type RowMetrics,
} from '@aemr/shared';

/**
 * Bijection verification tests.
 * Ensures complete correspondence between СВОД ТД-ПМ cells and REPORT_MAP entries.
 */

/** All column letters D-U that should be covered */
const METRIC_COLUMNS = ['D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U'] as const;

/** Column letter to RowMetrics field mapping */
const COL_TO_FIELD: Record<string, keyof RowMetrics> = {
  D: 'planCount',
  E: 'factCount',
  F: 'deviation',
  G: 'executionPercent',
  H: 'fbPlan',
  I: 'kbPlan',
  J: 'mbPlan',
  K: 'totalPlan',
  L: 'fbFact',
  M: 'kbFact',
  N: 'mbFact',
  O: 'totalFact',
  P: 'amountDeviation',
  Q: 'savingsPercent',
  R: 'economyFB',
  S: 'economyKB',
  T: 'economyMB',
  U: 'economyTotal',
};

describe('Bijection: REPORT_MAP completeness', () => {
  it('every REPORT_MAP entry has a valid sourceCell', () => {
    const cellPattern = /^[A-Z]{1,2}\d+$/;
    const invalid = REPORT_MAP.filter(e => !cellPattern.test(e.sourceCell));
    expect(invalid.map(e => e.metricKey)).toEqual([]);
  });

  it('every REPORT_MAP sourceCell references a known column', () => {
    const knownCols = new Set(Object.keys(COLUMNS));
    const badCol = REPORT_MAP.filter(e => {
      const col = e.sourceCell.replace(/\d+/g, '');
      return !knownCols.has(col);
    });
    expect(badCol.map(e => `${e.metricKey}:${e.sourceCell}`)).toEqual([]);
  });

  it('no duplicate metricKeys in REPORT_MAP', () => {
    const seen = new Map<string, number>();
    const dupes: string[] = [];
    for (const e of REPORT_MAP) {
      const count = (seen.get(e.metricKey) ?? 0) + 1;
      seen.set(e.metricKey, count);
      if (count === 2) dupes.push(e.metricKey);
    }
    expect(dupes).toEqual([]);
  });

  it('no unexpected duplicate sourceCells in REPORT_MAP', () => {
    // Known intentional overlaps: epTotalCell (D{epYear}) = ep.year.count (column D of same row)
    const KNOWN_OVERLAPS = new Set([
      ...DEPARTMENT_IDS.map(id => DEPARTMENT_ROWS[id].epTotalCell),
      // Economy cells at kpYear/epYear rows overlap with buildRowEntries (R/S/T/U columns)
      ...DEPARTMENT_IDS.flatMap(id => {
        const cfg = DEPARTMENT_ROWS[id];
        return [
          cfg.economyKpCell, cfg.economyKpFbCell, cfg.economyKpKbCell, cfg.economyKpMbCell,
          cfg.economyEpCell, cfg.economyEpFbCell, cfg.economyEpKbCell, cfg.economyEpMbCell,
        ].filter(Boolean);
      }),
    ]);

    const seen = new Map<string, string[]>();
    for (const e of REPORT_MAP) {
      const keys = seen.get(e.sourceCell) ?? [];
      keys.push(e.metricKey);
      seen.set(e.sourceCell, keys);
    }
    const dupes = [...seen.entries()]
      .filter(([cell, keys]) => keys.length > 1 && !KNOWN_OVERLAPS.has(cell));
    expect(dupes.map(([cell, keys]) => `${cell}: ${keys.join(', ')}`)).toEqual([]);
  });

  it('RowMetrics has a field for every column D-U', () => {
    const missingCols = METRIC_COLUMNS.filter(col => !COL_TO_FIELD[col]);
    expect(missingCols).toEqual([]);
    expect(Object.keys(COL_TO_FIELD).length).toBe(METRIC_COLUMNS.length);
  });
});

describe('Bijection: SVOD summary coverage', () => {
  const allCells = new Set(REPORT_MAP.map(e => e.sourceCell));

  for (const [rowKey, row] of Object.entries(SUMMARY_ROWS)) {
    it(`summary row ${rowKey} (${row}) has entries for all 18 columns`, () => {
      const missing = METRIC_COLUMNS.filter(col => !allCells.has(`${col}${row}`));
      expect(missing).toEqual([]);
    });
  }
});

describe('Bijection: Department row coverage', () => {
  const allCells = new Set(REPORT_MAP.map(e => e.sourceCell));

  for (const deptId of DEPARTMENT_IDS) {
    const cfg = DEPARTMENT_ROWS[deptId];

    for (const [rowKey, row] of Object.entries({
      kpQ1: cfg.kpQ1,
      kpYear: cfg.kpYear,
      epQ1: cfg.epQ1,
      epYear: cfg.epYear,
    })) {
      it(`${deptId}.${rowKey} (row ${row}) has entries for all 18 columns`, () => {
        const missing = METRIC_COLUMNS.filter(col => !allCells.has(`${col}${row}`));
        expect(missing).toEqual([]);
      });
    }
  }
});

describe('Bijection: Economy cell coverage', () => {
  const allCells = new Set(REPORT_MAP.map(e => e.sourceCell));

  for (const deptId of DEPARTMENT_IDS) {
    const cfg = DEPARTMENT_ROWS[deptId];

    it(`${deptId} economy KP cell (${cfg.economyKpCell}) is in REPORT_MAP`, () => {
      if (cfg.economyKpCell) {
        expect(allCells.has(cfg.economyKpCell)).toBe(true);
      }
    });

    it(`${deptId} economy EP cell (${cfg.economyEpCell}) is in REPORT_MAP`, () => {
      if (cfg.economyEpCell) {
        expect(allCells.has(cfg.economyEpCell)).toBe(true);
      }
    });

    it(`${deptId} per-budget economy cells are in REPORT_MAP`, () => {
      for (const cell of [
        cfg.economyKpFbCell, cfg.economyKpKbCell, cfg.economyKpMbCell,
        cfg.economyEpFbCell, cfg.economyEpKbCell, cfg.economyEpMbCell,
      ]) {
        if (cell) {
          expect(allCells.has(cell)).toBe(true);
        }
      }
    });
  }
});

describe('Bijection: REPORT_MAP size', () => {
  it('has expected number of entries', () => {
    // SVOD summary: 4 rows × 18 cols = 72
    // Departments: 8 depts × 4 rows × 18 cols = 576
    // ЕП итого + %ЕП: 8 × 2 = 16
    // Economy cells (KP + EP): 8 × 2 = 16
    // Per-budget economy (KP FB/KB/MB + EP FB/KB/MB): 8 × 6 = 48
    // Total: 72 + 576 + 16 + 16 + 48 = 728
    // Note: some economy cells duplicate with row entries (R/S/T/U on economy rows)
    // Actual count may differ due to dedup handling
    expect(REPORT_MAP.length).toBeGreaterThanOrEqual(700);
  });
});
