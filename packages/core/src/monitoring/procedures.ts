/**
 * procedures.ts — восемь листов управлений книги «Ежедневный мониторинг»
 * (канон п.69в: отдельная вкладка; п.101а: «Реестр процедур определения
 * поставщика», перенос всех листов книги, своя аналитика и свои сигналы).
 *
 * Спека: docs/superpowers/specs/2026-08-18-monitoring-tab-spec-v2.md §1.1.
 * Раскладка колонок сверена по полному дампу всех 374 строк восьми листов.
 *
 * ТОНКОСТЬ ШАПКИ, на которой споткнулась первая версия вкладки: подпись
 * «Экономия, руб.» стоит в L1 и служит надшапкой ГРУППЫ J:N, а не именем
 * колонки L. Настоящие имена читаются во второй строке: J — ВСЕГО,
 * K — контроль, L/M/N — разбивка ЭКОНОМИИ по МБ/КБ/ФБ (не НМЦК!).
 *
 * Правила чтения:
 *  - деньги книги — РУБЛИ (книги ГРБС — тысячи, множитель обязателен);
 *  - стадия выводится ЧИСЛОВЫМИ предикатами по цене и датам, не текстом
 *    колонки «Победитель» (канон п.27: свободный текст — не источник
 *    статусов; разбор победителя даёт поля для показа, не стадию);
 *  - код процедуры разбирается парсером @aemr/shared; искажённый код НЕ
 *    чинится молча — строка остаётся в реестре без кода, адрес поднимается
 *    сигналом (спека §5, пять паттернов искажений);
 *  - дефекты ячейки (сумма текстом, пробел вместо числа, нечитаемая дата,
 *    экономия внесена вручную) становятся признаками строки с адресом, а не
 *    поводом выбросить строку.
 */

import { explainDistortedCode, extractProcedureRefs, type ProcedureFamily } from '@aemr/shared';
import {
  cellAddress,
  daysBetween,
  isBlankTextCell,
  isBrokenDate,
  isTextNumber,
  monitoringDate,
  monitoringNumber,
  monitoringText,
  round3,
  type MonitoringDate,
} from './cells.js';
import { parseWinnerCell, type ParsedWinner } from './winner.js';

export { monitoringNumber } from './cells.js';

// ── Карта листов ─────────────────────────────────────────────────────

/**
 * Восемь листов управлений книги мониторинга → канонические ид ГРБС продукта.
 * Имена листов в книге («4. УАГиЗО», «5. УДТХиРКИ») отличаются и от коротких
 * имён реестра управлений (УАГЗО, УДТХ), и от написаний на своде («УАГЗО
 * АЕМР») — связывать надо явной таблицей, а не подстрокой (спека §1.2).
 */
export const MONITORING_DEPT_SHEETS: ReadonlyArray<{ sheet: string; dept: string }> = [
  { sheet: '1. УЭР', dept: 'УЭР' },
  { sheet: '2. УКСиМП', dept: 'УКСиМП' },
  { sheet: '3. УИО', dept: 'УИО' },
  { sheet: '4. УАГиЗО', dept: 'УАГЗО' },
  { sheet: '5. УДТХиРКИ', dept: 'УДТХ' },
  { sheet: '6. УД', dept: 'УД' },
  { sheet: '7. УФБП', dept: 'УФБП' },
  { sheet: '8. УО', dept: 'УО' },
];

/** Лист СВОДНЫЙ книги. */
export const MONITORING_SVOD_SHEET = 'СВОДНЫЙ';
/** Переходящий реестр двух лет с родословной процедур. */
export const MONITORING_JOURNAL_SHEET = '25-26';
/** Справочник учреждений района. */
export const MONITORING_DIRECTORY_SHEET = 'Перечень ГРБС';

/** Все листы книги, которые продукт читает данными (одиннадцать видимых). */
export const MONITORING_DATA_SHEETS: readonly string[] = [
  ...MONITORING_DEPT_SHEETS.map(({ sheet }) => sheet),
  MONITORING_SVOD_SHEET,
  MONITORING_JOURNAL_SHEET,
  MONITORING_DIRECTORY_SHEET,
];

