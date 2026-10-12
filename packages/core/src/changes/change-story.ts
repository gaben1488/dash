/**
 * change-story.ts — ОДИН рассказ о том, что изменилось, из трёх разных
 * источников (требование владельца 21.08.2026: «журнал изменений, в котором
 * можно было бы и кратко, и вместе с тем подробно, необходимо и достаточно
 * увидеть, что именно поменялось»).
 *
 * ТРИ ИСТОЧНИКА И ПОЧЕМУ ИХ НЕЛЬЗЯ ПОКАЗЫВАТЬ ПОРОЗНЬ.
 *
 *   (1) ЖУРНАЛ ПРАВОК КНИГИ — скрытый лист «_ChangeLog», который ведёт скрипт
 *       источника. Знает автора, момент, адрес ячейки, было и стало. Не знает
 *       ничего об удалении строки: строка, убранная через меню таблицы, не
 *       порождает ни одной правки ячейки (замер 18.08.2026 — у УКСиМП 3 702
 *       записи журнала и НОЛЬ удалений).
 *
 *   (2) ЖИВОЙ ПОТОК — события, которые сервер шлёт экрану, пока он открыт.
 *       Знает то же, что журнал, но только про «прямо сейчас»: закрыли
 *       вкладку — поток начался заново.
 *
 *   (3) СРАВНЕНИЕ СНИМКОВ (analytics/vanished-rows.ts) — единственный, кто
 *       видит ИСЧЕЗНОВЕНИЕ закупки. Зато не знает ни автора, ни момента:
 *       «между двумя недельными контрольными срезами закупки не стало».
 *
 * Порознь они дают три неполных ответа, и читателю приходится самому
 * догадываться, что «правок нет» из первого источника и «строка исчезла» из
 * третьего — про одну и ту же книгу. Здесь они сводятся в один список записей
 * с ОДНИМ адресом и одной шкалой времени, и каждая запись помнит, откуда она
 * (`origin`), — чтобы разная полнота источников была видна, а не спрятана.
 *
 * АДРЕС — ПО № П/П (канон п.98б). Позиционный номер строки листа устаревает:
 * вставили строку выше — и «строка 155» сегодня уже другая закупка. Поэтому
 * ведущий адрес записи — № п/п из колонки A, а номер строки листа идёт вторым
 * и только как подсказка. Журнал шестиколоночной схемы (УАГЗО) поля «Строка»
 * не имеет вовсе — такие записи получают `rowSeq: null` и попадают в пробелы
 * рассказа названными, а не выведенными из номера строки наугад.
 *
 * ЧЕСТНАЯ ПУСТОТА (канон п.53, п.58). «Правок не было» и «журнал не прочитан»
 * — разные ответы, и модуль их различает полем `emptiness`. Книга, чей журнал
 * не ответил, называется по имени в `gaps`, а не растворяется в тишине.
 */

import { COL_LETTER_INDEX, DEPT_COLUMNS, DEPT_HEADER_LABELS } from '@aemr/shared';
import {
  parseJournalInstant,
  parseJournalRowKey,
  type JournalRecord,
} from '../provenance/plan-provenance.js';
import type { RowDiff } from '../analytics/vanished-rows.js';

// ── Роды правок ───────────────────────────────────────────────────────

/**
 * Род правки — то, чем читатель отвечает на вопрос «что именно поменялось».
 * Словарь закрытый и короткий намеренно: начальница управления мыслит не
 * колонками книги, а деньгами, сроками и перепиской.
 */
export type ChangeKind =
  /** Любая денежная колонка: план, факт, экономия по любому бюджету. */
  | 'money'
  /** Дата, квартал, год, отклонение в днях — всё, что про срок. */
  | 'dates'
  /** Комментарии ГРБС/УЭР/УФБП, обоснование, причина отклонения, причина ЕП. */
  | 'comment'
  /** Способ определения поставщика. */
  | 'method'
  /** Предмет, учреждение, программа, подпрограмма, вид деятельности, № п/п. */
  | 'subject'
  /** Признак «учитывать в расчёте экономии». */
  | 'flag'
  /** Закупка появилась: пустая строка заполнена либо её нет в прежнем снимке. */
  | 'row-added'
  /** Закупка исчезла — видно ТОЛЬКО сравнением снимков. */
  | 'row-vanished'
  /** Вероятная перенумерация: подтверждена только предметная схожесть. */
  | 'row-identity-candidate'
  /** Строка осталась, но её ячейки обнулили. Это не удаление. */
  | 'row-cleared'
  /** Колонка вне канона шапки — род не назначаем, а признаём незнание. */
  | 'other';

/** Подписи родов — единственный дом формулировок для экрана. */
export const CHANGE_KIND_LABELS: Readonly<Record<ChangeKind, string>> = {
  money: 'Деньги',
  dates: 'Сроки',
  comment: 'Комментарии',
  method: 'Способ закупки',
  subject: 'Предмет и принадлежность',
  flag: 'Признак учёта экономии',
  'row-added': 'Новые закупки',
  'row-vanished': 'Нет прежнего номера',
  'row-identity-candidate': 'Возможная смена номера',
  'row-cleared': 'Очищенные строки',
  other: 'Прочие колонки',
};

