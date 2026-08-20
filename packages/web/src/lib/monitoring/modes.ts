/**
 * Режимы просмотра книги — «все страницы перенести и давать возможность
 * смотреть по-разному» (канон п.101а, спека §2).
 *
 * ПОЧЕМУ РЕЖИМ ЛИСТА, А НЕ ОДНА ТАБЛИЦА С ФИЛЬТРОМ. Листы книги — не срезы
 * одного набора строк, а разные формы. У свода восемь строк и семь колонок
 * денег; у «25-26» есть судьба процедуры и родословная, которых на листах
 * управлений нет вовсе; у справочника нет ни одной закупки. Свести их в одну
 * таблицу значит потерять три четверти книги — ровно то, за что вкладку
 * ругали 18.08.
 *
 * ПОЧЕМУ РАЗРЕЗЫ ЖИВУТ ОТДЕЛЬНО (`slices.ts`). Режим отвечает на вопрос «на
 * какой лист я смотрю», разрез — «какие строки меня интересуют». Они
 * перпендикулярны: выбрав квартал, читатель обязан увидеть его и в реестре, и
 * в своде. Поэтому смена режима разрезов не сбрасывает.
 */
import { MONITORING_DEPT_SHEETS } from '@aemr/core';

/** Что за форма показывается — от этого зависит вся таблица под переключателем. */
export type ModeKind = 'registry' | 'svod' | 'journal' | 'directory' | 'ancestors';

export interface SheetMode {
  /** Ид режима: `all`, `dept:УО`, `svod`, … — живёт в состоянии страницы. */
  id: string;
  kind: ModeKind;
  /** Подпись на кнопке — коротко, как лист зовётся в книге. */
  label: string;
  /** Что это за лист — подсказка при наведении и текст под заголовком. */
  hint: string;
  /** Имя листа книги; null — режим собран из нескольких листов. */
  sheet: string | null;
  /** Канонический ид управления; null — режим не про одно управление. */
  dept: string | null;
}

/** Режим «все восемь листов управлений разом» — вход по умолчанию. */
export const ALL_DEPTS_MODE: SheetMode = {
  id: 'all',
  kind: 'registry',
  label: 'Все управления',
  hint: 'Восемь листов управлений одной таблицей: реестр процедур целиком, как его видит книга.',
  sheet: null,
  dept: null,
};

/** Восемь режимов листов управлений в порядке книги, а не алфавита. */
export const DEPT_MODES: readonly SheetMode[] = MONITORING_DEPT_SHEETS.map(({ sheet, dept }) => ({
  id: `dept:${dept}`,
  kind: 'registry' as const,
  label: sheet,
  hint: `Лист «${sheet}» книги — процедуры управления ${dept} в форме самой книги.`,
  sheet,
  dept,
}));

export const SVOD_MODE: SheetMode = {
  id: 'svod',
  kind: 'svod',
  label: 'Сводный',
  hint: 'Лист «СВОДНЫЙ»: восемь строк управлений и итог, рядом — как те же числа считает продукт.',
  sheet: 'СВОДНЫЙ',
  dept: null,
};

export const JOURNAL_MODE: SheetMode = {
  id: 'journal',
  kind: 'journal',
  label: 'Переходящий реестр 25-26',
  hint: 'Лист «25-26»: победители и ИНН, судьба процедуры и родословная переобъявлений.',
  sheet: '25-26',
  dept: null,
};

export const DIRECTORY_MODE: SheetMode = {
  id: 'directory',
  kind: 'directory',
  label: 'Справочник учреждений',
  hint: 'Лист «Перечень ГРБС»: учреждения района и их владельцы-ГРБС.',
  sheet: 'Перечень ГРБС',
  dept: null,
};

export const ANCESTORS_MODE: SheetMode = {
  id: 'ancestors',
  kind: 'ancestors',
  label: 'Листы-предки',
  hint: 'Три скрытых листа книги: данных не несут, но помнят поля, которых нынешней форме не хватает.',
  sheet: null,
  dept: null,
};

/** Полный ряд режимов в порядке книги: реестр → свод → журнал → справочники. */
export const SHEET_MODES: readonly SheetMode[] = [
  ALL_DEPTS_MODE,
  ...DEPT_MODES,
  SVOD_MODE,
  JOURNAL_MODE,
  DIRECTORY_MODE,
  ANCESTORS_MODE,
];

/** Режим по ид; незнакомый ид возвращает вход по умолчанию, а не падение. */
export function modeById(id: string): SheetMode {
  return SHEET_MODES.find((m) => m.id === id) ?? ALL_DEPTS_MODE;
}

/** Русское имя управления по ид — для крошек разрезов и заголовков. */
export function deptSheetName(dept: string): string {
  return MONITORING_DEPT_SHEETS.find((d) => d.dept === dept)?.sheet ?? dept;
}
