/**
 * Договор экрана «Мониторинг · Реестр процедур определения поставщика» с
 * сервером (GET /api/monitoring, GET /api/monitoring/match; канон п.101а).
 *
 * ПОЧЕМУ ТИПЫ ЗДЕСЬ, А НЕ В ОБЩЕМ api.ts. Ровно та же причина, что у
 * `components/workload/contract.ts`: этот ответ читает один экран, и его форма
 * меняется вместе с ним. Плюс причина этой волны — ядро и сервер сейчас пишет
 * параллельный агент по той же спеке
 * (docs/superpowers/specs/2026-08-18-monitoring-tab-spec-v2.md §8), и пока его
 * роут не приземлился, экран обязан работать по описанному контракту, а не
 * падать.
 *
 * ПОЭТОМУ ВХОД — `unknown`, А НЕ ТИП ЯДРА. Разбор ниже читает ответ
 * оборонительно: раздела нет — раздел равен null, и экран говорит «этот лист
 * книги сервер ещё не отдаёт», а не рисует пустую таблицу, притворяющуюся
 * прочитанным листом. Так же экран переживёт и переименование поля у соседа:
 * пропадёт один блок, а не вся вкладка.
 *
 * ЧЕСТНАЯ ПУСТОТА ВМЕСТО НУЛЯ (п.36). Каждое число здесь допускает null, и это
 * не удобство: «цена не внесена» и «цена ноль» — разные новости. Ноль в цене
 * аукциона содержателен — торги прошли без результата, — и рисовать его
 * прочерком запрещено; null рисуется прочерком и объясняется словами.
 *
 * ДЕНЬГИ — РУБЛИ. Книга мониторинга ведётся в рублях, книги ГРБС — в тысячах.
 * Единица объявлена в `source.moneyUnit`, и подпись обязана стоять у каждой
 * суммы на экране: перепутать эти две книги значит ошибиться в тысячу раз.
 */
import { fetchJSON } from '../../api';

// ── Источник и состояние книги ───────────────────────────────────────

export interface MonitoringSource {
  bookName: string;
  /** Момент чтения книги (ISO) — плашка периода данных (п.58). */
  readAt: string;
  /** Единица денег ответа. Книги ГРБС — тысячи; здесь — рубли. */
  moneyUnit: string;
  /** Листы книги, прочитанные сервером, в каноническом порядке книги. */
  sheetsRead: string[];
  /** Лист → русская причина отказа. Пусто — прочитано всё. */
  sheetsFailed: Record<string, string>;
  /**
   * Сколько листов книги продукт читает ДАННЫМИ — знаменатель полноты чтения,
   * названный сервером. Считать его на экране значило бы завести второй ответ
   * на вопрос «сколько всего листов», и он однажды разошёлся бы с первым:
   * состав `MONITORING_DATA_SHEETS` живёт в ядре и меняется там.
   * `null` — сервер знаменателя не назвал (старый ответ).
   */
  sheetsExpected: number | null;
}

// ── Строка реестра ───────────────────────────────────────────────────

/**
 * Стадия оставлена строкой, а не объединением литералов, намеренно: набор
 * ступеней сейчас растёт с четырёх до пяти на стороне ядра (спека §3.1), и
 * жёсткий союз здесь означал бы падение экрана на незнакомом слове. Подписи
 * ищутся в `stage-labels.ts` с честным запасным вариантом.
 */
export type ProcedureStageKey = string;

/** Способ определения поставщика — из префикса кода процедуры. */
export type ProcurementMethod = 'ЭА' | 'ЭАС' | 'ЭЗК' | 'ЭЕП' | string;

/**
 * Дефект ячейки, найденный ядром, с адресом. Экран его не пересказывает и не
 * переводит: фраза ядра уже написана тоном механизма (п.104), а адрес —
 * единственное, чем карточка диагноста полезна (п.53).
 */
export interface ProcedureDefect {
  kind: string;
  /** «5. УДТХиРКИ!D34» — адрес, по которому ячейку найдут глазами. */
  address: string;
  note: string;
}

/** Сроки этапов пути, календарных дней; null — одной из дат нет. */
export interface ProcedureDurations {
  toPublication: number | null;
  toDeadline: number | null;
  toAuction: number | null;
  total: number | null;
}

