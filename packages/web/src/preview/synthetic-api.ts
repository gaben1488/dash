/**
 * Entirely synthetic, fail-closed API adapter for the REAL Dash React app.
 *
 * Never fetch a live source, open Google credentials, or write to a service.
 * The transport is installed before dynamic import('../main').
 * Unknown contracts are errors — never invent successes just to fill a page.
 */
import { dayNumberOf } from '@aemr/shared';
import { makeReportFixture } from '../lib/report/fixture';

const asOf = '2026-10-09T09:18:00+12:00';
const year = 2026;
const departments = [
  ['uer', 'УЭР', 'Управление экономического развития'],
  ['uio', 'УИО', 'Управление имущественных отношений'],
  ['uagzo', 'УАГЗО', 'Управление архитектуры'],
  ['ufbp', 'УФБП', 'Управление финансов'],
  ['ud', 'УД', 'Администрация'],
  ['udtx', 'УДТХ', 'Управление дорожного хозяйства'],
  ['uksimp', 'УКСиМП', 'Управление культуры, спорта и молодёжной политики'],
  ['uo', 'УО', 'Управление образования'],
] as const;

const subs: Record<string,string[]> = Object.fromEntries(
  departments.map(([,short]) => [short, [
    short + ' — учреждение А (демо)',
    short + ' — учреждение Б (демо)',
  ]]),
);
const pct = (a: number, b: number): number | null => b > 0 ? +(a / b * 100).toFixed(1) : null;
const period = (scale: number) => ({
  planCount: 18 * scale, factCount: 12 * scale,
  kpCount: 11 * scale, kpFactCount: 8 * scale,
  epCount: 7 * scale, epFactCount: 4 * scale,
  kpPlanTotal: 900 * scale, kpFactTotal: 660 * scale,
  epPlanTotal: 400 * scale, epFactTotal: 270 * scale,
  planTotal: 1300 * scale, factTotal: 930 * scale,
  economyTotal: 60 * scale,
  planFB: 300 * scale, planKB: 400 * scale, planMB: 600 * scale,
  factFB: 210 * scale, factKB: 300 * scale, factMB: 420 * scale,
  economyFB: 20 * scale, economyKB: 20 * scale, economyMB: 20 * scale,
  executionPct: pct(930,1300),
  execCountPct: pct(12,18),
  kpPercent: pct(8,11),
  epPercent: pct(4,7),
});
const quarterKeys = ['q1','q2','q3','q4'] as const;
const departmentSummaries = departments.map(([id, short, name], i) => {
  const factor = i + 1;
  const quarters = Object.fromEntries(quarterKeys.map((q,j) => [q, period((j+1)*factor)]));
  quarters.year = period(10*factor);
  return {
    department: { id, name, nameShort:short, sheetName:short, svodRange:{startRow:1,endRow:50}, controlCells:{} },
    planTotal: 13000 * factor, factTotal:9300 * factor, executionPercent:pct(9300,13000),
    economyTotal:600 * factor, economyFB:200*factor,economyKB:200*factor,economyMB:200*factor,
    competitiveCount:110*factor, soleCount:70*factor, planCount:180*factor,factCount:120*factor,
    issueCount:i%3,criticalIssueCount:0,trustScore:86-i*3,status:'normal',
    quarters, months:{},subordinates:[],
    signalCounts:{},byActivity:{},economyConflicts:0,
  };
});
const summaryByPeriod = Object.fromEntries([...quarterKeys,'year'].map((key,i) => {
  const factor = i === 4 ? 10 : i+1;
  const k = departments.length * factor;
  return [key,{
    kpCount:11*k,kpFactCount:8*k,kpPlan:900*k,kpFact:660*k,kpPercent:8/11,
    epCount:7*k,epFactCount:4*k,epPlan:400*k,epFact:270*k,epPercent:4/7,
    fbPlan:300*k,kbPlan:400*k,mbPlan:600*k,fbFact:210*k,kbFact:300*k,mbFact:420*k,
    source:'calculated',
  }];
}));
const trust = { overall:82,grade:'B',components:[],computedAt:asOf,basedOnSnapshot:'PREVIEW-ONLY' };
const snapshot = {
  id:'SYNTHETIC-PREVIEW-SNAPSHOT', spreadsheetId:'NOT-A-REAL-GOOGLE-ID',createdAt:asOf,
  officialMetrics:{},calculatedMetrics:{},deltas:[],issues:[],trust,rowCount:144,
  metadata:{sheetsRead:departments.map(x=>x[1]),cellsRead:4096,readDurationMs:0,pipelineDurationMs:0},
};
const dashboard = {
  snapshot, trust, kpiCards:[], departmentSummaries,summaryByPeriod,
  recentIssues:[],signalCounts:{},issueSummary:{
    total:0,bySeverity:{},byCategory:{},byDepartment:{},byOrigin:{},signalCounts:{},
  },
  lastRefreshed:asOf,year,
};

