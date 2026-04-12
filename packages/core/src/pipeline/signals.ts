/**
 * Row Signal Detection Engine
 * Анализирует строки закупок на статусы, аномалии и сигналы для принятия решений.
 * Портировано из v22 getRowSignals + classifyRow, переписано как типизированные чистые функции.
 *
 * Столбцы (выверено по recalculate.ts и реальной таблице):
 *   A=0  (ID/№ п/п), B=1, C=2 (подвед), D=3 (предмет),
 *   E=4, F=5  (вид деятельности), G=6 (наименование/subject),
 *   H=7  (ФБ план), I=8 (КБ план), J=9 (МБ план), K=10 (план итого),
 *   L=11 (способ закупки: ЭА/ЕП/ЭК/ЭЗК), M=12, N=13 (план дата),
 *   O=14 (план квартал: 1-4), P=15, Q=16 (факт дата),
 *   R=17 (факт квартал), S=18, T=19, U=20 (статус),
 *   V=21 (ФБ факт), W=22 (КБ факт), X=23 (МБ факт),
 *   Y=24 (факт итого), Z=25, AA=26, AB=27 (экономия МБ),
 *   AC=28, AD=29 (флаг экономии), AE=30 (комм. ГРБС), AF=31 (комм. УЭР)
 */

// ────────────────────────────────────────────────────────────
// Типы
// ────────────────────────────────────────────────────────────

/**
 * Аналитические сигналы строки закупки.
 * Каждый флаг — результат детерминированной проверки одной строки.
 */
export interface RowSignals {
  /** Контракт подписан/заключён/исполнен (колонка U) */
  signed: boolean;
  /** В стадии планирования/подготовки/разработки (колонка U) */
  planning: boolean;
  /** Срок не наступил (колонка U) */
  notDue: boolean;
  /** Отменена / снята / не требуется (колонка U) */
  canceled: boolean;
  /** Просрочена: плановая дата прошла, факта нет, не подписана, не отменена */
  overdue: boolean;
  /** Есть фактические данные: факт дата ИЛИ факт суммы > 0 */
  hasFact: boolean;
  /** Плановая дата наступит в ближайшие 14 дней */
  planSoon: boolean;
  /** Задержка финансирования (AE/AF: "финансир", "перенос") */
  financeDelay: boolean;
  /** Флаг экономии от уполномоченного органа (колонка AD) */
  economyFlag: boolean;
  /** Конфликт флага экономии: (а) AD="экономия" но факт ≥ план; (б) экономия >15% но финансовый орган не определил флаг */
  economyConflict: boolean;
  /** ЕП (колонка L) с суммой > 500 000 руб. — антикоррупционный сигнал */
  epRisk: boolean;
  /** Пустые обязательные поля — проблема качества данных */
  dataQuality: boolean;
  /** Формула вернула ошибку (#REF, #VALUE, #N/A и т.д.) */
  formulaBroken: boolean;
  /** 1 участник — формальная конкуренция */
  singleParticipant: boolean;
  /** Высокая экономия (лимит−факт) > 25%. Внимание: это лимит−факт, НЕ НМЦ−факт. Антидемпинг по ст.37 44-ФЗ требует НМЦК, которой нет в данных */
  highEconomy: boolean;
  /** Экономия < 2% — предопределённый победитель */
  lowCompetition: boolean;
  /** Раннее закрытие: факт дата раньше плановой на >30 дней */
  earlyClosure: boolean;
  /** Факт > план на >10% */
  factExceedsPlan: boolean;
  /** Подвисший контракт: подписан, нет факт даты, план дата просрочена >60 дней */
  stalledContract: boolean;
  /** @deprecated Удалён — дублирует правило budget_sum_plan в RULE_BOOK */
  budgetMismatch: boolean;
  /** Есть факт суммы но нет факт даты */
  factWithoutDate: boolean;
  /** Есть факт дата но нет факт сумм — потенциальное отсутствие данных */
  dateWithoutFact: boolean;
  /** Факт дата раньше плановой даты — логическая ошибка в данных */
  factDateBeforePlan: boolean;
  /** План есть (K > 0, N задана), факта нет, год идёт — невыполненный план */
  planWithoutExecution: boolean;
  /** ЕП без обоснования: метод ЕП, но столбец M (обоснование) пуст */
  epJustificationMissing: boolean;
  /** Факт без плана: Y > 0, но K = 0 — бюджетная аномалия */
  budgetUnderallocation: boolean;
}

