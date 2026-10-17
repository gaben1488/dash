import { beforeEach, expect, it, vi } from 'vitest';
vi.mock('./api', () => ({ api: { getRegistryBuckets: vi.fn() }, humanizeRequestError: String }));
import { api } from './api';
import { useStore } from './store';
const mock = vi.mocked(api.getRegistryBuckets);
const reading = (rows: number, asOf: string) => ({ unfunded: { rows, planSum: rows, initiativeRows: 1 }, yearlong: { rows: 2, planSum: 3 }, asOf, source: 'live' as const });
beforeEach(() => { mock.mockReset(); useStore.setState({ bucketCounts: null, dashboardData: null }); });
it('навигация и состояние используют одно полное принятое чтение', async () => {
 const data = reading(597, '2026-10-12T00:00:00Z'); mock.mockResolvedValueOnce(data);
 await useStore.getState().fetchBucketCounts();
 const counts = useStore.getState().bucketCounts;
 expect(counts?.unfunded).toBe(597); expect(counts?.reading).toEqual(data);
});
it('поздний ответ не заменяет более новое чтение', async () => {
 let resolve!: (v: ReturnType<typeof reading>) => void;
 mock.mockReturnValueOnce(new Promise(r => { resolve = r; })).mockResolvedValueOnce(reading(600, 'new'));
 const first = useStore.getState().fetchBucketCounts(); await useStore.getState().fetchBucketCounts();
 resolve(reading(597, 'old')); await first;
 expect(useStore.getState().bucketCounts?.unfunded).toBe(600);
});
it('отказ перечитки сбрасывает счётчики и источник, не выдавая старый счёт за свежий', async () => {
 mock.mockResolvedValueOnce(reading(597, 'old')).mockRejectedValueOnce(new Error('503'));
 await useStore.getState().fetchBucketCounts(); await useStore.getState().fetchBucketCounts();
 expect(useStore.getState().bucketCounts).toBeNull();
});
it('не принимает чтение прежнего контекста, если снимок сменился до ответа', async () => {
 let resolve!: (v: ReturnType<typeof reading>) => void;
 mock.mockReturnValueOnce(new Promise(r => { resolve = r; }));
 useStore.setState({ dashboardData: { snapshot: { id: 'old' } } as never });
 const request = useStore.getState().fetchBucketCounts();
 useStore.setState({ dashboardData: { snapshot: { id: 'new' } } as never });
 resolve(reading(597, 'old')); await request;
 expect(useStore.getState().bucketCounts).toBeNull();
});
