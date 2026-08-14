/**
 * row-timeline.ts — таймлайн одной строки книги ГРБС по всей истории проекта.
 *
 * КАНОН п.75в (реестр интервью 14.08.2026): «относительно плановой даты по
 * мере приближения к ней показывать ВСЕ изменения по строке контракта,
 * ОСОБЕННО просрочки — по всей истории проекта». Здесь собирается сама
 * история; витрина — отдельной волной.
 *
 * Три источника истории, каждый подписан честно (поле source):
 *   «журнал»      — вкладка «_ChangeLog» книги (правка ячейки: было→стало,
 *                   момент, автор) — ведётся с 06.08.2026;
 *   «снимок»      — снимки сервера (snapshots + procurement_rows в SQL):
 *                   события выводятся ДИФФОМ соседних наблюдений;
 *   «срез недели» — три архивные недели из фикстур ручного отчёта
 *                   (08.05, 29.05, 26.06.2026) — точки ДО журнала.
 *
 * Просрочка выводится СТРУКТУРНО (канон п.27: свободный текст исполнителей
 * машинно не интерпретируется): плановая дата (N) прошла, а даты заключения
 * (Q) нет — либо дата заключения позже плановой. Никакие слова комментариев
 * («не заключен», «подписан», «ожидается…») в вывод не входят.
 *
 * ЧЕСТНОСТЬ ГЛУБИНЫ: если источник молчит (журнал пуст, снимков старше N
 * недель нет, срезы недель строку не нашли) — таймлайн так и говорит, с какой
 * даты ведётся история (historySince/historyNote), а не выдумывает
 * ретроспективу.
 */

import { dayNumberOf, hasFactDate, isoOfDayNumber } from '@aemr/shared';

/** Откуда известно событие. Значения — подписи продукта, не внутренние ключи. */
export type TimelineSource = 'журнал' | 'снимок' | 'срез недели';

export type TimelineEventKind =
  | 'plan_date_changed'
  | 'fact_date_set'
  | 'sum_changed'
  | 'method_changed'
  | 'comment_changed'
  | 'overdue_started'
  | 'snapshot_observed';

export interface TimelineEvent {
  /** Момент события: ISO-инстант (журнал/снимок) либо ISO-дата (срез, просрочка). */
  at: string;
  kind: TimelineEventKind;
  from?: string;
  to?: string;
  source: TimelineSource;
  /** Адрес ячейки листа («N178») — там правку видно в самой книге. */
  cell?: string;
}

export interface RowTimeline {
  /** «УО:178» — книга ГРБС + номер строки листа (1-based, как в книге). */
  rowKey: string;
  /** Текущая плановая дата (ISO) по последнему наблюдению; null — не распознана. */
  plannedDate: string | null;
  /** События, отсортированные по времени; дедуп по (at, kind, cell). */
  events: TimelineEvent[];
  /** С какого момента по этой строке ЕСТЬ хоть какая-то история; null — истории нет. */
  historySince: string | null;
  /** Честная фраза о глубине истории — готовая для читателя. */
  historyNote: string;
}

/** Правка ячейки из журнала «_ChangeLog» (уже отфильтрованная по книге). */
export interface JournalCellChange {
  /** Адрес ячейки («N178»). Строка адреса обязана совпадать с sheetRow. */
  cell: string;
  oldValue: string;
  newValue: string;
  /** Момент правки, мс эпохи. */
  atMs: number;
}

/** Наблюдение строки в один момент времени (снимок или срез недели). */
export interface RowObservation {
  /** Момент наблюдения: ISO-инстант либо ISO-дата. */
  at: string;
  source: Extract<TimelineSource, 'снимок' | 'срез недели'>;
  /**
   * Ячейки строки по буквам колонок. МОЖЕТ быть частичным (срезы недель несут
   * 22 колонки из 34) — дифф сравнивает только буквы, присутствующие в ОБОИХ
   * наблюдениях, отсутствие буквы не выдаётся за пустоту.
   */
  cells: Record<string, unknown>;
}

export interface RowTimelineInput {
  rowKey: string;
  /** 1-based номер строки листа — для сверки адресов журнала и адресов событий. */
  sheetRow: number;
  journal: readonly JournalCellChange[];
  observations: readonly RowObservation[];
  /** «Сегодня» календаря продукта (номер суток) — для структурного вывода просрочки. */
  asOfDay: number;
}

