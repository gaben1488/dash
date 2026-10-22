/**
 * C06.01: regression from source-row detector to a single check passport.
 * This proves the definitions, not a live Google/SQLite readback.
 */
import { describe, expect, it } from 'vitest';
import { isNonPunitiveSignal, isTrustIssueApplicable, signalPassportForIssue } from '@aemr/shared';
import { detectSignals } from './signals.js';

const AS_OF = new Date('2026-04-13T10:00:00+12:00');
const BASE: Record<string, unknown> = {
  A:'173/18', B:'УО', C:'', F:'Текущая деятельность', G:'Предмет',
  H:0, I:0, J:1000, K:1000, L:'ЭА', M:'',
  N:'15.03.2026', O:1, P:2026, Q:'', Y:0, V:0, W:0, X:0,
  Z:0, AA:0, AB:0, AC:0, AD:'', U:'', AE:'', AF:'',
};
function row(values:Record<string,unknown>) {
  return detectSignals({ ...BASE, ...values }, AS_OF);
}

describe('C06.01: source semantics across the shared passport', () => {
  it('no N/P means financing review, never blame or a second plan-not-executed risk', () => {
    const signal = row({N:'',P:'',K:1000,L:'ЭА'});
    expect(signal.planYearMissing).toBe(true);
    expect(signal.planWithoutExecution).toBe(false);
    const passport = signalPassportForIssue({checkId:'plan_year_missing',status:'open',
      sheet:'УО',cell:'N128',rowSeq:'173/18',departmentId:'uo'});
    expect(passport.evidence.address).toBe('УО!N128');
    expect(passport.qualification).toMatch(/финансирован/);
    expect(passport.qualification).not.toMatch(/нарушение/);
  });

  it('future Q is reviewable but not an already signed/recorded result', () => {
    const signal = row({Q:'15.07.2027',N:'30.06.2026'});
    expect(signal.futureFactDate).toBe(true);
    const passport = signalPassportForIssue({checkId:'future_fact_date'});
    expect(passport.qualification).toMatch(/не подтверждает договор/);
  });

  it('limit minus annual fact never proves anti-dumping, nor official AD economy', () => {
    const signal = row({L:'ЭА',N:'15.03.2026',Q:'12.04.2026',K:1000,Y:600});
    expect(signal.highEconomy).toBe(true);
    expect(signal.economyFlag).toBe(false);
    const passport = signalPassportForIssue({checkId:'anti_dumping'});
    expect(passport.qualification).toContain('НМЦК');
    expect(passport.qualification).not.toMatch(/установлено нарушение/);
  });

  it('annual EP must not turn into one contract priced above a threshold', () => {
    const signal = row({L:'ЕП',K:1200,Y:800,Q:'',M:''});
    expect(signal.epRisk).toBe(true);
    expect(signal.highEconomy).toBe(false);
    const passport = signalPassportForIssue({checkId:'ep_risk'});
    expect(passport.qualification).toContain('не устанавливает нарушение');
  });

  it('false-positive resolves by human decision; unresolved observation survives claimed repair', () => {
    const signal = {checkId:'overdue',status:'resolved' as const};
    expect(isTrustIssueApplicable(signal)).toBe(true);
    expect(isTrustIssueApplicable({...signal,status:'false_positive'})).toBe(false);
    expect(isTrustIssueApplicable({...signal,status:'wont_fix'})).toBe(true);
    expect(isNonPunitiveSignal({checkId:'future_economy_decision'})).toBe(true);
    expect(isTrustIssueApplicable({checkId:'future_economy_decision',status:'open'})).toBe(false);
  });
});
