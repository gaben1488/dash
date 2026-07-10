/**
 * fetchDepartmentSpreadsheets — обработка ошибок на кандидате имени листа.
 *
 * Баг B-6 (bug-hunt): голый catch{} в цикле по кандидатам
 * (google-sheets.ts, fetchDepartmentSpreadsheets, ~строки 276-286)
 * одинаково проглатывал 429 (rate-limit), 403 (permission) и настоящий
 * 404/400 (лист не найден) — все три превращались в общее
 * "No readable sheet found". Отдельно errors[] индексировался через
 * msg.match(/for (.+)$/) на тексте брошенной ошибки, что при формате
 * "...for {deptName}; tried: {candidates}" давало ключ
 * "{deptName}; tried: ..." вместо чистого deptName — ломая keyed-lookup
 * потребителей (journal.ts:299 deptMeta[deptName], app.ts:166-168,
 * dashboard.ts:471-474).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const valuesGet = vi.fn();

vi.mock('googleapis', () => ({
  google: {
    sheets: vi.fn(() => ({
      spreadsheets: {
        values: { get: valuesGet, batchGet: vi.fn(), update: vi.fn() },
        get: vi.fn(),
      },
    })),
    // Must be a real `function`, not an arrow function: getSheetsApi() calls
    // this with `new`, and mockImplementation(() => ({})) is not constructible
    // (throws, masking the actual bug this test targets before any API call
    // is ever reached — confirmed empirically while drafting this test).
    auth: { GoogleAuth: vi.fn(function GoogleAuth() { return {}; }) },
  },
}));

beforeEach(() => {
  valuesGet.mockReset();
});

afterEach(() => {
  vi.resetModules();
});

describe('fetchDepartmentSpreadsheets — per-candidate error handling', () => {
  it('keys errors[] by the plain department name, not a mangled string parsed from the error message', async () => {
    valuesGet.mockRejectedValue(
      Object.assign(new Error('Requested entity was not found.'), { status: 404 }),
    );
    const { fetchDepartmentSpreadsheets } = await import('./google-sheets.js');

    const { data, errors } = await fetchDepartmentSpreadsheets({ НЕИЗВЕСТНЫЙ: 'ss-id' });

    expect(data).toEqual({});
    expect(Object.keys(errors)).toEqual(['НЕИЗВЕСТНЫЙ']);
  });

  it('surfaces a rate-limit error distinctly instead of masking it as "not found", and stops probing further name candidates', async () => {
    const quotaError = Object.assign(new Error('Quota exceeded for quota metric'), { status: 429 });
    valuesGet.mockRejectedValue(quotaError);
    const { fetchDepartmentSpreadsheets } = await import('./google-sheets.js');

    // 'УО' normally probes 3 sheet-name candidates (ВСЕ, Все, УО, per
    // departmentSheetNameCandidates). A 429 on the very first attempt must
    // not be swallowed and silently retried as if it were a missing sheet.
    const { errors } = await fetchDepartmentSpreadsheets({ УО: 'ss-id' });

    const rangesTried = valuesGet.mock.calls.map((call) => String((call[0] as { range: string }).range));
    const distinctSheetNamesTried = new Set(rangesTried.map((r) => r.split('!')[0]));
    expect(distinctSheetNamesTried.size).toBe(1);

    expect(errors['УО']).toBeDefined();
    expect(errors['УО']).toContain('Quota exceeded');
    expect(errors['УО']).not.toMatch(/^No readable sheet found/);
  });
});
