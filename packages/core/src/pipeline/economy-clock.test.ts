import { describe, expect, it } from 'vitest';
import { RULE_BOOK } from '@aemr/shared';
import { computeTrustScore } from '../trust/scorer';
import { detectSignals, getSignalBadges } from './signals';
import { runPipeline } from './orchestrator';
const rule = RULE_BOOK.find(r => r.id === 'status_on_data_rows')!;
function input(asOf: Date) {
  const row: unknown[] = Array(34).fill('');
  row[0] = '999'; row[6] = 'Synthetic closed position'; row[10] = 100;
  row[11] = 'ЭА'; row[16] = '15.06.2026'; row[24] = 80;
  return { spreadsheetId: 'test', batchGetData: [], sheetRows: { УЭР: [[], [], [], row] },
    rules: [rule], reportMap: [], asOf };
}
describe('one explicit snapshot clock for economy rules and row signals', () => {
  it.each([
    ['2026-06-14T11:59:59Z', 0, 0],
    ['2026-06-14T12:00:00Z', -90, 1],
    ['2026-06-15T12:00:00Z', -90, 1],
  ])('uses the same Kamchatka closing day for calculated economy at %s', (instant, economy, count) => {
    const sample = input(new Date(instant));
    const row = sample.sheetRows.УЭР[3]!;
    row[5] = 'Текущая деятельность'; row[7] = 100;
    row[13] = '15.06.2026'; row[14] = 2; row[15] = 2026;
    row[21] = 80; row[25] = -100; row[26] = 10; row[29] = 'да';
    const snapshot = runPipeline(sample);
    const result = snapshot.recalcResults!.uer!;
    expect(result.year.economyTotal).toBe(economy);
    expect(result.year.factCount).toBe(count);
    expect(snapshot.issues.some(issue => issue.signal === 'futureFactDate')).toBe(count === 0);
    row[29] = '';
    expect(runPipeline(sample).issues.some(issue => issue.checkId === 'status_on_data_rows')).toBe(count === 1);
  });
  it('does not re-evaluate a historical future Q against current wall time', () => {
    const asOf = new Date(2026, 0, 10);
    const snapshot = runPipeline(input(asOf));
    expect(snapshot.createdAt).toBe(asOf.toISOString());
    expect(snapshot.issues.filter(i => i.checkId === 'status_on_data_rows')).toEqual([]);
    // A separate real temporal signal proves the row-signal path received this same clock.
    expect(snapshot.issues.some(i => i.signal === 'futureFactDate')).toBe(true);
  });
  it('detects the existing economy mark case on the exact closing day', () => {
    const snapshot = runPipeline(input(new Date(2026, 5, 15)));
    expect(snapshot.issues.some(i => i.checkId === 'status_on_data_rows')).toBe(true);
  });
  it.each([null, '2026-01-10', 0, new Date(NaN)])('rejects invalid explicit clock %s without falling back to today', value => {
    expect(() => runPipeline(input(value as unknown as Date))).toThrow('INVALID_SNAPSHOT_AS_OF');
  });
});

describe('future decision preparation uses one shared verdict', () => {
  it('emits exactly one informative reminder, with a passed rule and no premature high economy', () => {
    const sample = input(new Date(2026, 0, 10));
    sample.sheetRows.УЭР[3]![24] = 20;
    const snapshot = runPipeline(sample);
    const upcoming = snapshot.issues.filter(i => i.checkId === 'future_economy_decision');
    expect(upcoming).toHaveLength(1);
    expect(upcoming[0]?.severity).toBe('info');
    expect(upcoming[0]?.recommendation).toContain('ГРБС/УФ');
    expect(snapshot.issues.some(i => i.signal === 'highEconomy')).toBe(false);
    const check = rule.check({ cells: { K:100, Y:20, L:'ЭА', Q:'15.06.2026' }, rowIndex:4, sheet:'УЭР', classification:'procurement', asOf:sample.asOf } as Parameters<typeof rule.check>[0]);
    expect(check.passed).toBe(true);
    expect(check.message).toContain('ГРБС/УФ');
  });
  it('does not flag a partial EP position as closed deviation before Q', () => {
    const sample = input(new Date(2026, 0, 10));
    sample.sheetRows.УЭР[3]![11] = 'ЕП';
    expect(runPipeline(sample).issues.some(i => i.signal === 'epFactDeviation')).toBe(false);
  });
});

