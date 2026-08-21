/**
 * triple-check.ts — тройная сверка одной закупки по трём независимым записям.
 *
 * ЗАЧЕМ (прямое требование владельца 21.08.2026: «щас мы сверяем движок и
 * лист, а можно сверять данные по закупкам»). До этой волны сверка была
 * двусторонней: наш расчёт против агрегата листа СВОД. Агрегат отвечает на
 * вопрос «сходится ли итог», но не отвечает на вопрос «сходится ли ЭТА
 * закупка». Между тем одна и та же закупка записана в районе трижды:
 *
 *   1. КНИГА ГРБС — план и факт по строке плана закупок (колонки K, Y, AC —
 *      ТЫСЯЧИ рублей), номер процедуры в AG, предмет в G;
 *   2. ЛИСТ УПРАВЛЕНИЯ книги «Ежедневный мониторинг» — начальная цена,
 *      цена аукциона, экономия (РУБЛИ), код и предмет одной строкой в C;
 *   3. ПЕРЕХОДЯЩИЙ РЕЕСТР «25-26» той же книги — та же процедура ещё раз,
 *      с родословной переобъявлений.
 *
 * Три записи ведут три разные руки, и расходятся они по-разному: книга ГРБС
 * отстаёт на факте, лист управления — на экономии, переходящий реестр держит
 * закупку целиком там, где листы держат доли. Двусторонняя сверка любой пары
 * умеет сказать «не сходится», но не умеет сказать, КТО из двоих отстал.
 * Третья запись это решает: две стороны против одной — большинство видно.
 *
 * ЧЕГО МОДУЛЬ НЕ ДЕЛАЕТ. Не выбирает победителя и не чинит книгу. Расхождение
 * называется, его размер показывается, адреса всех сторон приводятся (п.53:
 * механизм + адрес + действие; п.119: по каждому сигналу виден ответ — какая
 * строка, что в ней, почему). Какая запись верна — решение человека.
 *
 * КЛЮЧ СВЯЗИ — канонический код процедуры («ЭА152-26»), разбираемый одним
 * парсером @aemr/shared на всех трёх сторонах (канон п.74). Предмет — ВТОРОЙ
 * ключ: он не соединяет вместо кода (совпадение слов не доказательство), но
 * (а) подтверждает пару, найденную по коду, и (б) подсказывает кандидата там,
 * где код набран с опечаткой и мост по нему не строится (канон: искажённый
 * код не чинится молча).
 *
 * ЕДИНИЦЫ. Книга ГРБС — тысячи, книга мониторинга — рубли. Множитель один и
 * взят из pipeline/monitoring-match.ts (THOUSANDS_TO_RUB), второго не заводим.
 */

import { DEPT_COLUMNS, DEPT_HEADER_ROWS, extractProcedureRefs, explainDistortedCode } from '@aemr/shared';
import { THOUSANDS_TO_RUB } from '../pipeline/monitoring-match.js';
import { stemRu, wordsOf } from '../analytics/subject-fuzzy.js';
import { monitoringNumber, monitoringText, round3 } from './cells.js';
import type { MonitoringJournalRow } from './journal.js';
import type { MonitoringProcedure, ProcedureStage } from './procedures.js';

// ── Стороны и допуски ────────────────────────────────────────────────

/** Три независимые записи одной закупки. */
export type TripleSide = 'book' | 'sheet' | 'journal';

/** Подписи сторон для читателя — литературный русский, без ключей. */
export const TRIPLE_SIDE_LABELS: Record<TripleSide, string> = {
  book: 'книга ГРБС',
  sheet: 'лист управления мониторинга',
  journal: 'переходящий реестр «25-26»',
};

/**
 * Допуск сравнения зависит от того, чьи числа сравниваются, и это не
 * придирка, а свойство хранения:
 *  - книга ГРБС держит ТЫСЯЧИ с двумя знаками, то есть её шаг — 10 рублей;
 *    честное «то же число» после перевода единиц расходится на единицы
 *    рублей, поэтому пары с участием книги терпят 10 рублей;
 *  - лист управления и переходящий реестр — ОДНА книга и одна величина в
 *    рублях с копейками: расхождение в 60 копеек там содержательно (живой
 *    пример ЭА391-25), а 0,001 — след округления. Относительный порог к этой
 *    паре не применяется вовсе, иначе он проглотит тысячи рублей.
 * Относительный порог 1 % работает только там, где в паре участвует книга
 * ГРБС: у неё другая единица и другая семантика графы (канон п.102 — лимит
 * против НМЦК расходится на проценты, а не на копейки).
 */
export const TRIPLE_TOLERANCE = {
  /** Пол допуска, руб., когда в паре участвует книга ГРБС (шаг тысяч). */
  bookAbsoluteRub: 10,
  /** Допуск пары «лист ↔ переходящий реестр», руб. — полкопейки. */
  monitoringAbsoluteRub: 0.005,
  /** Относительный порог для пар с книгой ГРБС, доля (не проценты). */
  relative: 0.01,
} as const;

function toleranceFor(a: TripleSide, b: TripleSide, scale: number): number {
  if (a !== 'book' && b !== 'book') return TRIPLE_TOLERANCE.monitoringAbsoluteRub;
  return Math.max(TRIPLE_TOLERANCE.bookAbsoluteRub, Math.abs(scale) * TRIPLE_TOLERANCE.relative);
}

