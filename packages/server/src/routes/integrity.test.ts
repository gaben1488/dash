/**
 * Обещания /api/integrity, охраняемые здесь:
 *
 *   1. «СЧЁТНАЯ СТРОКА» — ОДНО ОПРЕДЕЛЕНИЕ НА ПРОДУКТ: есть способ закупки и
 *      плановые деньги. Иначе разметочные строки попадают в знаменатель охвата
 *      и занижают его на ровном месте.
 *   2. ВИД ЯЧЕЙКИ ПРОВЕРЯЕТСЯ ТОЛЬКО ТАМ, ГДЕ КОД ДАТЫ ЛЕЖИТ ТЕКСТОМ. Книги
 *      читаются в необработанном виде: число в графе даты может быть нормальной
 *      датой с верным форматом, и объявить его дефектом — обвинить всю книгу.
 *   3. СРАВНЕНИЕ СНИМКОВ ИДЁТ ПО «№ П/П», а не по номеру строки листа: строки
 *      двигаются от вставок и сортировок, номер закупки живёт вместе с ней.
 *   4. АДРЕС ПРОПАЖИ СОХРАНЯЕТСЯ: где строка стояла, что в ней было и на какие
 *      деньги — иначе «исчезло 12 закупок» не даёт сделать ни одного шага.
 */
import { describe, expect, it } from 'vitest';
import { acceptedCurrentBook, compareCurrentToThursday } from '../services/procurement-absence.js';
import { checkSequenceIntegrity } from '@aemr/shared';
import { diffSnapshots } from '@aemr/core';
import { atomsToSnapshotRows, buildDateFormatFindings, buildSequenceRows, currentSheetToSnapshotRows, pickLatestControlSnapshot, pickAdjacentWeeklySnapshots, selectActiveSourceAbsences, indexHistoricalDepartments, interpretWeeklySnapshotJson } from './integrity.js';

function row(overrides: Record<number, unknown>): unknown[] {
  const cells = new Array<unknown>(30).fill('');
  for (const [idx, value] of Object.entries(overrides)) cells[Number(idx)] = value;
  return cells;
}

const HEADER: unknown[][] = [row({}), row({}), row({})];

describe('buildSequenceRows — что считается счётной строкой', () => {
  it('счётная = способ закупки плюс плановые деньги', () => {
    const rows = buildSequenceRows([
      ...HEADER,
      row({ 0: '1', 6: 'ремонт кровли', 10: 900, 11: 'ЭА' }),   // счётная
      row({ 0: '', 6: 'заготовка', 10: 0, 11: 'ЕП' }),          // денег нет
      row({ 0: '3', 6: 'без способа', 10: 500 }),               // способа нет
    ]);
    expect(rows.map((r) => r.countable)).toEqual([true, false, false]);
    expect(rows[0].sheetRow).toBe(4);
  });

  it('счётная строка без номера попадает в отчёт как лишённая адреса', () => {
    const report = checkSequenceIntegrity(buildSequenceRows([
      ...HEADER,
      row({ 0: '1', 6: 'первая', 10: 100, 11: 'ЕП' }),
      row({ 0: '', 6: 'безымянная', 10: 700, 11: 'ЭА' }),
    ]));
    expect(report.countable).toBe(2);
    expect(report.countableWithoutSeq).toBe(1);
    expect(report.unnumbered[0]).toMatchObject({ sheetRow: 5, subject: 'безымянная' });
  });

  it('пропуск номера сворачивается в отрезок и объясняется словами', () => {
    const report = checkSequenceIntegrity(buildSequenceRows([
      ...HEADER,
      row({ 0: '1', 6: 'а', 10: 10, 11: 'ЕП' }),
      row({ 0: '5', 6: 'б', 10: 10, 11: 'ЕП' }),
    ]));
    expect(report.gapCount).toBe(3);
    expect(report.gaps).toEqual([{ from: 2, to: 4, count: 3 }]);
    expect(report.note).toContain('удалённой строки');
  });
});

