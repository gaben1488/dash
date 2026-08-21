/* ВРЕМЕННЫЙ замерочный файл — удаляется после снятия чисел. */
import { describe, it, vi, beforeEach } from 'vitest';
import { writeFileSync } from 'node:fs';

const LATENCY_MS = 150;
let calls: string[] = [];

function payload(rows: number, cols: number): unknown[][] {
  return Array.from({ length: rows }, (_, r) =>
    Array.from({ length: cols }, (_, c) => (c % 3 === 0 ? r * 100 + c : `значение ${r}-${c}`)),
  );
}

const GRID = payload(3000, 40);

const valuesGet = vi.fn(async (params: { range?: string }) => {
  calls.push(`values.get ${params.range ?? ''}`);
  await new Promise((r) => setTimeout(r, LATENCY_MS));
  return { data: { values: GRID } };
});
const valuesBatchGet = vi.fn(async (params: { ranges?: string[] }) => {
  calls.push(`values.batchGet x${params.ranges?.length ?? 0}`);
  await new Promise((r) => setTimeout(r, LATENCY_MS));
  return { data: { valueRanges: (params.ranges ?? []).map(() => ({ values: GRID })) } };
});

vi.mock('googleapis', () => ({
  google: {
    sheets: vi.fn(() => ({
      spreadsheets: { values: { get: valuesGet, batchGet: valuesBatchGet, update: vi.fn() }, get: vi.fn() },
    })),
    auth: { GoogleAuth: vi.fn(function GoogleAuth() { return {}; }) },
  },
}));

const lines: string[] = [];
function note(text: string): void {
  lines.push(text);
}

beforeEach(() => {
  calls = [];
});

describe('замеры', () => {
  it('книги ГРБС: было (значения + формулы) против стало (только значения)', async () => {
    const { fetchDepartmentSpreadsheets } = await import('./google-sheets.js');
    const books = { 'УО': 'ss1', 'УД': 'ss2', 'УЭР': 'ss3', 'УКСиМП': 'ss4', 'УИО': 'ss5', 'УАГиЗО': 'ss6', 'УДТХиРКИ': 'ss7', 'УФБП': 'ss8' };

    calls = [];
    let t = Date.now();
    await fetchDepartmentSpreadsheets(books, { withFormulas: true });
    const wasMs = Date.now() - t;
    const wasCalls = calls.length;

    calls = [];
    t = Date.now();
    await fetchDepartmentSpreadsheets(books);
    const nowMs = Date.now() - t;
    const nowCalls = calls.length;

    calls = [];
    t = Date.now();
    await fetchDepartmentSpreadsheets(books, { only: ['УО'] });
    const oneMs = Date.now() - t;
    const oneCalls = calls.length;

    note(`8 книг, старый путь (значения+формулы): обращений ${wasCalls}, ${wasMs} мс`);
    note(`8 книг, новый путь (только значения):   обращений ${nowCalls}, ${nowMs} мс`);
    note(`1 книга адресно (по уведомлению):        обращений ${oneCalls}, ${oneMs} мс`);
  }, 120_000);

  it('книга мониторинга: было (лист за листом) против стало (один пакет)', async () => {
    const { batchGetSheetValues, getSheetDataFromSpreadsheet } = await import('./google-sheets.js');
    const { MONITORING_DATA_SHEETS } = await import('@aemr/core');
    const sheets = [...MONITORING_DATA_SHEETS];

    calls = [];
    let t = Date.now();
    await Promise.all(sheets.map((s) => getSheetDataFromSpreadsheet('mon', s)));
    const wasMs = Date.now() - t;
    const wasCalls = calls.length;

    calls = [];
    t = Date.now();
    await batchGetSheetValues(sheets, 'mon');
    const nowMs = Date.now() - t;
    const nowCalls = calls.length;

    note(`книга мониторинга (${sheets.length} листов), было: обращений ${wasCalls}, ${wasMs} мс`);
    note(`книга мониторинга, стало (один пакет):     обращений ${nowCalls}, ${nowMs} мс`);
  }, 120_000);

  it('счёт на месте: отпечаток против построчного сравнения', async () => {
    const { sheetFingerprint } = await import('./sheet-fingerprint.js');
    const { diffBook } = await import('./live-diff.js');

    const a = payload(3000, 40);
    const b = payload(3000, 40);
    b[1500][7] = 'правка';

    let t = process.hrtime.bigint();
    for (let i = 0; i < 5; i++) sheetFingerprint(a);
    const printMs = Number(process.hrtime.bigint() - t) / 1e6 / 5;

    t = process.hrtime.bigint();
    for (let i = 0; i < 5; i++) diffBook('УО', { values: a }, { values: b });
    const diffMs = Number(process.hrtime.bigint() - t) / 1e6 / 5;

    const { createHash } = await import('node:crypto');
    t = process.hrtime.bigint();
    for (let i = 0; i < 5; i++) createHash('sha1').update(JSON.stringify(a)).digest('base64');
    const shaMs = Number(process.hrtime.bigint() - t) / 1e6 / 5;

    t = process.hrtime.bigint();
    for (let i = 0; i < 5; i++) JSON.stringify(a);
    const jsonMs = Number(process.hrtime.bigint() - t) / 1e6 / 5;

    note(`лист 3000x40: отпечаток(FNV) ${printMs.toFixed(1)} мс, отпечаток(JSON+sha1) ${shaMs.toFixed(1)} мс (из них JSON ${jsonMs.toFixed(1)} мс), построчное сравнение ${diffMs.toFixed(1)} мс`);
    note(`при 8 книгах: отпечатки(FNV) ${(printMs * 8).toFixed(1)} мс, отпечатки(sha1) ${(shaMs * 8).toFixed(1)} мс, сравнения ${(diffMs * 8).toFixed(1)} мс`);
  }, 120_000);

  it('запись итога', () => {
    writeFileSync('C:/Users/filat/AppData/Local/Temp/claude/C--Users-filat-dash/25733ef5-3a3b-462d-ae7a-02f5c41032ee/scratchpad/bench.txt', lines.join('\n'), 'utf8');
  });
});
