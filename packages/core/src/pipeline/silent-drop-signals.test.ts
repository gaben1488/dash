/**
 * "No silent data loss" invariant (AGENTS.md carve-out) — two independent
 * pipeline paths currently drop rows / skip validation with zero signal:
 *
 *  - B-8: CalcEngine.compute() excludes rows that fail the classification
 *    filter (or are empty slots) from every metric, with no counter exposed.
 *  - validate.ts: validateData() skips ALL svod/department-scoped rules for
 *    a sheet that classifySheet() cannot recognize ('unknown' kind), with no
 *    issue/log recording that the skip happened.
 *
 * Both assertions below are RED against current calc-engine.ts / validate.ts.
 */
import { describe, it, expect } from 'vitest';
import { DEPT_COLUMNS } from '@aemr/shared';
import type { ClassifiedRow, NormalizedMetric, ReportMapEntry, ValidationRule } from '@aemr/shared';
import { CalcEngine, standardRowFilter } from './calc-engine.js';
import { validateData } from './validate.js';

const COL = DEPT_COLUMNS;

// ── B-8: CalcEngine dropped-row counter ────────────────────────────────

function makeGoodRow(id: string): unknown[] {
  const row: unknown[] = new Array(32).fill('');
  row[COL.ID] = id;
  row[COL.SUBJECT] = 'Закупка';
  row[COL.TYPE] = 'Текущая деятельность';
  row[COL.METHOD] = 'ЭА';
  row[COL.FB_PLAN] = 100;
  row[COL.PLAN_DATE] = '15.01.2025';
  row[COL.PLAN_QUARTER] = 1;
  row[COL.PLAN_YEAR] = 2025;
  return row;
}

function buildSheet(dataRows: unknown[][]): unknown[][] {
  const headers = [
    new Array(32).fill('Header1'),
    new Array(32).fill('Header2'),
    new Array(32).fill('Header3'),
  ];
  return [...headers, ...dataRows];
}

describe('CalcEngine.compute() — dropped-row signal (B-8)', () => {
  it('counts a malformed row rejected by standardRowFilter instead of letting it vanish silently', () => {
    // No ID, no subject, no method → standardRowFilter rejects it immediately (score 0).
    const malformedRow: unknown[] = new Array(32).fill('');
    const rows = buildSheet([makeGoodRow('1'), malformedRow, makeGoodRow('2')]);

    const grouped = new CalcEngine().compute(rows, standardRowFilter, 3, 2025);

    expect(grouped.rowCount).toBe(2); // only the two well-formed rows contribute to metrics
    // droppedRows does not exist on GroupedResults yet → undefined pre-fix, must be 1 post-fix.
    expect((grouped as unknown as { droppedRows: number }).droppedRows).toBe(1);
  });
});

// ── validate.ts: unclassified-sheet silent skip ────────────────────────

function makeRow(overrides: Partial<ClassifiedRow> & { cells?: Record<string, unknown> } = {}): ClassifiedRow {
  return {
    rowIndex: 5,
    sheet: 'Лист1', // not СВОД / not shdyu / not a known department → classifySheet() = 'unknown'
    classification: 'procurement',
    classificationConfidence: 0.9,
    classificationReasons: ['test'],
    cells: {},
    ...overrides,
  };
}

function makeRule(overrides: Partial<ValidationRule> = {}): ValidationRule {
  return {
    id: 'dept_only_rule',
    name: 'Dept Only Rule',
    description: 'A department-scoped rule',
    severity: 'error',
    origin: 'spreadsheet_rule',
    scope: 'department',
    params: {},
    check: () => ({ passed: false, message: 'should never run on an unclassified sheet' }),
    ...overrides,
  };
}

const EMPTY_METRICS = new Map<string, NormalizedMetric>();
const EMPTY_REPORT_MAP: ReportMapEntry[] = [];

describe('validateData() — unclassified-sheet silent skip', () => {
  it('signals when a sheet classifySheet() cannot recognize causes svod/department rules to be skipped', () => {
    const row = makeRow();
    const issues = validateData(EMPTY_METRICS, [row], [makeRule()], EMPTY_REPORT_MAP);

    // The department-scoped rule is (correctly) skipped — no false positive from it.
    expect(issues.some(i => i.category === 'dept_only_rule')).toBe(false);
    // But today validateData() emits NOTHING at all — the skip is invisible.
    // Post-fix it must emit exactly one signal issue about the unclassified sheet.
    const signalIssue = issues.find(i => i.category === 'unclassified_sheet');
    expect(signalIssue).toBeDefined();
    expect(signalIssue?.sheet).toBe('Лист1');
  });
});
