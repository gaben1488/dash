/**
 * Русский язык в текстах книг: орфографические предложения и пунктуация.
 * Проверка не записывает данные и не выводит из текста статус закупки.
 *
 * Точные проверенные пары имеют приоритет над частотой корпуса, минимальной
 * длиной и сходством окончаний: иначе «плпта» и многобуквенные опечатки теряются.
 * Остальной корпусный путь ограничен VERIFIED_TYPO_SET. Неизвестное слово
 * само по себе не является ошибкой; частый сосед не доказывает замену.
 * Правильные слова («сменой», «вместе», «заданий»), имена и смысловые пары
 * требуют контекста и не добавляются в словарь автоматических предложений.
 *
 * ponytail: конечный проверенный список не является полным словарём языка.
 * Необнаруженные слова остаются предметом контекстной вычитки; ноль находок
 * не означает отсутствие ошибок. Исходные корпуса и стадия — PLAN K07–K10.
 */

import { VERIFIED_TYPO_CORRECTIONS } from './dictionaries/verified-typos.js';
import { isAbsentCell } from './absence.js';
import { boundedLevenshtein, hygieneFix } from './text-hygiene.js';
import {
  CORPUS_CORE_WORDS,
  CORPUS_COMMON_WORDS,
  CORPUS_PROTECTED_WORDS,
  CORPUS_REJECTED_WORDS,
  CORPUS_SILENT_WORDS,
} from './dictionaries/corpus-words.js';

// ────────────────────────────────────────────────────────────
// 1. Модель находки
// ────────────────────────────────────────────────────────────

/** Уверенность находки. Низкой нет: до карточки она не доходит. */
export type LanguageConfidence = 'высокая' | 'средняя';

/**
 * Чем ячейка является по смыслу — от этого зависит одно правило пунктуации.
 *
 *  - `наименование` — предмет закупки (колонка G) или имя учреждения
 *    (колонка C): это назывное словосочетание, и точка в конце в нём лишняя.
 *  - `свободный текст` — обоснование (колонка M): здесь человек пишет
 *    предложениями, и точка в конце как раз законна.
 *
 * Умолчание — `свободный текст`, то есть МОЛЧАНИЕ. Проверка не угадывает роль
 * ячейки сама: живой прогон показал 367 находок «лишняя точка» почти целиком
 * на обоснованиях, где точка стоит по праву. Роль называет тот, кто знает
 * колонку, а не проверка по виду строки (канон п.27: из текста не выводится
 * ничего, чего в нём не написано).
 */
export type CellTextRole = 'наименование' | 'свободный текст';

export type LanguageIssueKind =
  | 'spelling'
  | 'double_punct'
  | 'unpaired_bracket'
  | 'unpaired_quote'
  | 'straight_quotes'
  | 'hyphen_between_numbers'
  | 'trailing_period';

export interface LanguageFinding {
  kind: LanguageIssueKind;
  /** Что нашли — имя дефекта для заголовка карточки. */
  label: string;
  /** Где именно внутри ячейки: вырезка с окружением. */
  excerpt: string;
  /**
   * ГОТОВОЕ исправленное значение ВСЕЙ ячейки: копируется и вставляется
   * целиком. В значении закрыты все находки НЕ НИЖЕ уверенности этой самой
   * карточки — карточка высокой уверенности не тащит за собой догадку.
   */
  fix: string;
  confidence: LanguageConfidence;
  /** Объяснение по-русски: почему это дефект и что предлагается. */
  explanation: string;
}

// ────────────────────────────────────────────────────────────
// 2. Словарь-эталон и указатель по длине
// ────────────────────────────────────────────────────────────

/**
 * Слово короче этого не проверяется: у коротких слов слишком много соседей на
 * расстоянии одной правки, и «форма»/«норма»/«фирма» неразличимы по смыслу.
 */
export const SPELL_MIN_LENGTH = 6;

/**
 * Опечатки, перешагнувшие порог частоты, вычитаются из машинных списков ДО
 * всего остального. Иначе словарь переворачивает проверку: правильное
 * «объеме» получает подсказку «обьеме».
 */
const REJECTED: ReadonlySet<string> = new Set(CORPUS_REJECTED_WORDS);

const CORE_SET: ReadonlySet<string> = new Set(
  CORPUS_CORE_WORDS.filter((w) => !REJECTED.has(w)),
);

