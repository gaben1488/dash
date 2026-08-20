/**
 * text-hygiene.ts — детекторы гигиены текста (канон п.98д пакета поручений
 * 18.08.2026 + п.95/55: сигналы «очень хорошо понятно сделанные», чтобы
 * помогать операторам приводить данные в нормальный вид).
 *
 * Класс дефекта: текст ячейки набран с техническим браком — двойные пробелы,
 * пробел не с той стороны знака препинания, невидимые символы, латинская
 * буква внутри кириллического слова, имя подведа с отступлением от
 * справочника. Глазом такой брак почти неотличим, но он ломает поиск,
 * группировки и сличение строк: «ДС №3 „Жар-Птица“» и «ДС № 3 «Жар-Птица»» —
 * для машины два разных учреждения (живой кейс листа «ВСЕ» книги УО:
 * 5 строк варианта против 43 строк канона).
 *
 * Каждый детектор возвращает НЕ только диагноз, но и `fix` — ГОТОВОЕ
 * исправленное значение всей ячейки: оператор копирует и вставляет целиком,
 * ничего не дописывая руками (тон диагноста п.53: механизм + адрес +
 * действие, без упрёков).
 *
 * Чего детекторы НЕ трогают (осторожность из постановки):
 *  - маркеры отсутствия «X/x/Х/х», тире, пустые ячейки — канон п.62
 *    (isAbsentCell): это осознанные заглушки, не текст;
 *  - легитимные различия набора: десятичная запятая «1,5», инициалы
 *    «М.В.Ломоносова» (точки без пробелов — так в самом справочнике),
 *    номера «№3» и вид кавычек — сами по себе не дефект; отступлением они
 *    становятся ТОЛЬКО когда справочник имён подведов говорит иначе.
 */

import { isAbsentCell } from './absence.js';
import { SUBORDINATE_REGISTRY } from './dictionaries/subordinate-registry.js';

// ────────────────────────────────────────────────────────────
// 1. Модель находки
// ────────────────────────────────────────────────────────────

export type TextHygieneKind =
  | 'double_space'
  | 'space_before_punct'
  | 'missing_space_after_punct'
  | 'invisible_char'
  | 'edge_space'
  | 'mixed_alphabet'
  | 'registry_mismatch';

/**
 * Имя РОДА дефекта — для счётчиков, фильтров и сводки карточки (канон п.122:
 * подача структурой, а не простынёй). Отличается от `label` находки: label
 * называет конкретный случай («пробел перед „,“»), а имя рода — класс целиком.
 * Один словарь на правило rule-book, роут /api/text-hygiene и экран Контроля:
 * три места обязаны называть один дефект одним словом.
 */
export const TEXT_HYGIENE_KIND_LABELS: Readonly<Record<TextHygieneKind, string>> = {
  double_space: 'двойные пробелы',
  space_before_punct: 'пробел перед знаком препинания',
  missing_space_after_punct: 'нет пробела после знака препинания',
  invisible_char: 'невидимые символы',
  edge_space: 'пробелы по краям',
  mixed_alphabet: 'латиница в кириллице',
  registry_mismatch: 'имя подведа не по справочнику',
};

/** Устойчивый порядок родов дефектов в сводках и счётчиках. */
export const TEXT_HYGIENE_KIND_ORDER: readonly TextHygieneKind[] = [
  'registry_mismatch',
  'mixed_alphabet',
  'invisible_char',
  'double_space',
  'space_before_punct',
  'missing_space_after_punct',
  'edge_space',
];

export interface TextHygieneFinding {
  kind: TextHygieneKind;
  /** Имя дефекта для карточки — литературный русский, без жаргона. */
  label: string;
  /** Короткая вырезка вокруг дефекта (невидимые символы показаны явно). */
  excerpt: string;
  /**
   * ГОТОВОЕ исправленное значение ВСЕЙ ячейки. Оператор копирует и
   * вставляет целиком — это действие карточки (п.53), а не подсказка.
   */
  fix: string;
}

// ────────────────────────────────────────────────────────────
// 2. Невидимые символы и пробелы
// ────────────────────────────────────────────────────────────

