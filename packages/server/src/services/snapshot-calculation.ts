import { snapshotCalculationContext } from './snapshot-calculation-context.js';
import { computeUnifiedGrid, reconcileUnified, runPipeline, type PipelineInput, type PipelineSnapshot } from '@aemr/core';
import { productCalendarDay, PRODUCT_UTC_OFFSET_HOURS } from '@aemr/shared';
import { MASTER_SOURCE_PROFILE, validateMasterSourceHeader, findDept, getActiveRules, SVOD_SHEET_NAME, type DataSnapshot, type SvodReconRow } from '@aemr/shared';
import { Worker } from 'node:worker_threads';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { setImmediate as yieldToReads } from 'node:timers/promises';
import { logSnapshotChange, logSourceProblem } from './source-log.js';
import type { SnapshotStorageInput } from './snapshot-storage.js';

export type SnapshotCalculationInput = Omit<PipelineInput, 'rules'>;

export function attachUnifiedGrid(
  snapshot: DataSnapshot,
  sheetRows: Record<string, unknown[][]>,
  targetYear?: number,
): void {
  const deptRowsById: Record<string, unknown[][]> = {};
  for (const [sheetName, rows] of Object.entries(sheetRows)) {
    if (sheetName === SVOD_SHEET_NAME) continue;
    // Канон резолва ГРБС: findDept (принимает id ИЛИ латиницу) → latinId. Не-ГРБС
    // лист (ШДЮ, служебный) findDept не знает → пропускаем, а НЕ кладём мусорный
    // lowercase-ключ (свеп консолидации: иначе downstream не сматчит → тихий дроп блока).
    const dept = findDept(sheetName);
    if (!dept) continue;
    deptRowsById[dept.latinId] = rows;
  }

  const instant = new Date(snapshot.createdAt);
  if (!Number.isFinite(instant.getTime())) throw new Error('INVALID_SNAPSHOT_AS_OF');
  const grid = computeUnifiedGrid(deptRowsById, targetYear, productCalendarDay(instant, PRODUCT_UTC_OFFSET_HOURS));
  snapshot.unifiedGrid = grid;
  snapshot.unifiedReconciliation = reconcileUnified(grid, snapshot.officialMetrics) as SvodReconRow[];
}

export function calculateSnapshot(input: SnapshotCalculationInput): PipelineSnapshot {
  for (const [sheet, rows] of Object.entries(input.sheetRows)) {
    const header = rows[MASTER_SOURCE_PROFILE.headerRows - 1];
    // Partial legacy matrices carry no proof of the current header schema.
    if (findDept(sheet) && header?.length >= MASTER_SOURCE_PROFILE.columns) validateMasterSourceHeader(header);
  }
  const resolved = { ...input, asOf: input.asOf ?? new Date(), rules: getActiveRules() };
  const snapshot = runPipeline(resolved);
  snapshot.metadata.calculationContext = snapshotCalculationContext(resolved, resolved.asOf);
  attachUnifiedGrid(snapshot, input.sheetRows, input.targetYear);
  return snapshot;
}

// Constant program; paths are resolved from this module, never from source data.
// Explicit tsImport works in the installed tsx runtime and in the emitted server.
const CALCULATION_BOOTSTRAP = `
  const { parentPort, workerData } = require('node:worker_threads');
  (async () => {
    const { tsImport } = await import(workerData.loader);
    const task = await tsImport(workerData.module, workerData.module);
    if (workerData.operation === 'calculation')
      parentPort.postMessage({ ok: true, snapshot: task.calculateSnapshot(workerData.input) });
    else parentPort.postMessage({ ok: true, saved: await task.persistSnapshotInWorker(workerData.input) });
  })().catch(() => parentPort.postMessage({ ok: false }));
`;

// No second queue: snapshot.ts owns scheduling. This slot fails closed if an
// isolate cannot be terminated, so a later failed materialization cannot leak one.
let activeWorker: Worker | null = null;