// ── Стадии ───────────────────────────────────────────────────────────

/**
 * Стадия процедуры — по числовым предикатам (п.27), пять ступеней:
 *  - awarded: цена аукциона больше нуля — договор заключён;
 *  - no_result: цена аукциона равна нулю — торги без результата (21 строка);
 *  - bidding: цены нет, но дата торгов уже стоит — торги прошли, итог не внесён;
 *  - published: цены и торгов нет, есть дата публикации — процедура объявлена;
 *  - application: нет ничего из перечисленного — заявка ждёт объявления.
 */
export type ProcedureStage = 'application' | 'published' | 'bidding' | 'awarded' | 'no_result';

/** Порядок ступеней пути — ось воронки. */
export const PROCEDURE_STAGE_ORDER: readonly ProcedureStage[] = [
  'application', 'published', 'bidding', 'awarded', 'no_result',
];

/** Подписи стадий для читателя — литературный русский, без ключей. */
export const PROCEDURE_STAGE_LABELS: Record<ProcedureStage, string> = {
  application: 'Заявка в уполномоченном органе',
  published: 'Объявлена, итога нет',
  bidding: 'Торги прошли, итог не внесён',
  awarded: 'Договор заключён',
  no_result: 'Без результата',
};

/** Стадия по числовым предикатам — см. комментарий к ProcedureStage. */
export function procedureStage(
  auctionPrice: number | null,
  publicationIso: string | null,
  auctionIso: string | null = null,
): ProcedureStage {
  if (auctionPrice !== null && auctionPrice > 0) return 'awarded';
  if (auctionPrice !== null && auctionPrice === 0) return 'no_result';
  if (auctionIso !== null) return 'bidding';
  return publicationIso !== null ? 'published' : 'application';
}

// ── Дефекты строки ───────────────────────────────────────────────────

/**
 * Классы дефектов ячеек — закрытый словарь (спека §5). Каждый дефект несёт
 * адрес ячейки: карточка диагноста без адреса бесполезна (п.53).
 */
export type MonitoringDefectKind =
  /** Сумма записана текстом: на экране число, для СУММ — нет (свод занижен). */
  | 'text-number'
  /** Ячейка хранит пробел: выглядит пустой, ломает контроль разбивки. */
  | 'blank-space'
  /** Дата не читается: «23.062026», «03.06.25026». */
  | 'broken-date'
  /** Код процедуры искажён либо отсутствует — связь с книгами ГРБС порвана. */
  | 'broken-code'
  /** Экономия разошлась с формулой ОКРУГЛ(D−I;3) — число внесено руками. */
  | 'manual-savings'
  /** Контроль книги показывает «ошибка»: экономия не расписана по бюджетам. */
  | 'control-error'
  /** Цена и экономия пусты, контроль сравнивает ноль с нулём и молчит. */
  | 'false-calm'
  /** Этап пути пропущен: торги есть, публикации либо окончания подачи нет. */
  | 'missing-stage'
  /** Длительность этапа отрицательна: торги раньше публикации. */
  | 'negative-duration';

export interface MonitoringDefect {
  readonly kind: MonitoringDefectKind;
  /** «5. УДТХиРКИ!D34» — адрес, по которому ячейку найдут глазами. */
  readonly address: string;
  /** Что именно увидено, одной фразой без упрёка (п.104). */
  readonly note: string;
}

// ── Строка реестра ───────────────────────────────────────────────────

