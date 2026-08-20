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
 *  - НОМЕР ЛОТА через косую — валидная форма, не искажение (п.121, слова
 *    начальницы 20.08.2026: «ЭАС205/1-26 существует»): совместные торги
 *    дробятся на лоты, код лота = базовый номер + «/» + номер лота. Парсер
 *    читает её штатно; мост к базовой процедуре — по семейству+номеру+году;
 *  - ИСКАЖЁННЫЙ код НЕ чинится молча (задание владельца к волне): «А427-25»
 *    (потеряна «Э»), «ЭЗК-120-26» (дефис после префикса), «ЭА146-226» (лишняя
 *    цифра в годе), «ЭЗК264-26Выполнение…» (код приклеен к тексту) — из спеки
 *    мониторинга (docs/superpowers/specs/2026-08-14-daily-monitoring-tab.md)
 *    дают null. Нераспознанное поднимается сигналом с адресом, не исчезает;
 *    диагноз опечатки — explainDistortedCode (догадка показывается, не
 *    применяется).
 *
 * Числа волны (дамп comments-full.jsonl, 3 881 строка, 14.08.2026):
 * непустых не-плейсхолдерных ячеек AG — 345; из них ровно один код целиком —
 * 312; хотя бы один код в тексте — 329 (~331 по счёту спеки, «~96 % контента
 * AG — номер»); без единого кода — 16 (4,6 % ≈ «4 %, посторонний текст» из
 * п.74б).
 */

import { ABSENT_MARKER_RE } from './absence.js';

/**
 * Семейства процедур уполномоченного органа (канон п.74а + сверка 20.08.2026).
 * ЭК (электронный конкурс) добавлено по живым данным: «ЭК03-26» стоит в книге
 * мониторинга и пять раз в книгах ГРБС, а «ЭЗК03-26» не существует нигде —
 * это настоящее семейство, не опечатка ЭЗК.
 */
export const PROCEDURE_FAMILIES = ['ЭА', 'ЭЗК', 'ЭЕП', 'ЭАС', 'ЭК'] as const;

/** Семейство: электронный аукцион / запрос котировок / ЕП / совместный аукцион / конкурс. */
export type ProcedureFamily = (typeof PROCEDURE_FAMILIES)[number];

/** Разобранный номер процедуры в канонической форме. */
export interface ProcedureRef {
  /**
   * Канонический код: «ЭА152-26» (семейство + номер без ведущих нулей + «-»
   * + год); у лота совместных торгов — с номером лота: «ЭАС205/1-26» (п.121).
   */
  readonly code: string;
  readonly family: ProcedureFamily;
  /** Порядковый номер процедуры (ведущие нули сняты: «ЭАС06-25» → n=6). */
  readonly n: number;
  /** Двузначный год нумерации (25, 26, …). */
  readonly yy: number;
  /** Номер лота совместных торгов («ЭАС205/1-26» → 1); null — код без лота. */
  readonly lot: number | null;
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
const FAMILY_PATTERN = 'Э\\s*А\\s*С|Э\\s*З\\s*К|Э\\s*Е\\s*П|Э\\s*А|Э\\s*К';

/** Ячейка целиком — один код (строгая форма для parseProcedureRef). */
const WHOLE_CELL_RE = new RegExp(
  `^\\s*(${FAMILY_PATTERN})\\s*(\\d+)(?:\\s*/\\s*(\\d+))?\\s*-\\s*(\\d{2})\\s*$`,
  'iu',
);

/**
 * Код внутри свободного текста (для extractProcedureRefs). Границы
 * (?<![\p{L}\p{N}]) / (?![\p{L}\p{N}]) не дают ни откусить «ЭА146-22» от
 * искажённого «ЭА146-226», ни признать приклеенный «ЭЗК264-26Выполнение…».
 */
const IN_TEXT_RE = new RegExp(
  `(?<![\\p{L}\\p{N}])(${FAMILY_PATTERN})\\s*(\\d+)(?:\\s*/\\s*(\\d+))?\\s*-\\s*(\\d{2})(?![\\p{L}\\p{N}])`,
  'giu',
);

function toRef(
  familyRaw: string,
  nRaw: string,
  lotRaw: string | undefined,
  yyRaw: string,
): ProcedureRef | null {
  const family = familyRaw.replace(/\s+/gu, '').toUpperCase();
  if (!(PROCEDURE_FAMILIES as readonly string[]).includes(family)) return null;
  const n = Number.parseInt(nRaw, 10);
  const yy = Number.parseInt(yyRaw, 10);
  const lot = lotRaw !== undefined ? Number.parseInt(lotRaw, 10) : null;
  return {
    code: `${family}${n}${lot !== null ? `/${lot}` : ''}-${yyRaw}`,
    family: family as ProcedureFamily,
    n,
    yy,
    lot,
  };
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
  return toRef(m[1], m[2], m[3], m[4]);
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
    const ref = toRef(m[1], m[2], m[3], m[4]);
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
 * поставщиком)» — а также искажённые коды («ЭЗК 283», «ЭК03-26»),
 * которые парсер честно не признал. Код лота («ЭАС205/1-26») — не остаток:
 * с п.121 он валиден и вынимается парсером.
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
    if (toRef(m[1], m[2], m[3], m[4]) === null) continue;
    remainder += original.slice(cursor, m.index);
    cursor = m.index + m[0].length;
  }
  remainder += original.slice(cursor);
  // Разделители между кодами (запятые, скобки, точки с запятой) — не «текст».
  const cleaned = remainder.replace(/[,;()]+/gu, ' ').replace(/\s+/gu, ' ').trim();
  return cleaned === '' ? null : cleaned;
}