describe('annual-series future date is an expected informational state, not date certification', () => {
  function annual() {
    const row: unknown[] = Array(34).fill('');
    row[0]='3'; row[6]='Окорока (куриные)'; row[10]=100; row[11]='ЕП';
    row[13]='15.06.2026'; row[15]=2026; row[16]='15.06.2026'; row[24]=80;
    return { spreadsheetId:'test', batchGetData:[], sheetRows:{ УКСиМП:[[],[],[],row] }, rules:[rule], reportMap:[], asOf:new Date(2026,0,10) };
  }
  it('keeps Q verification visible with no critical temporal verdict for an exact series anchor', () => {
    const snapshot = runPipeline(annual());
    const date = snapshot.issues.find(i => i.signal === 'futureFactDate');
    expect(date?.severity).toBe('info');
    expect(date?.recommendation).toContain('Сверить');
    const info=snapshot.issues.filter(i=>i.signal==='futureFactDate' || i.checkId==='future_economy_decision');
    const baseline=computeTrustScore(new Map(),[],[],'same');
    const scored=computeTrustScore(new Map(),info,[],'same');
    expect(scored.overall).toBe(baseline.overall);
    expect(scored.components.map(c=>c.score)).toEqual(baseline.components.map(c=>c.score));
  });
  it.each([['15.06.2027',2026,'significant'], ['15.06.2026',2027,'info'], ['',2026,'significant']])('uses N=%s instead of P=%s for series display', (n,p,severity) => {
    const sample=annual(); sample.sheetRows.УКСиМП[3]![13]=n; sample.sheetRows.УКСиМП[3]![15]=p;
    expect(runPipeline(sample).issues.find(i=>i.signal==='futureFactDate')?.severity).toBe(severity);
  });
  it.each(['subject','year','number'])('does not inherit annual classification after %s changes', field => {
    const sample=annual(); const row=sample.sheetRows.УКСиМП[3]!;
    if(field==='subject') row[6]='Different purchase';
    if(field==='year') row[13]='15.06.2027';
    if(field==='number') row[0]='999';
    expect(runPipeline(sample).issues.find(i=>i.signal==='futureFactDate')?.severity).toBe('significant');
  });
});

describe('preparation negatives and non-punitive visible state', () => {
  const asOf = new Date(2026,0,10);
  const cells = { K:100, Y:20, L:'ЭА', Q:'15.06.2026' };
  it.each([{AD:'да'}, {AD:'нет'}, {Q:''}, {Y:100}, {L:''}, {L:'ЕП',M:'Естественный монополист'}, {Y:0,V:80}, {Y:'',V:80}, {Y:null,V:80}])('same negative preparation in signals/rule %j', change => {
    const row={...cells,...change};
    expect(detectSignals(row,asOf).economyDecisionUpcoming).toBe(false);
    const result=rule.check({cells:row,rowIndex:4,sheet:'УЭР',classification:'procurement',asOf} as Parameters<typeof rule.check>[0]);
    expect(result.message ?? '').not.toContain('ГРБС/УФ');
  });
  it('info reminder and anchored annual Q leave all five scores unchanged', () => {
    const sample=input(asOf); const snapshot=runPipeline(sample);
    const reminder=snapshot.issues.filter(i=>i.checkId==='future_economy_decision');
    const baseline=computeTrustScore(new Map(),[],[],'same');
    const scored=computeTrustScore(new Map(),reminder,[],'same');
    expect(scored.overall).toBe(baseline.overall);
    expect(scored.components.map(c=>c.score)).toEqual(baseline.components.map(c=>c.score));
    expect(getSignalBadges(detectSignals(cells,asOf)).find(b=>b.label==='Подготовить решение после завершения')?.color).toBe('blue');
    const context={dept:'УКСиМП',id:'3',subject:'Окорока (куриные)',method:'ЕП',factDateRaw:cells.Q,planDateRaw:'15.06.2026',factSum:20,amountBasis:'position-total' as const,planYear:2026};
    const badges=getSignalBadges(detectSignals({...cells,L:'ЕП'},asOf),context);
    expect(badges.find(b=>b.icon==='calendar-x')?.color).toBe('blue');
    expect(getSignalBadges(detectSignals(cells,asOf)).find(b=>b.icon==='calendar-x')?.color).toBe('yellow');
  });
  it('future preparation ends at Q without changing the source decision', () => {
    expect(detectSignals(cells,asOf).economyDecisionUpcoming).toBe(true);
    const closed=detectSignals(cells,new Date(2026,5,15));
    expect(closed.economyDecisionUpcoming).toBe(false);
    expect(closed.economyFlagUndetermined).toBe(true);
  });
});