describe('buildDateFormatFindings — граница честности', () => {
  it('код даты, лежащий текстом, называется вместе с настоящей датой', () => {
    const found = buildDateFormatFindings([
      ...HEADER,
      row({ 0: '7', 6: 'опрессовка', 10: 300, 11: 'ЕП', 13: '46172' }),
    ]);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ sheetRow: 4, rowSeq: '7', column: 'N', shown: '46172' });
    expect(found[0].meansDate).toMatch(/^\d{2}\.\d{2}\.2026$/u);
    expect(found[0].columnLabel).toBe('плановая дата');
  });

  it('число в графе даты дефектом НЕ объявляется — вида ячейки мы не знаем', () => {
    const found = buildDateFormatFindings([
      ...HEADER,
      row({ 0: '8', 6: 'ремонт', 10: 300, 11: 'ЕП', 13: 46172 }),
    ]);
    expect(found).toEqual([]);
  });

  it('нормальная дата строкой признаком не считается', () => {
    const found = buildDateFormatFindings([
      ...HEADER,
      row({ 0: '9', 6: 'ремонт', 10: 300, 11: 'ЕП', 13: '15.06.2026' }),
    ]);
    expect(found).toEqual([]);
  });
});

describe('atomsToSnapshotRows + diffSnapshots — пропажа строки', () => {
  const atom = (dept: string, rowIndex: number, seq: string, subject: string, plan: number) => ({
    snapshotId: 's1',
    departmentId: dept,
    rowIndex,
    cellsJson: JSON.stringify({ A: seq, C: 'МБОУ СОШ № 1', G: subject }),
    subject,
    planAmount: plan,
    factAmount: null,
  });

  it('строка, переехавшая на другой номер листа, пропажей не считается', () => {
    const before = atomsToSnapshotRows([atom('uer', 534, '39', 'Опрессовка', 800)]);
    const after = atomsToSnapshotRows([atom('uer', 155, '39', 'Опрессовка', 800)]);
    const diff = diffSnapshots(before.get('uer') ?? [], after.get('uer') ?? []);
    expect(diff.vanished).toEqual([]);
    expect(diff.moved).toEqual([
      { rowSeq: '39', fromSheetRow: 534, toSheetRow: 155, subject: 'Опрессовка' },
    ]);
  });

  it('исчезнувшая строка сохраняет адрес, предмет, учреждение и деньги', () => {
    const before = atomsToSnapshotRows([atom('uer', 60, '12', 'Канцтовары', 240.5)]);
    const diff = diffSnapshots(before.get('uer') ?? [], []);
    expect(diff.vanished).toHaveLength(1);
    expect(diff.vanished[0]).toMatchObject({
      rowSeq: '12',
      wasAtSheetRow: 60,
      subject: 'Канцтовары',
      subordinate: 'МБОУ СОШ № 1',
      planSum: 240.5,
    });
    expect(diff.vanishedPlanSum).toBe(240.5);
    expect(diff.note).toContain('удаление строки не');
  });

  it('повреждённая запись строки не роняет сравнение книги', () => {
    const rows = atomsToSnapshotRows([
      { ...atom('uer', 60, '12', 'Канцтовары', 240.5), cellsJson: '{битый' },
      atom('uer', 61, '13', 'Мебель', 100),
    ]);
    expect(rows.get('uer')).toHaveLength(1);
    expect(rows.get('uer')?.[0].rowSeq).toBe('13');
  });
});



describe('единая классификация строк для исторического контроля и текущего чтения', () => {
  const history = (row: Record<string, unknown>, rowIndex: number, planAmount: number) => ({
    snapshotId: 'history', departmentId: 'uer', rowIndex,
    cellsJson: JSON.stringify(row), subject: String(row.G ?? ''),
    planAmount, factAmount: null,
  });

  it('служебный итог/заголовок не создаёт ложное исчезновение закупки', () => {
    const before = atomsToSnapshotRows([
      history({ A: '1', C: 'Школа', G: 'Ремонт', L: 'ЕП' }, 4, 100),
      history({ A: 'ИТОГО', G: 'Итого', L: 'Подзаголовок' }, 5, 500),
    ]).get('uer') ?? [];
    const live = [
      ...HEADER,
      row({ 0: '1', 2: 'Школа', 6: 'Ремонт', 10: 100, 11: 'ЕП' }),
    ];
    const after = currentSheetToSnapshotRows(live);
    expect(before.map((r) => r.rowSeq)).toEqual(['1']);
    expect(after.map((r) => r.rowSeq)).toEqual(['1']);
    expect(diffSnapshots(before, after).vanished).toEqual([]);
  });

  it('разметочная строка без предмета и без плана не становится закупкой', () => {
    const live = [...HEADER, row({ 0: '2' })];
    expect(currentSheetToSnapshotRows(live)).toEqual([]);
  });
});