export interface RegistryProcedure {
  /** Имя листа книги — половина адреса для карточки диагноста (п.53). */
  sheet: string;
  /** Номер строки листа (1-based, как в Sheets) — вторая половина адреса. */
  row: number;
  /** Канонический ид управления продукта (УЭР, УО, …). */
  dept: string;
  /** Колонка A «№ п/п» — в УО нумерация 1…27 идёт дважды, отсюда двойной адрес. */
  ppNum: string | null;
  customer: string;
  /** Канонический код процедуры («ЭА152-26») либо null — код не разобран. */
  code: string | null;
  /**
   * Объяснение нечитаемого кода: «В книге записано „ЭКЗ301-26“ — похоже на
   * ЭЗК301-26 (буквы переставлены местами).» null — код разобран либо кода
   * в ячейке не видно. Догадка показывается, сверка по ней не строится.
   */
  codeNote: string | null;
  /** Способ из префикса кода; null — кода нет. */
  method: ProcurementMethod | null;
  /** Год процедуры из суффикса кода: книга переходящая, без года нет итога года. */
  year: number | null;
  subject: string;
  /** НМЦК, руб. (колонка D). */
  nmck: number | null;
  applicationDate: string | null;
  publicationDate: string | null;
  deadlineDate: string | null;
  /** Дата проведения торгов/переторжки (на листе «25-26» — подведения итогов). */
  auctionDate: string | null;
  /** Цена аукциона, руб.; 0 — торги без результата; null — итога нет. */
  auctionPrice: number | null;
  /** Экономия ВСЕГО, руб. (колонка J) — как записано в книге. */
  savingsTotal: number | null;
  /** Разбивка ЭКОНОМИИ по бюджетам (колонки L/M/N) — не разбивка НМЦК. */
  savingsMb: number | null;
  savingsKb: number | null;
  savingsFb: number | null;
  /** true — в колонке экономии стоит число, а не формула: связь с ценой разорвана. */
  savingsManual: boolean;
  /** Самопроверка книги (колонка K): «верно» / «ошибка» / null. */
  selfCheck: string | null;
  /** Колонка «Победитель» целиком, как в книге, — источник для наведения (п.27). */
  winner: string | null;
  /** Наименование победителя, отделённое от ИНН. */
  winnerName: string | null;
  winnerInn: string | null;
  /** Исход из той же ячейки: «Не состоялся (0 заявок)» и подобные. */
  outcome: string | null;
  stage: ProcedureStageKey;
  /** Снижение на торгах, руб. */
  reductionRub: number | null;
  /** Снижение на торгах, % от НМЦК. */
  reductionPct: number | null;
  /** Комментарий книги (колонка P) — заполнен шесть раз на всю книгу. */
  comment: string | null;
  /** Заказчик, приведённый к сравнимому виду НАШЕЙ нормализацией, не книги. */
  customerNormalized: string;
  /** Сумма разбивки МБ+КБ+ФБ, руб.; null — ни одна доля не заполнена. */
  savingsSplitSum: number | null;
  /** Наш пересчёт контроля «ВСЕГО = МБ+КБ+ФБ»; null — сравнивать нечего. */
  controlAgrees: boolean | null;
  /** Разрыв ВСЕГО − (МБ+КБ+ФБ), руб.; null — сравнивать нечего. */
  controlGapRub: number | null;
  /** Совместная закупка: способ ЭАС либо заказчик-признак «Совместный …». */
  joint: boolean;
  /** ИНН записан в ячейке дважды — след копипаста. */
  innRepeated: boolean;
  durations: ProcedureDurations;
  /** Дефекты ячеек этой строки, найденные ядром, с адресами. */
  defects: ProcedureDefect[];
}

/** Адрес строки, чей код процедуры не разобрался, — сигнал, не потеря. */
export interface UnparsedCodeRef {
  sheet: string;
  row: number;
  text: string;
  /** Каноническая догадка («ЭЗК301-26»); null — кода в ячейке не видно. */
  guess: string | null;
  /** В чём искажение («буквы переставлены местами»); null — кода не видно. */
  note: string | null;
}

export interface RegistryAggregates {
  total: number;
  byStage: Record<string, number>;
  nmckTotal: number;
  awarded: {
    count: number;
    nmckTotal: number;
    priceTotal: number;
    savingsTotal: number;
    /** Портфельный процент: (ΣНМЦК − Σцена) ÷ ΣНМЦК. */
    portfolioReductionPct: number | null;
    /** Среднее построчных процентов по всем состоявшимся. */
    avgReductionPct: number | null;
    /** Среднее по тем, где снижение вообще было. */
    avgReductionWhenReducedPct: number | null;
    /** Цена в точности равна НМЦК — снижения не было. */
    noReductionCount: number;
  };
  codesParsed: number;
  codesUnparsed: number;
}

// ── Свод ─────────────────────────────────────────────────────────────

/** Шесть чисел, которые лист отдаёт своду. */
export interface SvodFigures {
  count: number | null;
  nmck: number | null;
  price: number | null;
  savingsTotal: number | null;
  mb: number | null;
  kb: number | null;
  fb: number | null;
}

