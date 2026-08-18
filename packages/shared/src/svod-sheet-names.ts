/**
 * svod-sheet-names.ts — ЕДИНСТВЕННЫЙ дом имён показателей листа «СВОД ТД-ПМ».
 *
 * Владелец 18.08.2026 ПЕРЕИМЕНОВАЛ показатели листа, не тронув расчёт («суть
 * стала понятнее»), а начальница добавила справа блок «План минус Факт
 * разбивка». Продукт показывал старые имена — читатель и лист говорили про
 * одно число разными словами. Отсюда правило: имя показателя на экране «Свода»
 * берётся ОТСЮДА, а не пишется в вёрстке.
 *
 * Что переименовано (сверено с живым дампом книги 18.08.2026):
 *   G  «Выполнено, %»      → «Заключено, %»          (формула та же: E/D)
 *   Q  «Потрачено, %»      → «Законтрактовано, %»     (формула та же: O/K)
 * Что добавлено:
 *   K1:O2 «План минус Факт разбивка» / «Остаток к заключ.» ФБ/КБ/МБ/ИТОГО
 * Что удалено с листа:
 *   «Расч. экономия» (≈8 %) и «расчётная экономия без УИО» — ни одной ячейки.
 *
 * Геометрия листа на 18.08.2026: 277 строк × 21 колонка (A..U), переключатель
 * периметра — ячейка B1 со списком «Текущая деятельность / Программное
 * мероприятие / *», расшифровка «* = ТД + ПМ» в A2.
 */

import type { ActivityScope } from './activity-scope.js';
import type { SvodRow } from './svod-view.js';

/** Подпись поля строки листа: колонка A1, имя в шапке и имя группы столбцов. */
export interface SvodSheetFieldName {
  /** Колонка листа в нотации A1 («G», «Q», …). */
  column: string;
  /** Имя показателя РОВНО как в шапке блока (строки 5/17/39/… листа). */
  sheetName: string;
  /** Имя группы столбцов (строка 4/16/38/…); null у служебных A–C. */
  group: string | null;
}

/** Группы столбцов листа (строка 4 каждого блока). */
export const SVOD_SHEET_GROUPS = {
  count: 'Количество, ед.',
  money: 'Сумма, тыс. руб.',
  economy: 'Экономия',
} as const;

/**
 * Поле `SvodRow` → его имя на листе. Полное покрытие 18 столбцов D–U;
 * страж (`svod-sheet-names.test.ts`) не даёт добавить поле без имени.
 */
export const SVOD_SHEET_FIELDS: Readonly<Record<keyof SvodRow, SvodSheetFieldName>> = {
  planCount: { column: 'D', sheetName: 'ПЛАН, единиц', group: SVOD_SHEET_GROUPS.count },
  factCount: { column: 'E', sheetName: 'ФАКТ, единиц', group: SVOD_SHEET_GROUPS.count },
  deviationCount: { column: 'F', sheetName: 'Отклонение, единиц', group: SVOD_SHEET_GROUPS.count },
  executionPct: { column: 'G', sheetName: 'Заключено, %', group: SVOD_SHEET_GROUPS.count },
  planFB: { column: 'H', sheetName: 'ФБ', group: SVOD_SHEET_GROUPS.money },
  planKB: { column: 'I', sheetName: 'КБ', group: SVOD_SHEET_GROUPS.money },
  planMB: { column: 'J', sheetName: 'МБ', group: SVOD_SHEET_GROUPS.money },
  planTotal: { column: 'K', sheetName: 'ИТОГО', group: SVOD_SHEET_GROUPS.money },
  factFB: { column: 'L', sheetName: 'ФБ', group: SVOD_SHEET_GROUPS.money },
  factKB: { column: 'M', sheetName: 'КБ', group: SVOD_SHEET_GROUPS.money },
  factMB: { column: 'N', sheetName: 'МБ', group: SVOD_SHEET_GROUPS.money },
  factTotal: { column: 'O', sheetName: 'ИТОГО', group: SVOD_SHEET_GROUPS.money },
  amountDeviation: { column: 'P', sheetName: 'Отклонение, тыс. руб', group: SVOD_SHEET_GROUPS.money },
  spentPct: { column: 'Q', sheetName: 'Законтрактовано, %', group: SVOD_SHEET_GROUPS.money },
  economyFB: { column: 'R', sheetName: 'ФБ', group: SVOD_SHEET_GROUPS.economy },
  economyKB: { column: 'S', sheetName: 'КБ', group: SVOD_SHEET_GROUPS.economy },
  economyMB: { column: 'T', sheetName: 'МБ', group: SVOD_SHEET_GROUPS.economy },
  economyTotal: { column: 'U', sheetName: 'ИТОГО', group: SVOD_SHEET_GROUPS.economy },
};