/**
 * Слова, которые проверка считает написанными правильно. Сюда же входит
 * ручной список законной лексики (`CORPUS_PROTECTED_WORDS`): корпус одного
 * района не покрывает словарь языка, и без него «подставка» превращается в
 * «поставку». Ручные слова в ядро НЕ попадают — подсказка по ним не может
 * быть высокой уверенности.
 */
const KNOWN_SET: ReadonlySet<string> = new Set(
  [...CORPUS_CORE_WORDS, ...CORPUS_COMMON_WORDS, ...CORPUS_PROTECTED_WORDS]
    .filter((w) => !REJECTED.has(w)),
);

/**
 * Слова, написанные неверно, но подсказка по которым заведомо негодна
 * («Всвязи» → «Связи»). Молчим: карточка с негодным готовым значением хуже
 * молчания. В подсказки другим словам эти слова не идут — они неправильные.
 */
const SILENT_SET: ReadonlySet<string> = new Set(CORPUS_SILENT_WORDS);

/**
 * ponytail: защитный режим до подключения проверяемого русского словаря.
 * Корпус одних закупочных книг НЕ доказывает, что редкое слово неверно:
 * «сменой» → «сметной», «вместе» → «месте», «заданий» → «зданий».
 *
 * Готовые правки допустимы только для уже проверенных опечаток из
 * регрессионных кейсов и отвергнутых машинных слов. Остальные слова
 * могут быть кандидатами отдельной смысловой ревизии, но здесь молчат:
 * ложная правка хуже пропущенной подсказки. Новые опечатки добавлять
 * только вместе с источником, правдоподобным контекстом и отрицательным тестом.
 * Потолок: этот режим не выявляет новые виды опечаток до их верификации.
 */
const VERIFIED_TYPO_SET: ReadonlySet<string> = new Set([
  ...CORPUS_REJECTED_WORDS,
  'кемонт', 'катриджей', 'закпки', 'техниескому',
  'предосталению', 'теплоснбжение', 'медецинских',
  'укремпления', 'хоолодное', 'расчитке',
  'едиственным', 'опресовка', 'подарной',
]);

/**
 * Указатель «длина → слова этой длины». Правка одна, значит длины отличаются
 * не более чем на единицу — перебирать весь словарь не нужно.
 */
const BY_LENGTH: ReadonlyMap<number, readonly string[]> = (() => {
  const m = new Map<number, string[]>();
  for (const w of KNOWN_SET) {
    const bucket = m.get(w.length);
    if (bucket) bucket.push(w);
    else m.set(w.length, [w]);
  }
  return m;
})();

/** Приведение к виду словаря: строчные буквы, «ё» неотличима от «е». */
export function normalizeWord(word: string): string {
  return word.toLowerCase().replace(/ё/gu, 'е');
}

/** Длина общего начала двух слов. */
function commonPrefixLength(a: string, b: string): number {
  const n = Math.min(a.length, b.length);
  let i = 0;
  while (i < n && a[i] === b[i]) i++;
  return i;
}

/**
 * Отсев словоформ: различие целиком в последних двух буквах — это падеж,
 * число или род, а не опечатка. «проведении» и «проведения» имеют общее
 * начало в девять букв при длине десять, значит расходятся только окончания.
 */
export function differsOnlyInEnding(a: string, b: string): boolean {
  const p = commonPrefixLength(a, b);
  return p >= a.length - 2 && p >= b.length - 2;
}

/**
 * Страж «у настоящего слова есть родня»: если словарь знает ЭТОТ ЖЕ корень в
 * другой форме («подставки» при «подставка», «объем» при «объеме»), значит
 * слово настоящее — просто в книгах оно редкое, и трогать его нельзя.
 *
 * Страж вытащен из живого прогона: без него «подставка под огнетушители»
 * получала подсказку «поставка», «оказание услуг по приведению в норму» —
 * «проведению», а «филе рыбы мороженой» — «мороженое». Опечатка родни не
 * имеет: словарь не знает ни «катриджи», ни «муницпального», ни «расчитки».
 */
function hasInflectionSibling(word: string): boolean {
  for (let len = word.length - 2; len <= word.length + 2; len++) {
    for (const candidate of BY_LENGTH.get(len) ?? []) {
      if (candidate !== word && differsOnlyInEnding(word, candidate)) return true;
    }
  }
  return false;
}