/**
 * Символы нулевой ширины: в тексте книги им места нет — удаляются.
 *
 * ПОЧЕМУ ПЕРЕЧИСЛЕНИЕ, А НЕ НАБОР В СКОБКАХ. Внутри [...] эти записи читаются
 * как подряд идущие символы, и посередине оказывается U+200D — соединитель
 * нулевой ширины, которым склеивают составные эмодзи. Правило
 * no-misleading-character-class справедливо видит там «склеенную последовательность»
 * и не может знать, что мы перечисляем отдельные символы, а не
 * описываем один составной. Перечисление через | двусмысленности не
 * оставляет; для поиска одиночного символа это ровно то же самое.
 */
const ZERO_WIDTH_RE = /\u200B|\u200C|\u200D|\uFEFF/;
const ZERO_WIDTH_RE_G = /\u200B|\u200C|\u200D|\uFEFF/g;

/** Невидимые «пробелоподобные»: NBSP-семейство и табуляция → обычный пробел. */
const NBSP_TAB_RE = /[\u00A0\u2007\u202F\t]/;
const NBSP_TAB_RE_G = /[\u00A0\u2007\u202F\t]/g;

/** Человеческое имя невидимого символа для подписи находки. */
function invisibleName(ch: string): string {
  if (ch === '\t') return 'табуляция';
  if (ch === '\u00A0' || ch === '\u2007' || ch === '\u202F') return 'неразрывный пробел';
  return 'символ нулевой ширины';
}

/** Невидимый символ в вырезке показывается явно — иначе оператор его не увидит. */
function showInvisible(s: string): string {
  return s
    .replace(/\t/g, '⇥')
    .replace(/[\u00A0\u2007\u202F]/g, '␣')
    .replace(ZERO_WIDTH_RE_G, '·');
}

/**
 * Радиус вырезки вокруг дефекта — ±20 символов (канон п.122: колонка «Как
 * записано» на Контроле показывает слово с окружением, чтобы место дефекта
 * находилось глазами без открытия книги).
 */
const EXCERPT_RADIUS = 20;

/** Вырезка вокруг дефекта: контекст, а не вся ячейка (карточка — не простыня). */
function excerptAround(s: string, index: number, length: number): string {
  const from = Math.max(0, index - EXCERPT_RADIUS);
  const to = Math.min(s.length, index + length + EXCERPT_RADIUS);
  return `${from > 0 ? '…' : ''}${showInvisible(s.slice(from, to))}${to < s.length ? '…' : ''}`;
}

// ────────────────────────────────────────────────────────────
// 3. Смешение алфавитов (гомоглифы)
// ────────────────────────────────────────────────────────────

/**
 * Пары визуально неотличимых букв. Замена выполняется ТОЛЬКО внутри слова,
 * где алфавиты смешаны (кейс «СШОР по ЛBС» с латинской B) — цельно-латинские
 * слова («Windows») и цельно-кириллические не трогаются.
 */
const LAT_TO_CYR: Readonly<Record<string, string>> = {
  A: 'А', B: 'В', C: 'С', E: 'Е', H: 'Н', K: 'К', M: 'М',
  O: 'О', P: 'Р', T: 'Т', X: 'Х', Y: 'У',
  a: 'а', c: 'с', e: 'е', o: 'о', p: 'р', x: 'х', y: 'у',
};
const CYR_TO_LAT: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(LAT_TO_CYR).map(([lat, cyr]) => [cyr, lat]),
);

const LETTER_RUN_RE = /[A-Za-zА-Яа-яЁё]+/gu;
const LAT_RE = /[A-Za-z]/;
const CYR_RE = /[А-Яа-яЁё]/;

function isMixedToken(token: string): boolean {
  return LAT_RE.test(token) && CYR_RE.test(token);
}

/**
 * Чинит смешанное слово в сторону БОЛЬШИНСТВА его букв: слово в основном
 * кириллическое — латинские гомоглифы становятся кириллицей, и наоборот.
 * Буква без гомоглифа остаётся как есть (честнее, чем выдумать замену).
 */