export function runSnapshotCalculation(input: SnapshotCalculationInput): Promise<PipelineSnapshot> {
  return runSnapshotTask({ ...input, asOf: input.asOf === undefined ? new Date() : input.asOf }, 'calculation') as Promise<PipelineSnapshot>;
}

export function runSnapshotStorage(input: SnapshotStorageInput): Promise<true> {
  return runSnapshotTask(input, 'storage') as Promise<true>;
}

function runSnapshotTask(input: SnapshotCalculationInput | SnapshotStorageInput, operation: 'calculation' | 'storage'): Promise<PipelineSnapshot | true> {
  const prefix = operation === 'calculation' ? 'SNAPSHOT_CALCULATION' : 'SNAPSHOT_STORAGE';
  return new Promise((resolve, reject) => {
    if (activeWorker !== null) {
      reject(new Error(prefix + '_BUSY'));
      return;
    }
    let worker: Worker;
    try {
      worker = new Worker(CALCULATION_BOOTSTRAP, {
        eval: true,
        execArgv: [],
        env: { NODE_ENV: process.env.NODE_ENV ?? 'production',
          TZ: process.env.TZ ?? Intl.DateTimeFormat().resolvedOptions().timeZone },
        resourceLimits: { maxOldGenerationSizeMb: 512 },
        stdout: true,
        stderr: true,
        workerData: { loader: pathToFileURL(createRequire(import.meta.url).resolve('tsx/esm/api')).href, module: operation === 'calculation' ? import.meta.url : new URL(import.meta.url.endsWith('.ts') ? './snapshot-storage.ts' : './snapshot-storage.js', import.meta.url).href,
          input, operation },
      });
      activeWorker = worker;
    } catch {
      reject(new Error(prefix + '_FAILED'));
      return;
    }
    worker.stdout?.resume();
    worker.stderr?.resume();
    let finished = false;
    const finish = (error?: Error, snapshot?: PipelineSnapshot | true): void => {
      if (finished) return;
      finished = true;
      clearTimeout(deadline);
      // The materialization queue must not start another calculation until this
      // isolate is gone, including its tsx loader and any error/timeout path.
      void worker.terminate().then(() => {
        if (activeWorker === worker) activeWorker = null;
        if (error) reject(error);
        else resolve(snapshot!);
      }, () => reject(new Error(prefix + '_TERMINATION_FAILED')));
    };
    const deadline = setTimeout(() => finish(new Error(prefix + '_TIMED_OUT')), 120_000);
    deadline.unref();
    worker.on('message', (message: { ok?: boolean; snapshot?: PipelineSnapshot; saved?: boolean;
      committed?: boolean; log?: string; fields?: Record<string, unknown>; msg?: string }) => {
      if (finished) return;
      if (operation === 'storage' && message?.log && message.fields && typeof message.msg === 'string') {
        if (message.log === 'error') logSourceProblem(message.msg, message.fields);
        else logSnapshotChange(message.msg, message.fields);
        return;
      }
      if (operation === 'storage' && message?.committed === true) {
        void yieldToReads().then(() => {
          if (!finished) worker.postMessage({ resume: true });
        }).catch(() => finish(new Error(prefix + '_FAILED')));
        return;
      }
      if (operation === 'calculation' && message?.ok === true && typeof message.snapshot?.id === 'string')
        finish(undefined, message.snapshot);
      else if (operation === 'storage' && message?.ok === true && message.saved === true) finish(undefined, true);
      else finish(new Error(prefix + '_FAILED'));
    });
    worker.once('error', () => finish(new Error(prefix + '_FAILED')));
    worker.once('messageerror', () => finish(new Error(prefix + '_FAILED')));
    worker.once('exit', () => {
      if (activeWorker === worker) activeWorker = null;
      finish(new Error(prefix + '_EXITED_WITHOUT_RESULT'));
    });
  });
}
