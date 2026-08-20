/**
 * /api/text-hygiene — полный перечень находок гигиены текста и орфографии
 * (канон п.122, приказ владельца 20.08.2026: «сделай более удобно и нормально,
 * а то там текст сплошняком — это полный треш и слоп»).
 *
 * РАЗДЕЛЕНИЕ РОЛЕЙ С ПРАВИЛОМ text_hygiene (rule-book). Правило оставляет на
 * листе ОДНУ карточку-сводку: сколько ячеек, какие рода дефектов, куда идти.
 * Этот роут и есть «куда идти»: он отдаёт каждый дефект отдельной записью —
 * адрес (лист · ячейка), род, контекст вокруг дефектного места и ГОТОВОЕ
 * значение ячейки, которое оператор копирует и вставляет целиком (п.98д).
 * Детекторы — те же самые функции @aemr/shared, что зовёт правило: два
 * потребителя одного механизма, а не два механизма.
 *
 * ЧТО ПРОВЕРЯЕТСЯ. Счётные строки всех книг (предикат isDataRow — тот же, что
 * у /api/workload): колонка C (имя подведа) сличается со справочником и
 * механикой набора, колонка G (предмет) — только механикой. Орфография
 * (частотный корпус text-language) идёт по G (наименование) и M (обоснование
 * выбора ЕП — свободный текст); C намеренно не проверяется словарём: имя
 * подведа правится по справочнику, а не по частоте слов.
 *
 * ЧЕСТНОСТЬ ПУСТОТЫ. «Дефектов нет» и «книги не прочитаны» — разные новости:
 * ответ несёт cellsChecked и booksSilent, чтобы экран мог сказать «проверено
 * N ячеек, дефектов не найдено», а не показать пустоту неизвестной природы.
 *
 * ЦЕНА ЗАПРОСА. Сеть не трогается вовсе: строки берутся из живого кэша книг
 * либо из сохранённого снимка. Дорог только счёт (детекторы и Левенштейн по
 * тысячам ячеек), поэтому ответ кэшируется на пять минут, момент чтения
 * назван (asOf, канон п.58), а маршрут прикрыт порогом частоты.
 */
import type { FastifyInstance } from 'fastify';
import {
  DEPT_COLUMNS,
  collectRowsByDept,
  collectWords,
  detectCellHygiene,
  detectSubordinateNameHygiene,
  findDept,
  languageFix,
  suggestFromCorpus,
  type LanguageConfidence,
  type TextHygieneKind,
} from '@aemr/shared';
import { DEPARTMENT_SPREADSHEETS } from '../config.js';
import { getDeptSheetValues, getSnapshot } from '../services/snapshot.js';
import { buildRowDto, isDataRow } from '../services/rows-dto.js';

/** Колонки, которые проверяет гигиена набора: C — подвед, G — предмет. */
type HygieneColumn = 'C' | 'G';
/** Колонки орфографии: G — наименование, M — свободный текст обоснования. */
type LanguageColumn = 'G' | 'M';

/** Одна находка гигиены: адрес → род → контекст → готовое значение. */
export interface TextHygieneItemDto {
  /** Адрес ячейки на листе: «C2309». */
  cell: string;
  /** Номер строки листа (позиция на момент чтения — лист живёт, п.98б). */
  row: number;
  /** «№ п/п» из колонки A — стабильный второй адрес строки; null — не проставлен. */
  rowSeq: string | null;
  col: HygieneColumn;
  kind: TextHygieneKind;
  /** Имя дефекта для конкретного случая («пробел перед „,“»). */
  label: string;
  /** Дефектное место с окружением ±20 символов; невидимые символы показаны явно. */
  context: string;
  /** ГОТОВОЕ значение всей ячейки: копируется и вставляется целиком (п.98д). */
  fix: string;
}

/** Находки одной книги, сгруппированные для экрана Контроля. */
export interface TextHygieneDeptDto {
  /** Кириллический канон-идентификатор книги («УО»). */
  dept: string;
  deptLatin: string;
  deptName: string;
  /** Имя листа — половина адреса «лист · ячейка». */
  sheet: string;
  items: TextHygieneItemDto[];
  countsByKind: Partial<Record<TextHygieneKind, number>>;
}

/** Находка орфографии: слово → контекст → предложение словаря корпуса. */
export interface TextLanguageItemDto {
  dept: string;
  deptLatin: string;
  sheet: string;
  cell: string;
  row: number;
  rowSeq: string | null;
  col: LanguageColumn;
  kind: 'spelling';
  /** Слово, как оно записано в ячейке. */
  word: string;
  /** Слово с окружением ±20 символов. */
  context: string;
  /** Предлагаемое написание (с сохранением заглавной буквы); null — подсказки нет. */
  suggestion: string | null;
  confidence: LanguageConfidence;
  /** ГОТОВОЕ значение всей ячейки с закрытой опечаткой. */
  fix: string;
}

