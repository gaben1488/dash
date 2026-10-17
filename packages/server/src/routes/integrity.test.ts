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
import { checkSequenceIntegrity } from '@aemr/shared';
import { diffSnapshots } from '@aemr/core';
import { atomsToSnapshotRows, buildDateFormatFindings, buildSequenceRows, currentSheetToSnapshotRows, pickLatestControlSnapshot, indexHistoricalDepartments, interpretWeeklySnapshotJson } from './integrity.js';

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

  it('берёт последний контроль, не предыдущий четверг и не суточный снимок', () => {
    const latest = pickLatestControlSnapshot([
      snap('daily', '2026-10-10T09:00:00Z'),
      snap('control', '2026-10-08T06:00:00Z'),
      snap('older-control', '2026-10-01T06:00:00Z'),
    ], Date.parse('2026-10-11T10:00:00Z'), 12);
    expect(latest?.id).toBe('control');
  });

  it('не требует двух последовательных контрольных снимков', () => {
    expect(pickLatestControlSnapshot([
      snap('old-control', '2026-09-24T06:00:00Z'),
    ], Date.parse('2026-10-11T09:00:00Z'), 12)?.id).toBe('old-control');
  });

  it('четверг Камчатки ещё в среду UTC и не пропускается', () => {
    expect(pickLatestControlSnapshot([
      snap('kamchatka-thursday', '2026-07-22T17:00:00Z'),
    ], Date.parse('2026-07-23T07:00:00Z'), 12)?.id).toBe('kamchatka-thursday');
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
