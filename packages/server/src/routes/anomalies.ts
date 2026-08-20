/**
 * /api/anomalies — адресные признаки странностей в строках книг ГРБС.
 *
 * ЗАЧЕМ. Инвентаризация сигналов 20.08.2026 (docs/superpowers/audits/
 * 2026-08-20-signal-inventory.md, §4 «Сироты») показала перекос: самые
 * проработанные механизмы продукта лежали без единого потребителя, а на экран
 * «Аналитики» выходили безадресные счётчики. Двенадцать признаков детектора
 * подозрительных закупок (core/analytics/anomaly-detection.ts) несут книгу,
 * лист, строку, № п/п, ячейку и сумму под риском — и ни один роут их не звал.
 * Пятнадцать видов аномалий датасета (core/pipeline/anomalies.ts) считались в
 * снимок, но веб брал из него только композит и счётчики. Этот роут — их
 * дверь наружу, и она открывается ровно на адрес: какая строка, что в ней,
 * почему (канон п.119).
 *
 * ЧТО ЗДЕСЬ НЕ СЧИТАЕТСЯ ЗАНОВО. Аномалии датасета берутся из снимка, а не
 * пересчитываются: их считает конвейер (orchestrator, шаг 4b), и вторая
 * реализация того же механизма развела бы два числа под одним именем — ровно
 * та болезнь, которую инвентаризация записала в §3.2. Роут только доводит
 * находки снимка до адреса, доставая № п/п, предмет и учреждение из живых
 * строк книги по номеру строки листа.
 *
 * ТОН. Признак — повод открыть строку, а не вывод о нарушении; отсутствие
 * признаков не означает, что данные верны. Обе оговорки едут в ответе
 * (`notes`) из самого ядра, чтобы экран не сочинял их заново.
 *
 * ЧЕСТНОСТЬ ПРЕЖДЕ ПОЛНОТЫ. Книга, которую не прочитали, называется по имени
 * и не превращается в «признаков нет». Журнал правок читается отдельно от
 * строк: без него два признака из двенадцати не выводятся вовсе, и об этом
 * сказано словами, а не пустым списком.
 *
 * ЦЕНА ЗАПРОСА. Открываются журналы всех восьми книг (≈40 тыс. записей) —
 * столько же, сколько стоит /api/workload, поэтому и кэш тот же: пять минут.
 * Момент чтения (asOf) назван всегда — канон п.58.
 */
import type { FastifyInstance } from 'fastify';
import {
  DEPT_COLUMNS,
  DEPT_HEADER_ROWS,
  findDept,
  isMetaRow,
  isReadableDeptRow,
  subordinateKey,
  ORG_ITSELF_SENTINEL,
  type DepartmentEntry,
} from '@aemr/shared';
import {
  detectRowAnomalies,
  // Разбор значения ячейки в число с ЧЕСТНЫМ null («числа нет» ≠ «ноль») живёт
  // в одном доме — том самом модуле, чьи строки мы и собираем. Своя копия
  // правила «убрать пробелы-разряды, запятую в точку» разъехалась бы с ним на
  // первом же живом формате (страж — shared/canon-homes.test.ts).
  journalNumber as cellNumber,
  type AnomalyFinding,
  type AnomalyJournalEntry,
  type AnomalyRow,
  type AnomalySign,
  type BehavioralAnomaly,
  type DataAnomaly,
  type DatasetAnalysis,
  type NoiseGroup,
  type SystemicAnomaly,
} from '@aemr/core';
import { DEPARTMENT_SPREADSHEETS } from '../config.js';
import { getDeptSheetValues, getSnapshot } from '../services/snapshot.js';
import { readAllBookJournals, type BookJournal } from '../services/provenance-journal.js';
import { toJournalEntries } from './workload.js';

/**
 * Номер строки книги = индекс в массиве листа + 1.
 *
 * Кэш листов несёт шапку (три строки) вместе с данными, поэтому индекс и
 * номер строки в Google Таблицах различаются ровно на единицу — ни на три.
 * Та же арифметика в web/lib/analytics/anomaly-addresses.ts; ошибка в единице
 * здесь означает чужую строку на экране читателя.
 */
const SHEET_ROW_FROM_INDEX = 1;

/** Сколько адресов группового признака показывать поимённо. */
const SHOWN_MEMBERS = 12;