describe('текущие книги против последнего контрольного четверга', () => {
  const snap = (id: string, createdAt: string) => ({ id, createdAt });

  it('в воскресенье сохраняет базу предыдущей календарной недели', () => {
    const latest = pickLatestControlSnapshot([
      snap('daily', '2026-10-10T09:00:00Z'),
      snap('control', '2026-10-08T06:00:00Z'),
      snap('older-control', '2026-10-01T06:00:00Z'),
    ], Date.parse('2026-10-11T10:00:00Z'), 12);
    expect(latest?.id).toBe('older-control');
  });

  it('не подменяет пропущенную базовую неделю более старой', () => {
    expect(pickLatestControlSnapshot([
      snap('old-control', '2026-09-24T06:00:00Z'),
    ], Date.parse('2026-10-11T09:00:00Z'), 12)).toBeNull();
  });

  it('четверговый срез принимается только после вечерней границы 18:00 Камчатки', () => {
    expect(pickLatestControlSnapshot([
      snap('early-Thursday', '2026-07-22T17:00:00Z'),
    ], Date.parse('2026-07-26T12:00:00Z'), 12)).toBeNull();
    expect(pickLatestControlSnapshot([
      snap('actual-control', '2026-07-23T06:00:00Z'),
      snap('early-Thursday', '2026-07-22T17:00:00Z'),
    ], Date.parse('2026-07-26T12:00:00Z'), 12)?.id).toBe('actual-control');
  });

  it.each([
    ['2026-10-22T05:59:59Z', 'previous'],
    ['2026-10-22T06:00:00Z', 'previous'],
    ['2026-10-23T00:00:00Z', 'previous'],
    ['2026-10-25T11:59:59Z', 'previous'],
    ['2026-10-25T12:00:00Z', 'current'],
  ])('сдвигает LIVE-базу только в понедельник Камчатки: %s', (now, expected) => {
    expect(pickLatestControlSnapshot([
      snap('previous', '2026-10-15T06:00:00Z'),
      snap('current', '2026-10-22T06:00:00Z'),
    ], Date.parse(now), 12)?.id).toBe(expected);
  });

  it('будущий, недатированный или недатированный контроль не подставляется', () => {
    expect(pickLatestControlSnapshot([
      snap('future', '2026-10-15T06:00:00Z'),
      snap('broken', 'нет даты'),
    ], Date.parse('2026-10-11T09:00:00Z'), 12)).toBeNull();
  });

  it('из текущего листа с заголовками получает те же координаты, что из атомов', () => {
    const values = [
      row({ 0: '№' }), row({}), row({}),
      row({ 0: '12', 2: 'МБОУ СОШ № 1', 6: 'Канцтовары', 10: 240.5, 11: 'ЕП' }),
      row({}), row({ 0: '15', 2: 'МБОУ СОШ № 1', 6: 'Ремонт', 10: 100 }),
    ];
    const result = currentSheetToSnapshotRows(values);
    expect(result.map((r) => ({ seq: r.rowSeq, row: r.sheetRow }))).toEqual([
      { seq: '12', row: 4 }, { seq: '15', row: 6 },
    ]);
    expect(result[0]).toMatchObject({ subject: 'Канцтовары', planSum: 240.5, method: 'ЕП' });
  });
});



describe('исторические снимки — совместимость без подмены происхождения', () => {
  it('книга читается по удостоверенному алиасу, но коллизии не объединяются', () => {
    expect(indexHistoricalDepartments({ 'УАГЗО': 1, 'УДТХ': 2 })?.get('uagzo')).toBe(1);
    expect(indexHistoricalDepartments({ 'УАГиЗО': 1, 'УДТХ': 2 })?.get('uagzo')).toBe(1);
    expect(indexHistoricalDepartments({ 'Управление архитектуры, градостроительства и земельных отношений': 1 })?.get('uagzo')).toBe(1);
    expect(indexHistoricalDepartments({ 'УАГЗО': 1, 'УАГиЗО': 2 })).toBeNull();
    expect(indexHistoricalDepartments({ 'Неизвестная организация': 1 })).toBeNull();
  });

  it('не путает отсутствующий снимок, прежний формат и нечитаемый JSON', () => {
    expect(interpretWeeklySnapshotJson(null).error).toContain('отсутствует');
    expect(interpretWeeklySnapshotJson('{}').error).toContain('не сохранён');
    expect(interpretWeeklySnapshotJson('null').error).toContain('не поддерживается');
    expect(interpretWeeklySnapshotJson('{"weeklyTableContext":{"contract":"dash-weekly-table-context-v2"}}').error).toContain('не поддерживается');
    expect(interpretWeeklySnapshotJson('{invalid').error).toContain('не разбирается');
    expect(interpretWeeklySnapshotJson('{"weeklyTableContext":{"contract":"dash-weekly-table-context-v1"}}').error).toBeNull();
  });
});


