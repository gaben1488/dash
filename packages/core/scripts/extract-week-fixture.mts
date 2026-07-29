/**
 * extract-week-fixture.mts — архивная неделя (книги ГРБС + ручной отчёт) → одна
 * компактная фикстура для регрессионного теста `src/report/week-regression.test.ts`.
 *
 * Зачем. Правила счёта (docs/superpowers/specs/2026-07-29-report-calculation-rules.md
 * §6.5) держатся на восьми парах «книги недели → ручной отчёт той же недели».
 * Пара — единственное доказательство, что расчёт воспроизводит человека, а не
 * совпал случайно. Фикстура замораживает пару в репозитории: книги лежат на
 * внешнем диске и в CI недоступны.
 *
 * Почему компактно. Полное чтение восьми книг — ~9 000 строк по 33 колонки;
 * в JSON это мегабайты нечитаемого шума. Оставляем только то, что участвует в
 * счёте: строки с непустым способом и плановым годом среза (канон §1-2), и
 * только 22 колонки из 33. Тексты (предмет, подвед) урезаны до длины, на
 * которой ещё работают предикаты движка (префиксы «итого/всего/справочно»),
 * графа программы сведена к трём различимым состояниям — «пусто / заглушка X /
 * есть название», ровно то, что различает hasProgramName.
 *
 * Запуск (xlsx живёт в devDependencies пакета server — резолвим оттуда):
 *   node --experimental-strip-types packages/core/scripts/extract-week-fixture.mts \
 *     "E:/на отправку в drive/Отчеты по закупкам/Отчет по закупкам 26.06.2026"
 *
 * Аудит фикстуры печатается ASCII-строкой (кириллица в консоль Windows не
 * идёт) и дублируется полем `audit` внутри JSON — тест на него опирается.
 */

import { createRequire } from 'node:module';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateRawSync } from 'node:zlib';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = join(HERE, '..', 'src', 'report', '__fixtures__');

// xlsx (SheetJS) — devDependency пакета server; свой в core заводить незачем,
// скрипт разовый и вне сборки. Резолвим от расположения скрипта, не от cwd.
const require = createRequire(join(HERE, '..', '..', 'server', 'package.json'));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const XLSX: any = require('xlsx');

/** Шапка книги ГРБС — три строки (канон DEPT_HEADER_ROWS в @aemr/shared). */
const HEADER_ROWS = 3;

/**
 * Колонки, которые едут в фикстуру (0-based, канон DEPT_COLUMNS). Всё, что
 * читает CalcEngine + standardRowFilter + экстракторы измерений; остальные 11
 * колонок книги в счёте не участвуют.
 *   A=0  № п/п              C=2  подвед              D=3  графа программы
 *   F=5  вид деятельности   G=6  предмет             H..K=7..10 план ФБ/КБ/МБ/итого
 *   L=11 способ             N=13 дата плана          O=14 квартал плана
 *   P=15 год плана          Q=16 дата факта          V..Y=21..24 факт ФБ/КБ/МБ/итого
 *   Z,AA,AB=25,26,27 экономия                        AD=29 признак экономии
 */
const KEEP_COLUMNS = [0, 2, 3, 5, 6, 7, 8, 9, 10, 11, 13, 14, 15, 16, 21, 22, 23, 24, 25, 26, 27, 29];

const COL_SUBORDINATE = 2;
const COL_PROGRAM = 3;
const COL_SUBJECT = 6;
const COL_METHOD = 11;
const COL_PLAN_YEAR = 15;

/** Длина, до которой урезаны тексты: префиксы строк-итогов («справочно») целы. */
const TEXT_LIMIT = 16;

// ── Книги ГРБС ───────────────────────────────────────────────────────

type Cell = string | number | null;

/** Заглушка «нет программы» — те же символы, что различает hasProgramName. */
function normalizeProgram(v: unknown): Cell {
  const s = String(v ?? '').trim();
  if (!s) return '';
  return /^[XxХх]$/u.test(s) ? 'X' : 'ПМ';
}

function trimText(v: unknown): Cell {
  const s = String(v ?? '').trim();
  return s.slice(0, TEXT_LIMIT);
}

/** Значение ячейки как есть — числа числами, строки строками, пусто → null. */
function keepCell(v: unknown): Cell {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return v;
  const s = String(v).trim();
  return s === '' ? null : s;
}

interface DeptExtract {
  rows: Cell[][];
  audit: {
    sheet: string;
    sheetRows: number;
    kept: number;
    noMethod: number;
    otherYear: number;
    blankYear: number;
  };
}

/**
 * Периметр книги — вкладка «ВСЕ», а без подведов — вкладка с именем управления
 * (канон правил счёта §1). Чтение всех вкладок подряд удваивает подведы.
 */
