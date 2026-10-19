/** Read-only production metadata used by Header. Never logs payloads or tokens. */
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';
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

/** Current immutable receipts are ~9 MiB. Keep a finite bound without rejecting
 * them before the actual candidate schema can validate historical v1/v2. */
export function parseReportJSON(body) {
  if (Buffer.byteLength(body, 'utf8') > 16 * 1024 * 1024) throw Error('REPORT_PAYLOAD_TOO_LARGE');
  return JSON.parse(body);
}

export function reportSelectionPath(history) {
  const latest = Array.isArray(history?.releases) ? history.releases[0] : null;
  if (!object(latest) || !/^REL-[a-f0-9]{64}$/.test(latest.release_id ?? '') ||
      !day(latest.report_date) || !Number.isInteger(latest.report_year) ||
      latest.report_year < 1900 || latest.report_year > 9999 ||
      !Number.isInteger(latest.quarter) || latest.quarter < 1 || latest.quarter > 4) {
    throw Error('PUBLICATION_CONTEXT_UNAVAILABLE');
  }
  return `/api/report-releases?date=${latest.report_date}&year=${latest.report_year}&quarter=${latest.quarter}`;
}

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

/** Fixed schema paths only: never echo an invalid source value. */
export function headerShapeIssues(name,data) {
 if(validHeaderPayload(name,data))return [];
 if(name!=='journal'||!object(data))return ['payload'];
 const d=data.digest, issues=[];
 if(!day(data.since))issues.push('since');
 if(!object(d))return [...issues,'digest'];
 for(const k of ['books','rows','entries'])if(!count(d[k]))issues.push('digest.'+k);
 if(!object(d.byKind))issues.push('digest.byKind');
 else for(const k of kinds)if(!count(d.byKind[k]))issues.push('digest.byKind.'+k);
 for(const k of ['booksNamed','authors'])if(!strings(d[k]))issues.push('digest.'+k);
 for(const k of ['firstAt','lastAt'])if(!nullableTime(d[k]))issues.push('digest.'+k);
 if(!['none','quiet','unknown'].includes(d.emptiness))issues.push('digest.emptiness');
 if(!Array.isArray(data.gaps))issues.push('gaps');
 else if(data.gaps.some(g=>!object(g)||!text(g.book)||!text(g.detail)||!gapReasons.includes(g.reason)||(g.count!==undefined&&!count(g.count))))issues.push('gaps.fields');
 if(!Array.isArray(data.entries))issues.push('entries');
 else for(const e of data.entries){
  if(!object(e)){issues.push('entries.object');continue;}
  for(const k of ['id','book','sheet','before','after'])if(!text(e[k]))issues.push('entries.'+k);
  for(const k of ['rowSeq','column','columnLabel','author','subject','subordinate'])if(!nullableText(e[k]))issues.push('entries.'+k);
  if(!nullableTime(e.at))issues.push('entries.at');
  if(!(e.atMs===null||amount(e.atMs)))issues.push('entries.atMs');
  if(!(e.sheetRow===null||(count(e.sheetRow)&&e.sheetRow>0)))issues.push('entries.sheetRow');
  if(![...kinds,'row-cleared'].includes(e.kind))issues.push('entries.kind');
  if(!['book-journal','live-stream','snapshot-diff'].includes(e.origin))issues.push('entries.origin');
 }
 if(!object(data.facets))issues.push('facets');
 else if(!Array.isArray(data.facets.books)||!Array.isArray(data.facets.authors)||data.facets.books.some(x=>!object(x)||!text(x.book)||!count(x.count))||data.facets.authors.some(x=>!object(x)||!text(x.author)||!count(x.count)))issues.push('facets.fields');
 for(const k of ['total','shown'])if(!count(data[k]))issues.push(k);
 return [...new Set(issues)].slice(0,16);
}

export async function probeHeaderApi(fetcher = fetch, token = process.env.AEMR_API_KEY ?? '', onPayload) {
  const checks = await Promise.all(Object.entries(HEADER_ENDPOINTS).map(async ([name, endpoint]) => {
    const started = performance.now();
    let stage = 'FETCH';
    try {
      const response = await fetcher('http://127.0.0.1:3000' + endpoint, {
        method: 'GET', headers: { Authorization: 'Bearer ' + token }, signal: AbortSignal.timeout(15000),
      });
      if (response.status !== 200) return { endpoint: name, result: 'HTTP_UNAVAILABLE', status: response.status };
      stage = 'BODY';
      const text = await response.text();
      if (Buffer.byteLength(text, 'utf8') > 2 * 1024 * 1024) return { endpoint: name, result: 'PAYLOAD_TOO_LARGE' };
      stage = 'PARSE';
      const data = JSON.parse(text);
      const valid = validHeaderPayload(name, data);
      stage = 'CONSUMER';
      onPayload?.(name,data);
      return { endpoint: name, result: valid ? 'CONTRACT_PASS' : 'CONTRACT_FAIL',
        ...(valid?{}:{invalid_fields:headerShapeIssues(name,data)}),
        response_sha256: createHash('sha256').update(text).digest('hex') };
    } catch (error) {
      const reason = ['TimeoutError', 'AbortError'].includes(error?.name) ? 'TIMEOUT'
        : stage === 'PARSE' && error instanceof SyntaxError ? 'INVALID_JSON'
        : stage === 'CONSUMER' ? 'CONSUMER_FAILED' : 'TRANSPORT_FAILED';
      return { endpoint: name, result: 'READ_UNAVAILABLE', stage, reason,
        elapsed_ms: Math.round(performance.now() - started) };
    }
  }));
  return { kind: 'header_api_contract', mode: 'GET_ONLY', atomic: false, checks };
}

