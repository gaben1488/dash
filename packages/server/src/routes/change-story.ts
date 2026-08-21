/**
 * GET /api/change-story — ОДИН журнал изменений на два уровня подробности.
 *
 * Требование владельца 21.08.2026 дословно: «журнал изменений, в котором можно
 * было бы и кратко, и вместе с тем подробно, необходимо и достаточно увидеть,
 * что именно поменялось».
 *
 * ПОЧЕМУ НЕ ХВАТИЛО ТОГО, ЧТО БЫЛО. У продукта три источника сведений о
 * правках, и до сих пор каждый жил своей дорогой:
 *   • /api/changes — журнал книги, но без ключа строки: адрес там «L178», то
 *     есть номер строки ЛИСТА, а он устаревает при вставках (канон п.98б);
 *   • /api/events — живой поток, но только пока открыта вкладка;
 *   • /api/integrity — сравнение снимков, единственный, кто видит ИСЧЕЗНУВШУЮ
 *     закупку, потому что журнал книги удаление строки не пишет вовсе.
 * Читателю приходилось складывать три ответа в голове. Этот маршрут
 * складывает их в коде — ядром @aemr/core/changes, а не второй копией правил.
 *
 * ЧТО ЗДЕСЬ НЕ ДЕЛАЕТСЯ. Живой поток в ответ НЕ подмешивается: он приходит на
 * экран сам, отдельным соединением, и дублировать его в теле запроса значило
 * бы показать одну правку дважды. Сведение эфира с этим рассказом делает
 * экран (web/src/lib/changes), и делает тем же ядром.
 *
 * ЧЕСТНАЯ ПУСТОТА. Книга, чей журнал не ответил, попадает в `gaps` по имени, а
 * не растворяется в тишине: «правок не было» и «журнал не прочитан» — разные
 * ответы, и путать их нельзя (канон п.53, п.58).
 */
import type { FastifyInstance } from 'fastify';
import {
  buildChangeStory,
  entriesFromRowDiff,
  filterChangeEntries,
  summarizeChanges,
  authorTally,
  bookTally,
  type ChangeEntry,
  type ChangeGap,
  type ChangeKind,
  type ChangeStoryInput,
} from '@aemr/core';
import { dayNumberOf, floorToThursday, isoOfDayNumber } from '@aemr/shared';
import { config } from '../config.js';
import { productCalendarDay } from '../services/product-calendar.js';
import { readAllBookJournals } from '../services/provenance-journal.js';
import { buildComparison } from './integrity.js';

/**
 * Потолок подробного списка. Свод считается по ВСЕМУ окну — обрезается только
 * то, что уезжает на экран: сорок тысяч правок человек всё равно не листает,
 * а число их он обязан видеть верным.
 */
const DEFAULT_LIMIT = 400;
const MAX_LIMIT = 2000;

/** Роды правок — закрытый словарь; чужое слово в отборе не молчит, а отвергается. */
const KINDS: readonly ChangeKind[] = [
  'money', 'dates', 'comment', 'method', 'subject', 'flag',
  'row-added', 'row-vanished', 'row-cleared', 'other',
];

/** Значение запроса может прийти строкой или списком — сводим к списку. */
function asList(raw: unknown): string[] {
  if (raw === undefined || raw === null || raw === '') return [];
  const items = Array.isArray(raw) ? raw : String(raw).split(',');
  return items.map((s) => String(s).trim()).filter((s) => s !== '');
}

/**
 * Исчезнувшие и появившиеся закупки из сравнения снимков.
 *
 * Сравнение берётся ГОТОВОЕ у /api/integrity (`buildComparison`), а не
 * пересчитывается здесь: два места, читающие снимки своими руками, рано или
 * поздно разойдутся в том, какая пара снимков считается сравнимой.
 */
function vanishedEntries(): { entries: ChangeEntry[]; gaps: ChangeGap[]; comparison: { beforeAt: string; afterAt: string } | null } {
  const { comparison, note } = buildComparison();
  if (comparison === null) {
    return {
      entries: [],
      gaps: [{
        book: 'все книги',
        reason: 'no-previous-snapshot',
        detail:
          `${note} Пока пары снимков нет, исчезнувшие закупки в этом журнале не появятся: ` +
          'журнал книги удаление строки не записывает.',
      }],
      comparison: null,
    };
  }

  const entries: ChangeEntry[] = [];
  for (const book of comparison.books) {
    entries.push(...entriesFromRowDiff(book.dept, {
      vanished: book.vanished.map((v) => ({
        rowSeq: v.rowSeq,
        wasAtSheetRow: v.wasAtSheetRow,
        subject: v.subject || undefined,
        subordinate: v.subordinate || undefined,
        planSum: v.planSum ?? undefined,
        factSum: v.factSum ?? undefined,
      })),
      // Появившиеся закупки книга журнала показывает точнее (с автором и
      // моментом), поэтому из сравнения снимков берём только пропажи —
      // иначе одно добавление приехало бы в список дважды.
      appeared: [],
      moved: [],
      vanishedPlanSum: book.vanishedPlanSum,
      vanishedFactSum: book.vanishedFactSum,
      unkeyed: book.unkeyed,
      note: book.note,
    }));
  }

  const gaps: ChangeGap[] = [];
  for (const book of comparison.books) {
    if (book.unkeyed.before > 0 || book.unkeyed.after > 0) {
      gaps.push({
        book: book.dept,
        reason: 'row-key-missing',
        count: book.unkeyed.before + book.unkeyed.after,
        detail:
          `В книге «${book.dept}» строк без № п/п: было ${book.unkeyed.before}, ` +
          `стало ${book.unkeyed.after}. Их судьбу сравнение проследить не может.`,
      });
    }
  }

  return { entries, gaps, comparison: { beforeAt: comparison.beforeAt, afterAt: comparison.afterAt } };
}

