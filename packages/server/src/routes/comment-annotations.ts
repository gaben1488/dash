/**
 * /api/annotations/comments — сигналы аннотаций «комментарий против структуры».
 *
 * КАНОНЫ (docs/superpowers/audits/2026-08-14-interview-register.md):
 *   - п.72(а) — сигнал по НЕАКТУАЛЬНЫМ комментариям: текст описывает
 *     этапность, противоречащую структурным колонкам; это проверка
 *     СОГЛАСОВАННОСТИ, а не чтение статуса из текста (п.27 в силе);
 *   - п.78 — «просроченное обещание» включён в постоянную работу: карточка
 *     исполнителю «обновите комментарий или проставьте дату заключения»
 *     с адресом ячейки;
 *   - п.74(б) — посторонний текст в AG (колонка номера процедуры) не трётся
 *     молча, а поднимается карточкой «перенести в примечание»;
 *   - п.53 — каждая карточка несёт механизм, адрес и действие с адресатом.
 *
 * Правила считает @aemr/core detectCommentInconsistencies (покрыто тестами
 * волны 14.08); роут только прогоняет их по строкам книг и отдаёт карточки.
 * С существующим потоком issues НЕ смешивается: у замечаний конвейера свой
 * жизненный цикл и словарь проверок, у аннотаций — свой словарь видов;
 * на экране это отдельная секция «Комментарии против структуры».
 */
import type { FastifyInstance } from 'fastify';
import { buildCellDict, findDept } from '@aemr/shared';
import { detectCommentInconsistencies, type CommentAnnotation } from '@aemr/core';
import { readDeptRows } from '../services/dept-rows.js';
import { buildRowDto, isDataRow } from '../services/rows-dto.js';

/** Аннотация ответа: карточка ядра + явный адрес (книга и строка листа). */
export interface CommentAnnotationDto extends CommentAnnotation {
  /** Книга ГРБС (кириллический канон, «УО»/«УЭР»/…). */
  dept: string;
  /** Номер строки ЛИСТА (канон нумерации п.28 — не номер выборки). */
  sheetRow: number;
  /** «№ п/п» из колонки A — стабильный второй адрес: строки листа двигаются,
   *  позиционный sheetRow на момент чтения устаревает (п.98б). */
  rowSeq?: string;
}

export async function commentAnnotationsRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /api/annotations/comments
   * Все аннотации несогласованности по текущему чтению книг (живой кэш,
   * при его пустоте — последний сохранённый снимок). Фильтров нет намеренно:
   * периметр аннотаций — снимок «на сейчас» целиком, срез по периоду был бы
   * лживым бейджем (канон п.58(б)); отбор по книге делает клиент.
   */
  app.get('/api/annotations/comments', async (_request, reply) => {
    const reading = await readDeptRows();
    if (Object.keys(reading.rowsByDept).length === 0) {
      return reply.status(503).send({
        error: 'ServiceUnavailable',
        message:
          'Книги ГРБС не прочитаны и сохранённого снимка нет — сверять комментарии со структурой не по чему. Обновите данные и повторите.',
        statusCode: 503,
      });
    }

    const asOfDate = new Date(reading.asOf);
    const annotations: CommentAnnotationDto[] = [];
    let rowsScanned = 0;

    for (const [sheetName, rows] of Object.entries(reading.rowsByDept)) {
      const dept = findDept(sheetName);
      if (!dept) continue;
      rows.forEach((row, idx) => {
        if (!Array.isArray(row)) return;
        const dto = buildRowDto(row, idx, { deptId: dept.id });
        if (!isDataRow(dto)) return; // служебные строки листа — не закупки
        rowsScanned += 1;
        const found = detectCommentInconsistencies(
          { book: dept.id, sheetRow: dto.rowIndex },
          buildCellDict(row),
          asOfDate,
        );
        // «№ п/п» (сырьё колонки A) — стабильный второй адрес строки (п.98б).
        const rowSeq = String(dto.id ?? '').trim() || undefined;
        for (const a of found) {
          annotations.push({ ...a, dept: dept.id, sheetRow: dto.rowIndex, rowSeq });
        }
      });
    }

    // Счёт по видам — для заголовков секции; ключи те же, что kind карточек.
    const byKind: Record<string, number> = {};
    for (const a of annotations) byKind[a.kind] = (byKind[a.kind] ?? 0) + 1;

    return reply.send({
      /** Момент чтения книг, к которому относятся аннотации (подпись периметра). */
      asOf: reading.asOf,
      /** 'live' — живой кэш книг; 'snapshot' — последний сохранённый снимок. */
      source: reading.source,
      /** Сколько счётных строк реально просканировано (честность пустоты). */
      rowsScanned,
      total: annotations.length,
      byKind,
      annotations,
    });
  });
}
