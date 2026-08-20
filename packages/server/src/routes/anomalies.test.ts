/**
 * Обещания /api/anomalies, охраняемые здесь (а не оформление ответа):
 *
 *   1. АДРЕС СТРОКИ СЧИТАЕТСЯ ВЕРНО. Кэш листов несёт шапку, поэтому номер
 *      строки книги = индекс + 1. Ошибка в единице означает чужую строку на
 *      экране читателя — это самая дорогая ошибка раздела.
 *   2. ИТОГИ И РАЗМЕТКА НЕ СТАНОВЯТСЯ НАХОДКАМИ. Строка «Итого» с суммой в
 *      порядок больше соседей иначе была бы выбросом в каждой книге.
 *   3. ПУСТАЯ ЯЧЕЙКА — НЕ НОЛЬ. Строка без факта приходит с factTotal = null:
 *      ноль был бы утверждением о сумме, которого источник не делал.
 *   4. АНОМАЛИИ ДАТАСЕТА ДОЕЗЖАЮТ ДО № П/П И ПРЕДМЕТА, а признак уровня книги
 *      честно приходит без одной строки (sheetRow = null), а не с выдуманной.
 *   5. ВНУТРЕННИЕ КОДЫ НАРУЖУ НЕ ВЫХОДЯТ: степень аномалии подписана словами.
 */
import { describe, expect, it } from 'vitest';
import { findDept, type DepartmentEntry } from '@aemr/shared';
import { addressOf, buildAnomalyRows, datasetFindingsOf } from './anomalies.js';

const DEPT = findDept('УЭР') as DepartmentEntry;

/** Строка книги ГРБС до колонки AC — позиции по канону DEPT_COLUMNS. */
function row(overrides: Record<number, unknown>): unknown[] {
  const cells = new Array<unknown>(30).fill('');
  for (const [idx, value] of Object.entries(overrides)) cells[Number(idx)] = value;
  return cells;
}

/** Шапка книги — три строки, которые в разбор попадать не должны. */
const HEADER: unknown[][] = [row({}), row({}), row({})];

const LIVE = row({
  0: '12',                       // A — № п/п
  2: 'МБДОУ «Ромашка»',          // C — учреждение
  6: 'Поставка канцтоваров',     // G — предмет
  10: 240.5,                     // K — план итого
  11: 'ЕП',                      // L — способ
  13: '15.08.2026',              // N — плановая дата
  24: '',                        // Y — факт итого (пусто)
  28: '',                        // AC — экономия
});

const TOTALS = row({
  2: 'Итого',
  10: 999999,
  11: 'ЕП',
});

describe('buildAnomalyRows — адрес и отбор строк', () => {
  it('номер строки книги равен индексу массива плюс один', () => {
    const { rows } = buildAnomalyRows(DEPT, [...HEADER, LIVE]);
    expect(rows).toHaveLength(1);
    // Индекс 3 (четвёртый элемент) → строка 4 книги: ровно так её видит человек.
    expect(rows[0].sheetRow).toBe(4);
    expect(rows[0].rowSeq).toBe('12');
  });

  it('строки шапки в разбор не попадают', () => {
    const { rows } = buildAnomalyRows(DEPT, [
      row({ 0: '1', 6: 'шапка', 10: 100, 11: 'ЕП' }),
      row({}),
      row({}),
      LIVE,
    ]);
    expect(rows.map((r) => r.sheetRow)).toEqual([4]);
  });

  it('итоговая строка находкой не становится', () => {
    const { rows } = buildAnomalyRows(DEPT, [...HEADER, LIVE, TOTALS]);
    expect(rows.map((r) => r.subject)).toEqual(['Поставка канцтоваров']);
  });

  it('пустая денежная ячейка приходит как null, а не как ноль', () => {
    const { rows } = buildAnomalyRows(DEPT, [...HEADER, LIVE]);
    expect(rows[0].planTotal).toBe(240.5);
    expect(rows[0].factTotal).toBeNull();
    expect(rows[0].economy).toBeNull();
  });

  it('живой формат оператора «1 234,56» читается числом', () => {
    const { rows } = buildAnomalyRows(DEPT, [
      ...HEADER,
      row({ 0: '3', 6: 'ремонт', 10: '1 234,56', 11: 'ЭА' }),
    ]);
    expect(rows[0].planTotal).toBeCloseTo(1234.56, 2);
  });

  it('пустая колонка учреждения читается как аппарат управления', () => {
    const { rows } = buildAnomalyRows(DEPT, [
      ...HEADER,
      row({ 0: '4', 6: 'услуги связи', 10: 50, 11: 'ЕП' }),
    ]);
    expect(rows[0].subordinate).toBe('Аппарат управления');
  });
});