/** Подгруппы «ПЛАН»/«ФАКТ» внутри группы «Сумма, тыс. руб.» (ячейки H5 и L5). */
export const SVOD_SHEET_MONEY_SUBGROUPS = {
  plan: 'ПЛАН, тыс. руб.',
  fact: 'ФАКТ, тыс. руб.',
  /** Экономия подписана так же (R5), но живёт в своей группе. */
  economy: 'ФАКТ, тыс. руб.',
} as const;

/** Заголовки блоков листа: D3 (ЭА), D15 (ЕП), A28 (сводная строка). */
export const SVOD_SHEET_BLOCK_TITLES = {
  kp: 'Электронный аукцион, электронная заявка на закупку, электронный конкурс и аналоги',
  ep: 'Единственный поставщик',
  total: 'КП+ЕП',
} as const;

/** Ярус, который лист считает поверх блоков (шапка K1:O2 и строки долей). */
export const SVOD_SHEET_EXTRAS = {
  /** K1 — заголовок правого блока шапки. */
  remainderGroup: 'План минус Факт разбивка',
  /** K2 — подпись строки (лист сокращает слово). */
  remainder: 'Остаток к заключ.',
  /** Та же величина словом целиком — для экрана, где место есть. */
  remainderFull: 'Остаток к заключению',
  /** D31 и D32 — подписи строк долей. */
  shareKp: 'Доля ЭА, ЭЗК, ЭК и аналоги:',
  shareEp: 'Доля ЕП:',
  /** G30 и H30 — две колонки долей. */
  shareFact: 'факт',
  sharePlan: 'план',
  /** B28 / B29 — подписи сводных строк «КП+ЕП». */
  totalBothYears: 'ИТОГО 2025+2026:',
  totalYear: 'ИТОГО 2026:',
  /** A2 — расшифровка переключателя B1. */
  switchLegend: '* = ТД + ПМ',
} as const;

/**
 * Значения выпадающего списка B1 — периметр, по которому лист фильтрует ВСЕ
 * свои COUNTIFS/SUMIFS (условие `'ГРБС'!F:F = B$1`).
 */
export const SVOD_SWITCH_VALUES = [
  'Текущая деятельность',
  'Программное мероприятие',
  '*',
] as const;

export type SvodSwitchValue = (typeof SVOD_SWITCH_VALUES)[number];

/**
 * Срез активности продукта → положение переключателя B1, дающее те же строки.
 * Совпадение не случайное: столбец F листа ГРБС — тот же вид деятельности,
 * по которому режет глобальный фильтр приложения.
 *
 * Оговорка, которую обязан знать читатель: критерий «*» в COUNTIFS ловит любой
 * НЕПУСТОЙ текст, поэтому строка с пустым видом деятельности в «*» листа не
 * попадает, а в срез «ВСЕ» продукта попадает. На строках с заполненной графой
 * F поведение тождественно.
 */
export const SVOD_SWITCH_BY_SCOPE: Readonly<Record<ActivityScope, SvodSwitchValue>> = {
  all: '*',
  td: 'Текущая деятельность',
  pm: 'Программное мероприятие',
};

/** Имя показателя листа по полю строки — короткий доступ для вёрстки. */
export function svodSheetName(field: keyof SvodRow): string {
  return SVOD_SHEET_FIELDS[field].sheetName;
}

/** Колонка листа для поля строки — провенанс числа («Заключено, %» → «G»). */
export function svodSheetColumn(field: keyof SvodRow): string {
  return SVOD_SHEET_FIELDS[field].column;
}