/**
 * Состояние строки — единственная метка, определяющая визуальный режим
 * отображения строки в таблице и на дашборде.
 */
export type RowState =
  | 'signed'         // Подписан / исполнен
  | 'has-fact'       // Есть фактические данные
  | 'overdue'        // Просрочен
  | 'canceled'       // Отменён
  | 'planning'       // В процессе планирования
  | 'not-due'        // Срок не наступил
  | 'near-plan'      // Скоро плановый срок
  | 'finance-delay'  // Задержка финансирования
  | 'open'           // Открытая закупка без статуса
  | 'non-data'       // Не строка данных (заголовок, итого, пустая)
  | 'error';         // Ошибка данных

/** Бейдж для отображения сигнала в UI */
export interface SignalBadge {
  label: string;
  color: 'green' | 'red' | 'yellow' | 'blue' | 'gray';
  icon: string;
}

// ────────────────────────────────────────────────────────────
// Константы
// ────────────────────────────────────────────────────────────

/** Порог ЕП-риска в рублях (600 тыс. — п.4 ст.93 44-ФЗ) */
const EP_RISK_THRESHOLD = 600_000;

/** Антидемпинговый порог экономии (44-ФЗ ст.37) */
const ANTI_DUMPING_PERCENT = 25;

/** Порог формальной конкуренции */
const LOW_COMPETITION_PERCENT = 2;

/** Горизонт «скоро» в днях */
const PLAN_SOON_DAYS = 14;

/** Паттерны ошибок формул */
const FORMULA_ERROR_PATTERNS = ['#REF', '#VALUE', '#N/A', '#NAME', '#DIV/0', '#NULL', '#NUM', '#ERROR'];

/** Обязательные столбцы для проверки качества данных.
 * D = предмет, K = план итого, L = способ закупки.
 * E (вид деятельности) исключён — часто не заполняется и это не ошибка данных. */
const REQUIRED_COLUMNS = ['D', 'K', 'L'] as const;

// ────────────────────────────────────────────────────────────
// Вспомогательные функции
// ────────────────────────────────────────────────────────────

/**
 * Приводит значение ячейки к строке нижнего регистра для текстового поиска.
 */
function cellText(cells: Record<string, unknown>, col: string): string {
  const v = cells[col];
  if (v === null || v === undefined) return '';
  return String(v).trim().toLowerCase();
}

/**
 * Возвращает сырое строковое значение ячейки (без toLowerCase).
 */
function cellRaw(cells: Record<string, unknown>, col: string): string {
  const v = cells[col];
  if (v === null || v === undefined) return '';
  return String(v).trim();
}

/**
 * Проверяет, содержит ли текст ячейки хотя бы один из указанных паттернов.
 * Регистронезависимое частичное совпадение (includes).
 */
function textIncludes(text: string, patterns: string[]): boolean {
  return patterns.some(p => text.includes(p));
}

/**
 * Извлекает числовое значение из ячейки.
 * Обрабатывает: number, строку с пробелами/запятыми, пустые значения.
 * Возвращает NaN если невозможно распознать число.
 */
function toNumber(val: unknown): number {
  if (typeof val === 'number') return val;
  if (val === null || val === undefined || val === '') return NaN;
  // Убираем пробелы (разделители тысяч) и меняем запятую на точку
  const cleaned = String(val).replace(/\s/g, '').replace(/,/g, '.');
  return parseFloat(cleaned);
}

/**
 * Парсит дату из строки.
 * Поддерживает:
 *   - dd.mm.yyyy (русский формат)
 *   - yyyy-mm-dd (ISO)
 *   - Date объект
 */
function parseDate(val: unknown): Date | null {
  if (val instanceof Date) return isNaN(val.getTime()) ? null : val;
  if (val === null || val === undefined || val === '') return null;

  const s = String(val).trim();

  // dd.mm.yyyy
  const ruMatch = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (ruMatch) {
    const [, dd, mm, yyyy] = ruMatch;
    const d = new Date(parseInt(yyyy, 10), parseInt(mm, 10) - 1, parseInt(dd, 10));
    return isNaN(d.getTime()) ? null : d;
  }

  // ISO yyyy-mm-dd или полная ISO строка
  const iso = new Date(s);
  return isNaN(iso.getTime()) ? null : iso;
}

