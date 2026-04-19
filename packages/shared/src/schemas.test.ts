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
  TrustGradeSchema,
  DashboardDataSchema,
} from './schemas.js';
import { z } from 'zod';

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
    expect(keys).toContain('trust');
    expect(keys).toContain('lastRefreshed');
    expect(keys).toContain('snapshot');
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
