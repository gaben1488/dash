/**
 * dept-rows.ts — единая точка «дай строки всех книг ГРБС + момент чтения».
 *
 * Порядок источников — как у /api/timeline/upcoming: живой кэш книг
 * (канонический периметр /api/report), при пустом кэше — rowsByDept
 * последнего сохранённого снимка. Момент чтения отдаётся ЯВНО (канон п.58:
 * подпись момента — данными, а не догадкой клиента): для живого кэша это
 * самый ранний момент чтения возвращённых книг, для снимка — его createdAt.
 */
import { DEPARTMENTS, DEPT_HEADER_ROWS, departmentCoverage, findDept, type SourceCoverage } from '@aemr/shared';
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
  asOf: string | null;
  /** Откуда строки: живой кэш книг или сохранённый снимок. */
  source: 'live' | 'snapshot';
  coverage: SourceCoverage;
}

/**
 * Строки книг для сводных расчётов. Пустой rowsByDept = оба источника молчат;
 * роут-потребитель обязан ответить 503 с причиной, а не пустым успехом.
 */
export async function readDeptRows(): Promise<DeptRowsReading> {
  const expected = DEPARTMENTS.map(dept => dept.nameShort);
  const cached = getDeptSheetValues();
  const meta = getDeptLoadMeta();
  const books = expected.filter(book => cached[book]?.length >= DEPT_HEADER_ROWS && !meta[book]?.error
    && Number.isFinite(Date.parse(meta[book]?.loadedAt ?? '')));
  const live = Object.fromEntries(books.map(book => [book, cached[book].slice(DEPT_HEADER_ROWS)]));
  const readTimes = books.map(book => Date.parse(meta[book].loadedAt));
  // Общий filledAt меняется даже при пустом/частичном цикле. Только метаданные
  // каждой возвращаемой книги подтверждают её чтение; это не атомарный freeze.
  if (books.length > 0 && readTimes.every(time => Number.isFinite(time) && time > 0)) {
    return {
      rowsByDept: live, asOf: new Date(Math.min(...readTimes)).toISOString(), source: 'live',
      coverage: departmentCoverage(expected, books),
    };
  }
  try {
    const snapshot = await getSnapshot();
    const savedBooks = expected.filter(book => Array.isArray(snapshot.rowsByDept?.[book]));
    if (savedBooks.length > 0 && Number.isFinite(Date.parse(snapshot.createdAt ?? ''))) {
      return {
        rowsByDept: Object.fromEntries(savedBooks.map(book => [book, snapshot.rowsByDept![book]])),
        asOf: snapshot.createdAt,
        source: 'snapshot',
        coverage: departmentCoverage(expected, savedBooks),
      };
    }
  } catch {
    // источники молчат — честный пустой результат, решение за роутом
  }
  return { rowsByDept: {}, asOf: null, source: 'snapshot', coverage: departmentCoverage(expected, []) };
}

/** Same read and evidence, keyed by department ID for consumers of the shared registry. */
export async function readDeptRowsById() {
  const reading = await readDeptRows();
  return {
    rows: Object.fromEntries(DEPARTMENTS.filter(dept => dept.nameShort in reading.rowsByDept)
      .map(dept => [findDept(dept.nameShort)!.id, reading.rowsByDept[dept.nameShort]])),
    source: reading.coverage.readDepartments.length === 0 ? 'none' as const : reading.source,
    asOf: reading.asOf,
    coverage: reading.coverage,
  };
}
