/**
 * Страховка процесса.
 *
 * Охраняются два обещания:
 *   1. Необработанная ошибка попадает в журнал целиком — с местом и причиной,
 *      а не строкой «[object Object]»: иначе страховка превращается в глушилку.
 *   2. В прогоне тестов страховка НЕ ставится. Заглушить падение в прогоне
 *      значит спрятать настоящую поломку от того, кто её чинит.
 */
import type { FastifyBaseLogger } from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import {
  installProcessGuards,
  reportUncaughtException,
  reportUnhandledRejection,
} from './process-guards.js';

function fakeLog(): { log: FastifyBaseLogger; error: ReturnType<typeof vi.fn> } {
  const error = vi.fn();
  return { log: { error } as unknown as FastifyBaseLogger, error };
}

describe('запись в журнал', () => {
  it('отказ обещания с обычной ошибкой сохраняет саму ошибку', () => {
    const { log, error } = fakeLog();
    const boom = new Error('книга не открылась');

    expect(() => reportUnhandledRejection(log, boom)).not.toThrow();
    expect(error).toHaveBeenCalledTimes(1);
    expect(error.mock.calls[0][0]).toEqual({ err: boom });
    expect(error.mock.calls[0][1]).toMatch(/Необработанный отказ обещания/);
  });

  it('отказ обещания со строкой превращается в ошибку с этим текстом', () => {
    const { log, error } = fakeLog();

    reportUnhandledRejection(log, 'источник молчит');

    const { err } = error.mock.calls[0][0] as { err: Error };
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe('источник молчит');
  });

  it('исключение без типа ошибки не теряет содержимое', () => {
    const { log, error } = fakeLog();

    reportUncaughtException(log, { код: 500 });

    const { err } = error.mock.calls[0][0] as { err: Error };
    expect(err.message).toContain('500');
  });
});

describe('установка страховки', () => {
  it('в прогоне тестов обработчики не ставятся', () => {
    const before = process.listenerCount('uncaughtException');
    const { log } = fakeLog();

    installProcessGuards(log);

    expect(process.listenerCount('uncaughtException')).toBe(before);
  });
});
