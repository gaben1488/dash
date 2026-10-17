import { afterAll, expect, it, vi } from 'vitest';
process.env.NODE_ENV = 'test'; process.env.SQLITE_PATH = ':memory:';
process.env.AEMR_API_KEY = ''; process.env.LOG_LEVEL = 'silent';
const startup = vi.hoisted(() => ({ refresh: vi.fn(async () => ({ loaded: [], failed: [] })),
  snapshot: vi.fn(async () => ({ officialMetrics: {}, calculatedMetrics: {}, issues: [], deltas: [] })) }));
const watch = vi.hoisted(() => ({ start: vi.fn(), stop: vi.fn(), legacy: vi.fn() }));
vi.mock('./services/webhook-channel.js', async original => ({ ...await original<typeof import('./services/webhook-channel.js')>(),
  startWebhookChannels: watch.start, stopWebhookChannels: watch.stop }));
vi.mock('./services/drive-watch.js', () => ({ startDriveWatch: watch.legacy }));
vi.mock('./services/source-refresh.js', async original => ({ ...await original<typeof import('./services/source-refresh.js')>(),
  refreshAllSources: startup.refresh, startSourceAutoRefresh: vi.fn() }));
vi.mock('./services/snapshot.js', async original => ({ ...await original<typeof import('./services/snapshot.js')>(),
  getSnapshot: startup.snapshot }));
vi.mock('./services/formula-sink.js', () => ({ connectFormulaSink: vi.fn() }));
vi.mock('./routes/webhook.js', async original => ({ ...await original<typeof import('./routes/webhook.js')>(), recoverWebhookQueue: vi.fn() }));
const { createApp, preloadData } = await import('./app.js');
const app = await createApp({ logger: false });
afterAll(() => app.close());
it('запускает единый постоянный контур каналов и останавливает его при закрытии приложения', async () => {
 preloadData(app);
 await vi.waitFor(() => expect(watch.start).toHaveBeenCalledTimes(1));
 expect(watch.legacy).not.toHaveBeenCalled();
 await app.close(); expect(watch.stop).toHaveBeenCalledTimes(1);
});

it('не оживляет push после закрытия во время первоначального чтения', async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  startup.refresh.mockImplementationOnce(async () => { await gate; return { loaded: [], failed: [] }; });
  const closed = await createApp({ logger: false });
  const calls = watch.start.mock.calls.length;
  const snapshots = startup.snapshot.mock.calls.length;
  preloadData(closed);
  await closed.close();
  release();
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(watch.start).toHaveBeenCalledTimes(calls);
  expect(startup.snapshot).toHaveBeenCalledTimes(snapshots);
});

it('не начинает чтение источников у уже закрытого приложения', async () => {
  const closed = await createApp({ logger: false });
  await closed.close();
  const refreshes = startup.refresh.mock.calls.length;
  const snapshots = startup.snapshot.mock.calls.length;
  preloadData(closed);
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(startup.refresh).toHaveBeenCalledTimes(refreshes);
  expect(startup.snapshot).toHaveBeenCalledTimes(snapshots);
});