// ── Входные стороны ──────────────────────────────────────────────────

/** Строка книги ГРБС: план закупок управления, деньги — ТЫСЯЧИ рублей. */
export interface TripleBookRow {
  /** Канонический ид управления продукта («УО», «УЭР»). */
  readonly dept: string;
  /** Имя листа книги — первая половина адреса. */
  readonly sheet: string;
  /** Номер строки листа (1-based, как видит человек в таблице). */
  readonly row: number;
  /** Сырая ячейка AG — номер процедуры, как записана рукой. */
  readonly ag: unknown;
  /** Предмет закупки, колонка G. */
  readonly subject: string | null;
  /**
   * Подведомственное учреждение, колонка C. Канон п.119 требует, чтобы любой
   * сигнал показывал не только ГРБС, но и организацию внутри него: книга УО
   * ведёт десятки школ и садов одной сеткой, и «расхождение в книге УО» без
   * имени учреждения адресует в пустоту.
   */
  readonly subordinate: string | null;
  /** K — «ИТОГО 1» (план), тыс. руб. */
  readonly planTotalThousands: number | null;
  /** Y — «ИТОГО 2» (факт), тыс. руб. */
  readonly factTotalThousands: number | null;
  /** AC — «экономия итого», тыс. руб. */
  readonly economyTotalThousands: number | null;
}

/** Строка книги мониторинга (лист управления либо переходящий реестр). */
export interface TripleMonitoringRow {
  readonly side: 'sheet' | 'journal';
  readonly sheet: string;
  readonly row: number;
  /**
   * Управление, ведущее строку («УО»), и заказчик этой закупки. Нужны там,
   * где стороны книги ГРБС нет вовсе: фильтр по организации обязан работать
   * и по закупке, которая живёт только в книге мониторинга (п.119).
   * dept у переходящего реестра пуст: лист «25-26» общий для района.
   */
  readonly dept: string | null;
  readonly customer: string | null;
  /** Канонический код процедуры; null — код не разобран. */
  readonly code: string | null;
  /** Пояснение нечитаемого кода, если он в ячейке виден, но искажён. */
  readonly codeNote: string | null;
  readonly subject: string;
  /** Начальная (максимальная) цена, руб. */
  readonly nmckRub: number | null;
  /** Цена аукциона (цена победителя), руб.; 0 — торги без результата. */
  readonly priceRub: number | null;
  /** Экономия ВСЕГО, руб. — как записана в книге. */
  readonly savingsRub: number | null;
  /** Стадия пути — для честного разговора о пустой цене победителя. */
  readonly stage: ProcedureStage | null;
  /** Совместная закупка: доли по управлениям против целого в реестре. */
  readonly joint: boolean;
}

// ── Сравнение трёх чисел ─────────────────────────────────────────────

/** Пара сторон и разрыв между ними по одной величине. */
export interface TriplePair {
  readonly a: TripleSide;
  readonly b: TripleSide;
  /** a − b, руб.; null — одной из сторон нет. */
  readonly deltaRub: number | null;
  /** Допуск этой пары, руб. — показывается рядом с разрывом. */
  readonly toleranceRub: number | null;
  /** |Δ| ≤ допуска; null — сравнивать нечего. */
  readonly agrees: boolean | null;
}

/** Одна величина закупки, увиденная тремя сторонами. */
export interface TripleMoney {
  readonly bookRub: number | null;
  readonly sheetRub: number | null;
  readonly journalRub: number | null;
  /** Стороны, у которых число есть, — «честная пустота» видна списком. */
  readonly sidesPresent: readonly TripleSide[];
  readonly pairs: readonly TriplePair[];
  /** Наибольший разрыв между заполненными сторонами, руб.; null — нет пар. */
  readonly maxAbsDeltaRub: number | null;
  /** Все сравнимые пары согласны; null — сравнивать нечего (сторон < 2). */
  readonly agrees: boolean | null;
  /**
   * Сторона-одиночка, если две другие согласны между собой, а она — нет:
   * это и есть ответ «кто отстал», ради которого заводилась третья запись.
   * null — либо всё согласно, либо расходятся все трое, либо сторон меньше трёх.
   */
  readonly outlier: TripleSide | null;
}

const SIDE_ORDER: readonly TripleSide[] = ['book', 'sheet', 'journal'];

