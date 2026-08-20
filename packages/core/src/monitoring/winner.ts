/**
 * winner.ts — разбор составной ячейки «Победитель» (канон п.101а, спека §1.1).
 *
 * В книге эта ячейка несёт три разные вещи сразу: наименование поставщика,
 * его ИНН и — вместо них — исход процедуры («Не состоялся (0 заявок)»,
 * «Размещение повторное (не прошёл контроль в УФК)»). Первая версия вкладки
 * показывала её строкой текста, из-за чего разрез «по победителю» был
 * невозможен: 191 уникальный ИНН прятался в 347 написаниях.
 *
 * Правило п.27 соблюдено: текст НЕ становится источником стадии. Стадия
 * считается по числам (цена, даты) в procedures.ts, а разбор этой ячейки
 * даёт лишь поля для показа и группировки, причём сырое написание едет на
 * экран вместе с разбором — читатель всегда видит книгу как она есть.
 */

/** Что стоит в ячейке победителя: поставщик либо исход процедуры. */
export type WinnerOutcome =
  /** Разобран поставщик (есть ИНН либо наименование без признаков исхода). */
  | 'supplier'
  /** «Не состоялся (0 заявок)» и написания-варианты. */
  | 'not_held'
  /** «Размещение повторное (не прошёл контроль в УФК)». */
  | 'repeat_placement'
  /** Ячейка пуста — итога ещё нет. */
  | 'empty';

/** Подписи исходов для читателя. */
export const WINNER_OUTCOME_LABELS: Record<WinnerOutcome, string> = {
  supplier: 'Победитель определён',
  not_held: 'Не состоялся',
  repeat_placement: 'Размещение повторное',
  empty: 'Итога нет',
};

export interface ParsedWinner {
  /** Ячейка как есть — показывается по наведению, не подменяется разбором. */
  readonly raw: string;
  /** Наименование поставщика без строки ИНН; null — в ячейке только исход. */
  readonly name: string | null;
  /** ИНН победителя (10 или 12 цифр); null — ИНН в ячейке нет. */
  readonly inn: string | null;
  readonly outcome: WinnerOutcome;
  /** Текст исхода как в книге («Не состоялся (0 заявок)»); null — его нет. */
  readonly outcomeText: string | null;
  /** ИНН записан в ячейке дважды — след копипаста (одна такая ячейка в книге). */
  readonly innRepeated: boolean;
}

/** Пустая ячейка победителя — отдельный разбор, а не отсутствие разбора. */
const EMPTY_WINNER: ParsedWinner = {
  raw: '',
  name: null,
  inn: null,
  outcome: 'empty',
  outcomeText: null,
  innRepeated: false,
};

/**
 * ИНН: 10 цифр у организации, 12 — у предпринимателя.
 *
 * Порядок ветвей важен: при «\d{10}|\d{12}» двенадцатизначный ИНН
 * предпринимателя обрезался бы до первых десяти цифр, а хвост из двух цифр
 * приклеивался бы к наименованию — а предпринимателей в книге большинство.
 */
const INN_RE = /ИНН\s*:?\s*(\d{12}|\d{10})/giu;
/** Исходы — закрытый словарь, свободный текст исходом не считается (п.27). */
const NOT_HELD_RE = /не\s*состоял/iu;
const REPEAT_PLACEMENT_RE = /размещени[а-яё]*\s+повторн|повторн[а-яё]*\s+размещени/iu;

/**
 * Разобрать ячейку победителя.
 *
 * Живые формы книги: «ООО "АТС"\nИНН 4100022887» (340 ячеек), тот же состав
 * с парой «\r\n» (семь ячеек — вставка из другого источника), «ИП …\nИНН …
 * ИНН …» (одна ячейка, ИНН повторён), «Не состоялся (0 заявок)» (21 ячейка),
 * наименование без ИНН (27 ячеек — ИНН просто забыли).
 */
export function parseWinnerCell(v: unknown): ParsedWinner {
  if (v === null || v === undefined) return EMPTY_WINNER;
  const raw = String(v).replace(/\r\n/gu, '\n').trim();
  if (raw === '') return EMPTY_WINNER;

  const inns: string[] = [];
  for (const m of raw.matchAll(INN_RE)) inns.push(m[1]);
  const inn = inns.length > 0 ? inns[0] : null;
  const innRepeated = inns.length > 1;

  // Наименование — всё, что осталось после снятия строк с ИНН.
  const nameRaw = raw
    .split('\n')
    .map((line) => line.replace(INN_RE, '').trim())
    .filter((line) => line !== '')
    .join(' ')
    .replace(/\s{2,}/gu, ' ')
    .trim();

  const notHeld = NOT_HELD_RE.test(nameRaw);
  const repeatPlacement = REPEAT_PLACEMENT_RE.test(nameRaw);

  if (notHeld || repeatPlacement) {
    return {
      raw,
      // Исход — не поставщик: подставлять его в разрез «по победителю» нельзя.
      name: null,
      inn,
      outcome: notHeld ? 'not_held' : 'repeat_placement',
      outcomeText: nameRaw === '' ? null : nameRaw,
      innRepeated,
    };
  }

  return {
    raw,
    name: nameRaw === '' ? null : nameRaw,
    inn,
    outcome: 'supplier',
    outcomeText: null,
    innRepeated,
  };
}

/**
 * Ключ группировки поставщика: ИНН, если он есть, иначе нормализованное
 * наименование. Разрез «по победителю» ведётся по ИНН (спека §2.6) — одно
 * и то же лицо в книге записано по-разному, а ИНН один.
 */
export function supplierKey(w: ParsedWinner): string | null {
  if (w.outcome !== 'supplier') return null;
  if (w.inn !== null) return w.inn;
  if (w.name === null) return null;
  return `имя:${normalizeSupplierName(w.name)}`;
}

/** Наименование поставщика к сравнимому виду: регистр, кавычки, пробелы. */
export function normalizeSupplierName(name: string): string {
  return name
    .toLowerCase()
    .replace(/ё/gu, 'е')
    .replace(/[«»"'`„“”]/gu, '')
    .replace(/[.,]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}