export interface SvodRow {
  /** Канонический ид управления продукта. */
  dept: string;
  /** Имя листа книги («4. УАГиЗО»). */
  sheet: string;
  /** Имя управления на самом своде («УАГЗО АЕМР») — третье написание. */
  bookLabel: string;
  /** Как считает книга (формулы свода). */
  book: SvodFigures;
  /** Как считает продукт (разбор строк листа). */
  product: SvodFigures;
  /** Разрыв «ВСЕГО − (МБ+КБ+ФБ)», руб.; null — считать не из чего. */
  budgetGap: number | null;
  /** Причина расхождения книги и продукта одной фразой; null — расхождения нет. */
  divergenceNote: string | null;
}

export interface SvodPayload {
  rows: SvodRow[];
  total: SvodRow;
  notes: string[];
}

// ── Переходящий реестр «25-26» ───────────────────────────────────────

export interface JournalRow {
  row: number;
  /** Колонка A, разобранная на словарь: «С отклонением участника», «ФАС», … */
  fate: string | null;
  /** Исходный текст колонки A — то, что человек написал рукой. */
  fateRaw: string | null;
  /** Код процедуры-соседки по родословной (предшественница либо преемница). */
  linkedCode: string | null;
  customer: string;
  code: string | null;
  subject: string;
  nmck: number | null;
  applicationDate: string | null;
  publicationDate: string | null;
  deadlineDate: string | null;
  /** «Дата подведения итогов» — на листах управлений та же дата зовётся иначе. */
  resultDate: string | null;
  auctionPrice: number | null;
  savingsTotal: number | null;
  savingsMb: number | null;
  savingsKb: number | null;
  savingsFb: number | null;
  winnerName: string | null;
  winnerInn: string | null;
  outcome: string | null;
  /** Строка спрятана в самой книге — показываем, но помечаем. */
  hiddenInBook: boolean;
  /** Строка ниже границы автофильтра книги — человек её при отборе не видит. */
  outsideFilter: boolean;
}

/** Цепочка переобъявлений: ЭА52-26 → ЭА91-26 → ЭА119-26. */
export interface LineageChain {
  codes: string[];
  /** Как записано в книге по каждому звену — свидетельство, не пересказ. */
  notes: string[];
}

export interface JournalPayload {
  rows: JournalRow[];
  lineage: LineageChain[];
  notes: string[];
}

// ── Справочник учреждений ────────────────────────────────────────────

export interface DirectoryRow {
  num: string | null;
  grbs: string | null;
  fullName: string | null;
  shortName: string | null;
  /** Сокращённое дословно повторяет полное — сокращения на деле нет. */
  shortMissing: boolean;
  /** Сколько строк реестра ссылаются на это учреждение. */
  usedInBook: number | null;
}

export interface DirectoryPayload {
  rows: DirectoryRow[];
  /** Написания заказчика, которых в справочнике нет, по убыванию частоты. */
  unmatchedCustomers: Array<{ name: string; count: number }>;
  notes: string[];
}

// ── Сигналы ──────────────────────────────────────────────────────────

export type SignalSeverity = 'high' | 'medium' | 'low' | string;

/** Карточка диагноста (п.53): механизм · адрес · действие. */
export interface MonitoringSignal {
  id: string;
  title: string;
  severity: SignalSeverity;
  /** Почему так вышло — механизм, не упрёк (п.104). */
  mechanism: string;
  /** Что сделать. */
  action: string;
  /** Сколько строк/ячеек затронуто. */
  count: number;
  /** Адреса «лист!ячейка» либо «лист · строка N». */
  addresses: string[];
}

// ── Сверка с книгами ГРБС ────────────────────────────────────────────
//
// ЗДЕСЬ ЕЁ БОЛЬШЕ НЕТ, И ЭТО НЕ ПОТЕРЯ. Роут `/api/monitoring/match` отдаёт
// форму `{summary, matched, bookOnly, monitoringOnly, ambiguous, listCells,
// internal}`; читалка, стоявшая на этом месте, ждала выдуманной формы
// `{coveragePct, outcomes, rows, internalDiff}` — ни одного поля из живого
// ответа. Она молча возвращала `null` на КАЖДОМ ответе, и полоса «Сверка со
// строкой книги управления» в карточке каждой процедуры писала «сверка не
// подключена» при работающем сервере. Второй дом одного сигнала (п.132) —
// не запасной, а расходящийся: он врал ровно потому, что был второй.
//
// Живой ответ читает `analytics-contract.ts` (`normalizeMatchView`), а
// указатель «код процедуры → встречная сторона» строит `match-rows.ts`.

// ── Целый ответ ──────────────────────────────────────────────────────

