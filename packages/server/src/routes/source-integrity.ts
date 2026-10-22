/**
 * /api/sources/integrity — состояние ЦЕЛОСТНОСТИ источников: формулы книг и
 * дрейф их оформления.
 *
 * ПОЧЕМУ ОТДЕЛЬНЫЙ МАРШРУТ, А НЕ ПОЛЕ В `GET /api/sources`. Существующий
 * маршрут состояния источников (routes/journal.ts) отвечает на один вопрос —
 * «прочиталась ли книга»: он собирает статус по кэшу снимка и по метаданным
 * загрузки, и все его данные лежат в памяти к моменту запроса. Здесь вопрос
 * другой — «в порядке ли книга внутри»: формулы читаются по уведомлению и
 * ночью, дозор метаданных ходит раз в сутки, и у обоих есть собственное
 * состояние «ещё не смотрели». Свалить их в один ответ значит смешать
 * доступность источника с его качеством и заставить страницу состояния ждать
 * данных, которых у неё нет по расписанию.
 *
 * ПОЧЕМУ НЕ В `/api/integrity`. Тот маршрут считает целостность ПО УЖЕ
 * ПРОЧИТАННЫМ строкам (нумерация, вид ячейки даты, пропавшие строки) — ни
 * одного обращения к Google. Здесь наоборот: всё, что показывается, добыто
 * отдельными обращениями по собственному расписанию. Разные источники правды —
 * разные маршруты.
 *
 * ЧЕСТНОСТЬ ОТВЕТА. Пустой перечень замечаний НЕ означает «всё хорошо». Ответ
 * всегда называет, что именно смотрели: по каким книгам читались формулы и
 * когда, каких книг дозор не касался вовсе (`notWatched`), подключён ли разбор
 * формул (`sinkConnected`). Молчание без этих полей читалось бы как «дефектов
 * нет» — ровно та подмена, которую запрещает канон.
 */
import type { FastifyInstance } from 'fastify';
import { DEPARTMENT_SPREADSHEETS } from '../config.js';
import { currentFormulaSourceProof, formulaDeliveryState, refreshAllSources } from '../services/source-refresh.js';
import { metadataWatchState, sweepMetadata } from '../services/metadata-watch.js';
import { formulaVerdicts } from '../services/formula-sink.js';
import { assessFormulaResults } from '../services/formula-assessment.js';
import { FORMULA_COLUMNS } from '../services/google-sheets.js';
import { sourceIntegrityStorageWarnings } from '../services/source-integrity-state.js';

// A manual deep check has one in-flight run for all callers: two clicks must not
// generate two simultaneous bursts of Google Sheets requests.
let deepCheckInFlight: Promise<DeepSourceCheck> | null = null;

interface DeepSourceCheckBook {
  book: string;
  metadataRead: boolean;
  metadataRemarks: number | null;
  formulasRead: boolean;
  analyzed: boolean;
  formulaCells: number | null;
  rowsJudged: number | null;
  formulaDefects: number | null;
  problems: string[];
}

export interface DeepSourceCheck {
  complete: boolean;
  at: string;
  expectedBooks: number;
  books: DeepSourceCheckBook[];
  changedValueBooks: string[];
  // Deliberately no snapshot ID: manual verification never seals a historical week.
}