export interface SpellSuggestion {
  /** Каноническое слово из словаря корпуса (в нижнем регистре). */
  word: string;
  confidence: LanguageConfidence;
}

const suggestionCache = new Map<string, SpellSuggestion | null>();
const SUGGESTION_CACHE_CAP = 8192;

/** Подтверждённая контекстная опечатка «хор. товаров» → «хоз. товаров».
 *  Обычное слово «хор» нельзя переписывать — оно встречается в закупках культуры. */
const HOUSEHOLD_GOODS_TYPO_RE = /(?<![А-Яа-яЁё])хо[рp]\.(?=\s+товаров(?![А-Яа-яЁё]))/iu;
const HOUSEHOLD_GOODS_TYPO_RE_GLOBAL = /(?<![А-Яа-яЁё])хо[рp]\.(?=\s+товаров(?![А-Яа-яЁё]))/giu;

export function findHouseholdGoodsAbbreviation(raw: string):
  { index: number; word: string; suggestion: string } | null {
  const match = HOUSEHOLD_GOODS_TYPO_RE.exec(raw);
  if (!match) return null;
  return { index: match.index, word: match[0],
    suggestion: match[0][0] === 'Х' ? 'Хоз.' : 'хоз.' };
}

function fixHouseholdGoodsAbbreviation(raw: string): string {
  return raw.replace(HOUSEHOLD_GOODS_TYPO_RE_GLOBAL,
    found => found[0] === 'Х' ? 'Хоз.' : 'хоз.');
}

/**
 * Единственный сосед слова на расстоянии одной правки — либо null.
 * null возвращается и когда слово словарю известно, и когда соседей больше
 * одного (двусмысленность), и когда сосед отличается только окончанием.
 */
export function suggestFromCorpus(rawWord: string): SpellSuggestion | null {
  const word = normalizeWord(rawWord);
  const cached = suggestionCache.get(word);
  if (cached !== undefined) return cached;

  const verified = Object.hasOwn(VERIFIED_TYPO_CORRECTIONS, word)
    ? VERIFIED_TYPO_CORRECTIONS[word] : undefined;
  let result: SpellSuggestion | null = verified
    ? { word: verified, confidence: 'высокая' } : null;
  if (
    !result &&
    word.length >= SPELL_MIN_LENGTH
    && VERIFIED_TYPO_SET.has(word)
    && !KNOWN_SET.has(word)
    && !SILENT_SET.has(word)
    && !hasInflectionSibling(word)
  ) {
    let best: string | null = null;
    let count = 0;
    for (const len of [word.length - 1, word.length, word.length + 1]) {
      for (const candidate of BY_LENGTH.get(len) ?? []) {
        if (boundedLevenshtein(word, candidate, 1) !== 1) continue;
        if (differsOnlyInEnding(word, candidate)) continue;
        count++;
        if (count > 1) break;
        best = candidate;
      }
      if (count > 1) break;
    }
    if (count === 1 && best !== null) {
      result = { word: best, confidence: CORE_SET.has(best) ? 'высокая' : 'средняя' };
    }
  }

  if (suggestionCache.size >= SUGGESTION_CACHE_CAP) suggestionCache.clear();
  suggestionCache.set(word, result);
  return result;
}

// ────────────────────────────────────────────────────────────
// 3. Разбор ячейки на проверяемые слова
// ────────────────────────────────────────────────────────────

/**
 * Слово-кандидат: сплошной кириллический кусок, у которого по краям НЕ стоят
 * цифра, латиница или дефис. Так из проверки выпадают «44-ФЗ», «ОКПД2»,
 * «ГОСТ 12.4.011-89» и прочие обозначения — они не слова русского языка.
 */
const CYRILLIC_RUN_RE = /[А-Яа-яЁё]+/gu;
const GLUED_RE = /[0-9A-Za-z-]/u;

interface WordHit {
  word: string;
  index: number;
}

