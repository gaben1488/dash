/**
 * procedure-ref.ts — структурный парсер номера процедуры из колонки AG.
 *
 * КАНОН п.74 (интервью 14.08.2026, решение владельца): колонка AG книг ГРБС —
 * структурный ключ «номер процедуры» формата «ЭА152-26» (семейства ЭА / ЭЗК /
 * ЭЕП / ЭАС), основной мост к книге «Ежедневный мониторинг». Парсер номера —
 * структурное чтение, канону п.27 не противоречит: номер — код, не свободный
 * текст.
 *
 * Правила чтения:
 *  - терпимость НА ВХОДЕ: пробелы (в т.ч. внутри кода: «ЭЕП 180-26»), регистр,
 *    латинские омоглифы А/Е/К/С вместо кириллицы;
 *  - канон-нормализация НА ВЫХОДЕ: семейство заглавной кириллицей, номер без
 *    ведущих нулей, год двумя цифрами («ЭАС06-25» → «ЭАС6-25» — это одна и та
 *    же процедура, обе стороны моста нормализуются одной функцией);
 *  - ИСКАЖЁННЫЙ код НЕ чинится молча (задание владельца к волне): «А427-25»
 *    (потеряна «Э»), «ЭЗК-120-26» (дефис после префикса), «ЭА146-226» (лишняя
 *    цифра в годе), «ЭЗК264-26Выполнение…» (код приклеен к тексту),
 *    «ЭАС205/1-26» (косая черта) — все пять из спеки мониторинга
 *    (docs/superpowers/specs/2026-08-14-daily-monitoring-tab.md) дают null.
 *    Нераспознанное содержимое поднимается сигналом с адресом, не исчезает.
 *
 * Числа волны (дамп comments-full.jsonl, 3 881 строка, 14.08.2026):
 * непустых не-плейсхолдерных ячеек AG — 345; из них ровно один код целиком —
 * 312; хотя бы один код в тексте — 329 (~331 по счёту спеки, «~96 % контента
 * AG — номер»); без единого кода — 16 (4,6 % ≈ «4 %, посторонний текст» из
 * п.74б).
 */

import { ABSENT_MARKER_RE } from './absence.js';

/** Семейства процедур уполномоченного органа (канон п.74а). */
export const PROCEDURE_FAMILIES = ['ЭА', 'ЭЗК', 'ЭЕП', 'ЭАС'] as const;

/** Семейство процедуры: электронный аукцион / запрос котировок / ЕП / совместный аукцион. */
export type ProcedureFamily = (typeof PROCEDURE_FAMILIES)[number];

/** Разобранный номер процедуры в канонической форме. */
export interface ProcedureRef {
  /** Канонический код: «ЭА152-26» (семейство + номер без ведущих нулей + «-» + год). */
  readonly code: string;
  readonly family: ProcedureFamily;
  /** Порядковый номер процедуры (ведущие нули сняты: «ЭАС06-25» → n=6). */
  readonly n: number;
  /** Двузначный год нумерации (25, 26, …). */
  readonly yy: number;
}

/**
 * Латинские омоглифы, встречающиеся в ручном вводе кириллических кодов.
 * «Э», «З», «П» латинских двойников не имеют — только A/E/K/C.
 */
const HOMOGLYPHS: Readonly<Record<string, string>> = {
  A: 'А', a: 'А', C: 'С', c: 'С', E: 'Е', e: 'Е', K: 'К', k: 'К',
};

function foldHomoglyphs(s: string): string {
  return s.replace(/[AaCcEeKk]/gu, (ch) => HOMOGLYPHS[ch] ?? ch);
}

/**
 * Семейство с терпимостью к пробелам внутри («Э ЗК», «ЭЕП » и т.п.).
 * ЭАС раньше ЭА — иначе жадность альтернации откусит префикс совместного
 * аукциона. Регистр гасится флагом i (работает и для кириллицы).
 */
const FAMILY_PATTERN = 'Э\\s*А\\s*С|Э\\s*З\\s*К|Э\\s*Е\\s*П|Э\\s*А';

/** Ячейка целиком — один код (строгая форма для parseProcedureRef). */
const WHOLE_CELL_RE = new RegExp(
  `^\\s*(${FAMILY_PATTERN})\\s*(\\d+)\\s*-\\s*(\\d{2})\\s*$`,
  'iu',
);

/**
 * Код внутри свободного текста (для extractProcedureRefs). Границы
 * (?<![\p{L}\p{N}]) / (?![\p{L}\p{N}]) не дают ни откусить «ЭА146-22» от
 * искажённого «ЭА146-226», ни признать приклеенный «ЭЗК264-26Выполнение…».
 */