function pickSheet(names: string[], fileStem: string): string {
  if (names.includes('ВСЕ')) return 'ВСЕ';
  const own = names.find((n) => n === fileStem);
  if (own) return own;
  throw new Error(`no sheet for ${fileStem}: ${names.join(',')}`);
}

function extractDept(file: string, year: number): DeptExtract {
  const stem = basename(file, '.xlsx');
  const wb = XLSX.readFile(file, { cellDates: false });
  const sheet = pickSheet(wb.SheetNames as string[], stem);
  const raw: unknown[][] = XLSX.utils.sheet_to_json(wb.Sheets[sheet], {
    header: 1,
    raw: true,
    defval: null,
    blankrows: false,
  });
  const body = raw.slice(HEADER_ROWS);

  const rows: Cell[][] = [];
  let noMethod = 0;
  let otherYear = 0;
  let blankYear = 0;
  for (const r of body) {
    if (!r) continue;
    const hasMethod = String(r[COL_METHOD] ?? '').trim() !== '';
    const rowYear = Number(String(r[COL_PLAN_YEAR] ?? '').trim());
    // Пустой/нулевой год для CalcEngine НЕ отсекается (нестрогий год-фильтр:
    // `rowYear > 0 && rowYear !== targetYear`), поэтому такие строки едут в
    // фикстуру наравне со строками своего года — иначе счёт разошёлся бы.
    const blank = !Number.isFinite(rowYear) || rowYear === 0;
    const isYear = blank || rowYear === year;
    if (!hasMethod) {
      // Содержательная строка без способа для движка — КОНКУРЕНТНАЯ
      // (classifyMethodGroup: пустой способ падает в КП, наследие формул СВОД),
      // то есть выбросив её, фикстура потеряла бы план. Пустые хвосты листа
      // (без номера и предмета) не в счёт — их отбросит и standardRowFilter.
      const meaningful =
        String(r[0] ?? '').trim() !== '' || String(r[COL_SUBJECT] ?? '').trim() !== '';
      if (isYear && meaningful) noMethod++;
      continue;
    }
    if (!isYear) {
      otherYear++;
      continue;
    }
    if (blank) blankYear++;
    rows.push(
      KEEP_COLUMNS.map((c) => {
        if (c === COL_PROGRAM) return normalizeProgram(r[c]);
        if (c === COL_SUBJECT || c === COL_SUBORDINATE) return trimText(r[c]);
        return keepCell(r[c]);
      }),
    );
  }
  return {
    rows,
    audit: { sheet, sheetRows: body.length, kept: rows.length, noMethod, otherYear, blankYear },
  };
}

// ── Ручной отчёт (.docx) ─────────────────────────────────────────────

/**
 * Одна запись zip по имени. docx — обычный zip, а нужен из него ровно один файл
 * (word/document.xml), поэтому зависимость ради распаковки не заводим: идём по
 * центральному каталогу и разжимаем через встроенный zlib.
 */
function unzipEntry(buf: Buffer, name: string): Buffer {
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0) throw new Error('not a zip');
  let p = buf.readUInt32LE(eocd + 16); // смещение центрального каталога
  const count = buf.readUInt16LE(eocd + 10);
  for (let i = 0; i < count; i++) {
    const nameLen = buf.readUInt16LE(p + 28);
    const entry = buf.toString('utf8', p + 46, p + 46 + nameLen);
    if (entry === name) {
      const method = buf.readUInt16LE(p + 10);
      const compressed = buf.readUInt32LE(p + 20);
      const local = buf.readUInt32LE(p + 42);
      // Длины имени/extra в локальном заголовке свои — читаем их, а не из каталога.
      const dataStart = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
      const data = buf.subarray(dataStart, dataStart + compressed);
      return method === 0 ? Buffer.from(data) : inflateRawSync(data);
    }
    p += 46 + nameLen + buf.readUInt16LE(p + 30) + buf.readUInt16LE(p + 32);
  }
  throw new Error(`zip entry not found: ${name}`);
}

/** Текст документа: абзацы `<w:p>` → строки, разметка снята. */
function docxText(file: string): string {
  const xml = unzipEntry(readFileSync(file), 'word/document.xml').toString('utf8');
  return xml
    .replace(/<\/w:p>/g, '\n')
    .replace(/<w:tab\/>/g, '\t')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .join('\n');
}

/** «963 029,39» (в т.ч. неразрывные пробелы) → 963029.39. */
function num(s: string): number {
  return parseFloat(s.replace(/[\s\u00A0]/g, '').replace(',', '.'));
}

