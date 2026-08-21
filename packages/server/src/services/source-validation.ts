import { detectSignals } from '@aemr/core';
import {
  DEPT_HEADER_ROWS,
  buildCellDict,
  isMetaRow,
  SVOD_SHEET_NAME,
  SHDYU_MONTHLY_SHEET_NAME,
  CHECK_REGISTRY,
  LEGACY_SIGNAL_TO_CHECK,
  issueSuppressedByRowClass,
  epRiskStrictnessOfReason,
} from '@aemr/shared';
import { getSheetData } from './google-sheets.js';
import { readDeptSheet } from './google-sheets.js';
import { config, DEPARTMENT_SPREADSHEETS, SHDYU_SPREADSHEET_ID } from '../config.js';

/**
 * Валидация источника данных — КАНОНИЧЕСКИЙ путь (не самодельный).
 *
 * История болезни (скриншот пользователя 2026-07-14): старая валидация в
 * journal.ts (а) читала лист, буквально названный именем управления
 * («'УАГЗО'!A:ZZ» → «Unable to parse range», хотя загрузчик тот же источник
 * читал успешно через кандидатов «ВСЕ»/«Все»/имя); (б) имела собственные
 * колонк-правила, противоречащие канону: «отрицательное значение» в T —
 * а T это отклонение в ДНЯХ (законно отрицательное = раньше срока),
 * «факт превышает план» сравнивал T с K — а факт-итого это Y; предмет
 * искала в D (это программа), предмет — G. «Найдено проблем: 15» было
 * мусором по построению.
 *
 * Канон: лист читается ТЕМ ЖЕ резолвером, что загрузчик (readDeptSheet,
 * кандидаты + честные ошибки 429/403); строки-позиции отбираются как в
 * rows.ts (предмет G, isMetaRow, пустышки вон); качество — КАНОНИЧЕСКИЕ
 * сигналы (detectSignals) с человеческими заголовками из CHECK_REGISTRY;
 * собственных правил — минимум и только по верным колонкам (K/Y числа,
 * отрицательные ДЕНЬГИ H..Y; дни/кварталы не трогаем).
 */

export interface SourceIssue {
  row: number;
  type: 'signal' | 'data_type' | 'negative_money';
  severity: 'critical' | 'warning' | 'info';
  message: string;
  field?: string;
}

export interface SourceValidationResult {
  success: boolean;
  name: string;
  /** Какой лист реально прочитан (прозрачность: «ВСЕ», не имя ГРБС). */
  resolvedSheetName: string;
  /** Строк-позиций проверено (не сырых строк листа). */
  rowsChecked: number;
  issues: SourceIssue[];
  summary: { total: number; critical: number; warning: number; info: number };
  error?: string;
}

/** Денежные колонки (план H,I,J,K + факт V,W,X,Y). Дни (T) и кварталы (O,R) — НЕ деньги. */
const MONEY_COLS = ['H', 'I', 'J', 'K', 'V', 'W', 'X', 'Y'] as const;

// CHECK_REGISTRY — массив записей; индексируем по id один раз.
const CHECKS_BY_ID = new Map(CHECK_REGISTRY.map(c => [c.id, c]));

const severityOf = (checkId: string): SourceIssue['severity'] => {
  const sev = CHECKS_BY_ID.get(checkId)?.severity as string | undefined;
  return sev === 'critical' || sev === 'error' ? 'critical' : sev === 'info' ? 'info' : 'warning';
};

const titleOf = (checkId: string, fallback: string): string =>
  CHECKS_BY_ID.get(checkId)?.name ?? fallback;

