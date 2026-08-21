/**
 * /api/monitoring — «Реестр процедур определения поставщика» из книги
 * «Ежедневный мониторинг» (канон п.69в: отдельная вкладка; п.101а: название,
 * перенос ВСЕХ листов книги, своя аналитика, своя сверка, свои сигналы,
 * маппинг с книгами ГРБС по каждой строке).
 *
 * Спека: docs/superpowers/specs/2026-08-18-monitoring-tab-spec-v2.md.
 *
 * Три роута, потому что три разных вопроса и три разные цены ответа:
 *   GET /api/monitoring           — что в книге: реестр, свод, переходящий
 *                                   реестр, справочник, листы-предки, сигналы;
 *   GET /api/monitoring/analytics — чего книга не умеет: воронка, три
 *                                   коэффициента снижения, поставщики и
 *                                   концентрация, сроки, сезонность, аномалии;
 *   GET /api/monitoring/match     — сверка с книгами ГРБС построчно и
 *                                   внутренняя сверка «лист ↔ 25-26»;
 *   GET /api/monitoring/triple    — тройная сверка одной закупки: книга ГРБС
 *                                   ↔ лист управления ↔ переходящий реестр.
 *
 * Роуты — тонкие адаптеры: чтение листов — services/monitoring.ts (кэш,
 * дедупликация, честные отказы по листам), разбор и счёт — @aemr/core
 * (чистые функции под юнит-тестами). Собственной счётной семантики здесь нет.
 *
 * Правила ответа, общие для всех четырёх:
 *  - деньги — РУБЛИ (решение владельца 18.08; книги ГРБС — тысячи), и ответ
 *    называет единицу прямо в source.moneyUnit — экран обязан её подписать;
 *  - момент чтения книги едет в source.readAt — плашка периода данных (п.58);
 *  - непрочитанные листы перечислены поимённо (source.sheetsFailed) — счёт
 *    по прочитанным листам объявляется неполным, а не выдаётся за целый;
 *  - искажение формата (код процедуры, сумма текстом, невозможная дата) —
 *    сигнал с адресом, а не молчаливая потеря строки.
 */
import type { FastifyInstance } from 'fastify';
import { collectRowsByDept } from '@aemr/shared';
import {
  MONITORING_ANCESTOR_SHEETS,
  MONITORING_DATA_SHEETS,
  MONITORING_MISSING_FIELDS,
  bookRowsForMatch,
  bookSide,
  buildMonitoringSignals,
  internalDiff,
  journalSide,
  mappingSignals,
  matchMonitoring,
  monitoringAnalytics,
  procedureRowsForMatch,
  sheetSide,
  summarizeMatch,
  tripleCheck,
  type MonitoringAggregates,
  type MonitoringAnalytics,
  type MonitoringDirectory,
  type MonitoringJournal,
  type MonitoringProcedure,
  type MonitoringSignal,
  type MonitoringSvod,
  type SeasonBasis,
  type SvodComparison,
  type UnparsedCodeRef,
} from '@aemr/core';
import { getMonitoringBook, type MonitoringBookSnapshot } from '../services/monitoring.js';
import { parsedMonitoringBook, type ParsedMonitoringBook } from '../services/monitoring-parsed.js';
import { getDeptSheetValues } from '../services/snapshot.js';

/** Плашка периметра: откуда числа, на какой момент и в чём измерены. */
export interface MonitoringSource {
  /** Название книги-источника — для плашки периметра. */
  bookName: string;
  /** Момент чтения книги (ISO) — «данные на …» (п.58). */
  readAt: string;
  /** Единица денег ответа. Книги ГРБС — тысячи; здесь — рубли (18.08). */
  moneyUnit: 'руб';
  sheetsRead: string[];
  /** Лист → русская причина отказа. Пусто — прочитано всё. */
  sheetsFailed: Record<string, string>;
  /** Сколько листов книги продукт читает данными всего (одиннадцать видимых). */
  sheetsExpected: number;
}

