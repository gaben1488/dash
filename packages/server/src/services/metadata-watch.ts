/**
 * metadata-watch.ts — ДОЗОР МЕТАДАННЫХ книг ГРБС.
 *
 * ЗАЧЕМ. Оформление книги — не украшение, а часть механизма правильности:
 * защита формульной колонки не даёт вбить число поверх формулы, правило УФ
 * красит сломанную формулу, проверка данных не пускает «ЭК» в колонку способа.
 * Снимут защиту — и первое же перетаскивание строки перебьёт формулу молча;
 * продукт увидит последствие (расхождение итога) недели через две, а причину —
 * никогда. Дозор смотрит на ПРЕДВЕСТНИК: пропала защита, поменялось число
 * правил, изменилась валидация.
 *
 * ЧЕГО ДОЗОР НЕ ДЕЛАЕТ — И ЭТО ГЛАВНОЕ. Он НЕ ИСПОЛНЯЕТ правила условного
 * форматирования. Владелец 30.08.2026 отклонил вариант «продукт-исполнитель
 * метаданных»: чтобы исполнять условия книги, нужен интерпретатор формул
 * Google Sheets (REGEXMATCH, TO_TEXT, FORMULATEXT, ссылки) — отдельный движок
 * со своим классом багов, да ещё и вносящий внутрь продукта правила книги,
 * местами противоречащие канону продукта (п.27 о нечтении свободного текста).
 * Здесь сравниваются ЧИСЛА И НАЛИЧИЕ, и ничего кроме: сколько правил стоит,
 * укрыта ли колонка защитой, есть ли проверка данных. Формулы правил не
 * читаются, не разбираются и не вычисляются. Страж на это —
 * `metadata-watch.test.ts` («правила с бессмысленными формулами не рождают
 * замечаний, пока их число совпадает с каноном»).
 *
 * ЦЕНА. Одно обращение `spreadsheets.get` на книгу: маска полей забирает
 * свойства листа, защиты, перечень правил УФ и пробу проверки данных одной
 * строки (A4:AH4). Восемь книг ночью — восемь обращений, единицы килобайт
 * каждое: это не грид, а описание листа. Отдельно платится разбор имени
 * вкладки (`resolveDeptSheetName`), но у него кэш на процесс.
 *
 * КОГДА. Раз в сутки, тем же ночным окном, что и полный обход комментариев
 * (`drive-comments.ts`, 3:00 по продуктовому поясу) — расписание берётся
 * оттуда же, чтобы двух разных «ночей» в продукте не завелось.
 */
import { google, type sheets_v4 } from 'googleapis';
import { config, DEPARTMENT_SPREADSHEETS } from '../config.js';
import { letterToColumn, resolveDeptSheetName } from './google-sheets.js';
import { sheetValuesRange } from './sheet-range.js';
import { METADATA_CANON } from './metadata-canon.js';
import { NIGHT_SWEEP_HOUR, sweepDueNow } from './drive-comments.js';
import { refreshAllSources } from './source-refresh.js';
import { classifySourceFailure } from './source-failure.js';
import { logSourceFailure } from './source-log.js';

// ---------------------------------------------------------------------------
// Что читается у книги
// ---------------------------------------------------------------------------

/** Прямоугольник защиты в индексах от нуля; `null` — «до края листа». */
export interface ProtectedArea {
  description: string | null;
  startRow: number | null;
  endRow: number | null;
  startColumn: number | null;
  endColumn: number | null;
}

/** Снимок метаданных ОДНОГО листа книги. */
export interface SheetMetadata {
  sheetName: string;
  /** Сколько правил условного форматирования стоит на листе. */
  conditionalFormatCount: number;
  protectedAreas: ProtectedArea[];
  /**
   * Проверка данных пробной строки: буква колонки → тип условия.
   * Колонки без проверки в карте ОТСУТСТВУЮТ (а не лежат с `null`), чтобы
   * «нет проверки» и «проверка неизвестного вида» не смешались.
   */
  validationByColumn: Record<string, string>;
}

/** Тонкая обёртка над Google — подменяется в стражах, чтобы не ходить в сеть. */
export interface MetadataApi {
  read(spreadsheetId: string, sheetName: string): Promise<SheetMetadata>;
}

let realApi: MetadataApi | null = null;

/**
 * Маска полей — ровно то, что нужно дозору, и ни байтом больше. `ranges` +
 * `includeGridData` дают пробу проверки данных одной строки; свойства листа,
 * защиты и перечень правил приезжают тем же ответом, поэтому обращение одно.
 */
const METADATA_FIELDS =
  'sheets(properties(sheetId,title),protectedRanges(description,range),'
  + 'conditionalFormats(ranges),data(rowData(values(dataValidation(condition(type))))))';