/**
 * Порядок родов на экране — от того, что тревожит начальницу сильнее всего,
 * к бытовому. Исчезновение закупки идёт первым: его никто, кроме сравнения
 * снимков, не заметит.
 */
export const CHANGE_KIND_ORDER: readonly ChangeKind[] = [
  'row-vanished', 'row-identity-candidate', 'money', 'dates', 'row-added', 'method', 'comment', 'flag', 'subject', 'other',
];

/** Откуда запись — разная полнота источников не должна быть спрятана. */
export type ChangeOrigin = 'book-journal' | 'live-stream' | 'snapshot-diff';

/** Подписи источников для читателя. */
export const CHANGE_ORIGIN_LABELS: Readonly<Record<ChangeOrigin, string>> = {
  'book-journal': 'журнал правок книги',
  'live-stream': 'прямой эфир',
  'snapshot-diff': 'сравнение снимков',
};

// ── Колонка → род ─────────────────────────────────────────────────────

/** Ключи канона шапки по родам. Второй правды о колонках здесь нет (п.112). */
const KIND_BY_COLUMN_KEY: Readonly<Record<ChangeKind, ReadonlyArray<keyof typeof DEPT_COLUMNS>>> = {
  money: [
    'FB_PLAN', 'KB_PLAN', 'MB_PLAN', 'TOTAL_PLAN',
    'FB_FACT', 'KB_FACT', 'MB_FACT', 'TOTAL_FACT',
    'ECONOMY_FB', 'ECONOMY_KB', 'ECONOMY_MB', 'ECONOMY_TOTAL',
  ],
  dates: ['PLAN_DATE', 'PLAN_QUARTER', 'PLAN_YEAR', 'FACT_DATE', 'FACT_QUARTER', 'FACT_YEAR', 'DEVIATION_DAYS'],
  comment: ['EP_REASON', 'DEVIATION_REASON', 'JUSTIFICATION', 'COMMENT_GRBS', 'COMMENT_UER', 'COMMENT_UFBP'],
  method: ['METHOD'],
  subject: ['ID', 'MANAGEMENT_NAME', 'SUBORDINATE', 'PROGRAM_NAME', 'SUBPROGRAM', 'TYPE', 'SUBJECT'],
  flag: ['FLAG'],
  'row-added': [],
  'row-vanished': [],
  'row-identity-candidate': [],
  'row-cleared': [],
  other: [],
};

/** Индекс колонки → род. Считается один раз, а не на каждую запись. */
const KIND_BY_INDEX = new Map<number, ChangeKind>();
for (const [kind, keys] of Object.entries(KIND_BY_COLUMN_KEY) as Array<[ChangeKind, ReadonlyArray<keyof typeof DEPT_COLUMNS>]>) {
  for (const key of keys) KIND_BY_INDEX.set(DEPT_COLUMNS[key], kind);
}

/**
 * ЧЕЛОВЕЧЕСКИЕ ИМЕНА КОЛОНОК — там, где дословная шапка книги нечитаема.
 *
 * Проверено по живому журналу УКСиМП (дамп 18.08.2026): правка приезжала с
 * подписью «МБ 2», «ИТОГО 1», «Планируемый». Это дословные подписи шапки, и
 * для стража column-map они канон — а для начальницы управления это шифр:
 * «МБ 2» не говорит, что речь о муниципальном бюджете по ФАКТУ, а «ИТОГО 3»
 * не говорит, что это экономия.
 *
 * Здесь не вторая правда о колонках, а ПЕРЕВОД той же карты на русский:
 * индексы берутся из DEPT_COLUMNS, и колонка, которой в этом списке нет,
 * показывается дословной подписью шапки, а не выдумкой.
 */
const HUMAN_COLUMN_NAMES: Readonly<Partial<Record<keyof typeof DEPT_COLUMNS, string>>> = {
  FB_PLAN: 'Федеральный бюджет, план',
  KB_PLAN: 'Краевой бюджет, план',
  MB_PLAN: 'Муниципальный бюджет, план',
  TOTAL_PLAN: 'Итого план',
  FB_FACT: 'Федеральный бюджет, факт',
  KB_FACT: 'Краевой бюджет, факт',
  MB_FACT: 'Муниципальный бюджет, факт',
  TOTAL_FACT: 'Итого факт',
  ECONOMY_FB: 'Экономия, федеральный бюджет',
  ECONOMY_KB: 'Экономия, краевой бюджет',
  ECONOMY_MB: 'Экономия, муниципальный бюджет',
  ECONOMY_TOTAL: 'Экономия, итого',
  PLAN_DATE: 'Плановая дата',
  FACT_DATE: 'Фактическая дата',
  TYPE: 'Вид деятельности',
  SUBJECT: 'Предмет закупки',
  SUBORDINATE: 'Учреждение',
  MANAGEMENT_NAME: 'Управление',
  METHOD: 'Способ определения поставщика',
};