export interface MonitoringResponsePayload {
  source: MonitoringSource;
  procedures: MonitoringProcedure[];
  aggregates: MonitoringAggregates;
  /** Лист СВОДНЫЙ книги плюс контроль и пара «книга ↔ продукт». */
  svod: {
    book: MonitoringSvod;
    comparison: SvodComparison;
  };
  /** Переходящий реестр «25-26»: судьба процедуры и родословная. */
  journal: MonitoringJournal;
  /** Справочник учреждений и написания заказчика вне его. */
  directory: MonitoringDirectory;
  /** Скрытые листы-предки: показываются формой, данных там ноль. */
  ancestors: {
    sheets: typeof MONITORING_ANCESTOR_SHEETS;
    missingFields: readonly string[];
  };
  signals: MonitoringSignal[];
  unparsedCodes: UnparsedCodeRef[];
  notes: string[];
}

export interface MonitoringAnalyticsPayload {
  source: MonitoringSource;
  analytics: MonitoringAnalytics;
  notes: string[];
}

/**
 * Разбор книги целиком — общая часть четырёх роутов.
 *
 * Сам разбор живёт в services/monitoring-parsed.ts и привязан к номеру
 * содержимого книги: четыре маршрута вкладки, открытые подряд, разбирают одну
 * и ту же книгу ОДИН раз, а не четыре. Замер 21.08.2026: разбор живой книги —
 * 95,3 мс, то есть 381 мс на открытие вкладки уходило на повторение уже
 * сделанной работы.
 */
function parseBook(book: MonitoringBookSnapshot): ParsedMonitoringBook {
  return parsedMonitoringBook(book);
}

/** Плашка периметра из снимка книги. Порядок листов — канонический, не сетевой. */
function sourceOf(book: MonitoringBookSnapshot): MonitoringSource {
  return {
    bookName: 'Ежедневный мониторинг',
    readAt: book.readAt,
    moneyUnit: 'руб',
    sheetsRead: MONITORING_DATA_SHEETS.filter((sheet) => sheet in book.sheets),
    sheetsFailed: book.failed,
    sheetsExpected: MONITORING_DATA_SHEETS.length,
  };
}

/** Общие оговорки ответа: единица денег и поимённая неполнота. */
function commonNotes(book: MonitoringBookSnapshot): string[] {
  const notes: string[] = [
    'Деньги книги мониторинга — в рублях (книги управлений ведутся в тысячах рублей).',
  ];
  const failedNames = Object.keys(book.failed);
  if (failedNames.length > 0) {
    notes.push(
      `Листы не прочитаны: ${failedNames.join(', ')} — счётчики собраны только по прочитанным листам и неполные.`,
    );
  }
  return notes;
}

/** Книга целиком не прочитана — 503 с русской причиной, а не пустой 200. */
const BOOK_UNAVAILABLE = {
  error: 'ServiceUnavailable',
  message:
    'Книга «Ежедневный мониторинг» не прочитана: ни один лист не ответил. '
    + 'Повторите запрос позже.',
  statusCode: 503,
};

