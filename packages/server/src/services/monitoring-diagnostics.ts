import { MONITORING_MASTER_SHEET, monitoringWorkQueue, type MonitoringProcedure, type MonitoringSignal } from '@aemr/core';
import { batchGetSheetValues } from './google-sheets.js';
import { MONITORING_SPREADSHEET_ID, type MonitoringBookSnapshot } from './monitoring.js';

/** Compare the native projection independently; duplicate codes retain their multiplicity. */
export function queueDriftSignals(book: MonitoringBookSnapshot, procedures: readonly MonitoringProcedure[]): MonitoringSignal[] {
  const grid = book.sheets['Процедуры в работе'];
  if (!grid) return [];
  const work = monitoringWorkQueue(procedures, new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Kamchatka' }).format(new Date(book.readAt)));
  const addresses: Array<{ address: string; note: string }> = [];
  for (const [items, column, letter] of [[work.active, 3, 'D'], [work.closed, 14, 'O']] as const) {
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
  // Native workbook contract: J is entirely empty; active signals appear in C.
  grid.forEach((row, index) => {
    if (String(row[9] ?? '').trim()) {
      addresses.push({
        address: `Процедуры в работе!J${index + 1}`,
        note: 'Столбец J должен быть пустым разделителем. Сигналы активных процедур выводятся вместе с действием в C.',
      });
    }
  });
  return addresses.length ? [{ kind: 'monitoring_queue_drift', title: 'Очередь книги или её разметка расходятся с реестром', severity: 'medium',
    mechanism: 'Независимое сравнение кодов и повторений, а также контроль пустого разделителя J обнаружили отклонение.',
    action: 'Проверьте формулы, диапазоны и пустоту J листа «Процедуры в работе». Очередь Dash рассчитана из мастера.', count: addresses.length, addresses }] : [];
}

export function missingFormulaAddresses(values: unknown[][], formulas: unknown[][]): string[] {
  const out: string[] = [];
  const columns = [[16, 'Q'], [18, 'S'], [21, 'V'], [22, 'W'], [23, 'X'], [24, 'Y']] as const;
  values.slice(2).forEach((row, offset) => {
    if (!String(row[0] ?? '').trim() && !String(row[6] ?? '').trim()) return;
    for (const [index, letter] of columns) {
      if (typeof formulas[offset + 2]?.[index] !== 'string' || !(formulas[offset + 2][index] as string).startsWith('=')) out.push(`${MONITORING_MASTER_SHEET}!${letter}${offset + 3}`);
    }
  });
  return out;
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
      const signals: MonitoringSignal[] = addresses.length ? [{ kind: 'monitoring_formula_missing', title: 'Вычисляемое поле заменено значением или пусто', severity: 'high',
        mechanism: 'Отдельное чтение формул Q/S/V/W/X/Y обнаружило ячейки без формулы. Правдоподобное значение не доказывает исправность вычисления.',
        action: 'Проверьте указанную ячейку и восстановите каноническую формулу после проверки исходных данных.', count: addresses.length,
        addresses: addresses.map(address => ({ address, note: 'В обязательной вычисляемой колонке нет формулы.' })) }] : [];
      return { checked: true, signals, notes: ['Проверено наличие формул Q/S/V/W/X/Y. Проверки ввода и защиты этим чтением не проверяются.'] };
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
