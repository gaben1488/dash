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
import { DEPARTMENT_REGISTRY, MASTER_SOURCE_PROFILE } from '@aemr/shared';

const valuesGet = vi.fn();
const valuesBatchGet = vi.fn();
const valuesUpdate = vi.fn();
const gridGet = vi.fn();

vi.mock('googleapis', () => ({
  google: {
    sheets: vi.fn(() => ({
      spreadsheets: {
        values: { get: valuesGet, batchGet: valuesBatchGet, update: valuesUpdate },
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
    Object.values(MASTER_SOURCE_PROFILE.fields).map(field => field.label),
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
  valuesUpdate.mockReset();
  gridGet.mockReset();
  const master = DEPARTMENT_REGISTRY.find(dept => dept.id === 'УО')!;
  gridGet.mockResolvedValue({ data: { sheets: [{ properties: {
    sheetId: master.source.sheetId, title: 'ВСЕ', gridProperties: { columnCount: 34 },
  } }] } });
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

describe('R05.01 — реестр профилей охраняет каждый принятый источник', () => {
  it('изменённый обязательный смысл останавливает чтение до формул и до другой вкладки', async () => {
    const rows = sheetValues();
    rows[2][21] = 'Цена договора вместо ФБ 2';
    valuesGet.mockResolvedValue({ data: { values: rows } });
    const { readDeptSheet } = await import('./google-sheets.js');
    await expect(readDeptSheet('УО', 'file-uo', { withFormulas: true }))
      .rejects.toThrow('MASTER_SOURCE_REQUIRED_MEANING_CHANGED:V');
    expect(valuesGet).toHaveBeenCalledTimes(1);
    expect(valuesBatchGet).not.toHaveBeenCalled();
    expect(gridGet).toHaveBeenCalledTimes(1);
  });

  it('короткая шапка не становится готовой книгой', async () => {
    valuesGet.mockResolvedValue({ data: { values: [['название'], [], ['частичная шапка'], ['строка']] } });
    const { readDeptSheet } = await import('./google-sheets.js');
    await expect(readDeptSheet('УО', 'file-uo')).rejects.toThrow('MASTER_SOURCE_REQUIRED_MEANING_CHANGED:A');
    expect(valuesGet).toHaveBeenCalledTimes(1);
  });

  it('изменение необязательной подписи допустимо только в её поле', async () => {
    const rows = sheetValues();
    rows[2][33] = 'Комментарий по новой редакции';
    valuesGet.mockResolvedValue({ data: { values: rows } });
    const { readDeptSheet } = await import('./google-sheets.js');
    await expect(readDeptSheet('УО', 'file-uo')).resolves.toMatchObject({
      sheetName: 'ВСЕ', formulasRead: false,
    });
  });

  it('одинаковая шапка другой вкладки не подменяет закреплённый sheetId', async () => {
    const master = DEPARTMENT_REGISTRY.find(dept => dept.id === 'УО')!;
    gridGet.mockResolvedValue({ data: { sheets: [
      { properties: { sheetId: 123, title: 'ВСЕ', gridProperties: { columnCount: 34 } } },
      { properties: { sheetId: master.source.sheetId, title: 'УО', gridProperties: { columnCount: 34 } } },
    ] } });
    const { readDeptSheet } = await import('./google-sheets.js');
    await expect(readDeptSheet('УО', 'file-uo')).rejects.toThrow('MASTER_SOURCE_SHEET_TITLE_UNREVIEWED');
    expect(valuesGet).not.toHaveBeenCalled();
  });

  it('отсутствующий закреплённый sheetId и сокращённая геометрия блокируют приём', async () => {
    const master = DEPARTMENT_REGISTRY.find(dept => dept.id === 'УО')!;
    const { readDeptSheet } = await import('./google-sheets.js');
    gridGet.mockResolvedValueOnce({ data: { sheets: [] } });
    await expect(readDeptSheet('УО', 'file-uo')).rejects.toThrow('MASTER_SOURCE_SHEET_ID_CHANGED');
    gridGet.mockResolvedValueOnce({ data: { sheets: [{ properties: {
      sheetId: master.source.sheetId, title: 'ВСЕ', gridProperties: { columnCount: 32 },
    } }] } });
    await expect(readDeptSheet('УО', 'file-uo')).rejects.toThrow('MASTER_SOURCE_PROFILE_GEOMETRY_MISMATCH');
  });

  it('разрешённое переименование вкладки УФБП→УФ сохраняет identity', async () => {
    const dept = DEPARTMENT_REGISTRY.find(item => item.id === 'УФБП')!;
    gridGet.mockResolvedValue({ data: { sheets: [{ properties: {
      sheetId: dept.source.sheetId, title: 'УФ', gridProperties: { columnCount: 34 },
    } }] } });
    const { readDeptSheet } = await import('./google-sheets.js');
    await expect(readDeptSheet('УФБП', 'file-ufbp')).resolves.toMatchObject({
      sheetName: 'УФ', formulasRead: false,
    });
    expect(valuesGet).toHaveBeenCalledTimes(1);
    expect(String(valuesGet.mock.calls[0][0].range)).toContain("'УФ'!");
  });

  it('похожее, но не утверждённое имя мастер-вкладки нельзя использовать', async () => {
    const dept = DEPARTMENT_REGISTRY.find(item => item.id === 'УО')!;
    gridGet.mockResolvedValue({ data: { sheets: [{ properties: {
      sheetId: dept.source.sheetId, title: 'Все', gridProperties: { columnCount: 34 },
    } }] } });
    const { readDeptSheet } = await import('./google-sheets.js');
    await expect(readDeptSheet('УО', 'file-uo')).rejects.toThrow('MASTER_SOURCE_SHEET_TITLE_UNREVIEWED');
    expect(valuesGet).not.toHaveBeenCalled();
  });
});

describe('R05.01 — registered historical aliases cannot bypass master identity', () => {
  it('a recognized former department label resolves to the same approved gid', async () => {
    const dept = DEPARTMENT_REGISTRY.find(entry => entry.id === 'УФБП')!;
    gridGet.mockResolvedValue({ data: { sheets: [{ properties: {
      sheetId: dept.source.sheetId, title: 'УФБП',
      gridProperties: { columnCount: 34 },
    } }] } });
    const { readDeptSheet, resolveDeptSheetName } = await import('./google-sheets.js');
    expect(await resolveDeptSheetName('УФБР', 'file-ufbp')).toBe('УФБП');
    await expect(readDeptSheet('УФБР', 'file-ufbp')).resolves.toMatchObject({
      sheetName: 'УФБП', formulasRead: false,
    });
    expect(valuesGet).toHaveBeenCalledTimes(1);
  });
});

describe('R05.01 — one resolver for reads, writes and metadata', () => {
  it('the same reviewed gid and title admit read/write, without a stale cache', async () => {
    const master = DEPARTMENT_REGISTRY.find(dept => dept.id === 'УО')!;
    const { resolveDeptSheetName, readDeptSheet } = await import('./google-sheets.js');
    expect(await resolveDeptSheetName('УО', 'file-uo')).toBe('ВСЕ');
    expect((await readDeptSheet('УО', 'file-uo')).sheetName).toBe('ВСЕ');
    gridGet.mockResolvedValue({ data: { sheets: [{ properties: {
      sheetId: master.source.sheetId + 1, title: 'ВСЕ',
      gridProperties: { columnCount: 34 },
    } }] } });
    await expect(resolveDeptSheetName('УО', 'file-uo'))
      .rejects.toThrow('MASTER_SOURCE_SHEET_ID_CHANGED');
  });

  it('a missing metadata response never authorizes a write to the default name', async () => {
    gridGet.mockRejectedValueOnce(Object.assign(new Error('Metadata access denied'), { status: 403 }));
    const { resolveDeptSheetName } = await import('./google-sheets.js');
    await expect(resolveDeptSheetName('УО', 'file-uo')).rejects.toThrow('Metadata access denied');
  });
});

describe('R05.01 — source profile is the single implementation across consumers', () => {
  it('one object reference supplies read ranges and metadata protected groups', async () => {
    const { FORMULA_COLUMNS, FORMULA_COLUMN_GROUPS } = await import('./google-sheets.js');
    const { METADATA_CANON } = await import('./metadata-canon.js');
    expect(FORMULA_COLUMN_GROUPS).toEqual(MASTER_SOURCE_PROFILE.formulaColumnGroups);
    expect(METADATA_CANON.protectedColumnGroups).toBe(FORMULA_COLUMN_GROUPS);
    expect(FORMULA_COLUMNS).toEqual(
      Object.values(MASTER_SOURCE_PROFILE.fields)
        .filter(field => 'formula' in field).map(field => field.column),
    );
    expect(FORMULA_COLUMN_GROUPS).toEqual([
      { from: 'K', to: 'K' }, { from: 'O', to: 'P' },
      { from: 'R', to: 'T' }, { from: 'Y', to: 'AC' },
    ]);
  });
});

describe('R05.01 — source-profile contract is the single reviewed graph', () => {
  it('all eight masters have unique source identities and the same role/profile', () => {
    expect(DEPARTMENT_REGISTRY).toHaveLength(8);
    expect(new Set(DEPARTMENT_REGISTRY.map(dept => dept.source.providerId)).size).toBe(8);
    expect(new Set(DEPARTMENT_REGISTRY.map(dept => dept.source.sourceId)).size).toBe(8);
    for (const dept of DEPARTMENT_REGISTRY) {
      expect(dept.source.sheetId).toBeGreaterThan(0);
      expect(dept.source.role).toBe('master');
      expect(dept.source.profile).toBe(MASTER_SOURCE_PROFILE.id);
      expect(dept.source.access).toBe('read');
    }
    const columns = Object.values(MASTER_SOURCE_PROFILE.fields).map(field => field.index).sort((a, b) => a - b);
    expect(columns).toEqual(Array.from({ length: 34 }, (_, i) => i));
  });

  it('golden formula dependency graph matches field-level source metadata', () => {
    const require_ = createRequire(import.meta.url);
    const canon = require_('../../../../scripts/etalon-sync/canon.cjs') as {
      GOOGLE_FORMULAS_CANON: Array<[string, string]>;
    };
    const entries = Object.entries(MASTER_SOURCE_PROFILE.fields);
    const byColumn = new Map(entries.map(([key, field]) => [field.column, key]));
    expect(canon.GOOGLE_FORMULAS_CANON).toHaveLength(11);
    for (const [column, formula] of canon.GOOGLE_FORMULAS_CANON) {
      const entry = entries.find(([, field]) => field.column === column);
      expect(entry).toBeDefined();
      const [, rawField] = entry!;
      const field = rawField as unknown as { dependsOn?: string[]; externalReferences?: string[] };
      const expectedNames = [...new Set(
        [...formula.matchAll(/\b([A-Z]{1,2})4:[A-Z]{1,2}\b/g)]
          .map(match => byColumn.get(match[1]))
          .filter((name): name is string => name !== undefined),
      )].sort();
      expect([...(field.dependsOn ?? [])].sort()).toEqual(expectedNames);
      expect(field.externalReferences ?? []).toEqual(
        formula.includes('Settings!$B$6') ? ['Settings!B6'] : [],
      );
    }
  }, 30_000);
});

describe('R05.01 — guarded source mutation uses the same profile as every read', () => {
  it('never writes into a changed required column even when the gid and column count still match', async () => {
    const header = [...sheetValues()[2]];
    header[21] = 'Цена договора вместо ФБ 2';
    valuesGet.mockResolvedValue({ data: { values: [header] } });
    const { writeCellValue } = await import('./google-sheets.js');
    await expect(writeCellValue('file-uo', 'ВСЕ', 'V4', 42))
      .rejects.toThrow('MASTER_SOURCE_REQUIRED_MEANING_CHANGED:V');
    expect(valuesUpdate).not.toHaveBeenCalled();
    const request = valuesGet.mock.calls[0][0] as { range: string };
    expect(request.range).toContain('A3:AH3');
  });

  it('writes to the accepted gid after a bounded header read, without reloading the master grid', async () => {
    valuesGet.mockResolvedValue({ data: { values: [sheetValues()[2]] } });
    valuesUpdate.mockResolvedValue({ data: { updatedCells: 1, updatedRange: "'ВСЕ'!V4" } });
    const { writeCellValue } = await import('./google-sheets.js');
    await expect(writeCellValue('file-uo', 'ВСЕ', 'V4', 42))
      .resolves.toMatchObject({ updatedCells: 1 });
    expect(valuesGet).toHaveBeenCalledTimes(1);
    expect(valuesUpdate).toHaveBeenCalledTimes(1);
    expect((valuesGet.mock.calls[0][0] as { range: string }).range).toContain('A3:AH3');
  });

  it('cannot update another tab with a lookalike header or an unreviewed gid', async () => {
    const master = DEPARTMENT_REGISTRY.find(dept => dept.id === 'УО')!;
    gridGet.mockResolvedValue({ data: { sheets: [
      { properties: { sheetId: master.source.sheetId, title: 'ВСЕ', gridProperties: { columnCount: 34 } },
      },
    ] } });
    const { writeCellValue } = await import('./google-sheets.js');
    await expect(writeCellValue('file-uo', 'УО', 'V4', 42))
      .rejects.toThrow('MASTER_SOURCE_SHEET_TITLE_UNREVIEWED');
    expect(valuesGet).not.toHaveBeenCalled();
    expect(valuesUpdate).not.toHaveBeenCalled();
  });
});