export interface MonitoringProcedure {
  /** Имя листа книги — первая половина адреса (п.53). */
  readonly sheet: string;
  /** Номер строки листа (1-based, как в Sheets) — вторая половина адреса. */
  readonly row: number;
  /** Колонка A «№ п/п»: в УО нумерация 1…27 идёт дважды, поэтому адрес двойной. */
  readonly ordinal: number | null;
  /** Канонический ид ГРБС продукта (УЭР, УО, …). */
  readonly dept: string;
  /** Заказчик (колонка B) — учреждение либо признак совместной закупки. */
  readonly customer: string;
  /** Заказчик, приведённый к сравнимому виду НАШЕЙ нормализацией (не книги). */
  readonly customerNormalized: string;
  /** Канонический код процедуры («ЭА152-26») либо null — код не разобран. */
  readonly code: string | null;
  /**
   * Объяснение нечитаемого кода: «в книге „ЭКЗ301-26“ — похоже на ЭЗК301-26
   * (буквы переставлены местами)». null — код разобран либо кода в ячейке
   * не видно вовсе. Догадка только показывается, мост по ней не строится.
   */
  readonly codeNote: string | null;
  /** Способ определения поставщика из префикса кода: ЭА / ЭАС / ЭЗК / ЭЕП. */
  readonly method: ProcedureFamily | null;
  /** Год нумерации процедуры из суффикса кода (25, 26) — книга переходящая. */
  readonly year: number | null;
  /** Предмет закупки: колонка C без кода; кода нет — колонка C целиком. */
  readonly subject: string;
  /** НМЦК, руб. (колонка D). */
  readonly nmck: number | null;
  /** Даты пути: заявка, публикация, окончание подачи, торги. */
  readonly applicationDate: MonitoringDate | null;
  readonly publicationDate: MonitoringDate | null;
  readonly deadlineDate: MonitoringDate | null;
  readonly auctionDate: MonitoringDate | null;
  /** Цена аукциона, руб.; 0 — торги без результата; null — итога нет. */
  readonly auctionPrice: number | null;
  /** Экономия ВСЕГО, руб. (колонка J) — как записано в книге. */
  readonly savingsTotal: number | null;
  /** Экономия по бюджетам, руб. (колонки L, M, N) — разбивка ЭКОНОМИИ. */
  readonly savingsMb: number | null;
  readonly savingsKb: number | null;
  readonly savingsFb: number | null;
  /** Сумма разбивки МБ+КБ+ФБ, руб.; null — ни одна доля не заполнена. */
  readonly savingsSplitSum: number | null;
  /** Самопроверка книги (колонка K): «верно» / «ошибка» / null. */
  readonly selfCheck: string | null;
  /** Наш пересчёт контроля: ВСЕГО = МБ+КБ+ФБ; null — сравнивать нечего. */
  readonly controlAgrees: boolean | null;
  /** Разрыв ВСЕГО − (МБ+КБ+ФБ), руб.; null — сравнивать нечего. */
  readonly controlGapRub: number | null;
  /** Победитель (колонка O), разобранный на имя, ИНН и исход. */
  readonly winner: ParsedWinner;
  /** Комментарий (колонка P) — заполнен шесть раз на всю книгу. */
  readonly comment: string | null;
  readonly stage: ProcedureStage;
  /** Снижение на торгах, руб.: НМЦК − цена (только для состоявшихся). */
  readonly reductionRub: number | null;
  /** Снижение на торгах, % от НМЦК (только для состоявшихся с НМЦК > 0). */
  readonly reductionPct: number | null;
  /** Совместная закупка: способ ЭАС либо заказчик-признак «Совместный …». */
  readonly joint: boolean;
  /** Сроки этапов пути, календарных дней; null — одной из дат нет. */
  readonly durations: ProcedureDurations;
  /** Дефекты ячеек этой строки с адресами (спека §5). */
  readonly defects: readonly MonitoringDefect[];
}

/** Сроки четырёх этапов пути процедуры, календарных дней. */
export interface ProcedureDurations {
  /** Заявка → публикация. */
  readonly toPublication: number | null;
  /** Публикация → окончание подачи заявок. */
  readonly toDeadline: number | null;
  /** Окончание подачи → торги. */
  readonly toAuction: number | null;
  /** Заявка → торги: весь путь. */
  readonly total: number | null;
}

/** Адрес строки, чей код процедуры не разобрался, — сигнал, не потеря. */
export interface UnparsedCodeRef {
  readonly sheet: string;
  readonly row: number;
  /** Начало колонки C — чтобы виновницу можно было найти глазами. */
  readonly text: string;
  /** Каноническая догадка («ЭЗК301-26»); null — кода в ячейке не видно. */
  readonly guess: string | null;
  /** В чём искажение («буквы переставлены местами»); null — кода не видно. */
  readonly note: string | null;
}

