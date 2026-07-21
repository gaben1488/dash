/**
 * Билдер DTO строки закупки для /api/rows/* (E11-2).
 * Извлечено move-only из routes/rows.ts (GET /api/rows/:deptId, ~стр. 126–211).
 * Чистые функции: явные аргументы, никакого чтения кэшей/глобалей.
 */
import { buildCellDict, isMetaRow, parseSheetDate } from '@aemr/shared';
import { detectSignals, classifyRowState, getSignalBadges } from '@aemr/core';

/**
 * Дата-канон DTO (fidelity-аудит 2026-07-16 §2.2). Ячейки N/Q приходят из листов
 * в трёх видах: serial-число (46034; 6 из 8 книг), строка «дд.мм.гггг», реже ISO.
 * Наружу API отдаёт ЕДИНЫЙ формат — ISO «YYYY-MM-DD» либо null (локализация
 * дд.мм.гггг — на рендере web). Сырое значение листа сохраняется рядом в поле
 * *Raw: пути ЗАПИСИ (PUT /field, POST /api/data/rows) работают с пользовательским
 * вводом/сырьём и НЕ читают конвертированное поле — формат листа не меняется.
 *
 * Извлечено из routes/rows.ts (sheetDateToIso).
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

// Маппинг англ. состояния → русская подпись статуса (как в исходном роуте).
const STATUS_MAP: Record<string, string> = {
  'signed': 'Подписан', 'overdue': 'Просрочен', 'planning': 'Планирование',
  'canceled': 'Отменён', 'has-fact': 'Исполнение', 'open': 'Открыт',
  'error': 'Ошибка', 'near-plan': 'Скоро срок', 'not-due': 'Срок не наступил',
  'finance-delay': 'Задержка финансирования',
};

/** DTO строки реестра — внешний контракт GET /api/rows/:deptId (не менять форму). */
export type RowDto = ReturnType<typeof buildRowDto>;

/**
 * Строка листа (уже без шапки) → DTO с сигналами/статусом/датами-ISO.
 * Извлечено move-only из routes/rows.ts (маппинг внутри GET /api/rows/:deptId).
 *
 * @param row  сырая строка листа (массив ячеек A..)
 * @param idx  индекс в массиве ПОСЛЕ slice(DEPT_HEADER_ROWS): idx=0 → строка листа 4
 * @param opts deptId — id отдела для поля dept
 */
export function buildRowDto(row: unknown[], idx: number, opts: { deptId: string }) {
  const cells = buildCellDict(row);

  const signalsObj = detectSignals(cells);
  const state = classifyRowState(signalsObj);
  const badges = getSignalBadges(signalsObj);
  // RowSignals (объект булевых) → массив активных ключей сигналов для фронта
  const signals = Object.entries(signalsObj)
    .filter(([, v]) => v === true)
    .map(([k]) => k);

  // Column mapping per DEPT_COLUMNS:
  // A=ID, B=REG_NUMBER, C=SUBORDINATE, F=TYPE, G=SUBJECT,
  // H=FB_PLAN, I=KB_PLAN, J=MB_PLAN, K=TOTAL_PLAN, L=METHOD,
  // N=PLAN_DATE, O=PLAN_QUARTER, Q=FACT_DATE, R=FACT_QUARTER,
  // V=FB_FACT, W=KB_FACT, X=MB_FACT, Y=TOTAL_FACT,
  // Z=ECONOMY_FB, AA=ECONOMY_KB, AB=ECONOMY_MB, AD=FLAG
  const planMoney = parseFloat(String(cells.K ?? 0)) || 0;
  const factMoney = parseFloat(String(cells.Y ?? 0)) || 0;
  const ecoFB = parseFloat(String(cells.Z ?? 0)) || 0;
  const ecoKB = parseFloat(String(cells.AA ?? 0)) || 0;
  const ecoMB = parseFloat(String(cells.AB ?? 0)) || 0;
  const ecoTotal = ecoFB + ecoKB + ecoMB;

  return {
    rowIndex: idx + 4, // 1-based: slice(3) skips 3 header rows, so idx=0 → row 4
    id: cells.A,
    regNumber: cells.B ?? '',
    subordinate: cells.C ?? '',
    programName: cells.D ?? '',
    type: cells.F ?? '',
    subject: cells.G ?? '',
    planFB: parseFloat(String(cells.H ?? 0)) || 0,
    planKB: parseFloat(String(cells.I ?? 0)) || 0,
    planMB: parseFloat(String(cells.J ?? 0)) || 0,
    planSum: planMoney,
    method: String(cells.L ?? ''),
    // Даты — ISO «YYYY-MM-DD» | null (канон DTO, см. sheetDateToIso);
    // *Raw — исходное значение ячейки листа (serial/строка) для записи-обратно.
    planDate: sheetDateToIso(cells.N),
    planDateRaw: cells.N ?? '',
    planQuarter: cells.O ?? '',
    factDate: sheetDateToIso(cells.Q),
    factDateRaw: cells.Q ?? '',
    factQuarter: cells.R ?? '',
    planYear: parseInt(String(cells.P ?? ''), 10) || 0,
    factFB: parseFloat(String(cells.V ?? 0)) || 0,
    factKB: parseFloat(String(cells.W ?? 0)) || 0,
    factMB: parseFloat(String(cells.X ?? 0)) || 0,
    factSum: factMoney,
    economy: ecoTotal,
    economyFB: ecoFB,
    economyKB: ecoKB,
    economyMB: ecoMB,
    flag: cells.AD ?? '',
    commentGRBS: cells.AE ?? '',
    commentExtra: cells.AF ?? '',
    status: STATUS_MAP[state] ?? state,
    dept: opts.deptId,
    signals,
    state,
    badges,
  };
}

/**
 * Отсев не-данных: пустые, итоговые/шапочные и строки с method-заголовком.
 * Извлечено move-only из routes/rows.ts (.filter после маппинга DTO).
 */
export function isDataRow(r: Pick<RowDto, 'subject' | 'id' | 'planSum' | 'method'>): boolean {
  const subj = String(r.subject).trim().toLowerCase();
  const idStr = String(r.id ?? '').trim().toLowerCase();
  // Skip rows with no subject AND no plan money
  if (!subj && !r.planSum) return false;
  // Skip aggregate/header rows
  if (isMetaRow(subj)) return false;
  // Skip header-like rows (id contains non-numeric text like "№ п/п")
  if (idStr && isNaN(Number(idStr)) && !idStr.match(/^\d/)) return false;
  // Skip rows where method is clearly a header label (not ЭА/ЭК/ЭЗК/ЕП)
  const m = r.method.trim().toUpperCase();
  if (m.length > 5 && !['ЭА', 'ЭК', 'ЭЗК', 'ЕП'].includes(m)) return false;
  return true;
}
