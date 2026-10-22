/**
 * schemas.test.ts — Unit tests for zod API contract schemas.
 *
 * Goal: регрессионный guard на primitive enums + KPICardSchema + request
 * bodies. Full DashboardDataSchema shape-test отложен (fixture для всех
 * nested schemas — DataSnapshotSchema, IssueSchema, TrustScoreSchema — это
 * ~150 строк fixture для одного позитивного теста, low ROI). Вместо этого
 * runtime валидация на границе /api/dashboard (dashboard.ts) логирует
 * drift при реальной production-shape mismatch — это честный integration
 * вместо синтетического fixture.
 *
 * Что покрыто:
 *   - Все primitive enums (ProcurementMethod, Budget, Money, IssueSeverity)
 *   - KPICardSchema positive + negative cases
 *   - Request body schemas (Refresh, Settings, IssueUpdate)
 *   - Generic envelope factories (ApiResponse, PaginatedResponse)
 *
 * Что НЕ покрыто (TODO):
 *   - Full DashboardData shape test (нужен complete fixture)
 *   - DepartmentSummary nested shape
 *   - Runtime integration with actual /api/dashboard response
 *
 * Library choice: Zod (see NOW.md — Valibot/TypeBox/ArkType rejected for
 * internal BI project: switching cost > realized gain).
 */
import { describe, it, expect } from 'vitest';
import {
  KPICardSchema,
  ApiResponseSchema,
  PaginatedResponseSchema,
  RefreshRequestSchema,
  IssueUpdateSchema,
  SettingsUpdateSchema,
  ProcurementMethodSchema,
  BudgetLevelSchema,
  MoneyUnitSchema,
  IssueSeveritySchema,
  IssueSchema,
  TrustGradeSchema,
  DashboardDataSchema,
  DataSnapshotSchema,
  DepartmentSummarySchema,
  SelectedReportReleaseStatusSchema,
  ReportReleaseStatusSchema,
} from './schemas.js';
import { z } from 'zod';

describe('operational report observations survive the API boundary', () => {
  const operations = {
    checked_at: '2026-10-16T23:03:40+00:00', worker_state: 'idle',
    running_duration_seconds: null, last_cycle_duration_seconds: 209,
    last_success_at: '2026-10-16T23:03:13+00:00', last_success_age_seconds: 27,
    check_stale: false, last_failure_at: '2026-10-15T12:00:00+00:00',
    last_failure_code: 'SOURCE_CHANGED_BEFORE_PUBLICATION', last_failure_stage: 'publication',
    failure_resolved: true, publication_cutoff_at: '2026-10-16T12:00:00+00:00',
  };
  const contexts = [
    [ReportReleaseStatusSchema, { latest: null, attempt: null }],
    [SelectedReportReleaseStatusSchema, { selected: null, attempt: null }],
  ] as const;

  it('retains actual check age, cycle duration and resolved historical failure in both responses', () => {
    for (const [schema, payload] of contexts) {
      expect(schema.parse({ ...payload, operations })).toEqual({ ...payload, operations });
      expect(schema.parse(payload)).toEqual(payload);
    }
  });

  it('rejects impossible durations, timestamps and arbitrary failure text instead of silently dropping them', () => {
    for (const invalid of [
      { last_success_age_seconds: -1 }, { last_cycle_duration_seconds: true },
      { checked_at: 'yesterday' }, { last_failure_code: 'private account: person@example.test' },
      { worker_state: 'complete' }, { last_failure_stage: 'unreviewed' },
    ]) {
      for (const [schema, payload] of contexts) {
        expect(schema.safeParse({ ...payload, operations: { ...operations, ...invalid } }).success).toBe(false);
      }
    }
  });

  it('preserves missing observations without replacing them with zeros or successful checks', () => {
    const empty = { ...operations, worker_state: 'unknown', last_cycle_duration_seconds: null,
      last_success_at: null, last_success_age_seconds: null, check_stale: true,
      last_failure_at: null, last_failure_code: null, last_failure_stage: null,
      failure_resolved: false, publication_cutoff_at: null };
    for (const [schema, payload] of contexts) {
      expect(schema.parse({ ...payload, operations: empty })).toEqual({ ...payload, operations: empty });
    }
  });
});

