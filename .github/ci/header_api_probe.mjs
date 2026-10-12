/** Read-only production metadata used by Header. Never logs payloads or tokens. */
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { brotliDecompressSync } from 'node:zlib';

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const count = value => Number.isSafeInteger(value) && value >= 0;
const amount = value => typeof value === 'number' && Number.isFinite(value);
const day = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,10) === value;
const text = value => typeof value === 'string';
const strings = value => Array.isArray(value) && value.every(text);
const nullableText = value => value === null || text(value);
const nullableTime = value => value === null || (text(value) && Number.isFinite(Date.parse(value)));
// Fields rendered by the candidate's CHANGE_KIND_ORDER; extra kinds survive.
const kinds = ['row-vanished','row-identity-candidate','money','dates','row-added','method','comment','flag','subject','other'];
const gapReasons = ['journal-unread','no-previous-snapshot','row-key-missing','row-key-ambiguous','source-unavailable'];
const entry = e => object(e) && ['id','book','sheet','before','after'].every(k=>text(e[k])) &&
  ['rowSeq','column','columnLabel','author','subject','subordinate'].every(k=>nullableText(e[k])) &&
  (e.sheetRow===null || (count(e.sheetRow) && e.sheetRow>0)) && nullableTime(e.at) &&
  (e.atMs===null || amount(e.atMs)) && [...kinds,'row-cleared'].includes(e.kind) &&
  ['book-journal','live-stream','snapshot-diff'].includes(e.origin);
export const HEADER_ENDPOINTS = {
  journal: '/api/change-story?limit=1',
  sources: '/api/sources',
  buckets: '/api/registry/buckets',
  comments: '/api/comments?limit=20',
};

export function validHeaderPayload(name, data) {
  if (!object(data)) return false;
  if (name === 'comments') return count(data.total) && Array.isArray(data.comments) &&
    data.comments.every(c=>object(c)&&text(c.book)&&nullableText(c.author)&&nullableText(c.content)) &&
    (data.witnesses===undefined || (Array.isArray(data.witnesses)&&data.witnesses.every(w=>object(w)&&text(w.id)&&text(w.book)&&text(w.kind)&&text(w.readAt)&&object(w.evidence))));
  if (name === 'sources') {
    const r = data.refresh;
    return object(r) && typeof r.webhookConfigured === 'boolean' &&
      typeof r.withinWorkWindow === 'boolean' && amount(r.autoRefreshMinutes) && r.autoRefreshMinutes >= 0 &&
      typeof r.workWindowLabel === 'string' && r.workWindowLabel.trim() !== '';
  }
  if (name === 'buckets') {
    return ['live', 'snapshot'].includes(data.source) && typeof data.asOf === 'string' && Number.isFinite(Date.parse(data.asOf)) &&
      ['unfunded', 'yearlong'].every(key => object(data[key]) && count(data[key].rows) && amount(data[key].planSum));
  }
  if (name === 'journal') {
    const d = data.digest;
    return day(data.since) && object(d) && ['books', 'rows', 'entries'].every(k => count(d[k])) &&
      object(d.byKind) && kinds.every(k=>count(d.byKind[k])) && Object.values(d.byKind).every(count) && strings(d.booksNamed) && strings(d.authors) && nullableTime(d.firstAt) && nullableTime(d.lastAt) &&
      ['none', 'quiet', 'unknown'].includes(d.emptiness) && Array.isArray(data.gaps) && data.gaps.every(g=>object(g) && text(g.book) && text(g.detail) && gapReasons.includes(g.reason) && (g.count===undefined || count(g.count))) &&
      Array.isArray(data.entries) && data.entries.every(entry) && object(data.facets) &&
      Array.isArray(data.facets.books) && data.facets.books.every(x=>object(x) && text(x.book) && count(x.count)) &&
      Array.isArray(data.facets.authors) && data.facets.authors.every(x=>object(x) && text(x.author) && count(x.count)) && count(data.total) && count(data.shown);
  }
  return false;
}

export async function probeHeaderApi(fetcher = fetch, token = process.env.AEMR_API_KEY ?? '', onPayload) {
  const checks = await Promise.all(Object.entries(HEADER_ENDPOINTS).map(async ([name, endpoint]) => {
    try {
      const response = await fetcher('http://127.0.0.1:3000' + endpoint, {
        method: 'GET', headers: { Authorization: 'Bearer ' + token }, signal: AbortSignal.timeout(15000),
      });
      if (response.status !== 200) return { endpoint: name, result: 'HTTP_UNAVAILABLE', status: response.status };
      const text = await response.text();
      if (Buffer.byteLength(text, 'utf8') > 2 * 1024 * 1024) return { endpoint: name, result: 'PAYLOAD_TOO_LARGE' };
      const data = JSON.parse(text);
      const valid = validHeaderPayload(name, data);
      if(valid)onPayload?.(name,data);
      return { endpoint: name, result: valid ? 'CONTRACT_PASS' : 'CONTRACT_FAIL',
        response_sha256: createHash('sha256').update(text).digest('hex') };
    } catch { return { endpoint: name, result: 'READ_UNAVAILABLE' }; }
  }));
  return { kind: 'header_api_contract', mode: 'GET_ONLY', atomic: false, checks };
}