/** Свести три числа одной величины в сравнение с попарными разрывами. */
export function compareTriple(
  bookRub: number | null,
  sheetRub: number | null,
  journalRub: number | null,
): TripleMoney {
  const values: Record<TripleSide, number | null> = {
    book: bookRub, sheet: sheetRub, journal: journalRub,
  };
  const sidesPresent = SIDE_ORDER.filter((s) => values[s] !== null);
  const pairs: TriplePair[] = [];
  for (let i = 0; i < SIDE_ORDER.length; i++) {
    for (let j = i + 1; j < SIDE_ORDER.length; j++) {
      const a = SIDE_ORDER[i];
      const b = SIDE_ORDER[j];
      const av = values[a];
      const bv = values[b];
      if (av === null || bv === null) {
        pairs.push({ a, b, deltaRub: null, toleranceRub: null, agrees: null });
        continue;
      }
      const deltaRub = round3(av - bv);
      const toleranceRub = round3(toleranceFor(a, b, Math.max(Math.abs(av), Math.abs(bv))));
      pairs.push({ a, b, deltaRub, toleranceRub, agrees: Math.abs(deltaRub) <= toleranceRub });
    }
  }

  const comparable = pairs.filter((p) => p.agrees !== null);
  const maxAbsDeltaRub = comparable.length === 0
    ? null
    : round3(Math.max(...comparable.map((p) => Math.abs(p.deltaRub as number))));
  const agrees = comparable.length === 0 ? null : comparable.every((p) => p.agrees === true);

  // Одиночка: три стороны на месте, ровно одна пара согласна — значит две
  // её стороны держат одно число, а третья отстала.
  let outlier: TripleSide | null = null;
  if (sidesPresent.length === 3) {
    const agreed = pairs.filter((p) => p.agrees === true);
    if (agreed.length === 1) {
      outlier = SIDE_ORDER.find((s) => s !== agreed[0].a && s !== agreed[0].b) ?? null;
    }
  }

  return {
    bookRub, sheetRub, journalRub,
    sidesPresent, pairs, maxAbsDeltaRub, agrees, outlier,
  };
}

// ── Предмет как второй ключ ──────────────────────────────────────────

/**
 * Слова предмета к сравнимому виду: регистр, ё, пунктуация, предлоги — и
 * ОСНОВА слова вместо самого слова.
 *
 * Без основы сравнение читает падеж как разные закупки: книга ГРБС пишет
 * «Фрукты, овощи», книга мониторинга — «Поставка Овощей и Фруктов свежих»,
 * и точное совпадение слов даёт ноль общих при полном совпадении смысла.
 * На живых дампах 21.08 наивное сравнение объявило разными предметами 74
 * закупки из 328 — почти каждую четвёртую, то есть класс был бесполезен.
 * Стрижка окончаний берётся из analytics/subject-fuzzy.ts: второго словаря
 * русских окончаний в продукте не заводим.
 */
export function subjectTokens(text: string | null | undefined): Set<string> {
  if (text === null || text === undefined) return new Set();
  return new Set(wordsOf(text).map(stemRu));
}

/**
 * Схожесть предметов, 0…1 — доля общих слов от меньшего набора (вложение,
 * не Жаккар): книга ГРБС пишет предмет короче, мониторинг — подробнее, и
 * короткая формулировка, целиком лежащая внутри длинной, — та же закупка.
 */
export function subjectSimilarity(a: string | null, b: string | null): number | null {
  const ta = subjectTokens(a);
  const tb = subjectTokens(b);
  if (ta.size === 0 || tb.size === 0) return null;
  let common = 0;
  for (const w of ta) if (tb.has(w)) common += 1;
  return common / Math.min(ta.size, tb.size);
}

/** Ниже этого — предметы считаются разными и расхождение называется вслух. */
export const SUBJECT_MATCH_THRESHOLD = 0.5;

// ── Классы расхождений ───────────────────────────────────────────────

/**
 * Закрытый словарь исходов тройной сверки (канон: один сигнал — один дом;
 * проблемы связки — отдельный класс, а не свободный текст).
 */
export type TripleFindingKind =
  /** Код стоит в книге ГРБС, книга мониторинга такой процедуры не знает. */
  | 'no-pair-in-monitoring'
  /** Процедура ведётся в мониторинге, строки книги ГРБС на неё нет. */
  | 'no-pair-in-books'
  /** Закупка есть в книге и на листе управления, в переходящий реестр не внесена. */
  | 'no-journal-record'
  /** Закупка есть в переходящем реестре, на лист управления не перенесена. */
  | 'no-sheet-record'
  /** Начальные цены сторон разошлись. */
  | 'plan-differs'
  /** Факт книги и цена победителя разошлись. */
  | 'fact-differs'
  /** Экономия сторон разошлась. */
  | 'savings-differ'
  /** Экономия не равна разности «начальная цена минус цена победителя». */
  | 'savings-not-difference'
  /** Торги прошли (или книга ГРБС уже показала факт), цена победителя пуста. */
  | 'winner-price-missing'
  /** Код набран с опечаткой — пара по нему не строится. */
  | 'code-distorted'
  /**
   * Код совпал, а предметы сторон описаны по-разному. Это ПОВОД ПЕРЕЧИТАТЬ,
   * а не доказательство: доля общих основ слов не отличает другую закупку
   * под тем же кодом от той же закупки, названной иначе (живой пример —
   * «Разработка ПСД» в книге против «Разработка проектно-сметной
   * документации (ПСД)» в мониторинге).
   */
  | 'subject-mismatch'
  /** Код дважды в одной книге ГРБС — аномалия заполнения. */
  | 'duplicate-in-book'
  /** Один код в разных книгах — штатные доли совместной закупки, не аномалия. */
  | 'joint-shares'
  /** Один код дважды на одном листе книги мониторинга — повтор строки. */
  | 'duplicate-in-monitoring';