// ── Диагноз искажённого кода ─────────────────────────────────────────

/**
 * Диагноз нераспознанного кода: что записано, на что похоже, в чём искажение.
 *
 * Родился из скриншота владельца 20.08.2026: реестр мониторинга помечал
 * строки «без кода», хотя код в ячейке ВИДЕН глазами («ЭКЗ301-26
 * Приобретение…») — он просто набран с опечаткой. Метка «без кода» на такой
 * строке — ложь, подрывающая доверие (п.119: по каждому сигналу должен быть
 * виден ответ — какая строка, что в ней, почему).
 *
 * Догадка `guess` ТОЛЬКО показывается человеку — сверка и мост между книгами
 * по ней НЕ строятся (канон волны: искажённый код не чинится молча).
 */
export interface DistortedCode {
  /** Искажённый токен, как он записан в книге (обрезан по границе кода). */
  readonly raw: string;
  /** Каноническая догадка («ЭЗК301-26») — показать; не применять молча. */
  readonly guess: string;
  /** В чём искажение, одной фразой без упрёка (п.104). */
  readonly note: string;
}

/** Голова «буквы + номер - год» — кандидат в искажённый код (семейство чужое). */
const DISTORTED_HEAD_RE = /^\s*([А-ЯЁ]{1,5})\s*(\d+)\s*-\s*(\d{2})(?![\p{L}\p{N}])/iu;

/** Каноническая форма догадки: семейство + номер без ведущих нулей + год. */
function canonGuess(family: string, nRaw: string, yy: string): string {
  return `${family}${Number.parseInt(nRaw, 10)}-${yy}`;
}

/** Починка префикса одной операцией: какое семейство получается и как. */
function repairPrefix(prefix: string): { family: ProcedureFamily; note: string } | null {
  const fams = PROCEDURE_FAMILIES as readonly string[];
  // Потеряна ведущая «Э»: «А427-25» → ЭА.
  if (fams.includes(`Э${prefix}`)) {
    return { family: `Э${prefix}` as ProcedureFamily, note: 'потеряна буква «Э» в начале' };
  }
  // Буква задвоена: «ЭЗЗК» → ЭЗК.
  const collapsed = prefix.replace(/(.)\1+/gu, '$1');
  if (collapsed !== prefix && fams.includes(collapsed)) {
    return { family: collapsed as ProcedureFamily, note: 'буква задвоена' };
  }
  // Соседние буквы переставлены: «ЭКЗ» → ЭЗК.
  for (let i = 0; i + 1 < prefix.length; i++) {
    const swapped = prefix.slice(0, i) + prefix[i + 1] + prefix[i] + prefix.slice(i + 2);
    if (fams.includes(swapped)) {
      return { family: swapped as ProcedureFamily, note: 'буквы переставлены местами' };
    }
  }
  // Пропущена одна буква: «ЭК» → ЭЗК (префикс — подпоследовательность семейства).
  for (const fam of fams) {
    if (fam.length !== prefix.length + 1) continue;
    for (let i = 0; i < fam.length; i++) {
      if (fam.slice(0, i) + fam.slice(i + 1) === prefix) {
        return { family: fam as ProcedureFamily, note: `пропущена буква «${fam[i]}»` };
      }
    }
  }
  return null;
}

