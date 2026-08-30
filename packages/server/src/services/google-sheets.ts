import { google, type sheets_v4 } from 'googleapis';
import { config } from '../config.js';
import {
  ALL_SHEETS,
  DEPARTMENT_REGISTRY,
  SHDYU_MONTHLY_SHEET_NAME,
} from '@aemr/shared';
import type { WorkbookSnapshot, SheetData, CellValue } from '@aemr/shared';
import { departmentSheetNameCandidates } from './sheet-name-candidates.js';
import { sheetValuesRange } from './sheet-range.js';
import { withSheetsRetry } from './sheets-retry.js';
import { classifySourceFailure } from './source-failure.js';
import { logSourceFailure, logSourceRead, logSourceRetry, logSourceWrite } from './source-log.js';

// ============================================================
// Google Sheets API Service — AEMR Platform
// ============================================================
//
// ЕДИНСТВЕННЫЙ модуль доступа к Google Sheets. Исторический дубль
// src/google-sheets.ts (без дедлайнов: висящий запрос держал снимок, журнал
// и маппинг бесконечно, минуя 503-деградацию) слит сюда 14.08.2026.
// getSheetData(sheetName, spreadsheetId?) и getSpreadsheetMetadata(spreadsheetId?)
// принимают необязательный spreadsheetId (по умолчанию — основная книга
// config.google.spreadsheetId); все вызовы идут под withSheetsDeadline.

// ------------------------------------------------------------------
// Срок ответа источника
// ------------------------------------------------------------------
//
// Без срока зависший запрос к Google держит обработчик до победного: сокет
// живёт, обещание не разрешается, а вместе с ним стоит и та работа, ради
// которой читателю открыли страницу. Срок ставится ДВАЖДЫ и не зря:
//   • `timeout` в самом вызове — его понимает транспорт googleapis и реально
//     обрывает сокет, освобождая ресурс;
//   • собственная гонка со сроком — страховка на то, чего транспорт не
//     покрывает: получение токена служебной учётной записи идёт отдельным
//     запросом, и его зависание внутренним сроком вызова не ловится.
//
// Значение перекрывается переменной окружения AEMR_SHEETS_TIMEOUT_MS —
// на медленном канале двадцати секунд может не хватать.
const DEFAULT_SHEETS_TIMEOUT_MS = 20_000;

function readTimeoutMs(): number {
  const raw = Number(process.env.AEMR_SHEETS_TIMEOUT_MS);
  return Number.isFinite(raw) && raw >= 100 ? raw : DEFAULT_SHEETS_TIMEOUT_MS;
}

export const SHEETS_TIMEOUT_MS = readTimeoutMs();

/**
 * Источник не ответил или ответил отказом. Отдельный класс нужен затем, что
 * это НЕ поломка продукта: показывать читателю «внутренняя ошибка сервера»
 * (500) там, где молчит чужая таблица, — враньё. Обработчик ошибок приложения
 * узнаёт этот класс по паре statusCode/expose и отдаёт 503 с текстом ниже.
 */
export class SheetsUnavailableError extends Error {
  readonly statusCode = 503;
  /** Текст русский и говорит, что делать, — его можно показать читателю. */
  readonly expose = true;

  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'SheetsUnavailableError';
  }
}

/** Срок в тексте отказа: секунды, а на коротких сроках — миллисекунды. */
function formatDeadline(ms: number): string {
  return ms >= 1000 ? `${Math.round(ms / 1000)} с` : `${ms} мс`;
}

/**
 * Выполняет обращение к источнику со сроком. `what` — то, что читатель поймёт
 * («чтение листа „ВСЕ“»); идентификатор книги в текст не попадает никогда.
 */
