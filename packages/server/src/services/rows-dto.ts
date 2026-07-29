/**
 * Билдер DTO строки закупки для /api/rows/* (E11-2, rethink 2026-07-22).
 * Чистые функции: явные аргументы, никакого чтения кэшей/глобалей.
 * Страховочная сетка контракта — rows-dto.test.ts (характеризация DTO).
 */
import {
  buildCellDict,
  isMetaRow,
  parseSheetDate,
  DEPT_COLUMNS,
  DEPT_HEADER_ROWS,
  METHOD_FAMILY_MAP,
  SIGNAL_LABELS,
} from '@aemr/shared';
import { detectSignals, classifyRowState, getSignalBadges, type RowState } from '@aemr/core';

/** Бейдж сигнала (core не экспортирует тип SignalBadge из барреля — деривим). */
type SignalBadge = ReturnType<typeof getSignalBadges>[number];

/**
 * Дата-канон DTO (fidelity-аудит 2026-07-16 §2.2). Ячейки N/Q приходят из листов
 * в трёх видах: serial-число (46034; 6 из 8 книг), строка «дд.мм.гггг», реже ISO.
 * Наружу API отдаёт ЕДИНЫЙ формат — ISO «YYYY-MM-DD» либо null (локализация
 * дд.мм.гггг — на рендере web). Сырое значение листа сохраняется рядом в поле
 * *Raw: пути ЗАПИСИ (PUT /field, POST /api/data/rows) работают с пользовательским
 * вводом/сырьём и НЕ читают конвертированное поле — формат листа не меняется.
 */
export function sheetDateToIso(val: unknown): string | null {
  // «дд.мм.гггг» — строковыми операциями, без Date: локальная полночь через
  // toISOString() сдвинула бы день в часовых поясах западнее Гринвича.
  const ru = String(val ?? '').trim().match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (ru) return `${ru[3]}-${ru[2].padStart(2, '0')}-${ru[1].padStart(2, '0')}`;
  // Serial и ISO parseSheetDate даёт как UTC-полночь → срез ISO-строки безопасен.
  const d = parseSheetDate(val);
  return d ? d.toISOString().slice(0, 10) : null;
}

/**
 * Число из ячейки листа: пробелы-разделители тысяч и запятая-десятичная —
 * реальный формат операторов («1 234,56»). parseFloat рвался на пробеле.
 * Канон совпадает с core/pipeline/signals.toNumber (локальная копия: toNumber
 * из core не экспортирован, тащить весь core ради хелпера — раздувание).
 */
