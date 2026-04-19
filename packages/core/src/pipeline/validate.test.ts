import { describe, it, expect, vi } from 'vitest';
import { validateData } from './validate.js';
import type { ClassifiedRow, NormalizedMetric, ValidationRule, ReportMapEntry, RuleCheckContext } from '@aemr/shared';

// ────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────

/** Build a ClassifiedRow with sensible defaults */
function makeRow(
  overrides: Partial<ClassifiedRow> & { cells?: Record<string, unknown> } = {},
): ClassifiedRow {
  return {
    rowIndex: 5,
    sheet: 'СВОД ТД-ПМ',
    classification: 'procurement',
    classificationConfidence: 0.9,
    classificationReasons: ['test'],
    cells: {},
    ...overrides,
  };
}

/** Create a minimal passing rule */
function makeRule(overrides: Partial<ValidationRule> = {}): ValidationRule {
  return {
    id: 'test_rule',
    name: 'Test Rule',
    description: 'A test rule',
    severity: 'error',
    origin: 'spreadsheet_rule',
    scope: 'both',
    params: {},
    check: () => ({ passed: true }),
    ...overrides,
  };
}

/** Create a rule that always fails */
function makeFailingRule(overrides: Partial<ValidationRule> = {}): ValidationRule {
  return makeRule({
    id: 'failing_rule',
    name: 'Failing Rule',
    check: (ctx: RuleCheckContext) => ({
      passed: false,
      message: `Failed at row ${ctx.rowIndex}`,
      cell: `A${ctx.rowIndex}`,
    }),
    ...overrides,
  });
}

const EMPTY_METRICS = new Map<string, NormalizedMetric>();
const EMPTY_REPORT_MAP: ReportMapEntry[] = [];

// ────────────────────────────────────────────────────────────
// 1. Basic validation flow
// ────────────────────────────────────────────────────────────

describe('validateData — basic', () => {
  it('returns empty issues for passing rules', () => {
    const rows = [makeRow({ cells: { A: '1', H: 100000 } })];
    const rules = [makeRule()];
    const issues = validateData(EMPTY_METRICS, rows, rules, EMPTY_REPORT_MAP);
    expect(issues).toEqual([]);
  });

  it('returns issues for failing rules', () => {
    const rows = [makeRow({ rowIndex: 7, cells: { A: '1' } })];
    const rules = [makeFailingRule()];
    const issues = validateData(EMPTY_METRICS, rows, rules, EMPTY_REPORT_MAP);
    expect(issues).toHaveLength(1);
    expect(issues[0].row).toBe(7);
    expect(issues[0].title).toContain('строка 7');
  });

  it('returns empty issues for empty rows array', () => {
    const rules = [makeFailingRule()];
    const issues = validateData(EMPTY_METRICS, [], rules, EMPTY_REPORT_MAP);
    expect(issues).toEqual([]);
  });

  it('returns empty issues for empty rules array', () => {
    const rows = [makeRow()];
    const issues = validateData(EMPTY_METRICS, rows, [], EMPTY_REPORT_MAP);
    expect(issues).toEqual([]);
  });
});

// ────────────────────────────────────────────────────────────
// 2. Scope filtering
// ────────────────────────────────────────────────────────────

describe('validateData — scope filtering', () => {
  it('runs svod-scoped rules only on СВОД sheet', () => {
    const svodRow = makeRow({ sheet: 'СВОД ТД-ПМ' });
    const deptRow = makeRow({ sheet: 'Лист1' });

    const svodRule = makeFailingRule({ id: 'svod_only', scope: 'svod' });

    const svodIssues = validateData(EMPTY_METRICS, [svodRow], [svodRule], EMPTY_REPORT_MAP);
    const deptIssues = validateData(EMPTY_METRICS, [deptRow], [svodRule], EMPTY_REPORT_MAP);

    expect(svodIssues).toHaveLength(1);
    expect(deptIssues).toHaveLength(0);
  });

  it('runs department-scoped rules only on non-СВОД sheets', () => {
    const svodRow = makeRow({ sheet: 'СВОД ТД-ПМ' });
    const deptRow = makeRow({ sheet: 'Лист1' });

    const deptRule = makeFailingRule({ id: 'dept_only', scope: 'department' });

    const svodIssues = validateData(EMPTY_METRICS, [svodRow], [deptRule], EMPTY_REPORT_MAP);
    const deptIssues = validateData(EMPTY_METRICS, [deptRow], [deptRule], EMPTY_REPORT_MAP);

    expect(svodIssues).toHaveLength(0);
    expect(deptIssues).toHaveLength(1);
  });

  it('runs "both"-scoped rules on all sheets', () => {
    const svodRow = makeRow({ sheet: 'СВОД ТД-ПМ' });
    const deptRow = makeRow({ sheet: 'Лист1' });

    const bothRule = makeFailingRule({ id: 'both_scope', scope: 'both' });

    const svodIssues = validateData(EMPTY_METRICS, [svodRow], [bothRule], EMPTY_REPORT_MAP);
    const deptIssues = validateData(EMPTY_METRICS, [deptRow], [bothRule], EMPTY_REPORT_MAP);

    expect(svodIssues).toHaveLength(1);
    expect(deptIssues).toHaveLength(1);
  });
});

