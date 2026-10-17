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
  'row-added', 'row-vanished', 'row-identity-candidate', 'row-cleared', 'other',
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
function vanishedEntries(): { entries: ChangeEntry[]; gaps: ChangeGap[]; comparison: { baselineId: string; beforeAt: string; afterAt: string; oldestCurrentAt: string } | null; note: string } {
  const { comparison, note } = buildComparison();
  if (comparison === null) {
    return {
      entries: [],
      gaps: [{
        book: 'все книги',
        reason: 'no-previous-snapshot',
        detail:
          `${note} Пока нет сопоставимых текущих данных и контроля, ` +
          'нельзя устанавливать отсутствие прежних номеров: журнал книги удаление строк не регистрирует.',
      }],
      comparison: null,
      note,
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
      ambiguousKeys: book.ambiguousKeys,
      identityCandidates: book.identityCandidates,
      contextChanged: book.contextChanged,
      note: book.note,
    }, {
      baselineId: comparison.baselineId,
      controlAt: comparison.beforeAt,
      observedAt: book.currentAt,
    }));
  }

  const gaps: ChangeGap[] = comparison.unavailableBooks.map((unread) => ({
    book: unread.dept,
    reason: 'source-unavailable',
    detail: 'Книга «' + unread.dept + '» не сверена с недельным контролем: ' +
      unread.reason + '. Отсутствие данных не равно отсутствию изменений.',
  }));
  for (const book of comparison.books) {
    const duplicates = [...new Set([
      ...book.ambiguousKeys.before, ...book.ambiguousKeys.after,
    ])];
    if (duplicates.length > 0) gaps.push({
      book: book.dept,
      reason: 'row-key-ambiguous',
      count: duplicates.length,
      detail: 'В книге «' + book.dept + '» неоднозначные № п/п: ' +
        duplicates.join(', ') + '. Их преемственность без уточнения не утверждается.',
    });
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

  return { entries, gaps, note, comparison: { baselineId: comparison.baselineId, beforeAt: comparison.beforeAt, afterAt: comparison.afterAt, oldestCurrentAt: comparison.oldestCurrentAt } };
}

/** Окно журнала опирается на подтверждённый контроль, а не календарную попытку среза. */
export function changeStoryDefaultWindow(
  comparison: { beforeAt: string } | null,
  now: Date = new Date(),
  offsetHours: number = config.weeklySnapshot.utcOffsetHours,
): { sinceDay: number; sinceMs: number } {
  if (comparison) {
    const controlAt = new Date(comparison.beforeAt);
    return { sinceDay: productCalendarDay(controlAt, offsetHours), sinceMs: controlAt.getTime() };
  }
  // Это лишь доступное окно журнала: comparison=null и gaps явно сохраняют
  // отсутствие контроля, не объявляя окно завершённой недельной сверкой.
  const sinceDay = floorToThursday(productCalendarDay(now, offsetHours));
  return { sinceDay, sinceMs: sinceDay * 86400000 };
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
    const vanished = vanishedEntries();
    let sinceDay: number | null;
    let sinceMs: number;
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
      sinceMs = sinceDay * 86400000;
    } else {
      ({ sinceDay, sinceMs } = changeStoryDefaultWindow(vanished.comparison));
    }

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
        (vanished.note ? vanished.note + ' ' : '') +
        'Журнал книги записывает правки ячеек: добавление закупки видно как заполнение ' +
        'пустой строки, очистка — как обнуление её ячеек. Удаление строки журнал не ' +
        'записывает вовсе. Отсутствие прежнего номера, перемена его содержания и ' +
        'возможная перенумерация проверяются по последнему подтверждённому недельному ' +
        'контрольному снимку и текущим достоверным чтениям книг. Причина и автор ' +
        'не выводятся из одного сравнения — для них требуются дополнительные свидетельства.',
      /** Контрольный снимок и диапазон текущих чтений; null — сверки нет. */
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
