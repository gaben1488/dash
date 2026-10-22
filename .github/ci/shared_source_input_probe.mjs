// Run only with an isolated writable data directory and read-only Google access.
// No production catalog, queue, identity database or publisher is used.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import process from 'node:process';
import console from 'node:console';
import { performance } from 'node:perf_hooks';

const state = process.env.REPORT_STATE_DIR;
if (!state || !process.env.SHARED_INPUT_ISOLATED_PROBE || !process.env.SQLITE_PATH
    || fs.existsSync(process.env.SQLITE_PATH)
    || ['published', 'identity.sqlite', 'commands', 'attempts'].some(name => fs.existsSync(path.join(state, name)))) {
  throw Error('ISOLATION_REQUIRED');
}
const id = 'a'.repeat(32);
const attempt = path.join(state, 'attempts', id);
fs.mkdirSync(attempt, { recursive: true });
fs.writeFileSync(path.join(attempt, 'status.json'),
  JSON.stringify({ attempt_id: id, status: 'RUNNING', stage: 'acquisition' }));
const { createApp } = await import('../../packages/server/src/app.ts');
const { getDeptSheetCache, getDeptLoadMeta } = await import('../../packages/server/src/services/snapshot.ts');
const { CalcEngine, standardRowFilter, getValue } = await import('../../packages/core/src/pipeline/calc-engine.ts');
const { dayNumberOf } = await import('../../packages/shared/src/parse-sheet-date.ts');
const app = await createApp({ logger: false });
try {
  const address = await app.listen({ host: '127.0.0.1', port: 0 });
  const script = `
import json,os,sys
from pathlib import Path
from procurement_engine.shared_input import request_source_input
from procurement_engine.adapters import normalize_master_values
from procurement_engine.canonical_metrics import metric_block
from procurement_engine.normalize import parse_date
capture=request_source_input(sys.argv[1],os.environ['AEMR_API_KEY'],Path(sys.argv[2]))
results=[]
for source in capture['sources']:
 if source['role']!='master':continue
 rows=normalize_master_values(source['values'],snapshot_id='probe',expected_grbs=source['grbs'],
  data_start_row=source['header_rows'],source_id=source['source_id'])
 metrics=metric_block(rows,report_year=capture['report_year'],as_of=capture['report_date'])
 results.append({'book':source['grbs'],'headers':source['header_rows'],'count':metrics['plan_count'],
  'economy':metrics['exact_decimal']['confirmed_saving_amount']})
print(json.dumps({'source_revision':capture['source_revision'],'year':capture['report_year'],
 'as_of':parse_date(capture['report_date']),'results':results}))
`;
  const started = performance.now();
  const { stdout } = await promisify(execFile)('/opt/report-env/bin/python',
    ['-B', '-c', script, address, attempt],
    { timeout: 590_000, maxBuffer: 64 * 1024, shell: false });
  const expected = JSON.parse(stdout);
  const capture = JSON.parse(fs.readFileSync(path.join(attempt, 'capture.json'), 'utf8'));
  const cache = getDeptSheetCache();
  const meta = getDeptLoadMeta();
  assert.equal(expected.results.length, 8);
  for (const source of capture.sources.filter(source => source.role === 'master')) {
    assert.deepEqual(cache[source.grbs].values, source.values);
    assert.equal(meta[source.grbs].sourceRevision, expected.source_revision);
  }
  for (const result of expected.results) {
    const actual = new CalcEngine().compute(cache[result.book].values, standardRowFilter,
      result.headers, expected.year, { asOfDay: dayNumberOf(expected.as_of) });
    assert.equal(getValue(actual, 'plan_count'), result.count);
    assert.ok(Math.abs(getValue(actual, 'economy_total') - Number(result.economy)) <= 1e-9);
  }
  console.log(JSON.stringify({ shared_source_input: 'PASS', source_revision: expected.source_revision,
    masters: expected.results.length, live_cache_equals_capture: true, economy_parity: true,
    capture_bytes: fs.statSync(path.join(attempt, 'capture.json')).size,
    elapsed_ms: Math.round(performance.now() - started) }));
} catch (error) {
  console.error(JSON.stringify({ shared_source_input: 'FAIL', error_type: error.constructor.name }));
  process.exitCode = 1;
} finally {
  await app.close();
}