const demoRows = departments.flatMap(([id,short],i) => [0,1,2].map((j) => ({
  rowIndex:11+i*8+j, rowRevision:'a'.repeat(64), id:j===1 ? '173/1' : String(10+i*3+j),
  managementName:short,subordinate:subs[short][j%2],
  dept:id,subject:['Поставка оборудования — демонстрация','Работы по содержанию — демонстрация','Лицензии и сопровождение — демонстрация'][j],
  programName:'X',type:j===2?'ТД':'ПМ',planDate:'2026-10-15',planDateRaw:'15.10.2026',
  factDate:j===2?null:'2026-10-09',factDateRaw:j===2?null:'09.10.2026',
  planYear:2026,planQuarter:'4',factQuarter:'4',method:j===1?'ЕП':'ЭА',
  planFB:200+j*10,planKB:150,planMB:100,planSum:450+j*10,
  factFB:j===2?0:180,factKB:j===2?0:130,factMB:j===2?0:90,factSum:j===2?0:400,
  economy:j===2?0:50, economyFB:20,economyKB:20,economyMB:10,
  economyPercent:10,epReason:j===1?'Основание указано в тестовой книге':'',
  deviationDays:0,flag:'да',commentGRBS:'Проверить этап — демо',
  commentExtra:'',commentUFBP:'',status:j===2?'Подготовка':'Подписан',
  state:j===2?'planning':'signed',signals:[],badges:[],
})));

const proc = (i:number) => ({
  sheet:'Рабочий реестр процедур',row:10+i,dept:departments[i%8][1],
  ppNum:String(i+1),customer:departments[i%8][1]+' — учреждение А (демо)',
  code:['ЭА101-26','ЭА102-26','ЭЗК103-26','ЭА104-26'][i],sourceCode:['ЭА101-26','ЭА102-26','ЭЗК103-26','ЭА104-26'][i],
  subject:['Поставка оборудования','Работы по содержанию','Сопровождение систем','Поставка мебели'][i]+' — демонстрация',
  nmck:1200000+i*240000,auctionPrice:i===3?null:1100000+i*200000,
  savingsTotal:i===3?null:100000+i*40000,savingsMb:50000,savingsKb:50000,savingsFb:0,
  stage:i===3?'preparation':'completed',year:2026,
  applicationDate:'2026-09-01',publicationDate:'2026-09-07',deadlineDate:'2026-09-19',
  auctionDate:i===3?null:'2026-09-23',winnerName:i===3?null:'Условный поставщик',
  selfCheck:'верно',durations:{toPublication:6,toDeadline:12,toAuction:4,total:22},
  defects:[],comment:'Тестовый сценарий',requiredAction:i===3?'Уточнить дату размещения':null,
});
const procedures=Array.from({length:4},(_,i)=>proc(i));
const monitoringSource={
  schema:'canonical',bookName:'План-реестр процедур — тестовое чтение',version:1,
  readAt:asOf,asOf:'2026-10-09',moneyUnit:'руб',bookUrl:null,
  sheetsRead:['Рабочий реестр процедур','Сводный аналитический лист','Справочник заказчиков'],
  sheetsFailed:{},sheetsExpected:3,
};
const monitoring = {
  source:monitoringSource,procedures,aggregates:{
    total:procedures.length,byStage:{completed:3,preparation:1},nmckTotal:5520000,
    awarded:{count:3,nmckTotal:4080000,priceTotal:3700000,savingsTotal:380000,portfolioReductionPct:9.3,
      avgReductionPct:9.3,avgReductionWhenReducedPct:9.3,noReductionCount:0},codesParsed:4,codesUnparsed:0,
  },
  work:{asOf:'2026-10-09',active:[{procedure:procedures[3],action:'Уточнить дату',referenceDate:'2026-10-12',daysToDate:3}],
    closed:procedures.slice(0,3).map(p=>({procedure:p,action:'Завершено',referenceDate:null,daysToDate:null})),triage:[]},
  svod:{rows:[],notes:['Демонстрационный лист; приёмка полных строк не проведена']},
  journal:{rows:[],lineage:[],notes:[]},
  directory:{entries:departments.map(([,short,name],i)=>({sheet:'Справочник заказчиков',row:i+2,
    ordinal:i+1,grbs:short,fullName:name+' (пример)',shortName:short+' — демо',usageCount:3})),customersOutside:[]},
  suppliers:{readAt:asOf,error:null,rows:[]},
  ancestors:{sheets:[],missingFields:[]},signals:[],unparsedCodes:[],
  notes:['Все процедуры в этом прототипе вымышленные. Исходная структура UI — production.'],
};

