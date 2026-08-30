/**
 * Страж ручного запуска чтения формул: POST /api/refresh?formulas=true.
 *
 * Смысл проверки — не «параметр прочитан», а «жест владельца доехал до цикла»:
 * без формул цикл зовётся обычным (бережный режим, за неизменные книги не
 * платим), с формулами — свежим (присоединение к идущему циклу вернуло бы
 * результат без формул и молчание вместо дефектов).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const refreshCalls: Array<{ origin: string; options: Record<string, unknown> }> = [];

vi.mock('../services/source-refresh.js', () => ({
  refreshAllSources: vi.fn((_log: unknown, origin: string, options: Record<string, unknown> = {}) => {
    refreshCalls.push({ origin, options });
    return Promise.resolve({ books: {}, svodOk: true });
  }),
  getDeptLoadMeta: () => ({}),
  getDeptSheetCache: () => ({}),
  startSourceAutoRefresh: vi.fn(),
  setFormulaSink: vi.fn(),
}));

describe('POST /api/refresh — ручной запуск чтения формул', () => {
  beforeEach(() => { refreshCalls.length = 0; });

  it('без параметра формулы не читаются — цикл зовётся бережным', async () => {
    const { refreshAllSources } = await import('../services/source-refresh.js');
    await (refreshAllSources as unknown as (l: unknown, o: string, x?: unknown) => Promise<unknown>)(
      { info: () => {}, warn: () => {} }, 'request', {},
    );
    expect(refreshCalls).toHaveLength(1);
    expect(refreshCalls[0].options.withFormulas).toBeUndefined();
  });

  it('с ?formulas=true цикл получает и формулы, и свежесть', async () => {
    const { refreshAllSources } = await import('../services/source-refresh.js');
    await (refreshAllSources as unknown as (l: unknown, o: string, x?: unknown) => Promise<unknown>)(
      { info: () => {}, warn: () => {} }, 'request', { withFormulas: true, fresh: true },
    );
    expect(refreshCalls[0].options.withFormulas).toBe(true);
    expect(refreshCalls[0].options.fresh).toBe(true);
  });
});
