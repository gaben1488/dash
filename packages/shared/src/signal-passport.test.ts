import { describe, expect, it } from 'vitest';
import { CHECK_REGISTRY } from './check-registry.js';
import { isCurrentSignal, isNonPunitiveSignal, signalDisposition, signalPassportForIssue } from './signal-passport.js';

describe('C06.01 rule evidence/decision passport',()=>{
  it('covers existing catalogue with no invented evidence',()=>{
    expect(new Set(CHECK_REGISTRY.map(x=>x.id)).size).toBe(CHECK_REGISTRY.length);
    for(const check of CHECK_REGISTRY){
      const p=signalPassportForIssue({checkId:check.id,status:'open'});
      expect(p).toMatchObject({registered:true,checkId:check.id,name:check.name});
      expect(p.applicability.length).toBeGreaterThan(0);
      expect(p.action.length).toBeGreaterThan(0);
      expect(p.evidence.readableFromIssue).toBe(false);
    }
  });
  it('uses source addresses, never fictitious cell values',()=>{
    const p=signalPassportForIssue({checkId:'plan_year_missing',status:'open',
      sheet:'УО',cell:'N128',row:128,rowSeq:'57',departmentId:'uo'});
    expect(p.evidence).toMatchObject({columns:['L','K','N','P'],
      geometry:'dept',address:'УО!N128',readableFromIssue:true});
    expect(p.qualification).toMatch(/финансирован/);
    expect(p.qualification).not.toMatch(/нарушение/);
  });
  it('future dates, advance money, annual EP and discount are not legal or financial findings',()=>{
    expect(signalPassportForIssue({checkId:'future_economy_decision'}).qualification).toMatch(/официальную экономию/);
    expect(signalPassportForIssue({checkId:'future_fact_date'}).qualification).toMatch(/не подтверждает договор/);
    expect(signalPassportForIssue({checkId:'anti_dumping'}).qualification).toMatch(/НМЦК/);
    expect(signalPassportForIssue({checkId:'ep_risk'}).qualification).toMatch(/нарушение 44-ФЗ/);
    expect(isNonPunitiveSignal({checkId:'future_economy_decision'})).toBe(true);
    expect(isNonPunitiveSignal({checkId:'fact_without_date'})).toBe(true);
    expect(isNonPunitiveSignal({checkId:'foreign_year_execution'})).toBe(true);
  });
  it('unknown/historical keys never become verified cases',()=>{
    const p=signalPassportForIssue({checkId:'not-in-catalogue',cell:'K5'});
    expect(p.registered).toBe(false);
    expect(p.evidence.readableFromIssue).toBe(false);
    expect(signalPassportForIssue({checkId:'highEconomy'}).checkId).toBe('anti_dumping');
  });
  it('resolved requires recheck; false positive is suppressed, reopened is visible',()=>{
    expect(signalDisposition('resolved')).toBe('requires_source_readback');
    expect(signalDisposition('false_positive')).toBe('excluded_false_positive');
    expect(isCurrentSignal({status:'false_positive'})).toBe(false);
    expect(isCurrentSignal({status:'resolved'})).toBe(true);
    expect(isCurrentSignal({status:'wont_fix'})).toBe(true);
    expect(isCurrentSignal({status:'open'})).toBe(true);
    expect(signalPassportForIssue({checkId:'overdue',status:'resolved'}).closure).toMatch(/повторной проверки/);
  });
});