function fixMixedToken(token: string): string {
  if (!isMixedToken(token)) return token;
  const latCount = [...token].filter((ch) => LAT_RE.test(ch)).length;
  const cyrCount = [...token].filter((ch) => CYR_RE.test(ch)).length;
  // При равенстве — в кириллицу: книги ведутся по-русски.
  const map = cyrCount >= latCount ? LAT_TO_CYR : CYR_TO_LAT;
  const from = cyrCount >= latCount ? LAT_RE : CYR_RE;
  return [...token].map((ch) => (from.test(ch) ? (map[ch] ?? ch) : ch)).join('');
}

// ────────────────────────────────────────────────────────────
// 4. Полное исправление ячейки
// ────────────────────────────────────────────────────────────

/**
 * Пунктуация, перед которой пробел — дефект. Только однозначные знаки:
 * тире и кавычки в набор не входят (пробелы вокруг тире легитимны).
 */
const PUNCT_CLASS = '[,.;:!?]';
const SPACE_BEFORE_PUNCT_RE = new RegExp(`\\s+(${PUNCT_CLASS})`, 'gu');

/**
 * После этих знаков нужен пробел, если дальше идёт БУКВА. Точка исключена
 * сознательно: инициалы «М.В.Ломоносова» набраны без пробелов в самом
 * справочнике; запятая между цифрами («1,5») — десятичная и не трогается,
 * потому что цифра — не буква.
 */
const MISSING_AFTER_RE = /([,;:])(?=[A-Za-zА-Яа-яЁё])/gu;

/**
 * ГОТОВОЕ исправленное значение ячейки: все механические дефекты закрыты
 * разом. Одна ячейка может нести несколько дефектов — каждая находка несёт
 * один и тот же полный fix, чтобы вставка ЛЮБОГО из них закрывала все
 * (оператор вставляет один раз, а не собирает исправление по частям).
 */
export function hygieneFix(raw: string): string {
  let t = raw
    .replace(ZERO_WIDTH_RE_G, '')
    .replace(NBSP_TAB_RE_G, ' ');
  t = t.replace(LETTER_RUN_RE, (tok) => fixMixedToken(tok));
  t = t.replace(/ {2,}/g, ' ');
  t = t.replace(SPACE_BEFORE_PUNCT_RE, '$1');
  t = t.replace(MISSING_AFTER_RE, '$1 ');
  return t.trim();
}

// ────────────────────────────────────────────────────────────
// 5. Детекторы механической гигиены (1–5 постановки)
// ────────────────────────────────────────────────────────────

/**
 * Детекторы по текстовой ячейке. Возвращают находки с готовым fix.
 * Не текст (числа), пустота и маркеры отсутствия «X/х/тире» (канон п.62,
 * isAbsentCell) молчат — заглушка не подлежит «очистке».
 */