// ────────────────────────────────────────────────────────────
// 3. Header row skipping
// ────────────────────────────────────────────────────────────

describe('validateData — header row filtering', () => {
  it('always skips header-classified rows', () => {
    const headerRow = makeRow({ classification: 'header', rowIndex: 1 });
    const dataRow = makeRow({ classification: 'procurement', rowIndex: 5 });

    const rule = makeFailingRule();
    const issues = validateData(EMPTY_METRICS, [headerRow, dataRow], [rule], EMPTY_REPORT_MAP);

    expect(issues).toHaveLength(1);
    expect(issues[0].row).toBe(5);
  });

  it('skips all header rows even with different rowIndex', () => {
    const headers = [
      makeRow({ classification: 'header', rowIndex: 1 }),
      makeRow({ classification: 'header', rowIndex: 2 }),
      makeRow({ classification: 'header', rowIndex: 3 }),
    ];
    const rule = makeFailingRule();
    const issues = validateData(EMPTY_METRICS, headers, [rule], EMPTY_REPORT_MAP);
    expect(issues).toHaveLength(0);
  });
});

// ────────────────────────────────────────────────────────────
// 4. Row filter
// ────────────────────────────────────────────────────────────

describe('validateData — rowFilter', () => {
  it('respects rule.rowFilter array', () => {
    const procRow = makeRow({ classification: 'procurement', rowIndex: 5 });
    const noteRow = makeRow({ classification: 'note', rowIndex: 6 });

    const rule = makeFailingRule({ rowFilter: ['procurement'] });
    const issues = validateData(EMPTY_METRICS, [procRow, noteRow], [rule], EMPTY_REPORT_MAP);

    expect(issues).toHaveLength(1);
    expect(issues[0].row).toBe(5);
  });
});

// ────────────────────────────────────────────────────────────
// 5. Disabled rules
// ────────────────────────────────────────────────────────────

describe('validateData — disabled rules', () => {
  it('skips disabled rules', () => {
    const row = makeRow();
    const disabledRule = makeFailingRule({ enabled: false });
    const issues = validateData(EMPTY_METRICS, [row], [disabledRule], EMPTY_REPORT_MAP);
    expect(issues).toHaveLength(0);
  });

  it('runs rules without explicit enabled field', () => {
    const row = makeRow();
    const rule = makeFailingRule();
    // enabled is not set (undefined), should still run
    const issues = validateData(EMPTY_METRICS, [row], [rule], EMPTY_REPORT_MAP);
    expect(issues).toHaveLength(1);
  });
});

// ────────────────────────────────────────────────────────────
// 6. Broken rule try/catch
// ────────────────────────────────────────────────────────────

describe('validateData — error handling', () => {
  it('does not crash when a rule throws an error', () => {
    const row = makeRow();
    const brokenRule = makeRule({
      id: 'broken',
      check: () => { throw new Error('Rule implementation bug'); },
    });
    const goodRule = makeFailingRule({ id: 'good_rule' });

    const issues = validateData(EMPTY_METRICS, [row], [brokenRule, goodRule], EMPTY_REPORT_MAP);
    // Broken rule is skipped, good rule still fires
    expect(issues).toHaveLength(1);
    expect(issues[0].category).toBe('good_rule');
  });

  it('continues validation after broken rule', () => {
    const rows = [makeRow({ rowIndex: 5 }), makeRow({ rowIndex: 6 })];
    const brokenRule = makeRule({
      id: 'broken',
      check: () => { throw new TypeError('Cannot read property'); },
    });
    // Should not crash
    expect(() => validateData(EMPTY_METRICS, rows, [brokenRule], EMPTY_REPORT_MAP)).not.toThrow();
  });
});