export function collectWords(text: string): WordHit[] {
  const hits: WordHit[] = [];
  for (const m of text.matchAll(CYRILLIC_RUN_RE)) {
    const word = m[0];
    const index = m.index ?? 0;
    if (word.length < SPELL_MIN_LENGTH
      && !Object.hasOwn(VERIFIED_TYPO_CORRECTIONS, normalizeWord(word))) continue;
    // Аббревиатура целиком заглавными не проверяется (НМЦК, ЕИС, МБУДО).
    if (word === word.toUpperCase()) continue;
    const before = index > 0 ? text[index - 1] : '';
    const after = text[index + word.length] ?? '';
    const verified = Object.hasOwn(VERIFIED_TYPO_CORRECTIONS, normalizeWord(word));
    // Проверенная опечатка в «преоктно-сметный» не становится кодом из-за дефиса.
    // Цифры/латиница и дефис номера по-прежнему исключаются.
    const compoundBefore = verified && before === '-' && /[А-Яа-яЁё]/u.test(text[index - 2] ?? '');
    const compoundAfter = verified && after === '-' && /[А-Яа-яЁё]/u.test(text[index + word.length + 1] ?? '');
    if ((GLUED_RE.test(before) && !compoundBefore) || (GLUED_RE.test(after) && !compoundAfter)) continue;
    hits.push({ word, index });
  }
  return hits;
}

/** Заглавная первая буква исходного слова сохраняется в исправлении. */
function matchCase(original: string, replacement: string): string {
  const first = original[0] ?? '';
  if (first !== '' && first === first.toUpperCase() && first !== first.toLowerCase()) {
    return replacement.charAt(0).toUpperCase() + replacement.slice(1);
  }
  return replacement;
}

// ────────────────────────────────────────────────────────────
// 4. Пунктуация
// ────────────────────────────────────────────────────────────

/** Знаки, удвоение которых — заведомо промах пальца. */
const DOUBLE_SURE_RE = /([,;:])\1+/u;
const DOUBLE_SURE_RE_G = /([,;:])\1+/gu;
/** Удвоение точки и восклицания — тоже дефект, но уверенность ниже. */
const DOUBLE_SOFT_RE = /(?<!\.)\.\.(?!\.)|([!?])\1+/u;
const DOUBLE_SOFT_RE_G = /(?<!\.)\.\.(?!\.)|([!?])\1+/gu;

/**
 * Диапазон годов через дефис: «2024-2025» набирается через тире «2024–2025».
 * По краям не должно быть цифры, точки, дефиса, косой черты и знака номера —
 * иначе это часть обозначения («ГОСТ 12.4.011-89», «№ 44-ФЗ»).
 */
const YEAR_RANGE_RE = /(?<![\d.\-/№A-Za-zА-Яа-яЁё])((?:19|20)\d{2})-((?:19|20)\d{2})(?![\d.\-/A-Za-zА-Яа-яЁё])/gu;
/**
 * Прочий числовой промежуток: тоже тире, но уверенность средняя. Требуется
 * возрастание — «12-45» с убыванием или равенством скорее номер, чем промежуток.
 * Буква вплотную к числу с любой стороны снимает вопрос: «1-4кв» — это не
 * промежуток набора, а сокращённая запись кварталов.
 */
const NUM_RANGE_RE = /(?<![\d.\-/№A-Za-zА-Яа-яЁё])(\d{1,4})-(\d{1,4})(?![\d.\-/A-Za-zА-Яа-яЁё])/gu;

/**
 * Окно перед числом, в котором знак номера отменяет находку: «ЭА № ЭА 11-26»
 * — это номер процедуры, а не промежуток, хотя между «№» и числом стоит ещё
 * буквенное сокращение. Живой случай книги УО.
 */
const NUMBERING_LOOKBACK = 12;

interface RangeHit {
  text: string;
  from: string;
  to: string;
  index: number;
  confidence: LanguageConfidence;
}

/**
 * Промежутки, набранные дефисом вместо тире. Годы — высокая уверенность,
 * прочие числа — средняя (и только по возрастанию). Обе проверки живут здесь,
 * чтобы карточка и готовое значение не разошлись.
 */
function numericRanges(text: string): RangeHit[] {
  const hits: RangeHit[] = [];
  const seen = new Set<number>();
  const scan = (re: RegExp, confidence: LanguageConfidence) => {
    re.lastIndex = 0;
    for (const m of text.matchAll(re)) {
      const index = m.index ?? 0;
      if (seen.has(index)) continue;
      if (text.slice(Math.max(0, index - NUMBERING_LOOKBACK), index).includes('№')) continue;
      if (confidence === 'средняя' && Number(m[1]) >= Number(m[2])) continue;
      seen.add(index);
      hits.push({ text: m[0], from: m[1], to: m[2], index, confidence });
    }
  };
  scan(YEAR_RANGE_RE, 'высокая');
  scan(NUM_RANGE_RE, 'средняя');
  return hits.sort((a, b) => a.index - b.index);
}