export function detectCellHygiene(value: unknown): TextHygieneFinding[] {
  if (typeof value !== 'string') return [];
  if (isAbsentCell(value)) return [];

  const raw = value;
  const fix = hygieneFix(raw);
  const findings: TextHygieneFinding[] = [];

  // (4) Ведущие/замыкающие пробелы.
  if (/^\s/u.test(raw) || /\s$/u.test(raw)) {
    findings.push({
      kind: 'edge_space',
      label: 'пробелы в начале или конце',
      excerpt: `«${showInvisible(raw.length > 40 ? `${raw.slice(0, 18)}…${raw.slice(-18)}` : raw)}»`,
      fix,
    });
  }

  // (3) Невидимые символы: NBSP-семейство, табы, символы нулевой ширины.
  const invisibleMatch = raw.match(NBSP_TAB_RE) ?? raw.match(ZERO_WIDTH_RE);
  // Краевой NBSP уже пойман детектором краёв — внутренние всё равно важны.
  if (invisibleMatch && invisibleMatch.index !== undefined) {
    const kinds = new Set<string>();
    for (const ch of raw) {
      if (NBSP_TAB_RE.test(ch) || ZERO_WIDTH_RE.test(ch)) kinds.add(invisibleName(ch));
    }
    findings.push({
      kind: 'invisible_char',
      label: `невидимые символы (${[...kinds].join(', ')})`,
      excerpt: excerptAround(raw, invisibleMatch.index, invisibleMatch[0].length),
      fix,
    });
  }

  // (1) Двойные и более пробелы.
  const doubles = raw.match(/ {2,}/);
  if (doubles && doubles.index !== undefined) {
    findings.push({
      kind: 'double_space',
      label: 'двойные пробелы',
      excerpt: excerptAround(raw, doubles.index, doubles[0].length),
      fix,
    });
  }

  // (2а) Пробел перед знаком препинания.
  SPACE_BEFORE_PUNCT_RE.lastIndex = 0;
  const before = SPACE_BEFORE_PUNCT_RE.exec(raw);
  if (before) {
    findings.push({
      kind: 'space_before_punct',
      label: `пробел перед «${before[1]}»`,
      excerpt: excerptAround(raw, before.index, before[0].length),
      fix,
    });
  }

  // (2б) Нет пробела после знака препинания (перед буквой).
  MISSING_AFTER_RE.lastIndex = 0;
  const after = MISSING_AFTER_RE.exec(raw);
  if (after) {
    findings.push({
      kind: 'missing_space_after_punct',
      label: `нет пробела после «${after[1]}»`,
      excerpt: excerptAround(raw, after.index, 2),
      fix,
    });
  }

  // (5) Смешение алфавитов внутри слова (каждое смешанное слово — находка).
  LETTER_RUN_RE.lastIndex = 0;
  for (const m of raw.matchAll(LETTER_RUN_RE)) {
    const token = m[0];
    if (!isMixedToken(token)) continue;
    const latCount = [...token].filter((ch) => LAT_RE.test(ch)).length;
    const cyrCount = [...token].filter((ch) => CYR_RE.test(ch)).length;
    const alien = cyrCount >= latCount
      ? [...token].filter((ch) => LAT_RE.test(ch))
      : [...token].filter((ch) => CYR_RE.test(ch));
    findings.push({
      kind: 'mixed_alphabet',
      label: cyrCount >= latCount
        ? `латинские буквы в кириллическом слове «${token}» (${alien.join(', ')})`
        : `кириллические буквы в латинском слове «${token}» (${alien.join(', ')})`,
      excerpt: excerptAround(raw, m.index ?? 0, token.length),
      fix,
    });
  }

  return findings;
}

// ────────────────────────────────────────────────────────────
// 6. Расстояние Левенштейна с потолком
// ────────────────────────────────────────────────────────────

/**
 * Расстояние Левенштейна, обрезанное потолком: вернёт число ≤ max либо null.
 * Ранний выход по минимуму строки DP — сличение с реестром из ~70 имён
 * на тысячах строк остаётся дешёвым.
 */