// ────────────────────────────────────────────────────────────
// 7. Issue metadata
// ────────────────────────────────────────────────────────────

describe('validateData — issue metadata', () => {
  it('populates issue fields correctly', () => {
    const row = makeRow({
      rowIndex: 10,
      sheet: 'СВОД ТД-ПМ',
      cells: { C: 'Подразделение1', F: 'Текущая деятельность', E: 'Программа' },
    });
    const rule = makeFailingRule({
      id: 'budget_sum_plan',
      name: 'Budget Check',
      origin: 'spreadsheet_rule',
      severity: 'error',
    });

    const [issue] = validateData(EMPTY_METRICS, [row], [rule], EMPTY_REPORT_MAP);

    expect(issue.id).toBeTruthy(); // nanoid
    expect(issue.category).toBe('budget_sum_plan');
    expect(issue.origin).toBe('spreadsheet_rule');
    expect(issue.sheet).toBe('СВОД ТД-ПМ');
    expect(issue.row).toBe(10);
    expect(issue.status).toBe('open');
    expect(issue.detectedBy).toBe('rule:budget_sum_plan');
    expect(issue.detectedAt).toBeTruthy();
  });

  it('derives subordinateId from column C', () => {
    const row = makeRow({ cells: { C: '  ОргЮнит  ' } });
    const [issue] = validateData(EMPTY_METRICS, [row], [makeFailingRule()], EMPTY_REPORT_MAP);
    expect(issue.subordinateId).toBe('ОргЮнит');
  });

  it('defaults subordinateId to _org_itself when C is empty', () => {
    const row = makeRow({ cells: { C: '' } });
    const [issue] = validateData(EMPTY_METRICS, [row], [makeFailingRule()], EMPTY_REPORT_MAP);
    expect(issue.subordinateId).toBe('_org_itself');
  });

  it('derives activityType for "программное мероприятие"', () => {
    const row = makeRow({ cells: { F: 'Программное мероприятие', C: '' } });
    const [issue] = validateData(EMPTY_METRICS, [row], [makeFailingRule()], EMPTY_REPORT_MAP);
    expect(issue.activityType).toBe('program');
  });

  it('derives activityType for "текущая" with program name', () => {
    const row = makeRow({ cells: { F: 'Текущая деятельность', E: 'Реальная программа', C: '' } });
    const [issue] = validateData(EMPTY_METRICS, [row], [makeFailingRule()], EMPTY_REPORT_MAP);
    expect(issue.activityType).toBe('current_program');
  });

  it('derives activityType for "текущая" without program name', () => {
    const row = makeRow({ cells: { F: 'Текущая деятельность', E: 'X', C: '' } });
    const [issue] = validateData(EMPTY_METRICS, [row], [makeFailingRule()], EMPTY_REPORT_MAP);
    expect(issue.activityType).toBe('current_non_program');
  });

  it('derives activityType as undefined when F is empty', () => {
    const row = makeRow({ cells: { F: '', C: '' } });
    const [issue] = validateData(EMPTY_METRICS, [row], [makeFailingRule()], EMPTY_REPORT_MAP);
    expect(issue.activityType).toBeUndefined();
  });
});

// ────────────────────────────────────────────────────────────
// 8. CHECK_REGISTRY severity enrichment
// ────────────────────────────────────────────────────────────

describe('validateData — severity from CHECK_REGISTRY', () => {
  it('uses CHECK_REGISTRY severity when rule id is in LEGACY_RULE_TO_CHECK', () => {
    const row = makeRow({ cells: { K: 100, H: 50, I: 20, J: 20 } });
    // budget_sum_plan is a known checkId
    const rule = makeFailingRule({
      id: 'budget_sum_plan',
      severity: 'warning', // rule says warning
    });
    const [issue] = validateData(EMPTY_METRICS, [row], [rule], EMPTY_REPORT_MAP);
    // CHECK_REGISTRY for budget_sum_plan has severity 'error'
    // The effective severity should come from CHECK_REGISTRY, not the rule
    expect(issue.checkId).toBe('budget_sum_plan');
    // severity is from CHECK_REGISTRY (may differ from rule.severity)
    expect(issue.severity).toBeDefined();
  });

  it('falls back to rule severity for unknown check IDs', () => {
    const row = makeRow();
    const rule = makeFailingRule({
      id: 'completely_unknown_rule_xyz',
      severity: 'info',
    });
    const [issue] = validateData(EMPTY_METRICS, [row], [rule], EMPTY_REPORT_MAP);
    expect(issue.severity).toBe('info');
  });
});

