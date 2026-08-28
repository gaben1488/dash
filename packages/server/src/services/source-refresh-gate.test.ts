/**
 * Стражи ступени отсева у Drive (21.08.2026).
 *
 * Настоящего диффа Google не даёт: values.get/batchGet читают диапазоны, а
 * push-уведомление Drive называет файл и ничего мельче (guides/push, «Receive
 * notification»). Единственная разница, которую можно взять у Google даром, —
 * отметка версии файла: `version` и `modifiedTime` из files.get с маской полей.
 * Здесь закреплено, что продукт ею пользуется — и не превращает её в ловушку.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';

const fetchDepartmentSpreadsheets = vi.fn();
const getSheetData = vi.fn();
const setDeptSheetCache = vi.fn();
const setDeptLoadMeta = vi.fn();
const setSvodGridCache = vi.fn();
const setSvodLoadFailure = vi.fn();
const invalidateCache = vi.fn();
const getDeptSheetCache = vi.fn(() => ({}));

vi.mock('./google-sheets.js', () => ({
  fetchDepartmentSpreadsheets: (...a: unknown[]) => fetchDepartmentSpreadsheets(...a),
  getSheetData: (...a: unknown[]) => getSheetData(...a),
}));

vi.mock('./snapshot.js', () => ({
  setDeptSheetCache: (...a: unknown[]) => setDeptSheetCache(...a),
  setDeptLoadMeta: (...a: unknown[]) => setDeptLoadMeta(...a),
  setSvodGridCache: (...a: unknown[]) => setSvodGridCache(...a),
  setSvodLoadFailure: (...a: unknown[]) => setSvodLoadFailure(...a),
  invalidateCache: (...a: unknown[]) => invalidateCache(...a),
  getDeptSheetCache: () => getDeptSheetCache(),
  getSvodLoadFailure: () => null,
}));

type Verdict = 'changed' | 'same' | 'unknown';
const verdicts = new Map<string, Verdict>();
const checkFileChanged = vi.fn(async (fileId: string) => verdicts.get(fileId) ?? 'unknown');
const forgetRevision = vi.fn();

vi.mock('./file-revision.js', () => ({
  checkFileChanged: (...a: unknown[]) => checkFileChanged(...(a as [string])),
  forgetRevision: (...a: unknown[]) => forgetRevision(...(a as [string])),
  // Свидетельство «была прежняя отметка» здесь не проверяется — гейт отвечает
  // за отсев чтений; честные пропуски охраняет source-refresh.test.ts.
  lastKnownRevision: vi.fn(() => null),
  seedRevision: vi.fn(),
}));

// Водяной знак заглушен: гейт проверяет отсев чтений, а не память базы.
vi.mock('./book-watermark.js', () => ({
  SVOD_WATERMARK_KEY: 'лист СВОД',
  loadWatermarks: vi.fn(() => new Map()),
  saveWatermark: vi.fn(),
  noteHonestGap: vi.fn(() => true),
}));

const log = { info: vi.fn(), warn: vi.fn() };

/** Идентификаторы книг — те же, что в боевой настройке (config.ts). */
let bookIds: Record<string, string>;

beforeAll(async () => {
  const { DEPARTMENT_SPREADSHEETS } = await import('../config.js');
  bookIds = DEPARTMENT_SPREADSHEETS;
  await import('./source-refresh.js');
}, 60_000);

beforeEach(() => {
  vi.clearAllMocks();
  verdicts.clear();
  fetchDepartmentSpreadsheets.mockImplementation(async (_all: unknown, opts: { only?: string[] } = {}) => ({
    data: Object.fromEntries(
      (opts.only ?? Object.keys(bookIds)).map((name) => [
        name,
        { values: [[name, Math.random()]], formulas: [], sheetName: 'ВСЕ' },
      ]),
    ),
    errors: {},
  }));
  getSheetData.mockResolvedValue([['СВОД', Math.random()]]);
});

afterEach(async () => {
  const { stopSourceAutoRefresh } = await import('./source-refresh.js');
  stopSourceAutoRefresh();
});

/** Первый цикл: книг ещё не читали, поэтому спрашивать не о чем. */
async function warmUp(): Promise<void> {
  const { refreshAllSources } = await import('./source-refresh.js');
  await refreshAllSources(log);
}