/** Прогнать канонические проверки по строкам листа. */
export function validateRows(rawRows: unknown[][]): Pick<SourceValidationResult, 'rowsChecked' | 'issues' | 'summary'> {
  const issues: SourceIssue[] = [];
  let rowsChecked = 0;

  for (let i = DEPT_HEADER_ROWS; i < rawRows.length; i++) {
    const row = rawRows[i];
    if (!row) continue;
    const cells = buildCellDict(row as unknown[]);

    // Отбор строк-позиций — как в rows.ts: предмет = G (не D!), мета-строки вон.
    const subject = String(cells.G ?? '').trim();
    const planTotal = cells.K;
    if (!subject && !(Number(planTotal) > 0)) continue;
    if (isMetaRow(subject.toLowerCase())) continue;
    rowsChecked++;

    const rowNo = i + 1;

    // Канонические сигналы → замечания с человеческими заголовками CHECK_REGISTRY.
    const signals = detectSignals(cells);
    for (const [signalKey, active] of Object.entries(signals)) {
      if (active !== true) continue;
      const checkId = (LEGACY_SIGNAL_TO_CHECK as Record<string, string>)[signalKey];
      if (!checkId) continue; // сигнал не конвертируется в замечание (бейдж-only) — не шумим
      // Класс строки может гасить претензию по другому её признаку (канон
      // @aemr/shared): инициативная заявка в риск-списки не идёт, п.137(3).
      if (issueSuppressedByRowClass(signalKey, signals as unknown as Record<string, boolean>)) continue;
      issues.push({
        row: rowNo,
        type: 'signal',
        // ЕП-риск судится по степени обоснованности строки, а не по ключу
        // (п.137(2)): дом развилки — @aemr/shared, чтобы проверка источника,
        // конвейер и чип Реестра не разошлись в оценке одной строки.
        severity: signalKey === 'epRisk'
          ? epRiskStrictnessOfReason(cells['M'])
          : severityOf(checkId),
        message: titleOf(checkId, signalKey),
      });
    }

    // Тип данных: итоги K (план) и Y (факт) обязаны быть числами.
    for (const col of ['K', 'Y'] as const) {
      const v = cells[col];
      if (v !== null && v !== undefined && v !== '' && isNaN(Number(v))) {
        issues.push({
          row: rowNo,
          type: 'data_type',
          severity: 'warning',
          message: `Колонка ${col} (${col === 'K' ? 'план итого' : 'факт итого'}): ожидается число, получено «${String(v)}»`,
          field: col,
        });
      }
    }

    // Отрицательные ДЕНЬГИ (не дни, не кварталы).
    for (const col of MONEY_COLS) {
      const v = Number(cells[col]);
      if (!isNaN(v) && v < 0) {
        issues.push({
          row: rowNo,
          type: 'negative_money',
          severity: 'warning',
          message: `Колонка ${col}: отрицательная сумма ${v}`,
          field: col,
        });
      }
    }
  }

  const summary = {
    total: issues.length,
    critical: issues.filter(x => x.severity === 'critical').length,
    warning: issues.filter(x => x.severity === 'warning').length,
    info: issues.filter(x => x.severity === 'info').length,
  };
  return { rowsChecked, issues, summary };
}

/** Валидация одного источника по имени (СВОД / «СВОД с месяцами» / ГРБС). */
export async function validateSource(name: string): Promise<SourceValidationResult> {
  const empty = { rowsChecked: 0, issues: [], summary: { total: 0, critical: 0, warning: 0, info: 0 } };
  try {
    let rawRows: unknown[][];
    let resolvedSheetName: string;

    if (name === SVOD_SHEET_NAME) {
      rawRows = await getSheetData(SVOD_SHEET_NAME, config.google.spreadsheetId);
      resolvedSheetName = SVOD_SHEET_NAME;
      // СВОД — агрегатный лист, построчные сигналы ГРБС-формата к нему неприменимы:
      // проверяем только читаемость.
      return { success: true, name, resolvedSheetName, ...empty, rowsChecked: rawRows.length };
    }

    if (name === SHDYU_MONTHLY_SHEET_NAME || name === 'ШДЮ' /* легаси-имя карточки */) {
      rawRows = await getSheetData(SHDYU_MONTHLY_SHEET_NAME, SHDYU_SPREADSHEET_ID);
      resolvedSheetName = SHDYU_MONTHLY_SHEET_NAME;
      // Помесячный свод — тоже агрегат, не ГРБС-строки.
      return { success: true, name: SHDYU_MONTHLY_SHEET_NAME, resolvedSheetName, ...empty, rowsChecked: rawRows.length };
    }

    const ssId = DEPARTMENT_SPREADSHEETS[name];
    if (!ssId) {
      return { success: false, name, resolvedSheetName: '', ...empty, error: `Источник «${name}» не найден` };
    }
    // ТОТ ЖЕ резолвер, что у загрузчика (кандидаты ВСЕ/Все/имя, честные 429/403).
    const sheet = await readDeptSheet(name, ssId);
    const checked = validateRows(sheet.values);
    return { success: true, name, resolvedSheetName: sheet.sheetName, ...checked };
  } catch (err) {
    return {
      success: false,
      name,
      resolvedSheetName: '',
      ...empty,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/** Все источники разом (последовательно — щадим квоту Google). */
export async function validateAllSources(): Promise<SourceValidationResult[]> {
  const names = [SVOD_SHEET_NAME, ...Object.keys(DEPARTMENT_SPREADSHEETS), SHDYU_MONTHLY_SHEET_NAME];
  const results: SourceValidationResult[] = [];
  for (const name of names) {
    results.push(await validateSource(name));
  }
  return results;
}