/** Подписи классов — заголовок карточки, литературный русский без упрёка. */
export const TRIPLE_FINDING_LABELS: Record<TripleFindingKind, string> = {
  'no-pair-in-monitoring': 'Нет пары в книге мониторинга',
  'no-pair-in-books': 'Нет строки в книгах ГРБС',
  'no-journal-record': 'Нет записи в переходящем реестре',
  'no-sheet-record': 'Не перенесена на лист управления',
  'plan-differs': 'Начальные цены разошлись',
  'fact-differs': 'Факт и цена победителя разошлись',
  'savings-differ': 'Экономия разошлась',
  'savings-not-difference': 'Экономия не равна разности',
  'winner-price-missing': 'Цена победителя не проставлена',
  'code-distorted': 'Код процедуры с опечаткой',
  'subject-mismatch': 'Предметы сторон описаны по-разному',
  'duplicate-in-book': 'Код дважды в одной книге',
  'joint-shares': 'Доли совместной закупки',
  'duplicate-in-monitoring': 'Код дважды на одном листе мониторинга',
};

/**
 * Расхождение с ответом на вопрос «какая строка, что в ней, почему» (п.119).
 * Адрес есть всегда: карточка без адреса бесполезна (п.53).
 */
export interface TripleFinding {
  readonly kind: TripleFindingKind;
  /** Код процедуры либо null — расхождение как раз в том, что кода нет. */
  readonly code: string | null;
  /** Адреса всех сторон, участвующих в расхождении: «8. УО!C41», «УО!K412». */
  readonly addresses: readonly string[];
  /** Размер расхождения, руб.; null — расхождение не про числа. */
  readonly deltaRub: number | null;
  /** Что именно и почему — одной фразой без обвинения (п.104). */
  readonly note: string;
  /** Правда ли это ошибка: доли совместной закупки — форма, а не ошибка. */
  readonly expected: boolean;
}

// ── Строка тройной сверки ────────────────────────────────────────────

/** Одна закупка, увиденная тремя сторонами. */
export interface TripleRow {
  readonly code: string;
  /** Предмет — берётся у самой подробной стороны (обычно мониторинг). */
  readonly subject: string;
  readonly bookRows: readonly TripleBookRow[];
  readonly sheetRows: readonly TripleMonitoringRow[];
  readonly journalRows: readonly TripleMonitoringRow[];
  /** Начальная цена: K книги ↔ НМЦК листа ↔ НМЦК реестра. */
  readonly plan: TripleMoney;
  /** Факт: Y книги ↔ цена победителя листа ↔ цена реестра. */
  readonly fact: TripleMoney;
  /** Экономия: AC книги ↔ ВСЕГО листа ↔ ВСЕГО реестра. */
  readonly savings: TripleMoney;
  /** Схожесть предметов книги и мониторинга, 0…1; null — одна сторона пуста. */
  readonly subjectSimilarity: number | null;
  /**
   * Управления и учреждения, названные ЛЮБОЙ из трёх сторон, — периметр
   * строки для фильтров экрана (п.119: фильтры изолируют организации).
   * Собирается со всех сторон, а не с одной книги ГРБС: закупка, которой в
   * книге ещё нет, обязана оставаться отфильтровываемой по своему заказчику.
   * Имена сторон не сводятся к одному написанию — расхождение написаний это
   * отдельная работа справочника (канон п.96), и молча его прятать нельзя.
   */
  readonly departments: readonly string[];
  readonly subordinates: readonly string[];
  readonly findings: readonly TripleFinding[];
}

/** Строка, чей код не разобрался: пара предложена по предмету, не применена. */
export interface TripleOrphan {
  readonly side: TripleSide;
  readonly address: string;
  readonly text: string;
  /** Каноническая догадка кода — показывается, мост по ней не строится. */
  readonly guess: string | null;
  readonly note: string;
  /** Кандидат-пара по предмету: код и схожесть; null — похожего не нашлось. */
  readonly subjectCandidate: { readonly code: string; readonly similarity: number } | null;
}

/** Счётчики к шапке экрана — по одному числу на класс. */
export interface TripleSummary {
  readonly codesTotal: number;
  /** Закупок, где все три записи на месте. */
  readonly allThreeSides: number;
  /** Закупок с двумя сторонами и с одной. */
  readonly twoSides: number;
  readonly oneSide: number;
  /** Закупок без единого расхождения — «сверка чиста». */
  readonly clean: number;
  readonly byKind: Record<TripleFindingKind, number>;
}

/** Полный результат тройной сверки. */
export interface TripleCheckResult {
  /** Момент чтения снимков — у каждого числа виден источник и момент. */
  readonly readAt: string | null;
  readonly rows: readonly TripleRow[];
  readonly orphans: readonly TripleOrphan[];
  readonly summary: TripleSummary;
}

// ── Переходники от продуктовых разборов ──────────────────────────────

/**
 * Строки книг ГРБС как сторона тройной сверки.
 *
 * Вход — строки листов книг БЕЗ шапки (как отдаёт collectRowsByDept), ключ —
 * короткое имя книги. Шапка книги ГРБС — три строки, поэтому номер строки
 * листа = индекс + DEPT_HEADER_ROWS + 1: адрес обязан совпадать с тем, что
 * человек видит в таблице (п.53).
 */