describe('бережная историческая сверка двух смежных четвергов', () => {
  const snap = (id: string, createdAt: string) => ({ id, createdAt });
  const now = Date.parse('2026-10-22T07:00:00Z');

  it('берёт два последних завершённых контрольных четверга, а не суточные/текущий', () => {
    const pair = pickAdjacentWeeklySnapshots([
      snap('daily', '2026-10-14T09:00:00Z'),
      snap('current-week', '2026-10-22T06:00:00Z'),
      snap('after', '2026-10-15T06:00:00Z'),
      snap('before', '2026-10-08T06:00:00Z'),
      snap('older', '2026-10-01T06:00:00Z'),
    ], now, 12);
    expect(pair?.map((item) => item.id)).toEqual(['before', 'after']);
  });

  it('не подменяет отсутствующую неделю более старым четвергом', () => {
    expect(pickAdjacentWeeklySnapshots([
      snap('after', '2026-10-15T06:00:00Z'),
      snap('older', '2026-10-01T06:00:00Z'),
    ], now, 12)).toBeNull();
  });

  it('не подменяет завершённый контроль ранними четверговыми чтениями', () => {
    const pair = pickAdjacentWeeklySnapshots([
      snap('after', '2026-10-14T17:00:00Z'),
      snap('before', '2026-10-07T17:00:00Z'),
    ], now, 12);
    expect(pair).toBeNull();
  });

  it('поздняя контрольная попытка замещает раннюю того же дня, но не соседний день', () => {
    const pair = pickAdjacentWeeklySnapshots([
      snap('after-early', '2026-10-15T01:00:00Z'),
      snap('before', '2026-10-08T06:00:00Z'),
      snap('after-late', '2026-10-15T09:00:00Z'),
      snap('future', '2026-10-29T06:00:00Z'),
    ], now, 12);
    expect(pair?.map((item) => item.id)).toEqual(['before', 'after-late']);
  });
});


describe('legacy numeric A: a calendar serial is not a proven procurement ID', () => {
  it('retains uncertainty from the original archived cell type', () => {
    const rows = atomsToSnapshotRows([{
      snapshotId: 'legacy',
      departmentId: 'ud',
      rowIndex: 173,
      cellsJson: JSON.stringify({ A: 46045, C: 'Аппарат', G: 'Ремонт', L: 'ЕП' }),
      subject: 'Ремонт', planAmount: 100, factAmount: null,
    }]);
    expect(rows.get('ud')).toEqual([expect.objectContaining({
      rowSeq: '46045', historicalAddressUnverified: true,
    })]);
  });

  it('marks a legacy numeric-date address UNKNOWN while still comparing other books', () => {
    const now = Date.parse('2026-10-22T09:01:00.000Z');
    const control = { id: 'legacy-week', createdAt: '2026-10-15T06:00:00.000Z' };
    const historical = new Map([
      ['uo', [{ rowSeq: '12', sheetRow: 4, subject: 'Кровля', planSum: 100, method: 'ЕП' }]],
      ['ud', [{ rowSeq: '46045', sheetRow: 173, subject: 'Ремонт', planSum: 200, method: 'ЕП',
        historicalAddressUnverified: true as const }]],
    ]);
    const header = [...HEADER];
    const current = { УО: [...header, row({ 0: '12', 6: 'Кровля', 10: 100, 11: 'ЕП' })],
      УД: [...header, row({ 0: '23/1', 6: 'Ремонт', 10: 200, 11: 'ЕП' })] };
    const metadata = {
      УО: { loadedAt: '2026-10-22T09:00:00.000Z', rowCount: 4 },
      УД: { loadedAt: '2026-10-22T09:00:00.000Z', rowCount: 4 },
    };
    const result = compareCurrentToThursday(control, historical, current, metadata, now, 3_600_000);
    expect(result.comparison?.vanishedTotal).toBe(0);
    expect(result.comparison?.unavailableBooks).toContainEqual(expect.objectContaining({
      dept: 'УД', reason: expect.stringContaining('числовой A'),
    }));
  });
});