export function sourceIntegrityRoutes(app: FastifyInstance): void {
  app.get('/api/sources/integrity', async () => {
    const formulas = formulaDeliveryState();
    const metadata = metadataWatchState();
    const readBooks = new Set(formulas.books.filter(b => b.formulasRead !== false).map((b) => b.book));

    return {
      at: new Date().toISOString(),
      storage: { warnings: sourceIntegrityStorageWarnings() },
      formulas: {
        /** Какие колонки вообще читаются — чтобы «не найдено» имело границу. */
        columns: [...FORMULA_COLUMNS],
        /** Подключён ли разбор формул (слой целостности в ядре). */
        sinkConnected: formulas.sinkConnected,
        books: formulas.books,
        /**
         * Вердикты разбора: сколько строк судилось и какие дефекты найдены.
         * Книги нет в перечне — её формулы не разбирались ни разу; это не
         * то же самое, что «дефектов нет» (различие сторожит страж).
         */
        assessment: assessFormulaResults(Object.keys(DEPARTMENT_SPREADSHEETS), formulas.books, formulaVerdicts()),
        verdicts: formulaVerdicts().map((v) => ({
          book: v.book,
          at: v.at,
          matchesLatestDelivery: formulas.books.some(b => b.book === v.book
            && b.handled && b.persisted !== false && b.at === v.at),
          rowsJudged: v.rowsJudged,
          defects: v.defects.length,
          cells: v.defects.map((d) => ({
            cell: d.cell,
            column: d.column,
            row: d.row,
            purchase: d.rowSeq,
            kind: d.kind,
            actual: d.actual,
            etalon: d.etalon,
            donorRow: d.etalonRow,
          })),
        })),
        /**
         * Книги, по которым последнее наблюдение не подтверждает чтения.
         * Отказ Google не должен выглядеть как проверка формул.
         */
        notRead: Object.keys(DEPARTMENT_SPREADSHEETS)
          .filter((book) => !readBooks.has(book))
          .sort(),
      },
      metadata: {
        canonSyncedAt: metadata.canonSyncedAt,
        books: metadata.books,
        lastConfirmed: metadata.lastConfirmed,
        notWatched: metadata.notWatched,
      },
    };
  });
  /**
   * Ручная углублённая проверка — только чтение. Штатные webhook и
   * недельная фиксация живут отдельно. Не вызываем getSnapshot(true),
   * не создаём исторический срез и не требуем существования первого четверга.
   *
   * Проверяем фактическую доставку ЭТОГО запуска, а не старые удачные
   * записи в памяти: иначе неответившая книга выглядит как «замечаний нет».
   */
  app.post('/api/sources/integrity/check', async () => performDeepSourceCheck(app));
}

/** Reuse the exact durable-backed deep inspection in all diagnostic routes. */
export async function performDeepSourceCheck(app: FastifyInstance): Promise<DeepSourceCheck> {
    if (!deepCheckInFlight) {
      deepCheckInFlight = (async (): Promise<DeepSourceCheck> => {
        const log = {
          info: (message: string) => app.log.info(message),
          warn: (message: string) => app.log.warn(message),
        };
        const metadataResults = await sweepMetadata(log);
        // askDrive:false is essential: withFormulas:true alone is a hint, not
        // a forced read on the current refresh contract.
        const refresh = await refreshAllSources(log, 'request', {
          withFormulas: true, fresh: true, askDrive: false, svod: false,
        });
        const deliveries = formulaDeliveryState();
        const verdicts = formulaVerdicts();
        const expected = Object.keys(DEPARTMENT_SPREADSHEETS).sort();
        const books: DeepSourceCheckBook[] = expected.map((book) => {
          const metadata = metadataResults.find((item) => item.book === book);
          const delivery = deliveries.books.find((item) => item.book === book && item.at === refresh.at);
          const verdict = verdicts.find((item) => item.book === book && item.at === refresh.at);
          const metadataRead = metadata?.read === true && metadata.persisted !== false;
          const formulasRead = refresh.loaded.includes(book) && delivery !== undefined
            && delivery.formulasRead !== false;
          const analyzed = formulasRead && delivery.handled && delivery.persisted !== false
            && verdict !== undefined;
          const problems: string[] = [];
          if (!metadataRead) problems.push(metadata?.persisted === false
            ? 'результат проверки настроек не сохранён'
            : metadata?.skippedBecause ?? 'настройки не прочитаны');
          if (refresh.failed.includes(book)) problems.push('значения или формулы книги не получены');
          if (!formulasRead) problems.push('формулы этого запуска не прочитаны');
          else if (delivery.persisted === false) problems.push('результат проверки формул не сохранён');
          else if (!delivery.handled) problems.push(delivery.failedBecause ?? 'разбор формул не выполнен');
          else if (!analyzed) problems.push('вердикт разбора формул не подтверждён');
          return {
            book, metadataRead, metadataRemarks: metadataRead ? metadata.remarks.length : null,
            formulasRead, analyzed,
            formulaCells: formulasRead ? delivery.cells : null,
            rowsJudged: analyzed ? verdict.rowsJudged : null,
            formulaDefects: analyzed ? verdict.defects.length : null,
            problems,
          };
        });
        return {
          complete: expected.length > 0 && deliveries.sinkConnected && books.every((book) => book.problems.length === 0),
          at: new Date().toISOString(),
          expectedBooks: expected.length,
          books,
          changedValueBooks: refresh.changedBooks,
        };
      })().finally(() => { deepCheckInFlight = null; });
    }
    return deepCheckInFlight;

}
