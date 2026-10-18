import { computeUnifiedGrid, reconcileUnified, runPipeline, type PipelineInput, type PipelineSnapshot } from '@aemr/core';
import { findDept, getActiveRules, SVOD_SHEET_NAME, type DataSnapshot, type SvodReconRow } from '@aemr/shared';
import { Worker } from 'node:worker_threads';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

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

  const grid = computeUnifiedGrid(deptRowsById, targetYear);
  snapshot.unifiedGrid = grid;
  snapshot.unifiedReconciliation = reconcileUnified(grid, snapshot.officialMetrics) as SvodReconRow[];
}

export function calculateSnapshot(input: SnapshotCalculationInput): PipelineSnapshot {
  const snapshot = runPipeline({ ...input, rules: getActiveRules() });
  attachUnifiedGrid(snapshot, input.sheetRows, input.targetYear);
  return snapshot;
}

// Constant program; paths are resolved from this module, never from source data.
// Explicit tsImport works in the installed tsx runtime and in the emitted server.
const CALCULATION_BOOTSTRAP = `
  const { parentPort, workerData } = require('node:worker_threads');
  (async () => {
    const { tsImport } = await import(workerData.loader);
    const { calculateSnapshot } = await tsImport(workerData.module, workerData.module);
    parentPort.postMessage({ ok: true, snapshot: calculateSnapshot(workerData.input) });
  })().catch(() => parentPort.postMessage({ ok: false }));
`;

// No second queue: snapshot.ts owns scheduling. This slot fails closed if an
// isolate cannot be terminated, so a later failed materialization cannot leak one.
let activeWorker: Worker | null = null;

export function runSnapshotCalculation(input: SnapshotCalculationInput): Promise<PipelineSnapshot> {
  return new Promise((resolve, reject) => {
    if (activeWorker !== null) {
      reject(new Error('SNAPSHOT_CALCULATION_BUSY'));
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
        workerData: { loader: pathToFileURL(createRequire(import.meta.url).resolve('tsx/esm/api')).href, module: import.meta.url,
          input: { ...input, asOf: input.asOf === undefined ? new Date() : input.asOf } },
      });
      activeWorker = worker;
    } catch {
      reject(new Error('SNAPSHOT_CALCULATION_FAILED'));
      return;
    }
    worker.stdout?.resume();
    worker.stderr?.resume();
    let finished = false;
    const finish = (error?: Error, snapshot?: PipelineSnapshot): void => {
      if (finished) return;
      finished = true;
      clearTimeout(deadline);
      // The materialization queue must not start another calculation until this
      // isolate is gone, including its tsx loader and any error/timeout path.
      void worker.terminate().then(() => {
        if (activeWorker === worker) activeWorker = null;
        if (error) reject(error);
        else resolve(snapshot!);
      }, () => reject(new Error('SNAPSHOT_CALCULATION_TERMINATION_FAILED')));
    };
    const deadline = setTimeout(() => finish(new Error('SNAPSHOT_CALCULATION_TIMED_OUT')), 120_000);
    deadline.unref();
    worker.once('message', (message: { ok?: boolean; snapshot?: PipelineSnapshot }) => {
      if (message?.ok === true && typeof message.snapshot?.id === 'string') finish(undefined, message.snapshot);
      else finish(new Error('SNAPSHOT_CALCULATION_FAILED'));
    });
    worker.once('error', () => finish(new Error('SNAPSHOT_CALCULATION_FAILED')));
    worker.once('messageerror', () => finish(new Error('SNAPSHOT_CALCULATION_FAILED')));
    worker.once('exit', () => {
      if (activeWorker === worker) activeWorker = null;
      finish(new Error('SNAPSHOT_CALCULATION_EXITED_WITHOUT_RESULT'));
    });
  });
}