describe('Issue API addresses', () => {
  it('preserves distinct procurement labels through the parsed issue list', () => {
    const items = ['173', '173/1', '173/18'].map((rowSeq) => ({
      id: `issue-${rowSeq}`, rowSeq, row: 460,
      severity: 'warning', origin: 'bi_heuristic', category: 'data', title: 'Проверка',
      description: 'Адрес закупки', status: 'open', detectedAt: '2026-10-16T00:00:00Z',
      detectedBy: 'test',
    }));
    expect(items.map((item) => IssueSchema.parse(item).rowSeq)).toEqual(['173', '173/1', '173/18']);
    expect(IssueSchema.parse({ ...items[0], rowSeq: undefined }).rowSeq).toBeUndefined();
    expect(IssueSchema.safeParse({ ...items[0], rowSeq: 173 }).success).toBe(false);
  });
});

// ────────────────────────────────────────────────────────────
// Primitive enums
// ────────────────────────────────────────────────────────────

describe('Primitive enums — single source of truth для strings', () => {
  it('ProcurementMethodSchema accepts 4 canonical methods exactly', () => {
    for (const m of ['ЭА', 'ЕП', 'ЭК', 'ЭЗК']) {
      expect(ProcurementMethodSchema.safeParse(m).success).toBe(true);
    }
    // Aliases rejected: use dictionaries/method-families.normalizeMethod() first.
    expect(ProcurementMethodSchema.safeParse('ЭА (МЭП)').success).toBe(false);
    expect(ProcurementMethodSchema.safeParse('Ед. поставщик').success).toBe(false);
    expect(ProcurementMethodSchema.safeParse('').success).toBe(false);
  });

  it('BudgetLevelSchema: fb/kb/mb latin only', () => {
    for (const b of ['fb', 'kb', 'mb']) {
      expect(BudgetLevelSchema.safeParse(b).success).toBe(true);
    }
    expect(BudgetLevelSchema.safeParse('ФБ').success).toBe(false);
    expect(BudgetLevelSchema.safeParse('federal').success).toBe(false);
  });

  it('MoneyUnitSchema: 3 canonical ru values', () => {
    for (const u of ['тыс. руб.', 'млн руб.', 'млрд руб.']) {
      expect(MoneyUnitSchema.safeParse(u).success).toBe(true);
    }
    expect(MoneyUnitSchema.safeParse('руб').success).toBe(false);
    expect(MoneyUnitSchema.safeParse('RUB').success).toBe(false);
  });

  it('IssueSeveritySchema: 5 canonical levels', () => {
    for (const s of ['error', 'warning', 'info', 'significant', 'critical']) {
      expect(IssueSeveritySchema.safeParse(s).success).toBe(true);
    }
    expect(IssueSeveritySchema.safeParse('fatal').success).toBe(false);
    expect(IssueSeveritySchema.safeParse('debug').success).toBe(false);
  });

  it('TrustGradeSchema: A/B/C/D/F', () => {
    for (const g of ['A', 'B', 'C', 'D', 'F']) {
      expect(TrustGradeSchema.safeParse(g).success).toBe(true);
    }
    expect(TrustGradeSchema.safeParse('E').success).toBe(false);
    expect(TrustGradeSchema.safeParse('a').success).toBe(false); // case-sensitive
  });
});

// ────────────────────────────────────────────────────────────
// KPICardSchema — one of the main API response primitives
// ────────────────────────────────────────────────────────────

