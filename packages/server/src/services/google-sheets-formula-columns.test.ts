/**
 * Стражи чтения ФОРМУЛЬНЫХ КОЛОНОК книг ГРБС (решение владельца §22 п.7).
 *
 * Охраняются четыре обещания:
 *   1. Читаются ОДИННАДЦАТЬ формульных колонок четырьмя диапазонами, а не весь
 *      лист: откат к дорогому чтению (`A:ZZ` в виде формул) падает тестом.
 *   2. Сетка формул выровнена по индексам колонок ЛИСТА — потребитель
 *      адресует формулу так же, как значение.
 *   3. Быстрое обновление (без флага) за формулы НЕ платит ни одним
 *      обращением, и его итог честно говорит «формулы не читались».
 *   4. Список формульных колонок совпадает с каноном оформления книг
 *      (scripts/etalon-sync/canon.cjs): защищают в книге и читают в продукте
 *      ОДНИ И ТЕ ЖЕ колонки.
 */
import { createRequire } from 'node:module';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const valuesGet = vi.fn();
const valuesBatchGet = vi.fn();
const gridGet = vi.fn();

vi.mock('googleapis', () => ({
  google: {
    sheets: vi.fn(() => ({
      spreadsheets: {
        values: { get: valuesGet, batchGet: valuesBatchGet, update: vi.fn() },
        get: gridGet,
      },
    })),
    auth: { GoogleAuth: vi.fn(function GoogleAuth() { return {}; }) },
  },
}));

vi.mock('../config.js', () => ({
  config: {
    google: { spreadsheetId: 'file-svod', serviceAccountEmail: 'a@b', privateKey: 'k' },
    cache: { ttlSeconds: 300, autoRefreshMinutes: 0 },
  },
  DEPARTMENT_SPREADSHEETS: { 'УО': 'file-uo' },
}));

/** Значения листа: три строки шапки и две строки данных, тридцать четыре колонки. */
function sheetValues(): unknown[][] {
  return [
    Array.from({ length: 34 }, (_, c) => `шапка ${c}`),
    Array.from({ length: 34 }, (_, c) => `шапка ${c}`),
    Array.from({ length: 34 }, (_, c) => `шапка ${c}`),
    Array.from({ length: 34 }, (_, c) => (c === 0 ? 1 : 'значение')),
    Array.from({ length: 34 }, (_, c) => (c === 0 ? 2 : 'значение')),
  ];
}

/** Ответ на чтение формульных диапазонов: по группе на диапазон. */
function formulaRanges(): Array<{ range: string; values: unknown[][] }> {
  return [
    { range: "'ВСЕ'!K:K", values: [[''], [''], [''], ['=H4+I4+J4'], ['=H5+I5+J5']] },
    { range: "'ВСЕ'!O:P", values: [['', ''], ['', ''], ['', ''], ['=О4', '=P4'], ['=О5', '=P5']] },
    { range: "'ВСЕ'!R:T", values: [['', '', ''], ['', '', ''], ['', '', ''], ['=R4', '=S4', '=T4'], ['=R5', '=S5', '=T5']] },
    {
      range: "'ВСЕ'!Y:AC",
      values: [
        ['', '', '', '', ''], ['', '', '', '', ''], ['', '', '', '', ''],
        ['=V4+W4+X4', '=Z4', '=AA4', '=AB4', '=Z4+AA4+AB4'],
        ['=V5+W5+X5', '=Z5', '=AA5', '=AB5', '=Z5+AA5+AB5'],
      ],
    },
  ];
}

beforeEach(async () => {
  valuesGet.mockReset();
  valuesBatchGet.mockReset();
  gridGet.mockReset();
  valuesGet.mockResolvedValue({ data: { values: sheetValues() } });
  valuesBatchGet.mockResolvedValue({ data: { valueRanges: formulaRanges() } });
  await import('./google-sheets.js');
});

afterEach(() => {
  vi.resetModules();
});