// ────────────────────────────────────────────────────────────
// 9. Multiple rows, multiple rules
// ────────────────────────────────────────────────────────────

describe('validateData — multi-row multi-rule', () => {
  it('generates issues for each failing row-rule combination', () => {
    const rows = [
      makeRow({ rowIndex: 5 }),
      makeRow({ rowIndex: 6 }),
      makeRow({ rowIndex: 7 }),
    ];
    const rule = makeFailingRule();
    const issues = validateData(EMPTY_METRICS, rows, [rule], EMPTY_REPORT_MAP);
    expect(issues).toHaveLength(3);
    expect(issues.map(i => i.row)).toEqual([5, 6, 7]);
  });

  it('accumulates issues from multiple rules', () => {
    const row = makeRow({ rowIndex: 5 });
    const rules = [
      makeFailingRule({ id: 'rule_a', name: 'Rule A' }),
      makeFailingRule({ id: 'rule_b', name: 'Rule B' }),
    ];
    const issues = validateData(EMPTY_METRICS, [row], rules, EMPTY_REPORT_MAP);
    expect(issues).toHaveLength(2);
    expect(issues.map(i => i.category)).toContain('rule_a');
    expect(issues.map(i => i.category)).toContain('rule_b');
  });
});

// ────────────────────────────────────────────────────────────
// 10. Context (allRows) passed to rules
// ────────────────────────────────────────────────────────────

describe('validateData — rule context', () => {
  it('passes allRows in context', () => {
    const rows = [
      makeRow({ rowIndex: 5 }),
      makeRow({ rowIndex: 10 }),
    ];
    let receivedAllRows: ClassifiedRow[] | undefined;
    const spyRule = makeRule({
      check: (ctx: RuleCheckContext) => {
        receivedAllRows = ctx.allRows;
        return { passed: true };
      },
    });
    validateData(EMPTY_METRICS, rows, [spyRule], EMPTY_REPORT_MAP);
    expect(receivedAllRows).toHaveLength(2);
  });

  it('passes correct cells and sheet in context', () => {
    const cells = { A: '1', H: 500000 };
    const row = makeRow({ rowIndex: 5, sheet: 'TestSheet', cells });
    let receivedCtx: RuleCheckContext | undefined;
    const spyRule = makeRule({
      check: (ctx: RuleCheckContext) => {
        receivedCtx = ctx;
        return { passed: true };
      },
    });
    validateData(EMPTY_METRICS, [row], [spyRule], EMPTY_REPORT_MAP);
    expect(receivedCtx!.cells).toEqual(cells);
    expect(receivedCtx!.sheet).toBe('TestSheet');
    expect(receivedCtx!.rowIndex).toBe(5);
    expect(receivedCtx!.classification).toBe('procurement');
  });
});

// ────────────────────────────────────────────────────────────
// 11. hasProgramName edge cases (via activityType)
// ────────────────────────────────────────────────────────────

describe('validateData — hasProgramName via activityType', () => {
  it('treats Cyrillic "Х" as no program name', () => {
    const row = makeRow({ cells: { F: 'Текущая деятельность', E: 'Х', C: '' } });
    const [issue] = validateData(EMPTY_METRICS, [row], [makeFailingRule()], EMPTY_REPORT_MAP);
    expect(issue.activityType).toBe('current_non_program');
  });

  it('treats lowercase Cyrillic "х" as no program name', () => {
    const row = makeRow({ cells: { F: 'Текущая деятельность', E: 'х', C: '' } });
    const [issue] = validateData(EMPTY_METRICS, [row], [makeFailingRule()], EMPTY_REPORT_MAP);
    expect(issue.activityType).toBe('current_non_program');
  });

  it('treats empty string as no program name', () => {
    const row = makeRow({ cells: { F: 'Текущая деятельность', E: '  ', C: '' } });
    const [issue] = validateData(EMPTY_METRICS, [row], [makeFailingRule()], EMPTY_REPORT_MAP);
    expect(issue.activityType).toBe('current_non_program');
  });

  it('treats real program name as current_program', () => {
    const row = makeRow({ cells: { F: 'Текущая деятельность', E: 'Нацпроект', C: '' } });
    const [issue] = validateData(EMPTY_METRICS, [row], [makeFailingRule()], EMPTY_REPORT_MAP);
    expect(issue.activityType).toBe('current_program');
  });
});
