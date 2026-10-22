import { describe, expect, it } from 'vitest';
import { CHECK_REGISTRY, TRUST_COMPONENT_CONFIG } from '@aemr/shared';
import { dataQualityScore, indexDataQualityRows } from './analytics.js';

type Input = Parameters<typeof indexDataQualityRows>[0][number];

// Independent pre-optimization reference. Rule precedence, two key spellings,
// absent row -> -1 and exclusions are kept explicit as the evidence oracle.
function reference(issues: readonly Input[], id: string, short: string, rows: number): number | null {
  if (rows <= 0) return null;
  const dirty = new Set<number>();
  for (const issue of issues) {
    if (issue.status === 'false_positive' || issue.origin === 'runtime_error'
      || issue.category === 'signal:planYearMissing' || issue.category === 'signal:factWithoutDate'
      || issue.checkId === 'plan_year_missing' || issue.checkId === 'fact_without_date') continue;
    const rule = issue.checkId ? CHECK_REGISTRY.find(check => check.id === issue.checkId || check.legacyId === issue.checkId) : undefined;
    const quality = rule ? rule.trustComponent === 'data_quality'
      : (TRUST_COMPONENT_CONFIG.data_quality.issueGroups.some(group => group === issue.group)
        || issue.group === 'data_quality' || issue.category === 'signal:dataQuality'
        || issue.category === 'signal:dateWithoutFact');
    if (!quality || (issue.departmentId !== id && issue.departmentId !== short)) continue;
    dirty.add(issue.row ?? -1);
  }
  return Math.min(1, Math.max(0, 1 - dirty.size / rows));
}

describe('scorecard: one-pass data quality without changing source meaning', () => {
  it('matches the original per-department scan for duplicate rows and mixed latin/Cyrillic keys', () => {
    const issues: Input[] = [
      { departmentId: 'uo', row: 8, category: 'signal:dataQuality' },
      { departmentId: 'УО', row: 8, category: 'signal:dataQuality' },
      { departmentId: 'УО', row: 9, category: 'signal:dateWithoutFact' },
      { departmentId: 'uo', row: 10, category: 'signal:planYearMissing' },
      { departmentId: 'uo', row: 11, category: 'signal:dataQuality', status: 'false_positive' },
      { departmentId: 'uo', row: 12, category: 'signal:dataQuality', origin: 'runtime_error' },
      { departmentId: 'ud', category: 'signal:dataQuality' },
      { departmentId: 'УД', category: 'signal:dataQuality' },
      { departmentId: 'uo', row: 14, group: 'unknown', checkId: 'no-such-rule' },
    ];
    const index = indexDataQualityRows(issues);
    for (const [id, short] of [['uo', 'УО'], ['ud', 'УД'], ['uer', 'УЭР']] as const) {
      for (const rowCount of [0, 1, 4, 100]) {
        expect(dataQualityScore(index, id, short, rowCount)).toBe(reference(issues, id, short, rowCount));
      }
    }
    expect(issues[0].row).toBe(8); // no mutation of historical evidence
  });

  it('keeps authoritative rule membership before fallback categories', () => {
    const dataQualityCheck = CHECK_REGISTRY.find(check => check.trustComponent === 'data_quality');
    const otherCheck = CHECK_REGISTRY.find(check => check.trustComponent !== 'data_quality');
    expect(dataQualityCheck).toBeDefined();
    expect(otherCheck).toBeDefined();
    const issues: Input[] = [
      { departmentId: 'uo', row: 10, checkId: dataQualityCheck!.id },
      { departmentId: 'uo', row: 11, checkId: otherCheck!.id, category: 'signal:dataQuality' },
    ];
    const index = indexDataQualityRows(issues);
    expect(dataQualityScore(index, 'uo', 'УО', 20)).toBe(reference(issues, 'uo', 'УО', 20));
  });

  it('matches reference for many issues across eight departments without stale cross-request state', () => {
    const ids = ['uo', 'ud', 'uer', 'ufbp', 'udtx', 'uksimp', 'uio', 'uagzo'];
    const aliases = ['УО', 'УД', 'УЭР', 'УФБП', 'УДТХ', 'УКСиМП', 'УИО', 'УАГЗО'];
    const issues: Input[] = Array.from({ length: 12_000 }, (_, n) => ({
      departmentId: n % 3 === 0 ? aliases[n % ids.length] : ids[n % ids.length],
      row: n % 197,
      category: n % 11 === 0 ? 'signal:planYearMissing' : 'signal:dataQuality',
      status: n % 13 === 0 ? 'false_positive' : 'open',
    }));
    const index = indexDataQualityRows(issues);
    ids.forEach((id, n) => expect(dataQualityScore(index, id, aliases[n], 250))
      .toBe(reference(issues, id, aliases[n], 250)));
    const unrelated = indexDataQualityRows([]);
    expect(dataQualityScore(unrelated, 'uo', 'УО', 250)).toBe(1);
    expect(dataQualityScore(index, 'uo', 'УО', 250)).toBeLessThan(1);
  });
});