export async function loadCandidateBrowser(chunks) {
  const encoded=chunks.join('');
  if(!encoded)throw Error('CANDIDATE_BUNDLE_MISSING');
  const source=brotliDecompressSync(Buffer.from(encoded,'base64'));
  return import('data:text/javascript;base64,'+source.toString('base64'));
}

export function metricWiringReport(browser,dashboard) {
  if(!Array.isArray(dashboard.departmentSummaries))throw Error('METRIC_INPUT_SHAPE');
      let periodNodes=0, contradictions=0, recoveredAnnualNodes=0;
      for(const dept of dashboard.departmentSummaries){
        for(const node of [dept,...(dept.subordinates??[])]){
          for(const period of ['q1','q2','q3','q4','year']){
            const totals=browser.aggregateNodeTotals(node,{periodKey:period,coveredQuarters:[],fullQuarters:[],partialMonths:[],useMonthLevel:false,hasActiveMonths:false},{showKP:true,showEP:true,activeMonths:new Set(),hasMonthData:false});
            periodNodes++;
            if(totals.factTotal>0&&totals.factCount===0)contradictions++;
            if(period==='year'&&!node.quarters?.year&&!node.factCount&&totals.factCount>0)recoveredAnnualNodes++;
          }
        }
      }
      return {result:periodNodes===0?'NO_METRIC_NODES':contradictions===0?'CANDIDATE_METRICS_PASS':'COUNT_MONEY_SCOPE_CONTRADICTION',period_nodes:periodNodes,contradictions,recovered_annual_nodes:recoveredAnnualNodes};
}

if (process.argv[1] === '-' || (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)) {
  const payloads={};
  const report = await probeHeaderApi(fetch,process.env.AEMR_API_KEY??'',(name,data)=>{payloads[name]=data;});
  const browserContract=Array.from({length:4},(_,i)=>process.env['BROWSER_CONTRACT_BR_'+i]??'').join('');
  if(browserContract){
    try{
      const browser=await loadCandidateBrowser([browserContract]);
      for(const name of Object.keys(HEADER_ENDPOINTS)){
        const data=payloads[name];
        if(!validHeaderPayload(name,data))throw Error('BROWSER_INPUT_SHAPE');
        if(name==='sources'&&browser.parseRefreshPassport(data)===null)throw Error('BROWSER_PASSPORT_UNKNOWN');
        if(name==='journal'){browser.digestLines(data.digest);for(const entry of data.entries){browser.entryAddress(entry);browser.entryChangeLine(entry);browser.entryWhoWhen(entry);}}
      }
      const dashboardResponse=await fetch('http://127.0.0.1:3000/api/dashboard?year='+new Intl.DateTimeFormat('en',{timeZone:'Asia/Kamchatka',year:'numeric'}).format(new Date()),{headers:{Authorization:'Bearer '+(process.env.AEMR_API_KEY??'')},signal:AbortSignal.timeout(15000)});
      if(dashboardResponse.status!==200)throw Error('METRIC_INPUT_UNAVAILABLE');
      const dashboardText=await dashboardResponse.text();
      if(Buffer.byteLength(dashboardText)>20*1024*1024)throw Error('METRIC_PAYLOAD_TOO_LARGE');
      const dashboard=JSON.parse(dashboardText);
      if(!Array.isArray(dashboard.departmentSummaries))throw Error('METRIC_INPUT_SHAPE');
      report.metric_wiring={...metricWiringReport(browser,dashboard),response_sha256:createHash('sha256').update(dashboardText).digest('hex')};
      const today=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Kamchatka',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
      const [year,month]=today.split('-');
      const response=await fetch(`http://127.0.0.1:3000/api/report-releases?date=${today}&year=${year}&quarter=${Math.ceil(Number(month)/3)}`,{headers:{Authorization:'Bearer '+(process.env.AEMR_API_KEY??'')},signal:AbortSignal.timeout(15000)});
      const reportText=response.status===200?await response.text():null;
      if(reportText&&Buffer.byteLength(reportText)>2*1024*1024)throw Error('REPORT_PAYLOAD_TOO_LARGE');
      const parsed=reportText?browser.SelectedReportReleaseStatusSchema.safeParse(JSON.parse(reportText)):null;
      report.browser_consumers={result:parsed?.success?'CANDIDATE_CONSUMERS_PASS':'CANDIDATE_REPORT_CONTRACT_FAIL',errors:parsed&&!parsed.success?parsed.error.issues.map(x=>x.code).slice(0,8):[]};
    }catch{report.browser_consumers={result:'CANDIDATE_CONSUMERS_UNAVAILABLE'};}
  }
  if(!browserContract)report.browser_consumers={result:'CANDIDATE_BUNDLE_MISSING'};
  console.log(JSON.stringify(report));
  if (report.checks.some(check => check.result !== 'CONTRACT_PASS')||(report.browser_consumers&&report.browser_consumers.result!=='CANDIDATE_CONSUMERS_PASS')||(report.metric_wiring&&report.metric_wiring.result!=='CANDIDATE_METRICS_PASS')) process.exitCode = 2;
}