export interface TextHygieneResponse {
  /** Момент чтения (ISO) — у каждого числа есть момент, канон п.58. */
  asOf: string;
  /** Откуда взяты строки книг: живой кэш, сохранённый снимок или ниоткуда. */
  rowsSource: 'live' | 'snapshot' | 'none';
  /** Книги, чьи строки прочитаны и проверены. */
  booksChecked: string[];
  /** Книги без строк — по ним проверки НЕ БЫЛО (это не «дефектов нет»). */
  booksSilent: string[];
  /** Только книги с находками, по убыванию их числа. */
  byDept: TextHygieneDeptDto[];
  language: TextLanguageItemDto[];
  totals: {
    rowsChecked: number;
    /** Текстовых ячеек, прошедших через детекторы, — знаменатель честной пустоты. */
    cellsChecked: number;
    hygieneFindings: number;
    languageFindings: number;
    countsByKind: Partial<Record<TextHygieneKind, number>>;
  };
  /** Оговорки словами: откуда строки, чего не хватает. */
  notes: string[];
}

/**
 * Строки всех книг по идентификатору управления. Порядок источников тот же,
 * что у /api/workload и /api/provenance: живой кэш книг, затем сохранённый
 * снимок, затем честная пустота. Шапка листов уже срезана (collectRowsByDept
 * и rowsByDept снимка держат только строки-атомы).
 */
async function readRowsByDeptId(): Promise<{
  rows: Record<string, unknown[][]>;
  source: 'live' | 'snapshot' | 'none';
}> {
  const byDeptId = (source: Record<string, unknown[][]>): Record<string, unknown[][]> => {
    const out: Record<string, unknown[][]> = {};
    for (const [name, values] of Object.entries(source)) {
      const dept = findDept(name);
      if (dept) out[dept.id] = values;
    }
    return out;
  };

  const live = byDeptId(collectRowsByDept(getDeptSheetValues()));
  if (Object.keys(live).length > 0) return { rows: live, source: 'live' };

  try {
    const snapshot = await getSnapshot();
    if (snapshot.rowsByDept && Object.keys(snapshot.rowsByDept).length > 0) {
      const saved = byDeptId(snapshot.rowsByDept);
      if (Object.keys(saved).length > 0) return { rows: saved, source: 'snapshot' };
    }
  } catch {
    // источники молчат — ответ скажет об этом словами, а не пустым экраном
  }
  return { rows: {}, source: 'none' };
}

/** Радиус контекста вокруг слова-опечатки — тот же, что у вырезок гигиены. */
const CONTEXT_RADIUS = 20;

function contextAround(text: string, index: number, length: number): string {
  const from = Math.max(0, index - CONTEXT_RADIUS);
  const to = Math.min(text.length, index + length + CONTEXT_RADIUS);
  return `${from > 0 ? '…' : ''}${text.slice(from, to)}${to < text.length ? '…' : ''}`;
}

/** Заглавная первая буква исходного слова сохраняется в предложении словаря. */
function matchCase(original: string, replacement: string): string {
  const first = original[0] ?? '';
  if (first !== '' && first === first.toUpperCase() && first !== first.toLowerCase()) {
    return replacement.charAt(0).toUpperCase() + replacement.slice(1);
  }
  return replacement;
}