// ────────────────────────────────────────────────────────────
// Подписи: внутренние коды наружу не выходят (PRODUCT.md)
// ────────────────────────────────────────────────────────────

/**
 * Степень аномалии словом. Внутренние «КРИТИЧЕСКАЯ»/«ВЫСОКАЯ» — артефакты
 * порта скрипта, на экране им не место: читателю нужен порядок разбора, а не
 * капслок. Тон без упрёка (канон п.104).
 */
const URGENCY: Record<string, string> = {
  'КРИТИЧЕСКАЯ': 'смотреть первым',
  'ВЫСОКАЯ': 'требует внимания',
  'СРЕДНЯЯ': 'стоит присмотреться',
  'ИНФОРМАЦИЯ': 'к сведению',
};

/** Порядок разбора: чем ниже число, тем выше строка в списке. */
const URGENCY_RANK: Record<string, number> = {
  'КРИТИЧЕСКАЯ': 0, 'ВЫСОКАЯ': 1, 'СРЕДНЯЯ': 2, 'ИНФОРМАЦИЯ': 3,
};

/**
 * Подписи пяти построчных видов. `satisfies` держит таблицу полной: новый вид
 * без подписи не пройдёт сборку — то же обещание, что даёт ядро у себя.
 */
const DATA_ANOMALY_LABEL = {
  EXEC_OVER_200: 'Факт больше плана более чем вдвое',
  FACT_NO_PLAN: 'Факт без планового бюджета',
  NEGATIVE_PLAN: 'Отрицательный план',
  EXACT_MATCH: 'Факт точно равен плану',
  ZERO_ECONOMY_WITH_FACT: 'Нулевая экономия при факте меньше плана',
} satisfies Record<DataAnomaly['type'], string>;

/** Подписи четырёх видов «поведение»: их видно только сравнением со снимком. */
const BEHAVIORAL_ANOMALY_LABEL = {
  SUDDEN_INCREASE: 'Резкий рост суммы против прошлого снимка',
  SUDDEN_DECREASE: 'Резкое падение суммы против прошлого снимка',
  STATUS_REGRESSION: 'Строка вернулась в более раннее состояние',
  PLAN_REWRITE: 'План переписан после появления факта',
} satisfies Record<BehavioralAnomaly['type'], string>;

/** Подписи шести видов «система»: признак не строки, а всей книги. */
const SYSTEMIC_ANOMALY_LABEL = {
  HIGH_EXACT_MATCH_RATE: 'Слишком часто факт в точности равен плану',
  CLUSTERED_OVERDUE: 'Просрочки собраны в одном месте книги',
  DEPT_EP_CONCENTRATION: 'Закупки без торгов сосредоточены в управлении',
  BENFORD_VIOLATION: 'Распределение первых цифр сумм неестественно',
  SUBORDINATE_CONCENTRATION: 'Закупки сосредоточены на одном учреждении',
  VAGUE_HIGH_VALUE: 'Крупная закупка с расплывчатым предметом',
  // Вид больше не детектируется (канон п.27, 14.08.2026: «отменена» выводилась
  // из свободного текста). Подпись хранится ради чтения старых снимков.
  CANCELED_WITH_FACT: 'Отменённая закупка с фактом (проверка отключена)',
} satisfies Record<SystemicAnomaly['type'], string>;

// ────────────────────────────────────────────────────────────
// Формы ответа
// ────────────────────────────────────────────────────────────

/** Один признак детектора с адресом и деньгами под риском. */
export interface AnomalySignDto {
  /** Кириллический канон-идентификатор книги («УО») — ось изоляции п.127. */
  dept: string;
  deptName: string;
  scale: 'typo' | 'fitted';
  sign: AnomalySign;
  title: string;
  /** Механизм: что наблюдается и что это может означать. */
  explanation: string;
  amountAtRisk: number;
  sheet: string;
  /** 0 — признак не про одну строку, а про группу. */
  sheetRow: number;
  /** № п/п (колонка A); пусто — у признака нет одной строки либо номер не заполнен. */
  rowSeq: string;
  cell: string;
  subordinate: string;
  subject: string;
  rows: number;
  smallSample: boolean;
  note?: string;
  /** Адреса остальных строк группы: «строка 155 (№ 39)». */
  members: string[];
}

