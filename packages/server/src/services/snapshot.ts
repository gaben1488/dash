import { runPipeline, type PipelineInput } from '@aemr/core';
import { REPORT_MAP, getAllCellAddresses, getActiveRules, ALL_SHEETS, SVOD_SHEET_NAME } from '@aemr/shared';
import type { DataSnapshot, NormalizedMetric } from '@aemr/shared';
import { batchGetCells, batchGetFormulas, getSheetData } from '../google-sheets.js';
import { fetchSHDYUSheet } from './google-sheets.js';
import { parseSHDYUSheet } from '@aemr/core';
import { SHDYU_SPREADSHEET_ID } from '../config.js';
import { db, schema } from '../db/index.js';
import { config } from '../config.js';
import { eq, desc } from 'drizzle-orm';
import { createDemoSnapshot } from './demo-data.js';

/** Per-year snapshot cache: key is targetYear (number) */
const cachedSnapshots = new Map<number, { snapshot: DataSnapshot; timestamp: number }>();

/**
 * Кэш данных из отдельных таблиц управлений.
 * Заполняется при вызове loadAllSources / fetchDepartmentSpreadsheets.
 * Ключи — русские короткие имена ('УЭР', 'УИО', …).
 */
let cachedDeptSheetData: Record<string, unknown[][]> = {};

/** Обновить кэш данных управлений (вызывается из index.ts / dashboard route) */
export function setDeptSheetCache(data: Record<string, unknown[][]>): void {
  cachedDeptSheetData = { ...cachedDeptSheetData, ...data };
}

/** Получить текущий кэш данных управлений */
export function getDeptSheetCache(): Record<string, unknown[][]> {
  return cachedDeptSheetData;
}

/**
 * Метаданные загрузки отдельных таблиц управлений.
 * Обновляется после fetchDepartmentSpreadsheets.
 */
interface DeptLoadMeta {
  loadedAt: string;
  rowCount: number;
  sheetName: string;
  error?: string;
}

let deptLoadMeta: Record<string, DeptLoadMeta> = {};

/** Обновить метаданные загрузки управлений */
export function setDeptLoadMeta(meta: Record<string, DeptLoadMeta>): void {
  deptLoadMeta = { ...deptLoadMeta, ...meta };
}

/** Получить метаданные загрузки управлений */
export function getDeptLoadMeta(): Record<string, DeptLoadMeta> {
  return deptLoadMeta;
}

/** Cached SHDYU (monthly dynamics) data */
let cachedSHDYUData: Record<string, any> | null = null;
/** Raw row count from ШДЮ sheet (before parsing into blocks) */
let cachedSHDYURawRowCount = 0;

/** Get SHDYU data from cache */
export function getSHDYUCache(): Record<string, any> | null {
  return cachedSHDYUData;
}

/** Get raw row count from ШДЮ sheet */
export function getSHDYURawRowCount(): number {
  return cachedSHDYURawRowCount;
}

/** Set SHDYU data cache */
export function setSHDYUCache(data: Record<string, any>): void {
  cachedSHDYUData = data;
}

/**
 * Получает актуальный снимок данных (с кэшированием per year)
 * @param force — пропустить кэш
 * @param targetYear — целевой год (по умолчанию текущий)
 */
export async function getSnapshot(force = false, targetYear?: number): Promise<DataSnapshot> {
  const year = targetYear ?? new Date().getFullYear();
  const now = Date.now();
  const ttl = config.cache.ttlSeconds * 1000;

  const cached = cachedSnapshots.get(year);
  if (!force && cached && (now - cached.timestamp) < ttl) {
    return cached.snapshot;
  }

  const snapshot = await createSnapshot(year);
  cachedSnapshots.set(year, { snapshot, timestamp: now });

  return snapshot;
}

/**
 * Создаёт новый снимок: читает данные из Google Sheets и прогоняет пайплайн
 */
