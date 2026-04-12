import { describe, it, expect } from 'vitest';
import { REPORT_MAP, DEPARTMENT_IDS, DEPARTMENT_ROWS, COLUMNS } from './report-map.js';
import { RULE_BOOK } from './rule-book.js';

describe('REPORT_MAP', () => {
  it('has >200 entries', () => {
    expect(REPORT_MAP.length).toBeGreaterThan(200);
  });

  it('every entry has a valid sourceCell (column letter + row number)', () => {
    for (const e of REPORT_MAP) {
      expect(e.sourceCell).toMatch(/^[A-Z]{1,2}\d+$/);
    }
  });

  it('no duplicate metricKeys', () => {
    const keys = REPORT_MAP.map(e => e.metricKey);
    const dupes = keys.filter((k, i) => keys.indexOf(k) !== i);
    expect(dupes).toEqual([]);
  });

  it('all department IDs are covered', () => {
    const coveredDepts = new Set(REPORT_MAP.filter(e => e.departmentId).map(e => e.departmentId));
    for (const dept of DEPARTMENT_IDS) {
      expect(coveredDepts.has(dept)).toBe(true);
    }
  });

  it('every entry has required fields', () => {
    for (const e of REPORT_MAP) {
      expect(e.metricKey).toBeTruthy();
      expect(e.label).toBeTruthy();
      expect(e.sourceSheet).toBeTruthy();
      expect(e.sourceCell).toBeTruthy();
    }
  });
});

describe('DEPARTMENT_ROWS', () => {
  it('has all 8 departments', () => {
    expect(Object.keys(DEPARTMENT_ROWS)).toHaveLength(8);
    for (const dept of DEPARTMENT_IDS) {
      expect(DEPARTMENT_ROWS[dept]).toBeDefined();
    }
  });

  it('economy cells point to year row (kpYear/epYear), not multi-year (kpYear-1)', () => {
    for (const dept of DEPARTMENT_IDS) {
      const cfg = DEPARTMENT_ROWS[dept];
      // economyKpCell should be at kpYear row (year-specific), not kpYear-1 (multi-year)
      const kpEcoRow = parseInt(cfg.economyKpCell!.replace(/^[A-Z]+/, ''));
      expect(kpEcoRow).toBe(cfg.kpYear);
      // economyEpCell should be at epYear row
      const epEcoRow = parseInt(cfg.economyEpCell!.replace(/^[A-Z]+/, ''));
      expect(epEcoRow).toBe(cfg.epYear);
    }
  });

  it('economy per-budget cells (R/S/T) are at same row as total (U)', () => {
    for (const dept of DEPARTMENT_IDS) {
      const cfg = DEPARTMENT_ROWS[dept];
      const kpRow = cfg.economyKpCell!.replace(/^[A-Z]+/, '');
      expect(cfg.economyKpFbCell).toBe(`R${kpRow}`);
      expect(cfg.economyKpKbCell).toBe(`S${kpRow}`);
      expect(cfg.economyKpMbCell).toBe(`T${kpRow}`);
      const epRow = cfg.economyEpCell!.replace(/^[A-Z]+/, '');
      expect(cfg.economyEpFbCell).toBe(`R${epRow}`);
      expect(cfg.economyEpKbCell).toBe(`S${epRow}`);
      expect(cfg.economyEpMbCell).toBe(`T${epRow}`);
    }
  });
});

describe('ROW_COLUMN_DEFS coverage', () => {
  it('COLUMNS constant has entries D through U', () => {
    const expected = ['D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U'];
    for (const col of expected) {
      expect(col in COLUMNS).toBe(true);
    }
  });

  it('REPORT_MAP covers all 18 column suffixes per department row block', () => {
    const expectedSuffixes = [
      'count', 'fact', 'deviation', 'percent',
      'fb_plan', 'kb_plan', 'mb_plan', 'total_plan',
      'fb_fact', 'kb_fact', 'mb_fact', 'total_fact',
      'amount_dev', 'savings_pct',
      'economy_fb', 'economy_kb', 'economy_mb', 'economy_total',
    ];
    // Check first department (uer) KP Q1 block as representative
    const uerKpQ1Keys = REPORT_MAP
      .filter(e => e.metricKey.startsWith('grbs.uer.kp.q1.'))
      .map(e => e.metricKey.replace('grbs.uer.kp.q1.', ''));
    for (const suffix of expectedSuffixes) {
      expect(uerKpQ1Keys).toContain(suffix);
    }
  });
});

describe('RULE_BOOK', () => {
  it('has at least 13 rules', () => {
    expect(RULE_BOOK.length).toBeGreaterThanOrEqual(13);
  });

  it('every rule has required fields', () => {
    for (const rule of RULE_BOOK) {
      expect(rule.id).toBeTruthy();
      expect(rule.name).toBeTruthy();
      expect(rule.severity).toBeTruthy();
      expect(typeof rule.check).toBe('function');
    }
  });

  it('no duplicate rule IDs', () => {
    const ids = RULE_BOOK.map(r => r.id);
    const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
    expect(dupes).toEqual([]);
  });
});
