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
import { atomsToSnapshotRows, buildDateFormatFindings, buildSequenceRows } from './integrity.js';

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