/** Одна аномалия датасета, доведённая до адреса строки книги. */
export interface DatasetFindingDto {
  dept: string;
  deptName: string;
  sheet: string;
  level: 'row' | 'behaviour' | 'book';
  type: string;
  title: string;
  /** Порядок разбора словом, без внутреннего капслока. */
  urgency: string;
  urgencyRank: number;
  /** Фраза детектора: почему сработало. */
  why: string;
  /** null — признак не про одну строку (уровень книги). */
  sheetRow: number | null;
  rowSeq: string;
  subject: string;
  subordinate: string;
  /** Адреса задетых строк для признаков уровня книги. */
  members: string[];
  /** Строк за признаком всего (для книжных — сколько задето). */
  rows: number;
}

/** Свёртка по типам: сколько строк за каждым родом и какие именно. */
export interface NoiseGroupDto {
  dept: string;
  deptName: string;
  key: string;
  label: string;
  count: number;
  urgency: string;
  urgencyRank: number;
  summary: string;
  members: string[];
}

export interface AnomaliesResponse {
  /** Момент чтения (ISO) — канон п.58. */
  asOf: string;
  /** Книги, чьи строки прочитаны. */
  booksRead: string[];
  /** Книги без строк: признаков по ним нет, потому что смотреть было нечего. */
  booksSilent: string[];
  /** Книги без журнала правок: два признака из двенадцати по ним не считались. */
  journalsSilent: string[];
  rowsScanned: number;
  typo: AnomalySignDto[];
  fitted: AnomalySignDto[];
  counts: Record<string, number>;
  amountAtRisk: { typo: number; fitted: number };
  /** Аномалии датасета из снимка, доведённые до адреса. */
  dataset: DatasetFindingDto[];
  /** Свёртка находок по типам (buildNoiseMap ядра). */
  noise: NoiseGroupDto[];
  /** Есть ли в снимке разбор датасета вообще. */
  datasetAvailable: boolean;
  notes: string[];
}

// ────────────────────────────────────────────────────────────
// Чтение строк книг
// ────────────────────────────────────────────────────────────

function text(row: unknown[], col: number): string {
  return String(row[col] ?? '').trim();
}

/**
 * Число из ячейки листа. null означает «числа нет», а не ноль: ноль — это
 * утверждение о сумме, а пустая ячейка утверждением не является.
 */
function money(row: unknown[], col: number): number | null {
  return cellNumber(row[col]);
}

/** Подпись организации: пустая колонка C — сам аппарат управления. */
function orgLabel(raw: unknown): string {
  const key = subordinateKey(raw);
  return key === ORG_ITSELF_SENTINEL ? 'Аппарат управления' : key;
}

/**
 * Строки одной книги в форме входа детектора.
 *
 * Отбор — общей дверью `isReadableDeptRow` (одна дверь длины строки на весь
 * продукт) плюс отсев итогов и разделов по имени: «Итого» с суммой в тысячу
 * миллионов иначе стала бы выбросом в каждой книге.
 */
export function buildAnomalyRows(
  dept: DepartmentEntry,
  values: readonly unknown[][],
): { rows: AnomalyRow[]; byRow: Map<number, unknown[]> } {
  const rows: AnomalyRow[] = [];
  const byRow = new Map<number, unknown[]>();
  values.forEach((raw, idx) => {
    if (!Array.isArray(raw)) return;
    byRow.set(idx + SHEET_ROW_FROM_INDEX, raw);
    if (idx < DEPT_HEADER_ROWS) return;
    if (!isReadableDeptRow(raw)) return;
    const name = text(raw, DEPT_COLUMNS.SUBORDINATE) || text(raw, DEPT_COLUMNS.PROGRAM_NAME);
    if (isMetaRow(name)) return;
    rows.push({
      book: dept.id,
      sheet: dept.sheetName,
      sheetRow: idx + SHEET_ROW_FROM_INDEX,
      rowSeq: text(raw, DEPT_COLUMNS.ID),
      subordinate: orgLabel(raw[DEPT_COLUMNS.SUBORDINATE]),
      subject: text(raw, DEPT_COLUMNS.SUBJECT),
      method: text(raw, DEPT_COLUMNS.METHOD),
      planTotal: money(raw, DEPT_COLUMNS.TOTAL_PLAN),
      factTotal: money(raw, DEPT_COLUMNS.TOTAL_FACT),
      economy: money(raw, DEPT_COLUMNS.ECONOMY_TOTAL),
      planDate: raw[DEPT_COLUMNS.PLAN_DATE],
      factDate: raw[DEPT_COLUMNS.FACT_DATE],
    });
  });
  return { rows, byRow };
}

