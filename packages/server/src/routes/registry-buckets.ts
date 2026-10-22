/**
 * /api/registry/buckets — честные счётчики двух корзин Реестра (канон п.73в):
 *
 *   - «Закупки, не обеспеченные финансированием» (имя класса — канон п.23):
 *     структурно это сигнал planYearMissing — способ и плановые деньги есть,
 *     а графа «Год (план)» пуста; формулы официального листа СВОД такие
 *     строки не видят.
 *   - «Закупки, проводимые в течение года» (канон п.71): ЕП + заглушка в дате
 *     заключения + факт больше нуля — ровно те строки, чей факт и экономию
 *     отсекают формулы свода (план — входит).
 *
 * Счётчик на кнопке навигации обязан быть честным: он считается по тем же
 * строкам и тем же предикатам, что и страницы-фильтры Реестра, — за весь год,
 * по всем управлениям, на момент чтения книг. Нет данных — 503, а не ноль.
 */
import type { FastifyInstance } from 'fastify';
import { findDept, REGISTRY_BUCKETS, type RegistryBucketTotals } from '@aemr/shared';
import { readDeptRows } from '../services/dept-rows.js';
import { buildRowDto, isDataRow } from '../services/rows-dto.js';

/**
 * Объявленной формы ответа у этого маршрута намеренно нет.
 *
 * Соблазн её объявить понятен: тело короткое, состав известен, а
 * `additionalProperties: false` превращает соглашение с вебом в проверяемое.
 * Но у строгой сборки есть и обратная сторона: поле, добавленное в ответ и
 * забытое в объявлении, ВЫРЕЗАЕТСЯ молча — и обнаружит это не прогон, а
 * читатель с пустым счётчиком на кнопке навигации. Такой размен оправдан там,
 * где строгость закрывает дверь наружу (публичный /api/health), и не оправдан
 * здесь, где маршрут за ключом доступа, а выигрыша в скорости объявленная форма
 * на этой сборке Node не даёт вовсе (замер: routes/changes-serialization.test.ts).
 */
export async function registryBucketsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/registry/buckets', async (_request, reply) => {
    const reading = await readDeptRows();
    if (Object.keys(reading.rowsByDept).length === 0 || !reading.asOf) {
      return reply.status(503).send({
        error: 'ServiceUnavailable',
        message:
          'Книги ГРБС не прочитаны и сохранённого снимка нет — считать корзины не по чему. Обновите данные и повторите.',
        statusCode: 503,
        code: 'SERVICE_UNAVAILABLE',
      });
    }

    const unfunded: RegistryBucketTotals = { rows: 0, planSum: 0, initiativeRows: 0 };
    const yearlong: RegistryBucketTotals = { rows: 0, planSum: 0 };

    for (const [sheetName, rows] of Object.entries(reading.rowsByDept)) {
      const dept = findDept(sheetName);
      if (!dept) continue;
      rows.forEach((row, idx) => {
        if (!Array.isArray(row)) return;
        const dto = buildRowDto(row, idx, { deptId: dept.id });
        if (!isDataRow(dto)) return;
        if (REGISTRY_BUCKETS.unfunded.predicate(dto)) {
          unfunded.rows += 1;
          if (dto.signals.includes('initiativeRequest')) unfunded.initiativeRows! += 1;
          unfunded.planSum += dto.planSum;
        }
        if (REGISTRY_BUCKETS.yearlong.predicate(dto)) {
          yearlong.rows += 1;
          yearlong.planSum += dto.planSum;
        }
      });
    }

    return reply.send({
      /** Момент чтения книг — периметр счётчиков (канон п.58). */
      asOf: reading.asOf,
      source: reading.source,
      coverage: reading.coverage,
      unfunded,
      yearlong,
    });
  });
}