export function boundedLevenshtein(a: string, b: string, max: number): number | null {
  if (a === b) return 0;
  const la = a.length;
  const lb = b.length;
  if (Math.abs(la - lb) > max) return null;
  let prev: number[] = Array.from({ length: lb + 1 }, (_, j) => j);
  for (let i = 1; i <= la; i++) {
    const cur: number[] = [i];
    let rowMin = i;
    for (let j = 1; j <= lb; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      cur[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return null;
    prev = cur;
  }
  return prev[lb] <= max ? prev[lb] : null;
}

// ────────────────────────────────────────────────────────────
// 7. Отступление имени подведа от справочника (6 постановки)
// ────────────────────────────────────────────────────────────

/** Потолок близости к канону: 2 правки — опечатка, дальше — другое имя. */
export const REGISTRY_DISTANCE_MAX = 2;

/**
 * Кавычки всех видов при СЛИЧЕНИИ приводятся к одному знаку: живой кейс
 * «ДС №3 „Жар-Птица“» против канона «ДС № 3 «Жар-Птица»» отличается и
 * пробелом, и видом кавычек — без нормализации кавычек расстояние выходит
 * за потолок, и опечатка ускользает. Сам fix при этом — ДОСЛОВНОЕ имя из
 * справочника (canonicalName хранит и вид кавычек).
 */
function normalizeQuotes(s: string): string {
  return s.replace(/[«»„“”‟"’‘']/gu, '"');
}

/** Дословные имена справочника подведов (включая категории строк). */
const CANONICAL_NAMES: readonly string[] = SUBORDINATE_REGISTRY.map((s) => s.canonicalName);
const CANONICAL_SET: ReadonlySet<string> = new Set(CANONICAL_NAMES);

/**
 * Кэш сличения: имена подведов повторяются тысячами строк, уникальных —
 * десятки. Значение: каноническое имя-исправление либо null (нет находки).
 *
 * Потолок держит кэш конечным в долгоживущем процессе сервера: колонка C
 * обязана нести имена учреждений (их десятки), но испорченный лист может
 * подсунуть тысячи разных строк — тогда кэш просто сбрасывается, а не растёт
 * без предела.
 */
const NEAREST_CACHE_CAP = 4096;
const nearestCache = new Map<string, string | null>();

/**
 * Ближайшее каноническое имя для отступившего значения C.
 * null — если значение канонично, далеко от всего справочника (другое имя,
 * не опечатка) или двусмысленно (два канона на одном расстоянии — угадывать
 * исправление нельзя, «ЕДМШ»/«ЕДХШ» различаются одной буквой).
 */
export function nearestCanonicalSubordinate(name: string): string | null {
  const cached = nearestCache.get(name);
  if (cached !== undefined) return cached;

  let result: string | null = null;
  if (!CANONICAL_SET.has(name)) {
    const norm = normalizeQuotes(name);
    let best: number | null = null;
    let bestName: string | null = null;
    let bestCount = 0;
    for (const canonical of CANONICAL_NAMES) {
      const d = boundedLevenshtein(norm, normalizeQuotes(canonical), REGISTRY_DISTANCE_MAX);
      if (d === null) continue;
      if (best === null || d < best) {
        best = d;
        bestName = canonical;
        bestCount = 1;
      } else if (d === best) {
        bestCount++;
      }
    }
    // Единственный ближний канон — исправление; двусмысленность — молчание.
    if (bestName !== null && bestCount === 1) result = bestName;
  }
  if (nearestCache.size >= NEAREST_CACHE_CAP) nearestCache.clear();
  nearestCache.set(name, result);
  return result;
}

/**
 * Гигиена ячейки C (имя подведа): сначала справочник, потом механика.
 *
 *  - маркеры отсутствия и пустота — молчание (п.62: это «само управление»,
 *    см. org-itself, а не грязное имя);
 *  - точное совпадение со справочником — молчание, даже если внутри имени
 *    есть что «улучшить»: справочник дословен, и правит его владелец,
 *    а не сигнал (осторожность постановки: только если справочник говорит
 *    иначе);
 *  - отступление ≤2 правок от единственного канона — одна находка с fix =
 *    дословное имя справочника (она перекрывает механические: вставка
 *    канона закрывает и пробелы, и кавычки, и гомоглифы разом);
 *  - имя вне справочника и вне потолка — только механическая гигиена.
 */
export function detectSubordinateNameHygiene(value: unknown): TextHygieneFinding[] {
  if (typeof value !== 'string') return [];
  if (isAbsentCell(value)) return [];

  const trimmed = value.trim();

  if (CANONICAL_SET.has(trimmed)) {
    // Имя каноничное; дефектом остаются только края самой ячейки.
    if (trimmed !== value) {
      return [{
        kind: 'edge_space',
        label: 'пробелы в начале или конце',
        excerpt: `«${showInvisible(value)}»`,
        fix: trimmed,
      }];
    }
    return [];
  }

  const canonical = nearestCanonicalSubordinate(trimmed);
  if (canonical !== null) {
    return [{
      kind: 'registry_mismatch',
      label: 'имя подведа отступает от справочника',
      excerpt: `«${showInvisible(trimmed)}»`,
      fix: canonical,
    }];
  }

  return detectCellHygiene(value);
}