/** Замена парных прямых кавычек на ёлочки. Число кавычек обязано быть чётным. */
function replaceStraightQuotes(text: string): string {
  let open = true;
  return text.replace(/"/gu, () => {
    const q = open ? '«' : '»';
    open = !open;
    return q;
  });
}

/**
 * Починка непарных скобок и кавычек: лишний закрывающий знак убирается,
 * недостающие закрывающие дописываются в конец. Приём грубый, потому и
 * уверенность средняя — но результат детерминирован, а не выдуман.
 */
function repairPairs(text: string, open: string, close: string): string {
  let depth = 0;
  let out = '';
  for (const ch of text) {
    if (ch === open) {
      depth++;
      out += ch;
    } else if (ch === close) {
      if (depth === 0) continue;
      depth--;
      out += ch;
    } else {
      out += ch;
    }
  }
  return out + close.repeat(depth);
}

function countOf(text: string, ch: string): number {
  let n = 0;
  for (const c of text) if (c === ch) n++;
  return n;
}

/**
 * Прямых кавычек нечётное число: одна повисла. Кавычка в самом конце строки —
 * это хвост, оставшийся от копирования, он убирается; кавычка внутри строки
 * открыта и не закрыта, закрывающая дописывается в конец. После этого число
 * чётное, и обычная замена на ёлочки работает как всегда.
 */
function balanceStraightQuotes(text: string): string {
  const last = text.lastIndexOf('"');
  if (last < 0) return text;
  const tailIsBlank = text.slice(last + 1).trim() === '';
  return tailIsBlank
    ? text.slice(0, last) + text.slice(last + 1)
    : `${text.trimEnd()}"`;
}

/** Непарность: закрывающих меньше или больше, чем открывающих. */
function isUnpaired(text: string, open: string, close: string): boolean {
  if (countOf(text, open) !== countOf(text, close)) return true;
  let depth = 0;
  for (const ch of text) {
    if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth < 0) return true;
    }
  }
  return false;
}

/**
 * Точка в конце наименования. Молчит, когда точка — часть многоточия, когда
 * перед ней цифра или короткое сокращение («и т.д.»), и когда в ячейке
 * несколько предложений (точка-пробел-заглавная) — тогда это связный текст,
 * а не наименование.
 *
 * Главное правило молчания — последнее слово должно быть СЛОВОМ из словаря
 * корпуса. Живой случай «Охрана лиценз.» показал, зачем: «лиценз.» — это
 * оборванное «лицензированная», и точка там не лишняя, а обозначает обрыв.
 * Убрать её значило бы испортить смысл, поэтому на незнакомом хвосте молчим.
 */
function trailingPeriodFix(text: string): string | null {
  const t = text.trimEnd();
  if (!t.endsWith('.') || t.endsWith('...')) return null;
  if (/\.\s+[А-ЯЁA-Z]/u.test(t)) return null;
  const tail = t.slice(0, -1);
  const lastWord = tail.match(/[А-Яа-яЁёA-Za-z]+$/u);
  if (!lastWord || lastWord[0].length < 3) return null;
  if (!KNOWN_SET.has(normalizeWord(lastWord[0]))) return null;
  return tail.trimEnd();
}

// ────────────────────────────────────────────────────────────
// 5. Готовое исправление ячейки
// ────────────────────────────────────────────────────────────

const ORDER: Record<LanguageConfidence, number> = { 'высокая': 2, 'средняя': 1 };

/**
 * Замена дефиса на тире в промежутках уверенности не ниже заданной. Идём
 * справа налево, чтобы уже найденные места не съезжали.
 */
function applyRanges(text: string, floor: number): string {
  let t = text;
  for (const r of numericRanges(text).reverse()) {
    if (ORDER[r.confidence] < floor) continue;
    t = `${t.slice(0, r.index)}${r.from}–${r.to}${t.slice(r.index + r.text.length)}`;
  }
  return t;
}

/**
 * ГОТОВОЕ значение ячейки: применяются все находки уверенности НЕ НИЖЕ
 * заданной, а сверху — механическая гигиена (`hygieneFix`), чтобы одна вставка
 * закрывала всё разом и оператору не пришлось собирать значение по кускам.
 */