export interface MonitoringPayload {
  source: MonitoringSource;
  procedures: RegistryProcedure[];
  aggregates: RegistryAggregates | null;
  unparsedCodes: UnparsedCodeRef[];
  /** null — раздела в ответе нет: сервер этот лист ещё не отдаёт. */
  svod: SvodPayload | null;
  journal: JournalPayload | null;
  directory: DirectoryPayload | null;
  signals: MonitoringSignal[] | null;
  /**
   * Скрытые листы-предки, названные сервером. `null` — сервер их не назвал, и
   * экран берёт запасной список; но берёт ОСОЗНАННО, а не молча считая копию
   * на клиенте истиной.
   */
  ancestors: AncestorsPayload | null;
  notes: string[];
}

// ── Чтение неизвестного ответа ───────────────────────────────────────

function rec(v: unknown): Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
}

function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

/** Число либо null. Ноль — значение, а не пустота: подмена запрещена. */
function num(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v.replace(/\s/gu, '').replace(',', '.'));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Число с запасным нулём — только для счётчиков, где ноль и есть ноль. */
function count(v: unknown): number {
  return num(v) ?? 0;
}

function str(v: unknown): string | null {
  if (typeof v === 'string') {
    const s = v.trim();
    return s === '' ? null : s;
  }
  if (typeof v === 'number') return String(v);
  return null;
}

function text(v: unknown): string {
  return str(v) ?? '';
}

function bool(v: unknown): boolean {
  return v === true;
}

function strList(v: unknown): string[] {
  return arr(v).map(str).filter((s): s is string => s !== null);
}

function recordOfStrings(v: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, val] of Object.entries(rec(v))) {
    const s = str(val);
    if (s !== null) out[k] = s;
  }
  return out;
}

function recordOfNumbers(v: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, val] of Object.entries(rec(v))) {
    const n = num(val);
    if (n !== null) out[k] = n;
  }
  return out;
}

// ── Разбор разделов ──────────────────────────────────────────────────

/**
 * Дата книги из ответа. Ядро отдаёт её парой «как записано в книге» и «разбор
 * в ISO» (`{raw, iso}`), а не строкой, и это существенно: разбор может не
 * получиться («23.062026»), и тогда `raw` — единственное, что честно показать.
 *
 * Экран приводит дату к письму книги «дд.мм.гггг»: в этом виде её узнаёт
 * читатель, в этом виде её читают сортировка и отбор по периоду. Разбор не
 * получился — возвращается сырое написание, оно не притворяется датой и
 * попадает в дефекты строки, а не в тихую пустоту.
 */
function readDate(v: unknown): string | null {
  if (typeof v === 'string') {
    const s = v.trim();
    if (s === '') return null;
    const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
    return iso ? `${iso[3]}.${iso[2]}.${iso[1]}` : s;
  }
  if (v !== null && typeof v === 'object') {
    const d = rec(v);
    const iso = str(d.iso);
    if (iso !== null) return readDate(iso);
    return str(d.raw);
  }
  return null;
}

function readDefects(v: unknown): ProcedureDefect[] {
  return arr(v)
    .map((x): ProcedureDefect => {
      const d = rec(x);
      return { kind: text(d.kind), address: text(d.address), note: text(d.note) };
    })
    .filter((d) => d.note !== '' || d.address !== '');
}