const validKpiCard = {
  metricKey: 'total_exec_count_pct',
  label: 'Исполнение (шт)',
  value: '58.3%',
  numericValue: 58.3,
  unit: '%',
  period: 'Q1 2026',
  trend: 'up' as const,
  trendValue: '+2.1',
  origin: 'calculated' as const,
  sourceCell: 'СВОД ТД-ПМ!G14',
  status: 'normal' as const,
  delta: {
    calculatedValue: '58.3%',
    deltaPercent: '+2.1%',
    withinTolerance: true,
  },
};

describe('KPICardSchema', () => {
  it('accepts full valid KPI card', () => {
    const result = KPICardSchema.safeParse(validKpiCard);
    expect(result.success).toBe(true);
  });

  it('allows numericValue = null (не все метрики вычислимы)', () => {
    const card = { ...validKpiCard, numericValue: null };
    expect(KPICardSchema.safeParse(card).success).toBe(true);
  });

  it('allows missing optional fields (trend, trendValue, delta)', () => {
    const { trend, trendValue, delta, ...minimal } = validKpiCard;
    void trend;
    void trendValue;
    void delta;
    expect(KPICardSchema.safeParse(minimal).success).toBe(true);
  });

  it('rejects missing metricKey (required)', () => {
    const { metricKey, ...broken } = validKpiCard;
    void metricKey;
    const result = KPICardSchema.safeParse(broken);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.includes('metricKey'))).toBe(true);
    }
  });

  it('rejects invalid status enum ("PANIC" not in {normal,warning,critical})', () => {
    const broken = { ...validKpiCard, status: 'PANIC' };
    expect(KPICardSchema.safeParse(broken).success).toBe(false);
  });

  it('rejects invalid origin ("manual" not in {official,calculated,hybrid})', () => {
    const broken = { ...validKpiCard, origin: 'manual' };
    expect(KPICardSchema.safeParse(broken).success).toBe(false);
  });

  it('rejects wrong numericValue type (string "58.3")', () => {
    const broken = { ...validKpiCard, numericValue: '58.3' };
    expect(KPICardSchema.safeParse(broken).success).toBe(false);
  });

  it('delta sub-object: withinTolerance must be boolean, not "yes"', () => {
    const broken = {
      ...validKpiCard,
      delta: { calculatedValue: '58', deltaPercent: '+2', withinTolerance: 'yes' },
    };
    expect(KPICardSchema.safeParse(broken).success).toBe(false);
  });
});

// ────────────────────────────────────────────────────────────
// DashboardDataSchema — smoke test на presence of required keys
// ────────────────────────────────────────────────────────────

describe('DashboardDataSchema structure (smoke)', () => {
  it('is a zod object with required top-level keys', () => {
    // Sanity: schema contains expected fields, catches total renames.
    const shape = (DashboardDataSchema as unknown as { _def: { shape: () => Record<string, unknown> } })
      ._def.shape();
    const keys = Object.keys(shape);
    expect(keys).toContain('kpiCards');
    expect(keys).toContain('departmentSummaries');
    expect(keys).toContain('recentIssues');
    expect(keys).toContain('summaryByPeriod');
    expect(keys).toContain('signalCounts');
    expect(keys).toContain('issueSummary');
    expect(keys).toContain('trust');
    expect(keys).toContain('lastRefreshed');
    expect(keys).toContain('snapshot');
    expect(keys).toContain('year');
  });

  it('documents dashboard-only DepartmentSummary extensions used by web filters', () => {
    const shape = (DepartmentSummarySchema as unknown as { _def: { shape: () => Record<string, unknown> } })
      ._def.shape();
    const keys = Object.keys(shape);

    expect(keys).toContain('quarters');
    expect(keys).toContain('signalCounts');
    expect(keys).toContain('byActivity');
    expect(keys).toContain('subordinates');
    expect(keys).toContain('economyConflicts');
  });

  it('rejects obviously wrong shape (string instead of object)', () => {
    expect(DashboardDataSchema.safeParse('not an object').success).toBe(false);
    expect(DashboardDataSchema.safeParse(null).success).toBe(false);
    expect(DashboardDataSchema.safeParse([]).success).toBe(false);
  });

  it('rejects empty object (all required keys missing)', () => {
    const result = DashboardDataSchema.safeParse({});
    expect(result.success).toBe(false);
    if (!result.success) {
      // Expect error paths для каждого required top-level поля.
      const paths = result.error.issues.map((i) => i.path[0]);
      expect(paths).toContain('kpiCards');
      expect(paths).toContain('trust');
    }
  });
});