/**
 * Буква колонки → вид события таймлайна. Закрытый канон видов (п.75в):
 * буквы вне карты (предмет G, подвед C, кварталы O/R и т.п.) в таймлайн
 * НЕ попадают — вид «прочая правка» каноном не предусмотрен, а выдавать
 * правку предмета за правку комментария нечестно.
 */
const LETTER_KIND: Readonly<Record<string, TimelineEventKind>> = {
  N: 'plan_date_changed',
  Q: 'fact_date_set',
  // Деньги: план ФБ/КБ/МБ/итого, факт ФБ/КБ/МБ/итого, экономия ФБ/КБ/МБ/итого.
  H: 'sum_changed', I: 'sum_changed', J: 'sum_changed', K: 'sum_changed',
  V: 'sum_changed', W: 'sum_changed', X: 'sum_changed', Y: 'sum_changed',
  Z: 'sum_changed', AA: 'sum_changed', AB: 'sum_changed', AC: 'sum_changed',
  L: 'method_changed',
  // Комментарийные колонки (слой M/U/AE/AF/AG/AH, директива п.72).
  M: 'comment_changed', U: 'comment_changed', AE: 'comment_changed',
  AF: 'comment_changed', AG: 'comment_changed', AH: 'comment_changed',
};

/** Буквы, которые дифф наблюдений сравнивает (те же, что в LETTER_KIND). */
const DIFF_LETTERS = Object.keys(LETTER_KIND);

/** Датные буквы — нормализация значений через номер суток. */
const DATE_LETTERS = new Set(['N', 'Q']);

/** Денежные буквы — нормализация числом (пробелы тысяч, запятая-десятичная). */
const SUM_LETTERS = new Set(['H', 'I', 'J', 'K', 'V', 'W', 'X', 'Y', 'Z', 'AA', 'AB', 'AC']);

/**
 * Число из ячейки листа: «1 234,56» операторского формата. Канон совпадает с
 * server/services/rows-dto.toNumber; нечисло → null (не ноль: «пусто» и «0»
 * в диффе денег — разные состояния).
 */