/** Индекс колонки → имя для читателя (перевод там, где шапка нечитаема). */
const LABEL_BY_INDEX = new Map<number, string>();
for (const key of Object.keys(DEPT_COLUMNS) as Array<keyof typeof DEPT_COLUMNS>) {
  LABEL_BY_INDEX.set(DEPT_COLUMNS[key], HUMAN_COLUMN_NAMES[key] ?? DEPT_HEADER_LABELS[key]);
}

/** Буква колонки из адреса ячейки: «AC177» → «AC»; мусор → null. */
export function columnLetterOf(cell: unknown): string | null {
  const m = /^([A-Z]{1,2})\d+$/i.exec(String(cell ?? '').trim());
  return m ? m[1].toUpperCase() : null;
}

/** Номер строки листа из адреса ячейки: «AC177» → 177; мусор → null. */
export function sheetRowOfAddress(cell: unknown): number | null {
  const m = /^[A-Z]{1,2}(\d+)$/i.exec(String(cell ?? '').trim());
  return m ? Number(m[1]) : null;
}

/**
 * Род правки по букве колонки. Буква вне канона шапки даёт «прочее», а не
 * догадку: выдуманный род хуже честного незнания (п.27).
 */
export function changeKindOfColumn(letter: string | null): ChangeKind {
  if (letter === null) return 'other';
  const idx = COL_LETTER_INDEX[letter];
  if (idx === undefined) return 'other';
  return KIND_BY_INDEX.get(idx) ?? 'other';
}

/** Человеческое имя колонки по букве. Вне канона — null, не выдумка. */
export function columnLabelOf(letter: string | null): string | null {
  if (letter === null) return null;
  const idx = COL_LETTER_INDEX[letter];
  if (idx === undefined) return null;
  return LABEL_BY_INDEX.get(idx) ?? null;
}

// ── Запись рассказа ───────────────────────────────────────────────────

/** Одна правка с полным адресом — то, что читается в подробной глубине. */
export interface ChangeEntry {
  /** Устойчивый ключ: книга + лист + адрес + момент + автор. */
  readonly id: string;
  /** Короткое имя книги ГРБС («УО»). */
  readonly book: string;
  /** Лист книги, как его назвал источник («ВСЕ», «УФБП»). */
  readonly sheet: string;
  /** № п/п закупки — ведущий адрес канона; null — источник ключа не дал. */
  readonly rowSeq: string | null;
  /** Номер строки листа — подсказка, а не адрес: он устаревает (п.98б). */
  readonly sheetRow: number | null;
  /** Буква колонки («J»); у событий целой строки — null. */
  readonly column: string | null;
  /** Человеческое имя колонки; вне канона шапки — null. */
  readonly columnLabel: string | null;
  readonly kind: ChangeKind;
  /** Прежнее значение как текст. Пустота остаётся пустой строкой. */
  readonly before: string;
  /** Новое значение как текст. */
  readonly after: string;
  /** Автор — как записал источник. null означает «источник не назвал». */
  readonly author: string | null;
  /** Момент по часам книги, «YYYY-MM-DDTHH:mm:ss»; null — момента нет. */
  readonly at: string | null;
  /**
   * Ключ упорядочения. Это НЕ мировой момент: часы книги читаются как есть,
   * без пересчёта поясов, — сравнивать записи одной книги между собой можно,
   * выдавать за точное время нельзя.
   */
  readonly atMs: number | null;
  /** Предмет закупки — по нему идёт поиск в подробной глубине. */
  readonly subject: string | null;
  /** Учреждение — если источник его знает. */
  readonly subordinate: string | null;
  readonly origin: ChangeOrigin;
  /** Контроль и интервал наблюдения; НЕ момент правки или её автор. */
  readonly comparisonEvidence?: {
    readonly baselineId: string;
    readonly controlAt: string;
    readonly observedAt: string;
  };
  /** Для возможной смены номера: текущий кандидат; исходный № сохраняется в rowSeq. */
  readonly relatedRowSeq?: string;
  /**
   * Адреса ячеек, свёрнутых в одно событие строки («новая закупка» — это
   * десяток ячеек, заполненных в одну минуту). У обычной правки поля нет.
   */
  readonly cells?: readonly string[];
  /** Original observations survive presentation grouping; never inferred authors. */
  readonly evidence?: readonly ChangeEvidence[];
  /** Server observation/publication time, distinct from an operator's edit time. */
  readonly observedAt?: string;
}

export type ChangeEvidence = Omit<ChangeEntry, 'evidence'>;

function originalEvidence(entry: ChangeEntry): readonly ChangeEvidence[] {
  if (entry.evidence) return entry.evidence;
  const { evidence: _evidence, ...original } = entry;
  return [original];
}