// ────────────────────────────────────────────────────────────
// Request body schemas
// ────────────────────────────────────────────────────────────

describe('Request body schemas', () => {
  it('RefreshRequestSchema defaults force to false', () => {
    const empty = RefreshRequestSchema.parse({});
    expect(empty.force).toBe(false);

    const explicit = RefreshRequestSchema.parse({ force: true });
    expect(explicit.force).toBe(true);
  });

  it('RefreshRequestSchema rejects non-boolean force', () => {
    expect(RefreshRequestSchema.safeParse({ force: 'yes' }).success).toBe(false);
    expect(RefreshRequestSchema.safeParse({ force: 1 }).success).toBe(false);
  });

  it('SettingsUpdateSchema enforces cacheTtl range [30..3600]', () => {
    expect(SettingsUpdateSchema.safeParse({ cacheTtl: 60 }).success).toBe(true);
    expect(SettingsUpdateSchema.safeParse({ cacheTtl: 3600 }).success).toBe(true);
    expect(SettingsUpdateSchema.safeParse({ cacheTtl: 29 }).success).toBe(false);
    expect(SettingsUpdateSchema.safeParse({ cacheTtl: 3601 }).success).toBe(false);
    expect(SettingsUpdateSchema.safeParse({}).success).toBe(true); // all optional
  });

  it('SettingsUpdateSchema enabledChecks must be string array', () => {
    expect(SettingsUpdateSchema.safeParse({ enabledChecks: ['r1', 'r2'] }).success).toBe(true);
    expect(SettingsUpdateSchema.safeParse({ enabledChecks: [1, 2] }).success).toBe(false);
  });

  it('IssueUpdateSchema requires valid status enum', () => {
    // Valid values per IssueStatusSchema в schemas.ts
    expect(IssueUpdateSchema.safeParse({ status: 'resolved' }).success).toBe(true);
    expect(IssueUpdateSchema.safeParse({ status: 'pending' }).success).toBe(false);
    expect(IssueUpdateSchema.safeParse({}).success).toBe(false); // status required
  });

  it('IssueUpdateSchema accepts optional comment', () => {
    expect(IssueUpdateSchema.safeParse({ status: 'resolved', comment: 'fixed by X' }).success).toBe(true);
  });
});

// ────────────────────────────────────────────────────────────
// Generic envelope factory schemas
// ────────────────────────────────────────────────────────────

describe('Generic envelope factories', () => {
  it('ApiResponseSchema wraps arbitrary data schema, ok+data branch', () => {
    const Wrapped = ApiResponseSchema(z.object({ count: z.number() }));
    const resp = Wrapped.safeParse({
      ok: true,
      data: { count: 42 },
      timestamp: '2026-04-19T10:00:00Z',
    });
    expect(resp.success).toBe(true);
  });

  it('ApiResponseSchema ok=false with error string branch', () => {
    const Wrapped = ApiResponseSchema(z.object({ count: z.number() }));
    const resp = Wrapped.safeParse({
      ok: false,
      error: 'not found',
      timestamp: '2026-04-19T10:00:00Z',
    });
    expect(resp.success).toBe(true);
  });

  it('ApiResponseSchema requires timestamp', () => {
    const Wrapped = ApiResponseSchema(z.object({ count: z.number() }));
    const broken = Wrapped.safeParse({ ok: true, data: { count: 42 } });
    expect(broken.success).toBe(false);
  });

  it('PaginatedResponseSchema requires items/total/page/pageSize', () => {
    const Wrapped = PaginatedResponseSchema(z.string());
    expect(
      Wrapped.safeParse({ items: ['a', 'b'], total: 2, page: 1, pageSize: 20 }).success,
    ).toBe(true);

    // Missing pageSize
    expect(Wrapped.safeParse({ items: [], total: 0, page: 1 }).success).toBe(false);
  });

  it('PaginatedResponseSchema items match inner schema', () => {
    const Wrapped = PaginatedResponseSchema(z.number());
    // Wrong item type (strings instead of numbers).
    expect(
      Wrapped.safeParse({ items: ['a'], total: 1, page: 1, pageSize: 10 }).success,
    ).toBe(false);
  });
});

