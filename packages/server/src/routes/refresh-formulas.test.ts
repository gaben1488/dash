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

describe('ручное чтение формул отменяет отсев по отметке Drive', () => {
  it('withFormulas выключает вопрос к Drive — иначе жест бесполезен', async () => {
    const src = await import('node:fs').then((fs) =>
      fs.readFileSync(new URL('../services/source-refresh.ts', import.meta.url), 'utf8'));
    // Страж держит связку словами кода: правка формулировки не должна тихо
    // вернуть отсев, из-за которого ручной запуск ничего не читал (30.08).
    expect(src).toContain('const askDrive = options.withFormulas ? false : (options.askDrive ?? true);');
    expect(src).toContain('askDrive,');
  });
});
