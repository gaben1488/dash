/**
 * provenance-journal.ts — чтение скрытого листа «_ChangeLog» книг ГРБС ДЛЯ
 * ПРОВЕНАНСА плановых сумм (канон п.102).
 *
 * ЗАЧЕМ ОТДЕЛЬНЫЙ ЧИТАТЕЛЬ, если журнал уже читает /api/changes. Разбор
 * services/changelog.ts решает другую задачу («кто что поменял с даты среза») и
 * ради неё ВЫБРАСЫВАЕТ колонку D «Строка» — единственный ключ, которым правка
 * привязывается к закупке. Провенанс без этого ключа невозможен: адрес ячейки
 * «J177» несёт номер строки ЛИСТА, а журнал ключует по «№ п/п» колонки A, и это
 * разные числа (живой пример УД: ячейка J177 при № п/п 195). Поэтому здесь
 * читается тот же лист, но запись сохраняется целиком — в форме JournalRecord
 * ядра (@aemr/core), которое дальше само разбирает ключ, момент и значения.
 *
 * ЛИСТ ЧИТАЕТСЯ (проверено): getSheetDataFromSpreadsheet обращается к
 * spreadsheets.values.get по имени диапазона, а скрытость листа доступ к
 * значениям не ограничивает — /api/changes живьём поднимает эти же строки.
 * Отдельного «включения скрытых листов» не требуется.
 *
 * ДВЕ ЖИВЫЕ СХЕМЫ ЛИСТА (сверено по восьми книгам, как в changelog.ts):
 *   • 8 колонок: Лист │ Ячейка │ Столбец │ Строка │ Было │ Стало │ Время │ Автор;
 *   • УАГЗО, 6 колонок: Ячейка │ Было │ Стало │ Время │ Автор │ Статус.
 * Схема определяется ПО СТРОКЕ (что лежит в её ячейках), а не по шапке: строки
 * обеих схем встречаются вперемешку.
 *
 * ЧЕСТНОСТЬ ПРО ШЕСТИКОЛОНОЧНУЮ СХЕМУ. В ней поля «Строка» НЕТ — правку не с
 * чем сопоставить. Соблазн вывести № п/п из номера строки в адресе ячейки здесь
 * отвергнут намеренно: строки листа вставляют и удаляют, и позиционная догадка
 * приписала бы правку СОСЕДНЕЙ закупке. Это ровно тот класс ошибок, на который
 * жалуются операторы (канон п.98б: «номера строк не везде бьются»). Такие
 * записи отдаются с пустым ключом, ядро считает их в unparsedRowKeys, а сводка
 * наблюдаемости называет их числом и говорит, что делать.
 *
 * ВРЕМЯ И ЗНАЧЕНИЯ здесь НЕ разбираются: формы живые и разные (Google-serial
 * «46248.6623103», «дд.мм.гггг чч:мм:сс», экспонента «3.497500217E7»), и
 * единственный канон их чтения — ядро provenance. Дублировать его разбор здесь
 * значит завести вторую правду о том, что такое «34975.0».
 *
 * Кэш — тем же образцом, что у /api/changes: пять минут, потому что журнал УО
 * это 33 724 строки, а страница провенанса открывается на каждую закупку.
 * Отличие одно: окно держится ПОКНИЖНО, поэтому одна молчащая книга не
 * заставляет перечитывать семь живых и не выдаёт себя за «правок не было».
 *
 * СЫРЬЁ БЕРЁТСЯ ИЗ ОБЩЕГО ЧИТАТЕЛЯ (changelog-source.ts). Здесь остаётся кэш
 * РАЗОБРАННОГО журнала — разбор 33 тыс. строк на каждое открытие карточки
 * закупки стоит дорого и сам по себе. А вот обращение к Google теперь одно на
 * всех: раньше страница провенанса и журнал правок читали один и тот же лист
 * каждый в своё окно, и при одновременной работе двух вкладок книга читалась
 * дважды за пять минут.
 */
import type { JournalRecord } from '@aemr/core';
import { DEPARTMENT_SPREADSHEETS } from '../config.js';
import { CHANGELOG_SHEET_NAME, readChangelogReading, resetChangelogSource, changelogInputKey } from './changelog-source.js';
import { normalizeSourceJournal, type SourceJournal } from './source-journal.js';

/** Имя скрытого листа журнала правок — одно во всех восьми книгах. */
export { CHANGELOG_SHEET_NAME };

/** Пять минут — как у /api/changes: журналы велики, страница открывается часто. */
const CACHE_TTL_MS = 5 * 60 * 1000;