// ────────────────────────────────────────────────────────────
// TypeScript inference — compile-time guarantee
// ────────────────────────────────────────────────────────────

describe('TS inference (compile-time check, runtime is trivial)', () => {
  it('KPICardSchema infers to { metricKey, label, ... }', () => {
    type Card = z.infer<typeof KPICardSchema>;
    // Compile-time check: assigning validKpiCard to Card works. If schema
    // changes break this inference, tsc catches it.
    const card: Card = validKpiCard;
    expect(card.metricKey).toBe('total_exec_count_pct');
  });
});


describe('published Word response: actionable assurance 19/32/34 lineage', () => {
  const receipt = {
    release_id: 'REL-' + 'a'.repeat(64),
    snapshot_id: 'SNP-verified',
    report_date: '11.10.2026',
    cutoff_at: '2026-10-11T09:54:00Z',
    published_at: '2026-10-11T09:54:40Z',
    model_sha256: 'b'.repeat(64),
    rules_version: 'rules-test',
    renderer_version: 'renderer-test',
    status: 'VERIFIED_WITH_WARNINGS',
    report_year: 2026,
    quarter: 4,
  } as const;

  const common = {
    fully_automated: false,
    user_action_count: 0,
    engine_action_count: 1,
    active_recommendations: 159,
    link_status_counts: { CONFIRMED: 90, ORIGIN_UNPROVEN: 69 },
    action_status_counts: { UNKNOWN: 12 },
    actions: [],
    meaning: 'Контроль на исходных данных не означает всеобщую завершённость.',
  };

  const v2 = {
    ...common,
    contract: 'actionable-assurance-v2',
    nonprocurement_identity_observations: 0,
    source_observations: [{
      source_row_key: 'stable-row-reference',
      events: [{
        kind: 'NO_FUNDING_REPORTED', target: null, field: 'explanations',
        column: 'U', quote: 'финансирование отсутствует',
        source_text: 'финансирование отсутствует',
        evidence_kind: 'SOURCE_STATEMENT',
      }],
    }],
  };

  it('accepts the exact v2 receipt deployed by the report engine without skipping assurance', () => {
    const checked = SelectedReportReleaseStatusSchema.safeParse({
      attempt: null, selected: { ...receipt, automation_assurance: v2 },
    });
    expect(checked.success).toBe(true);
  });

  it('retains explicit same-release evidence references without stripping the selected assurance', () => {
    const response = SelectedReportReleaseStatusSchema.parse({
      selected: { ...receipt, automation_assurance: v2 },
      latest_matching: { ...receipt, automation_assurance_release_id: receipt.release_id },
      attempt: { status: 'VERIFIED', automation_assurance_release_id: receipt.release_id },
    });
    expect(response.selected?.automation_assurance).toEqual(v2);
    expect(response.latest_matching?.automation_assurance_release_id).toBe(receipt.release_id);
    expect(response.attempt?.automation_assurance_release_id).toBe(receipt.release_id);
  });

  it('preserves every repeated-label address in the reviewed v3 receipt without making it an action', () => {
    const locations = [10, 234].map(row => ({
      source_id: 'book', sheet: 'ВСЕ', sheet_id: 17, row, column: 'A', a1: `A${row}`,
      url: null, subject: 'Synthetic subject', business_id: '176',
    }));
    const assurance = {
      ...v2, contract: 'actionable-assurance-v3', engine_action_count: 0,
      business_id_observations: [{
        code: 'DUPLICATE_BUSINESS_ID', grbs: 'УО', business_id: '176', locations,
        user_action_required: false, meaning: 'Repeated labels do not establish duplicated procurements.',
      }],
    };
    const checked = SelectedReportReleaseStatusSchema.parse({
      attempt: null, selected: { ...receipt, automation_assurance: assurance },
    });
    expect(checked.selected?.automation_assurance).toEqual(assurance);
    for (const malformed of [
      { ...assurance, business_id_observations: undefined },
      { ...assurance, business_id_observations: [{ ...assurance.business_id_observations[0], user_action_required: true }] },
    ]) {
      expect(SelectedReportReleaseStatusSchema.safeParse({
        attempt: null, selected: { ...receipt, automation_assurance: malformed },
      }).success).toBe(false);
    }
  });

  it('continues reading historical v1 receipts with the same semantic actions', () => {
    const checked = SelectedReportReleaseStatusSchema.safeParse({
      attempt: null, selected: { ...receipt, automation_assurance: {
        ...common, contract: 'actionable-assurance-v1',
      } },
    });
    expect(checked.success).toBe(true);
  });

  it('accepts both assurance versions in attempts and validates their counters', () => {
    for (const assurance of [v2, { ...common, contract: 'actionable-assurance-v1' }]) {
      const response = {
        selected: null,
        attempt: {
          status: 'VERIFIED_WITH_WARNINGS', attempt_id: 'attempt-schema-test',
          started_at: receipt.cutoff_at, finished_at: receipt.published_at,
          automation_assurance: assurance,
        },
      };
      expect(SelectedReportReleaseStatusSchema.safeParse(response).success).toBe(true);
      for (const change of [{ contract: 'actionable-assurance-v4' }, { user_action_count: -1 }]) {
        expect(SelectedReportReleaseStatusSchema.safeParse({
          ...response, attempt: { ...response.attempt, automation_assurance: { ...assurance, ...change } },
        }).success).toBe(false);
        expect(SelectedReportReleaseStatusSchema.safeParse({
          attempt: null, selected: { ...receipt, automation_assurance: { ...assurance, ...change } },
        }).success).toBe(false);
      }
    }
  });

  it('refuses incomplete v2 evidence and unreviewed future contracts', () => {
    for (const assurance of [
      { ...v2, source_observations: undefined },
      { ...v2, nonprocurement_identity_observations: -1 },
      { ...v2, contract: 'actionable-assurance-v4' },
      { ...v2, source_observations: [{ source_row_key: 'row', events: [{ kind: 'FUNDING_REPORTED' }] }] },
    ]) {
      expect(SelectedReportReleaseStatusSchema.safeParse({
        attempt: null, selected: { ...receipt, automation_assurance: assurance },
      }).success).toBe(false);
    }
  });
});


it('preserves captured scope and transient read state at the snapshot boundary without requiring them in legacy payloads', () => {
  const metadata = { sheetsRead: [], cellsRead: 0, readDurationMs: 0, pipelineDurationMs: 0 };
  for (const state of ['refreshing', 'stale'] as const) {
    const wire = { ...metadata, targetYear: 2026, readModel: { state } };
    expect(DataSnapshotSchema.shape.metadata.parse(wire)).toEqual(wire);
  }
  expect(DataSnapshotSchema.shape.metadata.parse(metadata)).toEqual(metadata);
  expect(DataSnapshotSchema.shape.metadata.safeParse({ ...metadata, readModel: { state: 'complete' } }).success).toBe(false);
});