describe('перечитка спрашивает Drive, прежде чем читать книгу', () => {
  it('холодный старт не платит за вопросы: книгу, которую не читали, не спрашивают', async () => {
    await warmUp();
    expect(checkFileChanged).not.toHaveBeenCalled();
    expect(fetchDepartmentSpreadsheets).toHaveBeenCalledTimes(1);
  });

  it('файл не менялся — книга не читается вовсе, но и не считается упавшей', async () => {
    await warmUp();
    vi.clearAllMocks();

    // Все книги неизменны, кроме УО.
    for (const id of Object.values(bookIds)) verdicts.set(id, 'same');
    verdicts.set(bookIds['УО'], 'changed');

    const { refreshAllSources } = await import('./source-refresh.js');
    const r = await refreshAllSources(log, 'cycle', { svod: false });

    expect(fetchDepartmentSpreadsheets).toHaveBeenCalledTimes(1);
    const options = fetchDepartmentSpreadsheets.mock.calls[0][1] as { only?: string[] };
    expect(options.only).toEqual(['УО']);
    expect(r.skipped).toContain('УКСиМП');
    expect(r.skipped).not.toContain('УО');
    // Дифф не теряет строк: непрочитанная книга НЕ попадает в список упавших,
    // а значит остаётся в кэше со всеми своими строками.
    expect(setDeptSheetCache).toHaveBeenCalledWith(expect.anything(), []);
  });

  it('событие без изменений не вызывает ни чтения, ни пересборки снимка', async () => {
    await warmUp();
    vi.clearAllMocks();

    for (const id of Object.values(bookIds)) verdicts.set(id, 'same');

    // Уведомление о правке в книге ГРБС листа СВОД не касается — цель приходит
    // без него (services/refresh-targets.ts), поэтому и здесь `svod: false`.
    const { refreshAllSources } = await import('./source-refresh.js');
    const r = await refreshAllSources(log, 'webhook', { svod: false });

    expect(fetchDepartmentSpreadsheets).not.toHaveBeenCalled();
    expect(getSheetData).not.toHaveBeenCalled();
    // Кэш снимка не сбрасывается: на экране те же числа, что и в кэше.
    expect(invalidateCache).not.toHaveBeenCalled();
    expect(r.booksRead).toBe(0);
    expect(r.skipped.length).toBeGreaterThan(0);
  });

  it('лист СВОД ступени не подлежит: он производный и меняется без правки файла', async () => {
    // Строки СВОДа приходят из книг через IMPORTRANGE и пересчитываются сами.
    // `modifiedTime` считает правки, а не пересчёты, поэтому «файл не менялся»
    // про сводную книгу не означает «числа те же».
    await warmUp();
    vi.clearAllMocks();
    for (const id of Object.values(bookIds)) verdicts.set(id, 'same');
    const { config } = await import('../config.js');
    verdicts.set(config.google.spreadsheetId, 'same');

    const { refreshAllSources } = await import('./source-refresh.js');
    const r = await refreshAllSources(log, 'cycle');

    expect(getSheetData).toHaveBeenCalledTimes(1);
    expect(r.svodOk).toBe(true);
    expect(checkFileChanged).not.toHaveBeenCalledWith(config.google.spreadsheetId);
  });

  it('Drive промолчал — читаем, как читали: «не знаю» не повод пропустить правку', async () => {
    await warmUp();
    vi.clearAllMocks();
    // verdicts пуст → заглушка отвечает 'unknown' на любой файл.

    const { refreshAllSources } = await import('./source-refresh.js');
    const r = await refreshAllSources(log, 'cycle', { svod: false });

    expect(fetchDepartmentSpreadsheets).toHaveBeenCalledTimes(1);
    expect(r.skipped).toEqual([]);
  });

  it('askDrive:false читает безусловно — ручное «обновить» не рассуждает о надобности', async () => {
    await warmUp();
    vi.clearAllMocks();
    for (const id of Object.values(bookIds)) verdicts.set(id, 'same');

    const { refreshAllSources } = await import('./source-refresh.js');
    await refreshAllSources(log, 'request', { askDrive: false, svod: false });

    expect(checkFileChanged).not.toHaveBeenCalled();
    expect(fetchDepartmentSpreadsheets).toHaveBeenCalledTimes(1);
  });

  it('чтение упало — отметка версии забыта, иначе книга выпала бы из перечиток', async () => {
    await warmUp();
    vi.clearAllMocks();
    fetchDepartmentSpreadsheets.mockResolvedValueOnce({
      data: {},
      errors: { 'УО': 'таймаут' },
    });

    const { refreshAllSources } = await import('./source-refresh.js');
    const r = await refreshAllSources(log, 'cycle', { books: ['УО'], svod: false });

    expect(r.failed).toEqual(['УО']);
    expect(forgetRevision).toHaveBeenCalledWith(bookIds['УО']);
  });
});