/** Exact event identity, including values; a legacy ID collision is not proof. */
function changeIdentity(entry: ChangeEntry): string {
  return JSON.stringify([entry.book, entry.sheet, entry.rowSeq, entry.sheetRow,
    entry.column, entry.kind, entry.before, entry.after, entry.at, entry.author,
    entry.cells ?? null, entry.comparisonEvidence ?? null,
    // Equal cell counts/addresses do not prove equal folded row payloads.
    entry.cells ? entry.evidence ? [...new Set(entry.evidence.map(e => JSON.stringify([
      e.book, e.sheet, e.rowSeq, e.sheetRow, e.column, e.before, e.after, e.at, e.author,
      e.observedAt ?? null,
    ])))].sort() : [entry.origin, entry.id] : null,
    // A read-diff without a linked source edit cannot borrow its clock/author.
    entry.observedAt === undefined ? null : [entry.origin, entry.observedAt],
    // Unknown time cannot connect independent source observations.
    entry.at === null ? [entry.origin, entry.id] : null]);
}

/** Preserve every original witness, with one card only for an exactly matching event. */
export function mergeChangeEntries(entries: readonly ChangeEntry[]): ChangeEntry[] {
  const grouped = new Map<string, ChangeEntry>();
  const ids = new Set<string>();
  for (const entry of entries) {
    const key = changeIdentity(entry);
    const existing = grouped.get(key);
    if (existing) {
      const witnesses = new Map<string, ChangeEvidence>();
      for (const witness of [...originalEvidence(existing), ...originalEvidence(entry)]) {
        witnesses.set(JSON.stringify(witness), witness);
      }
      grouped.set(key, { ...existing, evidence: [...witnesses.values()] });
    } else {
      let id = entry.id;
      // Rendered keys must remain distinct for older producers sharing an ID.
      for (let n = 2; ids.has(id); n++) id = `${entry.id}|distinct:${n}`;
      ids.add(id);
      grouped.set(key, id === entry.id ? entry : { ...entry, id, evidence: originalEvidence(entry) });
    }
  }
  return [...grouped.values()].sort(compareEntries);
}

/** Пробел рассказа: место, где мы чего-то не знаем и обязаны это сказать. */
export interface ChangeGap {
  readonly book: string;
  readonly reason:
    /** Журнал книги не прочитан — о правках в ней НИЧЕГО не известно. */
    | 'journal-unread'
    /** Прежнего снимка нет — исчезнувшие закупки не с чем сравнить. */
    | 'no-previous-snapshot'
    /** Записи журнала без ключа строки: адрес по № п/п невосстановим. */
    | 'row-key-missing'
    /** У прежнего или текущего состояния повторяется № п/п. */
    | 'row-key-ambiguous'
    /** Действующая книга отсутствует, повреждена или не перечитана. */
    | 'source-unavailable';
  readonly detail: string;
  /** Сколько записей затронуто (для 'row-key-missing'). */
  readonly count?: number;
}

/** Краткая глубина: то, что человек понимает с одного взгляда. */
export interface ChangeDigest {
  /** Сколько книг тронуто. */
  readonly books: number;
  /** Имена тронутых книг — до трёх в фразе, остальные счётом. */
  readonly booksNamed: readonly string[];
  /** Сколько закупок затронуто (уникальные пары книга + № п/п). */
  readonly rows: number;
  /** Сколько записей всего. */
  readonly entries: number;
  /** Сколько записей каждого рода — нули не выбрасываются. */
  readonly byKind: Readonly<Record<ChangeKind, number>>;
  /** Кто правил — имена как их записал источник. */
  readonly authors: readonly string[];
  /** Самая ранняя и самая поздняя правка рассказа. */
  readonly firstAt: string | null;
  readonly lastAt: string | null;
  /**
   * Что за пустота, если записей нет:
   *   'none'    — записи есть;
   *   'quiet'   — источники прочитаны, правок действительно не было;
   *   'unknown' — источники не прочитаны, и о правках ничего не известно.
   */
  readonly emptiness: 'none' | 'quiet' | 'unknown';
}

export interface ChangeStory {
  readonly entries: readonly ChangeEntry[];
  readonly digest: ChangeDigest;
  readonly gaps: readonly ChangeGap[];
  /**
   * Всегда true. Это не итог подсчёта, а свойство источника: удаление строки
   * через меню таблицы правок ячеек не создаёт, и журнал его не видит.
   * Рассказ обязан произносить это вслух рядом с числами.
   */
  readonly deletionsUnobservable: true;
}

// ── Сборка записей из источников ──────────────────────────────────────

/**
 * Пустотой считается ТОЛЬКО то, что сам скрипт журнала пишет вместо пустой
 * ячейки. «Х» сюда НЕ входит намеренно, хотя в книге он означает отсутствие
 * факта: журнал отвечает на вопрос «что именно поменялось», и подмена
 * набранного оператором «Х» словом «пусто» — маленькая, но ложь. В денежных
 * расчётах «Х» действительно пустота (provenance/plan-provenance.ts), здесь
 * же он значение, и показывается как значение. Проверено по живому журналу
 * УКСиМП (дамп 18.08.2026): правки вида «Х → 15.08.2026» встречаются.
 */
const EMPTY_MARKERS = new Set(['', '(пусто)', 'пусто']);

