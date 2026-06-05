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

/** Per-year snapshot cache: key is targetYear (number) */
const cachedSnapshots = new Map<number, { snapshot: DataSnapshot; timestamp: number }>();

import type { DeptSheetResult } from './google-sheets.js';

/**
 * Кэш данных из отдельных таблиц управлений.
 * Заполняется при вызове loadAllSources / fetchDepartmentSpreadsheets.
 * Ключи — русские короткие имена ('УЭР', 'УИО', …).
 * BUG-2 FIX: Теперь включает и формулы (values + formulas).
 */
let cachedDeptSheetData: Record<string, DeptSheetResult> = {};

/** Обновить кэш данных управлений (вызывается из index.ts / dashboard route) */
export function setDeptSheetCache(data: Record<string, DeptSheetResult>): void {
  cachedDeptSheetData = { ...cachedDeptSheetData, ...data };
}

/** Получить текущий кэш данных управлений (полный: values + formulas) */
export function getDeptSheetCache(): Record<string, DeptSheetResult> {
  return cachedDeptSheetData;
}

/**
 * Получить только значения (без формул) из кэша управлений.
 * Обратная совместимость для потребителей, которым нужны raw rows.
 */
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

/** Cached monthly data from «СВОД с месяцами». */
let cachedSHDYUData: Record<string, any> | null = null;
/** Raw row count from «СВОД с месяцами» before parsing into blocks. */
let cachedSHDYURawRowCount = 0;
/** Last monthly source load error; null means success. */
let cachedSHDYULoadError: string | null = null;

/** Get monthly data cache. */
export function getSHDYUCache(): Record<string, any> | null {
  return cachedSHDYUData;
}

/** Get raw row count from monthly source sheet. */
export function getSHDYURawRowCount(): number {
  return cachedSHDYURawRowCount;
}

/** Get monthly source load error. */
export function getSHDYULoadError(): string | null {
  return cachedSHDYULoadError;
}

/** Set monthly data cache. */
export function setSHDYUCache(data: Record<string, any>): void {
  cachedSHDYUData = data;
}

/**
 * Строит единую сетку СВОД из dept-строк и кладёт её + сверку в snapshot.
 */
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

    const shdyuPromise = fetchSHDYUSheet(SHDYU_SPREADSHEET_ID).then((result) => {
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

    await Promise.all([...sheetReadPromises, shdyuPromise]);

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

    return snapshot;
  } catch (error) {
    console.error('Failed to create snapshot:', error);
    return createDemoSnapshot();
  }
}

export async function getLatestSnapshot(): Promise<DataSnapshot | null> {
  const [row] = await db
    .select()
    .from(schema.snapshots)
    .orderBy(desc(schema.snapshots.createdAt))
    .limit(1);

  return row ? (row.data as DataSnapshot) : null;
}

export async function saveSnapshot(snapshot: DataSnapshot): Promise<void> {
  await db.insert(schema.snapshots).values({
    id: snapshot.id,
    data: snapshot as any,
    createdAt: new Date(),
  });
}

export async function getSnapshotHistory(limit = 10): Promise<Array<{ id: string; createdAt: Date; totalRows: number; trustScore: number }>> {
  const rows = await db
    .select()
    .from(schema.snapshots)
    .orderBy(desc(schema.snapshots.createdAt))
    .limit(limit);

  return rows.map((row) => {
    const data = row.data as DataSnapshot;
    return {
      id: row.id,
      createdAt: row.createdAt,
      totalRows: data.kpis.totalProcedures,
      trustScore: data.trust.overall,
    };
  });
}

export async function getMetricsBySnapshotId(snapshotId: string): Promise<NormalizedMetric[]> {
  const [row] = await db
    .select()
    .from(schema.snapshots)
    .where(eq(schema.snapshots.id, snapshotId))
    .limit(1);

  if (!row) return [];
  const snapshot = row.data as DataSnapshot;
  return Object.values(snapshot.officialMetrics);
}