function toNumber(val: unknown): number {
  if (typeof val === 'number') return Number.isFinite(val) ? val : 0;
  if (val === null || val === undefined || val === '') return 0;
  const parsed = parseFloat(String(val).replace(/\s/g, '').replace(/,/g, '.'));
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * RowState → русская подпись статуса DTO. Канона «RowState → лейбл» в
 * product-dictionary нет (SIGNAL_LABELS ключуется именами сигналов) — поэтому
 * совпадающие подписи берём из словаря, чтобы не разъезжаться с основным UI,
 * а три состояния без сигнального аналога задаём локально.
 * Record исчерпывающий: новое состояние в RowState не пройдёт мимо typecheck.
 */
const STATE_STATUS_RU: Record<RowState, string> = {
  'signed': SIGNAL_LABELS.signed,               // Подписан
  'overdue': SIGNAL_LABELS.overdue,             // Просрочен
  'planning': SIGNAL_LABELS.planning,           // Планирование
  'canceled': SIGNAL_LABELS.canceled,           // Отменён
  'not-due': SIGNAL_LABELS.notDue,              // Срок не наступил
  'finance-delay': SIGNAL_LABELS.financeDelay,  // Задержка финансирования
  'near-plan': SIGNAL_LABELS.planSoon,          // Скоро срок
  'has-fact': 'Исполнение',
  'open': 'Открыт',
  'error': 'Ошибка',
  // classifyRowState это состояние не возвращает (не-данные отсекает isDataRow);
  // ключ нужен только для исчерпывающести Record.
  'non-data': 'Служебная строка',
};

/**
 * DTO строки реестра — ВНЕШНИЙ контракт GET /api/rows/:deptId (форму не менять).
 * Поля-«сырьё» (id, кварталы, флаг, комментарии, *Raw) типизированы unknown
 * честно: они отдаются как лежат в листе (string | number | null после
 * buildCellDict) и возвращаются в лист путями записи без конверсии.
 */
export interface RowDto {
  /** 1-based номер строки листа: idx=0 после среза шапки → строка 4. */
  rowIndex: number;
  /** A — порядковый номер (сырьё листа). */
  id: unknown;
  /** B — реестровый номер (пустая ячейка → ''). */
  managementName: unknown;
  /** C — наименование подведа (пустая ячейка → ''). */
  subordinate: unknown;
  /** D — наименование программы (X/Х/пусто = «вне ПМ»). */
  programName: unknown;
  /** F — вид деятельности (ТД / ПМ). */
  type: unknown;
  /** G — предмет закупки. */
  subject: unknown;
  planFB: number;
  planKB: number;
  planMB: number;
  /** K — итого план. */
  planSum: number;
  /** L — способ закупки (ЭА/ЕП/ЭК/ЭЗК либо мусор оператора). */
  method: string;
  /** Дата плана — ISO «YYYY-MM-DD» | null (канон DTO, см. sheetDateToIso). */
  planDate: string | null;
  /** Исходное значение ячейки N (serial/строка) для записи-обратно. */
  planDateRaw: unknown;
  planQuarter: unknown;
  /** Дата факта — ISO «YYYY-MM-DD» | null. */
  factDate: string | null;
  /** Исходное значение ячейки Q для записи-обратно. */
  factDateRaw: unknown;
  factQuarter: unknown;
  /** P — год плана (не распознан → 0). */
  planYear: number;
  factFB: number;
  factKB: number;
  factMB: number;
  /** Y — итого факт. */
  factSum: number;
  /** Сумма экономий Z+AA+AB. */
  economy: number;
  economyFB: number;
  economyKB: number;
  economyMB: number;
  /** AD — признак экономии. */
  flag: unknown;
  /** AE — комментарий ГРБС. */
  commentGRBS: unknown;
  /** AF — комментарий УЭР. */
  commentExtra: unknown;
  /** Русская подпись состояния (STATE_STATUS_RU). */
  status: string;
  /** Латинский id управления (из opts.deptId). */
  dept: string;
  /** Активные ключи сигналов (RowSignals с true). */
  signals: string[];
  state: RowState;
  badges: SignalBadge[];
}

/**
 * Строка листа (уже без шапки) → DTO с сигналами/статусом/датами-ISO.
 *
 * @param row  сырая строка листа (массив ячеек A..)
 * @param idx  индекс в массиве ПОСЛЕ slice(DEPT_HEADER_ROWS): idx=0 → строка листа 4
 * @param opts deptId — id управления для поля dept
 */
export function buildRowDto(row: unknown[], idx: number, opts: { deptId: string }): RowDto {
  const cells = buildCellDict(row);

  const signalsObj = detectSignals(cells);
  const state = classifyRowState(signalsObj);
  const badges = getSignalBadges(signalsObj);
  // RowSignals (объект булевых) → массив активных ключей сигналов для фронта
  const signals = Object.entries(signalsObj)
    .filter(([, v]) => v === true)
    .map(([k]) => k);

  /** Ячейка по канон-имени колонки DEPT_COLUMNS (за краем строки → null, как buildCellDict). */
  const col = (name: keyof typeof DEPT_COLUMNS): unknown => row[DEPT_COLUMNS[name]] ?? null;

  const ecoFB = toNumber(col('ECONOMY_FB'));
  const ecoKB = toNumber(col('ECONOMY_KB'));
  const ecoMB = toNumber(col('ECONOMY_MB'));

  return {
    rowIndex: idx + DEPT_HEADER_ROWS + 1, // 1-based: срез шапки в 3 строки → idx=0 = строка 4
    id: col('ID'),
    // B — наименование управления, а не реестровый номер: канон
    // column-map.ts исправлен по 3 852 живым строкам (номера там нет).
    managementName: col('MANAGEMENT_NAME') ?? '',
    subordinate: col('SUBORDINATE') ?? '',
    programName: col('PROGRAM_NAME') ?? '',
    type: col('TYPE') ?? '',
    subject: col('SUBJECT') ?? '',
    planFB: toNumber(col('FB_PLAN')),
    planKB: toNumber(col('KB_PLAN')),
    planMB: toNumber(col('MB_PLAN')),
    planSum: toNumber(col('TOTAL_PLAN')),
    method: String(col('METHOD') ?? ''),
    planDate: sheetDateToIso(col('PLAN_DATE')),
    planDateRaw: col('PLAN_DATE') ?? '',
    planQuarter: col('PLAN_QUARTER') ?? '',
    factDate: sheetDateToIso(col('FACT_DATE')),
    factDateRaw: col('FACT_DATE') ?? '',
    factQuarter: col('FACT_QUARTER') ?? '',
    planYear: parseInt(String(col('PLAN_YEAR') ?? ''), 10) || 0,
    factFB: toNumber(col('FB_FACT')),
    factKB: toNumber(col('KB_FACT')),
    factMB: toNumber(col('MB_FACT')),
    factSum: toNumber(col('TOTAL_FACT')),
    economy: ecoFB + ecoKB + ecoMB,
    economyFB: ecoFB,
    economyKB: ecoKB,
    economyMB: ecoMB,
    flag: col('FLAG') ?? '',
    commentGRBS: col('COMMENT_GRBS') ?? '',
    commentExtra: col('COMMENT_UER') ?? '',
    status: STATE_STATUS_RU[state],
    dept: opts.deptId,
    signals,
    state,
    badges,
  };
}

/** Канонические коды способа закупки (колонка L) — из словаря семейств. */
const KNOWN_METHODS: readonly string[] = METHOD_FAMILY_MAP.ALL;

/**
 * Отсев не-данных: пустые, итоговые/шапочные и строки с method-заголовком.
 */
export function isDataRow(r: Pick<RowDto, 'subject' | 'id' | 'planSum' | 'method'>): boolean {
  const subj = String(r.subject).trim().toLowerCase();
  const idStr = String(r.id ?? '').trim().toLowerCase();
  // Пустой предмет И нулевой план — заведомо не закупка
  if (!subj && !r.planSum) return false;
  // Итоговые/шапочные строки («итого», «всего», «раздел»…)
  if (isMetaRow(subj)) return false;
  // id — текст шапки («№ п/п»), не число и не начинается с цифры
  if (idStr && isNaN(Number(idStr)) && !idStr.match(/^\d/)) return false;
  // L — заголовочный текст (длиннее кода и не из канона ЭА/ЕП/ЭК/ЭЗК)
  const m = r.method.trim().toUpperCase();
  if (m.length > 5 && !KNOWN_METHODS.includes(m)) return false;
  return true;
}
