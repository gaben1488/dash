import assert from 'node:assert/strict';
import { createServer, get } from 'node:http';
import { setImmediate } from 'node:timers';
import { DEPARTMENTS } from '/app/packages/shared/src/index.ts';
import { runSnapshotCalculation } from '/app/packages/server/src/services/snapshot-calculation.ts';

const server = createServer((_request, response) => response.end('ok'));
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
assert(address && typeof address !== 'string');
const reading = new Promise((resolve, reject) => {
  setImmediate(() => get(`http://127.0.0.1:${address.port}`, response => {
    response.resume(); response.once('end', resolve);
  }).once('error', reject));
});
let finished = false;
const departments = DEPARTMENTS.map(department => department.nameShort);
const sheetRows = Object.fromEntries(departments.map((department, index) => {
  const count = index === 6 ? 2500 : index === 0 ? 216 : 214;
  const rows = Array.from({ length: count }, (_, rowIndex) => {
    const row = Array(34).fill('');
    Object.assign(row, { 0: String(rowIndex + 1), 1: department, 3: 'ТД',
      6: `Учебная позиция ${department} ${rowIndex + 1}`, 7: 100, 10: 100, 11: 'ЭА',
      13: '12.10.2026', 14: 4, 15: 2026, 16: '15.10.2026', 21: 80, 24: 80, 25: 20, 29: 'да' });
    return row;
  });
  return [department, [[], [], [], ...rows]];
}));
const result = runSnapshotCalculation({ batchGetData: [], sheetRows, reportMap: [],
  spreadsheetId: 'synthetic-native-worker', targetYear: 2026,
  asOf: new Date('2026-10-18T00:00:00Z') }).finally(() => { finished = true; });
void result.catch(() => {});
try {
  await reading;
  assert.equal(finished, false);
  const snapshot = await result;
  assert.equal(snapshot.spreadsheetId, 'synthetic-native-worker');
  assert.equal(snapshot.createdAt, '2026-10-18T00:00:00.000Z');
  assert.equal(snapshot.metadata.targetYear, 2026);
  assert.equal(Object.values(snapshot.rowsByDept).reduce((sum, rows) => sum + rows.length, 0), 4000);
  console.log('SNAPSHOT_CALCULATION_NATIVE_HTTP_PASS');
} finally {
  try { await result; }
  finally { await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
}