function sheetNumber(val: unknown): number | null {
  if (typeof val === 'number') return Number.isFinite(val) ? val : null;
  const s = String(val ?? '').trim();
  if (s === '') return null;
  const parsed = parseFloat(s.replace(/\s/g, '').replace(/,/g, '.'));
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Нормализованное значение ячейки для сравнения и показа в from/to.
 * Даты — ISO-датой (serial 46111 и «15.06.2026» — одна дата, не «правка»);
 * деньги — каноническим числом; остальное — trim-строкой как есть.
 */
function normalizeCell(letter: string, val: unknown): string {
  if (DATE_LETTERS.has(letter)) {
    const day = dayNumberOf(val);
    if (day !== null) return isoOfDayNumber(day);
    return String(val ?? '').trim();
  }
  if (SUM_LETTERS.has(letter)) {
    const n = sheetNumber(val);
    if (n !== null) return String(n);
    return String(val ?? '').trim();
  }
  return String(val ?? '').trim();
}

/** Адрес журнала «N178» → { letter, row }; мусорный адрес → null. */
function parseCellAddress(cell: string): { letter: string; row: number } | null {
  const m = String(cell ?? '').trim().toUpperCase().match(/^([A-Z]{1,2})(\d+)$/);
  if (!m) return null;
  return { letter: m[1], row: parseInt(m[2], 10) };
}

/** Ключ сортировки события: миллисекунды момента (ISO-дата = полночь UTC). */
function atMsOf(event: TimelineEvent): number {
  const ms = Date.parse(event.at);
  return Number.isFinite(ms) ? ms : 0;
}

/**
 * Строит таймлайн строки из трёх источников. Чистая функция: никаких чтений
 * БД/сети — вызывающий (роут) сам собирает журнал, наблюдения и срезы.
 */
export function buildRowTimeline(input: RowTimelineInput): RowTimeline {
  const events: TimelineEvent[] = [];

  // ── 1. Журнал правок: ячейка, было→стало, момент ──
  let journalSinceMs: number | null = null;
  for (const change of input.journal) {
    const addr = parseCellAddress(change.cell);
    if (!addr || addr.row !== input.sheetRow) continue;
    if (journalSinceMs === null || change.atMs < journalSinceMs) journalSinceMs = change.atMs;
    const kind = LETTER_KIND[addr.letter];
    if (!kind) continue; // буква вне канона видов — не выдумываем вид
    events.push({
      at: new Date(change.atMs).toISOString(),
      kind,
      from: normalizeCell(addr.letter, change.oldValue),
      to: normalizeCell(addr.letter, change.newValue),
      source: 'журнал',
      cell: `${addr.letter}${addr.row}`,
    });
  }

  // ── 2. Наблюдения (снимки + срезы недель): сам факт наблюдения + дифф соседей ──
  const observations = [...input.observations].sort(
    (a, b) => (Date.parse(a.at) || 0) - (Date.parse(b.at) || 0),
  );
  for (const obs of observations) {
    events.push({ at: obs.at, kind: 'snapshot_observed', source: obs.source });
  }
  for (let i = 1; i < observations.length; i++) {
    const prev = observations[i - 1];
    const next = observations[i];
    for (const letter of DIFF_LETTERS) {
      // Сравниваем только буквы, известные ОБОИМ наблюдениям: срез недели несёт
      // 22 колонки, и отсутствие буквы — не пустое значение, а незнание.
      if (!(letter in prev.cells) || !(letter in next.cells)) continue;
      const from = normalizeCell(letter, prev.cells[letter]);
      const to = normalizeCell(letter, next.cells[letter]);
      if (from === to) continue;
      events.push({
        at: next.at,
        kind: LETTER_KIND[letter],
        from,
        to,
        source: next.source,
        cell: `${letter}${input.sheetRow}`,
      });
    }
  }

  // ── 3. Просрочка — СТРУКТУРНО из последнего наблюдения (канон п.27) ──
  const current = observations.length > 0 ? observations[observations.length - 1] : null;
  const planDay = current ? dayNumberOf(current.cells['N']) : null;
  const plannedDate = planDay !== null ? isoOfDayNumber(planDay) : null;
  if (current && planDay !== null) {
    const factRaw = current.cells['Q'];
    const factDay = hasFactDate(factRaw) ? dayNumberOf(factRaw) : null;
    const factMissing = !hasFactDate(factRaw);
    if (factMissing && input.asOfDay > planDay) {
      // Плановая дата прошла, заключения нет — просрочка идёт и сейчас.
      events.push({
        at: isoOfDayNumber(planDay + 1),
        kind: 'overdue_started',
        from: plannedDate ?? undefined,
        source: 'снимок',
        cell: `N${input.sheetRow}`,
      });
    } else if (factDay !== null && factDay > planDay) {
      // Заключили позже плана: просрочка была и закрылась датой заключения.
      events.push({
        at: isoOfDayNumber(planDay + 1),
        kind: 'overdue_started',
        from: plannedDate ?? undefined,
        to: isoOfDayNumber(factDay),
        source: 'снимок',
        cell: `N${input.sheetRow}`,
      });
    }
  }

  // ── Сортировка + дедуп по (at, kind, cell) ──
  events.sort((a, b) => {
    const d = atMsOf(a) - atMsOf(b);
    if (d !== 0) return d;
    return `${a.kind}|${a.cell ?? ''}`.localeCompare(`${b.kind}|${b.cell ?? ''}`);
  });
  const seen = new Set<string>();
  const deduped = events.filter((e) => {
    const key = `${e.at}|${e.kind}|${e.cell ?? ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // ── Честная глубина истории ──
  // История есть, когда есть журнал ЛИБО больше одного наблюдения (единственное
  // наблюдение — это «текущее состояние», а не история).
  const journalSince = journalSinceMs !== null ? new Date(journalSinceMs).toISOString() : null;
  const firstObservationAt = observations.length > 1 ? observations[0].at : null;
  const candidates = [journalSince, firstObservationAt].filter((x): x is string => x !== null);
  const historySince = candidates.length > 0
    ? candidates.reduce((a, b) => ((Date.parse(a) || 0) <= (Date.parse(b) || 0) ? a : b))
    : null;

  const sliceCount = observations.filter((o) => o.source === 'срез недели').length;
  const snapshotCount = observations.filter((o) => o.source === 'снимок').length;
  const historyNote = historySince !== null
    ? `История ведётся с ${historySince.slice(0, 10)}: ` +
      `журнал правок — ${journalSince !== null ? `с ${journalSince.slice(0, 10)}` : 'молчит'}, ` +
      `снимков — ${snapshotCount}, срезов недель — ${sliceCount}.`
    : 'Истории по этой строке нет: журнал правок молчит, архивных снимков и срезов недель для неё не найдено. Показано только текущее состояние.';

  return {
    rowKey: input.rowKey,
    plannedDate,
    events: deduped,
    historySince,
    historyNote,
  };
}