function readProcedure(raw: unknown): RegistryProcedure {
  const r = rec(raw);
  const code = str(r.code);
  // Победитель приходит разобранной ячейкой ({raw, name, inn, outcome, …}), а
  // не строкой: плоские поля ниже — запасной путь на случай, когда сервер
  // отдаёт уже разложенный вид.
  const w = rec(r.winner);
  const winnerRaw = str(w.raw) ?? str(r.winner);
  const defects = readDefects(r.defects);
  const dur = rec(r.durations);
  return {
    sheet: text(r.sheet),
    row: count(r.row),
    dept: text(r.dept),
    // Номер п/п у ядра числовой (`ordinal`), у плоского вида — строкой: обе
    // формы сводятся к строке, потому что номер здесь — адрес, а не величина.
    ppNum: str(r.ppNum) ?? str(r.ordinal),
    customer: text(r.customer),
    code,
    codeNote: str(r.codeNote),
    // Способ и год сервер может ещё не присылать — выводим из кода сами, но
    // ровно так же, как их выводит ядро: префикс букв и суффикс после дефиса.
    method: str(r.method) ?? (code !== null ? /^[А-ЯЁ]+/u.exec(code)?.[0] ?? null : null),
    year: num(r.year) ?? codeYear(code),
    subject: text(r.subject),
    nmck: num(r.nmck),
    applicationDate: readDate(r.applicationDate),
    publicationDate: readDate(r.publicationDate),
    deadlineDate: readDate(r.deadlineDate),
    auctionDate: readDate(r.auctionDate),
    auctionPrice: num(r.auctionPrice),
    savingsTotal: num(r.savingsTotal),
    savingsMb: num(r.savingsMb),
    savingsKb: num(r.savingsKb),
    savingsFb: num(r.savingsFb),
    // Ручную экономию сервер может не помечать флагом — тогда её выдаёт
    // собственный дефект ядра: связь с формулой на этой строке разорвана.
    savingsManual: bool(r.savingsManual) || defects.some((d) => d.kind === 'manual-savings'),
    selfCheck: str(r.selfCheck),
    winner: winnerRaw,
    winnerName: str(w.name) ?? str(r.winnerName),
    winnerInn: str(w.inn) ?? str(r.winnerInn),
    // Исход — текст книги, а не наш ярлык: «Не состоялся (0 заявок)» несёт
    // причину, которой в ключе `not_held` уже нет.
    outcome: str(w.outcomeText) ?? str(r.outcome),
    stage: text(r.stage) || 'application',
    reductionRub: num(r.reductionRub),
    reductionPct: num(r.reductionPct),
    comment: str(r.comment),
    customerNormalized: str(r.customerNormalized) ?? text(r.customer),
    savingsSplitSum: num(r.savingsSplitSum),
    controlAgrees: typeof r.controlAgrees === 'boolean' ? r.controlAgrees : null,
    controlGapRub: num(r.controlGapRub),
    joint: bool(r.joint),
    innRepeated: bool(w.innRepeated) || bool(r.innRepeated),
    durations: {
      toPublication: num(dur.toPublication),
      toDeadline: num(dur.toDeadline),
      toAuction: num(dur.toAuction),
      total: num(dur.total),
    },
    defects,
  };
}

/**
 * Год процедуры из суффикса кода: «ЭА152-26» → 2026. Двузначный год книги
 * разворачивается в четырёхзначный без угадывания века: книга ведётся с 2025-го.
 */
export function codeYear(code: string | null): number | null {
  if (code === null) return null;
  const m = /-(\d{2})$/.exec(code);
  return m ? 2000 + Number(m[1]) : null;
}

function readAggregates(raw: unknown): RegistryAggregates | null {
  if (raw === null || raw === undefined) return null;
  const r = rec(raw);
  const a = rec(r.awarded);
  return {
    total: count(r.total),
    byStage: recordOfNumbers(r.byStage),
    nmckTotal: count(r.nmckTotal),
    awarded: {
      count: count(a.count),
      nmckTotal: count(a.nmckTotal),
      priceTotal: count(a.priceTotal),
      savingsTotal: count(a.savingsTotal),
      portfolioReductionPct: num(a.portfolioReductionPct),
      avgReductionPct: num(a.avgReductionPct),
      avgReductionWhenReducedPct: num(a.avgReductionWhenReducedPct),
      noReductionCount: count(a.noReductionCount),
    },
    codesParsed: count(r.codesParsed),
    codesUnparsed: count(r.codesUnparsed),
  };
}

function readFigures(raw: unknown): SvodFigures {
  const r = rec(raw);
  return {
    count: num(r.count),
    nmck: num(r.nmck),
    price: num(r.price),
    savingsTotal: num(r.savingsTotal),
    mb: num(r.mb),
    kb: num(r.kb),
    fb: num(r.fb),
  };
}

function readSvodRow(raw: unknown): SvodRow {
  const r = rec(raw);
  return {
    dept: text(r.dept),
    sheet: text(r.sheet),
    bookLabel: text(r.bookLabel),
    book: readFigures(r.book),
    product: readFigures(r.product),
    budgetGap: num(r.budgetGap),
    divergenceNote: str(r.divergenceNote),
  };
}

function readSvod(raw: unknown): SvodPayload | null {
  if (raw === null || raw === undefined) return null;
  const r = rec(raw);
  // Роут /api/monitoring отдаёт свод ОБЁРТКОЙ { book, comparison } — книга и
  // сравнение с продуктом раздельно. До 20.08 маппер ждал только плоскую
  // форму { rows, total }, из-за чего живой свод превращался в null и плашка
  // вкладки честно (но ложно) говорила «„СВОДНЫЙ" не доехал».
  if (r.book !== undefined || r.comparison !== undefined) {
    return readSvodWrapped(rec(r.book), rec(r.comparison));
  }
  const rows = arr(r.rows).map(readSvodRow);
  if (rows.length === 0 && r.total === undefined) return null;
  return { rows, total: readSvodRow(r.total), notes: strList(r.notes) };
}

/**
 * Склейка серверной обёртки в строки вкладки: цифры «как считает книга» и
 * «как считает продукт» — из сравнения, разбивка экономии МБ/КБ/ФБ и контроль
 * «ВСЕГО = МБ+КБ+ФБ» — из книжной стороны (в сравнении их нет).
 */
