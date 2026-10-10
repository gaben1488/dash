import { describe, expect, it } from 'vitest';
import type { Issue } from './types.js';
import { buildControlCases } from './control-cases.js';
import { buildControlCaseGuide, controlCaseSourceAddress } from './control-case-guide.js';

function finding(patch: Partial<Issue> = {}): Issue {
  return {
    id: 'original-issue-173/1', severity: 'critical', origin: 'spreadsheet_rule',
    category: 'rule:formula_mutant', checkId: 'formula_mutant',
    departmentId: 'uo', sheet: 'ВСЕ', row: 44, rowSeq: '173/1', cell: 'K44',
    title: 'Формула отличается от эталона',
    description: 'Нужно проверить формулу',
    status: 'open', detectedAt: '2026-10-10T00:00:00.000Z',
    detectedBy: 'unit-test', ...patch,
  };
}
const guide = (patch: Partial<Issue> = {}) =>
  buildControlCaseGuide(buildControlCases([finding(patch)])[0]);

describe('canonical four-step control-case guide', () => {
  it('retains the exact address and original observation, but makes no fake verified effect', () => {
    const g = guide();
    expect(g.sourceAddress).toContain('№ п/п 173/1');
    expect(g.sourceAddress).toContain('K44');
    expect(g.verificationRequired).toBe(true);
    expect(g.steps.map(s => s.id)).toEqual(['understand', 'evidence', 'action', 'recheck']);
    expect(g.steps[1].description).toContain('Исходных наблюдений: 1');
    expect(g.steps[3].proven).toBe(false);
    expect(g.potentialConsequence).not.toMatch(/подтверждённый ущерб/i);
  });
  it('treats acknowledged and resolved as work states, not verified closure', () => {
    expect(guide({ status: 'acknowledged' }).currentInstruction).toContain('Вопрос принят');
    const resolved = guide({ status: 'resolved' });
    expect(resolved.currentInstruction).toContain('не подтверждено независимым');
    expect(resolved.verificationRequired).toBe(true);
  });
  it('cannot convict from an automatic legal indicator', () => {
    const g = guide({ checkId: 'ep_risk', origin: 'compliance_44fz' as Issue['origin'] });
    expect(g.whoCanHelp).toContain('юрист');
    expect(g.potentialConsequence).toContain('не устанавливает нарушение');
    expect(g.currentInstruction).toContain('пункт законного основания');
    expect(g.currentInstruction).not.toContain('Закупку необходимо отменить');
  });
  it('explicitly separates a reader/network error from human responsibility', () => {
    const g = guide({ origin: 'runtime_error' });
    expect(g.whoCanHelp).toContain('Администратор');
    expect(g.potentialConsequence).toContain('не нарушение исполнителя');
  });
  it('never applies one of two mutually incompatible source recommendations', () => {
    const cases = buildControlCases([
      finding({ id: 'a', recommendation: 'Уточнить год' }),
      finding({ id: 'b', recommendation: 'Удалить закупку' }),
    ]);
    expect(cases).toHaveLength(1);
    const g = buildControlCaseGuide(cases[0]);
    expect(g.currentInstruction).toContain('несовместимые');
    expect(g.currentInstruction).not.toContain('Удалить закупку');
  });
  it('handles sheet-level findings without a made-up row location', () => {
    const c = buildControlCases([finding({
      id: 'sheet', checkId: undefined, row: undefined, rowSeq: undefined, cell: undefined, sheet: undefined,
    })])[0];
    expect(controlCaseSourceAddress(c)).toContain('точный адрес не установлен');
  });
});