export async function monitoringRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: { refresh?: string } }>('/api/monitoring', async (request, reply) => {
    const book = await getMonitoringBook(request.query.refresh === 'true');
    if (Object.keys(book.sheets).length === 0) {
      return reply.status(503).send(BOOK_UNAVAILABLE);
    }

    const { registry, journal, svod, directory, aggregates, comparison } = parseBook(book);
    const signals = buildMonitoringSignals({
      procedures: registry.procedures,
      journal,
      directory,
      svod,
    });

    const notes = commonNotes(book);
    if (registry.unparsedCodes.length > 0) {
      notes.push(
        `Строк с нераспознанным кодом процедуры: ${registry.unparsedCodes.length} — они входят в счётчики, адреса перечислены отдельно.`,
      );
    }
    // Разрыв свода и нашего счёта — не «ошибка продукта», а факт книги: его
    // называют вслух вместе с причиной (спека §2.2).
    const nmckBook = comparison.bookTotals.nmck;
    if (nmckBook !== null && Math.abs(comparison.productTotals.nmck - nmckBook) >= 0.005) {
      notes.push(
        'Свод книги и наш счёт по листам расходятся: часть сумм в книге записана текстом, и формула СУММ их не складывает. Обе стороны показаны рядом.',
      );
    }
    if (journal.outsideFilterCount > 0) {
      notes.push(
        `Строк переходящего реестра ниже области автофильтра книги: ${journal.outsideFilterCount} — в самой книге при работе с фильтром они не видны.`,
      );
    }

    return {
      source: sourceOf(book),
      procedures: registry.procedures,
      aggregates,
      svod: { book: svod, comparison },
      journal,
      directory,
      ancestors: {
        sheets: MONITORING_ANCESTOR_SHEETS,
        missingFields: MONITORING_MISSING_FIELDS,
      },
      signals,
      unparsedCodes: registry.unparsedCodes,
      notes,
    } satisfies MonitoringResponsePayload;
  });

  /**
   * Аналитика вкладки. Основание каждого числа названо в самом ответе:
   * три коэффициента снижения приезжают вместе со своими знаменателями,
   * чтобы их нельзя было подменить друг другом на экране.
   */
  app.get<{ Querystring: { refresh?: string; basis?: string } }>(
    '/api/monitoring/analytics',
    async (request, reply) => {
      const book = await getMonitoringBook(request.query.refresh === 'true');
      if (Object.keys(book.sheets).length === 0) {
        return reply.status(503).send(BOOK_UNAVAILABLE);
      }

      const { registry } = parseBook(book);
      const basis: SeasonBasis = request.query.basis === 'auction' ? 'auction' : 'publication';
      const analytics = monitoringAnalytics(registry.procedures, { seasonBasis: basis });

      const notes = commonNotes(book);
      notes.push(
        'Коэффициентов снижения три, и знаменатели у них разные: портфельный делит деньги на деньги, построчный — проценты на число процедур, третий — только на те процедуры, где снижение вообще было.',
      );
      notes.push(
        basis === 'auction'
          ? 'Сезонность построена по дате проведения торгов.'
          : 'Сезонность построена по дате публикации.',
      );
      if (analytics.seasonality.undated > 0) {
        notes.push(
          `Процедур без выбранной даты: ${analytics.seasonality.undated} — в сезонность они не входят.`,
        );
      }
      notes.push(
        'Количества заявок от поставщиков в нынешней форме книги нет, поэтому конкуренция оценивается косвенно — по факту снижения и по тексту исхода.',
      );

      return {
        source: sourceOf(book),
        analytics,
        notes,
      } satisfies MonitoringAnalyticsPayload;
    },
  );

  /**
   * Сверка. Внешняя — с книгами ГРБС по каждой строке (ключ: код процедуры,
   * единицы: книги — тысячи, мониторинг — рубли). Внутренняя — лист
   * управления против переходящего реестра. Правой стороны продукт не
   * выбирает: он называет расхождение и его размер.
   */
  app.get<{ Querystring: { refresh?: string } }>('/api/monitoring/match', async (request, reply) => {
    const book = await getMonitoringBook(request.query.refresh === 'true');
    if (Object.keys(book.sheets).length === 0) {
      return reply.status(503).send(BOOK_UNAVAILABLE);
    }

    const { registry, journal } = parseBook(book);
    const rowsByBook = collectRowsByDept(getDeptSheetValues());
    const booksRead = Object.keys(rowsByBook).sort();
    const bookRows = bookRowsForMatch(rowsByBook);
    const procedureRows = procedureRowsForMatch(registry.procedures, journal.rows);
    const result = matchMonitoring(bookRows, procedureRows);
    const summary = summarizeMatch(result, bookRows.length, procedureRows.length);
    const internal = internalDiff(registry.procedures, journal.rows);

    const notes = commonNotes(book);
    notes.push(
      'Единицы сторон разные: книги управлений хранят тысячи рублей, мониторинг — рубли; перед сравнением план и факт книги умножены на тысячу.',
    );
    if (booksRead.length === 0) {
      notes.push(
        'Книги управлений не прочитаны — внешняя сверка пуста. Это состояние источника, а не отсутствие расхождений.',
      );
    } else {
      notes.push(
        `Книги управлений в сверке: ${booksRead.join(', ')} — коды процедур читаются из колонки AG.`,
      );
    }
    notes.push(
      'Один код в нескольких книгах — штатная форма совместной закупки: каждое управление ведёт свою долю. Повтор внутри одной книги — аномалия заполнения.',
    );

    return {
      source: sourceOf(book),
      books: { read: booksRead, rowsWithCode: bookRows.length },
      summary,
      matched: result.matched,
      bookOnly: result.bookOnly,
      monitoringOnly: result.monitoringOnly,
      ambiguous: result.ambiguous,
      listCells: result.listCells,
      internal,
      signals: mappingSignals(result),
      notes,
    };
  });

  /**
   * Тройная сверка одной закупки (требование владельца 21.08.2026: сверять
   * не только движок против листа, а данные по закупкам). Три независимые
   * записи одной процедуры — строка книги ГРБС, строка листа управления и
   * строка переходящего реестра «25-26» — сводятся по коду процедуры, три
   * величины (начальная цена, факт против цены победителя, экономия)
   * сравниваются попарно.
   *
   * Ради чего третья запись: двусторонняя сверка умеет сказать «не сходится»,
   * но не умеет сказать, КТО отстал. Когда две записи держат одно число, а
   * третья — другое, ответ виден (поле outlier). Правой стороны продукт всё
   * равно не выбирает — он показывает большинство и адреса всех сторон.
   */
  app.get<{ Querystring: { refresh?: string } }>('/api/monitoring/triple', async (request, reply) => {
    const book = await getMonitoringBook(request.query.refresh === 'true');
    if (Object.keys(book.sheets).length === 0) {
      return reply.status(503).send(BOOK_UNAVAILABLE);
    }

    const { registry, journal } = parseBook(book);
    const rowsByBook = collectRowsByDept(getDeptSheetValues());
    const booksRead = Object.keys(rowsByBook).sort();
    const result = tripleCheck({
      readAt: book.readAt,
      bookRows: bookSide(rowsByBook),
      sheetRows: sheetSide(registry.procedures),
      journalRows: journalSide(journal.rows),
    });

    const notes = commonNotes(book);
    notes.push(
      'Стороны сверки три: книга ГРБС (тысячи рублей), лист управления книги мониторинга и переходящий реестр «25-26» (рубли). Перед сравнением план, факт и экономия книги ГРБС умножены на тысячу.',
    );
    notes.push(
      'Допуск сравнения разный по природе хранения: пары с книгой ГРБС терпят десять рублей или один процент (книга держит тысячи с двумя знаками), пара «лист ↔ переходящий реестр» — полкопейки.',
    );
    if (booksRead.length === 0) {
      notes.push(
        'Книги управлений не прочитаны — третьей стороны в сверке нет. Это состояние источника, а не отсутствие расхождений.',
      );
    } else {
      notes.push(`Книги управлений в сверке: ${booksRead.join(', ')}.`);
    }
    notes.push(
      'Код, набранный с опечаткой, к паре не приводится: догадка показывается рядом со строкой, но мост по ней не строится. Предмет служит вторым ключом — он подтверждает пару и подсказывает кандидата, но не соединяет вместо кода.',
    );

    return {
      source: sourceOf(book),
      books: { read: booksRead },
      summary: result.summary,
      rows: result.rows,
      orphans: result.orphans,
      notes,
    };
  });
}