interface Query {
  since?: string;
  book?: string | string[];
  kind?: string | string[];
  author?: string | string[];
  q?: string;
  limit?: string;
}

export async function changeStoryRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: Query }>('/api/change-story', async (request, reply) => {
    // ── Окно ──
    let sinceDay: number | null;
    if (request.query.since !== undefined) {
      sinceDay = dayNumberOf(request.query.since);
      // Мало проверить формат: Date.UTC переваливает «2026-06-31» в 1 июля,
      // и окно тихо стартовало бы с чужой даты (тот же страж, что у /api/changes).
      if (sinceDay === null || isoOfDayNumber(sinceDay) !== request.query.since) {
        return reply.status(400).send({
          error: 'BadRequest',
          message: `Параметр since «${request.query.since}» не является датой YYYY-MM-DD.`,
          statusCode: 400,
          code: 'BAD_REQUEST',
        });
      }
    } else {
      sinceDay = floorToThursday(productCalendarDay(new Date(), config.weeklySnapshot.utcOffsetHours));
    }
    const sinceMs = sinceDay * 86400000;

    const kinds = asList(request.query.kind);
    const unknownKind = kinds.find((k) => !KINDS.includes(k as ChangeKind));
    if (unknownKind !== undefined) {
      return reply.status(400).send({
        error: 'BadRequest',
        message: `Род правки «${unknownKind}» продукту неизвестен. Известные: ${KINDS.join(', ')}.`,
        statusCode: 400,
        code: 'BAD_REQUEST',
      });
    }

    const rawLimit = Number(request.query.limit ?? DEFAULT_LIMIT);
    const limit = Number.isFinite(rawLimit)
      ? Math.min(Math.max(Math.trunc(rawLimit), 1), MAX_LIMIT)
      : DEFAULT_LIMIT;

    // ── Источник первый и третий ──
    const journals = await readAllBookJournals();
    const inputs: ChangeStoryInput[] = journals.map((j) => ({
      book: j.dept,
      journalAvailable: j.available,
      records: j.records,
    }));
    const story = buildChangeStory(inputs, { sinceMs });
    const vanished = vanishedEntries();

    // Один список: правки книги и пропажи из сравнения снимков. Порядок
    // держит ядро — записи без момента впереди, дальше свежие сверху.
    const all = [...story.entries, ...vanished.entries].sort((a, b) => {
      if (a.atMs === null && b.atMs !== null) return -1;
      if (a.atMs !== null && b.atMs === null) return 1;
      if (a.atMs !== null && b.atMs !== null && a.atMs !== b.atMs) return b.atMs - a.atMs;
      return a.id.localeCompare(b.id, 'ru');
    });
    const gaps = [...story.gaps, ...vanished.gaps];

    // Свод — по ВСЕМУ окну, до отбора: краткая глубина отвечает на вопрос
    // «что вообще случилось», а не «что осталось после моих фильтров».
    const digest = summarizeChanges(all, gaps);

    const filtered = filterChangeEntries(all, {
      books: asList(request.query.book),
      kinds: kinds as ChangeKind[],
      authors: asList(request.query.author),
      search: request.query.q,
    });

    return {
      since: isoOfDayNumber(sinceDay),
      digest,
      gaps,
      // Свойство источника, а не итог подсчёта: удаление строки через меню
      // таблицы правок ячеек не создаёт, и журнал книги его не видит.
      deletionsUnobservable: true as const,
      note:
        'Журнал книги записывает правки ячеек: добавление закупки видно как заполнение ' +
        'пустой строки, очистка — как обнуление её ячеек. Удаление строки журнал не ' +
        'записывает вовсе — такие пропажи находятся сравнением снимков по № п/п.',
      /** Пара снимков, по которой найдены пропажи; null — сравнивать не с чем. */
      comparison: vanished.comparison,
      /** Материал чипов отбора — считается по всему окну, а не по показанному. */
      facets: {
        books: bookTally(all),
        authors: authorTally(all),
      },
      total: filtered.length,
      shown: Math.min(filtered.length, limit),
      entries: filtered.slice(0, limit),
    };
  });
}