function fixture(path:string): unknown | undefined {
  if(path==='/dashboard') return dashboard;
  if(path==='/rows/subordinates') return subs;
  if(path==='/registry/buckets') return {asOf,source:'snapshot',unfunded:{rows:4,planSum:1500},yearlong:{rows:3,planSum:990}};
  if(path==='/report'){
    const raw=makeReportFixture();
    const p={year,quarter:1,asOfDay:dayNumberOf('2026-10-09') ?? 0,live:true};
    return {...raw,period:p,methodology:'Только демонстрационные данные; расчёты из тестовой фикстуры.',
      svodOnlineUrl:undefined};
  }
  if(path==='/monitoring') return monitoring;
  if(path==='/monitoring/analytics') return {source:monitoringSource,analytics:{},notes:['Демо-аналитика не подключена']};
  if(path==='/monitoring/match') return {source:monitoringSource,summary:{},rows:[],notes:['Демо-сверка не выполнена']};
  if(path==='/monitoring/triple') return {source:monitoringSource,items:[],notes:[]};
  if(path==='/history/snapshots') return [];
  if(path==='/history/diff') return [];
  if(path==='/metrics') return {official:{},calculated:{},deltas:[]};
  if(path==='/issues') return {issues:[],pagination:{page:1,limit:25,total:0,totalPages:0},
    counts:{total:0,byStatus:{},bySeverity:{}}};
  if(path==='/trust') return trust;
  if(path==='/journal') return {entries:[],pagination:{page:1,limit:25,total:0,totalPages:0},
    counts:{total:0,byAction:{}}};
  if(path==='/journal/stats') return {period:'2026',totalActions:0,uniqueUsers:0,snapshotCount:1,
    editCount:0,errorCount:0,issueCreated:0,issueResolved:0};
  if(path==='/reconciliation') return {rows:[],summary:{},year};
  if(path==='/reconciliation/monthly') return {rows:[],summary:{}};
  if(path==='/svod/unified') return {year,grid:{cells:{}},reconciliation:[]};
  if(path==='/report-recommendations') return {revision:'DEMO-1',records:[],counts:{active:0,historical:0,uerAuthored:0}};
  if(path==='/changes') return {since:asOf,total:0,records:[]};
  if(path==='/events') return {events:[],entries:[],latest:[],total:0,newIssues:0};
  if(path==='/report-releases') return {latest:null,release:null,status:'NOT_AVAILABLE',history:[]};
  if(path==='/workload') return {items:[],rows:[],summary:{},counts:{total:0},departments:[]};
  if(path==='/anomalies') return {rows:[],summary:{},byDepartment:{},departments:[]};
  if(path==='/integrity') return {rows:[],issues:[],checks:[],summary:{},books:[]};
  if(path==='/analytics/scorecard') return {};
  if(path==='/annotations/yearlong') return {overrides:[],total:0};
  if(path==='/annotations/comments') return {asOf,source:'snapshot',rowsScanned:0,total:0,byKind:{},annotations:[]};
  if(path==='/sources') return {sources:departments.map(([,short])=>({name:short,type:'sheet',
    spreadsheetId:null,status:'unknown',statusLabel:'Демонстрационный источник',lastSuccess:asOf,rowCount:3})),
    totalSources:8,onlineCount:0,errorCount:0};
  if(path==='/sources/integrity') return {at:asOf,formulas:{columns:[],sinkConnected:false,books:[],notRead:departments.map(d=>d[1])},
    metadata:{canonSyncedAt:null,books:[],notWatched:[]}};
  if(path==='/settings/status') return {configured:false,server:true,google:false,
    message:'Тестовый режим — ключи и подключение отсутствуют'};
  if(path==='/mapping') return {mapping:[],overrides:[],total:0};
  if(path==='/rows/subjects') return {subjects:[],total:0};
  if(path==='/rows/scatter') return {points:[],unreadDepartments:[],truncated:false,pointLimit:100};
  if(path==='/analytics/profiles') return {profiles:[],byDepartment:{},departments:[]};
  if(path==='/analytics/compliance') return {totalIssues:0,critical:0,warnings:0,issues:[]};
  if(path==='/analytics/ep-reasons') return {byDept:{},justification:{byDept:{},rowsScanned:0,readAt:asOf}};
  if(path==='/analytics/anomalies') return {rows:[],departments:[],summary:{}};
  if(path==='/analytics/subjects') return {groups:[],rows:[]};
  if(path==='/analytics/centralization') return {opportunities:[],totalOpportunities:0,totalAmount:0,totalEpAmount:0};
  if(path.startsWith('/analytics/forecast/')) return {forecast:[],rows:[],trend:[]};
  if(path==='/cell-refs') return {refs:[],total:0};
  if(path==='/timeline/upcoming') return {asOf:'2026-10-09',days:14,total:0,rows:[],monitoringLinked:true};
  if(path.startsWith('/timeline/')) return {events:[],coverage:{journalAvailable:false,journalEntries:0,snapshotObservations:0,weekSliceDates:[]}};
  if(path==='/health') return {status:'ok',service:'Dash local preview',timestamp:asOf};
  if(path==='/report-map') return {entries:[],metrics:[]};
  if(path==='/refresh') return {success:true,quick:true,previewOnly:true};
  if(path.startsWith('/rows/') && /^\/rows\/[^/]+$/.test(path)){
    const dept=decodeURIComponent(path.slice('/rows/'.length));
    const rows=demoRows.filter(r=>r.dept===dept || departments.some(d=>d[0]===r.dept && d[1]===dept));
    return {department:departments.find(d=>d[0]===dept)||null,rows,pagination:{page:1,limit:1000,total:rows.length,totalPages:1},
      signals:{signed:rows.filter(r=>r.state==='signed').length,overdue:0,planning:rows.filter(r=>r.state==='planning').length,canceled:0,hasFact:0,total:rows.length}};
  }
  return undefined;
}

