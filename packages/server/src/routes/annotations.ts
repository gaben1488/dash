/**
 * /api/annotations/yearlong — пользовательская разметка видов строк стадии
 * «Закупки, проводимые в течение года».
 *
 * КАНОН п.83 (интервью 14.08.2026): строка стадии появляется с подписью
 * «вид не определён», владелец (или назначенный) размечает вид одним кликом
 * из девяти, продукт запоминает. Подстраховочная разметка агента несёт
 * пометку «предварительная» — владелец может исправить в любой момент.
 *
 * Механизм mapping_overrides (metricId → cellRef) сюда не лёг: там ключ —
 * метрика СВОДа, здесь — строка книги (книга + № п/п), и валидация другая
 * (вид строго из девяти). Поэтому — своя маленькая таблица
 * yearlong_kind_overrides того же семейства «оверрайды поверх дефолта»:
 * стартовая разметка 46 строк живёт данными в @aemr/shared
 * (YEARLONG_START_ROWS), пустая таблица = «всё по стартовой разметке».
 */
import type { FastifyInstance } from 'fastify';
import { eq, and } from 'drizzle-orm';
import { z } from 'zod';
import { ALL_DEPT_IDS, YEARLONG_KIND_IDS, YEARLONG_KIND_BY_ID, type YearlongKindId } from '@aemr/shared';
import { db, schema } from '../db/index.js';
import { parseBody } from '../lib/validate.js';

export async function annotationsRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /api/annotations/yearlong
   * Все пользовательские оверрайды видов. Слияние со стартовой разметкой
   * делает клиент (resolveYearlongKind из @aemr/shared): оверрайд побеждает.
   */
  app.get('/api/annotations/yearlong', async (_request, reply) => {
    let overrides: Array<{
      dept: string; ppNum: string; kind: string; provisional: number; updatedAt: string | null; createdAt: string;
    }> = [];
    try {
      overrides = db.select().from(schema.yearlongKindOverrides).all();
    } catch (err) {
      app.log.warn({ err }, 'annotations/yearlong: разметка из БД не прочиталась');
      return reply.status(503).send({
        error: 'Хранилище разметки недоступно — виды показываются по стартовой разметке',
      });
    }
    return reply.send({
      overrides: overrides.map((o) => ({
        dept: o.dept,
        ppNum: o.ppNum,
        kind: o.kind,
        provisional: o.provisional === 1,
        updatedAt: o.updatedAt ?? o.createdAt,
      })),
      total: overrides.length,
    });
  });

  /**
   * PUT /api/annotations/yearlong/:dept/:ppNum
   * Разметить вид строки. Body: { kind, provisional? }.
   * kind: один из девяти id — либо null, чтобы снять оверрайд (вернуться к
   * стартовой разметке или к «вид не определён»).
   */
  const PutSchema = z.object({
    kind: z.string().nullable(),
    provisional: z.boolean().optional(),
  });

  app.put('/api/annotations/yearlong/:dept/:ppNum', async (request, reply) => {
    const { dept, ppNum } = request.params as { dept: string; ppNum: string };
    const body = parseBody(PutSchema, request, reply);
    if (!body) return;

    // Книга — только из восьми канонических (кириллический канон).
    if (!(ALL_DEPT_IDS as readonly string[]).includes(dept)) {
      return reply.status(404).send({
        error: `Книга «${dept}» не найдена — ожидается одно из: ${ALL_DEPT_IDS.join(', ')}`,
      });
    }
    const pp = ppNum.trim();
    if (pp === '') {
      return reply.status(400).send({ error: 'Пустой № п/п: строку без порядкового номера разметить нельзя' });
    }

    // Вид — строго из девяти (п.83); null снимает оверрайд.
    if (body.kind !== null && !(YEARLONG_KIND_IDS as readonly string[]).includes(body.kind)) {
      return reply.status(400).send({
        error: 'Вид не из словаря девяти видов стадии «в течение года»',
        allowed: YEARLONG_KIND_IDS,
      });
    }

    const now = new Date().toISOString();
    const where = and(
      eq(schema.yearlongKindOverrides.dept, dept),
      eq(schema.yearlongKindOverrides.ppNum, pp),
    );

    try {
      if (body.kind === null) {
        db.delete(schema.yearlongKindOverrides).where(where).run();
      } else {
        const existing = db.select().from(schema.yearlongKindOverrides).where(where).get();
        const provisional = body.provisional === true ? 1 : 0;
        if (existing) {
          db.update(schema.yearlongKindOverrides)
            .set({ kind: body.kind, provisional, updatedAt: now })
            .where(where)
            .run();
        } else {
          db.insert(schema.yearlongKindOverrides)
            .values({ dept, ppNum: pp, kind: body.kind, provisional, createdAt: now })
            .run();
        }
      }
    } catch (err) {
      app.log.error({ err }, 'annotations/yearlong: запись разметки не прошла');
      return reply.status(503).send({ error: 'Разметка не сохранилась — хранилище недоступно, попробуйте ещё раз' });
    }

    // Аудит-след: кто когда какую строку каким видом разметил.
    try {
      db.insert(schema.auditLog).values({
        action: 'yearlong_kind_change',
        entity: 'row',
        entityId: `${dept}:${pp}`,
        departmentId: dept,
        newValue: body.kind,
        details: body.kind === null
          ? 'Оверрайд вида снят (возврат к стартовой разметке)'
          : `Вид: ${YEARLONG_KIND_BY_ID.get(body.kind as YearlongKindId)?.label ?? body.kind}${body.provisional ? ' (разметка предварительная)' : ''}`,
        timestamp: now,
      }).run();
    } catch (err) {
      app.log.warn({ err }, 'annotations/yearlong: аудит-запись не прошла');
    }

    return reply.send({
      success: true,
      dept,
      ppNum: pp,
      kind: body.kind,
      provisional: body.provisional === true,
    });
  });
}