/**
 * Возвращает разницу в днях (a - b), округлённую вниз.
 */
function daysDiff(a: Date, b: Date): number {
  return Math.floor((a.getTime() - b.getTime()) / (1000 * 60 * 60 * 24));
}

/**
 * Проверяет, содержит ли любое значение в cells формульную ошибку.
 */
function hasFormulaError(cells: Record<string, unknown>): boolean {
  return Object.values(cells).some(v => {
    if (v === null || v === undefined) return false;
    const s = String(v).toUpperCase();
    return FORMULA_ERROR_PATTERNS.some(err => s.includes(err));
  });
}

/**
 * Проверяет, является ли строка «строкой данных» (не заголовок, не итого).
 * Простая эвристика: есть предмет закупки (D) или суммы (K).
 */
function isDataRow(cells: Record<string, unknown>): boolean {
  const d = cellText(cells, 'D');
  const k = toNumber(cells['K']);
  // Фильтруем строки-итого и заголовки
  if (textIncludes(d, ['итого', 'всего', 'раздел', 'блок'])) return false;
  // Если есть предмет или сумма — строка данных
  return d.length > 0 || !isNaN(k);
}

// ────────────────────────────────────────────────────────────
// Основные экспортируемые функции
// ────────────────────────────────────────────────────────────

/**
 * Детектирует аналитические сигналы строки закупки.
 *
 * @param cells — словарь «буква столбца → значение ячейки» (напр. { D: "Поставка ГСМ", K: 1500000, U: "подписан" })
 * @param today — текущая дата (для unit-тестов), по умолчанию new Date()
 * @returns RowSignals — набор булевых флагов
 *
 * Бизнес-логика:
 * - Текстовые сигналы (signed, planning, notDue, canceled, financeDelay) —
 *   регистронезависимый поиск подстрок в столбцах U + AE (оба содержат статусные данные).
 * - Временны́е сигналы (overdue, planSoon) — сравнение плановой даты (столбец Q)
 *   с текущей датой.
 * - Финансовые сигналы (epRisk, highEconomy, lowCompetition, economyConflict) —
 *   арифметические проверки сумм.
 * - Сигналы качества (dataQuality, formulaBroken) — полнота и корректность данных.
 */