describe('addressOf — адрес словами', () => {
  it('несёт и строку листа, и № п/п', () => {
    expect(addressOf(155, '39')).toBe('строка 155 (№ 39)');
  });
  it('без номера называет только строку — выдумывать номер нельзя', () => {
    expect(addressOf(155, '')).toBe('строка 155');
  });
});

describe('datasetFindingsOf — аномалии снимка до адреса', () => {
  const byRow = new Map<number, unknown[]>([[4, LIVE]]);

  it('построчная аномалия получает № п/п, предмет и учреждение', () => {
    const { findings } = datasetFindingsOf(
      {
        anomalies: {
          dataAnomalies: [{ type: 'FACT_NO_PLAN', rowIndex: 3, details: 'Есть факт, плана нет', severity: 'ВЫСОКАЯ' }],
          behavioralAnomalies: [],
          systemicAnomalies: [],
          totalCount: 1,
          worstSeverity: 'ВЫСОКАЯ',
        },
      } as never,
      DEPT,
      byRow,
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].sheetRow).toBe(4);
    expect(findings[0].rowSeq).toBe('12');
    expect(findings[0].subject).toBe('Поставка канцтоваров');
    expect(findings[0].subordinate).toBe('МБДОУ «Ромашка»');
    // Внутренняя степень «ВЫСОКАЯ» наружу не выходит — только слово порядка.
    expect(findings[0].urgency).toBe('требует внимания');
    expect(findings[0].title).not.toMatch(/[A-Z_]{4,}/u);
  });

  it('признак уровня книги приходит без одной строки, а не с выдуманной', () => {
    const { findings } = datasetFindingsOf(
      {
        anomalies: {
          dataAnomalies: [],
          behavioralAnomalies: [],
          systemicAnomalies: [{
            type: 'HIGH_EXACT_MATCH_RATE',
            details: 'Слишком часто факт равен плану',
            severity: 'СРЕДНЯЯ',
            affectedRows: [3],
          }],
          totalCount: 1,
          worstSeverity: 'СРЕДНЯЯ',
        },
      } as never,
      DEPT,
      byRow,
    );
    expect(findings[0].sheetRow).toBeNull();
    expect(findings[0].level).toBe('book');
    // Задетые строки всё равно названы поимённо — иначе признак безадресен.
    expect(findings[0].members).toEqual(['строка 4 (№ 12)']);
  });

  it('снимок без разбора не роняет раздел', () => {
    expect(datasetFindingsOf(null, DEPT, byRow).findings).toEqual([]);
    expect(datasetFindingsOf(undefined, DEPT, byRow).noise).toEqual([]);
  });

  it('свёртка по типам несёт адреса первых строк', () => {
    const { noise } = datasetFindingsOf(
      { noiseMap: [{ key: 'signal_overdue', label: 'Просроченные закупки', count: 1, rows: [3], severity: 'ВЫСОКАЯ', summary: '' }] } as never,
      DEPT,
      byRow,
    );
    expect(noise[0].members).toEqual(['строка 4 (№ 12)']);
    expect(noise[0].urgency).toBe('требует внимания');
  });
});
