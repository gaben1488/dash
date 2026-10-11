/**
 * dept-rows.ts — единая точка «дай строки всех книг ГРБС + момент чтения».
 *
 * Порядок источников — как у /api/timeline/upcoming: живой кэш книг
 * (канонический периметр /api/report), при пустом кэше — rowsByDept
 * последнего сохранённого снимка. Момент чтения отдаётся ЯВНО (канон п.58:
 * подпись момента — данными, а не догадкой клиента): для живого кэша это
 * самый ранний момент чтения возвращённых книг, для снимка — его createdAt.
 */
import { collectRowsByDept } from '@aemr/shared';
import { getDeptLoadMeta, getDeptSheetValues, getSnapshot } from './snapshot.js';

export interface DeptRowsReading {
  /**
   * Строки книг по кириллическим именам листов. Шапка (DEPT_HEADER_ROWS = 3)
   * УЖЕ СРЕЗАНА и живым путём (collectRowsByDept), и в rowsByDept снимка:
   * первая строка массива — строка листа 4. Потребитель НЕ должен срезать
   * шапку второй раз (двойной срез сдвинул бы все адреса на 3) и получает
   * номер строки листа как idx + DEPT_HEADER_ROWS + 1 (канон buildRowDto).
   */
  rowsByDept: Record<string, unknown[][]>;
  /** Момент, на который валидны строки (ISO). */
  asOf: string;
  /** Откуда строки: живой кэш книг или сохранённый снимок. */
  source: 'live' | 'snapshot';
}

/**
 * Строки книг для сводных расчётов. Пустой rowsByDept = оба источника молчат;
 * роут-потребитель обязан ответить 503 с причиной, а не пустым успехом.
 */
export async function readDeptRows(): Promise<DeptRowsReading> {
  const live = collectRowsByDept(getDeptSheetValues());
  const books = Object.keys(live);
  const meta = getDeptLoadMeta();
  const readTimes = books.map(book => meta[book]?.error ? NaN : Date.parse(meta[book]?.loadedAt ?? ''));
  // Общий filledAt меняется даже при пустом/частичном цикле. Только метаданные
  // каждой возвращаемой книги подтверждают её чтение; это не атомарный freeze.
  if (books.length > 0 && readTimes.every(time => Number.isFinite(time) && time > 0)) {
    return { rowsByDept: live, asOf: new Date(Math.min(...readTimes)).toISOString(), source: 'live' };
  }
  try {
    const snapshot = await getSnapshot();
    if (snapshot.rowsByDept && Object.keys(snapshot.rowsByDept).length > 0) {
      return {
        rowsByDept: snapshot.rowsByDept,
        asOf: snapshot.createdAt ?? new Date().toISOString(),
        source: 'snapshot',
      };
    }
  } catch {
    // источники молчат — честный пустой результат, решение за роутом
  }
  return { rowsByDept: {}, asOf: new Date().toISOString(), source: 'snapshot' };
}
