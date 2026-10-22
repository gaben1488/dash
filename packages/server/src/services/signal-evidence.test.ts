import { describe, it, expect } from 'vitest';
import type { Issue, DataSnapshot } from '@aemr/shared';
import { signalEvidenceFromSnapshot } from './signal-evidence.js';

const ROW = new Array<unknown>(34).fill('');
ROW[0] = '173/18';
ROW[10] = '1200';
ROW[11] = 'ЕП';
ROW[13] = '';
ROW[15] = '';

const issue: Issue = {
  id:'evidence-1',severity:'warning',origin:'bi_heuristic',category:'signal:planYearMissing',
  title:'Без года плана',description:'Проверка N/P',sheet:'УО',row:4,
  rowSeq:'173/18',cell:'N4',checkId:'plan_year_missing',status:'open',
  detectedAt:'2026-04-13',detectedBy:'fixture',
};
const snap:Pick<DataSnapshot,'id'|'createdAt'|'rowsByDept'> = {
  id:'sealed-a',createdAt:'2026-04-13T08:00:00Z',rowsByDept:{ УО:[ROW] },
};

describe('C06.01: conservative captured cell evidence',()=>{
  it('delivers row, real cell values, check and dual address without new reads',()=>{
    const response=signalEvidenceFromSnapshot(snap,issue);
    expect(response).toMatchObject({source:'sealed_snapshot',snapshotId:'sealed-a',status:'row_identity_verified'});
    const r=response.answer.rows[0]!;
    expect(r.address).toContain('№ п/п 173/18');
    const byCol=Object.fromEntries(r.cells.map(c=>[c.column,c.value]));
    expect(byCol).toMatchObject({L:'ЕП',K:'1200',N:'пусто',P:'пусто'});
    expect(response.answer.condition).toContain('плановой даты');
  });
  it('wrong ordinal, duplicate identity and missing captured rows never expose unrelated data',()=>{
    const conflict=[
      {...issue,rowSeq:'173/1'},
      {...issue,row:5,cell:'N5'},
    ];
    for(const bad of conflict){
      const evidence=signalEvidenceFromSnapshot(snap,bad);
      expect(evidence.status).toBe('identity_not_verified');
      expect(evidence.answer.rows[0]!.cells.every(c=>c.value==='строка не прочитана')).toBe(true);
    }
    const repeated=signalEvidenceFromSnapshot({...snap,rowsByDept:{УО:[ROW,[...ROW]]}},issue);
    expect(repeated.status).toBe('identity_not_verified');
    expect(repeated.answer.rows[0]!.cells.every(c=>c.value==='строка не прочитана')).toBe(true);
    const missing=signalEvidenceFromSnapshot({...snap,rowsByDept:undefined},issue);
    expect(missing.status).toBe('identity_not_verified');
  });
  it('cannot borrow SVOD or another source with a matching positional row',()=>{
    const alien=signalEvidenceFromSnapshot(snap,{...issue,sheet:'СВОД ТД-ПМ'});
    expect(alien.status).toBe('identity_not_verified');
  });
});
