import type { FastifyInstance } from 'fastify';
import { REPORT_MAP } from '@aemr/shared';
import { db, schema } from '../db/index.js';
import { eq } from 'drizzle-orm';
import { batchGetCells } from '../google-sheets.js';
import { z } from 'zod';
import { parseBody } from '../lib/validate.js';

/**
 * CRUD маршруты для конфигурируемого маппинга ячеек.
 *
 * Позволяет менять привязку метрик к ячейкам СВОД ТД-ПМ
 * без изменения кода. Дефолт из report-map.ts + оверрайды из БД.
 */
export async function mappingRoutes(app: FastifyInstance): Promise<void> {

  /**
   * GET /api/mapping
   * Получить полный маппинг (дефолт + оверрайды).
   *
   * Группировка по категориям:
   * - Конкурсные процедуры (КП)
   * - Единственный поставщик (ЕП)
   * - По отделам
   * - Экономия
   */
  app.get('/api/mapping', async (_request, reply) => {
    // Load overrides from DB
    let overrides: Array<{ metricId: string; cellRef: string; sheetName: string | null }> = [];
    try {
      overrides = db.select().from(schema.mappingOverrides).all();
    } catch (err) { app.log.warn({ err }, 'mapping: failed to read overrides'); }
    const overrideMap = new Map(overrides.map(o => [o.metricId, o]));

    // Build grouped response matching frontend expectations
    const categoryMap: Record<string, Array<{
      metricKey: string;
      label: string;
      sourceSheet: string;
      sourceCell: string;
      cellRef: string;
      period: string;
      isOverridden: boolean;
      currentValue: null;
    }>> = {};

    let overriddenCount = 0;

    for (const entry of REPORT_MAP) {
      const cat = categorizeMetric(entry.metricKey);
      if (!categoryMap[cat]) categoryMap[cat] = [];

      const override = overrideMap.get(entry.metricKey);
      const isOverridden = !!override;
      if (isOverridden) overriddenCount++;

      const effectiveSheet = override?.sheetName ?? entry.sourceSheet;
      const effectiveCell = override?.cellRef ?? entry.sourceCell;

      categoryMap[cat].push({
        metricKey: entry.metricKey,
        label: entry.label,
        sourceSheet: effectiveSheet,
        sourceCell: effectiveCell,
        cellRef: `${effectiveSheet}!${effectiveCell}`,
        period: entry.period,
        isOverridden,
        currentValue: null,
      });
    }

    const groups = Object.entries(categoryMap).map(([name, metrics]) => ({
      name,
      metrics,
    }));

    return reply.send({
      groups,
      totalMetrics: REPORT_MAP.length,
      overriddenCount,
    });
  });

  /**
   * PUT /api/mapping/:metricId
   * Изменить привязку метрики к ячейке.
   *
   * Body: { cellRef: string, sheetName?: string, comment?: string }
   */
  const MappingUpdateSchema = z.object({
    cellRef: z.string().regex(/^[A-Z]{1,3}\d{1,4}$/, 'Ожидается формат: D14, AA255'),
    sheetName: z.string().optional(),
    comment: z.string().optional(),
  });

  app.put('/api/mapping/:metricId', async (request, reply) => {
    const { metricId } = request.params as { metricId: string };
    const body = parseBody(MappingUpdateSchema, request, reply);
    if (!body) return;

    // Check metric exists
    const metric = REPORT_MAP.find(m => m.metricKey === metricId);
    if (!metric) {
      return reply.status(404).send({ error: `Метрика "${metricId}" не найдена` });
    }

    const now = new Date().toISOString();
    try {
      // Upsert override
      const existing = db.select().from(schema.mappingOverrides).where(eq(schema.mappingOverrides.metricId, metricId)).get();
      if (existing) {
        db.update(schema.mappingOverrides).set({ cellRef: body.cellRef, sheetName: body.sheetName ?? null, comment: body.comment ?? null, updatedAt: now }).where(eq(schema.mappingOverrides.metricId, metricId)).run();
      } else {
        db.insert(schema.mappingOverrides).values({ metricId, cellRef: body.cellRef, sheetName: body.sheetName ?? null, comment: body.comment ?? null, createdAt: now }).run();
      }
    } catch (err) {
      app.log.warn('Failed to save mapping override: %s', (err as Error).message);
    }

    try {
      db.insert(schema.auditLog).values({ action: 'mapping_change', entity: 'mapping', entityId: metricId, details: `${metric.sourceCell} → ${body.cellRef}`, timestamp: now }).run();
    } catch (err) { app.log.warn({ err }, 'mapping: failed to write audit_log'); }

    return reply.send({
      success: true,
      metricId,
      oldCell: metric.sourceCell,
      newCell: body.cellRef,
      message: `Маппинг метрики "${metric.label}" изменён: ${metric.sourceCell} → ${body.cellRef}`,
    });
  });

  /**
   * POST /api/mapping/validate
   * Проверить все маппинги: запросить значения из Google Sheets.
   */
  app.post('/api/mapping/validate', async (_request, reply) => {
    // Load overrides
    let overrides: Array<{ metricId: string; cellRef: string; sheetName: string | null }> = [];
    try {
      overrides = db.select().from(schema.mappingOverrides).all();
    } catch (err) { app.log.warn({ err }, 'mapping/validate: failed to read overrides'); }
    const overrideMap = new Map(overrides.map(o => [o.metricId, o]));

    // Build ranges for batch fetch
    const entries = REPORT_MAP.map(entry => {
      const override = overrideMap.get(entry.metricKey);
      const sheet = override?.sheetName ?? entry.sourceSheet;
      const cell = override?.cellRef ?? entry.sourceCell;
      return { metricKey: entry.metricKey, label: entry.label, sheet, cell, range: `'${sheet}'!${cell}` };
    });

    const ranges = entries.map(e => e.range);

    try {
      const batchResults = await batchGetCells(ranges);
      const results = entries.map((entry, i) => {
        const br = batchResults[i];
        const rawValue = br?.values?.[0]?.[0] ?? null;
        const hasValue = rawValue != null && String(rawValue).trim() !== '';
        return {
          metricId: entry.metricKey,
          label: entry.label,
          cell: `${entry.sheet}!${entry.cell}`,
          value: hasValue ? rawValue : null,
          status: hasValue ? 'ok' as const : 'empty' as const,
        };
      });

      return reply.send({
        results,
        totalOk: results.filter(r => r.status === 'ok').length,
        totalEmpty: results.filter(r => r.status === 'empty').length,
        totalError: 0,
      });
    } catch (err) {
      // If Google Sheets unavailable, return error status for all
      return reply.send({
        results: entries.map(entry => ({
          metricId: entry.metricKey,
          label: entry.label,
          cell: `${entry.sheet}!${entry.cell}`,
          value: null,
          status: 'error' as const,
          error: (err as Error).message,
        })),
        totalOk: 0,
        totalEmpty: 0,
        totalError: entries.length,
      });
    }
  });

  /**
   * POST /api/mapping/reset
   * Сбросить все оверрайды к дефолтным значениям.
   */
  app.post('/api/mapping/reset', async (_request, reply) => {
    const now = new Date().toISOString();
    try {
      db.delete(schema.mappingOverrides).run();
    } catch (err) { app.log.warn({ err }, 'mapping/reset: failed to delete overrides'); }

    try {
      db.insert(schema.auditLog).values({ action: 'mapping_change', entity: 'mapping', details: 'Все оверрайды сброшены', timestamp: now }).run();
    } catch (err) { app.log.warn({ err }, 'mapping/reset: failed to write audit_log'); }

    return reply.send({
      success: true,
      message: 'Все маппинги сброшены к значениям по умолчанию',
    });
  });
}

/**
 * Категоризация метрики по её ключу.
 */
function categorizeMetric(key: string): string {
  if (key.includes('kp') || key.includes('competitive')) return 'Конкурсные процедуры';
  if (key.includes('ep') || key.includes('single')) return 'Единственный поставщик';
  if (key.includes('grbs') || key.includes('dept')) return 'По отделам';
  if (key.includes('economy') || key.includes('saving')) return 'Экономия';
  return 'Общие';
}