describe('оперативные наблюдения № без недельной пары', () => {
  const now = Date.parse('2026-10-22T08:02:00Z');
  const source = { 'УО': [...HEADER, row({ 0: '12/01', 6: 'Другая закупка' })] };
  const meta = { 'УО': { loadedAt: '2026-10-22T08:00:00Z', rowCount: 4 } };
  const event = (seq: string, at = '2026-10-22T07:40:00Z') => ({
    book: 'УО', kind: 'row-vanished' as const, rowSeq: seq, sheetRow: 18,
    subject: 'Ремонт', observedAt: at,
  });

  it('сохраняет буквальную идентичность 12/1 и не удваивает повторные события', () => {
    const result = selectActiveSourceAbsences([
      event('12/1'), event('12/1', '2026-10-22T07:50:00Z'),
      event('12/01'), { ...event('13'), kind: 'row-identity-candidate' as const },
    ], source, meta, now, 3_600_000);
    expect(result.entries).toEqual([expect.objectContaining({
      dept: 'УО', rowSeq: '12/1', observedAt: '2026-10-22T07:50:00Z',
    })]);
    expect(result.unavailableBooks).toEqual([]);
  });

  it('снимает отсутствие после возвращения прежнего номера', () => {
    const result = selectActiveSourceAbsences([event('12/1')], {
      'УО': [...source['УО'], row({ 0: '12/1', 6: 'Ремонт' })],
    }, { 'УО': { ...meta['УО'], rowCount: 5 } }, now, 3_600_000);
    expect(result.entries).toEqual([]);
  });

  it('устаревшая, неполная или более ранняя книга — неизвестность, не ноль', () => {
    const cases = [
      { values: source, meta: { 'УО': { loadedAt: '2026-10-21T08:00:00Z', rowCount: 4 } } },
      { values: { 'УО': HEADER }, meta: { 'УО': { ...meta['УО'], rowCount: 3 } } },
      { values: source, meta: { 'УО': { loadedAt: '2026-10-22T07:30:00Z', rowCount: 4 } } },
    ];
    for (const sample of cases) {
      const result = selectActiveSourceAbsences([event('12/1')], sample.values, sample.meta, now, 3_600_000);
      expect(result.entries).toEqual([]);
      expect(result.unavailableBooks).toHaveLength(1);
    }
  });


  it('не выбирает произвольный первый alias одной книги', () => {
    const sameDept = { ...source, uo: source['УО'] };
    const result = selectActiveSourceAbsences([event('12/1')], sameDept, meta, now, 3_600_000);
    expect(result.entries).toEqual([]);
    expect(result.unavailableBooks).toEqual([
      expect.objectContaining({ dept: 'УО', reason: expect.stringContaining('однозначного') }),
    ]);
  });

  it('повреждённая физическая строка и неопределённое время не доказывают пропажу', () => {
    const invalidMatrix = { 'УО': [...HEADER, null as unknown as unknown[]] };
    const cases = [
      selectActiveSourceAbsences([event('12/1')], invalidMatrix, meta, now, 3_600_000),
      selectActiveSourceAbsences([event('12/1')], source, meta, Number.NaN, 3_600_000),
      selectActiveSourceAbsences([event('12/1')], source, meta, now, Number.NaN),
    ];
    for (const result of cases) {
      expect(result.entries).toEqual([]);
      expect(result.unavailableBooks).toEqual([expect.objectContaining({ dept: 'УО' })]);
    }
  });

  it('пустая история не выдумывает записи', () => {
    expect(selectActiveSourceAbsences([], source, meta, now, 3_600_000))
      .toEqual({ entries: [], unavailableBooks: [] });
  });
});