export function detectSignals(cells: Record<string, unknown>, today?: Date): RowSignals {
  const now = today ?? new Date();

  // ── Текстовые поля ──
  // Column U = «Причина отклонения» — mostly "Х" (placeholder), sometimes deviation reasons.
  // Column AE = «Комментарий ГРБС» — contains actual status info ("договор заключен", "планирование").
  // We must check BOTH columns for status detection (U + AE/AF).
  const statusText = cellText(cells, 'U');
  const adText = cellText(cells, 'AD');
  const aeText = cellText(cells, 'AE');
  const afText = cellText(cells, 'AF');
  const grbsComment = aeText + ' ' + afText;
  const methodText = cellText(cells, 'L');
  // Combined text for status detection: U + AE (both carry status signals)
  const statusAndComment = statusText + ' ' + aeText;

  // ── Суммы ──
  const planTotal = toNumber(cells['K']);    // K = total plan
  const factV = toNumber(cells['V']);        // V = FB fact
  const factW = toNumber(cells['W']);        // W = KB fact
  const factX = toNumber(cells['X']);        // X = MB fact
  const factY = toNumber(cells['Y']);        // Y = total fact
  // Use Y (total fact) if available, otherwise sum V+W+X
  const factTotal = !isNaN(factY) && factY !== 0 ? factY
    : [factV, factW, factX].reduce((sum, v) => sum + (isNaN(v) ? 0 : v), 0);

  // ── Даты ──
  // N = plan date, Q = fact date (verified against recalculate.ts column mapping)
  const planDateParsed = parseDate(cells['N']);
  const factDateParsed = parseDate(cells['Q']);

  // Факт суммы > 0 ИЛИ есть факт дата
  const hasFactAmounts = factTotal > 0;
  const hasFactDate = factDateParsed !== null;
  const hasFact = hasFactAmounts || hasFactDate;

  // ── Статусные сигналы (столбцы U + AE) ──
  // Real data: column U mostly has "Х"; AE has "договор заключен" (950+), "планирование" (710+).
  // We check BOTH to avoid massive false negatives.
  // IMPORTANT: "заключ" is ambiguous — "заключен" (signed, past) vs "заключение" (planning, future).
  // Use precise patterns to avoid false positives.
  const signed = textIncludes(statusAndComment, ['подписан', 'заключен', 'исполнен']);
  const planning = textIncludes(statusAndComment, ['планир', 'подготов', 'разработ']);
  const notDue = statusAndComment.includes('срок не наступил');
  const canceled = textIncludes(statusAndComment, ['отмен', 'не требуется', 'снят', 'подлежит удалению']);

  // ── Временны́е сигналы ──
  let overdue = false;
  let planSoon = false;

  // Check if AE/AF indicates a known schedule change (переносится на...) — not truly overdue
  const hasScheduleTransfer = textIncludes(grbsComment, ['переносится на', 'планируется на', 'планирование на']);

  if (planDateParsed) {
    const daysUntilPlan = daysDiff(planDateParsed, now);

    // Просрочено: плановая дата прошла, нет факта, не подписан, не отменён
    // Also skip if AE indicates a known schedule transfer (переносится на...)
    if (daysUntilPlan < 0 && !hasFact && !signed && !canceled && !hasScheduleTransfer) {
      overdue = true;
    }

    // Скоро срок: плановая дата в ближайшие 14 дней (и ещё не прошла)
    if (daysUntilPlan >= 0 && daysUntilPlan <= PLAN_SOON_DAYS && !signed && !canceled && !hasFact) {
      planSoon = true;
    }
  }

  // ── Финансирование (AE/AF) ──
  // "перенос" alone is too broad — it catches schedule changes, not just finance delays.
  // Require "финансир" context or specific "отсутствие финансирования" patterns.
  const financeDelay = grbsComment.includes('финансир') ||
    textIncludes(grbsComment, ['нет финансирования', 'отсутствие финансирования', 'отсутствием финансирования']);

  // ── ЕП detection (used by multiple signals below) ──
  const isEP = methodText.includes('еп') || methodText.includes('единствен');
  // Column M = "Обоснование ЕП" — contains justification for sole-source.
  // Natural monopolies, Governor's orders, and law-mandated sole-source are NOT risks.
  const epJustification = cellText(cells, 'M');
  const isLegitimateEP = textIncludes(epJustification, [
    'монополист', 'монопол', 'естественн',           // natural monopoly (energy, water, telecom)
    'п.8', 'п.1 ч.1', 'п.6 ч.1', 'п.29',           // specific 44-FZ articles for mandatory sole-source
    'губернатор', 'поручен',                          // Governor's orders
    'региональный оператор',                          // regional operators (waste, etc.)
  ]) || textIncludes(aeText, ['монополист']);

  // ── Экономия (AD) ──
  const economyFlag = adText.includes('эконом');

  // Конфликт флага экономии:
  // (а) AD помечен как «экономия», но факт >= план — некорректный флаг;
  // (б) AD не помечен, но есть существенная экономия >15% — финансовый орган не определил флаг.
  //     EXCEPT for ЕП: economy on ЕП is just underspend vs allocation (лимит), not competitive savings.
  //     Missing AD flag on ЕП is normal and NOT an error.
  // Skip if factTotal === 0 — row hasn't been executed yet, no meaningful conflict possible.
  let economyConflict = false;
  if (!isNaN(planTotal) && planTotal > 0 && factTotal > 0) {
    const hasEconomyByNumbers = factTotal > 0 && factTotal < planTotal;
    if (economyFlag && factTotal > 0 && factTotal >= planTotal) {
      // Помечена экономия, но факт >= план
      economyConflict = true;
    } else if (!economyFlag && hasEconomyByNumbers && !isEP) {
      // Есть числовая экономия, но AD не помечен.
      // Skip ЕП: economy on sole-source is just budget underspend, AD flag not required.
      // Порог 15%: мелкая экономия (5-15%) часто не требует флага AD,
      // а >15% без флага — реальный конфликт данных.
      const economyPct = ((planTotal - factTotal) / planTotal) * 100;
      if (economyPct > 15) {
        economyConflict = true;
      }
    }
  }

  // ── ЕП-риск (антикоррупция) ──
  const epRisk = isEP && !isNaN(planTotal) && planTotal > EP_RISK_THRESHOLD && !canceled && !isLegitimateEP;

  // ── Качество данных ──
  // Only check required fields if the row has actual execution (fact date present)
  // or if the plan date is in the past. Pure future-plan rows are expected to have
  // incomplete data (no method, no amounts yet).
  // Skip canceled rows and rows marked for deletion ("подлежит удалению").
  let dataQuality = false;
  const planDateInPast = planDateParsed !== null && daysDiff(planDateParsed, now) < 0;
  if (isDataRow(cells) && (hasFactDate || planDateInPast) && !planning && !notDue && !canceled) {
    dataQuality = REQUIRED_COLUMNS.some(col => {
      const val = cells[col];
      return val === null || val === undefined || String(val).trim() === '';
    });
  }

  // ── Формульные ошибки ──
  const formulaBroken = hasFormulaError(cells);

  // ── Единственный участник ──
  // No dedicated "participants" column in standard template.
  // Detect from status/comments: precise patterns to avoid false matches.
  // IMPORTANT: "единственный поставщик" in column M is just ЕП method justification, NOT a competition signal.
  // We only flag single participant for COMPETITIVE procedures (ЭА, ЭК, ЭЗК) where 1 participant
  // indicates formal/fake competition.
  const allText = statusText + ' ' + grbsComment;
  const singleParticipant = !isEP && (
    allText.includes('1 участник') ||
    allText.includes('единственный участник') ||
    allText.includes('ед.подавшим заявку'));

  // ── Высокая экономия и формальная конкуренция ──
  // По 44-ФЗ: антидемпинг (ст.37) и конкуренция применимы ТОЛЬКО к конкурентным процедурам (ЭА, ЭК, ЭЗК).
  // ЕП (ст.93) — закупка без торгов, конкуренции нет по определению.
  let highEconomy = false;
  let lowCompetition = false;

  if (!isEP && !isNaN(planTotal) && planTotal > 0 && factTotal > 0) {
    const economyPct = ((planTotal - factTotal) / planTotal) * 100;
    if (economyPct > ANTI_DUMPING_PERCENT) {
      highEconomy = true;
    }
    if (economyPct >= 0 && economyPct < LOW_COMPETITION_PERCENT) {
      lowCompetition = true;
    }
  }

  // ── Раннее закрытие: факт дата раньше плановой на >30 дней ──
  // In procurement, early completion is common (efficient process, early budget execution).
  // Threshold increased from 14→30 days to reduce false positives on normal early completions.
  // Only flag if NOT canceled and difference is substantial enough to be suspicious.
  let earlyClosure = false;
  if (factDateParsed && planDateParsed && !canceled) {
    const diff = daysDiff(planDateParsed, factDateParsed); // planDate - factDate
    if (diff > 30) {
      earlyClosure = true;
    }
  }

  // ── Факт > план ──
  // Skip canceled rows — their data may be stale/incorrect.
  // Threshold: factTotal > planTotal (any excess, not just >10%).
  // Severity is tiered in CHECK_REGISTRY: >0% info, >5% warning, >10% significant.
  // Signal should fire at >0% to catch ALL cases, severity handled by CHECK_REGISTRY.
  let factExceedsPlan = false;
  if (!isNaN(planTotal) && planTotal > 0 && factTotal > planTotal && !canceled) {
    factExceedsPlan = true;
  }

  // ── Подвисший контракт: статус "Подписан/Заключён", нет факт даты, план дата (N) просрочена >30 дней ──
  // Порог снижен с 60→30 дней — 60 было слишком консервативно, пропускало реальные случаи.
  // Skip canceled rows.
  let stalledContract = false;
  if (signed && !hasFactDate && planDateParsed && !canceled) {
    const daysOverdue = daysDiff(now, planDateParsed); // now - planDate
    if (daysOverdue > 30) {
      stalledContract = true;
    }
  }

  // ── budgetMismatch: УДАЛЁН — дублирует правило budget_sum_plan (RULE_BOOK #1a) ──
  // Проверка K = H+I+J выполняется ТОЛЬКО через RULE_BOOK → validate.ts.
  // Сигнал оставлен как false для обратной совместимости интерфейса RowSignals.
  const budgetMismatch = false;

  // ── Факты без дат / Даты без фактов ──
  // factWithoutDate: есть суммы факта, но нет даты — данные неполные
  const factWithoutDate = hasFactAmounts && !hasFactDate && !canceled;
  // dateWithoutFact: есть факт дата, но нет факт сумм — ввели дату, забыли суммы
  const dateWithoutFact = hasFactDate && !hasFactAmounts && !canceled;

  // ── Факт дата раньше план даты ──
  // factDate < planDate on 1-30 day range (>30 → earlyClosure).
  // Previously excluded signed rows, but that filtered out ~95% of matches
  // because most rows with both dates ARE signed. Now checks ALL non-canceled rows.
  // For signed contracts, early fact date can still indicate a data entry error
  // (e.g., plan date was updated after the fact but the old plan date remained).
  let factDateBeforePlan = false;
  if (factDateParsed && planDateParsed && !canceled) {
    const diff = daysDiff(planDateParsed, factDateParsed); // planDate - factDate
    // factDate < planDate means diff > 0. Only flag 1-30 day range (not caught by earlyClosure).
    if (diff > 0 && diff <= 30) {
      factDateBeforePlan = true;
    }
  }

  // ── План без исполнения ──
  // Plan exists (K > 0, plan date set), no fact, plan date is in past, NOT overdue (overdue = no plan date or different path)
  // This catches rows that have a plan allocated but year is progressing and nothing happened.
  // Skip signed, canceled, planning, notDue rows — they have legitimate reasons.
  // Also skip rows already flagged as overdue (to avoid overlap).
  let planWithoutExecution = false;
  if (!isNaN(planTotal) && planTotal > 0 && !hasFact && !signed && !canceled && !planning && !notDue && !overdue) {
    // If we're past Q1 (April) and the row has no fact — flag it
    const currentMonth = now.getMonth(); // 0-indexed
    if (currentMonth >= 3) { // April+
      planWithoutExecution = true;
    }
  }

  // ── ЕП без обоснования ──
  // ЕП (sole source) requires justification in column M per 44-ФЗ.
  // Missing justification = compliance risk.
  // Skip canceled rows and rows with legitimate EP markers already detected.
  const epJustificationMissing = isEP && !canceled && epJustification.length === 0 && !isNaN(planTotal) && planTotal > 0;

  // ── Факт без плана (budget underallocation) ──
  // Y > 0 but K = 0 (or NaN) — execution without budget allocation.
  // This is a data integrity issue — spending money not in the plan.
  const budgetUnderallocation = factTotal > 0 && (isNaN(planTotal) || planTotal === 0) && !canceled;

  return {
    signed,
    planning,
    notDue,
    canceled,
    overdue,
    hasFact,
    planSoon,
    financeDelay,
    economyFlag,
    economyConflict,
    epRisk,
    dataQuality,
    formulaBroken,
    singleParticipant,
    highEconomy,
    lowCompetition,
    earlyClosure,
    factExceedsPlan,
    stalledContract,
    budgetMismatch,
    factWithoutDate,
    dateWithoutFact,
    factDateBeforePlan,
    planWithoutExecution,
    epJustificationMissing,
    budgetUnderallocation,
  };
}

