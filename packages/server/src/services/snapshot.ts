import { runPipeline, computeUnifiedGrid, reconcileUnified, type PipelineInput, type MetricRow } from '@aemr/core';
import { REPORT_MAP, getAllCellAddresses, getActiveRules, ALL_SHEETS, SVOD_SHEET_NAME, CYRILLIC_TO_LATIN, SHDYU_MONTHLY_SHEET_NAME } from '@aemr/shared';
import type { DataSnapshot, NormalizedMetric, SvodReconRow } from '@aemr/shared';
import { batchGetCells, batchGetFormulas, getSheetData } from '../google-sheets.js';
import { fetchSHDYUSheet } from './google-sheets.js';
import { parseSHDYUSheet } from '@aemr/core';
import { SHDYU_SPREADSHEET_ID } from '../config.js';
import { db, schema } from '../db/index.js';
import { config } from '../config.js';
import { eq, desc } from 'drizzle-orm';
import { createDemoSnapshot } from './demo-data.js';
import type { DeptSheetResult } from './google-sheets.js';

/** Per-year snapshot cache: key is targetYear (number) */
const cachedSnapshots = new Map<number, { snapshot: DataSnapshot; timestamp: number }>();

let cachedDeptSheetData: Record<string, DeptSheetResult> = {};

export function setDeptSheetCache(data: Record<string, DeptSheetResult>): void {
  cachedDeptSheetData = { ...cachedDeptSheetData, ...data };
}

export function getDeptSheetCache(): Record<string, DeptSheetResult> {
  return cachedDeptSheetData;
}

export function getDeptSheetValues(): Record<string, unknown[][]> {
  const result: Record<string, unknown[][]> = {};
  for (const [key, val] of Object.entries(cachedDeptSheetData)) {
    result[key] = val.values;
  }
  return result;
}

interface DeptLoadMeta {
  loadedAt: string;
  rowCount: number;
  sheetName: string;
  error?: string;
}

let deptLoadMeta: Record<string, DeptLoadMeta> = {};

export function setDeptLoadMeta(meta: Record<string, DeptLoadMeta>): void {
  deptLoadMeta = { ...deptLoadMeta, ...meta };
}

export function getDeptLoadMeta(): Record<string, DeptLoadMeta> {
  return deptLoadMeta;
}

/** Cached monthly data from «СВОД с месяцами». Kept under old variable names for API compatibility. */
let cachedSHDYUData: Record<string, any> | null = null;
let cachedSHDYURawRowCount = 0;
let cachedSHDYULoadError: string | null = null;

export function getSHDYUCache(): Record<string, any> | null {
  return cachedSHDYUData;
}

export function getSHDYURawRowCount(): number {
  return cachedSHDYURawRowCount;
}

export function getSHDYULoadError(): string | null {
  return cachedSHDYULoadError;
}

export function setSHDYUCache(data: Record<string, any>): void {
  cachedSHDYUData = data;
}

export function attachUnifiedGrid(
  snapshot: DataSnapshot,
  sheetRows: Record<string, unknown[][]>,
  targetYear?: number,
): void {
  const deptRowsById: Record<string, unknown[][]> = {};
  for (const [sheetName, rows] of Object.entries(sheetRows)) {
    if (sheetName === SVOD_SHEET_NAME) continue;
    const grbsId = (CYRILLIC_TO_LATIN as Record<string, string>)[sheetName] ?? sheetName.toLowerCase();
    deptRowsById[grbsId] = rows;
  }

  const grid = computeUnifiedGrid(deptRowsById, targetYear);
  snapshot.unifiedGrid = grid;
  snapshot.unifiedReconciliation = reconcileUnified(grid, snapshot.officialMetrics) as SvodReconRow[];
}

export async function getSnapshot(force = false, targetYear?: number): Promise<DataSnapshot> {
  const currentYear = new Date().getFullYear();
  const year = Number.isInteger(targetYear) && (targetYear as number) >= 2020 && (targetYear as number) <= 2100
    ? (targetYear as number)
    : currentYear;
  const now = Date.now();
  const ttl = config.cache.ttlSeconds * 1000;

  const cached = cachedSnapshots.get(year);
  if (!force && cached && (now - cached.timestamp) < ttl) {
    return cached.snapshot;
  }

  const snapshot = await createSnapshot(year);
  if (!snapshot.id.startsWith('demo-')) {
    cachedSnapshots.set(year, { snapshot, timestamp: now });
  }

  return snapshot;
}