function readSvodWrapped(
  book: Record<string, unknown>,
  comparison: Record<string, unknown>,
): SvodPayload | null {
  const bookRows = arr(book.rows).map(rec);
  const compRows = arr(comparison.rows).map(rec);
  if (bookRows.length === 0 && compRows.length === 0) return null;
  const bookByDept = new Map(
    bookRows
      .map((b) => [str(b.dept), b] as const)
      .filter((pair): pair is readonly [string, Record<string, unknown>] => pair[0] !== null),
  );

  const rows: SvodRow[] = compRows.map((c) => {
    const dept = text(c.dept);
    const b = bookByDept.get(dept) ?? {};
    const cb = rec(c.book);
    const cp = rec(c.product);
    return {
      dept,
      sheet: '',
      bookLabel: text(c.svodName),
      book: {
        count: num(cb.count),
        nmck: num(cb.nmck),
        price: num(cb.price),
        savingsTotal: num(cb.savingsTotal),
        mb: num(b.savingsMb),
        kb: num(b.savingsKb),
        fb: num(b.savingsFb),
      },
      product: {
        count: num(cp.count),
        nmck: num(cp.nmck),
        price: num(cp.price),
        savingsTotal: num(cp.savingsTotal),
        mb: null,
        kb: null,
        fb: null,
      },
      budgetGap: num(b.controlGapRub),
      divergenceNote: str(c.explanation),
    };
  });

  const bt = rec(book.total);
  const pt = rec(comparison.productTotals);
  const total: SvodRow = {
    dept: 'total',
    sheet: '',
    bookLabel: text(bt.svodName) || 'Итого:',
    book: {
      count: num(bt.count),
      nmck: num(bt.nmck),
      price: num(bt.price),
      savingsTotal: num(bt.savingsTotal),
      mb: num(bt.savingsMb),
      kb: num(bt.savingsKb),
      fb: num(bt.savingsFb),
    },
    product: {
      count: num(pt.count),
      nmck: num(pt.nmck),
      price: num(pt.price),
      savingsTotal: num(pt.savingsTotal),
      mb: null,
      kb: null,
      fb: null,
    },
    budgetGap: num(bt.controlGapRub),
    divergenceNote: null,
  };

  const notes: string[] = [];
  const authorNote = str(book.authorNote);
  if (authorNote !== null) notes.push(authorNote);
  return { rows, total, notes };
}

function readJournal(raw: unknown): JournalPayload | null {
  if (raw === null || raw === undefined) return null;
  const r = rec(raw);
  const rows = arr(r.rows).map((x): JournalRow => {
    const j = rec(x);
    return {
      row: count(j.row),
      fate: str(j.fate),
      fateRaw: str(j.fateRaw),
      linkedCode: str(j.linkedCode),
      customer: text(j.customer),
      code: str(j.code),
      subject: text(j.subject),
      nmck: num(j.nmck),
      applicationDate: str(j.applicationDate),
      publicationDate: str(j.publicationDate),
      deadlineDate: str(j.deadlineDate),
      resultDate: str(j.resultDate),
      auctionPrice: num(j.auctionPrice),
      savingsTotal: num(j.savingsTotal),
      savingsMb: num(j.savingsMb),
      savingsKb: num(j.savingsKb),
      savingsFb: num(j.savingsFb),
      winnerName: str(j.winnerName),
      winnerInn: str(j.winnerInn),
      outcome: str(j.outcome),
      hiddenInBook: bool(j.hiddenInBook),
      outsideFilter: bool(j.outsideFilter),
    };
  });
  // Прочитанный, но пустой лист — НЕ «сервер лист не отдаёт» (п.36, три рода
  // пустоты). Схлопывая ноль строк в null, маппер отправлял читателя чинить
  // трубу чтения там, где чинить нечего: лист прочитан, и это ответ. Пустой
  // раздел доезжает до экрана как есть, а словами о нём говорит вкладка.
  const lineage = arr(r.lineage).map((x): LineageChain => {
    const l = rec(x);
    return { codes: strList(l.codes), notes: strList(l.notes) };
  });
  return { rows, lineage, notes: strList(r.notes) };
}