/**
 * Пытается объяснить нераспознанный код в начале текста (колонка C
 * мониторинга, ячейка AG). Покрывает живые искажения из дампа 20.08.2026:
 * «ЭКЗ301-26» (переставлены), «ЭЗЗК01-26» (задвоена), «ЭК03-26» (пропущена),
 * «А427-25» (потеряна Э), «ЭЗК-120-26» (лишний дефис), «ЭА146-226» (лишняя
 * цифра в годе), «ЭЗК264-26Выполнение…» (приклеен к предмету). Номер лота
 * через косую («ЭАС205/1-26») — НЕ искажение: валидная форма (п.121),
 * читается парсером штатно.
 *
 * null — в начале текста кода не видно вовсе (честное «без кода»).
 */
export function explainDistortedCode(text: unknown): DistortedCode | null {
  if (text === null || text === undefined) return null;
  const original = String(text);
  const folded = foldHomoglyphs(original);

  // Код валиден, но приклеен к предмету без пробела: «ЭЗК264-26Выполнение…».
  const glued = new RegExp(`^\\s*(${FAMILY_PATTERN})\\s*(\\d+)\\s*-\\s*(\\d{2})(?=\\p{L})`, 'iu')
    .exec(folded);
  if (glued !== null) {
    const ref = toRef(glued[1], glued[2], undefined, glued[3]);
    if (ref !== null) {
      // В raw — код вместе с приклеенным словом целиком, чтобы человек
      // увидел склейку, а не обрубок посреди слова.
      const gluedWord = /^\p{L}+/u.exec(folded.slice(glued[0].length))?.[0] ?? '';
      return {
        raw: (folded.slice(0, glued[0].length) + gluedWord).trim(),
        guess: ref.code,
        note: 'код приклеен к предмету без пробела',
      };
    }
  }

  // Лишний дефис после семейства: «ЭЗК-120-26».
  const hyphen = new RegExp(`^\\s*(${FAMILY_PATTERN})\\s*-\\s*(\\d+)\\s*-\\s*(\\d{2})(?![\\p{L}\\p{N}])`, 'iu')
    .exec(folded);
  if (hyphen !== null) {
    const family = hyphen[1].replace(/\s+/gu, '').toUpperCase();
    if ((PROCEDURE_FAMILIES as readonly string[]).includes(family)) {
      return {
        raw: folded.slice(0, hyphen[0].length).trim(),
        guess: canonGuess(family, hyphen[2], hyphen[3]),
        note: 'лишний дефис после букв семейства',
      };
    }
  }

  // Лишние цифры в годе: «ЭА146-226». Догадка по хвостовым двум цифрам.
  const longYear = new RegExp(`^\\s*(${FAMILY_PATTERN})\\s*(\\d+)\\s*-\\s*(\\d{3,})(?![\\p{L}\\p{N}])`, 'iu')
    .exec(folded);
  if (longYear !== null) {
    const family = longYear[1].replace(/\s+/gu, '').toUpperCase();
    if ((PROCEDURE_FAMILIES as readonly string[]).includes(family)) {
      return {
        raw: folded.slice(0, longYear[0].length).trim(),
        guess: canonGuess(family, longYear[2], longYear[3].slice(-2)),
        note: 'в годе лишняя цифра',
      };
    }
  }

  // Испорчен сам префикс: «ЭКЗ301-26», «ЭЗЗК01-26», «ЭК03-26», «А427-25».
  const head = DISTORTED_HEAD_RE.exec(folded);
  if (head !== null) {
    const prefix = head[1].toUpperCase();
    if (!(PROCEDURE_FAMILIES as readonly string[]).includes(prefix)) {
      const repair = repairPrefix(prefix);
      if (repair !== null) {
        return {
          raw: folded.slice(0, head[0].length).trim(),
          guess: canonGuess(repair.family, head[2], head[3]),
          note: repair.note,
        };
      }
    }
  }

  return null;
}
