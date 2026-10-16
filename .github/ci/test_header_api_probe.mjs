import { test } from 'node:test';
import assert from 'node:assert/strict';
import { probeHeaderApi, validHeaderPayload, HEADER_ENDPOINTS, loadCandidateBrowser, metricWiringReport, headerShapeIssues, parseReportJSON } from './header_api_probe.mjs';
const fixtures = {
  comments: {total:0,comments:[],witnesses:[]},
  sources: { refresh: { webhookConfigured: false, withinWorkWindow: false, autoRefreshMinutes: 0, workWindowLabel: 'fixture' } },
  buckets: { asOf: '2026-10-12T00:00:00Z', source: 'snapshot', unfunded: { rows: 0, planSum: 0 }, yearlong: { rows: 0, planSum: 0 } },
  journal: { since: '2026-10-08', digest: { books: 0, rows: 0, entries: 0, byKind: Object.fromEntries(['row-vanished','row-identity-candidate','money','dates','row-added','method','comment','flag','subject','other'].map(k=>[k,0])), booksNamed: [], authors: [], firstAt:null,lastAt:null,emptiness: 'quiet' }, gaps: [], entries: [], facets: { books: [], authors: [] }, total: 0, shown: 0 },
};
test('probes exact frontend endpoint paths with GET and preserves actual zero/false', async () => {
  const result = await probeHeaderApi(async (url, options) => {
    assert.equal(options.method, 'GET'); assert.equal(options.headers.Authorization, 'Bearer fixture-key');
    const name = Object.keys(HEADER_ENDPOINTS).find(k => url.endsWith(HEADER_ENDPOINTS[k])); assert.ok(name);
    return new Response(JSON.stringify(fixtures[name]));
  }, 'fixture-key');
  assert.ok(result.checks.every(x => x.result === 'CONTRACT_PASS'));
  assert.equal(JSON.stringify(result).includes('fixture-key'), false);
});
test('malformed and absent metadata cannot pass as known values', () => {
  for (const name of Object.keys(fixtures)) assert.equal(validHeaderPayload(name, {}), false);
  assert.equal(validHeaderPayload('sources', { refresh: {} }), false);
  assert.equal(validHeaderPayload('buckets', { ...fixtures.buckets, unfunded: { rows: -1, planSum: 0 } }), false);
});
test('HTTP errors and unreadable bodies remain unavailable without publishing content', async () => {
  const failed = await probeHeaderApi(async () => new Response('private contents', { status: 503 }));
  assert.ok(failed.checks.every(x => x.result === 'HTTP_UNAVAILABLE'));
  assert.equal(JSON.stringify(failed).includes('private contents'), false);
  const malformed = await probeHeaderApi(async () => new Response('private contents'));
  assert.ok(malformed.checks.every(x => x.result === 'READ_UNAVAILABLE'));
});

test('failed reads identify timeout, transport and invalid JSON without exposing error contents', async () => {
  for (const [error, reason] of [[new DOMException('private URL and credential', 'TimeoutError'), 'TIMEOUT'],
    [new TypeError('private URL and credential'), 'TRANSPORT_FAILED']]) {
    const result = await probeHeaderApi(async () => { throw error; });
    assert.ok(result.checks.every(x => x.result === 'READ_UNAVAILABLE' && x.stage === 'FETCH' && x.reason === reason));
    assert.ok(result.checks.every(x => Number.isSafeInteger(x.elapsed_ms) && x.elapsed_ms >= 0));
    assert.equal(JSON.stringify(result).includes('private'), false);
  }
  const malformed = await probeHeaderApi(async () => new Response('private payload'));
  assert.ok(malformed.checks.every(x => x.stage === 'PARSE' && x.reason === 'INVALID_JSON'));
  assert.equal(JSON.stringify(malformed).includes('private'), false);
});

test('missing kind counts and invalid consumed labels are not accepted as zero/empty',()=>{
 assert.equal(validHeaderPayload('journal',{...fixtures.journal,digest:{...fixtures.journal.digest,byKind:{}}}),false);
 assert.equal(validHeaderPayload('journal',{...fixtures.journal,digest:{...fixtures.journal.digest,authors:[42]}}),false);
 assert.equal(validHeaderPayload('journal',{...fixtures.journal,digest:{...fixtures.journal.digest,firstAt:undefined}}),false);
 assert.equal(validHeaderPayload('journal',{...fixtures.journal,gaps:[{}]}),false);
 assert.equal(validHeaderPayload('journal',{...fixtures.journal,entries:[{}]}),false);
});

test('missing candidate transport cannot pass the installed schema as candidate proof', async()=>{
 await assert.rejects(loadCandidateBrowser(['','','','']),/CANDIDATE_BUNDLE_MISSING/);
});
test('empty production metric response is not successful wiring',()=>{
 const result=metricWiringReport({}, {departmentSummaries:[]});
 assert.equal(result.result,'NO_METRIC_NODES');
 assert.equal(result.period_nodes,0);
});

test('annual fallback cannot conceal positive fact money with lost execution count',()=>{
 const result=metricWiringReport({aggregateNodeTotals:()=>({factTotal:80,factCount:0,periodApplied:false})}, {departmentSummaries:[{}]});
 assert.equal(result.result,'COUNT_MONEY_SCOPE_CONTRADICTION');
 assert.equal(result.contradictions,5);
});

test('shape diagnosis identifies fixed fields without publishing invalid values',()=>{
 const broken={...fixtures.journal,entries:[{subject:'private-text',author:'private-person'}]};
 const issues=headerShapeIssues('journal',broken);
 assert.ok(issues.includes('entries.id'));
 assert.equal(JSON.stringify(issues).includes('private-'),false);
});

test('real-sized historical receipts reach schema validation while oversize and malformed bodies fail',()=>{
 const payload=JSON.stringify({selected:{automation_assurance:{contract:'actionable-assurance-v2'}},padding:'x'.repeat(9*1024*1024)});
 assert.equal(parseReportJSON(payload).selected.automation_assurance.contract,'actionable-assurance-v2');
 assert.throws(()=>parseReportJSON('x'.repeat(16*1024*1024+1)),/REPORT_PAYLOAD_TOO_LARGE/);
 assert.throws(()=>parseReportJSON('{broken'),SyntaxError);
});
