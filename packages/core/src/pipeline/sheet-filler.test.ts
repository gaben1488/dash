/**
 * Страж простыни листа — прод-баг 21.08.2026, показанный владельцем.
 *
 * Реестр проверок кричал «Строки листа УФБП не попали в расчёт: 932 из 978 —
 * колонки сдвинуты, показатели управления считать нельзя» на пяти управлениях
 * сразу. Колонки были в порядке: в книгах формулы протянуты до конца сетки и
 * печатают на пустых строках нули (K = 0 от сложения пустых ячеек, Y, Z, AA,
 * AB, AC = 0, а O, P, R, S, T возвращают пустую строку). Прежняя проверка
 * пустоты требовала пустой КАЖДОЙ ячейки — ноль от формулы её проваливал.
 *
 * Живой образец строки взят из дампа книги УФБП (лист «УФБП», строки 50–61
 * и далее до 982): именно он воспроизведён в первом тесте.
 */
import { describe, it, expect } from 'vitest';
import { isSheetFiller } from './calc-engine.js';
import { DEPT_COLUMNS as COL } from '@aemr/shared';

/** Пустая строка листа на 34 колонки. */
function blank(): unknown[] {
  return Array.from({ length: 34 }, () => '');
}

describe('isSheetFiller — простыня листа против настоящих данных', () => {
  it('строка с нулями от протянутых формул — простыня (живой образец УФБП!50)', () => {
    const row = blank();
    row[COL.TOTAL_PLAN] = '0';
    row[COL.TOTAL_FACT] = '0';
    row[COL.ECONOMY_FB] = '0';
    row[COL.ECONOMY_KB] = '0';
    row[COL.ECONOMY_MB] = '0';
    row[COL.ECONOMY_TOTAL] = '0';
    expect(isSheetFiller(row)).toBe(true);
  });

  it('совсем пустая строка — простыня', () => {
    expect(isSheetFiller(blank())).toBe(true);
  });

  it('строка с предметом — НЕ простыня, даже если денег нет', () => {
    const row = blank();
    row[COL.SUBJECT] = 'Приобретение калькуляторов';
    expect(isSheetFiller(row)).toBe(false);
  });

  it('строка с одним лишь номером — НЕ простыня: у неё есть адрес', () => {
    const row = blank();
    row[COL.ID] = '24';
    expect(isSheetFiller(row)).toBe(false);
  });

  it('строка со способом закупки — НЕ простыня', () => {
    const row = blank();
    row[COL.METHOD] = 'ЕП';
    expect(isSheetFiller(row)).toBe(false);
  });

  it('ненулевые деньги делают строку содержательной даже без текста', () => {
    const row = blank();
    row[COL.TOTAL_PLAN] = '4,50';
    expect(isSheetFiller(row)).toBe(false);
  });

  it('маркер «Х» в графе даты — содержание: оператор им отвечал на вопрос', () => {
    const row = blank();
    row[COL.PLAN_DATE] = 'Х';
    expect(isSheetFiller(row)).toBe(false);
  });

  it('комментарий в дальней колонке — содержание, а не простыня', () => {
    const row = blank();
    row[COL.COMMENT_UFBP] = 'перенесено на четвёртый квартал';
    expect(isSheetFiller(row)).toBe(false);
  });
});