export async function withSheetsDeadline<T>(
  what: string,
  run: () => Promise<T>,
  ms: number = SHEETS_TIMEOUT_MS,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(
        new SheetsUnavailableError(
          `Таблица-источник не ответила за ${formatDeadline(ms)}: ${what}. Повторите позже.`,
        ),
      );
    }, ms);
    // Таймер не держит процесс живым: иначе закрытие сервера ждало бы срока.
    timer.unref();
  });

  try {
    // Проигравшее обещание остаётся с обработчиком от гонки, поэтому его
    // поздний отказ не всплывает как необработанный.
    return await Promise.race([run(), deadline]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Чтение источника со сроком ожидания И повтором при временном отказе.
 *
 * Реестр багов 09.07.2026, PLAUSIBLE «нет повторов с задержкой при 48
 * одновременных запросах»: сборка снимка читает книги управлений разом, и
 * ответ Google «слишком часто» ронял ЦЕЛУЮ книгу из снимка, хотя лечился
 * паузой в полсекунды. Порядок обёрток важен: срок ожидания стоит ВНУТРИ
 * повтора, чтобы каждая попытка получала свой полный срок, а не делила один
 * на всех. Что повторяется, а что отдаётся сразу — sheets-retry.ts.
 *
 * ЗДЕСЬ ЖЕ ЕДИНСТВЕННАЯ ТОЧКА НАБЛЮДАЕМОСТИ ЧТЕНИЙ. Каждое обращение к
 * источнику пишет в журнал сервера строку с двумя числами — сколько строк и за
 * сколько, — а отказ пишет причину по-русски (services/source-log.ts). Раньше
 * этого не было вовсе: чтения молчали, отказы уходили в `console.warn` мимо
 * журнала, и вопрос «почему число такое» упирался в пустоту.
 *
 * `measure` — чем меряется прочитанное («строк 673»). Число строк живёт в
 * ответе по-разному (values / valueRanges / состав книги), поэтому его достаёт
 * вызывающий, а время и запись в журнал — общие для всех чтений: иначе
 * наблюдаемость снова разъедется по семи местам.
 */
async function readWithRetry<T>(
  what: string,
  run: () => Promise<T>,
  measure?: (result: T) => number,
): Promise<T> {
  const startedAt = Date.now();
  try {
    const result = await withSheetsRetry(what, () => withSheetsDeadline(what, run), {
      onRetry: ({ attempt, delayMs, error }) => {
        logSourceRetry(what, {
          attempt,
          delayMs,
          reason: classifySourceFailure((error as Error)?.message ?? String(error)),
        });
      },
    });
    logSourceRead(what, {
      ...(measure ? { rows: measure(result) } : {}),
      ms: Date.now() - startedAt,
    });
    return result;
  } catch (err) {
    // Причина по-русски, а не пересказ ответа Google: в его тексте бывают и
    // адрес книги, и почта служебной учётной записи. Подробность нужна редко,
    // а имя книги и фраза причины отвечают на вопрос «почему число такое».
    logSourceFailure(what, {
      ms: Date.now() - startedAt,
      reason: classifySourceFailure((err as Error)?.message ?? String(err)),
    });
    throw err;
  }
}

let sheetsApi: sheets_v4.Sheets | null = null;

async function getSheetsApi(): Promise<sheets_v4.Sheets> {
  if (sheetsApi) return sheetsApi;

  if (config.google.serviceAccountEmail && config.google.privateKey) {
    const auth = new google.auth.GoogleAuth({
      credentials: {
        client_email: config.google.serviceAccountEmail,
        private_key: config.google.privateKey,
      },
      scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    });
    sheetsApi = google.sheets({ version: 'v4', auth });
  } else if (config.google.apiKey) {
    sheetsApi = google.sheets({ version: 'v4', auth: config.google.apiKey });
  } else {
    const auth = new google.auth.GoogleAuth({
      scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    });
    sheetsApi = google.sheets({ version: 'v4', auth });
  }

  return sheetsApi;
}

let cachedSnapshot: WorkbookSnapshot | null = null;
let cacheTimestamp = 0;

export async function getSnapshot(force = false): Promise<WorkbookSnapshot> {
  const now = Date.now();
  const ttl = config.cache.ttlSeconds * 1000;

  if (!force && cachedSnapshot && (now - cacheTimestamp) < ttl) {
    return cachedSnapshot;
  }

  const snapshot = await fetchWorkbook();
  cachedSnapshot = snapshot;
  cacheTimestamp = now;

  return snapshot;
}

export function invalidateCache(): void {
  cachedSnapshot = null;
  cacheTimestamp = 0;
}

export async function fetchWorkbook(): Promise<WorkbookSnapshot> {
  const spreadsheetId = config.google.spreadsheetId;

  const sheetNames = ALL_SHEETS as readonly string[];
  const valueRanges = sheetNames.map((s) => sheetValuesRange(s));

  const [valuesResponse, formulasResponse] = await readWithRetry(
    'чтение основной книги целиком',
    async () => {
      const api = await getSheetsApi();
      return Promise.all([
        api.spreadsheets.values.batchGet(
          {
            spreadsheetId,
            ranges: valueRanges,
            valueRenderOption: 'UNFORMATTED_VALUE',
            dateTimeRenderOption: 'FORMATTED_STRING',
            majorDimension: 'ROWS',
          },
          { timeout: SHEETS_TIMEOUT_MS },
        ),
        api.spreadsheets.values.batchGet(
          {
            spreadsheetId,
            ranges: valueRanges,
            valueRenderOption: 'FORMULA',
            majorDimension: 'ROWS',
          },
          { timeout: SHEETS_TIMEOUT_MS },
        ),
      ]);
    },
  );

  const valRanges = valuesResponse.data.valueRanges ?? [];
  const fmtRanges = formulasResponse.data.valueRanges ?? [];

  const sheets: Record<string, SheetData> = {};

  for (let si = 0; si < sheetNames.length; si++) {
    const sheetName = sheetNames[si];
    const valRows = (valRanges[si]?.values as unknown[][] | undefined) ?? [];
    const fmtRows = (fmtRanges[si]?.values as unknown[][] | undefined) ?? [];

    const sheetData: SheetData = {};
    const maxRows = Math.max(valRows.length, fmtRows.length);

    for (let r = 0; r < maxRows; r++) {
      const valRow = valRows[r] ?? [];
      const fmtRow = fmtRows[r] ?? [];
      const maxCols = Math.max(valRow.length, fmtRow.length);

      for (let c = 0; c < maxCols; c++) {
        const value = valRow[c] ?? null;
        const formulaRaw = fmtRow[c];
        if (value === null && (formulaRaw === null || formulaRaw === undefined)) continue;
        if (value === '' && (formulaRaw === undefined || formulaRaw === '')) continue;

        const cellAddr = columnToLetter(c) + (r + 1);
        const cell: CellValue = { v: value };
        if (typeof formulaRaw === 'string' && formulaRaw.startsWith('=')) {
          cell.f = formulaRaw;
        }
        sheetData[cellAddr] = cell;
      }
    }

    sheets[sheetName] = sheetData;
  }

  return { sheets, loadedAt: new Date().toISOString(), spreadsheetId };
}

export async function getSheetData(sheetName: string, spreadsheetId?: string): Promise<unknown[][]> {
  const response = await readWithRetry(
    `чтение листа «${sheetName}»`,
    async () => {
      const api = await getSheetsApi();
      return api.spreadsheets.values.get(
        {
          spreadsheetId: spreadsheetId ?? config.google.spreadsheetId,
          range: sheetValuesRange(sheetName),
          valueRenderOption: 'UNFORMATTED_VALUE',
          dateTimeRenderOption: 'FORMATTED_STRING',
          majorDimension: 'ROWS',
        },
        { timeout: SHEETS_TIMEOUT_MS },
      );
    },
    (r) => (r.data.values as unknown[][] | undefined)?.length ?? 0,
  );

  return (response.data.values as unknown[][]) ?? [];
}

/**
 * Несколько листов ОСНОВНОЙ книги одним обращением.
 *
 * Раньше сборка снимка читала все листы книги по отдельности
 * (`ALL_SHEETS.map(getSheetData)`) — девять параллельных запросов в одну
 * секунду. Параллельность их не удешевляла: дорог здесь не процесс, а квота
 * Google, и ровно такой залп её и выжигает («слишком часто» в ответ — реестр
 * багов 09.07.2026). Одно пакетное обращение отдаёт то же самое.
 *
 * Отсутствующий лист остаётся ПУСТЫМ СПИСКОМ, а не списком с пустой строкой:
 * `[[]]` длиной единица неотличим от листа с одной строкой, и проверка
 * «зеркало отдало строки без данных» приняла бы пустоту за поломку зеркала.
 */
export async function batchGetSheetValues(
  sheetNames: readonly string[],
  spreadsheetId?: string,
): Promise<Record<string, unknown[][]>> {
  if (sheetNames.length === 0) return {};

  const response = await readWithRetry(
    `чтение листов основной книги (${sheetNames.length})`,
    async () => {
      const api = await getSheetsApi();
      return api.spreadsheets.values.batchGet(
        {
          spreadsheetId: spreadsheetId ?? config.google.spreadsheetId,
          ranges: sheetNames.map((s) => sheetValuesRange(s)),
          valueRenderOption: 'UNFORMATTED_VALUE',
          dateTimeRenderOption: 'FORMATTED_STRING',
          majorDimension: 'ROWS',
        },
        { timeout: SHEETS_TIMEOUT_MS },
      );
    },
    (r) => (r.data.valueRanges ?? []).reduce((sum, vr) => sum + (vr.values?.length ?? 0), 0),
  );

  const ranges = response.data.valueRanges ?? [];
  const out: Record<string, unknown[][]> = {};
  for (let i = 0; i < sheetNames.length; i++) {
    out[sheetNames[i]] = (ranges[i]?.values as unknown[][] | undefined) ?? [];
  }
  return out;
}

export async function batchGetCells(
  ranges: string[],
): Promise<Array<{ range: string; values: unknown[][] }>> {
  const response = await readWithRetry(
    'чтение ячеек основной книги',
    async () => {
      const api = await getSheetsApi();
      return api.spreadsheets.values.batchGet(
        {
          spreadsheetId: config.google.spreadsheetId,
          ranges,
          valueRenderOption: 'UNFORMATTED_VALUE',
          dateTimeRenderOption: 'FORMATTED_STRING',
          majorDimension: 'ROWS',
        },
        { timeout: SHEETS_TIMEOUT_MS },
      );
    },
    (r) => (r.data.valueRanges ?? []).length,
  );

  return (response.data.valueRanges ?? []).map((vr, i) => ({
    range: vr.range ?? ranges[i],
    values: (vr.values as unknown[][]) ?? [[]],
  }));
}

export async function batchGetFormulas(
  ranges: string[],
): Promise<Array<{ range: string; formulas: unknown[][] }>> {
  const response = await readWithRetry(
    'чтение формул основной книги',
    async () => {
      const api = await getSheetsApi();
      return api.spreadsheets.values.batchGet(
        {
          spreadsheetId: config.google.spreadsheetId,
          ranges,
          valueRenderOption: 'FORMULA',
          majorDimension: 'ROWS',
        },
        { timeout: SHEETS_TIMEOUT_MS },
      );
    },
    (r) => (r.data.valueRanges ?? []).length,
  );

  return (response.data.valueRanges ?? []).map((vr, i) => ({
    range: vr.range ?? ranges[i],
    formulas: (vr.values as unknown[][]) ?? [[]],
  }));
}

export async function getSpreadsheetMetadata(spreadsheetId?: string): Promise<{
  title: string;
  sheets: Array<{ name: string; rowCount: number; colCount: number }>;
}> {
  const response = await readWithRetry('чтение состава книги', async () => {
    const api = await getSheetsApi();
    return api.spreadsheets.get(
      {
        spreadsheetId: spreadsheetId ?? config.google.spreadsheetId,
        fields: 'properties.title,sheets.properties',
      },
      { timeout: SHEETS_TIMEOUT_MS },
    );
  });

  return {
    title: response.data.properties?.title ?? 'Unknown',
    sheets: (response.data.sheets ?? []).map((s) => ({
      name: s.properties?.title ?? 'Unknown',
      rowCount: s.properties?.gridProperties?.rowCount ?? 0,
      colCount: s.properties?.gridProperties?.columnCount ?? 0,
    })),
  };
}

export async function getSheetDataFromSpreadsheet(
  spreadsheetId: string,
  sheetName: string,
): Promise<unknown[][]> {
  const response = await readWithRetry(
    `чтение листа «${sheetName}»`,
    async () => {
      const api = await getSheetsApi();
      return api.spreadsheets.values.get(
        {
          spreadsheetId,
          range: sheetValuesRange(sheetName),
          valueRenderOption: 'UNFORMATTED_VALUE',
          dateTimeRenderOption: 'FORMATTED_STRING',
          majorDimension: 'ROWS',
        },
        { timeout: SHEETS_TIMEOUT_MS },
      );
    },
    (r) => (r.data.values as unknown[][] | undefined)?.length ?? 0,
  );

  return (response.data.values as unknown[][]) ?? [];
}

export async function getSheetDataWithFormulas(
  spreadsheetId: string,
  sheetName: string,
): Promise<{ values: unknown[][]; formulas: unknown[][] }> {
  const range = sheetValuesRange(sheetName);

  const [valResp, fmlResp] = await readWithRetry(
    `чтение листа «${sheetName}»`,
    async () => {
      const api = await getSheetsApi();
      return Promise.all([
        api.spreadsheets.values.get(
          {
            spreadsheetId,
            range,
            valueRenderOption: 'UNFORMATTED_VALUE',
            dateTimeRenderOption: 'FORMATTED_STRING',
            majorDimension: 'ROWS',
          },
          { timeout: SHEETS_TIMEOUT_MS },
        ),
        api.spreadsheets.values.get(
          {
            spreadsheetId,
            range,
            valueRenderOption: 'FORMULA',
            majorDimension: 'ROWS',
          },
          { timeout: SHEETS_TIMEOUT_MS },
        ),
      ]);
    },
  );

  return {
    values: (valResp.data.values as unknown[][]) ?? [],
    formulas: (fmlResp.data.values as unknown[][]) ?? [],
  };
}

/**
 * Формульные колонки книги ГРБС — те же четыре группы, что защищает и красит
 * канон etalon-sync (scripts/etalon-sync/canon.cjs: `goldenProtections` и
 * правило УФ «Формула сломана (K, O:P, R:T, Y:AC)»). Одиннадцать колонок из
 * тридцати четырёх; сгруппированы ровно как в каноне, чтобы расхождение
 * «продукт читает не то, что книга защищает» было видно глазом.
 *
 * Страж списка — google-sheets-formula-columns.test.ts: он сверяет группы с
 * канонными защитами, поэтому колонка, добавленная в книгу и забытая здесь,
 * падает тестом, а не читается молча мимо.
 */
export const FORMULA_COLUMN_GROUPS = [
  { from: 'K', to: 'K' },
  { from: 'O', to: 'P' },
  { from: 'R', to: 'T' },
  { from: 'Y', to: 'AC' },
] as const;

/** Те же группы поимённо — для сообщений и стражей. */
export const FORMULA_COLUMNS = ['K', 'O', 'P', 'R', 'S', 'T', 'Y', 'Z', 'AA', 'AB', 'AC'] as const;

/** Буква колонки → индекс от нуля (A=0, AA=26). */
export function letterToColumn(letter: string): number {
  let n = 0;
  for (const ch of letter.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/**
 * Формулы ОДНОГО листа книги ГРБС — только формульные колонки.
 *
 * ЦЕНА (замер 30.08.2026, `scripts` не нужны — считано по канонным формулам
 * построчного диалекта книг и живым размерам листов: УО 2700 строк, все восемь
 * книг 3959 строк):
 *
 *   · ЗАПРОСЫ. Одно обращение `values.batchGet` на книгу с четырьмя
 *     диапазонами (K:K, O:P, R:T, Y:AC) — не одиннадцать запросов и не по
 *     одному на колонку. Полный ночной обход восьми книг: 8 обращений сверх
 *     восьми за значениями, итого 16 против 8. По уведомлению вебхука — 2
 *     обращения на одну книгу против 1.
 *   · ОБЪЁМ (МиБ = 1 048 576 байт, считано по телу ответа JSON). УО: формульные
 *     колонки 2 111 154 байта (2,01 МиБ) против 3 383 114 (3,23 МиБ) на чтение
 *     всего листа в виде формул — 62,4 %. Экономия НЕ 11/34, и это главное
 *     число замера: одиннадцать формульных колонок и есть самые толстые
 *     ячейки листа, поэтому две трети объёма живут именно в них. Цикл по УО
 *     растёт с 1 482 854 байт (1,41 МиБ, одни значения) до 3,42 МиБ — в 2,4 раза;
 *     чтение всего листа дало бы 4,64 МиБ, то есть в 3,3 раза. Восемь книг
 *     (3 959 строк): значения 2 174 045 байт (2,07 МиБ), формульные колонки
 *     3 110 800 (2,97 МиБ), формульных ячеек 43 549 (у одной УО — 29 700).
 *   · МИЛЛИСЕКУНДЫ. Сборка сетки по ответу — 1,3 мс для УО и 1,6 мс для всех
 *     восьми книг (медиана 20 прогонов). Это ЦЕНА РАЗБОРА; задержка самой
 *     Google здесь не выдумывается — живой замер 22.08.2026 давал 2,9 с на
 *     самую тяжёлую книгу (УО) при чтении перечня комментариев, и порядок
 *     секунд надо ждать и здесь.
 *
 * Сетка выравнивается по индексам колонок ЛИСТА (0 = A), а не по порядку
 * прочитанных диапазонов: потребитель адресует формулу так же, как значение
 * (`formulas[r][DEPT_COLUMNS.TOTAL_PLAN]`), и не обязан знать, каким запросом
 * её достали. Непрочитанные колонки остаются пустыми (`undefined`) — это
 * «не читали», а не «формулы нет», и различать их обязан потребитель.
 */
export async function getSheetFormulaColumns(
  spreadsheetId: string,
  sheetName: string,
): Promise<{ formulas: unknown[][]; startRow: number; cells: number }> {
  const ranges = FORMULA_COLUMN_GROUPS.map((g) =>
    sheetValuesRange(sheetName, `${g.from}:${g.to}`),
  );

  const response = await readWithRetry(
    `чтение формульных колонок листа «${sheetName}»`,
    async () => {
      const api = await getSheetsApi();
      return api.spreadsheets.values.batchGet(
        {
          spreadsheetId,
          ranges,
          valueRenderOption: 'FORMULA',
          majorDimension: 'ROWS',
        },
        { timeout: SHEETS_TIMEOUT_MS },
      );
    },
    (r) => (r.data.valueRanges ?? []).reduce((sum, vr) => sum + (vr.values?.length ?? 0), 0),
  );

  const valueRanges = response.data.valueRanges ?? [];
  const formulas: unknown[][] = [];
  let cells = 0;

  for (let i = 0; i < FORMULA_COLUMN_GROUPS.length; i++) {
    // Начальная колонка берётся из ЗАПРОШЕННОЙ группы, а не из ответа: Google
    // возвращает `range` в собственном написании, и разбирать его обратно
    // значит завести второй разборщик А1 там, где ответ уже известен.
    const startColumn = letterToColumn(FORMULA_COLUMN_GROUPS[i].from);
    const rows = (valueRanges[i]?.values as unknown[][] | undefined) ?? [];
    for (let r = 0; r < rows.length; r++) {
      const line = formulas[r] ?? (formulas[r] = []);
      const cellsOfRow = rows[r] ?? [];
      for (let c = 0; c < cellsOfRow.length; c++) {
        const value = cellsOfRow[c];
        if (value === undefined || value === null || value === '') continue;
        line[startColumn + c] = value;
        cells++;
      }
    }
  }

  // Диапазоны открыты сверху (K:K, а не K4:K), поэтому первая прочитанная
  // строка — первая строка листа. Число названо явно: потребителю нельзя
  // догадываться, с какой строки считать адрес ячейки.
  return { formulas, startRow: 1, cells };
}

export interface DeptSheetResult {
  values: unknown[][];
  formulas: unknown[][];
  sheetName: string;
  /**
   * Первая строка ЛИСТА, которой соответствует индекс 0 в `values`/`formulas`.
   * Всегда 1 — обе стороны читаются открытыми сверху диапазонами; поле нужно,
   * чтобы адрес ячейки в замечании считался по договору, а не по привычке.
   * Не задано — читать как 1 (так собраны заготовки книг в стражах).
   */
  startRow?: number;
  /**
   * Читались ли формулы в этом чтении. Отсутствие поля и `false` значат
   * ОДНО И ТО ЖЕ — «не спрашивали», а НЕ «формул нет»: пустой `formulas` при
   * быстром обновлении не имеет права читаться потребителем как «дефектов
   * формул не найдено». Поле необязательно ровно поэтому: заготовка книги без
   * него честно означает «формулы не читались», и ни один страж не обязан
   * приписывать себе чтение, которого не делал.
   */
  formulasRead?: boolean;
}

/**
 * ЕДИНСТВЕННЫЙ путь чтения листа ГРБС из отдельной книги: перебор кандидатов
 * имени («ВСЕ» → «Все» → имя ГРБС) с честной классификацией ошибок (429/403/5xx
 * не маскируются под «лист не найден» — B-6). Используется И загрузчиком
 * (fetchDepartmentSpreadsheets), И валидацией источника (/api/sources/:name/validate)
 * — раньше валидация читала лист, буквально названный именем управления
 * ('УАГЗО'!A:ZZ), и падала там, где загрузка работала (два пути = класс болезни D1).
 */
/**
 * Резолв РЕАЛЬНОГО имени вкладки ГРБС-книги для ЗАПИСИ (writeCellValue):
 * дешёвый metadata-вызов (без выкачивания данных) + перебор тех же кандидатов,
 * что у readDeptSheet («ВСЕ»/«Все»/имя). Раньше write-пути писали в статичное
 * имя из реестра — если реальная вкладка называется иначе, запись летела в
 * несуществующий лист. Кэш на процесс: имя вкладки в книге меняется редко,
 * инвалидация — рестарт/refresh.
 */
const resolvedSheetNameCache = new Map<string, string>();

export async function resolveDeptSheetName(deptName: string, ssId: string): Promise<string> {
  const cacheKey = `${ssId}:${deptName}`;
  const cached = resolvedSheetNameCache.get(cacheKey);
  if (cached) return cached;

  const registryName = DEPARTMENT_REGISTRY.find(d => d.shortName === deptName)?.sheetName ?? deptName;
  const candidates = departmentSheetNameCandidates(registryName, deptName);

  try {
    const meta = await readWithRetry(`чтение состава книги «${deptName}»`, async () => {
      const api = await getSheetsApi();
      return api.spreadsheets.get(
        {
          spreadsheetId: ssId,
          fields: 'sheets.properties.title',
        },
        { timeout: SHEETS_TIMEOUT_MS },
      );
    });
    const existing = new Set(
      (meta.data.sheets ?? []).map(s => s.properties?.title).filter((t): t is string => !!t),
    );
    const resolved = candidates.find(c => existing.has(c)) ?? registryName;
    resolvedSheetNameCache.set(cacheKey, resolved);
    return resolved;
  } catch (err) {
    // Метаданные недоступны (rate-limit/сеть/мок в тестах) — деградация к
    // реестровому имени (поведение до фикса), НЕ валим запись. Не кэшируем,
    // чтобы следующий вызов снова попробовал резолв.
    //
    // Но и молчать нельзя: если реальная вкладка называется иначе, правка
    // уйдёт в лист, которого нет, а причина останется неизвестной. Раньше
    // здесь стоял пустой перехват — ровно тот приём, из-за которого «слишком
    // часто» когда-то выдавалось за «листа нет».
    logSourceFailure(`определение имени вкладки книги «${deptName}»`, {
      ms: 0,
      reason: classifySourceFailure((err as Error)?.message ?? String(err)),
    });
    return registryName;
  }
}

/**
 * Формулы книги ГРБС читаются НЕ ВСЕГДА — и это решение, а не забывчивость.
 *
 * ЗАМЕР 21.08.2026 (почему флаг вообще появился). `getSheetDataWithFormulas`
 * делает ДВА обращения к Google на один лист — одно за значениями, одно за
 * формулами, и оба читают лист ЦЕЛИКОМ. Восемь книг управлений стоили
 * шестнадцати запросов за цикл, при этом поле `formulas` из
 * `fetchDepartmentSpreadsheets` не читал НИКТО: сквозной поиск по серверу и
 * ядру нашёл потребителей формул только у листа ШДЮ (снимок) и у сверки
 * (routes/reconciliation.ts) — и оба берут их своими вызовами. Половина
 * запросов к квоте Google уходила в мусорное ведро. Формулы тогда выключили,
 * оставив флаг: «понадобятся — включаются одним флагом, и это будет осознанная
 * плата, а не тихая привычка».
 *
 * ПОНАДОБИЛИСЬ 30.08.2026 (решение владельца §22 п.7). Перебитая формула в
 * книге — живой класс дефектов: на 30.08 в двух книгах шесть ячеек, где вместо
 * формулы стоит вбитое число или мутант (УИО K34, AA23; УО K1175, T2645, Y1662,
 * Y1894). Продукт их не видел вовсе. Флаг включается по вебхуку и в ночном
 * полном обходе; быстрые плановые обновления формулы НЕ читают.
 *
 * ЧТО ИМЕННО ИЗМЕНИЛОСЬ В ЦЕНЕ. Читается не весь лист в виде формул, а только
 * одиннадцать формульных колонок (`getSheetFormulaColumns`, там же снятые
 * числа): по уведомлению — 2 обращения на книгу вместо 1, в ночном обходе —
 * 16 на восемь книг вместо 8; объём цикла по УО растёт с 1,41 МиБ до 3,42 МиБ
 * вместо 4,64 МиБ при чтении всего листа.
 */
export interface DeptReadOptions {
  /**
   * Читать ли формульные колонки листа (второе обращение к Google).
   * По умолчанию нет — плановый цикл опроса за формулы не платит.
   */
  withFormulas?: boolean;
}

export async function readDeptSheet(
  deptName: string,
  ssId: string,
  options: DeptReadOptions = {},
): Promise<DeptSheetResult> {
  const DEPT_SHEET_NAME: Record<string, string> = Object.fromEntries(
    DEPARTMENT_REGISTRY.map(d => [d.shortName, d.sheetName]),
  );
  const sheetName = DEPT_SHEET_NAME[deptName] ?? deptName;
  const candidates = departmentSheetNameCandidates(sheetName, deptName);
  let lastError: unknown;
  for (const candidate of candidates) {
    try {
      // Значения читаются ВСЕГДА и первыми: пустой лист означает «имя-кандидат
      // не то», и платить за формулы несуществующего листа незачем.
      const values = await getSheetDataFromSpreadsheet(ssId, candidate);
      if (values.length === 0) continue;
      if (!options.withFormulas) {
        return { values, formulas: [], sheetName: candidate, startRow: 1, formulasRead: false };
      }
      const { formulas } = await getSheetFormulaColumns(ssId, candidate);
      return { values, formulas, sheetName: candidate, startRow: 1, formulasRead: true };
    } catch (err) {
      lastError = err;
      if (isNonRecoverableSheetError(err)) {
        // 429 (rate-limit), 403 (permission) and 5xx look identical to a
        // missing sheet if swallowed here — surface them immediately
        // instead of masking them as "no candidate matched".
        throw err;
      }
      // Otherwise this candidate name genuinely doesn't exist — try the next one.
    }
  }
  const cause = lastError instanceof Error ? `: ${lastError.message}` : '';
  throw new Error(
    `No readable sheet found in spreadsheet for ${deptName}; tried: ${candidates.join(', ')}${cause}`,
  );
}

/**
 * Прочитать книги ГРБС. `only` сужает список до названных книг — уведомление
 * Drive точно называет файл, и правка в книге УО не имеет права стоить чтения
 * остальных семи (см. services/refresh-targets.ts). Пустой или неназванный
 * `only` означает «все книги», как было раньше.
 */
export interface FetchDeptOptions extends DeptReadOptions {
  only?: readonly string[];
}

export async function fetchDepartmentSpreadsheets(
  deptSpreadsheets: Record<string, string>,
  options: FetchDeptOptions = {},
): Promise<{ data: Record<string, DeptSheetResult>; errors: Record<string, string> }> {
  const data: Record<string, DeptSheetResult> = {};
  const errors: Record<string, string> = {};

  const wanted = options.only && options.only.length > 0 ? new Set(options.only) : null;
  const entries = Object.entries(deptSpreadsheets).filter(([name]) => !wanted || wanted.has(name));
  const results = await Promise.allSettled(
    entries.map(async ([deptName, ssId]) => {
      const result = await readDeptSheet(deptName, ssId, options);
      return { deptName, ...result };
    }),
  );

  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    if (result.status === 'fulfilled') {
      const { deptName, values, formulas, sheetName, startRow, formulasRead } = result.value;
      data[deptName] = { values, formulas, sheetName, startRow, formulasRead };
    } else {
      const deptName = entries[i][0];
      errors[deptName] = result.reason instanceof Error ? result.reason.message : String(result.reason);
    }
  }

  return { data, errors };
}

function isNonRecoverableSheetError(err: unknown): boolean {
  // Молчание источника — не «такого листа нет»: пробовать на нём остальные
  // имена-кандидаты значит умножить срок ожидания на их число (три имени по
  // двадцать секунд = минута на одно управление).
  if (err instanceof SheetsUnavailableError) return true;
  const status = (err as { status?: unknown; code?: unknown })?.status
    ?? (err as { status?: unknown; code?: unknown })?.code;
  return status === 429 || status === 403 || (typeof status === 'number' && status >= 500);
}

export async function fetchSHDYUSheet(
  spreadsheetId: string,
): Promise<{ values: unknown[][]; formulas: unknown[][]; sheetName: string }> {
  const result = await getSheetDataWithFormulas(spreadsheetId, SHDYU_MONTHLY_SHEET_NAME);
  return { ...result, sheetName: SHDYU_MONTHLY_SHEET_NAME };
}

let writeApi: sheets_v4.Sheets | null = null;

async function getWriteApi(): Promise<sheets_v4.Sheets> {
  if (writeApi) return writeApi;

  if (config.google.serviceAccountEmail && config.google.privateKey) {
    const auth = new google.auth.GoogleAuth({
      credentials: {
        client_email: config.google.serviceAccountEmail,
        private_key: config.google.privateKey,
      },
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    writeApi = google.sheets({ version: 'v4', auth });
  } else {
    throw new Error('Запись в Google Sheets требует авторизации через Service Account');
  }

  return writeApi;
}

/**
 * Запись в источник со сроком ожидания, повтором при временном отказе и записью
 * в журнал сервера.
 *
 * ПОЧЕМУ ПОВТОР ЗДЕСЬ БЕЗОПАСЕН, хотя запись — не чтение. Повтор опасен там,
 * где действие складывается с предыдущим (добавить строку, увеличить счётчик):
 * ответ мог потеряться уже ПОСЛЕ применения, и вторая попытка сделала бы то же
 * самое дважды. Здесь действие другое: «в ячейке L178 должно стоять вот это».
 * Сколько раз его ни повторить, в ячейке будет ровно то, что послано, — поэтому
 * ответ «слишком часто» лечится паузой, а не отказом сотруднику, который только
 * что нажал «сохранить». Что повторяется, а что отдаётся сразу («доступа нет»
 * паузой не лечится), решает тот же sheets-retry.ts, что и на чтении.
 *
 * До этого правка была единственным обращением к Google без повторов — и при
 * этом самым обидным для человека: чтение можно повторить обновлением страницы,
 * а правку он уже сделал, и она пропала.
 */
async function writeWithRetry<T>(
  what: string,
  run: () => Promise<T>,
  measure: (result: T) => number,
): Promise<T> {
  const startedAt = Date.now();
  try {
    const result = await withSheetsRetry(what, () => withSheetsDeadline(what, run), {
      onRetry: ({ attempt, delayMs, error }) => {
        logSourceRetry(what, {
          attempt,
          delayMs,
          reason: classifySourceFailure((error as Error)?.message ?? String(error)),
        });
      },
    });
    logSourceWrite(what, { cells: measure(result), ms: Date.now() - startedAt });
    return result;
  } catch (err) {
    logSourceFailure(what, {
      ms: Date.now() - startedAt,
      reason: classifySourceFailure((err as Error)?.message ?? String(err)),
    });
    throw err;
  }
}

export async function writeCellValue(
  spreadsheetId: string,
  sheetName: string,
  cell: string,
  value: unknown,
): Promise<{ updatedRange: string; updatedCells: number }> {
  const range = sheetValuesRange(sheetName, cell);
  const safeValue =
    typeof value === 'string' && /^[=+\-@]/.test(value) ? `'${value}` : value;
  const response = await writeWithRetry(
    `запись в ячейку ${cell}`,
    async () => {
      const api = await getWriteApi();
      return api.spreadsheets.values.update(
        {
          spreadsheetId,
          range,
          valueInputOption: 'USER_ENTERED',
          requestBody: { values: [[safeValue]] },
        },
        { timeout: SHEETS_TIMEOUT_MS },
      );
    },
    (r) => r.data.updatedCells ?? 0,
  );

  return {
    updatedRange: response.data.updatedRange ?? range,
    updatedCells: response.data.updatedCells ?? 0,
  };
}

function columnToLetter(col: number): string {
  let result = '';
  let n = col;
  while (n >= 0) {
    result = String.fromCharCode(65 + (n % 26)) + result;
    n = Math.floor(n / 26) - 1;
  }
  return result;
}
