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
 */
import type { JournalRecord } from '@aemr/core';
import { DEPARTMENT_SPREADSHEETS } from '../config.js';
import { getSheetDataFromSpreadsheet } from './google-sheets.js';

/** Имя скрытого листа журнала правок — одно во всех восьми книгах. */
export const CHANGELOG_SHEET_NAME = '_ChangeLog';

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

/** Похоже ли значение на адрес ячейки книги («H28», «AC177»). */
function looksLikeCell(value: unknown): boolean {
  return /^[A-Z]{1,2}\d+$/i.test(String(value ?? '').trim());
}

/**
 * Разбирает сырые строки листа «_ChangeLog» в записи ядра.
 *
 * Ничего не отбрасывает по содержимому значений: решать, читается ли время и
 * есть ли изменение суммы, — дело ядра provenance. Здесь отсекается только то,
 * что вообще не является записью правки (шапка листа, пустые строки): у них ни
 * в первой, ни во второй ячейке нет адреса.
 */
export function parseProvenanceJournal(rows: readonly unknown[][]): {
  records: JournalRecord[];
  rowKeyless: number;
} {
  const records: JournalRecord[] = [];
  let rowKeyless = 0;

  for (const row of rows) {
    if (!Array.isArray(row) || row.length < 5) continue;

    // Схема 8 колонок: адрес во второй ячейке, ключ строки — в четвёртой.
    if (looksLikeCell(row[1])) {
      records.push({
        sheet: row[0],
        cell: row[1],
        column: row[2],
        row: row[3],
        was: row[4],
        became: row[5],
        at: row[6],
        author: row[7],
      });
      continue;
    }

    // Схема УАГЗО, 6 колонок: адрес в первой ячейке, поля «Строка» нет вовсе.
    if (looksLikeCell(row[0])) {
      rowKeyless += 1;
      records.push({
        sheet: '',
        cell: row[0],
        column: '',
        // Пустой ключ намеренно: ядро посчитает запись в unparsedRowKeys, а не
        // припишет её закупке, которая сегодня стоит на этом месте листа.
        row: '',
        was: row[1],
        became: row[2],
        at: row[3],
        author: row[4],
      });
    }
  }

  return { records, rowKeyless };
}

/** Покнижное окно кэша. Отказы не кэшируются: ожившая книга видна сразу. */
const cache = new Map<string, BookJournal>();

/** Сбрасывает окно кэша — нужен тестам и ручной перечитке. */
export function resetProvenanceJournalCache(): void {
  cache.clear();
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
  if (cached && now - cached.readAt < CACHE_TTL_MS) return cached;

  try {
    const rows = await getSheetDataFromSpreadsheet(spreadsheetId, CHANGELOG_SHEET_NAME);
    const { records, rowKeyless } = parseProvenanceJournal(rows);
    const journal: BookJournal = {
      dept,
      available: true,
      records,
      rowKeyless,
      rawRows: rows.length,
      readAt: now,
    };
    cache.set(dept, journal);
    return journal;
  } catch (err) {
    // Кэшировать отказ нельзя: иначе книга, ожившая через минуту, ещё пять
    // минут числилась бы молчащей.
    return {
      dept,
      available: false,
      records: [],
      rowKeyless: 0,
      rawRows: 0,
      readAt: now,
      error: (err as Error).message,
    };
  }
}

/**
 * Журналы всех книг реестра. Книги читаются разом: последовательное чтение
 * восьми листов по 30 тыс. строк упирается в срок ответа роута, а не в квоту.
 */
export async function readAllBookJournals(now: number = Date.now()): Promise<BookJournal[]> {
  const entries = Object.entries(DEPARTMENT_SPREADSHEETS);
  return Promise.all(entries.map(([dept, id]) => readBookJournal(dept, id, now)));
}
