/**
 * Страж соответствия имён показателей листу «СВОД ТД-ПМ».
 *
 * Таблица ниже — не копия карты имён, а РАСШИФРОВКА живого листа: каждая
 * строка выписана из дампа книги СВОД_ДЛЯ_GOOGLE от 18.08.2026 с указанием
 * ячейки, откуда взята подпись. Если карта разойдётся с листом (кто-то
 * вернёт «Потрачено, %» или добавит поле без имени), тест упадёт здесь, а не
 * на экране у начальницы.
 */
import { describe, it, expect } from 'vitest';
import {
  SVOD_SHEET_EXTRAS,
  SVOD_SHEET_FIELDS,
  SVOD_SHEET_GROUPS,
  SVOD_SWITCH_BY_SCOPE,
  SVOD_SWITCH_VALUES,
  svodSheetColumn,
  svodSheetName,
} from './svod-sheet-names.js';
import type { SvodRow } from './svod-view.js';

/**
 * Живой лист, блок ЭА: шапка строк 4–6 (те же подписи повторяются в шапке
 * каждого блока — строки 16–18, 38–40 и далее у всех восьми ГРБС).
 */
const LIVE_HEADER: ReadonlyArray<{
  cell: string;
  column: string;
  name: string;
  group: string | null;
  field: keyof SvodRow;
}> = [
  { cell: 'D5', column: 'D', name: 'ПЛАН, единиц', group: 'Количество, ед.', field: 'planCount' },
  { cell: 'E5', column: 'E', name: 'ФАКТ, единиц', group: 'Количество, ед.', field: 'factCount' },
  { cell: 'F5', column: 'F', name: 'Отклонение, единиц', group: 'Количество, ед.', field: 'deviationCount' },
  { cell: 'G5', column: 'G', name: 'Заключено, %', group: 'Количество, ед.', field: 'executionPct' },
  { cell: 'H6', column: 'H', name: 'ФБ', group: 'Сумма, тыс. руб.', field: 'planFB' },
  { cell: 'I6', column: 'I', name: 'КБ', group: 'Сумма, тыс. руб.', field: 'planKB' },
  { cell: 'J6', column: 'J', name: 'МБ', group: 'Сумма, тыс. руб.', field: 'planMB' },
  { cell: 'K6', column: 'K', name: 'ИТОГО', group: 'Сумма, тыс. руб.', field: 'planTotal' },
  { cell: 'L6', column: 'L', name: 'ФБ', group: 'Сумма, тыс. руб.', field: 'factFB' },
  { cell: 'M6', column: 'M', name: 'КБ', group: 'Сумма, тыс. руб.', field: 'factKB' },
  { cell: 'N6', column: 'N', name: 'МБ', group: 'Сумма, тыс. руб.', field: 'factMB' },
  { cell: 'O6', column: 'O', name: 'ИТОГО', group: 'Сумма, тыс. руб.', field: 'factTotal' },
  { cell: 'P5', column: 'P', name: 'Отклонение, тыс. руб', group: 'Сумма, тыс. руб.', field: 'amountDeviation' },
  { cell: 'Q5', column: 'Q', name: 'Законтрактовано, %', group: 'Сумма, тыс. руб.', field: 'spentPct' },
  { cell: 'R6', column: 'R', name: 'ФБ', group: 'Экономия', field: 'economyFB' },
  { cell: 'S6', column: 'S', name: 'КБ', group: 'Экономия', field: 'economyKB' },
  { cell: 'T6', column: 'T', name: 'МБ', group: 'Экономия', field: 'economyMB' },
  { cell: 'U6', column: 'U', name: 'ИТОГО', group: 'Экономия', field: 'economyTotal' },
];

/** Имена, которые владелец 18.08.2026 снял с листа. Вернуться они не должны. */
const RETIRED_NAMES = [
  'Потрачено',
  'Выполнено',
  'Вып. %',
  'Расч. экономия',
  'Расчётная экономия',
];

describe('имена показателей «Свода» = имена листа СВОД ТД-ПМ', () => {
  it('каждый столбец листа D–U подписан ровно так, как на листе', () => {
    for (const row of LIVE_HEADER) {
      expect(svodSheetName(row.field), `${row.cell} → ${row.field}`).toBe(row.name);
      expect(svodSheetColumn(row.field), `${row.cell} → ${row.field}`).toBe(row.column);
      expect(SVOD_SHEET_FIELDS[row.field].group, `${row.cell} → группа`).toBe(row.group);
    }
  });

  it('покрытие полное: у каждого поля строки есть имя листа, лишних полей нет', () => {
    const mapped = Object.keys(SVOD_SHEET_FIELDS).sort();
    const live = LIVE_HEADER.map((r) => r.field).sort();
    expect(mapped).toEqual(live);
  });

  it('одна колонка листа — одно поле: адреса не дублируются', () => {
    const columns = Object.values(SVOD_SHEET_FIELDS).map((f) => f.column);
    expect(new Set(columns).size).toBe(columns.length);
  });

  it('переименованные показатели: старых имён в карте нет', () => {
    const allText = [
      ...Object.values(SVOD_SHEET_FIELDS).map((f) => f.sheetName),
      ...Object.values(SVOD_SHEET_GROUPS),
      ...Object.values(SVOD_SHEET_EXTRAS),
    ].join(' | ');
    for (const retired of RETIRED_NAMES) {
      expect(allText, `снятое имя «${retired}» вернулось в карту`).not.toContain(retired);
    }
  });

  it('«Заключено, %» — счётный показатель, «Законтрактовано, %» — денежный', () => {
    // Обе подписи оканчиваются на «, %», и перепутать их легко: страж
    // закрепляет, какая из них в какой группе столбцов живёт.
    expect(SVOD_SHEET_FIELDS.executionPct.group).toBe(SVOD_SHEET_GROUPS.count);
    expect(SVOD_SHEET_FIELDS.spentPct.group).toBe(SVOD_SHEET_GROUPS.money);
  });

  it('переключатель B1: три значения списка, срез продукта им соответствует', () => {
    expect([...SVOD_SWITCH_VALUES]).toEqual([
      'Текущая деятельность',
      'Программное мероприятие',
      '*',
    ]);
    expect(SVOD_SWITCH_BY_SCOPE.all).toBe('*');
    expect(SVOD_SWITCH_BY_SCOPE.td).toBe('Текущая деятельность');
    expect(SVOD_SWITCH_BY_SCOPE.pm).toBe('Программное мероприятие');
    // Каждое положение переключателя достижимо срезом продукта и наоборот.
    expect(new Set(Object.values(SVOD_SWITCH_BY_SCOPE))).toEqual(new Set(SVOD_SWITCH_VALUES));
  });

  it('новый блок шапки листа подписан как на листе (K1/K2)', () => {
    expect(SVOD_SHEET_EXTRAS.remainderGroup).toBe('План минус Факт разбивка');
    expect(SVOD_SHEET_EXTRAS.remainder).toBe('Остаток к заключ.');
    expect(SVOD_SHEET_EXTRAS.switchLegend).toBe('* = ТД + ПМ');
  });
});