const MONEY = String.raw`([\d\s\u00A0]+,\d+)`;
const COUNT = String.raw`([\d\s\u00A0]+?)`;
/** «(ФБ – …, КБ – …, МБ – …)» — три бюджета одной скобкой, разделители плавают. */
const BUDGET = String.raw`\(\s*ФБ\s*[–\-]\s*${MONEY}[^)]*?КБ\s*[–\-]?\s*${MONEY}[^)]*?МБ\s*[–\-]?\s*${MONEY}`;

export interface ManualMoney {
  count: number;
  total: number;
  fb: number;
  kb: number;
  mb: number;
}

export interface ManualQuarterExec {
  dept: string;
  pct: number;
  planCount: number;
  doneCount: number;
  yearPlanCount: number;
}

export interface ManualNumbers {
  kp: {
    year: ManualMoney;
    quarters: Record<string, ManualMoney>;
    fact: ManualMoney;
    remainderCount: number;
    calcEconomyTotal: number;
  };
  ep: {
    year: ManualMoney;
    quarters: Record<string, ManualMoney>;
    fact: ManualMoney;
  };
  /** «фактическое исполнение плана N квартала по ГРБС» — КП по управлениям. */
  quarterExecByDept: Record<string, ManualQuarterExec[]>;
  /** Общее исполнение плана квартала (район), проценты как в отчёте. */
  districtExecPct: Record<string, number>;
}

function money(m: RegExpMatchArray, from: number): ManualMoney {
  return {
    count: num(m[from]),
    total: num(m[from + 1]),
    fb: num(m[from + 2]),
    kb: num(m[from + 3]),
    mb: num(m[from + 4]),
  };
}

function parseManual(text: string, year: number): ManualNumbers {
  // Районный блок КП — от «ПО КОНКУРЕНТНЫМ ПРОЦЕДУРАМ» (так озаглавлен только
  // район; у управлений «КОНКУРЕНТНЫЕ ПРОЦЕДУРЫ») до районного ЕП.
  const kpStart = text.indexOf('ПО КОНКУРЕНТНЫМ ПРОЦЕДУРАМ');
  const epStart = text.indexOf('ЕДИНСТВЕННЫЙ ПОСТАВЩИК', kpStart);
  const firstDept = text.indexOf('КОНКУРЕНТНЫЕ ПРОЦЕДУРЫ', epStart);
  if (kpStart < 0 || epStart < 0 || firstDept < 0) throw new Error('district blocks not found');
  const kpText = text.slice(kpStart, epStart);
  const epText = text.slice(epStart, firstDept);

  const yearRe = new RegExp(
    String.raw`Всего на год запланирован\S*\s+${COUNT}\s+процедур\S*\s+на сумму\s+${MONEY}\s*тыс\. руб\.\s*${BUDGET}`,
  );
  const kpYear = kpText.match(yearRe);
  const epYear = epText.match(yearRe);
  if (!kpYear || !epYear) throw new Error('year totals not found');

  // Квартальный план КП. Формулировка плавает по неделям («запланировано 125
  // конкурентных процедур», «запланирована 141 конкурентная процедура», слитное
  // «процедурана») — держимся за «конкурентн…» и «на общую сумму».
  const kpQRe = new RegExp(
    String.raw`Всего на (\d) квартал ${year} года запланирован\S*\s+${COUNT}\s+конкурентн[^\d]*?на общую сумму\s+${MONEY}\s*тыс\. руб\.\s*${BUDGET}`,
    'g',
  );
  const epQRe = new RegExp(
    String.raw`Всего на (\d) квартал ${year} года запланировано заключить\s+(?:договоров/контрактов\s+по\s+)?${COUNT}\s+(?:наименовани\S*|договоров/контрактов)\s+на общую сумму\s+${MONEY}\s*тыс\. руб\.\s*${BUDGET}`,
    'g',
  );
  const quarters = (src: string, re: RegExp): Record<string, ManualMoney> => {
    const out: Record<string, ManualMoney> = {};
    for (const m of src.matchAll(re)) out[`q${m[1]}`] = money(m, 2);
    return out;
  };

  const kpFact = kpText.match(
    new RegExp(
      String.raw`Фактически обязательства заключены по\s+${COUNT}\s+конкурентным процедурам на общую сумму\s+${MONEY}\s*тыс\. руб\.\s*${BUDGET}`,
    ),
  );
  const epFact = epText.match(
    new RegExp(
      String.raw`Заключено\s+${COUNT}\s+договоров/контрактов на сумму\s+${MONEY}\s*тыс\. руб\.\s*${BUDGET}`,
    ),
  );
  if (!kpFact || !epFact) throw new Error('fact totals not found');

  const remainder = kpText.match(
    /Остаток незаключенных договоров по конкурентным процедурам до конца года\s*[–\-]\s*(\d+)/,
  );
  const calcEco = kpText.match(
    new RegExp(String.raw`Расчетная экономия по оставшимся незаключенным\s+\d+\s+конкурентным процедурам составляет\s+${MONEY}`),
  );

  // Общее исполнение квартала: две формулировки — отдельной строкой и в скобке
  // после «Отклонение от плана N квартала».
  const districtExecPct: Record<string, number> = {};
  for (const m of kpText.matchAll(/бщее исполнение плана (\d) квартала\s*[–\-]\s*(\d+,\d+)%/g)) {
    districtExecPct[`q${m[1]}`] = num(m[2]);
  }

  // Списки «фактическое исполнение плана N квартала по ГРБС» — КП по управлениям.
  const quarterExecByDept: Record<string, ManualQuarterExec[]> = {};
  const blockRe = /фактическое исполнение плана (\d) квартала по ГРБС:\n((?:-[^\n]*\n?)+)/g;
  const lineRe =
    /^-\s*(\S+?)\s*[–\-]\s*(\d+,\d+)%\s*\(план на \d квартал\s*[–\-]\s*(\d+),?\s*исполнено\s+(\d+),?\s*план на год\s*[–\-]\s*(\d+)\)/;
  for (const block of text.matchAll(blockRe)) {
    const list: ManualQuarterExec[] = [];
    for (const line of block[2].split('\n')) {
      const m = line.match(lineRe);
      if (!m) continue;
      list.push({
        dept: m[1],
        pct: num(m[2]),
        planCount: Number(m[3]),
        doneCount: Number(m[4]),
        yearPlanCount: Number(m[5]),
      });
    }
    quarterExecByDept[`q${block[1]}`] = list;
  }

  return {
    kp: {
      year: money(kpYear, 1),
      quarters: quarters(kpText, kpQRe),
      fact: money(kpFact, 1),
      remainderCount: remainder ? Number(remainder[1]) : 0,
      calcEconomyTotal: calcEco ? num(calcEco[1]) : 0,
    },
    ep: {
      year: money(epYear, 1),
      quarters: quarters(epText, epQRe),
      fact: money(epFact, 1),
    },
    quarterExecByDept,
    districtExecPct,
  };
}