export function languageFix(
  raw: string,
  minConfidence: LanguageConfidence = 'средняя',
  role: CellTextRole = 'свободный текст',
): string {
  const floor = ORDER[minConfidence];
  let t = fixHouseholdGoodsAbbreviation(raw);

  t = t.replace(DOUBLE_SURE_RE_G, '$1');
  t = applyRanges(t, floor);

  if (floor <= 1) {
    t = t.replace(DOUBLE_SOFT_RE_G, (_m, g: string | undefined) => (g ? g : '.'));
    let straight = countOf(t, '"');
    if (straight % 2 === 1) {
      t = balanceStraightQuotes(t);
      straight = countOf(t, '"');
    }
    if (straight > 0) t = replaceStraightQuotes(t);
    if (isUnpaired(t, '(', ')')) t = repairPairs(t, '(', ')');
    if (isUnpaired(t, '«', '»')) t = repairPairs(t, '«', '»');
    const noDot = role === 'наименование' ? trailingPeriodFix(t) : null;
    if (noDot !== null) t = noDot;
  }

  // Орфография — последней: замены точечные, по каждому слову-кандидату.
  const hits = collectWords(t);
  if (hits.length > 0) {
    let out = '';
    let cursor = 0;
    for (const hit of hits) {
      const s = suggestFromCorpus(hit.word);
      if (!s || ORDER[s.confidence] < floor) continue;
      out += t.slice(cursor, hit.index) + matchCase(hit.word, s.word);
      cursor = hit.index + hit.word.length;
    }
    t = out + t.slice(cursor);
  }

  return hygieneFix(t);
}

// ────────────────────────────────────────────────────────────
// 6. Детектор
// ────────────────────────────────────────────────────────────

const EXCERPT_RADIUS = 16;

function excerptAround(s: string, index: number, length: number): string {
  const from = Math.max(0, index - EXCERPT_RADIUS);
  const to = Math.min(s.length, index + length + EXCERPT_RADIUS);
  return `${from > 0 ? '…' : ''}${s.slice(from, to)}${to < s.length ? '…' : ''}`;
}

/**
 * Проверка русского языка в ячейке: орфография и пунктуация.
 *
 * Молчит на нетексте, пустоте и маркерах отсутствия «X/х/тире» (канон п.62) —
 * заглушка проверке не подлежит. Находки отсортированы: сначала высокая
 * уверенность, потом средняя; низкой в выдаче нет по построению.
 */
