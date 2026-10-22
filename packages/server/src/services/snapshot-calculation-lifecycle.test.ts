import type { WorkerOptions } from 'node:worker_threads';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { SnapshotCalculationInput } from './snapshot-calculation.js';

const state = vi.hoisted(() => ({ workers: [] as Array<{
  options: WorkerOptions; emit: (event: string, ...args: unknown[]) => boolean;
  terminate: ReturnType<typeof vi.fn<() => Promise<number>>>;
}>, failConstruction: false }));
vi.mock('node:worker_threads', async () => {
  const { EventEmitter } = await import('node:events');
  return { Worker: class extends EventEmitter {
    options: WorkerOptions;
    terminate = vi.fn(async () => { this.emit('exit', 1); return 1; });
    constructor(_program: string, options: WorkerOptions) {
      super();
      if (state.failConstruction) throw new Error('PRIVATE_CONSTRUCTOR_DETAIL');
      this.options = options; state.workers.push(this);
    }
  } };
});

const source = (): SnapshotCalculationInput => ({ batchGetData: [], sheetRows: {}, reportMap: [],
  spreadsheetId: 'synthetic', asOf: new Date('2026-10-18T00:00:00Z') });
beforeEach(() => { state.workers = []; state.failConstruction = false; vi.resetModules(); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

it('завершает isolate до выдачи результата и не передаёт credentials/NODE_OPTIONS', async () => {
  vi.stubEnv('GOOGLE_PRIVATE_KEY', 'PRIVATE'); vi.stubEnv('NODE_OPTIONS', '--max-old-space-size=7168');
  const { runSnapshotCalculation } = await import('./snapshot-calculation.js');
  const result = runSnapshotCalculation(source());
  const worker = state.workers[0];
  let finish!: (code: number) => void;
  worker.terminate.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const snapshot = { id: 'synthetic-result' };
  worker.emit('message', { ok: true, snapshot });
  let resolved = false; void result.then(() => { resolved = true; });
  await Promise.resolve(); expect(resolved).toBe(false);
  expect(worker.options.execArgv).toEqual([]);
  expect(worker.options.resourceLimits).toEqual({ maxOldGenerationSizeMb: 512 });
  expect(JSON.stringify(worker.options.env)).not.toContain('PRIVATE');
  expect(worker.options.env).not.toHaveProperty('NODE_OPTIONS');
  finish(1); expect(await result).toEqual(snapshot);
});

it.each(['error', 'messageerror', 'exit'])('отказ %s не становится снимком и заканчивает поток', async event => {
  const { runSnapshotCalculation } = await import('./snapshot-calculation.js');
  const result = runSnapshotCalculation(source());
  const assertion = expect(result).rejects.toThrow(/^SNAPSHOT_CALCULATION_/);
  state.workers[0].emit(event, new Error('PRIVATE'));
  await assertion;
  expect(state.workers[0].terminate).toHaveBeenCalledOnce();
});

it('таймаут фонового расчёта конечен и завершает поток', async () => {
  vi.useFakeTimers();
  const { runSnapshotCalculation } = await import('./snapshot-calculation.js');
  const result = runSnapshotCalculation(source());
  const assertion = expect(result).rejects.toThrow('SNAPSHOT_CALCULATION_TIMED_OUT');
  await vi.advanceTimersByTimeAsync(120_000);
  await assertion; expect(state.workers[0].terminate).toHaveBeenCalledOnce();
});

it('не создаёт второй isolate, пока первый ещё жив', async () => {
  const { runSnapshotCalculation } = await import('./snapshot-calculation.js');
  const first = runSnapshotCalculation(source()); void first.catch(() => {});
  const second = runSnapshotCalculation(source()); void second.catch(() => {});
  try {
    expect(state.workers).toHaveLength(1);
    await expect(second).rejects.toThrow('SNAPSHOT_CALCULATION_BUSY');
  } finally {
    for (const worker of state.workers) worker.emit('error', new Error('synthetic'));
    await Promise.allSettled([first, second]);
  }
});

it('ошибка создания потока не раскрывает детали и не оставляет занятый слот', async () => {
  const { runSnapshotCalculation } = await import('./snapshot-calculation.js');
  state.failConstruction = true;
  await expect(runSnapshotCalculation(source())).rejects.toThrow('SNAPSHOT_CALCULATION_FAILED');
  state.failConstruction = false;
  const result = runSnapshotCalculation(source());
  state.workers[0].emit('message', { ok: true, snapshot: { id: 'recovered' } });
  expect(await result).toEqual({ id: 'recovered' });
});

it('не открывает новый слот при отказе terminate до фактического exit', async () => {
  const { runSnapshotCalculation } = await import('./snapshot-calculation.js');
  const first = runSnapshotCalculation(source());
  state.workers[0].terminate.mockRejectedValueOnce(new Error('synthetic termination error'));
  state.workers[0].emit('error', new Error('synthetic'));
  await expect(first).rejects.toThrow('SNAPSHOT_CALCULATION_TERMINATION_FAILED');
  await expect(runSnapshotCalculation(source())).rejects.toThrow('SNAPSHOT_CALCULATION_BUSY');
  expect(state.workers).toHaveLength(1);
  state.workers[0].emit('exit', 1);
  const next = runSnapshotCalculation(source());
  state.workers[1].emit('message', { ok: true, snapshot: { id: 'after-exit' } });
  expect(await next).toEqual({ id: 'after-exit' });
});


it('расчёт и сохранение делят один ограниченный слот', async () => {
  const { runSnapshotCalculation, runSnapshotStorage } = await import('./snapshot-calculation.js');
  const storage = { path: '/synthetic/state.sqlite', snapshot: { id: 'synthetic' },
    offset: 12, today: new Date(), operation: 'insert' } as Parameters<typeof runSnapshotStorage>[0];
  const first = runSnapshotCalculation(source());
  await expect(runSnapshotStorage(storage)).rejects.toThrow('SNAPSHOT_STORAGE_BUSY');
  state.workers[0].emit('message', { ok: true, snapshot: { id: 'done' } });
  await first;
  const saved = runSnapshotStorage(storage);
  expect(state.workers).toHaveLength(2);
  state.workers[1].emit('message', { ok: true, saved: true });
  expect(await saved).toBe(true);
});