export interface MonitoringRegistry {
  readonly procedures: MonitoringProcedure[];
  /** Строки с нераспознанным кодом: спека §5 — пять паттернов искажений. */
  readonly unparsedCodes: UnparsedCodeRef[];
}

// ── Раскладка листа управления ───────────────────────────────────────

/** Шапка листа управления — две строки, данные со строки 3 (спека §1.1). */
const HEADER_ROWS = 2;

/**
 * Колонки листа управления (0-based):
 * A №, B заказчик, C код+предмет, D НМЦК, E–H даты, I цена,
 * J экономия ВСЕГО, K контроль, L/M/N разбивка ЭКОНОМИИ, O победитель,
 * P комментарий.
 */
export const MONITORING_DEPT_COLUMNS = {
  ORDINAL: 0,
  CUSTOMER: 1,
  SUBJECT: 2,
  NMCK: 3,
  APPLICATION: 4,
  PUBLICATION: 5,
  DEADLINE: 6,
  AUCTION: 7,
  PRICE: 8,
  SAVINGS_TOTAL: 9,
  SELF_CHECK: 10,
  SAVINGS_MB: 11,
  SAVINGS_KB: 12,
  SAVINGS_FB: 13,
  WINNER: 14,
  COMMENT: 15,
} as const;

/** Дословные подписи второй строки шапки — страж против сдвига колонки. */
export const MONITORING_DEPT_HEADER_LABELS: Readonly<Record<string, string>> = {
  ORDINAL: '№ п/п',
  CUSTOMER: 'Заказчик',
  SUBJECT: 'Наименование объекта закупки',
  NMCK: 'Начальная (максимальная) цена, руб.',
  APPLICATION: 'Дата поступления заявки в УО',
  PUBLICATION: 'Дата публикации',
  DEADLINE: 'Дата окончания подачи заявок',
  AUCTION: 'Дата проведения торгов/переторжки',
  PRICE: 'Цена аукциона, руб.',
  SAVINGS_TOTAL: 'ВСЕГО',
  SELF_CHECK: 'Проверка данных\nсумма ВСЕГО и МБ+КБ+ФБ',
  SAVINGS_MB: 'МБ',
  SAVINGS_KB: 'КБ',
  SAVINGS_FB: 'ФБ',
  WINNER: 'Победитель',
  COMMENT: 'Комментарий',
};