export async function loadCandidateBrowser(chunks) {
  const packed=Buffer.isBuffer(chunks)?chunks:Buffer.from(chunks.join(''),'base64');
  if(!packed.length)throw Error('CANDIDATE_BUNDLE_MISSING');
  const source=brotliDecompressSync(packed);
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

if (process.env.HEADER_PROBE_CLI==='1' || process.argv[1] === '-' || (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)) {
  const payloads={};
  const report = await probeHeaderApi(fetch,process.env.AEMR_API_KEY??'',(name,data)=>{payloads[name]=data;});
  const browserContract=process.env.HEADER_PROBE_CLI==='1'?readFileSync(0):Buffer.alloc(0);
  if(browserContract.length){
    let stage='LOAD_CANDIDATE';
    try{
      const browser=await loadCandidateBrowser(browserContract);
      stage='HEADER_CONSUMERS';
      let headersValid=true;
      for(const name of Object.keys(HEADER_ENDPOINTS)){
        const data=payloads[name];
        if(!validHeaderPayload(name,data)){headersValid=false;continue;}
        if(name==='sources'&&browser.parseRefreshPassport(data)===null)throw Error('BROWSER_PASSPORT_UNKNOWN');
        if(name==='journal'){browser.digestLines(data.digest);for(const entry of data.entries){browser.entryAddress(entry);browser.entryChangeLine(entry);browser.entryWhoWhen(entry);}}
      }
      stage='METRIC_READ';
      const dashboardResponse=await fetch('http://127.0.0.1:3000/api/dashboard?year='+new Intl.DateTimeFormat('en',{timeZone:'Asia/Kamchatka',year:'numeric'}).format(new Date()),{headers:{Authorization:'Bearer '+(process.env.AEMR_API_KEY??'')},signal:AbortSignal.timeout(15000)});
      if(dashboardResponse.status!==200)throw Error('METRIC_INPUT_UNAVAILABLE');
      const dashboardText=await dashboardResponse.text();
      if(Buffer.byteLength(dashboardText)>20*1024*1024)throw Error('METRIC_PAYLOAD_TOO_LARGE');
      const dashboard=JSON.parse(dashboardText);
      if(!Array.isArray(dashboard.departmentSummaries))throw Error('METRIC_INPUT_SHAPE');
      report.metric_wiring={...metricWiringReport(browser,dashboard),response_sha256:createHash('sha256').update(dashboardText).digest('hex')};
      stage='REPORT_READ';
      // Retention removes old daily releases. Test the latest catalog context;
      // an absent/invalid context or an empty selected envelope still fails.
      const historyResponse=await fetch('http://127.0.0.1:3000/api/report-releases/history',{headers:{Authorization:'Bearer '+(process.env.AEMR_API_KEY??'')},signal:AbortSignal.timeout(15000)});
      if(historyResponse.status!==200)throw Error('PUBLICATION_CONTEXT_UNAVAILABLE');
      const selectionPath=reportSelectionPath(parseReportJSON(await historyResponse.text()));
      const response=await fetch('http://127.0.0.1:3000'+selectionPath,{headers:{Authorization:'Bearer '+(process.env.AEMR_API_KEY??'')},signal:AbortSignal.timeout(15000)});
      const reportText=response.status===200?await response.text():null;
      report.report_response={status:response.status,bytes:reportText?Buffer.byteLength(reportText):0,
        ...(reportText?{response_sha256:createHash('sha256').update(reportText).digest('hex')}:{})};
      stage='REPORT_PARSE';
      const reportData=reportText?parseReportJSON(reportText):null;
      const parsed=reportData?browser.SelectedReportReleaseStatusSchema.safeParse(reportData):null;
      const selectedPresent=parsed?.success&&parsed.data.selected!==null;
      const fields=new Set(['selected','attempt','automation_assurance','contract','source_observations','nonprocurement_identity_observations','user_action_count','engine_action_count','actions','source_revision','status','available']);
      report.browser_consumers={result:selectedPresent?(headersValid?'CANDIDATE_CONSUMERS_PASS':'CANDIDATE_HEADER_CONTRACT_FAIL'):parsed?.success?'NO_SELECTED_PUBLICATION':'CANDIDATE_REPORT_CONTRACT_FAIL',report_contract:parsed?.success?'PASS':'FAIL',selected_present:Boolean(selectedPresent),errors:parsed&&!parsed.success?parsed.error.issues.slice(0,8).map(x=>({code:x.code,path:x.path.map(k=>fields.has(k)?k:'?').join('.')})):[]};
    }catch(error){
      const known=new Set(['REPORT_PAYLOAD_TOO_LARGE','METRIC_PAYLOAD_TOO_LARGE','METRIC_INPUT_UNAVAILABLE','METRIC_INPUT_SHAPE','CANDIDATE_BUNDLE_MISSING','BROWSER_PASSPORT_UNKNOWN','PUBLICATION_CONTEXT_UNAVAILABLE']);
      const classes=new Set(['TypeError','SyntaxError','TimeoutError','AbortError','Error']);
      report.browser_consumers={result:'CANDIDATE_CONSUMERS_UNAVAILABLE',stage,reason:known.has(error?.message)?error.message:'READ_OR_PARSER_FAILED',error_class:classes.has(error?.name)?error.name:'Other'};
    }
  }
  if(!browserContract.length)report.browser_consumers={result:'CANDIDATE_BUNDLE_MISSING'};
  console.log(JSON.stringify(report));
  if (report.checks.some(check => check.result !== 'CONTRACT_PASS')||(report.browser_consumers&&report.browser_consumers.result!=='CANDIDATE_CONSUMERS_PASS')||(report.metric_wiring&&report.metric_wiring.result!=='CANDIDATE_METRICS_PASS')) process.exitCode = 2;
}