const IN_TEXT_RE = new RegExp(
  `(?<![\\p{L}\\p{N}])(${FAMILY_PATTERN})\\s*(\\d+)\\s*-\\s*(\\d{2})(?![\\p{L}\\p{N}])`,
  'giu',
);

function toRef(familyRaw: string, nRaw: string, yyRaw: string): ProcedureRef | null {
  const family = familyRaw.replace(/\s+/gu, '').toUpperCase();
  if (!(PROCEDURE_FAMILIES as readonly string[]).includes(family)) return null;
  const n = Number.parseInt(nRaw, 10);
  const yy = Number.parseInt(yyRaw, 10);
  return { code: `${family}${n}-${yyRaw}`, family: family as ProcedureFamily, n, yy };
}

/**
 * Строгий разбор ячейки AG: вся ячейка — ровно один номер процедуры.
 * Терпимость к пробелам/регистру/омоглифам; искажения формата → null
 * (не чинить молча — нераспознанное сигналится адресом выше по стеку).
 */
export function parseProcedureRef(agCell: unknown): ProcedureRef | null {
  if (agCell === null || agCell === undefined) return null;
  const m = WHOLE_CELL_RE.exec(foldHomoglyphs(String(agCell)));
  if (!m) return null;
  return toRef(m[1], m[2], m[3]);
}

/**
 * Все валидные коды из свободного текста, в порядке появления, без дублей.
 * Нужна для: (а) ячеек AG со списком кодов («ЭЕП103-26, ЭЕП104-26, …» — план
 * дробится на несколько процедур); (б) колонки C мониторинга, где код и
 * предмет живут одной строкой («ЭА152-26 Ремонт …»).
 */
export function extractProcedureRefs(text: unknown): ProcedureRef[] {
  if (text === null || text === undefined) return [];
  const folded = foldHomoglyphs(String(text));
  const out: ProcedureRef[] = [];
  const seen = new Set<string>();
  for (const m of folded.matchAll(IN_TEXT_RE)) {
    const ref = toRef(m[1], m[2], m[3]);
    if (ref !== null && !seen.has(ref.code)) {
      seen.add(ref.code);
      out.push(ref);
    }
  }
  return out;
}

/** Плейсхолдер-точка встречается в AG наравне с X/тире (дамп §2.1: «Х/X/-/—/.»). */
const DOT_PLACEHOLDER_RE = /^\.+$/u;

/**
 * Посторонний текст в колонке номера процедуры (сигнал п.74б: «в колонке
 * номера процедуры посторонний текст, перенести в примечание»).
 *
 * Возвращает непустой НЕ-номерной остаток ячейки: содержимое минус найденные
 * коды и разделители между ними; null — если ячейка пуста, плейсхолдер или
 * состоит только из кодов. Живые примеры остатка из дампа: «считаем
 * экономией», «Отдел ФК и С», «не состоялся (заявка 1 , заключили с ед.
 * поставщиком)» — а также искажённые коды («ЭЗК 283», «ЭК03-26»,
 * «ЭАС205/1-26»), которые парсер честно не признал.
 *
 * Ячейки «код + приписка» (школьные списки УО) тоже дают остаток — у них
 * при этом extractProcedureRefs непуст; ячеек вовсе без кода в дампе 16 из
 * 345 (4,6 %). Решение, какой из двух случаев сигналить каким текстом, —
 * за интеграцией (гейт-агент, comment-consistency).
 */
export function detectForeignText(agCell: unknown): string | null {
  if (agCell === null || agCell === undefined) return null;
  const original = String(agCell).trim();
  if (original === '' || ABSENT_MARKER_RE.test(original) || DOT_PLACEHOLDER_RE.test(original)) {
    return null;
  }
  // Омоглиф-свёртка 1:1 по символам — индексы совпадают с оригиналом,
  // остаток вырезаем из оригинального текста.
  const folded = foldHomoglyphs(original);
  let remainder = '';
  let cursor = 0;
  for (const m of folded.matchAll(IN_TEXT_RE)) {
    if (toRef(m[1], m[2], m[3]) === null) continue;
    remainder += original.slice(cursor, m.index);
    cursor = m.index + m[0].length;
  }
  remainder += original.slice(cursor);
  // Разделители между кодами (запятые, скобки, точки с запятой) — не «текст».
  const cleaned = remainder.replace(/[,;()]+/gu, ' ').replace(/\s+/gu, ' ').trim();
  return cleaned === '' ? null : cleaned;
}
