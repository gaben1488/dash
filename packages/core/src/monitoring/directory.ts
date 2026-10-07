/**
 * directory.ts — адаптер справочника заказчиков и его связь с реестром.
 *
 * Источник эволюционировал: ранняя книга имела четыре колонки и две опечатки
 * в заголовках, текущая — канонический «Справочник заказчиков» с полными и
 * краткими именами, legacy-наименованием, алиасами, именем из книг ГРБС и,
 * в окружной версии, отдельными колонками нового муниципального округа.
 *
 * Парсер принимает обе схемы. Для текущей схемы окружные имена имеют приоритет,
 * но прежние канонические имена, legacy-краткое, имя из книг ГРБС и каждый
 * явный алиас также индексируются как доказанные варианты написания.
 *
 * Продукт не переписывает справочник. Он говорит вслух две вещи: «сокращения
 * нет» там, где длинный текст притворяется коротким, и список написаний, для
 * которых учреждение не нашлось, — отсортированный по частоте, чтобы отдел
 * свёл их к одному виду за один заход. Тон — объяснение, не упрёк (п.104).
 */

import { monitoringNumber, monitoringText } from './cells.js';
import { MONITORING_DIRECTORY_SHEET, normalizeCustomer } from './procedures.js';

/** Ранняя четырёхколоночная схема (0-based). */
const LEGACY_DIRECTORY_COLUMNS = {
  ORDINAL: 0,
  GRBS: 1,
  FULL_NAME: 2,
  SHORT_NAME: 3,
} as const;

/** Текущая каноническая схема (0-based). */
const CURRENT_DIRECTORY_COLUMNS = {
  ORDINAL: 0,
  GRBS: 2,
  FULL_NAME: 3,
  SHORT_NAME: 4,
  LEGACY_SHORT_NAME: 5,
  ALIASES: 8,
  SOURCE_BOOK_NAME: 11,
  OKRUG_FULL_NAME: 16,
  OKRUG_SHORT_NAME: 17,
} as const;

/** Дословные подписи прежней схемы — оставлены для совместимого импорта. */
export const MONITORING_DIRECTORY_HEADER: readonly string[] = [
  '№ п/п', 'ГРБС', 'Наименованиеучрежения', 'Сокращеное наименование учреждения',
];

/** Минимальные маркеры текущего «Справочника заказчиков». */
export const MONITORING_DIRECTORY_HEADER_V2: readonly string[] = [
  '№ п/п',
  'Управление',
  'Новый каноничный справочник полных наименований',
  'Новый каноничный справочник кратких наименований',
  'Алиасы и варианты написания',
];

function currentDirectorySchema(grid: unknown[][]): boolean {
  const header = (grid[0] ?? []).map((value) => monitoringText(value));
  // Coordinates belong to the schema; labels may be clarified without changing meaning.
  return [
    [0, ['№ п/п']], [2, ['Управление']],
    [3, ['Новый каноничный справочник полных наименований', 'Полное наименование']],
    [4, ['Новый каноничный справочник кратких наименований', 'Сокращённое наименование']],
    [8, ['Алиасы и варианты написания', 'Другие написания']],
  ].every(([column, names]) => (names as string[]).includes(header[column as number] ?? ''));
}

function directoryAliases(raw: unknown[], modern: boolean): string[] {
  if (!modern) return [];
  const C = CURRENT_DIRECTORY_COLUMNS;
  const direct = [
    monitoringText(raw[C.FULL_NAME]),
    monitoringText(raw[C.SHORT_NAME]),
    monitoringText(raw[C.LEGACY_SHORT_NAME]),
    monitoringText(raw[C.SOURCE_BOOK_NAME]),
    monitoringText(raw[C.OKRUG_FULL_NAME]),
    monitoringText(raw[C.OKRUG_SHORT_NAME]),
  ];
  const aliases = monitoringText(raw[C.ALIASES])?.split(';').map((value) => value.trim()) ?? [];
  return [...direct, ...aliases].filter((value): value is string => Boolean(value && value !== '-'));
}