function readDirectory(raw: unknown): DirectoryPayload | null {
  if (raw === null || raw === undefined) return null;
  const r = rec(raw);
  // Сервер называет строки справочника entries (с полями ordinal/shortIsFull/
  // usageCount), написания вне справочника — customersOutside. До 20.08 маппер
  // ждал rows/unmatchedCustomers — живой справочник превращался в null.
  if (r.entries !== undefined) {
    const entries = arr(r.entries).map((x): DirectoryRow => {
      const d = rec(x);
      return {
        num: num(d.ordinal) === null ? null : String(num(d.ordinal)),
        grbs: str(d.grbs),
        fullName: str(d.fullName),
        shortName: str(d.shortName),
        shortMissing: bool(d.shortIsFull),
        usedInBook: num(d.usageCount),
      };
    });
  // Прочитанный, но пустой лист — НЕ «сервер лист не отдаёт» (п.36, три рода
  // пустоты). Схлопывая ноль строк в null, маппер отправлял читателя чинить
  // трубу чтения там, где чинить нечего: лист прочитан, и это ответ. Пустой
  // раздел доезжает до экрана как есть, а словами о нём говорит вкладка.
    const outside = arr(r.customersOutside).map((x) => {
      const u = rec(x);
      return { name: text(u.name), count: count(u.count) };
    }).filter((u) => u.name !== '');
    return { rows: entries, unmatchedCustomers: outside, notes: strList(r.notes) };
  }
  const rows = arr(r.rows).map((x): DirectoryRow => {
    const d = rec(x);
    const full = str(d.fullName);
    const short = str(d.shortName);
    return {
      num: str(d.num),
      grbs: str(d.grbs),
      fullName: full,
      shortName: short,
      // Сервер может пометить сам; не пометил — сравниваем строки здесь, чтобы
      // «сокращение», дословно равное полному имени, не притворялось коротким.
      shortMissing: d.shortMissing === undefined
        ? full !== null && short !== null && full === short
        : bool(d.shortMissing),
      usedInBook: num(d.usedInBook),
    };
  });
  // Прочитанный, но пустой лист — НЕ «сервер лист не отдаёт» (п.36, три рода
  // пустоты). Схлопывая ноль строк в null, маппер отправлял читателя чинить
  // трубу чтения там, где чинить нечего: лист прочитан, и это ответ. Пустой
  // раздел доезжает до экрана как есть, а словами о нём говорит вкладка.
  const unmatched = arr(r.unmatchedCustomers).map((x) => {
    const u = rec(x);
    return { name: text(u.name), count: count(u.count) };
  }).filter((u) => u.name !== '');
  return { rows, unmatchedCustomers: unmatched, notes: strList(r.notes) };
}

/**
 * Адреса сигнала: ядро отдаёт их объектами {address, note}, старые ответы —
 * строками. Строковая форма для экрана: «адрес — что там увидено». Раньше
 * strList молча выбрасывал объекты, и адреса сигналов не доезжали до экрана
 * вовсе — сигнал оставался без половины карточки диагноста (п.53).
 */
function readSignalAddresses(raw: unknown): string[] {
  return arr(raw)
    .map((a) => {
      const asString = str(a);
      if (asString !== null) return asString;
      const o = rec(a);
      const address = text(o.address);
      if (address === '') return null;
      const note = text(o.note);
      return note === '' ? address : `${address} — ${note}`;
    })
    .filter((s): s is string => s !== null);
}

function readSignals(raw: unknown): MonitoringSignal[] | null {
  if (raw === null || raw === undefined) return null;
  const list = arr(raw).map((x): MonitoringSignal => {
    const s = rec(x);
    const addresses = readSignalAddresses(s.addresses);
    return {
      id: text(s.id),
      title: text(s.title),
      severity: text(s.severity) || 'medium',
      mechanism: text(s.mechanism),
      action: text(s.action),
      count: num(s.count) ?? addresses.length,
      addresses,
    };
  }).filter((s) => s.title !== '');
  return list.length > 0 ? list : null;
}

// ── Сборка ответа ────────────────────────────────────────────────────

export function normalizeMonitoring(raw: unknown): MonitoringPayload {
  const r = rec(raw);
  const src = rec(r.source);
  return {
    source: {
      bookName: str(src.bookName) ?? 'Ежедневный мониторинг',
      readAt: text(src.readAt),
      moneyUnit: str(src.moneyUnit) ?? 'руб',
      sheetsRead: strList(src.sheetsRead),
      sheetsFailed: recordOfStrings(src.sheetsFailed),
      sheetsExpected: num(src.sheetsExpected),
    },
    procedures: arr(r.procedures).map(readProcedure),
    aggregates: readAggregates(r.aggregates),
    unparsedCodes: arr(r.unparsedCodes).map((x) => {
      const u = rec(x);
      return {
        sheet: text(u.sheet),
        row: count(u.row),
        text: text(u.text),
        guess: str(u.guess),
        note: str(u.note),
      };
    }),
    svod: readSvod(r.svod),
    journal: readJournal(r.journal),
    directory: readDirectory(r.directory),
    signals: readSignals(r.signals),
    ancestors: readAncestors(r.ancestors),
    notes: strList(r.notes),
  };
}

// ── Запросы ──────────────────────────────────────────────────────────

