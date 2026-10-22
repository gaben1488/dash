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

describe('storage failures are not successful empty results', () => {
  it('reports failed writes and allows retry after SQLite becomes writable', async () => {
    const { db } = await import('../db/index.js');
    db.$client.pragma('query_only = ON');
    try {
      expect(() => wm.saveWatermark('УО', 'pending', '2026-10-20T00:00:00Z')).toThrow();
      expect(() => wm.noteHonestGap('УО', 'pending')).toThrow();
    } finally {
      db.$client.pragma('query_only = OFF');
    }
    wm.saveWatermark('УО', 'accepted', '2026-10-20T00:00:00Z');
    expect(wm.watermarkOf('УО')?.fingerprint).toBe('accepted');
    expect(wm.noteHonestGap('УО', 'pending')).toBe(true);
  });
});



describe('R05.01: source receipt follows the single current profile and actual admitted masters', () => {
  it('rejects an absent or semantically invalid cached master even when stored watermarks exist', async () => {
    const { sheetFingerprint } = await import('./sheet-fingerprint.js');
    const { DEPARTMENT_REGISTRY, MASTER_SOURCE_PROFILE } = await import('@aemr/shared');
    const header = Object.values(MASTER_SOURCE_PROFILE.fields).map(field => field.label);
    const current: Record<string, { values: unknown[][] }> = {};
    const bindings: Record<string, string> = {};
    for (const dept of DEPARTMENT_REGISTRY) {
      const values = [[], [], [...header], ['1', '', '', '', '', '', 'Закупка']];
      bindings[dept.id] = dept.source.providerId;
      wm.saveWatermark(dept.id, sheetFingerprint(values), '2026-10-22T00:00:00Z', undefined,
        { fileId: dept.source.providerId, values });
      current[dept.id] = { values };
    }
    const svodValues = [['СВОД']];
    wm.saveWatermark(wm.SVOD_WATERMARK_KEY, sheetFingerprint(svodValues),
      '2026-10-22T00:00:00Z', undefined, { fileId: 'svod-source', values: svodValues });
    current[wm.SVOD_WATERMARK_KEY] = { values: svodValues };

    const original = wm.sourceStateReceipt(bindings, 'svod-source', current);
    expect(original).toMatch(/^[0-9a-f]{64}$/);
    expect(wm.sourceStateReceipt(bindings, 'svod-source', current)).toBe(original);

    const absent = { ...current };
    delete absent['УО'];
    expect(wm.sourceStateReceipt(bindings, 'svod-source', absent)).toBeNull();

    const invalidValues = current['УО'].values.map(row => [...row]);
    invalidValues[2][21] = 'Цена договора вместо ФБ 2';
    // The cached values are not authoritative if the active master meaning
    // no longer matches the reviewed profile, even if its watermark exists.
    expect(wm.sourceStateReceipt(bindings, 'svod-source', {
      ...current, 'УО': { values: invalidValues },
    })).toBeNull();
  });
});

describe('accepted current reading', () => {
  it('retains one state per book, restores it and rejects corruption', async () => {
    const { sheetFingerprint } = await import('./sheet-fingerprint.js');
    const { db } = await import('../db/index.js');
    const values = [[], [], [], [1094, 'УО', 'Учреждение', '', '', '', 'Предмет']];
    wm.saveWatermark('УО', sheetFingerprint(values), '2026-10-21T06:28:00Z', undefined,
      { fileId: 'same-source', values });
    expect(wm.loadAcceptedReadings().get('УО')).toEqual({ fileId: 'same-source', values });
    const changed = [[], [], []];
    wm.saveWatermark('УО', sheetFingerprint(changed), '2026-10-21T06:29:00Z', undefined,
      { fileId: 'same-source', values: changed });
    expect(wm.loadAcceptedReadings().size).toBe(1);
    expect(wm.loadAcceptedReadings().get('УО')?.values).toEqual(changed);
    db.$client.prepare("UPDATE book_watermarks SET reading_json = '{}' WHERE book = ?").run('УО');
    expect(() => wm.loadAcceptedReadings()).toThrow('SOURCE_STATE_READ_FAILED');
  });
});