describe('точность времени журнала', () => {
  it('сохраняет скрытое время обеих схем журнала и отображаемый составной номер', async () => {
    const text = (formattedValue: string) => ({ formattedValue });
    const date = (numberValue: number, formattedValue: string) => ({
      effectiveValue: { numberValue }, formattedValue,
      effectiveFormat: { numberFormat: { type: 'DATE' } },
    });
    gridGet.mockResolvedValue({ data: { sheets: [{ data: [{ rowData: [
      { values: [text('ВСЕ'), text('A236'), text('изменение'), date(46045, '23/1'),
        text('было'), text('стало'), date(46315.707016493056, '20.10.2026'), text('сотрудник')] },
      { values: [text('N4'), text('было'), text('стало'), date(46315.707016493056, '20.10.2026'),
        text('сотрудник'), { effectiveValue: { numberValue: 100.25 }, formattedValue: '100,25' }] },
    ] }] }] } });
    const { getSheetDataFromSpreadsheet } = await import('./google-sheets.js');
    const rows = await getSheetDataFromSpreadsheet('book', "_Change'Log", true);
    expect(rows[0][3]).toBe('23/1');
    expect(rows[0][6]).toBe(46315.707016493056);
    expect(rows[1][3]).toBe(46315.707016493056);
    expect(rows[1][5]).toBe(100.25);
    expect(gridGet).toHaveBeenCalledWith(expect.objectContaining({ ranges: ["'_Change''Log'!A:H"] }), expect.anything());
    expect(valuesGet).not.toHaveBeenCalled();
  });

  it('не подменяет непрочитанный журнал пустым', async () => {
    gridGet.mockResolvedValue({ data: {} });
    const { getSheetDataFromSpreadsheet } = await import('./google-sheets.js');
    await expect(getSheetDataFromSpreadsheet('book', '_ChangeLog', true)).rejects.toThrow('CHANGELOG_GRID_NOT_READ');
  });
});

describe('чтение формульных колонок', () => {
  it('спрашивает четыре диапазона (K, O:P, R:T, Y:AC), а не весь лист', async () => {
    const { readDeptSheet } = await import('./google-sheets.js');
    await readDeptSheet('УО', 'file-uo', { withFormulas: true });

    expect(valuesBatchGet).toHaveBeenCalledTimes(1);
    const params = valuesBatchGet.mock.calls[0][0] as { ranges: string[]; valueRenderOption: string };
    expect(params.valueRenderOption).toBe('FORMULA');
    expect(params.ranges).toHaveLength(4);
    // Ни один диапазон не имеет права быть чтением всего листа.
    for (const range of params.ranges) {
      expect(range).not.toContain('A:ZZ');
      expect(range).not.toContain('A:AH');
    }
    expect(params.ranges.map((r) => r.split('!')[1])).toEqual(['K:K', 'O:P', 'R:T', 'Y:AC']);
  }, 30_000);

  it('кладёт формулы по индексам колонок листа, а не по порядку диапазонов', async () => {
    const { readDeptSheet } = await import('./google-sheets.js');
    const result = await readDeptSheet('УО', 'file-uo', { withFormulas: true });

    // K = 10, Y = 24, AC = 28 — те же индексы, что у значений (DEPT_COLUMNS).
    expect(result.formulas[3][10]).toBe('=H4+I4+J4');
    expect(result.formulas[3][24]).toBe('=V4+W4+X4');
    expect(result.formulas[3][28]).toBe('=Z4+AA4+AB4');
    expect(result.formulas[4][10]).toBe('=H5+I5+J5');
    // Неформульная колонка остаётся пустой: «не читали», а не «формулы нет».
    expect(result.formulas[3][6]).toBeUndefined();
    expect(result.startRow).toBe(1);
    expect(result.formulasRead).toBe(true);
  });

  it('быстрое обновление формулы не читает вовсе', async () => {
    const { readDeptSheet } = await import('./google-sheets.js');
    const result = await readDeptSheet('УО', 'file-uo');

    expect(valuesBatchGet).not.toHaveBeenCalled();
    expect(result.formulas).toEqual([]);
    // Ключевое различие: «не читали» — не «дефектов нет».
    expect(result.formulasRead).toBe(false);
  });

  it('читает формульные колонки ровно там, где канон ставит защиту', async () => {
    const { FORMULA_COLUMN_GROUPS, FORMULA_COLUMNS, letterToColumn } = await import('./google-sheets.js');
    // Канон оформления живёт в scripts/ и в образ службы не попадает — но в
    // репозитории он на месте, и страж обязан сверяться с ним, а не с копией.
    const require_ = createRequire(import.meta.url);
    const canon = require_('../../../../scripts/etalon-sync/canon.cjs') as {
      goldenProtections: (
        sheetId: number,
        editors: string[],
      ) => Array<{ description: string; range: { startColumnIndex?: number; endColumnIndex?: number } }>;
    };

    const protectedGroups = canon
      .goldenProtections(0, ['a@b.c'])
      .filter((p) => p.description.startsWith('Формульн'))
      .map((p) => [p.range.startColumnIndex, p.range.endColumnIndex]);
    const readGroups = FORMULA_COLUMN_GROUPS.map((g) => [
      letterToColumn(g.from),
      letterToColumn(g.to) + 1,
    ]);

    expect(readGroups).toEqual(protectedGroups);
    expect(FORMULA_COLUMNS).toHaveLength(11);
    // Срок увеличен осознанно: `canon.cjs` тянет `lib.cjs`, а тот — настоящий
    // клиент googleapis (несколько секунд на загрузку). Платить эти секунды
    // дешевле, чем держать в сервере копию канона без сверки с оригиналом.
  }, 30_000);
});