/** Ячейка пригодна для проверки: строка с текстом (маркеры «X/х» тоже текст). */
function isCheckableCell(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

export async function buildTextHygieneResponse(
  now: number = Date.now(),
): Promise<TextHygieneResponse> {
  const { rows: rowsByDeptId, source: rowsSource } = await readRowsByDeptId();

  const booksChecked: string[] = [];
  const booksSilent: string[] = [];
  const byDept: TextHygieneDeptDto[] = [];
  const language: TextLanguageItemDto[] = [];
  const totalsByKind = new Map<TextHygieneKind, number>();
  let rowsChecked = 0;
  let cellsChecked = 0;
  let hygieneFindings = 0;

  for (const deptId of Object.keys(DEPARTMENT_SPREADSHEETS)) {
    const dept = findDept(deptId);
    if (!dept) continue;
    const values = rowsByDeptId[dept.id];
    if (!values || values.length === 0) {
      booksSilent.push(deptId);
      continue;
    }
    booksChecked.push(deptId);

    const deptItems: TextHygieneItemDto[] = [];
    const deptCounts = new Map<TextHygieneKind, number>();

    values.forEach((row, idx) => {
      if (!Array.isArray(row)) return;
      const dto = buildRowDto(row, idx, { deptId: dept.id });
      if (!isDataRow(dto)) return; // шапки, итоги и разделы чистке не подлежат
      rowsChecked += 1;

      const rowSeq = String(dto.id ?? '').trim() || null;
      const sheetRow = dto.rowIndex;

      // ── Гигиена набора: C — справочник + механика, G — механика. ──
      const hygieneCells: Array<{ col: HygieneColumn; raw: unknown }> = [
        { col: 'C', raw: row[DEPT_COLUMNS.SUBORDINATE] },
        { col: 'G', raw: row[DEPT_COLUMNS.SUBJECT] },
      ];
      for (const { col, raw } of hygieneCells) {
        if (!isCheckableCell(raw)) continue;
        cellsChecked += 1;
        const findings = col === 'C' ? detectSubordinateNameHygiene(raw) : detectCellHygiene(raw);
        for (const finding of findings) {
          deptItems.push({
            cell: `${col}${sheetRow}`,
            row: sheetRow,
            rowSeq,
            col,
            kind: finding.kind,
            label: finding.label,
            context: finding.excerpt,
            fix: finding.fix,
          });
          deptCounts.set(finding.kind, (deptCounts.get(finding.kind) ?? 0) + 1);
          totalsByKind.set(finding.kind, (totalsByKind.get(finding.kind) ?? 0) + 1);
          hygieneFindings += 1;
        }
      }

      // ── Орфография: G — наименование, M — свободный текст. ──
      const languageCells: Array<{ col: LanguageColumn; raw: unknown; role: 'наименование' | 'свободный текст' }> = [
        { col: 'G', raw: row[DEPT_COLUMNS.SUBJECT], role: 'наименование' },
        { col: 'M', raw: row[DEPT_COLUMNS.EP_REASON], role: 'свободный текст' },
      ];
      for (const { col, raw, role } of languageCells) {
        if (!isCheckableCell(raw)) continue;
        if (col === 'M') cellsChecked += 1; // G уже посчитана гигиеной выше
        const seen = new Set<string>();
        for (const hit of collectWords(raw)) {
          const suggestion = suggestFromCorpus(hit.word);
          if (!suggestion) continue;
          const key = hit.word.toLowerCase();
          if (seen.has(key)) continue;
          seen.add(key);
          language.push({
            dept: deptId,
            deptLatin: dept.latinId,
            sheet: dept.sheetName,
            cell: `${col}${sheetRow}`,
            row: sheetRow,
            rowSeq,
            col,
            kind: 'spelling',
            word: hit.word,
            context: contextAround(raw, hit.index, hit.word.length),
            suggestion: matchCase(hit.word, suggestion.word),
            confidence: suggestion.confidence,
            fix: languageFix(raw, suggestion.confidence, role),
          });
        }
      }
    });

    if (deptItems.length > 0) {
      byDept.push({
        dept: deptId,
        deptLatin: dept.latinId,
        deptName: dept.fullName,
        sheet: dept.sheetName,
        items: deptItems,
        countsByKind: Object.fromEntries(deptCounts) as Partial<Record<TextHygieneKind, number>>,
      });
    }
  }

  // Книги с наибольшим числом находок — первыми: это порядок объёма работы
  // оператора, а не рейтинг вины (тон п.53: механизм + адрес + действие).
  byDept.sort((a, b) => b.items.length - a.items.length);
  language.sort((a, b) => (a.dept === b.dept ? a.row - b.row : a.dept.localeCompare(b.dept, 'ru')));

  const notes: string[] = [];
  if (rowsSource === 'snapshot') {
    notes.push('Строки книг взяты из сохранённого снимка: живой кэш книг сейчас пуст.');
  }
  if (rowsSource === 'none') {
    notes.push(
      'Строки книг не прочитаны ни из живого кэша, ни из снимка — проверять было нечего. ' +
      'Это отсутствие данных, а не отсутствие дефектов. Действие: обновить данные и открыть раздел снова.',
    );
  }
  if (booksSilent.length > 0 && rowsSource !== 'none') {
    notes.push(
      `Не прочитаны строки книг: ${booksSilent.join(', ')}. По ним проверки не было — ` +
      'это не «дефектов нет».',
    );
  }
  notes.push(
    'Орфография проверяется частотным словарём, собранным из самих книг: показываются только ' +
    'слова с единственным близким соседом в словаре. Решение о правке — за человеком.',
  );

  return {
    asOf: new Date(now).toISOString(),
    rowsSource,
    booksChecked,
    booksSilent,
    byDept,
    language,
    totals: {
      rowsChecked,
      cellsChecked,
      hygieneFindings,
      languageFindings: language.length,
      countsByKind: Object.fromEntries(totalsByKind) as Partial<Record<TextHygieneKind, number>>,
    },
    notes,
  };
}

/**
 * Кэш ответа: пять минут. Сеть роут не трогает, но детекторы и Левенштейн по
 * тысячам ячеек не бесплатны, а вкладка живёт переключением фильтров.
 */
const CACHE_TTL_MS = 5 * 60 * 1000;
let cached: { at: number; response: TextHygieneResponse } | null = null;

/** Сбрасывает окно кэша — нужен тестам и ручной перечитке. */
export function resetTextHygieneCache(): void {
  cached = null;
}

export async function textHygieneRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /api/text-hygiene — перечень находок гигиены текста и орфографии.
   *
   * Отвечает 200 и на пустых источниках: «проверять нечего» — тоже ответ,
   * и он обязан назвать, каких книг не хватает, а не прятаться за 503.
   */
  app.get('/api/text-hygiene', async (request, reply) => {
    const fresh = (request.query as { refresh?: string } | undefined)?.refresh === 'true';
    const now = Date.now();
    if (!fresh && cached && now - cached.at < CACHE_TTL_MS) {
      return reply.send(cached.response);
    }
    const response = await buildTextHygieneResponse(now);
    cached = { at: now, response };
    return reply.send(response);
  });
}