/** Адрес строки словами: «строка 155 (№ 39)» либо просто «строка 155». */
export function addressOf(sheetRow: number, rowSeq: string): string {
  const seq = rowSeq.trim();
  return seq === '' ? `строка ${sheetRow}` : `строка ${sheetRow} (№ ${seq})`;
}

function findingToDto(f: AnomalyFinding, deptName: string): AnomalySignDto {
  return {
    dept: f.address.book,
    deptName,
    scale: f.scale,
    sign: f.sign,
    title: f.title,
    explanation: f.explanation,
    amountAtRisk: Math.round(f.amountAtRisk * 100) / 100,
    sheet: f.address.sheet,
    sheetRow: f.address.sheetRow,
    rowSeq: f.address.rowSeq,
    cell: f.address.cell,
    subordinate: f.subordinate ?? '',
    subject: f.subject ?? '',
    rows: f.rows,
    smallSample: f.smallSample,
    ...(f.note ? { note: f.note } : {}),
    members: (f.members ?? [])
      .slice(0, SHOWN_MEMBERS)
      .map((m) => addressOf(m.sheetRow, m.rowSeq)),
  };
}

// ────────────────────────────────────────────────────────────
// Аномалии датасета из снимка → адреса
// ────────────────────────────────────────────────────────────

/** Что известно о строке книги по её номеру: № п/п, предмет, учреждение. */
interface RowFacts {
  rowSeq: string;
  subject: string;
  subordinate: string;
}

function factsOf(byRow: Map<number, unknown[]>, sheetRow: number): RowFacts {
  const raw = byRow.get(sheetRow);
  if (!raw) return { rowSeq: '', subject: '', subordinate: '' };
  return {
    rowSeq: text(raw, DEPT_COLUMNS.ID),
    subject: text(raw, DEPT_COLUMNS.SUBJECT),
    subordinate: orgLabel(raw[DEPT_COLUMNS.SUBORDINATE]),
  };
}

/**
 * Разбор одного управления снимка в адресные находки.
 *
 * Форма снимка объявлена частичной сознательно: у книги, посчитанной наполовину,
 * любое поле может отсутствовать, и разбор обязан это пережить, а не уронить
 * весь раздел из-за одной книги.
 */