/**
 * Классифицирует состояние строки на основе набора сигналов.
 * Приоритет состояний (от высшего к низшему):
 *   error → signed → canceled → overdue → has-fact → finance-delay → near-plan → planning → not-due → open → non-data
 *
 * @param signals — набор сигналов строки (результат detectSignals)
 * @returns RowState — единственная метка состояния
 *
 * Бизнес-логика:
 * - Ошибка данных перекрывает всё: если есть сломанная формула, строка в состоянии «error».
 * - Подписанная процедура — финальное состояние, дальнейший анализ не нужен.
 * - Отменённая процедура — исключена из активного мониторинга.
 * - Просрочка — критический сигнал для руководства.
 * - Далее по убыванию приоритета идут факт, финансовая задержка, скорый срок и т.д.
 */
export function classifyRowState(signals: RowSignals): RowState {
  // Ошибка данных — наивысший приоритет
  if (signals.formulaBroken) return 'error';

  // Финальные состояния
  if (signals.signed) return 'signed';
  if (signals.canceled) return 'canceled';

  // Критические
  if (signals.overdue) return 'overdue';

  // Промежуточные — есть факт
  if (signals.hasFact) return 'has-fact';

  // Задержка финансирования
  if (signals.financeDelay) return 'finance-delay';

  // Скорый срок
  if (signals.planSoon) return 'near-plan';

  // Планирование
  if (signals.planning) return 'planning';

  // Срок не наступил
  if (signals.notDue) return 'not-due';

  // Если нет ни одного сигнала состояния — открытая закупка
  if (signals.dataQuality) return 'error';

  return 'open';
}

