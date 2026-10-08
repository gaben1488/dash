import { MONITORING_MASTER_SHEET, monitoringWorkQueue, type MonitoringProcedure, type MonitoringSignal } from '@aemr/core';
import { batchGetSheetValues } from './google-sheets.js';
import { MONITORING_SPREADSHEET_ID, type MonitoringBookSnapshot } from './monitoring.js';

/** Compare the native projection independently; duplicate codes retain their multiplicity. */
export function queueDriftSignals(book: MonitoringBookSnapshot, procedures: readonly MonitoringProcedure[]): MonitoringSignal[] {
  const grid = book.sheets['Процедуры в работе'];
  if (!grid) return [];
  const work = monitoringWorkQueue(procedures, new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Kamchatka' }).format(new Date(book.readAt)));
  const headers = grid[1] ?? [];
  const codeColumns = headers.flatMap((value, index) => String(value ?? '').trim() === 'Код' ? [index] : []);
  const closedColumn = codeColumns.find(index => index > 3) ?? 15;
  const addresses: Array<{ address: string; note: string }> = [];
  for (const [items, column] of [[work.active, 3], [work.closed, closedColumn]] as const) {
    const letter = String.fromCharCode(65 + column);
    const expected = new Map<string, number>();
    for (const { procedure: p } of items) {
      const code = p.sourceCode ?? p.code;
      if (code) expected.set(code, (expected.get(code) ?? 0) + 1);
    }
    grid.slice(2).forEach((row, index) => {
      const code = String(row[column] ?? '').trim();
      if (!code) return;
      const count = expected.get(code) ?? 0;
      if (count > 0) expected.set(code, count - 1);
      else addresses.push({ address: `Процедуры в работе!${letter}${index + 3}`, note: `Лишняя строка витрины: ${code}` });
    });
    for (const [code, count] of expected) if (count > 0) {
      for (const { procedure: p } of items.filter(({ procedure }) => (procedure.sourceCode ?? procedure.code) === code).slice(-count)) {
        addresses.push({ address: `${p.sheet}!A${p.row}`, note: `В витрине ${letter} отсутствует ${code}` });
      }
    }
  }
  // Native workbook contract: J displays active signals; N is the empty visible divider.
  grid.forEach((row, index) => {
    if (String(row[13] ?? '').trim()) {
      addresses.push({
        address: `Процедуры в работе!N${index + 1}`,
        note: 'Столбец N должен оставаться пустым визуальным разделителем. Сигналы активных процедур отображаются в J, действия — в C.',
      });
    }
  });
  return addresses.length ? [{ kind: 'monitoring_queue_drift', title: 'Очередь книги или её разметка расходятся с реестром', severity: 'medium',
    mechanism: 'Независимое сравнение кодов и повторений, а также контроль пустого разделителя N обнаружили отклонение.',
    action: 'Проверьте формулы, диапазоны и пустоту N листа «Процедуры в работе». Очередь Dash рассчитана из мастера.', count: addresses.length, addresses }] : [];
}

export function missingFormulaAddresses(values: unknown[][], formulas: unknown[][]): string[] {
  const out: string[] = [];
  const columns = [[0, 'A'], [16, 'Q'], [18, 'S'], [21, 'V'], [22, 'W'], [23, 'X'], [24, 'Y']] as const;
  values.slice(2).forEach((row, offset) => {
    if (!String(row[0] ?? '').trim() && !String(row[6] ?? '').trim()) return;
    for (const [index, letter] of columns) {
      if (typeof formulas[offset + 2]?.[index] !== 'string' || !(formulas[offset + 2][index] as string).startsWith('=')) out.push(`${MONITORING_MASTER_SHEET}!${letter}${offset + 3}`);
    }
  });
  return out;
}

/** Detect a plausible but wrong formula: all row-local templates must be identical.
 * S may contain user-entered INNs, so it is reported by the separate presence
 * control rather than overwritten or silently reinterpreted as a formula.
 * No protected ranges are used or requested.
 */
export function formulaTemplateDriftAddresses(values: unknown[][], formulas: unknown[][]): string[] {
  const columns = [[0, 'A'], [16, 'Q'], [21, 'V'], [22, 'W'], [23, 'X'], [24, 'Y']] as const;
  const active = (index: number): boolean =>
    Boolean(String(values[index]?.[0] ?? '').trim() || String(values[index]?.[6] ?? '').trim());
  const normalize = (formula: string, row: number): string =>
    formula.replace(new RegExp(`(?<![A-Z0-9])((?:\\$?)[A-Z]{1,2})${row}(?![0-9])`, 'gu'), '$1#');
  const addresses: string[] = [];
  for (const [col, letter] of columns) {
    const first = values.findIndex((_, index) => index >= 2 && active(index) && typeof formulas[index]?.[col] === 'string' && String(formulas[index][col]).startsWith('='));
    if (first < 0) continue;
    const template = normalize(String(formulas[first][col]), first + 1);
    for (let index = 2; index < values.length; index++) {
      if (!active(index)) continue;
      const formula = formulas[index]?.[col];
      if (typeof formula !== 'string' || !formula.startsWith('=')) continue; // missing reported separately
      if (normalize(formula, index + 1) !== template) addresses.push(`${MONITORING_MASTER_SHEET}!${letter}${index + 1}`);
    }
  }
  return addresses;
}

const checks = new WeakMap<MonitoringBookSnapshot, Promise<{ checked: boolean; signals: MonitoringSignal[]; notes: string[] }>>();
export function monitoringFormulaDiagnostics(book: MonitoringBookSnapshot) {
  const existing = checks.get(book);
  if (existing) return existing;
  const pending = (async () => {
    try {
      const grids = await batchGetSheetValues([MONITORING_MASTER_SHEET], MONITORING_SPREADSHEET_ID, 'FORMULA');
      if (!grids[MONITORING_MASTER_SHEET]) throw new Error('Диапазон формул не получен');
      const addresses = missingFormulaAddresses(book.sheets[MONITORING_MASTER_SHEET] ?? [], grids[MONITORING_MASTER_SHEET]);
      const drift = formulaTemplateDriftAddresses(book.sheets[MONITORING_MASTER_SHEET] ?? [], grids[MONITORING_MASTER_SHEET]);
      const signals: MonitoringSignal[] = addresses.length ? [{ kind: 'monitoring_formula_missing', title: 'Вычисляемое поле заменено значением или пусто', severity: 'high',
        mechanism: 'Отдельное чтение формул A/Q/S/V/W/X/Y обнаружило ячейки без формулы. Правдоподобное значение не доказывает исправность вычисления.',
        action: 'Проверьте указанную ячейку и восстановите каноническую формулу после проверки исходных данных.', count: addresses.length,
        addresses: addresses.map(address => ({ address, note: 'В обязательной вычисляемой колонке нет формулы.' })) }] : [];
      if (drift.length) signals.push({ kind: 'monitoring_formula_drift', title: 'Формулы расходятся с построчным шаблоном', severity: 'high',
        mechanism: 'Вычисление присутствует, но его ссылки или логика не совпадают с эталонной строкой. Контроль сравнивает A/Q/V/W/X/Y.',
        action: 'Проверьте перечисленные строки и восстановите корректный шаблон без защиты диапазонов.', count: drift.length,
        addresses: drift.map(address => ({ address, note: 'Формула отличается от согласованного шаблона данного столбца.' })) });
      return { checked: true, signals, notes: ['Проверены наличие и согласованность формул A/Q/V/W/X/Y; ручные значения S отмечаются отдельно. Защита диапазонов не применяется.'] };
    } catch {
      return { checked: false, signals: [], notes: ['Формулы мастера не прочитаны; целость вычисляемых колонок не подтверждена.'] };
    }
  })();
  checks.set(book, pending);
  return pending;
}

export interface SupplierDirectoryReading {
  readAt: string | null;
  error: string | null;
  rows: Array<{ id: string; name: string; inn: string | null; legalForm: string | null; note: string | null; evidence: string | null; address: string; ambiguous: boolean }>;
}
const suppliers = new WeakMap<MonitoringBookSnapshot, Promise<SupplierDirectoryReading>>();
/** Optional directory has its own refusal and read time; never infer an INN from a name. */
export function monitoringSuppliers(book: MonitoringBookSnapshot): Promise<SupplierDirectoryReading> {
  const existing = suppliers.get(book);
  if (existing) return existing;
  const pending = (async (): Promise<SupplierDirectoryReading> => {
    try {
      const grids = await batchGetSheetValues(['_Поставщики'], MONITORING_SPREADSHEET_ID);
      const grid = grids['_Поставщики'];
      if (!grid || grid[0]?.[0] !== 'ID Поставщика' || grid[0]?.[1] !== 'Наименование поставщика' || grid[0]?.[2] !== 'ИНН') throw new Error('Изменилась схема справочника поставщиков');
      const text = (value: unknown): string | null => value == null || String(value).trim() === '' ? null : String(value).trim();
      const rows = grid.slice(1).flatMap((row, index) => {
        const id = text(row[0]); const name = text(row[1]);
        if (!id && !name) return [];
        return [{ id: id ?? '', name: name ?? '', inn: text(row[2]), legalForm: text(row[3]), note: text(row[4]), evidence: text(row[5]), address: `_Поставщики!A${index + 2}`, ambiguous: false }];
      });
      const ids = new Map<string, number>(); const inns = new Map<string, number>();
      for (const row of rows) { if (row.id) ids.set(row.id, (ids.get(row.id) ?? 0) + 1); if (row.inn) inns.set(row.inn, (inns.get(row.inn) ?? 0) + 1); }
      for (const row of rows) row.ambiguous = !row.id || !row.name || (ids.get(row.id) ?? 0) > 1 || (row.inn !== null && (inns.get(row.inn) ?? 0) > 1);
      return { rows, readAt: new Date().toISOString(), error: null };
    } catch (error) { return { rows: [], readAt: null, error: error instanceof Error && error.message === 'Изменилась схема справочника поставщиков' ? error.message : 'Источник временно недоступен. Перечитайте данные.' }; }
  })();
  suppliers.set(book, pending);
  return pending;
}