async function createSnapshot(targetYear: number): Promise<DataSnapshot> {
  try {
    const cellAddresses = getAllCellAddresses();
    const [batchValues, batchFormulas] = await Promise.all([
      batchGetCells(cellAddresses),
      batchGetFormulas(cellAddresses),
    ]);

    const batchGetData = batchValues.map((v, i) => ({
      range: v.range,
      values: v.values,
      formulas: batchFormulas[i]?.formulas,
    }));

    const sheetRows: Record<string, unknown[][]> = {};
    const sheetReadPromises = ALL_SHEETS.map(async (sheetName: string) => {
      try {
        const rows = await getSheetData(sheetName);
        sheetRows[sheetName] = rows;
      } catch (error) {
        console.warn(`Не удалось прочитать лист "${sheetName}":`, error);
      }
    });

    const monthlyPromise = fetchSHDYUSheet(SHDYU_SPREADSHEET_ID).then((result) => {
      const sourceLabel = result.sheetName;
      if (result.values.length > 0) {
        const parsed = parseSHDYUSheet(result.values, result.formulas);
        cachedSHDYUData = parsed;
        cachedSHDYURawRowCount = result.values.length;
        cachedSHDYULoadError = null;
        console.log(`📊 ${sourceLabel}: ${result.values.length} строк (${result.formulas.length} с формулами), ${Object.keys(parsed).length} ГРБС`);
      } else {
        cachedSHDYULoadError = `Лист «${sourceLabel}» прочитан, но пуст (0 строк): помесячная динамика в источнике не заполнена за выбранный период.`;
      }
    }).catch((err: unknown) => {
      cachedSHDYULoadError = `Не удалось прочитать лист «${SHDYU_MONTHLY_SHEET_NAME}»: ${err instanceof Error ? err.message : String(err)}`;
      console.warn(`Не удалось загрузить ${SHDYU_MONTHLY_SHEET_NAME}:`, err);
    });

    await Promise.all([...sheetReadPromises, monthlyPromise]);

    for (const [deptName, deptResult] of Object.entries(cachedDeptSheetData)) {
      if (!sheetRows[deptName] || sheetRows[deptName].length === 0) {
        if (deptResult.values.length > 0) {
          sheetRows[deptName] = deptResult.values;
          console.log(`📋 Лист "${deptName}": ${deptResult.values.length} строк из кэша (формулы: ${deptResult.formulas.length} строк)`);
        }
      }
    }

    const pipelineInput: PipelineInput = {
      batchGetData,
      sheetRows,
      reportMap: REPORT_MAP,
      rules: getActiveRules(),
      spreadsheetId: config.google.spreadsheetId,
      targetYear,
    };

    const snapshot = runPipeline(pipelineInput);

    if (cachedSHDYUData) {
      snapshot.shdyuData = cachedSHDYUData;
    }

    attachUnifiedGrid(snapshot, sheetRows, targetYear);
    await saveSnapshot(snapshot);

    return snapshot;
  } catch (error) {
    console.error('❌ Google Sheets unavailable, falling back to demo data:', error);
    const demo = createDemoSnapshot();
    demo.id = `demo-${demo.id}`;
    return demo;
  }
}

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

export function getSnapshotMetrics(snapshotId: string): MetricRow[] {
  const rows = db
    .select({
      metricKey: schema.metricHistory.metricKey,
      numericValue: schema.metricHistory.numericValue,
      createdAt: schema.metricHistory.createdAt,
    })
    .from(schema.metricHistory)
    .where(eq(schema.metricHistory.snapshotId, snapshotId))
    .all();
  return rows.map((r) => ({ metricKey: r.metricKey, numericValue: r.numericValue, at: r.createdAt }));
}

export function invalidateCache(): void {
  cachedSnapshots.clear();
}
