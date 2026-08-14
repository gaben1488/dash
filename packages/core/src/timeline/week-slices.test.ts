/**
 * week-slices.test.ts — опознание строки в архивных срезах недель.
 *
 * Ключ — содержимое (A + C + префикс G), потому что фикстуры не хранят номер
 * строки листа. Неоднозначность или отсутствие — честный пропуск недели.
 * Тесты ходят по НАСТОЯЩИМ фикстурам (те же, что у week-regression).
 */

import { describe, expect, it } from 'vitest';
import w0805 from '../report/__fixtures__/week-08.05.2026.json';
import { WEEK_SLICE_DATES, weekSliceObservations } from './week-slices.js';

/** Первая строка УЭР фикстуры 08.05: [A, C, D, F, G, ...] по карте columns. */
const fixtureRows = (w0805 as { rowsByDept: Record<string, unknown[][]> }).rowsByDept['УЭР'];
const columns = (w0805 as { columns: number[] }).columns;
const first = fixtureRows[0];
const at = (row: unknown[], colIdx: number): unknown => row[columns.indexOf(colIdx)];

describe('WEEK_SLICE_DATES', () => {
  it('три среза, ISO, по возрастанию', () => {
    expect(WEEK_SLICE_DATES).toEqual(['2026-05-08', '2026-05-29', '2026-06-26']);
  });
});

describe('weekSliceObservations', () => {
  it('живая строка фикстуры находится по ключу A+C+G (полный предмет против обрезанного)', () => {
    const got = weekSliceObservations({
      dept: 'УЭР',
      id: at(first, 0),
      subordinate: at(first, 2),
      // Живой предмет длиннее обрезанного фикстурного — совместимость по префиксу.
      subject: String(at(first, 6)) + ' бумаги формата А4 для нужд управления',
    });
    expect(got.length).toBeGreaterThanOrEqual(1);
    const slice = got.find((o) => o.at === '2026-05-08');
    expect(slice).toBeDefined();
    // Ячейки разложены по буквам канона: N (плановая дата) и K (план) на месте.
    expect(slice!.cells['N']).toBe(at(first, 13));
    expect(slice!.cells['K']).toBe(at(first, 10));
    // Колонок, которых фикстура не несёт, в наблюдении нет (а не «пусто»).
    expect('U' in slice!.cells).toBe(false);
    expect('AF' in slice!.cells).toBe(false);
  });

  it('несуществующая строка — пусто, без выдумки', () => {
    const got = weekSliceObservations({
      dept: 'УЭР',
      id: '999999',
      subordinate: 'Никогда не существовавший подвед',
      subject: 'Закупка, которой не было',
    });
    expect(got).toEqual([]);
  });

  it('чужая книга — пусто', () => {
    const got = weekSliceObservations({
      dept: 'Неизвестная книга',
      id: at(first, 0),
      subordinate: at(first, 2),
      subject: String(at(first, 6)),
    });
    expect(got).toEqual([]);
  });

  it('пустой ключ (без A и предмета) — пусто: матчить нечем', () => {
    expect(weekSliceObservations({ dept: 'УЭР', id: '', subordinate: '', subject: '' })).toEqual([]);
  });
});