describe('один предметный путь: четверговый контроль против текущего чтения без webhook', () => {
  const beforeAt = '2026-10-15T06:00:00.000Z'; // 18:00 Asia/Kamchatka
  const readAt = '2026-10-22T09:00:00.000Z';
  const now = Date.parse('2026-10-22T09:01:00.000Z');
  const baseline = { id: 'sealed-control', createdAt: beforeAt };
  const oldRows = new Map([['uo', [
    { rowSeq: '12/1', sheetRow: 4, subject: 'Кровля', subordinate: 'Школа', planSum: 100, method: 'ЕП' },
    { rowSeq: '13', sheetRow: 5, subject: 'Канцтовары', subordinate: 'Школа', planSum: 50, method: 'ЕП' },
  ]]]);
  const present = [ ...HEADER, row({ 0: '12/1', 2: 'Школа', 6: 'Кровля', 10: 100, 11: 'ЕП' }) ];
  const meta = { УО: { loadedAt: readAt, rowCount: 4 } };
  const compare = (values: Record<string, unknown[][]>, metadata: Record<string, { loadedAt: string; rowCount?: number; error?: string }>) =>
    compareCurrentToThursday(baseline, oldRows, values, metadata, now, 3_600_000);

  it('после удаления физической строки видит отсутствующий прежний №, хотя webhook не вызван', () => {
    const { comparison, note } = compare({ УО: present }, meta);
    expect(comparison?.baselineId).toBe('sealed-control');
    expect(comparison?.beforeAt).toBe(beforeAt);
    expect(comparison?.afterAt).toBe(readAt);
    expect(comparison?.vanishedTotal).toBe(1);
    expect(comparison?.books.find(book => book.dept === 'УО')?.vanished).toEqual([
      expect.objectContaining({ rowSeq: '13', wasAtSheetRow: 5, subject: 'Канцтовары' }),
    ]);
    expect(note).toContain('частична');
    expect(comparison?.unavailableBooks.length).toBe(7);
  });

  it('переезд строки с прежним номером не создаёт ложного удаления', () => {
    const moved = [
      ...HEADER, row({}), row({ 0: '12/1', 2: 'Школа', 6: 'Кровля', 10: 100, 11: 'ЕП' }),
      row({ 0: '13', 2: 'Школа', 6: 'Канцтовары', 10: 50, 11: 'ЕП' }),
    ];
    const { comparison } = compare({ УО: moved }, { УО: { loadedAt: readAt, rowCount: 6 } });
    expect(comparison?.vanishedTotal).toBe(0);
    expect(comparison?.books.find(book => book.dept === 'УО')?.moved).toHaveLength(2);
  });

  it('две записи-алиаса, неполная матрица и устаревшее чтение дают UNKNOWN, а не ноль', () => {
    const cases: Array<[Record<string, unknown[][]>, Record<string, { loadedAt: string; rowCount?: number; error?: string }>]> = [
      [{ УО: present, uo: present }, meta],
      [{ УО: present }, { УО: { loadedAt: readAt, rowCount: 5 } }],
      [{ УО: present }, { УО: { loadedAt: '2026-10-20T09:00:00.000Z', rowCount: 4 } }],
      [{ УО: [...HEADER] }, { УО: { loadedAt: readAt, rowCount: 3 } }],
    ];
    for (const [values, metadata] of cases) {
      const { comparison, note } = compare(values, metadata);
      expect(comparison).toBeNull();
      expect(note).toContain('Нельзя утверждать');
    }
  });
});

describe('single source admission for every consumer', () => {
  it('admits only one complete matrix and rejects alias collisions and mismatched metadata', () => {
    const current = [ ...HEADER, row({ 0: '12/1', 2: 'Школа', 6: 'Ремонт', 10: 100, 11: 'ЕП' }) ];
    const meta = { 'УО': { loadedAt: '2026-10-22T09:00:00.000Z', rowCount: 4 } };

    expect(acceptedCurrentBook('УО', { 'УО': current }, meta).values).toHaveLength(4);
    expect(acceptedCurrentBook('УО', { 'УО': current, uo: current }, meta).reason)
      .toContain('однозначного');
    expect(acceptedCurrentBook('УО', { 'УО': current }, {
      'УО': { ...meta['УО'], rowCount: 5 },
    }).reason).toContain('полной матрицы');
    expect(acceptedCurrentBook('УО', { 'УО': current }, {
      'УО': { ...meta['УО'], loadedAt: 'invalid' },
    }).reason).toContain('Время');
    expect(acceptedCurrentBook('УО', { 'УО': current }, meta,
      Date.parse('2026-10-21T23:59:59Z')).reason).toContain('Время');
  });
});