/**
 * Формирует массив бейджей для отображения сигналов строки в UI.
 * Каждый бейдж содержит русскоязычную метку, цвет и иконку.
 *
 * @param signals — набор сигналов строки
 * @returns массив бейджей, отсортированных по важности (красные первыми)
 *
 * Бизнес-логика:
 * - Красные бейджи: просрочка, ЕП-риск, антидемпинг, ошибка формулы, конфликт экономии.
 * - Жёлтые: задержка финансирования, скорый срок, формальная конкуренция, пустые поля.
 * - Зелёные: подписано, есть факт, экономия.
 * - Синие: планирование, срок не наступил.
 * - Серые: отменено.
 */
export function getSignalBadges(signals: RowSignals): Array<SignalBadge> {
  const badges: SignalBadge[] = [];

  // ── Красные (критические) ──
  if (signals.overdue) {
    badges.push({ label: 'Просрочено', color: 'red', icon: 'alert-circle' });
  }
  if (signals.formulaBroken) {
    badges.push({ label: 'Ошибка формулы', color: 'red', icon: 'alert-triangle' });
  }
  if (signals.epRisk) {
    badges.push({ label: 'ЕП-риск', color: 'red', icon: 'shield-alert' });
  }
  if (signals.highEconomy) {
    badges.push({ label: 'Высокая экономия >25%', color: 'red', icon: 'trending-down' });
  }
  if (signals.economyConflict) {
    badges.push({ label: 'Флаг экономии', color: 'red', icon: 'alert-octagon' });
  }
  if (signals.factExceedsPlan) {
    badges.push({ label: 'Факт > план', color: 'red', icon: 'trending-up' });
  }
  if (signals.stalledContract) {
    badges.push({ label: 'Подвисший', color: 'yellow', icon: 'pause-circle' });
  }
  // budgetMismatch УДАЛЁН — дублирует правило budget_sum_plan (отображается через Issues)
  if (signals.earlyClosure) {
    badges.push({ label: 'Раннее закрытие', color: 'yellow', icon: 'fast-forward' });
  }

  // ── Жёлтые (предупреждения) ──
  if (signals.financeDelay) {
    badges.push({ label: 'Задержка финансирования', color: 'yellow', icon: 'clock' });
  }
  if (signals.planSoon) {
    badges.push({ label: 'Скоро срок', color: 'yellow', icon: 'calendar' });
  }
  if (signals.lowCompetition) {
    badges.push({ label: 'Низкая конкуренция <2%', color: 'yellow', icon: 'users' });
  }
  if (signals.singleParticipant) {
    badges.push({ label: '1 участник', color: 'yellow', icon: 'user' });
  }
  if (signals.dataQuality) {
    badges.push({ label: 'Пустые поля', color: 'yellow', icon: 'file-warning' });
  }
  if (signals.factDateBeforePlan) {
    badges.push({ label: 'Факт дата < план', color: 'yellow', icon: 'calendar-x' });
  }
  if (signals.planWithoutExecution) {
    badges.push({ label: 'План без исполнения', color: 'yellow', icon: 'calendar-off' });
  }
  if (signals.epJustificationMissing) {
    badges.push({ label: 'ЕП без обоснования', color: 'red', icon: 'file-x' });
  }
  if (signals.budgetUnderallocation) {
    badges.push({ label: 'Факт без плана', color: 'red', icon: 'banknote' });
  }

  // ── Зелёные (позитивные) ──
  if (signals.signed) {
    badges.push({ label: 'Подписано', color: 'green', icon: 'check-circle' });
  }
  if (signals.hasFact && !signals.signed) {
    badges.push({ label: 'Есть факт', color: 'green', icon: 'check' });
  }
  if (signals.economyFlag && !signals.economyConflict) {
    badges.push({ label: 'Экономия', color: 'green', icon: 'piggy-bank' });
  }

  // ── Синие (информационные) ──
  if (signals.planning) {
    badges.push({ label: 'Планирование', color: 'blue', icon: 'edit' });
  }
  if (signals.notDue) {
    badges.push({ label: 'Срок не наступил', color: 'blue', icon: 'hourglass' });
  }

  // ── Серые ──
  if (signals.canceled) {
    badges.push({ label: 'Отменено', color: 'gray', icon: 'x-circle' });
  }

  return badges;
}