export function detectLanguageIssues(
  value: unknown,
  role: CellTextRole = 'свободный текст',
): LanguageFinding[] {
  if (typeof value !== 'string') return [];
  if (isAbsentCell(value)) return [];

  const raw = value;
  const findings: LanguageFinding[] = [];
  const fixAt = (c: LanguageConfidence) => languageFix(raw, c, role);

  const householdGoods = findHouseholdGoodsAbbreviation(raw);
  if (householdGoods !== null) {
    findings.push({
      kind: 'spelling',
      label: `опечатка в сокращении «${householdGoods.word}»`,
      excerpt: excerptAround(raw, householdGoods.index, householdGoods.word.length),
      fix: fixAt('высокая'),
      confidence: 'высокая',
      explanation: `В сочетании с «товаров» требуется «${householdGoods.suggestion}» `
        + `(хозяйственных товаров), а не «${householdGoods.word}».`,
    });
  }

  // ── Орфография ──────────────────────────────────────────
  const seen = new Set<string>();
  for (const hit of collectWords(raw)) {
    const s = suggestFromCorpus(hit.word);
    if (!s) continue;
    const key = normalizeWord(hit.word);
    if (seen.has(key)) continue;
    seen.add(key);
    const proposed = matchCase(hit.word, s.word);
    findings.push({
      kind: 'spelling',
      label: `опечатка в слове «${hit.word}»`,
      excerpt: excerptAround(raw, hit.index, hit.word.length),
      fix: fixAt(s.confidence),
      confidence: s.confidence,
      explanation:
        `«${hit.word}» входит в перечень ранее подтверждённых опечаток. ` +
        `Близкий вариант «${proposed}» отличается одной правкой ` +
        `и прошёл ограниченный словарный контроль. Проверьте ` +
        `предложенное значение по исходному предмету закупки.`,
    });
  }

  // ── Двойные знаки препинания ────────────────────────────
  const dSure = raw.match(DOUBLE_SURE_RE);
  if (dSure && dSure.index !== undefined) {
    findings.push({
      kind: 'double_punct',
      label: `знак «${dSure[1]}» набран дважды`,
      excerpt: excerptAround(raw, dSure.index, dSure[0].length),
      fix: fixAt('высокая'),
      confidence: 'высокая',
      explanation: `Подряд идут два одинаковых знака «${dSure[1]}» — лишний убирается.`,
    });
  }
  const dSoft = raw.match(DOUBLE_SOFT_RE);
  if (dSoft && dSoft.index !== undefined) {
    findings.push({
      kind: 'double_punct',
      label: `знак «${dSoft[0][0]}» набран дважды`,
      excerpt: excerptAround(raw, dSoft.index, dSoft[0].length),
      fix: fixAt('средняя'),
      confidence: 'средняя',
      explanation:
        `Подряд идут два одинаковых знака «${dSoft[0][0]}». Если это не ` +
        `многоточие, лишний знак убирается.`,
    });
  }

  // ── Промежуток через дефис вместо тире ──────────────────
  const [range] = numericRanges(raw);
  if (range) {
    findings.push({
      kind: 'hyphen_between_numbers',
      label: `дефис вместо тире в «${range.text}»`,
      excerpt: excerptAround(raw, range.index, range.text.length),
      fix: fixAt(range.confidence),
      confidence: range.confidence,
      explanation: range.confidence === 'высокая'
        ? `Между годами ставится тире, а не дефис: «${range.from}–${range.to}». `
          + 'Дефис соединяет части слова, тире обозначает промежуток.'
        : `Между числами промежутка ставится тире: «${range.from}–${range.to}». `
          + 'Если это не промежуток, а номер, исправление не нужно.',
    });
  }

  // ── Кавычки ─────────────────────────────────────────────
  const straight = countOf(raw, '"');
  if (straight > 0 && straight % 2 === 0) {
    findings.push({
      kind: 'straight_quotes',
      label: 'прямые кавычки вместо ёлочек',
      excerpt: excerptAround(raw, raw.indexOf('"'), 1),
      fix: fixAt('средняя'),
      confidence: 'средняя',
      explanation:
        'В русском тексте кавычки — ёлочки «…». Прямые кавычки приходят из ' +
        'раскладки и мешают сличать имена: «Лидер» и "Лидер" для машины разные.',
    });
  }
  if (isUnpaired(raw, '«', '»') || straight % 2 === 1) {
    const idx = Math.max(raw.indexOf('«'), raw.indexOf('»'), raw.indexOf('"'), 0);
    findings.push({
      kind: 'unpaired_quote',
      label: 'непарные кавычки',
      excerpt: excerptAround(raw, idx, 1),
      fix: fixAt('средняя'),
      confidence: 'средняя',
      explanation:
        'Кавычка открыта и не закрыта (или закрыта без открытия). Недостающая ' +
        'кавычка дописывается в конец, лишняя убирается — проверьте место.',
    });
  }

  // ── Скобки ──────────────────────────────────────────────
  if (isUnpaired(raw, '(', ')')) {
    const idx = Math.max(raw.indexOf('('), raw.indexOf(')'), 0);
    findings.push({
      kind: 'unpaired_bracket',
      label: 'непарные скобки',
      excerpt: excerptAround(raw, idx, 1),
      fix: fixAt('средняя'),
      confidence: 'средняя',
      explanation:
        'Скобка открыта и не закрыта (или закрыта без открытия). Недостающая ' +
        'скобка дописывается в конец, лишняя убирается — проверьте место.',
    });
  }

  // ── Точка в конце наименования ──────────────────────────
  const noDot = role === 'наименование' ? trailingPeriodFix(raw) : null;
  if (noDot !== null) {
    findings.push({
      kind: 'trailing_period',
      label: 'точка в конце наименования',
      excerpt: excerptAround(raw, Math.max(raw.trimEnd().length - 12, 0), 12),
      fix: fixAt('средняя'),
      confidence: 'средняя',
      explanation:
        'Наименование — не предложение, точка в конце не ставится. При сличении ' +
        'строк лишняя точка делает два одинаковых предмета разными.',
    });
  }

  return findings
    // Карточка обязана нести значение, отличное от исходного: «вставьте то же
    // самое» — это не действие (п.53), а издевательство. Такое отсеивается.
    .filter((f) => f.fix !== raw)
    .sort((a, b) => ORDER[b.confidence] - ORDER[a.confidence]);
}
