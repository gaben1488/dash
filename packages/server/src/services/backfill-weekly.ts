/**
 * backfill-weekly.ts — чистая логика бэкфилла: ручная недельная xlsx-выгрузка
 * становится историческим DataSnapshot (дизайн-док 2026-07-23 §4 R2, модель
 * «одной оси недели»: неделя → четверг → снимок ≤ четверга → buildReport).
 *
 * Здесь только чистые функции без ввода-вывода: чтение xlsx (devDependency
 * «xlsx») живёт в scripts/backfill-weekly-snapshots.ts и в прод-бандл не
 * попадает; сохранение — через существующий сервис services/snapshot.ts.
 *
 * Канон дня: срез отчёта — ЧЕТВЕРГ. Дата папки выгрузки — дата ОТПРАВКИ
 * (обычно пятница, люди шлют отчёт наутро после среза); снимок приписывается
 * четвергу той же недели (ревью §4.7-3 кв). Арифметика недель — канонические
 * mondayOfDay/isoOfDayNumber из @aemr/shared/parse-sheet-date, копий нет.
 */
import {
  collectRowsByDept,
  dayNumberOf,
  isoOfDayNumber,
  mondayOfDay,
  type DataSnapshot,
  type DepartmentEntry,
  type SvodGridBlock,
} from '@aemr/shared';
import { departmentSheetNameCandidates } from './sheet-name-candidates.js';

/** Дней от понедельника до четверга той же недели. */
const MONDAY_TO_THURSDAY = 3;

/** День отправки выгрузки → четверг той же недели (понедельник–воскресенье). */
export function thursdayOfWeek(day: number): number {
  return mondayOfDay(day) + MONDAY_TO_THURSDAY;
}

/** «Отчет по закупкам 08.05.2026» → номер суток даты папки; даты нет → null. */
export function parseFolderDate(folderName: string): number | null {
  const m = folderName.match(/\d{2}\.\d{2}\.\d{4}/);
  return m ? dayNumberOf(m[0]) : null;
}

/**
 * createdAt снимка-бэкфилла: ПОЛНОЧЬ UTC четверга — точка в пересечении ОБЕИХ
 * календарных осей. Ось записей: dayNumberOf(createdAt) разбирает строку и даёт
 * ровно этот четверг. Ось календаря продукта (Камчатка +12, productCalendarDay):
 * floor(X + 12/24) = X — тоже этот четверг, поэтому retention группирует снимок
 * в СВОЮ неделю среза. Полдень UTC был бы пятницей продукта — retention относил
 * бы снимок к следующей неделе и удалял сразу после записи (блокер R2a №1).
 */
export function thursdayMidnightIso(day: number): string {
  return `${isoOfDayNumber(day)}T00:00:00.000Z`;
}

/** id снимка-бэкфилла — происхождение и день видны прямо в идентификаторе. */
export function backfillSnapshotId(day: number): string {
  return `backfill-${isoOfDayNumber(day)}`;
}

/**
 * Вкладка книги ГРБС в выгрузке — по канону кандидатов сервиса живого чтения
 * (у УЭР приоритет «ВСЕ» — периметр официального СВОДа, следствие 2026-07-23;
 * старые книги без «ВСЕ» падают на одноимённую вкладку). Нет ни одного
 * кандидата → null: вызывающий код честно логирует пропуск, не угадывает.
 */
export function pickDeptSheet(
  sheetNames: readonly string[],
  dept: DepartmentEntry,
): string | null {
  for (const candidate of departmentSheetNameCandidates(dept.sheetName, dept.id)) {
    if (sheetNames.includes(candidate)) return candidate;
  }
  return null;
}

/** Пустая ли ячейка в смысле листа: null/undefined/пробельная строка. 0 — НЕ пусто. */
const isEmptyCell = (v: unknown): boolean =>
  v === null || v === undefined || String(v).trim() === '';

/**
 * Срезать ХВОСТ целиком пустых строк. xlsx-выгрузки несут ref до ~1000-й
 * строки; живой Google-кэш пустой хвост не отдаёт — выравниваем форму и не
 * раздуваем снимок. Строки формульных нулей (0,0,…) непустые и остаются, как
 * и внутренние пустые строки — нумерация строк книги не сдвигается.
 */
export function trimTrailingEmptyRows(
  values: ReadonlyArray<readonly unknown[]>,
): unknown[][] {
  let last = values.length - 1;
  while (last >= 0 && (values[last] ?? []).every(isEmptyCell)) last--;
  return values.slice(0, last + 1).map((row) => [...row]);
}

/** Разобранное содержимое одной недельной выгрузки (папки). */
export interface BackfillSource {
  /** Значения канон-вкладок книг ГРБС С шапкой; ключ — короткое имя («УЭР»…). */
  sheetValuesByDept: Record<string, unknown[][]>;
  /** Разобранный лист СВОД, если в выгрузке нашёлся (обычно СВОД там — PDF). */
  svodGrid?: SvodGridBlock[];
}

/**
 * Собрать исторический DataSnapshot из выгрузки. Снимок МИНИМАЛЬНЫЙ и честный:
 * строки-атомы (шапка срезана каноническим collectRowsByDept — тем же, что
 * кормит живой роут и пайплайн) плюс СВОД, если он был в выгрузке. Метрики,
 * сигналы и доверие НЕ выдумываются: официальных ячеек в xlsx нет, а прогон
 * пайплайна с пустым официалом породил бы артефакты «official отсутствует»
 * и засорил бы живой реестр issues историческими «open»-сигналами с
 * detectedAt=сегодня. Отчёт прошлой недели пересчитает всё из строк снимка
 * сам (buildReport); trust 0/F читается как «официальная верификация
 * отсутствует» — что и есть правда для бэкфилла.
 */
export function buildBackfillSnapshot(
  thursdayDay: number,
  source: BackfillSource,
): DataSnapshot {
  const id = backfillSnapshotId(thursdayDay);
  const createdAt = thursdayMidnightIso(thursdayDay);
  const rowsByDept = collectRowsByDept(source.sheetValuesByDept);
  const perSheetRowCount = Object.fromEntries(
    Object.entries(rowsByDept).map(([dept, rows]) => [dept, rows.length]),
  );
  const rowCount = Object.values(rowsByDept).reduce((n, rows) => n + rows.length, 0);

  return {
    id,
    spreadsheetId: 'backfill-weekly-xlsx',
    createdAt,
    officialMetrics: {},
    calculatedMetrics: {},
    deltas: [],
    issues: [],
    trust: { overall: 0, components: [], grade: 'F', computedAt: createdAt, basedOnSnapshot: id },
    rowCount,
    ...(Object.keys(rowsByDept).length > 0 ? { rowsByDept } : {}),
    ...(source.svodGrid && source.svodGrid.length > 0 ? { svodGrid: source.svodGrid } : {}),
    metadata: {
      sheetsRead: Object.keys(rowsByDept),
      cellsRead: 0,
      readDurationMs: 0,
      pipelineDurationMs: 0,
      perSheetRowCount,
    },
  };
}
