import { expect, it } from 'vitest';
import { departmentCoverage, sourceCoverageNote, SourceCoverageSchema } from './source-coverage.js';
import { DataSnapshotSchema } from './schemas.js';
import { collectRowsByDept } from './column-map.js';

it('does not infer completeness from a nonempty result or from zero findings', () => {
  const coverage = departmentCoverage(['УО', 'УД'], ['УО']);
  expect(coverage.complete).toBe(false);
  expect(sourceCoverageNote(coverage)).toContain('УД');
  expect(sourceCoverageNote(departmentCoverage(['УО'], ['УО']))).toBeNull();
  expect(sourceCoverageNote(undefined)).toContain('Нет сведений');
  expect(departmentCoverage([], []).complete).toBe(false);
  expect(sourceCoverageNote(departmentCoverage([], []))).toContain('Не задан перечень');

});
it('preserves the presence of a read master containing its three header rows and no positions', () => {
  expect(collectRowsByDept({ УО: [[], [], []], УД: [['#REF!']] })).toEqual({ УО: [] });
});

it('snapshot validation preserves coverage for every dashboard consumer', () => {
  const coverage = departmentCoverage(['УО', 'УД'], ['УО']);
  const metadata = { sheetsRead: [], cellsRead: 0, readDurationMs: 0, pipelineDurationMs: 0, sourceCoverage: coverage };
  expect(DataSnapshotSchema.shape.metadata.parse(metadata)).toEqual(metadata);
});

it('rejects forged complete, duplicate, contradictory and foreign coverage evidence', () => {
  const partial = departmentCoverage(['УО', 'УД'], ['УО']);
  expect(SourceCoverageSchema.safeParse({ ...partial, complete: true }).success).toBe(false);
  expect(SourceCoverageSchema.safeParse({ ...partial, unreadDepartments: [] }).success).toBe(false);
  expect(SourceCoverageSchema.safeParse({ ...partial, readDepartments: ['УО', 'УО'] }).success).toBe(false);
  expect(SourceCoverageSchema.safeParse({ ...partial, readDepartments: ['УО', 'ЧУЖОЙ'] }).success).toBe(false);
  expect(SourceCoverageSchema.safeParse(partial).success).toBe(true);
});