export function bookSide(
  rowsByDept: Readonly<Record<string, unknown[][]>>,
  sheetNameByDept: Readonly<Record<string, string>> = {},
): TripleBookRow[] {
  const out: TripleBookRow[] = [];
  for (const [dept, rows] of Object.entries(rowsByDept)) {
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i] ?? [];
      const ag = row[DEPT_COLUMNS.COMMENT_UER];
      if (ag === null || ag === undefined || String(ag).trim() === '') continue;
      out.push({
        dept,
        sheet: sheetNameByDept[dept] ?? dept,
        row: i + DEPT_HEADER_ROWS + 1,
        ag,
        subject: monitoringText(row[DEPT_COLUMNS.SUBJECT]),
        subordinate: monitoringText(row[DEPT_COLUMNS.SUBORDINATE]),
        planTotalThousands: monitoringNumber(row[DEPT_COLUMNS.TOTAL_PLAN]),
        factTotalThousands: monitoringNumber(row[DEPT_COLUMNS.TOTAL_FACT]),
        economyTotalThousands: monitoringNumber(row[DEPT_COLUMNS.ECONOMY_TOTAL]),
      });
    }
  }
  return out;
}

/** Строки листов управлений мониторинга как сторона тройной сверки. */
export function sheetSide(procedures: readonly MonitoringProcedure[]): TripleMonitoringRow[] {
  return procedures.map((p) => ({
    side: 'sheet' as const,
    sheet: p.sheet,
    row: p.row,
    dept: p.dept,
    customer: monitoringText(p.customer),
    code: p.code,
    codeNote: p.codeNote,
    subject: p.subject,
    nmckRub: p.nmck,
    priceRub: p.auctionPrice,
    savingsRub: p.savingsTotal,
    stage: p.stage,
    joint: p.joint,
  }));
}

/** Строки переходящего реестра «25-26» как сторона тройной сверки. */
export function journalSide(rows: readonly MonitoringJournalRow[]): TripleMonitoringRow[] {
  return rows.map((j) => ({
    side: 'journal' as const,
    sheet: j.sheet,
    row: j.row,
    dept: null,
    customer: monitoringText(j.customer),
    code: j.code,
    codeNote: null,
    subject: j.subject,
    nmckRub: j.nmck,
    priceRub: j.price,
    savingsRub: j.savings,
    stage: null,
    joint: /совместн/iu.test(j.customer),
  }));
}

// ── Сама сверка ──────────────────────────────────────────────────────

function address(sheet: string, row: number, column: string): string {
  return `${sheet}!${column}${row}`;
}

function sumOrNull(values: ReadonlyArray<number | null>): number | null {
  const present = values.filter((v): v is number => v !== null);
  return present.length === 0 ? null : round3(present.reduce((a, b) => a + b, 0));
}

function money(v: number | null): string {
  return v === null ? 'пусто' : v.toLocaleString('ru-RU', { maximumFractionDigits: 2 });
}

/** Фраза «сторона A — столько, сторона B — столько» для карточки. */
function sidesPhrase(m: TripleMoney): string {
  return SIDE_ORDER
    .map((s) => `${TRIPLE_SIDE_LABELS[s]} — ${money(s === 'book' ? m.bookRub : s === 'sheet' ? m.sheetRub : m.journalRub)}`)
    .join('; ');
}

interface TripleInput {
  readonly bookRows: readonly TripleBookRow[];
  readonly sheetRows: readonly TripleMonitoringRow[];
  readonly journalRows: readonly TripleMonitoringRow[];
  /** Момент чтения снимков (ISO) — едет в ответ и на экран. */
  readonly readAt?: string | null;
}

/**
 * Тройная сверка: каждая закупка собирается из трёх записей по коду,
 * три величины сравниваются попарно, расхождения называются классами.
 */