/** Значение источника как текст: пустые маркеры книги сводятся к пустоте. */
function valueText(raw: unknown): string {
  const s = String(raw ?? '').replace(/\u00a0/g, ' ').trim();
  return EMPTY_MARKERS.has(s.toLowerCase()) ? '' : s;
}

/** Автор как текст; пустой — честный null, а не выдуманное имя. */
function authorText(raw: unknown): string | null {
  const s = String(raw ?? '').trim();
  return s === '' ? null : s;
}

/**
 * Ключ упорядочения по часам книги. «Z» приписывается намеренно: подпись
 * времени читается как есть, без домысливания пояса, — иначе одна и та же
 * запись меняла бы место в списке на машинах с разными настройками.
 */
export function orderingMsOf(at: string | null): number | null {
  if (at === null) return null;
  const ms = Date.parse(`${at}Z`);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Записи из журнала правок одной книги.
 *
 * Порог целой строки не применяется: журнал пишет ячейки, и «добавление
 * закупки» видно как заполнение многих ячеек одной строки в одну минуту.
 * Сведение таких записей в событие «новая закупка» делает `foldRowEvents`
 * ниже — отдельным шагом, чтобы подробная глубина могла показать и сырые
 * ячейки, и свёрнутое событие.
 */
export function entriesFromBookJournal(
  book: string,
  records: readonly JournalRecord[],
): { entries: ChangeEntry[]; rowKeyless: number } {
  const entries: ChangeEntry[] = [];
  let rowKeyless = 0;

  for (const rec of records) {
    const letter = columnLetterOf(rec.cell);
    const sheetRow = sheetRowOfAddress(rec.cell);
    const key = parseJournalRowKey(rec.row);
    const moment = parseJournalInstant(rec.at);
    const at = moment?.at ?? null;
    const rowSeq = key.ordinal === null ? null : String(key.ordinal);
    if (rowSeq === null) rowKeyless += 1;

    const sheet = String(rec.sheet ?? '').trim() || 'ВСЕ';
    const author = authorText(rec.author);
    const cell = String(rec.cell ?? '').trim().toUpperCase();

    entries.push({
      id: `${book}|${sheet}|${cell}|${at ?? '?'}|${author ?? '?'}`,
      book,
      sheet,
      rowSeq,
      sheetRow,
      column: letter,
      columnLabel: columnLabelOf(letter),
      kind: changeKindOfColumn(letter),
      before: valueText(rec.was),
      after: valueText(rec.became),
      author,
      at,
      atMs: orderingMsOf(at),
      subject: key.subject,
      subordinate: null,
      origin: 'book-journal',
    });
  }

  return { entries, rowKeyless };
}

/**
 * Записи из сравнения снимков: исчезнувшие и появившиеся закупки.
 *
 * У этих записей НЕТ ни автора, ни момента, и подставлять сюда момент снимка
 * нельзя: снимок говорит «между двумя чтениями», а не «в 14:32». Пустые поля
 * здесь — не недоделка, а форма источника.
 */
export function entriesFromRowDiff(
  book: string,
  diff: RowDiff,
  comparisonEvidence?: ChangeEntry['comparisonEvidence'],
): ChangeEntry[] {
  const entries: ChangeEntry[] = [];
  const candidates = diff.identityCandidates ?? [];
  const candidateOld = new Set(candidates.map((c) => c.beforeRowSeq));
  const candidateNew = new Set(candidates.map((c) => c.afterRowSeq));
  // У одного номера могут быть разные истории на последовательных контрольных
  // базах. Не схлопывать их в одну запись при склейке/будущем хранении.
  // Момент повторного чтения в ключ НЕ включаем: он не является новой правкой.
  const controlKey = comparisonEvidence ? '|контроль:' + comparisonEvidence.baselineId : '';

  for (const v of diff.vanished) {
    // Событие возможной смены номера уже несёт факт отсутствия старого №.
    // Два независимых события для одной гипотезы были бы двойным счётом.
    if (candidateOld.has(v.rowSeq)) continue;
    entries.push({
      id: `${book}|снимки|исчезла|${v.rowSeq}${controlKey}`,
      book,
      sheet: 'ВСЕ',
      rowSeq: v.rowSeq,
      sheetRow: v.wasAtSheetRow,
      column: null,
      columnLabel: null,
      kind: 'row-vanished',
      before: v.subject ?? '',
      after: '',
      author: null,
      at: null,
      atMs: null,
      subject: v.subject ?? null,
      subordinate: v.subordinate ?? null,
      origin: 'snapshot-diff',
      ...(comparisonEvidence ? { comparisonEvidence } : {}),
    });
  }

  for (const a of diff.appeared) {
    if (candidateNew.has(a.rowSeq)) continue;
    entries.push({
      id: `${book}|снимки|появилась|${a.rowSeq}${controlKey}`,
      book,
      sheet: 'ВСЕ',
      rowSeq: a.rowSeq,
      sheetRow: a.sheetRow,
      column: null,
      columnLabel: null,
      kind: 'row-added',
      before: '',
      after: a.subject ?? '',
      author: null,
      at: null,
      atMs: null,
      subject: a.subject ?? null,
      subordinate: a.subordinate ?? null,
      origin: 'snapshot-diff',
      ...(comparisonEvidence ? { comparisonEvidence } : {}),
    });
  }

  // Смена предмета/учреждения при сохранённом № — независимый след:
  // номер тот же, но преемственность закупки не доказана.
  // Род subject уже в каноне журнала, дополнительную сущность не создаём.
  for (const change of diff.contextChanged ?? []) {
    const prior = [change.beforeSubject, change.beforeSubordinate].filter(Boolean).join(' · ');
    const current = [change.afterSubject, change.afterSubordinate].filter(Boolean).join(' · ');
    entries.push({
      id: book + '|контроль|изменение-контекста|' + change.rowSeq +
        '|' + (comparisonEvidence?.baselineId ?? '?'),
      book,
      sheet: 'ВСЕ',
      rowSeq: change.rowSeq,
      sheetRow: change.afterSheetRow,
      column: null,
      columnLabel: 'Предмет и учреждение',
      kind: 'subject',
      before: prior,
      after: current,
      author: null,
      at: null,
      atMs: null,
      subject: change.afterSubject || null,
      subordinate: change.afterSubordinate || null,
      origin: 'snapshot-diff',
      ...(comparisonEvidence ? { comparisonEvidence } : {}),
    });
  }

  for (const candidate of candidates) {
    entries.push({
       id: book + '|контроль|возможная-смена-номера|' + candidate.beforeRowSeq + '|' + candidate.afterRowSeq + controlKey,
      book,
      sheet: 'ВСЕ',
      rowSeq: candidate.beforeRowSeq,
      relatedRowSeq: candidate.afterRowSeq,
      sheetRow: candidate.beforeSheetRow,
      column: null,
      columnLabel: '№ п/п',
      kind: 'row-identity-candidate',
      before: candidate.beforeRowSeq,
      after: candidate.afterRowSeq,
      author: null,
      at: null,
      atMs: null,
      subject: candidate.subject,
      subordinate: candidate.subordinate,
      origin: 'snapshot-diff',
      ...(comparisonEvidence ? { comparisonEvidence } : {}),
    });
  }

  return entries;
}

// ── Свёртка построчных событий ────────────────────────────────────────

/**
 * Сколько заполненных ячеек за раз считается ЦЕЛОЙ СТРОКОЙ, а не набором
 * правок. Пять — тот же порог, что у analytics/journal-events.ts: второй
 * правды о том, что такое «добавили закупку», в продукте быть не должно.
 */
export const ROW_EVENT_CELLS = 5;

/** Минутная метка: скрипт книги пишет действие оператора одной минутой. */
function minuteOf(at: string | null): string {
  return at === null ? '?' : at.slice(0, 16);
}

/**
 * Свернуть ячейковые правки в события строки.
 *
 * ЗАЧЕМ. Журнал книги пишет ЯЧЕЙКИ. Одно добавление закупки выглядит как
 * десяток записей «было пусто — стало значение» в одну минуту по одной
 * строке, и читатель, которому обещали «сколько новых закупок», видел бы
 * вместо ответа десяток строк про отдельные ячейки.
 *
 * ЧЕГО СВЁРТКА НЕ ДЕЛАЕТ. Она не называет обнуление строки удалением. Строка,
 * у которой стёрли ячейки, ОСТАЛАСЬ в книге — это «очищена». Настоящее
 * удаление журналу недоступно вовсе, и путать эти два события нельзя.
 */
export function foldRowEvents(entries: readonly ChangeEntry[]): ChangeEntry[] {
  const groups = new Map<string, ChangeEntry[]>();
  const passthrough: ChangeEntry[] = [];

  for (const e of entries) {
    if (e.origin === 'snapshot-diff' || e.column === null || e.at === null) {
      passthrough.push(e);
      continue;
    }
    const address = e.rowSeq === null ? `лист-${e.sheetRow ?? '?'}` : `№${e.rowSeq}`;
    const key = JSON.stringify([e.book, e.sheet, address, e.sheetRow, minuteOf(e.at), e.author]);
    const bucket = groups.get(key);
    if (bucket) bucket.push(e);
    else groups.set(key, [e]);
  }

  const out: ChangeEntry[] = [...passthrough];
  for (const items of groups.values()) {
    const filled = items.filter((i) => i.before === '' && i.after !== '');
    const wiped = items.filter((i) => i.before !== '' && i.after === '');

    const distinctCells = new Set(items.map(i => `${i.column}${i.sheetRow}`));
    // Repeated edits of the same cell are a sequence, not a whole-row action.
    if (distinctCells.size !== items.length) {
      out.push(...items);
    } else if (filled.length >= ROW_EVENT_CELLS && wiped.length === 0) {
      out.push(rowEventOf(items, 'row-added'));
    } else if (wiped.length >= ROW_EVENT_CELLS && filled.length === 0) {
      out.push(rowEventOf(items, 'row-cleared'));
    } else {
      out.push(...items);
    }
  }

  out.sort(compareEntries);
  return out;
}

/** Одно событие строки из группы ячейковых правок. */
function rowEventOf(items: readonly ChangeEntry[], kind: 'row-added' | 'row-cleared'): ChangeEntry {
  const head = items[0];
  // Предмет закупки берётся из той ячейки, где он и живёт, — из колонки
  // предмета. Если её в группе нет, остаётся подпись ключа журнала.
  const subjectCell = items.find((i) => i.column !== null && COL_LETTER_INDEX[i.column] === DEPT_COLUMNS.SUBJECT);
  const subject = kind === 'row-added'
    ? (subjectCell?.after || head.subject)
    : (subjectCell?.before || head.subject);
  const cells = items.map((i) => `${i.column ?? '?'}${i.sheetRow ?? ''}`);
  return {
    ...head,
    id: JSON.stringify([head.book, head.sheet, kind, head.rowSeq, head.sheetRow, minuteOf(head.at), head.author]),
    column: null,
    columnLabel: null,
    kind,
    before: kind === 'row-cleared' ? `${items.length} заполненных ячеек` : '',
    after: kind === 'row-added' ? `${items.length} заполненных ячеек` : '',
    subject: subject === '' ? null : (subject ?? null),
    cells,
    evidence: items.flatMap(originalEvidence),
  };
}

// ── Свод ──────────────────────────────────────────────────────────────

function emptyByKind(): Record<ChangeKind, number> {
  return {
    money: 0, dates: 0, comment: 0, method: 0, subject: 0, flag: 0,
    'row-added': 0, 'row-vanished': 0, 'row-identity-candidate': 0, 'row-cleared': 0, other: 0,
  };
}

/** Свод записей в краткую глубину. */
export function summarizeChanges(
  entries: readonly ChangeEntry[],
  gaps: readonly ChangeGap[],
): ChangeDigest {
  const byKind = emptyByKind();
  const books = new Set<string>();
  const rows = new Set<string>();
  const authors = new Set<string>();
  let firstAt: string | null = null;
  let lastAt: string | null = null;

  for (const e of entries) {
    byKind[e.kind] += 1;
    books.add(e.book);
    // Адрес закупки — № п/п. Записи без ключа считаются по строке листа
    // ОТДЕЛЬНЫМ ключом с пометкой: слить их с закупками нельзя, потерять тоже.
    rows.add(e.rowSeq === null ? `${e.book}#лист-${e.sheetRow ?? '?'}` : `${e.book}#${e.rowSeq}`);
    if (e.author !== null) authors.add(e.author);
    if (e.at !== null) {
      if (firstAt === null || e.at < firstAt) firstAt = e.at;
      if (lastAt === null || e.at > lastAt) lastAt = e.at;
    }
  }

  const incomplete = gaps.some((g) => g.reason === 'journal-unread' ||
    g.reason === 'no-previous-snapshot' || g.reason === 'source-unavailable' ||
    g.reason === 'row-key-ambiguous');
  const emptiness = entries.length > 0
    ? 'none'
    : incomplete ? 'unknown' : 'quiet';

  return {
    books: books.size,
    booksNamed: [...books].sort((a, b) => a.localeCompare(b, 'ru')),
    rows: rows.size,
    entries: entries.length,
    byKind,
    authors: [...authors].sort((a, b) => a.localeCompare(b, 'ru')),
    firstAt,
    lastAt,
    emptiness,
  };
}

/** Вход сборки: по книге — её журнал и, если есть, сравнение снимков. */
export interface ChangeStoryInput {
  readonly book: string;
  /**
   * Прочитан ли журнал книги. false — книга не ответила, и молчание НЕ
   * означает «правок не было»: она уходит в пробелы рассказа по имени.
   */
  readonly journalAvailable: boolean;
  readonly records?: readonly JournalRecord[];
  /** Сравнение снимков; null — прежнего снимка нет, и это тоже пробел. */
  readonly diff?: RowDiff | null;
  /** Есть ли вообще с чем сравнивать (прежний снимок). */
  readonly snapshotComparable?: boolean;
}

/**
 * Собрать один рассказ. Порядок записей — от свежих к старым; записи без
 * момента (сравнение снимков) идут первыми: их «когда» неизвестно, а их «что»
 * важнее всего остального.
 */
export function buildChangeStory(
  inputs: readonly ChangeStoryInput[],
  options: { readonly sinceMs?: number } = {},
): ChangeStory {
  const entries: ChangeEntry[] = [];
  const gaps: ChangeGap[] = [];

  for (const input of inputs) {
    if (!input.journalAvailable) {
      gaps.push({
        book: input.book,
        reason: 'journal-unread',
        detail:
          `Журнал правок книги «${input.book}» не прочитан — о правках в ней ` +
          'ничего не известно. Это не «правок не было».',
      });
    } else {
      const { entries: fromJournal, rowKeyless } = entriesFromBookJournal(input.book, input.records ?? []);
      const inWindow = options.sinceMs === undefined
        ? fromJournal
        : fromJournal.filter((e) => e.atMs === null || e.atMs >= (options.sinceMs as number));
      // Свёртка идёт ПОСЛЕ окна: иначе половина ячеек новой закупки осталась
      // бы за границей окна и добавление рассыпалось бы на отдельные правки.
      entries.push(...foldRowEvents(mergeChangeEntries(inWindow)));
      if (rowKeyless > 0) {
        gaps.push({
          book: input.book,
          reason: 'row-key-missing',
          count: rowKeyless,
          detail:
            `В журнале книги «${input.book}» ${rowKeyless} записей без № п/п — ` +
            'адрес закупки по ним не восстановить, выводить его из номера строки ' +
            'листа нельзя: строки двигаются.',
        });
      }
    }

    if (input.diff) {
      entries.push(...entriesFromRowDiff(input.book, input.diff));
    } else if (input.snapshotComparable === false) {
      gaps.push({
        book: input.book,
        reason: 'no-previous-snapshot',
        detail:
          `Прежнего снимка книги «${input.book}» нет — исчезнувшие закупки ` +
          'сравнивать не с чем. Журнал книги удаление строки не записывает.',
      });
    }
  }

  entries.sort(compareEntries);
  return {
    entries,
    digest: summarizeChanges(entries, gaps),
    gaps,
    deletionsUnobservable: true,
  };
}

/**
 * Порядок рассказа. Записи без момента впереди: сравнение снимков не знает
 * времени, а исчезнувшая закупка — самое важное, что есть в списке. Дальше —
 * от свежих к старым, при равном моменте порядок устойчив по ключу.
 */
export function compareEntries(a: ChangeEntry, b: ChangeEntry): number {
  if (a.atMs === null && b.atMs !== null) return -1;
  if (a.atMs !== null && b.atMs === null) return 1;
  if (a.atMs !== null && b.atMs !== null && a.atMs !== b.atMs) return b.atMs - a.atMs;
  return a.id.localeCompare(b.id, 'ru');
}

// ── Отбор подробной глубины ───────────────────────────────────────────

/** Отбор списка правок: книга, род, автор, время, поиск по предмету. */
export interface ChangeFilter {
  readonly books?: readonly string[];
  readonly kinds?: readonly ChangeKind[];
  readonly authors?: readonly string[];
  /** Нижняя граница по часам книги (ключ `atMs`). */
  readonly sinceMs?: number;
  /** Поиск: предмет закупки, № п/п, значения «было»/«стало», имя колонки. */
  readonly search?: string;
}

/** Нормализация строки поиска: регистр и неразрывные пробелы не должны мешать. */
function norm(s: string): string {
  return s.replace(/\u00a0/g, ' ').trim().toLowerCase();
}

/** Применить отбор. Пустой отбор возвращает список как есть. */
export function filterChangeEntries(
  entries: readonly ChangeEntry[],
  filter: ChangeFilter,
): ChangeEntry[] {
  const books = filter.books && filter.books.length > 0 ? new Set(filter.books) : null;
  const kinds = filter.kinds && filter.kinds.length > 0 ? new Set(filter.kinds) : null;
  const authors = filter.authors && filter.authors.length > 0 ? new Set(filter.authors) : null;
  const needle = filter.search === undefined ? '' : norm(filter.search);

  return entries.filter((e) => {
    if (books !== null && !books.has(e.book)) return false;
    if (kinds !== null && !kinds.has(e.kind)) return false;
    if (authors !== null && (e.author === null || !authors.has(e.author))) return false;
    // Записи без момента (сравнение снимков) окно по времени НЕ отсекает:
    // «когда» у них неизвестно, и молча выбросить их значило бы спрятать
    // исчезнувшую закупку.
    if (filter.sinceMs !== undefined && e.atMs !== null && e.atMs < filter.sinceMs) return false;
    if (needle !== '') {
      const hay = [
        e.subject ?? '', e.rowSeq ?? '', e.before, e.after,
        e.columnLabel ?? '', e.subordinate ?? '', e.book,
      ].join(' ');
      if (!norm(hay).includes(needle)) return false;
    }
    return true;
  });
}

/** Кто правил и сколько раз — для списка авторов в отборе. */
export function authorTally(entries: readonly ChangeEntry[]): Array<{ author: string; count: number }> {
  const tally = new Map<string, number>();
  for (const e of entries) {
    if (e.author === null) continue;
    tally.set(e.author, (tally.get(e.author) ?? 0) + 1);
  }
  return [...tally.entries()]
    .map(([author, count]) => ({ author, count }))
    .sort((a, b) => b.count - a.count || a.author.localeCompare(b.author, 'ru'));
}

/** Какие книги встречаются в рассказе и сколько правок у каждой. */
export function bookTally(entries: readonly ChangeEntry[]): Array<{ book: string; count: number }> {
  const tally = new Map<string, number>();
  for (const e of entries) tally.set(e.book, (tally.get(e.book) ?? 0) + 1);
  return [...tally.entries()]
    .map(([book, count]) => ({ book, count }))
    .sort((a, b) => b.count - a.count || a.book.localeCompare(b.book, 'ru'));
}