/** Заказчик к сравнимому виду — НАША нормализация, о чём экран говорит вслух. */
export function normalizeCustomer(name: string): string {
  return name
    .toLowerCase()
    .replace(/ё/gu, 'е')
    .replace(/[«»"'`„“”]/gu, '')
    .replace(/[.,№]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

/** Сумма долей бюджетов: null, если не заполнена ни одна. */
function splitSum(mb: number | null, kb: number | null, fb: number | null): number | null {
  if (mb === null && kb === null && fb === null) return null;
  return round3((mb ?? 0) + (kb ?? 0) + (fb ?? 0));
}

/**
 * Собрать реестр процедур из гридов листов управлений.
 *
 * @param sheets — грид каждого прочитанного листа книги (имя листа → строки);
 *   непрочитанные листы просто отсутствуют — честность неполноты объявляет
 *   вызывающий код, здесь ряды не выдумываются.
 */
export function parseMonitoringProcedures(
  sheets: Readonly<Record<string, unknown[][]>>,
): MonitoringRegistry {
  const procedures: MonitoringProcedure[] = [];
  const unparsedCodes: UnparsedCodeRef[] = [];

  for (const { sheet, dept } of MONITORING_DEPT_SHEETS) {
    const grid = sheets[sheet];
    if (!grid) continue;

    for (let i = HEADER_ROWS; i < grid.length; i++) {
      const raw = grid[i] ?? [];
      const customer = monitoringText(raw[MONITORING_DEPT_COLUMNS.CUSTOMER]);
      const subjectCell = monitoringText(raw[MONITORING_DEPT_COLUMNS.SUBJECT]);
      // Строка без заказчика и предмета — хвост листа, не данные.
      if (customer === null && subjectCell === null) continue;

      procedures.push(parseDeptRow({ sheet, dept, row: i + 1, raw, customer, subjectCell, unparsedCodes }));
    }
  }

  return { procedures, unparsedCodes };
}

interface DeptRowInput {
  sheet: string;
  dept: string;
  row: number;
  raw: unknown[];
  customer: string | null;
  subjectCell: string | null;
  unparsedCodes: UnparsedCodeRef[];
}

function parseDeptRow(input: DeptRowInput): MonitoringProcedure {
  const { sheet, dept, row, raw, customer, subjectCell, unparsedCodes } = input;
  const C = MONITORING_DEPT_COLUMNS;
  const defects: MonitoringDefect[] = [];

  const refs = extractProcedureRefs(subjectCell);
  const ref = refs.length > 0 ? refs[0] : null;
  let codeNote: string | null = null;
  if (ref === null && subjectCell !== null) {
    // Два честных случая вместо одного лживого «без кода» (скриншот
    // владельца 20.08.2026): код в ячейке ЕСТЬ, но искажён опечаткой, —
    // либо кода в ячейке действительно не видно. Догадка показывается
    // человеку; сверка и мост по ней не строятся.
    const distorted = explainDistortedCode(subjectCell);
    codeNote = distorted !== null
      ? `В книге записано «${distorted.raw}» — похоже на ${distorted.guess} (${distorted.note}).`
      : 'В начале предмета номера процедуры не видно.';
    unparsedCodes.push({
      sheet,
      row,
      text: subjectCell.slice(0, 80),
      guess: distorted?.guess ?? null,
      note: distorted?.note ?? null,
    });
    defects.push({
      kind: 'broken-code',
      address: cellAddress(sheet, row, C.SUBJECT),
      note: distorted !== null
        ? `Код записан с опечаткой: «${distorted.raw}» — похоже на ${distorted.guess} (${distorted.note}). Пока код не исправлен в книге, связь с книгами ГРБС по этой строке не строится.`
        : 'В начале предмета номера процедуры не видно — связь с книгами ГРБС по этой строке не строится.',
    });
  }

  // Предмет — колонка C без найденного кода в начале строки.
  let subject = subjectCell ?? '';
  if (ref !== null) {
    const head = /^\s*\S+\s+/u.exec(subject);
    if (head && extractProcedureRefs(head[0]).length > 0) subject = subject.slice(head[0].length).trim();
  }

  const nmck = monitoringNumber(raw[C.NMCK]);
  if (isTextNumber(raw[C.NMCK])) {
    defects.push({
      kind: 'text-number',
      address: cellAddress(sheet, row, C.NMCK),
      note: 'Начальная цена хранится текстом: на экране это число, но формула СУММ его не видит и свод занижен.',
    });
  }
  const auctionPrice = monitoringNumber(raw[C.PRICE]);
  if (isTextNumber(raw[C.PRICE])) {
    defects.push({
      kind: 'text-number',
      address: cellAddress(sheet, row, C.PRICE),
      note: 'Цена аукциона хранится текстом: формула СУММ её не видит.',
    });
  }

  const applicationDate = monitoringDate(raw[C.APPLICATION]);
  const publicationDate = monitoringDate(raw[C.PUBLICATION]);
  const deadlineDate = monitoringDate(raw[C.DEADLINE]);
  const auctionDate = monitoringDate(raw[C.AUCTION]);
  for (const [date, col, label] of [
    [applicationDate, C.APPLICATION, 'поступления заявки'],
    [publicationDate, C.PUBLICATION, 'публикации'],
    [deadlineDate, C.DEADLINE, 'окончания подачи заявок'],
    [auctionDate, C.AUCTION, 'проведения торгов'],
  ] as const) {
    if (isBrokenDate(date)) {
      defects.push({
        kind: 'broken-date',
        address: cellAddress(sheet, row, col),
        note: `Дата ${label} записана так, что датой не читается («${date?.raw ?? ''}») — строка выпадает из отбора по периоду и из расчёта сроков.`,
      });
    }
  }

  const savingsTotal = monitoringNumber(raw[C.SAVINGS_TOTAL]);
  const savingsMb = monitoringNumber(raw[C.SAVINGS_MB]);
  const savingsKb = monitoringNumber(raw[C.SAVINGS_KB]);
  const savingsFb = monitoringNumber(raw[C.SAVINGS_FB]);
  for (const [col, name] of [
    [C.SAVINGS_MB, 'МБ'], [C.SAVINGS_KB, 'КБ'], [C.SAVINGS_FB, 'ФБ'],
  ] as const) {
    if (isBlankTextCell(raw[col])) {
      defects.push({
        kind: 'blank-space',
        address: cellAddress(sheet, row, col),
        note: `Доля ${name} выглядит пустой, но хранит пробел — контроль книги на этой строке считает не то, что видно.`,
      });
    }
  }

  const savingsSplitSum = splitSum(savingsMb, savingsKb, savingsFb);
  const controlGapRub = savingsTotal !== null && savingsSplitSum !== null
    ? round3(savingsTotal - savingsSplitSum)
    : null;
  const controlAgrees = controlGapRub === null ? null : Math.abs(controlGapRub) < 0.005;

  const selfCheck = monitoringText(raw[C.SELF_CHECK]);
  if (selfCheck !== null && selfCheck.toLowerCase() === 'ошибка') {
    defects.push({
      kind: 'control-error',
      address: cellAddress(sheet, row, C.SELF_CHECK),
      note: controlGapRub === null
        ? 'Контроль книги показывает «ошибка»: экономия не расписана по бюджетам.'
        : `Экономия не расписана по бюджетам: ВСЕГО и МБ+КБ+ФБ расходятся на ${formatRub(controlGapRub)}.`,
    });
  }

  // Экономия внесена вручную: формула книги считает ОКРУГЛ(D−I;3), поэтому
  // расхождение с этим числом означает, что связь с исходными ячейками
  // разорвана (при изменении НМЦК экономия не пересчитается). Не ошибка
  // заполнения — состояние формулы (п.104).
  const savingsExpected = nmck !== null && auctionPrice !== null ? round3(nmck - auctionPrice) : null;
  if (savingsTotal !== null && savingsExpected !== null && Math.abs(savingsTotal - savingsExpected) >= 0.005) {
    defects.push({
      kind: 'manual-savings',
      address: cellAddress(sheet, row, C.SAVINGS_TOTAL),
      note: `Экономия внесена вручную: формула дала бы ${formatRub(savingsExpected)}, в книге стоит ${formatRub(savingsTotal)} — при изменении начальной цены число не пересчитается.`,
    });
  } else if (savingsTotal === 0 && nmck !== null && nmck > 0 && auctionPrice === null) {
    defects.push({
      kind: 'manual-savings',
      address: cellAddress(sheet, row, C.SAVINGS_TOTAL),
      note: 'Экономия внесена вручную нулём при незаполненной цене аукциона — формула на этой строке разорвана.',
    });
  }

  // Ложно-успокаивающая строка: цены и экономии нет, контроль сравнивает
  // ноль с нулём и показывает зелёное «верно» (спека §5, живой адрес 6. УД!K91).
  if (
    auctionPrice === null && savingsTotal === null && nmck !== null && nmck > 0
    && selfCheck !== null && selfCheck.toLowerCase() === 'верно'
  ) {
    defects.push({
      kind: 'false-calm',
      address: cellAddress(sheet, row, C.SELF_CHECK),
      note: 'Цена и экономия не заполнены, контроль сравнивает ноль с нулём и показывает «верно» — незавершённая процедура выглядит проверенной.',
    });
  }

  const durations: ProcedureDurations = {
    toPublication: daysBetween(applicationDate?.iso ?? null, publicationDate?.iso ?? null),
    toDeadline: daysBetween(publicationDate?.iso ?? null, deadlineDate?.iso ?? null),
    toAuction: daysBetween(deadlineDate?.iso ?? null, auctionDate?.iso ?? null),
    total: daysBetween(applicationDate?.iso ?? null, auctionDate?.iso ?? null),
  };
  for (const [value, label] of [
    [durations.toPublication, 'от заявки до публикации'],
    [durations.toDeadline, 'от публикации до окончания подачи'],
    [durations.toAuction, 'от окончания подачи до торгов'],
  ] as const) {
    if (value !== null && value < 0) {
      defects.push({
        kind: 'negative-duration',
        address: cellAddress(sheet, row, C.APPLICATION),
        note: `Этап ${label} длится ${value} дней — одна из дат набрана с ошибкой.`,
      });
    }
  }

  // Пропущенный этап: торги есть, а публикации либо окончания подачи нет.
  if (auctionDate?.iso != null) {
    if (publicationDate === null) {
      defects.push({
        kind: 'missing-stage',
        address: cellAddress(sheet, row, C.PUBLICATION),
        note: 'Дата торгов есть, даты публикации нет — путь процедуры неполон.',
      });
    }
    if (deadlineDate === null) {
      defects.push({
        kind: 'missing-stage',
        address: cellAddress(sheet, row, C.DEADLINE),
        note: 'Дата торгов есть, даты окончания подачи заявок нет — путь процедуры неполон.',
      });
    }
  }

  const stage = procedureStage(auctionPrice, publicationDate?.iso ?? null, auctionDate?.iso ?? null);
  const reductionRub = stage === 'awarded' && nmck !== null && auctionPrice !== null
    ? round3(nmck - auctionPrice)
    : null;
  const reductionPct = reductionRub !== null && nmck !== null && nmck > 0
    ? (reductionRub / nmck) * 100
    : null;

  const customerText = customer ?? '';
  return {
    sheet,
    row,
    ordinal: monitoringNumber(raw[C.ORDINAL]),
    dept,
    customer: customerText,
    customerNormalized: normalizeCustomer(customerText),
    code: ref?.code ?? null,
    codeNote,
    method: ref?.family ?? null,
    year: ref?.yy ?? null,
    subject,
    nmck,
    applicationDate,
    publicationDate,
    deadlineDate,
    auctionDate,
    auctionPrice,
    savingsTotal,
    savingsMb,
    savingsKb,
    savingsFb,
    savingsSplitSum,
    selfCheck,
    controlAgrees,
    controlGapRub,
    winner: parseWinnerCell(raw[C.WINNER]),
    comment: monitoringText(raw[C.COMMENT]),
    stage,
    reductionRub,
    reductionPct,
    joint: ref?.family === 'ЭАС' || /совместн/iu.test(customerText),
    durations,
    defects,
  };
}

/** Рубли словами подписи — короткая форма для текста сигнала. */
function formatRub(value: number): string {
  return `${value.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} руб.`;
}

// ── Агрегаты ─────────────────────────────────────────────────────────

export interface MonitoringAggregates {
  /** Всего строк-процедур на прочитанных листах. */
  readonly total: number;
  readonly byStage: Record<ProcedureStage, number>;
  /** Разрез по способу определения поставщика (ЭА / ЭАС / ЭЗК / ЭЕП). */
  readonly byMethod: Record<string, number>;
  /** Разрез по году нумерации процедуры — книга переходящая. */
  readonly byYear: Record<string, number>;
  /** Сумма НМЦК всех строк с числовой НМЦК, руб. */
  readonly nmckTotal: number;
  /** Экономия ВСЕГО как записана в книге, руб. — сопоставима со сводом. */
  readonly savingsBookTotal: number;
  /** Экономия по бюджетам, руб. */
  readonly savingsMb: number;
  readonly savingsKb: number;
  readonly savingsFb: number;
  /** Строк, где ВСЕГО ≠ МБ+КБ+ФБ, и сумма разрыва, руб. */
  readonly controlErrors: number;
  readonly controlGapRub: number;
  /** Состоявшиеся торги (цена > 0). */
  readonly awarded: {
    readonly count: number;
    /** НМЦК состоявшихся с числовой НМЦК, руб. — знаменатель экономии. */
    readonly nmckTotal: number;
    /** Сумма цен победителей, руб. */
    readonly priceTotal: number;
    /** Экономия на торгах: НМЦК − цена по состоявшимся, руб. */
    readonly savingsTotal: number;
    /**
     * Средний процент снижения — СРЕДНЕЕ ПОСТРОЧНЫХ процентов. Это один из
     * трёх коэффициентов (спека §3.2), и подменять им портфельный нельзя:
     * портфельный отвечает «на сколько подешевел портфель», этот — «как
     * ведёт себя типичная процедура». Оба живут в analytics.ts рядом.
     */
    readonly avgReductionPct: number | null;
    /** Цена равна НМЦК — снижения не было (спека §3.2: 160 из 351). */
    readonly noReductionCount: number;
  };
  /** Строк с разобранным кодом / с неразобранным (сигнал целостности). */
  readonly codesParsed: number;
  readonly codesUnparsed: number;
  /** Совместных закупок (ЭАС либо заказчик-признак). */
  readonly jointCount: number;
  /** Строк, где победитель есть, но ИНН не проставлен (27 на дату дампа). */
  readonly winnersWithoutInn: number;
}

export function aggregateMonitoring(registry: MonitoringRegistry): MonitoringAggregates {
  const byStage: Record<ProcedureStage, number> = {
    application: 0, published: 0, bidding: 0, awarded: 0, no_result: 0,
  };
  const byMethod: Record<string, number> = {};
  const byYear: Record<string, number> = {};
  let nmckTotal = 0;
  let savingsBookTotal = 0;
  let savingsMb = 0;
  let savingsKb = 0;
  let savingsFb = 0;
  let controlErrors = 0;
  let controlGapRub = 0;
  let awardedCount = 0;
  let awardedNmck = 0;
  let awardedPrice = 0;
  let noReductionCount = 0;
  let jointCount = 0;
  let winnersWithoutInn = 0;
  const reductions: number[] = [];

  for (const p of registry.procedures) {
    byStage[p.stage] += 1;
    const method = p.method ?? 'без кода';
    byMethod[method] = (byMethod[method] ?? 0) + 1;
    const year = p.year === null ? 'без кода' : String(2000 + p.year);
    byYear[year] = (byYear[year] ?? 0) + 1;

    if (p.nmck !== null) nmckTotal += p.nmck;
    if (p.savingsTotal !== null) savingsBookTotal += p.savingsTotal;
    if (p.savingsMb !== null) savingsMb += p.savingsMb;
    if (p.savingsKb !== null) savingsKb += p.savingsKb;
    if (p.savingsFb !== null) savingsFb += p.savingsFb;
    if (p.controlAgrees === false) {
      controlErrors += 1;
      controlGapRub += p.controlGapRub ?? 0;
    }
    if (p.joint) jointCount += 1;
    if (p.winner.outcome === 'supplier' && p.winner.inn === null) winnersWithoutInn += 1;

    if (p.stage === 'awarded' && p.auctionPrice !== null) {
      awardedCount += 1;
      awardedPrice += p.auctionPrice;
      if (p.nmck !== null) {
        awardedNmck += p.nmck;
        if (p.nmck > 0) reductions.push(((p.nmck - p.auctionPrice) / p.nmck) * 100);
        if (p.nmck === p.auctionPrice) noReductionCount += 1;
      }
    }
  }

  return {
    total: registry.procedures.length,
    byStage,
    byMethod,
    byYear,
    nmckTotal: round3(nmckTotal),
    savingsBookTotal: round3(savingsBookTotal),
    savingsMb: round3(savingsMb),
    savingsKb: round3(savingsKb),
    savingsFb: round3(savingsFb),
    controlErrors,
    controlGapRub: round3(controlGapRub),
    awarded: {
      count: awardedCount,
      nmckTotal: round3(awardedNmck),
      priceTotal: round3(awardedPrice),
      savingsTotal: round3(awardedNmck - awardedPrice),
      avgReductionPct: reductions.length > 0
        ? reductions.reduce((a, b) => a + b, 0) / reductions.length
        : null,
      noReductionCount,
    },
    codesParsed: registry.procedures.filter((p) => p.code !== null).length,
    codesUnparsed: registry.unparsedCodes.length,
    jointCount,
    winnersWithoutInn,
  };
}