async function createSnapshot(targetYear: number): Promise<DataSnapshot> {
  try {
    // 1. Читаем официальные ячейки
    const cellAddresses = getAllCellAddresses();
    const [batchValues, batchFormulas] = await Promise.all([
      batchGetCells(cellAddresses),
      batchGetFormulas(cellAddresses),
    ]);

    // Объединяем значения и формулы
    const batchGetData = batchValues.map((v, i) => ({
      range: v.range,
      values: v.values,
      formulas: batchFormulas[i]?.formulas,
    }));

    // 2. Читаем листы для построчного анализа + ШДЮ параллельно
    const sheetRows: Record<string, unknown[][]> = {};
    const sheetReadPromises = ALL_SHEETS.map(async (sheetName: string) => {
      try {
        const rows = await getSheetData(sheetName);
        sheetRows[sheetName] = rows;
      } catch (error) {
        console.warn(`Не удалось прочитать лист "${sheetName}":`, error);
      }
    });

    // Read ШДЮ sheet in parallel (from СВОД_для_Google spreadsheet)
    const shdyuPromise = fetchSHDYUSheet(SHDYU_SPREADSHEET_ID).then((rows: unknown[][]) => {
      if (rows.length > 0) {
        const parsed = parseSHDYUSheet(rows);
        cachedSHDYUData = parsed;
        cachedSHDYURawRowCount = rows.length;
        console.log(`📊 ШДЮ: ${rows.length} строк, ${Object.keys(parsed).length} ГРБС`);
      }
    }).catch((err: unknown) => {
      console.warn('Не удалось загрузить ШДЮ:', err);
    });

    await Promise.all([...sheetReadPromises, shdyuPromise]);

    // 2b. Дополняем данными из отдельных таблиц управлений (если они закэшированы).
    // Это критично для пересчёта/дельт: если в СВОД нет листов управлений,
    // данные берутся из отдельных spreadsheets.
    for (const [deptName, rows] of Object.entries(cachedDeptSheetData)) {
      if (!sheetRows[deptName] || sheetRows[deptName].length === 0) {
        if (rows.length > 0) {
          sheetRows[deptName] = rows;
          console.log(`📋 Лист "${deptName}": ${rows.length} строк из кэша отдельных таблиц`);
        }
      }
    }

    // 3. Запускаем пайплайн
    // Target year from caller (defaults to current year).
    // СВОД reports per-year totals via COUNTIFS with year condition.
    // Department sheets contain multi-year data; we filter to match scope.
    const pipelineInput: PipelineInput = {
      batchGetData,
      sheetRows,
      reportMap: REPORT_MAP,
      rules: getActiveRules(),
      spreadsheetId: config.google.spreadsheetId,
      targetYear,
    };

    const snapshot = runPipeline(pipelineInput);

    // 3b. Attach SHDYU monthly dynamics data if available
    if (cachedSHDYUData) {
      snapshot.shdyuData = cachedSHDYUData;
    }

    // 4. Сохраняем в БД
    await saveSnapshot(snapshot);

    return snapshot;
  } catch (error) {
    console.error('❌ Google Sheets unavailable, falling back to demo data:', error);
    const demo = createDemoSnapshot();
    // Mark as demo in the ID so consumers can detect fallback
    demo.id = `demo-${demo.id}`;
    return demo;
  }
}

/**
 * Сохраняет снимок в базу
 */
async function saveSnapshot(snapshot: DataSnapshot): Promise<void> {
  try {
    db.insert(schema.snapshots).values({
      id: snapshot.id,
      spreadsheetId: snapshot.spreadsheetId,
      createdAt: snapshot.createdAt,
      trustOverall: snapshot.trust.overall,
      trustGrade: snapshot.trust.grade,
      issueCount: snapshot.issues.length,
      criticalIssueCount: snapshot.issues.filter(i => i.severity === 'critical').length,
      metricsCount: Object.keys(snapshot.officialMetrics).length,
      rowCount: snapshot.rowCount,
      readDurationMs: snapshot.metadata.readDurationMs,
      pipelineDurationMs: snapshot.metadata.pipelineDurationMs,
      data: JSON.stringify(snapshot),
    }).run();

    // Сохраняем историю метрик
    for (const [key, metric] of Object.entries(snapshot.officialMetrics) as [string, NormalizedMetric][]) {
      db.insert(schema.metricHistory).values({
        snapshotId: snapshot.id,
        metricKey: key,
        numericValue: metric.numericValue,
        displayValue: metric.displayValue,
        confidence: metric.confidence,
        origin: metric.origin,
        createdAt: snapshot.createdAt,
      }).run();
    }

    // Сохраняем проблемы
    for (const issue of snapshot.issues) {
      db.insert(schema.issues).values({
        ...issue,
        snapshotId: snapshot.id,
      }).run();
    }
  } catch (error) {
    console.error('Ошибка сохранения снимка:', error);
  }
}

/**
 * Получает историю снимков
 */
export function getSnapshotHistory(limit = 50): Array<{
  id: string;
  createdAt: string;
  trustOverall: number | null;
  trustGrade: string | null;
  issueCount: number | null;
}> {
  return db.select({
    id: schema.snapshots.id,
    createdAt: schema.snapshots.createdAt,
    trustOverall: schema.snapshots.trustOverall,
    trustGrade: schema.snapshots.trustGrade,
    issueCount: schema.snapshots.issueCount,
  })
    .from(schema.snapshots)
    .orderBy(desc(schema.snapshots.createdAt))
    .limit(limit)
    .all();
}

/**
 * Получает историю конкретной метрики
 */
export function getMetricTrend(metricKey: string, limit = 30): Array<{
  numericValue: number | null;
  createdAt: string;
}> {
  return db.select({
    numericValue: schema.metricHistory.numericValue,
    createdAt: schema.metricHistory.createdAt,
  })
    .from(schema.metricHistory)
    .where(eq(schema.metricHistory.metricKey, metricKey))
    .orderBy(desc(schema.metricHistory.createdAt))
    .limit(limit)
    .all();
}

/** Инвалидировать кэш (все годы) */
export function invalidateCache(): void {
  cachedSnapshots.clear();
}