export interface DirectoryEntry {
  readonly sheet: string;
  readonly row: number;
  readonly ordinal: number | null;
  /** ГРБС-владелец учреждения («УО», «УКСиМП», …). */
  readonly grbs: string | null;
  readonly fullName: string | null;
  readonly shortName: string | null;
  /** Сокращённое дословно повторяет полное — сокращения в книге нет. */
  readonly shortIsFull: boolean;
  /** Полное наименование не заполнено (четыре строки книги). */
  readonly fullMissing: boolean;
  /** Сколько строк реестра ссылается на это учреждение (наша нормализация). */
  readonly usageCount: number;
}

/** Написание заказчика, которому в справочнике нет пары. */
export interface CustomerOutsideDirectory {
  /** Написание как в книге — первое встреченное. */
  readonly name: string;
  readonly normalized: string;
  readonly count: number;
  /** Управления, на листах которых встречается это написание. */
  readonly depts: readonly string[];
}

export interface MonitoringDirectory {
  readonly entries: DirectoryEntry[];
  /** Написания заказчика вне справочника, по убыванию частоты. */
  readonly customersOutside: CustomerOutsideDirectory[];
  /** Сколько написаний заказчика нашли пару в справочнике. */
  readonly customersMatched: number;
  /** Сколько строк справочника не имеет настоящего сокращения. */
  readonly withoutShortName: number;
}

/** Строка реестра, какой её видит справочник: заказчик и управление. */
export interface DirectoryUsageRow {
  readonly customer: string;
  readonly customerNormalized: string;
  readonly dept: string;
}

/**
 * Разобрать справочник и связать его с написаниями заказчика из реестра.
 *
 * Связь идёт по нормализованному имени (регистр, кавычки, лишние пробелы,
 * «ё») и по полному, и по сокращённому наименованию. Нормализация НАША, и
 * экран обязан это подписать: книга такой связи не ведёт.
 */
export function parseMonitoringDirectory(
  grid: unknown[][] | undefined,
  usage: readonly DirectoryUsageRow[] = [],
): MonitoringDirectory {
  const entries: DirectoryEntry[] = [];
  if (!grid) {
    return {
      entries,
      customersOutside: collectCustomers(usage, new Map()),
      customersMatched: 0,
      withoutShortName: 0,
    };
  }

  const modern = currentDirectorySchema(grid);
  const C = modern ? CURRENT_DIRECTORY_COLUMNS : LEGACY_DIRECTORY_COLUMNS;
  const index = new Map<string, number>();
  const drafts: Array<Omit<DirectoryEntry, 'usageCount'>> = [];

  for (let i = 0; i < grid.length; i++) {
    const raw = grid[i] ?? [];
    if (modern && i === 0) continue;

    const canonicalFull = monitoringText(raw[C.FULL_NAME]);
    const canonicalShort = monitoringText(raw[C.SHORT_NAME]);
    const fullName = modern
      ? monitoringText(raw[CURRENT_DIRECTORY_COLUMNS.OKRUG_FULL_NAME]) ?? canonicalFull
      : canonicalFull;
    const shortName = modern
      ? monitoringText(raw[CURRENT_DIRECTORY_COLUMNS.OKRUG_SHORT_NAME]) ?? canonicalShort
      : canonicalShort;
    const grbs = monitoringText(raw[C.GRBS]);
    if (fullName === null && shortName === null) continue;
    // Строка шапки прежней схемы: в колонке ГРБС стоит слово «ГРБС».
    if (!modern && grbs !== null && /^грбс$/iu.test(grbs)) continue;

    const normFull = fullName === null ? null : normalizeCustomer(fullName);
    const normShort = shortName === null ? null : normalizeCustomer(shortName);
    const draftIndex = drafts.length;
    const knownNames = modern
      ? directoryAliases(raw, true)
      : [fullName, shortName].filter((value): value is string => value !== null);
    for (const name of knownNames) {
      const normalized = normalizeCustomer(name);
      if (normalized && !index.has(normalized)) index.set(normalized, draftIndex);
    }

    drafts.push({
      sheet: MONITORING_DIRECTORY_SHEET,
      row: i + 1,
      ordinal: monitoringNumber(raw[C.ORDINAL]),
      grbs,
      fullName,
      shortName,
      shortIsFull: normFull !== null && normShort !== null && normFull === normShort,
      fullMissing: fullName === null,
    });
  }

  const usageCounts = new Array<number>(drafts.length).fill(0);
  let customersMatched = 0;
  const matchedNormalized = new Set<string>();
  for (const row of usage) {
    const at = index.get(row.customerNormalized);
    if (at === undefined) continue;
    usageCounts[at] += 1;
    if (!matchedNormalized.has(row.customerNormalized)) {
      matchedNormalized.add(row.customerNormalized);
      customersMatched += 1;
    }
  }

  for (let i = 0; i < drafts.length; i++) {
    entries.push({ ...drafts[i], usageCount: usageCounts[i] });
  }

  return {
    entries,
    customersOutside: collectCustomers(usage, index),
    customersMatched,
    withoutShortName: entries.filter((e) => e.shortIsFull).length,
  };
}