/** Реестр и всё, что сервер к нему приложил; refresh — мимо кэша книги. */
export async function fetchMonitoring(refresh = false): Promise<MonitoringPayload> {
  const raw = await fetchJSON<unknown>(`/monitoring${refresh ? '?refresh=true' : ''}`);
  return normalizeMonitoring(raw);
}

// ── Форма листов-предков (§2.5): память о полях, а не данные ─────────

/**
 * Семнадцать колонок шапки скрытых листов «Отчет по процедурам Свод» и «СВОД».
 * Данных на этих листах ноль, поэтому форма живёт константой: показать её —
 * значит показать, каких полей нынешней рабочей форме не хватает.
 */
export const ANCESTOR_SHEET_COLUMNS: readonly string[] = [
  '№ п/п',
  'Наименование муниципальной программы',
  'Общий объём ассигнований, с учётом тек. деятельности (М.б., К.б., Ф.б.)',
  'Остаток не принятых (свободных) бюджетных обязательств',
  'Заказчик',
  'Наименование объекта закупки',
  'Начальная (максимальная) цена',
  'Дата поступления заявки в УО',
  'Дата публикации',
  'Статус',
  'Дата окончания подачи заявок',
  'Дата окончания срока рассмотрения заявок',
  'Дата проведения торгов/переторжки',
  'Кол-во заявок от поставщиков',
  'Цена аукциона',
  'Экономия',
  'Победитель',
];

/**
 * Имена скрытых листов-предков — ЗАПАСНОЙ список на случай, когда сервер их не
 * назвал. Правда о предках живёт в ядре (`MONITORING_ANCESTOR_SHEETS`, три
 * листа: «Отчет по процедурам Свод», «СВОД», «ГРБС») и приезжает разделом
 * `ancestors` ответа. Копия на клиенте была третьим листом короче — экран
 * писал «3 листа скрыты» только благодаря «+1» в формуле полосы состояния,
 * а называл два. Копия остаётся запасом, а не источником.
 */
export const ANCESTOR_SHEET_NAMES: readonly string[] = [
  'Отчет по процедурам Свод', 'СВОД', 'ГРБС',
];

/** Лист-предок, как его называет ядро: имя, род и что на нём есть. */
export interface AncestorSheet {
  sheet: string;
  /** 'form' — только шапка; 'copy' — копия другого листа. */
  kind: string;
  note: string;
  header: string[];
}

export interface AncestorsPayload {
  sheets: AncestorSheet[];
  missingFields: string[];
}

function readAncestors(raw: unknown): AncestorsPayload | null {
  if (raw === null || raw === undefined) return null;
  const r = rec(raw);
  const sheets = arr(r.sheets).map((x): AncestorSheet => {
    const s = rec(x);
    return {
      sheet: text(s.sheet),
      kind: str(s.kind) ?? 'form',
      note: text(s.note),
      header: strList(s.header),
    };
  }).filter((s) => s.sheet !== '');
  if (sheets.length === 0) return null;
  return { sheets, missingFields: strList(r.missingFields) };
}

/**
 * Поля, которых рабочей форме книги не хватает, и что каждое дало бы продукту.
 * Это и есть содержание режима «Листы-предки»: разговор с владельцем о том,
 * что вернуть в книгу, ведётся по этому списку.
 */
export const ANCESTOR_MISSING_FIELDS: ReadonlyArray<{ field: string; whatItGives: string }> = [
  {
    field: 'Статус',
    whatItGives:
      'Сегодня статус растворён в колонке номера листа «25-26» и существует у 53 строк из 391. '
      + 'Отдельным полем он стал бы разрезом, а не вычиткой из текста.',
  },
  {
    field: 'Дата окончания срока рассмотрения заявок',
    whatItGives:
      'Этап есть в жизни, поля в книге нет: воронка из-за этого пятиступенчатая вместо '
      + 'шестиступенчатой, а рассмотрение заявок спрятано внутри промежутка до торгов.',
  },
  {
    field: 'Кол-во заявок от поставщиков',
    whatItGives:
      'Единственная величина, которой конкуренцию можно измерить прямо. Без неё «не состоялся, '
      + 'ноль заявок» приходится вычитывать из текста колонки победителя.',
  },
  {
    field: 'Наименование муниципальной программы',
    whatItGives: 'Разрез «по программе» — тот, которого ждёт начальство; сегодня его собрать не из чего.',
  },
  {
    field: 'Общий объём ассигнований',
    whatItGives: 'Позволил бы соотнести НМЦК процедуры с деньгами, которые под неё выделены.',
  },
  {
    field: 'Остаток не принятых (свободных) бюджетных обязательств',
    whatItGives: 'Показал бы, сколько денег ещё не законтрактовано, прямо в реестре процедур.',
  },
];