// ── Сборка ───────────────────────────────────────────────────────────

const MS_PER_DAY = 86400000;

function main(): void {
  const dir = process.argv[2];
  if (!dir) throw new Error('usage: extract-week-fixture.mts <week folder> [out.json]');

  const dateMatch = basename(dir).match(/(\d{2})\.(\d{2})\.(\d{4})/);
  if (!dateMatch) throw new Error(`no date in folder name: ${basename(dir)}`);
  const [, dd, mm, yyyy] = dateMatch;
  const year = Number(yyyy);
  const quarter = Math.ceil(Number(mm) / 3);
  const asOfDay = Date.UTC(year, Number(mm) - 1, Number(dd)) / MS_PER_DAY;

  const files = readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.xlsx'));
  const rowsByDept: Record<string, Cell[][]> = {};
  const audit: Record<string, DeptExtract['audit']> = {};
  for (const f of files) {
    const dept = basename(f, '.xlsx');
    const { rows, audit: a } = extractDept(join(dir, f), year);
    rowsByDept[dept] = rows;
    audit[dept] = a;
  }

  const docx = readdirSync(dir).find((f) => f.toLowerCase().endsWith('.docx'));
  if (!docx) throw new Error('manual .docx report not found');
  const manual = parseManual(docxText(join(dir, docx)), year);

  const fixture = {
    date: `${dd}.${mm}.${yyyy}`,
    year,
    quarter,
    asOfDay,
    columns: KEEP_COLUMNS,
    audit,
    manual,
    rowsByDept,
  };

  const out = process.argv[3] ?? join(FIXTURE_DIR, `week-${dd}.${mm}.${yyyy}.json`);
  writeFileSync(out, JSON.stringify(fixture), 'utf8');

  // ASCII-сводка: кириллица в консоль Windows не идёт (правило кодировок).
  const totals = Object.values(audit).reduce(
    (s, a) => ({
      kept: s.kept + a.kept,
      noMethod: s.noMethod + a.noMethod,
      otherYear: s.otherYear + a.otherYear,
      blankYear: s.blankYear + a.blankYear,
    }),
    { kept: 0, noMethod: 0, otherYear: 0, blankYear: 0 },
  );
  console.log(
    `${dd}.${mm}.${yyyy} q${quarter} asOfDay=${asOfDay} kept=${totals.kept} ` +
      `(blank-year=${totals.blankYear}) dropped(no-method)=${totals.noMethod} ` +
      `dropped(other-year)=${totals.otherYear} -> ${out}`,
  );
}

main();