function googleMetadataApi(): MetadataApi | null {
  if (realApi) return realApi;
  const { serviceAccountEmail, privateKey } = config.google;
  if (!serviceAccountEmail || !privateKey) return null;
  const sheets = google.sheets({
    version: 'v4',
    auth: new google.auth.GoogleAuth({
      credentials: { client_email: serviceAccountEmail, private_key: privateKey },
      scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    }),
  });
  realApi = {
    async read(spreadsheetId, sheetName) {
      const probe = sheetValuesRange(
        sheetName,
        `A${METADATA_CANON.probeRow}:AH${METADATA_CANON.probeRow}`,
      );
      const res = await sheets.spreadsheets.get({
        spreadsheetId,
        ranges: [probe],
        includeGridData: true,
        fields: METADATA_FIELDS,
      });
      return readSheetMetadata(res.data, sheetName);
    },
  };
  return realApi;
}

/** Только для стражей: подменить или забыть обёртку над Google. */
export function setMetadataApi(api: MetadataApi | null): void {
  realApi = api;
}

/**
 * Разбор ответа Google в снимок. Вынесен отдельно и экспортирован: форма
 * ответа — это то, на чём ломаются такие проверки, и страж обязан уметь
 * подать сюда настоящую форму, а не выдуманную.
 */
export function readSheetMetadata(
  data: sheets_v4.Schema$Spreadsheet,
  sheetName: string,
): SheetMetadata {
  const sheet = (data.sheets ?? []).find((s) => s.properties?.title === sheetName)
    ?? (data.sheets ?? [])[0];

  const protectedAreas: ProtectedArea[] = (sheet?.protectedRanges ?? []).map((p) => ({
    description: p.description ?? null,
    startRow: p.range?.startRowIndex ?? null,
    endRow: p.range?.endRowIndex ?? null,
    startColumn: p.range?.startColumnIndex ?? null,
    endColumn: p.range?.endColumnIndex ?? null,
  }));

  const validationByColumn: Record<string, string> = {};
  const probeRow = sheet?.data?.[0]?.rowData?.[0]?.values ?? [];
  for (let c = 0; c < probeRow.length; c++) {
    const type = probeRow[c]?.dataValidation?.condition?.type;
    if (type) validationByColumn[columnLetter(c)] = type;
  }

  return {
    sheetName: sheet?.properties?.title ?? sheetName,
    conditionalFormatCount: (sheet?.conditionalFormats ?? []).length,
    protectedAreas,
    validationByColumn,
  };
}

/** Индекс колонки от нуля → буква (0 = A, 26 = AA). */
export function columnLetter(index: number): string {
  let result = '';
  let n = index;
  while (n >= 0) {
    result = String.fromCharCode(65 + (n % 26)) + result;
    n = Math.floor(n / 26) - 1;
  }
  return result;
}

// ---------------------------------------------------------------------------
// Сверка с ожидаемым слепком
// ---------------------------------------------------------------------------

/** Род дрейфа. Три — ровно те, что назвал владелец 30.08. */
export type DriftKind =
  | 'protection_removed'
  | 'conditional_formats_count'
  | 'validation_changed';

/** Замечание книги: что разошлось с каноном оформления. */
export interface BookRemark {
  book: string;
  kind: DriftKind;
  /** Колонка, о которой речь (у счёта правил её нет). */
  column?: string;
  /** Что ожидал канон и что стоит в книге — словами, готовыми к показу. */
  expected: string;
  actual: string;
  text: string;
}

/** Ожидание по книге: полный канон или только цветовой слой (лист-подвед). */
export interface MetadataExpectation {
  /** Сколько правил УФ ожидается. */
  conditionalFormatRules: number;
  /** Сторожить ли защиты и проверку данных (у подведов их канон не задаёт). */
  guardProtections: boolean;
  guardValidation: boolean;
}

/** Ожидание для книги ГРБС под полным каноном. */
export const FULL_CANON_EXPECTATION: MetadataExpectation = {
  conditionalFormatRules: METADATA_CANON.conditionalFormatRules.full,
  guardProtections: true,
  guardValidation: true,
};

/** Покрывает ли защита колонку `column` на строках тела листа. */
function areaCoversColumn(area: ProtectedArea, column: number): boolean {
  const from = area.startColumn ?? 0;
  const to = area.endColumn ?? Number.POSITIVE_INFINITY;
  if (column < from || column >= to) return false;
  // Защита шапки (строки 1–3) колонку тела не укрывает: у неё есть верхняя
  // граница ровно на первой строке данных. Без этой проверки снятая защита
  // формульной колонки пряталась бы за существующей защитой шапки.
  const rowTo = area.endRow ?? Number.POSITIVE_INFINITY;
  return rowTo > METADATA_CANON.headerRows;
}