export function installSyntheticApi(): void {
  const originalFetch=globalThis.fetch.bind(globalThis);
  const observed=new Set<string>();
  const missed=new Set<string>();
  Object.assign(globalThis, { __DASH_PREVIEW__: true, __DASH_PREVIEW_MISSING__: missed, __DASH_PREVIEW_REQUESTS__: observed });
  globalThis.fetch = async (input:RequestInfo | URL, init?:RequestInit):Promise<Response> => {
    const href=typeof input==='string' ? input : input instanceof URL ? input.href : input.url;
    const url=new URL(href,window.location.href);
    // The preview NEVER proxies live services. Only bundled static assets
    // are fetched; third-party API requests are blocked, too.
    if(!url.pathname.startsWith('/api/')){
      if(url.origin!==window.location.origin) return new Response(JSON.stringify({error:'Внешняя сеть в прототипе запрещена'}),{status:403});
      return originalFetch(input,init);
    }
    const path=url.pathname.replace(/^\/api/,'');
    const method=(init?.method ?? (typeof input==='string'?'GET':input instanceof Request ? input.method:'GET')).toUpperCase();
    observed.add(method+' '+path);
    if(method!=='GET'){
      return new Response(JSON.stringify({error:'Предпросмотр: запись и реальные обновления отключены',demo:true}),
        {status:409,headers:{'Content-Type':'application/json'}});
    }
    const value=fixture(path);
    if(value===undefined){
      missed.add(path);
      return new Response(JSON.stringify({error:'Тестовый контракт '+path+' ещё не обеспечен. Дизайн-гейт не пройден.',demo:true}),
        {status:503,headers:{'Content-Type':'application/json'}});
    }
    return new Response(JSON.stringify(value),{status:200,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
  };
}