export function datasetFindingsOf(
  analysis: Partial<DatasetAnalysis> | null | undefined,
  dept: DepartmentEntry,
  byRow: Map<number, unknown[]>,
): { findings: DatasetFindingDto[]; noise: NoiseGroupDto[] } {
  const findings: DatasetFindingDto[] = [];
  const noise: NoiseGroupDto[] = [];
  if (!analysis || typeof analysis !== 'object') return { findings, noise };

  const base = { dept: dept.id, deptName: dept.fullName, sheet: dept.sheetName };

  const pushRowLevel = (
    level: 'row' | 'behaviour',
    type: string,
    title: string,
    severity: string,
    details: string,
    rowIndex: number,
  ): void => {
    const sheetRow = rowIndex >= 0 ? rowIndex + SHEET_ROW_FROM_INDEX : null;
    const facts = sheetRow === null
      ? { rowSeq: '', subject: '', subordinate: '' }
      : factsOf(byRow, sheetRow);
    findings.push({
      ...base,
      level,
      type,
      title,
      urgency: URGENCY[severity] ?? 'к сведению',
      urgencyRank: URGENCY_RANK[severity] ?? 3,
      why: details,
      sheetRow,
      ...facts,
      members: [],
      rows: 1,
    });
  };

  const anomalies = analysis.anomalies;
  for (const a of anomalies?.dataAnomalies ?? []) {
    const title = DATA_ANOMALY_LABEL[a.type];
    if (!title) continue;
    pushRowLevel('row', a.type, title, a.severity, a.details, a.rowIndex);
  }
  for (const a of anomalies?.behavioralAnomalies ?? []) {
    const title = BEHAVIORAL_ANOMALY_LABEL[a.type];
    if (!title) continue;
    pushRowLevel('behaviour', a.type, title, a.severity, a.details, a.rowIndex);
  }
  for (const a of anomalies?.systemicAnomalies ?? []) {
    const title = SYSTEMIC_ANOMALY_LABEL[a.type];
    if (!title) continue;
    const affected = Array.isArray(a.affectedRows) ? a.affectedRows : [];
    findings.push({
      ...base,
      level: 'book',
      type: a.type,
      title,
      urgency: URGENCY[a.severity] ?? 'к сведению',
      urgencyRank: URGENCY_RANK[a.severity] ?? 3,
      why: a.details,
      sheetRow: null,
      rowSeq: '',
      subject: '',
      subordinate: '',
      members: affected.slice(0, SHOWN_MEMBERS).map((idx) => {
        const sheetRow = idx + SHEET_ROW_FROM_INDEX;
        return addressOf(sheetRow, factsOf(byRow, sheetRow).rowSeq);
      }),
      rows: affected.length,
    });
  }

  for (const g of (analysis.noiseMap ?? []) as NoiseGroup[]) {
    if (!g || typeof g !== 'object') continue;
    const rows = Array.isArray(g.rows) ? g.rows : [];
    noise.push({
      ...base,
      key: `${dept.id}:${g.key}`,
      label: g.label,
      count: g.count,
      urgency: URGENCY[g.severity] ?? 'к сведению',
      urgencyRank: URGENCY_RANK[g.severity] ?? 3,
      summary: String(g.summary ?? ''),
      members: rows.slice(0, SHOWN_MEMBERS).map((idx) => {
        const sheetRow = idx + SHEET_ROW_FROM_INDEX;
        return addressOf(sheetRow, factsOf(byRow, sheetRow).rowSeq);
      }),
    });
  }

  return { findings, noise };
}

// ────────────────────────────────────────────────────────────
// Сборка ответа
// ────────────────────────────────────────────────────────────

const CACHE_TTL_MS = 5 * 60 * 1000;
let cached: { at: number; response: AnomaliesResponse } | null = null;

/** Сбрасывает окно кэша — нужен тестам и ручной перечитке. */
export function resetAnomaliesCache(): void {
  cached = null;
}