/** Журнал одной книги вместе с честным признаком, прочитан ли он вообще. */
export interface BookJournal {
  /** Короткое имя ГРБС («УО») — ключ DEPARTMENT_SPREADSHEETS. */
  dept: string;
  /**
   * true — лист прочитан (в том числе прочитан ПУСТЫМ). false — книга не
   * ответила, и о правках в ней НИЧЕГО не известно. Разница решающая: пустой
   * журнал говорит «следов нет», непрочитанный — «мы не смотрели».
   */
  available: boolean;
  /** Записи журнала целиком, в форме входа ядра provenance. */
  records: JournalRecord[];
  /** Записей шестиколоночной схемы: ключ строки в них отсутствует физически. */
  rowKeyless: number;
  /** Строк листа всего (включая шапку и нераспознанные) — мера объёма журнала. */
  rawRows: number;
  /** Момент чтения (мс эпохи). */
  readAt: number;
  /** Причина отказа книги, если available=false. */
  error?: string;
}

/**
 * Plan-provenance projection of the SAME canonical source observations.
 * The raw row key and original cell values are retained. A six-column
 * record has no procurement row key and will never be assigned one by guess.
 */
export function provenanceFromJournal(
  journal: SourceJournal,
  reading?: { spreadsheetId: string; at: number },
): { records: JournalRecord[]; rowKeyless: number } {
  let rowKeyless = 0;
  const records: JournalRecord[] = journal.cells.map(item => {
    if (item.schema === 'six') rowKeyless++;
    const source = reading
      ? { spreadsheetId: reading.spreadsheetId, journalSheet: CHANGELOG_SHEET_NAME,
        journalRow: item.journalRow, readAt: reading.at }
      : undefined;
    return {
      ...(source ? { source } : {}),
      sheet: item.sheet,
      cell: item.cell,
      column: item.column,
      row: item.rowKey,
      was: item.was,
      became: item.became,
      at: item.at,
      author: item.author,
    };
  });
  return { records, rowKeyless };
}

/** Compatibility pure helper, used by existing tests and offline adapters. */
export function parseProvenanceJournal(
  rows: readonly unknown[][],
  reading?: { spreadsheetId: string; at: number },
): { records: JournalRecord[]; rowKeyless: number } {
  return provenanceFromJournal(normalizeSourceJournal(rows), reading);
}

/** Покнижное окно кэша. Отказы не кэшируются: ожившая книга видна сразу. */
const cache = new Map<string, { spreadsheetId: string; key: string | null; journal: BookJournal }>();
const inFlight = new Map<string, { spreadsheetId: string; key: string | null; request: Promise<BookJournal> }>();

/**
 * Сбрасывает окно кэша — нужен тестам и ручной перечитке. Сбрасывается И общий
 * читатель: иначе разобранный журнал ушёл бы, а сырьё осталось, и «перечитка»
 * вернула бы те же строки.
 */
export function resetProvenanceJournalCache(): void {
  cache.clear();
  inFlight.clear();
  resetChangelogSource();
}

/**
 * Журнал одной книги. Отказ источника не выбрасывается наружу исключением:
 * страница провенанса обязана открыться и честно сказать, что книга молчит,
 * а не показать пустой экран (тот же принцип, что у /api/changes с failedDepts).
 */
export async function readBookJournal(
  dept: string,
  spreadsheetId: string,
  now: number = Date.now(),
): Promise<BookJournal> {
  const cached = cache.get(dept);
  const key = changelogInputKey({ [dept]: spreadsheetId });
  if (cached?.spreadsheetId === spreadsheetId && cached.key === key
      && (key !== null || now - cached.journal.readAt < CACHE_TTL_MS)) return cached.journal;
  if (cached && cached.spreadsheetId !== spreadsheetId) cache.delete(dept);
  const pending = inFlight.get(dept);
  if (pending?.spreadsheetId === spreadsheetId && pending.key === key) return pending.request;

  const request = readChangelogReading(dept, spreadsheetId, now).then((reading): BookJournal => {
    const { records, rowKeyless } = provenanceFromJournal(reading.normalized, reading);
    const journal: BookJournal = { dept, available: true, records, rowKeyless, rawRows: reading.rows.length, readAt: reading.at };
    if (inFlight.get(dept)?.request === request && changelogInputKey({ [dept]: spreadsheetId }) === key) {
      cache.set(dept, { spreadsheetId, key, journal });
    }
    return journal;
  }).catch((err): BookJournal => {
    // Отказ не становится успешным пустым чтением и не кэшируется.
    return { dept, available: false, records: [], rowKeyless: 0, rawRows: 0,
      readAt: now, error: (err as Error).message };
  }).finally(() => {
    if (inFlight.get(dept)?.request === request) inFlight.delete(dept);
  });
  inFlight.set(dept, { spreadsheetId, key, request });
  return request;
}

/**
 * Журналы всех книг реестра. Книги читаются разом: последовательное чтение
 * восьми листов по 30 тыс. строк упирается в срок ответа роута, а не в квоту.
 */
export async function readAllBookJournals(now: number = Date.now()): Promise<BookJournal[]> {
  const entries = Object.entries(DEPARTMENT_SPREADSHEETS);
  return Promise.all(entries.map(([dept, id]) => readBookJournal(dept, id, now)));
}