/**
 * Сверить снимок книги с ожидаемым слепком. Чистая функция: ни сети, ни
 * состояния — страж проверяет каждое из трёх замечаний по отдельности.
 *
 * ПОРЯДОК ПОСТОЯНЕН (защиты → правила → проверка данных): перечень замечаний
 * попадает на экран, и переставлять его от прогона к прогону значит заставлять
 * читателя каждый раз искать заново.
 */
export function compareMetadata(
  book: string,
  actual: SheetMetadata,
  expectation: MetadataExpectation = FULL_CANON_EXPECTATION,
): BookRemark[] {
  const remarks: BookRemark[] = [];

  if (expectation.guardProtections) {
    for (const group of METADATA_CANON.protectedColumnGroups) {
      const from = letterToColumn(group.from);
      const to = letterToColumn(group.to);
      for (let c = from; c <= to; c++) {
        if (actual.protectedAreas.some((area) => areaCoversColumn(area, c))) continue;
        const letter = columnLetter(c);
        remarks.push({
          book,
          kind: 'protection_removed',
          column: letter,
          expected: 'колонка под защитой',
          actual: 'защиты нет',
          text: `В книге «${book}» снята защита формульной колонки ${letter}`,
        });
      }
    }
  }

  if (actual.conditionalFormatCount !== expectation.conditionalFormatRules) {
    remarks.push({
      book,
      kind: 'conditional_formats_count',
      expected: `${expectation.conditionalFormatRules}`,
      actual: `${actual.conditionalFormatCount}`,
      text:
        `В книге «${book}» правил условного форматирования `
        + `${actual.conditionalFormatCount} вместо ${expectation.conditionalFormatRules}`,
    });
  }

  if (expectation.guardValidation) {
    for (const column of METADATA_CANON.validationColumns) {
      if (actual.validationByColumn[column]) continue;
      remarks.push({
        book,
        kind: 'validation_changed',
        column,
        expected: 'проверка данных задана',
        actual: 'проверки нет',
        text: `В книге «${book}» снята проверка данных колонки ${column}`,
      });
    }
    for (const column of METADATA_CANON.validationCleared) {
      const type = actual.validationByColumn[column];
      if (!type) continue;
      remarks.push({
        book,
        kind: 'validation_changed',
        column,
        expected: 'проверка данных снята (формульная колонка)',
        actual: `проверка данных вида ${type}`,
        text:
          `В книге «${book}» на формульной колонке ${column} появилась проверка данных `
          + `(${type}) — по канону она снята`,
      });
    }
  }

  return remarks;
}

// ---------------------------------------------------------------------------
// Обход книг и память дозора
// ---------------------------------------------------------------------------

/** Итог дозора по одной книге. */
export interface BookWatchResult {
  book: string;
  /** Читали ли метаданные. `false` — причина в `skippedBecause`. */
  read: boolean;
  skippedBecause?: string;
  at: string;
  remarks: BookRemark[];
}

const lastWatch = new Map<string, BookWatchResult>();

export interface WatchLog {
  info: (msg: string) => void;
  warn: (msg: string) => void;
}

/** Прочитать метаданные одной книги и сверить их с каноном. */
export async function watchBookMetadata(
  book: string,
  spreadsheetId: string,
  api: MetadataApi | null = googleMetadataApi(),
  expectation: MetadataExpectation = FULL_CANON_EXPECTATION,
  now: Date = new Date(),
): Promise<BookWatchResult> {
  const at = now.toISOString();
  if (!api) {
    return {
      book,
      read: false,
      skippedBecause: 'нет служебной учётной записи — спросить книгу не у кого',
      at,
      remarks: [],
    };
  }
  try {
    const sheetName = await resolveDeptSheetName(book, spreadsheetId);
    const metadata = await api.read(spreadsheetId, sheetName);
    return { book, read: true, at, remarks: compareMetadata(book, metadata, expectation) };
  } catch (err) {
    const reason = classifySourceFailure((err as Error)?.message ?? String(err));
    logSourceFailure(`дозор метаданных книги «${book}»`, { ms: 0, reason });
    return { book, read: false, skippedBecause: reason, at, remarks: [] };
  }
}

/**
 * Полный обход книг ГРБС. Отказ одной книги не валит остальные: её итог честно
 * говорит «не читали», а не «замечаний нет».
 */
