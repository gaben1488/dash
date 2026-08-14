import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { freshImport, isChunkLoadError } from './fresh-import';

/**
 * Страж класса «выкат под открытой вкладкой» (прод, 14.08.2026): отказ куска
 * сборки после обновления версии лечится одной перезагрузкой, а не красной
 * ошибкой; настоящий обрыв сети перезагрузками не зацикливается.
 *
 * Окружение тестов — node (как во всём пакете): браузерные глобалы
 * подменяются по образцу api.test.ts.
 */
function memoryStorage() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
  };
}

const reload = vi.fn();

beforeEach(() => {
  reload.mockClear();
  vi.stubGlobal('sessionStorage', memoryStorage());
  vi.stubGlobal('window', { location: { reload } });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('freshImport', () => {
  it('распознаёт формулировки отказа куска у разных браузеров', () => {
    for (const msg of [
      'Failed to fetch dynamically imported module: http://x/assets/text-blocks-kHWHMMei.js',
      'error loading dynamically imported module',
      'Importing a module script failed.',
      'ChunkLoadError: Loading chunk 42 failed',
    ]) {
      expect(isChunkLoadError(new Error(msg))).toBe(true);
    }
    expect(isChunkLoadError(new Error('NetworkError when attempting to fetch resource'))).toBe(false);
  });

  it('успешная загрузка проходит насквозь и снимает метку перезагрузки', async () => {
    sessionStorage.setItem('aemr-chunk-reload', '1');
    const mod = await freshImport(() => Promise.resolve({ ok: true }));
    expect(mod).toEqual({ ok: true });
    expect(sessionStorage.getItem('aemr-chunk-reload')).toBeNull();
  });

  it('первый отказ куска перезагружает страницу один раз', async () => {
    const p = freshImport(() => Promise.reject(new Error('Failed to fetch dynamically imported module: x')));
    // Промис намеренно вечный — страница уходит в перезагрузку.
    const state = await Promise.race([
      p.then(() => 'resolved'),
      new Promise((r) => setTimeout(() => r('pending'), 20)),
    ]);
    expect(state).toBe('pending');
    expect(reload).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem('aemr-chunk-reload')).toBe('1');
  });

  it('повторный отказ (реальный обрыв) пробрасывается ошибкой, без цикла перезагрузок', async () => {
    sessionStorage.setItem('aemr-chunk-reload', '1');
    await expect(
      freshImport(() => Promise.reject(new Error('Failed to fetch dynamically imported module: x'))),
    ).rejects.toThrow();
    expect(reload).not.toHaveBeenCalled();
  });

  it('чужие ошибки (не куски сборки) пробрасываются сразу', async () => {
    await expect(freshImport(() => Promise.reject(new Error('база недоступна')))).rejects.toThrow('база недоступна');
  });
});
