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
import { formulaDeliveryState } from '../services/source-refresh.js';
import { metadataWatchState } from '../services/metadata-watch.js';
import { formulaVerdicts } from '../services/formula-sink.js';
import { FORMULA_COLUMNS } from '../services/google-sheets.js';

export function sourceIntegrityRoutes(app: FastifyInstance): void {
  app.get('/api/sources/integrity', async () => {
    const formulas = formulaDeliveryState();
    const metadata = metadataWatchState();
    const readBooks = new Set(formulas.books.map((b) => b.book));

    return {
      at: new Date().toISOString(),
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
        verdicts: formulaVerdicts().map((v) => ({
          book: v.book,
          at: v.at,
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
         * Книги, по которым формулы не читались НИ РАЗУ за жизнь службы.
         * Отдельным полем, а не пропуском: пропуск читается как «чисто».
         */
        notRead: Object.keys(DEPARTMENT_SPREADSHEETS)
          .filter((book) => !readBooks.has(book))
          .sort(),
      },
      metadata: {
        canonSyncedAt: metadata.canonSyncedAt,
        books: metadata.books,
        notWatched: metadata.notWatched,
      },
    };
  });
}
