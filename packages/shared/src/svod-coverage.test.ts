/**
 * Страж полноты чтения листа СВОД.
 *
 * Класс дефекта, пойманный 29.07.2026: лист содержал три яруса чисел
 * (остаток к заключению, «ИТОГО» по скоупам, доли и расчётную экономию),
 * которые парсер не читал и НИЧЕГО об этом не говорил. Тот же класс раньше
 * дал «два периметра» и «25 строк из тысячи»: система молчит вместо
 * «здесь есть данные, которые я не понимаю».
 *
 * Правило: каждая строка листа с двумя и более числами обязана быть либо
 * прочитанной, либо явно перечисленной как игнорируемая. Добавят строку в
 * лист — тест покраснеет, и это будет решение человека, а не тишина.
 */
import { describe, expect, it } from 'vitest';
import { parseSvodGrid, parseSvodExtras, SVOD_GRID_COLS } from './svod-grid.js';

/** Строка листа шириной 24 (A..X — реальная ширина живого листа). */
function row(cells: Record<number, unknown>): unknown[] {
  const r: unknown[] = new Array(24).fill('');
  for (const [i, v] of Object.entries(cells)) r[Number(i)] = v;
  return r;
}

/**
 * Лист-фикстура по геометрии живого: шапка с остатком, блок КП, итоги
 * блока, «ИТОГО» скоупа заглавными, доли с расчётной экономией.
 */
function sheet(): unknown[][] {
  return [
    row({ 11: 'ФБ', 12: 'КБ', 13: 'МБ', 14: 'ИТОГО' }),                       // 1 шапка
    row({ 10: 'Остаток к заключ.', 11: 86965.19, 12: 117518.12, 13: 90963.95, 14: 295447.27 }), // 2
    row({ 0: 'ГРБС', 1: 'Квартал', 2: 'Год', 3: 'ЭА, ЭЗК, ЭК и аналоги' }),   // 3
    row({ 3: 'Количество', 7: 'Сумма, тыс. руб.', 17: 'Экономия' }),          // 4
    row({ 3: 'ПЛАН', 4: 'ФАКТ', 5: 'Отклонение', 6: 'Выполнено, %' }),        // 5
    row({ 7: 'ФБ', 8: 'КБ', 9: 'МБ', 10: 'ИТОГО' }),                          // 6
    row({ 0: 'ВСЕ', 1: 1, 2: 2026, 3: 140, 4: 140, 5: 0, 6: 1, 10: 284910.99 }), // 7 период
    row({ 1: 2, 2: 2026, 3: 126, 4: 123, 5: -3, 6: 0.976, 10: 172463.57 }),   // 8 период
    row({ 0: 'Итого ЭА 2026', 3: 364, 4: 305, 5: -59, 10: 822375.63 }),       // 9 итог блока
    row({ 0: 'ИТОГО 2026:', 3: 2823, 4: 2434, 5: -389, 10: 1327695.89 }),     // 10 итог скоупа
    row({ 3: 'Доля ЭА:', 6: 0.537, 7: 0.619, 12: 'Расч. экономия' }),         // 11 доли
    row({ 3: 'Доля ЕП:', 6: 0.463, 7: 0.381, 12: 23635.78, 13: 6957.22, 14: 9401.45, 15: 7277.12 }), // 12
    row({ 23: '↓↓↓ ПЕРЕКЛЮЧАТЕЛЬ ↓↓↓' }),                                     // 13 служебное
    row({ 23: '*' }),                                                          // 14 переключатель
  ];
}

/** Строки, которые читать не нужно, — с причиной. Растёт только осознанно. */
const IGNORED_ROWS: Record<number, string> = {
  1: 'шапка бюджетных колонок',
  3: 'заголовок секции (ГРБС/Квартал/Год/метод)',
  4: 'подзаголовок групп колонок',
  5: 'подзаголовок единиц',
  6: 'подзаголовок бюджетов',
  13: 'подпись переключателя периметра',
  14: 'значение переключателя (X37 = «*»)',
};

/** Сколько в строке ячеек, похожих на данные (число или непустой текст). */
function numericCells(r: unknown[]): number {
  return r.filter((v) => typeof v === 'number').length;
}

describe('полнота чтения листа СВОД', () => {
  const values = sheet();
  const grid = parseSvodGrid(values);
  const extras = parseSvodExtras(values);

  /** Все строки, которые продукт реально прочитал. */
  const readRows = new Set<number>();
  for (const b of grid) {
    for (const p of b.periods) readRows.add(p.row);
    if (b.totalBothYears) readRows.add(b.totalBothYears.row);
    if (b.totalY2026) readRows.add(b.totalY2026.row);
  }
  for (const s of extras.scopes) {
    for (const v of [s.totalBothYears, s.totalY2026, s.shareCompetitive, s.shareEp, s.calcEconomy]) {
      if (v) readRows.add(v.row);
    }
  }
  if (extras.remainderToConclude) readRows.add(extras.remainderToConclude.row);

  it('каждая строка с числами прочитана либо явно объявлена игнорируемой', () => {
    const unread: string[] = [];
    for (let i = 0; i < values.length; i++) {
      const rowNo = i + 1;
      if (numericCells(values[i] ?? []) < 2) continue;
      if (readRows.has(rowNo) || IGNORED_ROWS[rowNo]) continue;
      unread.push(`строка ${rowNo}: ${JSON.stringify(values[i]).slice(0, 120)}`);
    }
    // Список пуст — значит немых данных на листе нет.
    expect(unread).toEqual([]);
  });

  it('итог блока и итог скоупа — разные строки, обе прочитаны', () => {
    // Блочный «Итого ЭА 2026» (стр.9) читает parseSvodGrid, скоуповый
    // «ИТОГО 2026:» ЗАГЛАВНЫМИ (стр.10) — parseSvodExtras. Раньше вторая
    // терялась из-за регистра, и это стоило 18 строк по всем управлениям.
    expect(grid[0]?.totalY2026?.planCount).toBe(364);
    expect(extras.scopes[0]?.totalY2026?.planCount).toBe(2823);
  });

  it('колонки правее U не молчат: что там есть — либо читается, либо известно', () => {
    // Живой лист шире, чем A..U, которыми пользуется сетка. Всё, что стоит
    // правее, обязано быть либо разобрано (расч. экономия в M..P), либо
    // опознано как служебное (переключатель периметра в X).
    const known = new Set([SVOD_GRID_COLS.economyTotal, 12, 13, 14, 15, 23]);
    const strays: string[] = [];
    for (let i = 0; i < values.length; i++) {
      const r = values[i] ?? [];
      for (let c = 21; c < r.length; c++) {
        if (String(r[c] ?? '').trim() && !known.has(c)) {
          strays.push(`строка ${i + 1}, колонка ${c}`);
        }
      }
    }
    expect(strays).toEqual([]);
  });

  it('остаток к заключению прочитан из шапки — он и есть запрос ГРБС', () => {
    expect(extras.remainderToConclude?.total).toBe(295447.27);
  });
});
