/**
 * Страж водяного знака (§2.4) и честных пропусков (§2.2) проекта службы.
 *
 * Знак пишется в базу и читается обратно — то, что переживает рестарт;
 * повторная запись по книге обновляет, а не плодит; один и тот же пропуск
 * (книга + отметка файла) не пишется дважды.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const ORIGINAL_ENV = { ...process.env };

let wm: typeof import('./book-watermark.js');

beforeAll(async () => {
  vi.resetModules();
  process.env = { ...ORIGINAL_ENV, NODE_ENV: 'test', SQLITE_PATH: ':memory:' };
  wm = await import('./book-watermark.js');
}, 60_000);

afterAll(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.resetModules();
});

beforeEach(() => {
  wm.resetWatermarks();
});

describe('водяной знак книги', () => {
  it('записанный знак читается обратно — база сравнения переживает рестарт', () => {
    wm.saveWatermark('УО', 'отпечаток-1', '2026-08-29T00:00:00.000Z', {
      version: '41',
      modifiedTime: '2026-08-28T23:59:00.000Z',
    });

    const loaded = wm.loadWatermarks();
    expect(loaded.get('УО')).toEqual({
      fingerprint: 'отпечаток-1',
      parsedAt: '2026-08-29T00:00:00.000Z',
      driveVersion: '41',
      driveModifiedTime: '2026-08-28T23:59:00.000Z',
    });
  });

  it('повторная запись по книге обновляет знак, а не плодит второй', () => {
    wm.saveWatermark('УО', 'отпечаток-1', '2026-08-29T00:00:00.000Z');
    wm.saveWatermark('УО', 'отпечаток-2', '2026-08-29T01:00:00.000Z');

    const loaded = wm.loadWatermarks();
    expect(loaded.size).toBe(1);
    expect(loaded.get('УО')?.fingerprint).toBe('отпечаток-2');
    expect(wm.watermarkOf('УО')?.parsedAt).toBe('2026-08-29T01:00:00.000Z');
  });

  it('лист СВОД живёт под собственным ключом рядом с книгами', () => {
    wm.saveWatermark(wm.SVOD_WATERMARK_KEY, 'свод-отпечаток', '2026-08-29T00:00:00.000Z');
    expect(wm.loadWatermarks().get('лист СВОД')?.fingerprint).toBe('свод-отпечаток');
  });
});

describe('честные пропуски журнала (правило полноты)', () => {
  it('пропуск записывается и виден: изменение было, содержание не установлено', () => {
    expect(wm.noteHonestGap('УО', '2026-08-29T01:00:00.000Z')).toBe(true);

    const gaps = wm.recentGaps();
    expect(gaps).toHaveLength(1);
    expect(gaps[0]).toMatchObject({ book: 'УО', fileModifiedTime: '2026-08-29T01:00:00.000Z' });
  });

  it('один и тот же пропуск не пишется дважды — повторная перечитка не второй пропуск', () => {
    expect(wm.noteHonestGap('УО', '2026-08-29T01:00:00.000Z')).toBe(true);
    expect(wm.noteHonestGap('УО', '2026-08-29T01:00:00.000Z')).toBe(false);
    expect(wm.recentGaps()).toHaveLength(1);

    // Другая отметка файла — другой пропуск: изменение было ещё раз.
    expect(wm.noteHonestGap('УО', '2026-08-29T02:00:00.000Z')).toBe(true);
    expect(wm.recentGaps()).toHaveLength(2);
  });

  it('пропуск без отметки файла тоже дедуплицируется', () => {
    expect(wm.noteHonestGap('УКСиМП', null)).toBe(true);
    expect(wm.noteHonestGap('УКСиМП', null)).toBe(false);
    expect(wm.recentGaps()).toHaveLength(1);
  });
});