export async function sweepMetadata(
  log?: WatchLog,
  api: MetadataApi | null = googleMetadataApi(),
  books: Record<string, string> = DEPARTMENT_SPREADSHEETS,
): Promise<BookWatchResult[]> {
  const results = await Promise.all(
    Object.entries(books).map(([book, id]) => watchBookMetadata(book, id, api)),
  );
  for (const result of results) lastWatch.set(result.book, result);

  const read = results.filter((r) => r.read);
  const remarks = read.reduce((sum, r) => sum + r.remarks.length, 0);
  log?.info(
    `Дозор метаданных: прочитано книг ${read.length} из ${results.length}, `
    + (remarks > 0 ? `замечаний ${remarks}` : 'дрейфа нет'),
  );
  for (const result of read) {
    for (const remark of result.remarks) log?.warn(`Дозор метаданных: ${remark.text}`);
  }
  return results;
}

/**
 * Что известно дозору. Книги, которой здесь НЕТ, дозор не видел ни разу за
 * жизнь процесса — и молчание про неё означает «не смотрели», а не «чисто».
 * Это же различие несёт поле `read` у каждой книги.
 */
export function metadataWatchState(): {
  canonSyncedAt: string;
  books: BookWatchResult[];
  /** Книги, которых дозор ещё не касался. */
  notWatched: string[];
} {
  const books = [...lastWatch.values()].sort((a, b) => a.book.localeCompare(b.book, 'ru'));
  const seen = new Set(books.map((b) => b.book));
  return {
    canonSyncedAt: METADATA_CANON.syncedAt,
    books,
    notWatched: Object.keys(DEPARTMENT_SPREADSHEETS).filter((b) => !seen.has(b)).sort(),
  };
}

/** Только для стражей: забыть память дозора. */
export function resetMetadataWatch(): void {
  lastWatch.clear();
}

// ---------------------------------------------------------------------------
// Ночной обход: дозор метаданных + полное чтение формул
// ---------------------------------------------------------------------------

const SWEEP_TICK_MS = 60 * 60 * 1000;
let sweepTimer: ReturnType<typeof setInterval> | null = null;
let lastSweepDay: string | null = null;

/**
 * Ночная работа целиком: сперва дозор метаданных, следом ПОЛНОЕ чтение формул
 * всех книг.
 *
 * Почему формулы ночью читаются БЕЗ вопроса Drive «а менялся ли файл»
 * (`askDrive: false`). Вопрос отвечает на «изменилось ли содержимое с прошлого
 * ЧТЕНИЯ», а формулы днём могли не читаться вовсе: книгу правили до того, как
 * появился этот дозор, или уведомление потерялось. Ночной обход — сеть
 * безопасности, и сеть с дырой «а мы это уже читали» не сеть. Лист СВОД в цель
 * не входит: формул книг ГРБС в нём нет, а его собственные формулы сторожит
 * сверка.
 */
export async function nightlyIntegritySweep(log: WatchLog): Promise<void> {
  await sweepMetadata(log);
  const refresh = await refreshAllSources(log, 'cycle', {
    fresh: true,
    svod: false,
    askDrive: false,
    withFormulas: true,
  });
  log.info(
    `Ночной обход формул: книг прочитано ${refresh.booksRead}`
    + (refresh.formulaBooks.length > 0
      ? `, формулы получены по книгам: ${refresh.formulaBooks.join(', ')}`
      : ', формулы не получены ни по одной книге')
    + (refresh.failed.length > 0 ? `, не прочитано: ${refresh.failed.join(', ')}` : ''),
  );
}

/**
 * Включить ночной обход целостности. Расписание — то же, что у обхода
 * комментариев (`drive-comments.ts`): один час в сутки по продуктовому поясу,
 * проверка раз в час, и проверка СРАЗУ при включении — сервер, поднятый в
 * 03:10, не имеет права проспать окно до следующих суток.
 *
 * `sweep` подменяется только стражами.
 */
export function startNightlyIntegritySweep(
  log: WatchLog,
  sweep: (log: WatchLog) => Promise<unknown> = nightlyIntegritySweep,
): () => void {
  if (sweepTimer) return stopNightlyIntegritySweep;
  const tick = (): void => {
    const check = sweepDueNow(new Date(), config.weeklySnapshot.utcOffsetHours, lastSweepDay);
    if (!check.due) return;
    lastSweepDay = check.day;
    void sweep(log).catch((err: unknown) => {
      log.warn(`Ночной обход целостности не удался: ${(err as Error).message}`);
    });
  };
  sweepTimer = setInterval(tick, SWEEP_TICK_MS);
  sweepTimer.unref?.();
  log.info(`Ночной обход целостности включён: ${NIGHT_SWEEP_HOUR}:00 по продуктовому поясу`);
  tick();
  return stopNightlyIntegritySweep;
}

export function stopNightlyIntegritySweep(): void {
  if (sweepTimer) {
    clearInterval(sweepTimer);
    sweepTimer = null;
  }
  lastSweepDay = null;
}
