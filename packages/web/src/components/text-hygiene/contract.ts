/**
 * Договор с сервером по гигиене текста и орфографии
 * (GET /api/text-hygiene; канон п.122 + п.98д).
 *
 * Типы держатся здесь, а не в общем api.ts: этот ответ читает ровно один
 * раздел вкладки «Контроль», и его форма меняется вместе с ним.
 *
 * ГЛАВНОЕ, ЧТО ЗАДАЁТ ЭТОТ ДОГОВОР, — РАЗЛИЧИЕ ПУСТОТЫ И ЧИСТОТЫ. Ответ несёт
 * знаменатель (cellsChecked) и список непрочитанных книг (booksSilent):
 * «дефектов не найдено, проверено N ячеек» и «книги не прочитаны — проверки
 * не было» — разные новости, и экран обязан их различать.
 */
import { TEXT_HYGIENE_KIND_LABELS, TEXT_HYGIENE_KIND_ORDER } from '@aemr/shared';
import type { TextHygieneKind } from '@aemr/shared';

export type { TextHygieneKind };
// Словарь родов дефектов — из @aemr/shared: тот же, которым говорит правило
// text_hygiene в карточке-сводке. Одна вещь — одно имя во всех местах.
export { TEXT_HYGIENE_KIND_LABELS, TEXT_HYGIENE_KIND_ORDER };

export interface TextHygieneItem {
  /** Адрес ячейки на листе: «C2309». */
  cell: string;
  /** Номер строки листа — позиция на момент чтения (лист живёт, п.98б). */
  row: number;
  /** «№ п/п» из колонки A — стабильный второй адрес; null — не проставлен. */
  rowSeq: string | null;
  col: 'C' | 'G';
  kind: TextHygieneKind;
  /** Имя дефекта для конкретного случая («пробел перед „,“»). */
  label: string;
  /** Дефектное место с окружением; невидимые символы показаны явно (␣ ⇥ ·). */
  context: string;
  /** ГОТОВОЕ значение всей ячейки: копируется и вставляется целиком (п.98д). */
  fix: string;
}

export interface TextHygieneDept {
  /** Кириллический канон-идентификатор книги («УО»). */
  dept: string;
  deptLatin: string;
  deptName: string;
  /** Имя листа — половина адреса «лист · ячейка». */
  sheet: string;
  items: TextHygieneItem[];
  countsByKind: Partial<Record<TextHygieneKind, number>>;
}

export type LanguageConfidence = 'высокая' | 'средняя';

export interface TextLanguageItem {
  dept: string;
  deptLatin: string;
  sheet: string;
  cell: string;
  row: number;
  rowSeq: string | null;
  col: 'G' | 'M';
  kind: 'spelling';
  word: string;
  context: string;
  suggestion: string | null;
  confidence: LanguageConfidence;
  fix: string;
}

export interface TextHygieneResponse {
  /** Момент чтения (ISO) — у каждого числа есть момент, канон п.58. */
  asOf: string;
  rowsSource: 'live' | 'snapshot' | 'none';
  booksChecked: string[];
  /** Книги без строк: по ним проверки НЕ БЫЛО — это не «дефектов нет». */
  booksSilent: string[];
  byDept: TextHygieneDept[];
  language: TextLanguageItem[];
  totals: {
    rowsChecked: number;
    cellsChecked: number;
    hygieneFindings: number;
    languageFindings: number;
    countsByKind: Partial<Record<TextHygieneKind, number>>;
  };
  notes: string[];
}

/** Число с русскими разрядами: 3 852. */
export function fmtCount(n: number): string {
  return n.toLocaleString('ru-RU');
}

/** Момент чтения по-русски: «20 августа, 14:32». */
export function fmtMoment(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('ru-RU', {
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Русское склонение по числу: 1 находка, 3 находки, 11 находок. */
export function pluralFindings(n: number): string {
  const mod100 = Math.abs(n) % 100;
  if (mod100 >= 11 && mod100 <= 14) return 'находок';
  const mod10 = mod100 % 10;
  if (mod10 === 1) return 'находка';
  if (mod10 >= 2 && mod10 <= 4) return 'находки';
  return 'находок';
}

/**
 * Карточка базы знаний раздела. Живёт рядом с разделом, а не в общем словаре
 * страниц: она объясняет ровно эти находки и меняется вместе с ними.
 */
export const TEXT_HYGIENE_KB = {
  whatIs:
    'Технические дефекты набора в текстовых колонках книг: двойные и краевые пробелы, ' +
    'пробел не с той стороны знака препинания, невидимые символы, латиница внутри ' +
    'кириллического слова, имя подведа с отступлением от справочника — плюс орфография ' +
    'по словарю, собранному из самих книг. Глазом такой брак почти неотличим, но машина ' +
    'видит два разных значения — пример из книги УО (лист «ВСЕ»): «ДС №3 „Жар-Птица“» ' +
    'в 5 строках против канона «ДС № 3 «Жар-Птица»» в 43 — фильтры и группировки ' +
    'считают их разными учреждениями.',
  howCalc:
    'Колонка C (имя подведа) сличается со справочником подведомственных учреждений и ' +
    'механикой набора; колонка G (предмет) — только механикой. Орфография проверяется ' +
    'по G и M (обоснование выбора ЕП) частотным словарём: показываются только слова с ' +
    'единственным близким соседом в словаре — двусмысленность молчит.',
  dataSource:
    'Счётные строки всех книг управлений (живой кэш либо сохранённый снимок) на момент, ' +
    'указанный в плашке.',
  pitfalls:
    'Маркеры отсутствия «X/х/тире» — не дефект и в перечень не попадают (канон п.62). ' +
    'Справочник имён дословен: если имя совпало с ним, внутренние особенности набора ' +
    'дефектом не считаются. Проверка ничего не меняет в книгах сама — решение за человеком.',
  actions:
    'Каждая строка перечня несёт готовое значение ячейки: скопировать кнопкой и вставить ' +
    'в книгу целиком, править руками не нужно.',
} as const;
