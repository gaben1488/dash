import { describe, expect, it } from 'vitest';
import type { DeltaResult, Issue } from '@aemr/shared';
import { assessReconciliation, buildControlPreview } from './preview.js';

const delta = (
  overrides: Partial<DeltaResult> = {},
): DeltaResult => ({
  metricKey: 'grbs.uo.year.fact_total',
  label: 'Факт УО',
  officialValue: 100,
  calculatedValue: 100,
  delta: 0,
  deltaPercent: 0,
  withinTolerance: true,
  explanation: '',
  ...overrides,
});

const issue = (overrides: Partial<Issue> = {}): Issue => ({
  id: 'old-issue-1',
  severity: 'warning',
  origin: 'bi_heuristic',
  category: 'signal:economyFlagUndetermined',
  checkId: 'status_on_data_rows',
  title: 'Экономия без решения',
  description: 'Нужна проверка отметки AD',
  status: 'open',
  detectedAt: '2026-10-10T01:00:00Z',
  detectedBy: 'test',
  sheet: 'УО',
  departmentId: 'uo',
  row: 121,
  rowSeq: '173/1',
  ...overrides,
});

describe('assessReconciliation — сравнимость важнее процента', () => {
  it('нулевой объём сравнений — НЕ ПРОВЕРЕНО, а не 100 %', () => {
    expect(assessReconciliation([])).toMatchObject({
      state: 'not_checked', checked: 0, matched: 0,
      agreementPct: null, coveragePct: null,
    });
  });

  it('обе стороны заполнены, но дельта не вычислена (разные годы) — не считается проверкой', () => {
    const assessment = assessReconciliation([
      delta({ delta: null, deltaPercent: null, withinTolerance: true,
        explanation: 'Годы разные: сравнение неприменимо' }),
    ]);
    expect(assessment).toMatchObject({
      state: 'not_checked', expected: 1, checked: 0,
      notCompared: 1, agreementPct: null, coveragePct: 0,
    });
  });

  it('проверена только часть: сохраняется охват и честная согласованность', () => {
    const assessment = assessReconciliation([delta(), delta({
      metricKey: 'm2', officialValue: 50, calculatedValue: null,
      delta: null, deltaPercent: null,
    })]);
    expect(assessment).toMatchObject({
      state: 'partial', expected: 2, checked: 1, matched: 1,
      notCompared: 1, coveragePct: 50, agreementPct: 100,
    });
  });

  it('сопоставимое расхождение не скрывается средним процентом', () => {
    const assessment = assessReconciliation([
      delta(),
      delta({ metricKey: 'm2', calculatedValue: 120, delta: 20, deltaPercent: 20,
        withinTolerance: false }),
    ]);
    expect(assessment).toMatchObject({
      state: 'issues_found', checked: 2, mismatched: 1, agreementPct: 50,
    });
  });

  it('все сравнимые пары совпали', () => {
    expect(assessReconciliation([delta(), delta({ metricKey: 'm2' })])).toMatchObject({
      state: 'passed', checked: 2, expected: 2, agreementPct: 100, coveragePct: 100,
    });
  });
});

describe('buildControlPreview — ни один сигнал и статус не исчезает', () => {
  it('сливает два детектора одного checkId в той же физической строке, но сохраняет evidence IDs', () => {
    const result = buildControlPreview({
      issues: [issue(), issue({
        id: 'other-detector',
        category: 'status_on_data_rows',
        origin: 'spreadsheet_rule',
        rowSeq: '173/1',
      })],
      deltas: [],
      snapshotId: 'snap-one',
      readAt: '2026-10-10T02:00:00Z',
    });
    expect(result.cases).toHaveLength(1);
    expect(result.cases[0]?.issueIds).toEqual(['old-issue-1', 'other-detector']);
    expect(result.counts).toMatchObject({ observations: 2, cases: 1, needingReview: 1 });
    expect(result.verifiedFixes).toBeNull();
  });

  it('не сливает соседние строки и разные проверки; составной номер не конвертируется в число', () => {
    const result = buildControlPreview({
      issues: [
        issue(),
        issue({ id: '2', row: 122, rowSeq: '173/18' }),
        issue({ id: '3', checkId: 'other_check', rowSeq: '173/1' }),
      ],
      deltas: [delta()],
      snapshotId: 's1', readAt: '2026-10-10T02:00:00Z',
    });
    expect(result.cases).toHaveLength(3);
    expect(result.cases.map(c => c.rowSeq)).toContain('173/18');
  });

  it('без адресуемой строки разные замечания не сливает по названию или категории', () => {
    const result = buildControlPreview({
      issues: [
        issue({ row: undefined, rowSeq: undefined, id: 'sheet-1' }),
        issue({ row: undefined, rowSeq: undefined, id: 'sheet-2' }),
      ],
      deltas: [], snapshotId: 's1', readAt: '2026-10-10T02:00:00Z',
    });
    expect(result.cases).toHaveLength(2);
  });

  it('не считает человеческое «решено» доказанной перепроверкой', () => {
    const result = buildControlPreview({
      issues: [
        issue({ status: 'resolved' }),
        issue({ id: '2', row: 122, status: 'false_positive' }),
      ],
      deltas: [], snapshotId: 's1', readAt: '2026-10-10T02:00:00Z',
    });
    expect(result.counts).toMatchObject({ cases: 2, needingReview: 0, markedResolved: 1, markedFalsePositive: 1 });
    expect(result.verifiedFixes).toBeNull();
    expect(result.cases[0]?.verification).not.toBe('verified_fixed');
  });

  it('разные статусы доказательств одной строки сохраняет как конфликт для проверки', () => {
    const result = buildControlPreview({
      issues: [issue({ status: 'resolved' }), issue({
        id: '2', category: 'status_on_data_rows', origin: 'spreadsheet_rule', status: 'open',
      })],
      deltas: [], snapshotId: 's1', readAt: '2026-10-10T02:00:00Z',
    });
    expect(result.cases[0]?.reviewState).toBe('mixed');
    expect(result.counts.needingReview).toBe(1);
  });

  it('при неизвестном влиянии не выдумывает расчётный ущерб и не превращает гипотезу в нарушение', () => {
    const result = buildControlPreview({
      issues: [issue({
        id: 'legal-hypothesis', category: 'signal:epRisk',
        checkId: 'ep_risk', severity: 'critical',
      })],
      deltas: [], snapshotId: 's1', readAt: '2026-10-10T02:00:00Z',
    });
    expect(result.cases[0]?.impact).toBe('not_established');
    expect(result.cases[0]?.verification).toBe('needs_review');
    expect(result.cases[0]?.verifiedLegalViolation).toBe(false);
  });
});