export async function buildAnomaliesResponse(now: number = Date.now()): Promise<AnomaliesResponse> {
  const sheetValues = getDeptSheetValues();
  const journals = await readAllBookJournals(now);
  const journalByDept = new Map(journals.map((j) => [j.dept, j]));

  let snapshotAnalyses: Record<string, unknown> = {};
  let datasetAvailable = false;
  try {
    const snapshot = await getSnapshot();
    const analyses = (snapshot as { datasetAnalyses?: Record<string, unknown> }).datasetAnalyses;
    if (analyses && typeof analyses === 'object') {
      snapshotAnalyses = analyses;
      datasetAvailable = Object.keys(analyses).length > 0;
    }
  } catch {
    // Снимка нет — раздел аномалий датасета скажет об этом словами ниже.
  }

  const typo: AnomalySignDto[] = [];
  const fitted: AnomalySignDto[] = [];
  const dataset: DatasetFindingDto[] = [];
  const noise: NoiseGroupDto[] = [];
  const counts: Record<string, number> = {};
  const booksRead: string[] = [];
  const booksSilent: string[] = [];
  const journalsSilent: string[] = [];
  let rowsScanned = 0;
  let amountTypo = 0;
  let amountFitted = 0;
  let journalMissingNote = '';

  for (const deptId of Object.keys(DEPARTMENT_SPREADSHEETS)) {
    const dept = findDept(deptId);
    if (!dept) continue;

    // Ключ кэша листов — имя книги; findDept понимает и его, и канон-id.
    const values = Object.entries(sheetValues)
      .find(([name]) => findDept(name)?.id === dept.id)?.[1];
    if (!values || values.length <= DEPT_HEADER_ROWS) {
      booksSilent.push(dept.id);
      continue;
    }
    booksRead.push(dept.id);

    const { rows, byRow } = buildAnomalyRows(dept, values);
    rowsScanned += rows.length;

    const journal: BookJournal | undefined = journalByDept.get(deptId);
    if (!journal?.available) journalsSilent.push(dept.id);
    const journalEntries: AnomalyJournalEntry[] = journal?.available
      ? toJournalEntries(journal).map((e) => ({
        book: dept.id,
        sheet: dept.sheetName,
        cell: e.cell,
        was: e.was,
        became: e.became,
        at: e.at,
        ...(e.author ? { author: e.author } : {}),
      }))
      : [];

    const report = detectRowAnomalies({ rows, journal: journalEntries });
    for (const f of report.typo) typo.push(findingToDto(f, dept.fullName));
    for (const f of report.fitted) fitted.push(findingToDto(f, dept.fullName));
    for (const [sign, n] of Object.entries(report.counts)) {
      counts[sign] = (counts[sign] ?? 0) + n;
    }
    amountTypo += report.amountAtRisk.typo;
    amountFitted += report.amountAtRisk.fitted;
    // Оговорки ядра берём из ядра — экран не сочиняет их заново.
    if (journalEntries.length === 0 && journalMissingNote === '') {
      journalMissingNote = report.notes.find((n) => n.includes('Журнал')) ?? '';
    }

    const analysis = snapshotAnalyses[dept.latinId] ?? snapshotAnalyses[dept.id];
    const parsed = datasetFindingsOf(
      analysis as Partial<DatasetAnalysis> | undefined,
      dept,
      byRow,
    );
    dataset.push(...parsed.findings);
    noise.push(...parsed.noise);
  }

  const notes: string[] = [
    'Две шкалы независимы: «похоже на опечатку» и «похоже на подгон» отвечают на разные ' +
    'вопросы и в один балл не складываются.',
    'Признак — повод открыть строку, а не вывод о нарушении. Отсутствие признаков не ' +
    'означает, что данные верны.',
  ];
  if (booksSilent.length > 0) {
    notes.push(
      `Строки не прочитаны: ${booksSilent.join(', ')}. По этим книгам признаков нет потому, ` +
      'что смотреть было нечего, — это не «странностей не найдено».',
    );
  }
  if (journalsSilent.length > 0) {
    notes.push(
      `Журнал правок не прочитан: ${journalsSilent.join(', ')}. ` +
      (journalMissingNote || 'Признаки «правка в кратное десяти число раз» и «правка плана ' +
        'после факта» по этим книгам не проверялись.'),
    );
  }
  if (!datasetAvailable) {
    notes.push(
      'Разбор датасета в снимке отсутствует: аномалии по книгам не показаны потому, что их ' +
      'не из чего взять. Обновите данные — разбор считается при чтении книг.',
    );
  }

  return {
    asOf: new Date(now).toISOString(),
    booksRead,
    booksSilent,
    journalsSilent,
    rowsScanned,
    // Дороже — выше: разбор идёт от денег под риском, а не от порядка книг.
    typo: typo.sort((a, b) => b.amountAtRisk - a.amountAtRisk),
    fitted: fitted.sort((a, b) => b.amountAtRisk - a.amountAtRisk),
    counts,
    amountAtRisk: {
      typo: Math.round(amountTypo * 100) / 100,
      fitted: Math.round(amountFitted * 100) / 100,
    },
    dataset: dataset.sort((a, b) =>
      a.urgencyRank - b.urgencyRank
      || (a.sheetRow ?? Number.MAX_SAFE_INTEGER) - (b.sheetRow ?? Number.MAX_SAFE_INTEGER)),
    noise: noise.sort((a, b) => a.urgencyRank - b.urgencyRank || b.count - a.count),
    datasetAvailable,
    notes,
  };
}

export async function anomaliesRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /api/anomalies — адресные признаки странностей строк книг.
   *
   * Отвечает 200 даже когда всё молчит: раздел существует ровно затем, чтобы
   * показать, где следа нет. Роут, отдающий 503 на молчание источников,
   * скрывает КАКАЯ книга молчит — то есть теряет главное.
   */
  app.get('/api/anomalies', async (request, reply) => {
    const fresh = (request.query as { refresh?: string } | undefined)?.refresh === 'true';
    const now = Date.now();
    if (!fresh && cached && now - cached.at < CACHE_TTL_MS) {
      return reply.send(cached.response);
    }
    const response = await buildAnomaliesResponse(now);
    cached = { at: now, response };
    return reply.send(response);
  });
}