/** Написания заказчика, которых справочник не знает, по убыванию частоты. */
function collectCustomers(
  usage: readonly DirectoryUsageRow[],
  index: ReadonlyMap<string, number>,
): CustomerOutsideDirectory[] {
  const buckets = new Map<string, { name: string; count: number; depts: Set<string> }>();
  for (const row of usage) {
    if (row.customerNormalized === '' || index.has(row.customerNormalized)) continue;
    const bucket = buckets.get(row.customerNormalized);
    if (bucket === undefined) {
      buckets.set(row.customerNormalized, {
        name: row.customer,
        count: 1,
        depts: new Set([row.dept]),
      });
    } else {
      bucket.count += 1;
      bucket.depts.add(row.dept);
    }
  }
  return [...buckets.entries()]
    .map(([normalized, b]) => ({
      name: b.name,
      normalized,
      count: b.count,
      depts: [...b.depts].sort(),
    }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'ru'));
}

// ── Скрытые листы-предки ─────────────────────────────────────────────

/**
 * Три скрытых листа книги. «Отчет по процедурам Свод» и «СВОД» пусты — в
 * обоих только шапка из семнадцати колонок; «ГРБС» — побайтовая копия
 * справочника. Данных там ноль, но шапка богаче нынешней рабочей формы,
 * и продукт показывает её как ПАМЯТЬ О ФОРМЕ: это разговор с владельцем о
 * том, какие поля вернуть в книгу (спека §1.5, §2.5).
 */
export const MONITORING_ANCESTOR_SHEETS: ReadonlyArray<{
  readonly sheet: string;
  readonly kind: 'form' | 'copy';
  readonly note: string;
  readonly header: readonly string[];
}> = [
  {
    sheet: 'Отчет по процедурам Свод',
    kind: 'form',
    note: 'Лист-предок: шапка из семнадцати колонок, строк данных ноль.',
    header: [
      '№ п/п', 'Наименование муниципальной программы',
      'Общий объём ассигнований, с учётом тек. деятельности (М.б., К.б., Ф.б.)',
      'Остаток не принятых (свободных) бюджетных обязательств', 'Заказчик',
      'Наименование объекта закупки', 'Начальная (максимальная) цена',
      'Дата поступления заявки в УО', 'Дата публикации', 'Статус',
      'Дата окончания подачи заявок', 'Дата окончания срока рассмотрения заявок',
      'Дата проведения торгов/переторжки', 'Кол-во заявок от поставщиков',
      'Цена аукциона', 'Экономия', 'Победитель',
    ],
  },
  {
    sheet: 'СВОД',
    kind: 'form',
    note: 'Второй лист-предок с той же шапкой, строк данных ноль.',
    header: [],
  },
  {
    sheet: 'ГРБС',
    kind: 'copy',
    note: 'Побайтовая копия «Перечня ГРБС», включая обе опечатки в шапке; два источника одного справочника разойдутся при первой правке одного из них.',
    header: MONITORING_DIRECTORY_HEADER,
  },
];

/**
 * Поля, которые есть в шапке листов-предков и которых нет в рабочей форме.
 * Из-за них воронка имеет пять ступеней вместо шести, а конкуренция
 * оценивается косвенно (спека §7).
 */
export const MONITORING_MISSING_FIELDS: readonly string[] = [
  'Статус',
  'Дата окончания срока рассмотрения заявок',
  'Кол-во заявок от поставщиков',
  'Наименование муниципальной программы',
  'Общий объём ассигнований',
  'Остаток не принятых (свободных) бюджетных обязательств',
];
