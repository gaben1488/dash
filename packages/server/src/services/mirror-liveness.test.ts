/**
 * Страж живости зеркала: битый источник — это отказ, а не данные.
 *
 * Зеркало ГРБС в сводной книге — формула IMPORTRANGE; когда она падает, лист
 * отдаёт ОДНУ строку с «#REF!». Старое условие подстановки кэша ждало
 * length === 0, поэтому строка-ошибка принималась за данные: УКСиМП целиком
 * исчезал из снимка (661 закупка, 155 152 тыс. руб. плана — нулём), а
 * страница «Источники» показывала «Активна, 673 строки».
 */
import { describe, expect, it } from 'vitest';
import { hasNoMeaningfulRows } from './snapshot.js';

describe('hasNoMeaningfulRows — распознавание битого зеркала', () => {
  it('одна строка «#REF!» — источник сломан, не данные (случай УКСиМП)', () => {
    expect(hasNoMeaningfulRows([
      ['#REF! (The source sheet for this IMPORTRANGE either does not exist...)'],
    ])).toBe(true);
  });

  it('лист не выше шапки — сломан: collectRowsByDept выбросит его целиком', () => {
    expect(hasNoMeaningfulRows([['ш'], ['а'], ['п']])).toBe(true);
    expect(hasNoMeaningfulRows([])).toBe(true);
  });

  it('обычные данные под шапкой — источник жив', () => {
    expect(hasNoMeaningfulRows([
      ['шапка'], ['шапка'], ['шапка'],
      ['1', 'УО АЕМР', 'МБДОУ', 'X', '', 'Текущая деятельность', 'Поставка бумаги'],
    ])).toBe(false);
  });

  it('ошибки формул вперемешку с пустотой — всё ещё сломан', () => {
    expect(hasNoMeaningfulRows([
      ['#REF!'], [''], ['#N/A'], ['', '#DIV/0! (Function DIVIDE...)'],
    ])).toBe(true);
  });
});