export function tripleCheck(input: TripleInput): TripleCheckResult {
  const { bookRows, sheetRows, journalRows } = input;

  // ── Раскладка сторон по каноническим кодам ────────────────────────
  const books = new Map<string, TripleBookRow[]>();
  const orphans: TripleOrphan[] = [];
  for (const row of bookRows) {
    const refs = extractProcedureRefs(row.ag);
    if (refs.length === 0) {
      const raw = row.ag === null || row.ag === undefined ? '' : String(row.ag).trim();
      if (raw === '') continue;
      const distorted = explainDistortedCode(raw);
      if (distorted === null) continue; // Кода в ячейке не видно вовсе — не сирота сверки.
      orphans.push({
        side: 'book',
        address: address(row.dept, row.row, 'AG'),
        text: raw.slice(0, 120),
        guess: distorted.guess,
        note: `В книге записано «${distorted.raw}» — похоже на ${distorted.guess} (${distorted.note}). Пока код не исправлен, тройная сверка по этой строке не строится.`,
        subjectCandidate: null,
      });
      continue;
    }
    // Список кодов в одной ячейке (школьные перечни УО): строка заявляет
    // себя на каждую процедуру списка, но её K — сумма по списку, поэтому
    // в парную сверку сумм такие строки не идут (см. фильтр ниже).
    for (const ref of refs) {
      const bucket = books.get(ref.code);
      if (bucket === undefined) books.set(ref.code, [row]);
      else bucket.push(row);
    }
  }

  const listCellRows = new Set(
    bookRows.filter((r) => extractProcedureRefs(r.ag).length > 1),
  );

  const sheets = new Map<string, TripleMonitoringRow[]>();
  const journal = new Map<string, TripleMonitoringRow[]>();
  for (const [source, target] of [[sheetRows, sheets], [journalRows, journal]] as const) {
    for (const row of source) {
      if (row.code === null) {
        if (row.codeNote === null) continue;
        const distorted = explainDistortedCode(row.subject);
        orphans.push({
          side: row.side,
          address: address(row.sheet, row.row, 'C'),
          text: row.subject.slice(0, 120),
          guess: distorted?.guess ?? null,
          note: row.codeNote,
          subjectCandidate: null,
        });
        continue;
      }
      const bucket = target.get(row.code);
      if (bucket === undefined) target.set(row.code, [row]);
      else bucket.push(row);
    }
  }

  // ── Кандидат по предмету для строк с искажённым кодом ─────────────
  const subjectIndex: Array<{ code: string; subject: string }> = [];
  for (const [code, rows] of sheets) subjectIndex.push({ code, subject: rows[0].subject });
  for (const [code, rows] of journal) {
    if (!sheets.has(code)) subjectIndex.push({ code, subject: rows[0].subject });
  }
  const withCandidates: TripleOrphan[] = orphans.map((o) => {
    let best: { code: string; similarity: number } | null = null;
    for (const entry of subjectIndex) {
      const sim = subjectSimilarity(o.text, entry.subject);
      if (sim === null || sim < SUBJECT_MATCH_THRESHOLD) continue;
      if (best === null || sim > best.similarity) best = { code: entry.code, similarity: round3(sim) };
    }
    return { ...o, subjectCandidate: best };
  });

  // ── Сборка строк сверки ───────────────────────────────────────────
  const codes = new Set<string>([...books.keys(), ...sheets.keys(), ...journal.keys()]);
  const rows: TripleRow[] = [];
  const byKind = Object.fromEntries(
    (Object.keys(TRIPLE_FINDING_LABELS) as TripleFindingKind[]).map((k) => [k, 0]),
  ) as Record<TripleFindingKind, number>;
  let allThree = 0;
  let two = 0;
  let one = 0;
  let clean = 0;

  for (const code of [...codes].sort((a, b) => a.localeCompare(b, 'ru'))) {
    const bookBucket = books.get(code) ?? [];
    const sheetBucket = sheets.get(code) ?? [];
    const journalBucket = journal.get(code) ?? [];
    const findings: TripleFinding[] = [];

    // Дубль внутри одной книги против долей совместной закупки: у долей
    // складывать стороны правильно (доли против целого), у дубля — нет.
    // Пока дубль не разобран, на вопрос «какую K сверять?» ответа не
    // существует, и продукт не выдумывает его сложением (п.36).
    const bookDepts = new Set(bookBucket.map((r) => r.dept));
    // Повтор ВНУТРИ одной книги — аномалия заполнения: сложить две строки
    // значило бы выдумать ответ. Один код в РАЗНЫХ книгах — доли: их сумма
    // и есть закупка целиком, поэтому доли складываются.
    const duplicateInBook = bookBucket.length > 1 && bookDepts.size < bookBucket.length;
    const crossBooks = bookBucket.length > 1 && !duplicateInBook;
    const jointMarker = sheetBucket.some((r) => r.joint)
      || journalBucket.some((r) => r.joint)
      || code.startsWith('ЭАС');

    // То же на стороне мониторинга: две строки с одним кодом на РАЗНЫХ листах
    // управлений — доли (складываются), две строки на ОДНОМ листе — повтор,
    // и сложить их значило бы удвоить закупку (живой пример ЭА166-26: сумма
    // листа ровно вдвое больше книги и переходящего реестра).
    const repeatedSheet = (rows: readonly TripleMonitoringRow[]): boolean =>
      new Set(rows.map((r) => r.sheet)).size < rows.length;
    const duplicateOnSheet = repeatedSheet(sheetBucket);
    const duplicateInJournal = journalBucket.length > 1;

    // Строки-перечни в сумму не идут: их K — сумма по нескольким процедурам.
    const bookForSums = duplicateInBook ? [] : bookBucket.filter((r) => !listCellRows.has(r));
    const bookPlan = sumOrNull(bookForSums.map((r) => r.planTotalThousands));
    const bookFact = sumOrNull(bookForSums.map((r) => r.factTotalThousands));
    const bookEcon = sumOrNull(bookForSums.map((r) => r.economyTotalThousands));
    const toRub = (v: number | null): number | null => (v === null ? null : round3(v * THOUSANDS_TO_RUB));

    const sheetForSums = duplicateOnSheet ? [] : sheetBucket;
    const journalForSums = duplicateInJournal ? [] : journalBucket;

    const plan = compareTriple(
      toRub(bookPlan),
      sumOrNull(sheetForSums.map((r) => r.nmckRub)),
      sumOrNull(journalForSums.map((r) => r.nmckRub)),
    );
    const fact = compareTriple(
      toRub(bookFact),
      sumOrNull(sheetForSums.map((r) => r.priceRub)),
      sumOrNull(journalForSums.map((r) => r.priceRub)),
    );
    const savings = compareTriple(
      toRub(bookEcon),
      sumOrNull(sheetForSums.map((r) => r.savingsRub)),
      sumOrNull(journalForSums.map((r) => r.savingsRub)),
    );

    const allAddresses = [
      ...bookBucket.map((r) => address(r.dept, r.row, 'K')),
      ...sheetBucket.map((r) => address(r.sheet, r.row, 'D')),
      ...journalBucket.map((r) => address(r.sheet, r.row, 'D')),
    ];

    // 1. Нет пары.
    if (bookBucket.length === 0 && (sheetBucket.length > 0 || journalBucket.length > 0)) {
      findings.push({
        kind: 'no-pair-in-books',
        code,
        addresses: allAddresses,
        deltaRub: null,
        note: 'Процедура ведётся в книге мониторинга, а строки плана закупок с этим номером ни в одной книге ГРБС нет: либо номер в книгу ГРБС ещё не проставлен, либо закупка идёт мимо плана.',
        expected: false,
      });
    }
    if (bookBucket.length > 0 && sheetBucket.length === 0 && journalBucket.length === 0) {
      findings.push({
        kind: 'no-pair-in-monitoring',
        code,
        addresses: allAddresses,
        deltaRub: null,
        note: 'Номер процедуры стоит в книге ГРБС, а книга мониторинга такой процедуры не знает: либо номер записан не тот, либо строка мониторинга ещё не заведена.',
        expected: false,
      });
    }
    if (sheetBucket.length > 0 && journalBucket.length === 0) {
      findings.push({
        kind: 'no-journal-record',
        code,
        addresses: allAddresses,
        deltaRub: null,
        note: 'Закупка ведётся на листе управления, в переходящий реестр «25-26» её ещё не внесли — родословная переобъявлений по ней не строится.',
        expected: false,
      });
    }
    if (journalBucket.length > 0 && sheetBucket.length === 0) {
      findings.push({
        kind: 'no-sheet-record',
        code,
        addresses: allAddresses,
        deltaRub: null,
        note: 'Закупка записана в переходящем реестре «25-26», а на лист своего управления не перенесена.',
        expected: false,
      });
    }

    // 2. Дубли и доли.
    if (duplicateInBook) {
      // Продукт не выбирает правую строку, но называет ту, что совпадает с
      // двумя другими записями: это ответ на вопрос «почему», а не приговор.
      const monitoringPlan = sumOrNull(sheetBucket.map((r) => r.nmckRub))
        ?? sumOrNull(journalBucket.map((r) => r.nmckRub));
      const agreeing = monitoringPlan === null ? [] : bookBucket.filter(
        (r) => r.planTotalThousands !== null
          && Math.abs(r.planTotalThousands * THOUSANDS_TO_RUB - monitoringPlan) <= TRIPLE_TOLERANCE.bookAbsoluteRub,
      );
      const hint = agreeing.length === 1
        ? ` С начальной ценой мониторинга (${money(monitoringPlan)} руб.) сходится строка ${agreeing[0].row}; остальные — нет.`
        : '';
      findings.push({
        kind: 'duplicate-in-book',
        code,
        addresses: bookBucket.map((r) => address(r.dept, r.row, 'AG')),
        deltaRub: null,
        note: `Один номер процедуры стоит в ${bookBucket.length} строках плана книги ${[...bookDepts].join(', ')}; какую из них сверять с мониторингом — неизвестно, поэтому суммы книги в сравнение не идут, пока дубль не разобран.${hint}`,
        expected: false,
      });
    }
    if (duplicateOnSheet || duplicateInJournal) {
      const rows = [
        ...(duplicateOnSheet ? sheetBucket : []),
        ...(duplicateInJournal ? journalBucket : []),
      ];
      findings.push({
        kind: 'duplicate-in-monitoring',
        code,
        addresses: rows.map((r) => address(r.sheet, r.row, 'C')),
        deltaRub: null,
        note: `Один номер процедуры записан ${rows.length} строками одного листа книги мониторинга. Сложить их значило бы удвоить закупку, поэтому эта сторона в сравнение сумм не идёт, пока повтор не разобран.`,
        expected: false,
      });
    }
    if (crossBooks) {
      findings.push({
        kind: 'joint-shares',
        code,
        addresses: bookBucket.map((r) => address(r.dept, r.row, 'AG')),
        deltaRub: null,
        note: jointMarker
          ? `Совместная закупка: каждое из ${bookDepts.size} управлений (${[...bookDepts].join(', ')}) ведёт свою долю, поэтому одна процедура стоит в нескольких книгах — это форма, а не ошибка. Суммы сторон сравниваются как доли против целого.`
          : `Один номер процедуры стоит в книгах ${[...bookDepts].join(', ')}, а признака совместной закупки ни на листе управления, ни в переходящем реестре нет: либо пометку не поставили, либо номер попал в чужую книгу. Доли сложены — если это не совместная закупка, сравнение сумм неверно.`,
        expected: jointMarker,
      });
    }

    // 3. Расхождение сумм по трём величинам.
    const pushMoney = (kind: TripleFindingKind, m: TripleMoney, what: string): void => {
      if (m.agrees !== false) return;
      const outlierPhrase = m.outlier === null
        ? 'какая запись верна — решение человека'
        : `две записи из трёх держат одно число, отстала одна: ${TRIPLE_SIDE_LABELS[m.outlier]}`;
      findings.push({
        kind,
        code,
        addresses: allAddresses,
        deltaRub: m.maxAbsDeltaRub,
        note: `${what}: ${sidesPhrase(m)}. Наибольший разрыв — ${money(m.maxAbsDeltaRub)} руб., ${outlierPhrase}.`,
        expected: false,
      });
    };
    pushMoney('plan-differs', plan, 'Начальная цена записана по-разному');
    pushMoney('fact-differs', fact, 'Факт закупки и цена победителя не совпадают');
    pushMoney('savings-differ', savings, 'Экономия записана по-разному');

    // 4. Экономия против разности «начальная цена минус цена победителя».
    for (const row of [...sheetBucket, ...journalBucket]) {
      if (row.nmckRub === null || row.priceRub === null || row.savingsRub === null) continue;
      if (row.priceRub === 0) continue; // Торги без результата: экономии нет по определению.
      const expectedSavings = round3(row.nmckRub - row.priceRub);
      const delta = round3(row.savingsRub - expectedSavings);
      if (Math.abs(delta) <= TRIPLE_TOLERANCE.monitoringAbsoluteRub) continue;
      findings.push({
        kind: 'savings-not-difference',
        code,
        addresses: [address(row.sheet, row.row, 'J')],
        deltaRub: delta,
        note: `Экономия записана как ${money(row.savingsRub)} руб., а разность «начальная цена минус цена победителя» даёт ${money(expectedSavings)} руб.: расхождение ${money(delta)} руб. Экономию в этой строке внесли рукой, а не пересчётом.`,
        expected: false,
      });
    }

    // 5. Цена победителя не проставлена.
    for (const row of [...sheetBucket, ...journalBucket]) {
      if (row.priceRub !== null) continue;
      const bookHasFact = bookFact !== null && bookFact > 0;
      if (!bookHasFact && row.stage !== 'bidding') continue;
      findings.push({
        kind: 'winner-price-missing',
        code,
        addresses: [address(row.sheet, row.row, 'I')],
        deltaRub: null,
        note: bookHasFact
          ? `В книге ГРБС по этой закупке уже стоит факт ${money(toRub(bookFact))} руб., а цена победителя в книге мониторинга пуста: итог торгов не внесён.`
          : 'Дата торгов стоит, а цена победителя пуста: итог торгов не внесён.',
        expected: false,
      });
    }

    // 6. Предмет как второй ключ.
    const monitoringSubject = sheetBucket[0]?.subject ?? journalBucket[0]?.subject ?? '';
    const bookSubject = bookBucket[0]?.subject ?? null;
    const similarity = subjectSimilarity(bookSubject, monitoringSubject);
    if (similarity !== null && similarity < SUBJECT_MATCH_THRESHOLD) {
      findings.push({
        kind: 'subject-mismatch',
        code,
        addresses: [
          ...bookBucket.slice(0, 1).map((r) => address(r.dept, r.row, 'G')),
          ...sheetBucket.slice(0, 1).map((r) => address(r.sheet, r.row, 'C')),
        ],
        deltaRub: null,
        note: `Номер процедуры один, а предмет описан по-разному: в книге ГРБС — «${(bookSubject ?? '').slice(0, 80)}», в книге мониторинга — «${monitoringSubject.slice(0, 80)}». Общих основ слов ${Math.round(similarity * 100)} %. Это повод перечитать строку, а не приговор: так же выглядит и другая закупка под тем же номером, и та же закупка, названная сокращённо.`,
        expected: false,
      });
    }

    for (const f of findings) byKind[f.kind] += 1;
    const sidesCount = (bookBucket.length > 0 ? 1 : 0)
      + (sheetBucket.length > 0 ? 1 : 0)
      + (journalBucket.length > 0 ? 1 : 0);
    if (sidesCount === 3) allThree += 1;
    else if (sidesCount === 2) two += 1;
    else one += 1;
    if (findings.every((f) => f.expected)) clean += 1;

    rows.push({
      code,
      subject: monitoringSubject !== '' ? monitoringSubject : (bookSubject ?? ''),
      bookRows: bookBucket,
      sheetRows: sheetBucket,
      journalRows: journalBucket,
      plan, fact, savings,
      subjectSimilarity: similarity === null ? null : round3(similarity),
      departments: [...new Set([
        ...bookBucket.map((r) => r.dept),
        ...sheetBucket.map((r) => r.dept).filter((v): v is string => v !== null),
      ])].sort((a, b) => a.localeCompare(b, 'ru')),
      subordinates: [...new Set([
        ...bookBucket.map((r) => r.subordinate),
        ...sheetBucket.map((r) => r.customer),
        ...journalBucket.map((r) => r.customer),
      ].filter((v): v is string => v !== null))].sort((a, b) => a.localeCompare(b, 'ru')),
      findings,
    });
  }

  byKind['code-distorted'] = withCandidates.length;

  return {
    readAt: input.readAt ?? null,
    rows,
    orphans: withCandidates,
    summary: {
      codesTotal: rows.length,
      allThreeSides: allThree,
      twoSides: two,
      oneSide: one,
      clean,
      byKind,
    },
  };
}
