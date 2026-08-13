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

import { LAW_44FZ_THRESHOLDS, canonicalizeReasonEp, dayNumberOf, isProceduralMismatch, matchesActivityScope, parseSheetDate } from '@aemr/shared';
import { parseAE } from './ae-parser.js';

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
  /** Флаг экономии от уполномоченного органа: AD = «да» (канон столбца — «да»/«нет») */
  economyFlag: boolean;
  /** Конфликт флага экономии: (а) AD="да" но факт ≥ план; (б) экономия >15% но финансовый орган не определил флаг (AD не «да» и не «нет») */
  economyConflict: boolean;
  /** ЕП (колонка L) с суммой > 600 тыс. руб. — лимит одной закупки по п.4 ч.1 ст.93 44-ФЗ */
  epRisk: boolean;
  /** Пустые обязательные поля — проблема качества данных */
  dataQuality: boolean;
  /** Формула вернула ошибку (#REF, #VALUE, #N/A и т.д.) */
  formulaBroken: boolean;
  /** 1 участник — формальная конкуренция */
  singleParticipant: boolean;
  /** Высокая экономия (лимит−факт) > 25%. Внимание: это лимит−факт, НЕ НМЦ−факт. Антидемпинг по ст.37 44-ФЗ требует НМЦК, которой нет в данных */
  highEconomy: boolean;
  /** Экономия 0-2% (без точного равенства план==факт и без дубля singleParticipant) — формальная конкуренция */
  lowCompetition: boolean;
  /** Раннее закрытие — кандидат на опечатку даты: факт в предыдущем календарном году (при опережении >30 дн) либо опережение >180 дней */
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
  /**
   * Дата факта в БУДУЩЕМ — договор «уже заключён» позже сегодняшнего дня.
   * Физически невозможно: почти всегда опечатка оператора в годе. Найдено
   * расследованием 27.07.2026: строка УО (МБДОУ ДС № 37 «Белочка», томаты и
   * огурцы) с датой факта 15.07.2027 завышала официальный счёт ЕП на единицу
   * и не подсвечивалась ничем — правило будущей даты было только у плановой.
   */
  futureFactDate: boolean;
  /** План есть (K > 0, N задана), факта нет, год идёт — невыполненный план */
  planWithoutExecution: boolean;
  /** ЕП без обоснования: метод ЕП, но столбец M (обоснование) пуст */
  epJustificationMissing: boolean;
  /** Процедурный мисматч: ЕП, но обоснование (M) = «малая электронная закупка» — это процедура ЭА≤600тыс, не основание ЕП */
  methodReasonMismatch: boolean;
  /** Обоснование ЕП (M) не распознано среди 15 кластеров или расплывчато («действующее законодательство») */
  unmappedReasonEP: boolean;
  /** Факт без плана: Y > 0, но K = 0 — бюджетная аномалия */
  budgetUnderallocation: boolean;
  /** Источники бюджета не указаны: H/I/J все пусты/нули, но K > 0 */
  budgetSourceMissing: boolean;
  /**
   * ТД с заполненной графой программы (ТД-ПМ). Вводная пользователя 06.08:
   * возможно, это ошибка заполнения, а не отдельная категория — строка либо
   * на деле программная (исправить вид деятельности F), либо графа программы
   * D заполнена ошибочно. Канон среза — matchesActivityScope('td_pm', F, D).
   */
  tdWithProgram: boolean;
  /**
   * Счётная строка без года плана (P пусто). Наш движок относит её к
   * отчётному году (нестрогий год), а SUMIFS листа СВОД считают год строго
   * и строку НЕ видят — официальный лимит занижен ровно на её сумму.
   * Найдено 06.08.2026 сверкой лимита УЭР: 5 строк на 589,93 тыс. руб.
   * давали расхождение 13 921 против 13 331 листа.
   */
  planYearMissing: boolean;
  /**
   * Дата факта есть, а планового квартала (O) нет или он невалиден.
   * Печатный год отчёта = Σ плановых кварталов — строка из него выпадает,
   * на Пульте живёт только в корзине «без квартала». Замер 07.08.2026:
   * одна строка УДТХ на 67 666,68 тыс. — всё расхождение годовых чисел.
   */
  factQuarterMissing: boolean;
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

/**
 * Порог ЕП-риска в ТЫС. РУБ. (= 600 тыс. руб.): лимит одной закупки по п.4 ч.1
 * ст.93 44-ФЗ. Колонка K (planTotal ниже) хранит суммы в тыс. руб. — канон
 * @aemr/shared/report-map.ts. До fix bug-hunt 2026-08-08 (БАГ #1) порог был
 * в рублях (600_000) при planTotal в тысячах: epRisk не выставлялся никогда
 * (требовался контракт на 600 млн руб.).
 */
const EP_RISK_THRESHOLD = LAW_44FZ_THRESHOLDS.epSmallPurchaseSingleContractLimitThousandRub;

/** Антидемпинговый порог экономии (44-ФЗ ст.37): канон LAW_44FZ_THRESHOLDS.antiDumpingSavingsShare (доля 0.25) → ×100, т.к. economyPct ниже считается в процентах. */
const ANTI_DUMPING_PERCENT = LAW_44FZ_THRESHOLDS.antiDumpingSavingsShare * 100;

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
 * Номер календарных суток ячейки — основа ВСЕЙ датной арифметики этого модуля.
 *
 * TZ-fix 2026-07-20 (триаж 15.07): разница Date-объектов (бывший daysDiff) давала
 * ±1 на дальних поясах, потому что parseSheetDate возвращает serial как UTC-полночь,
 * а «дд.мм.гггг» — как ЛОКАЛЬНУЮ полночь; смешанные формы записи в одном сравнении
 * рассинхронизировались, и «дедлайн сегодня» светился просрочкой. dayNumberOf
 * (@aemr/shared) выводит целый номер суток из КОМПОНЕНТОВ записи — форма и пояс
 * машины не влияют. Fallback через parseSheetDate покрывает экзотические строки,
 * которые понимает только new Date(s): их локальные компоненты воспроизводят
 * календарный день, задуманный оператором.
 */
function toDayNumber(val: unknown): number | null {
  const day = dayNumberOf(val);
  if (day !== null) return day;
  const parsed = parseSheetDate(val);
  return parsed ? dayNumberOf(parsed) : null;
}

/** UTC-год по номеру суток (earlyClosure: сравнение календарных лет план/факт). */
function utcYearOfDay(day: number): number {
  return new Date(day * 86400000).getUTCFullYear();
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
  // Календарный «сегодня» как номер суток — по ЛОКАЛЬНЫМ компонентам now
  // (календарный день пользователя). FP-fix 2026-07-16 (signal_audit §3.7): время
  // суток внутри now давало off-by-one — дедлайн «сегодня» (N=15.07 при прогоне
  // 15.07 вечером) помечался просроченным; просрочка — строго со следующего дня.
  // TZ-fix 2026-07-20: арифметика ниже — на целых номерах суток (toDayNumber).
  const todayDay = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) / 86400000;

  // ── Текстовые поля ──
  // Колонки по живой шапке книг (аудит 30.07, 3 828 строк): U — «Причина
  // отклонения», AE — «Обоснование необходимости», AF — «Комментарий ГРБСа».
  // Статусные фразы («договор заключен», «планирование») живут в AF: до
  // исправления статус искали в U + AE, и продукт видел признак «подписан»
  // в 208 строках из 2 464 — 2 256 подписанных закупок показывались как
  // «Исполнение», 66 % строк несли чужое состояние.
  const statusText = cellText(cells, 'U');
  const adText = cellText(cells, 'AD');
  const aeText = cellText(cells, 'AE');
  const afText = cellText(cells, 'AF');
  const grbsComment = aeText + ' ' + afText;
  // AE-parser: дата факта и правовое основание ЕП часто лежат в обосновании
  // и комментарии (SIGNAL_VALIDATION §1, корень №3) — разбираем оба.
  const aeParsed = parseAE(grbsComment);
  const methodText = cellText(cells, 'L');
  // Статус ищем во всех трёх текстах: U (причина), AE (обоснование —
  // операторы и туда пишут статусные фразы), AF (комментарий ГРБСа).
  const statusAndComment = statusText + ' ' + grbsComment;

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
  const planDay = toDayNumber(cells['N']);
  const factDay = toDayNumber(cells['Q']);

  // Факт суммы > 0 ИЛИ есть факт дата
  const hasFactAmounts = factTotal > 0;
  const hasFactDate = factDay !== null;
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
  const hasScheduleTransfer = textIncludes(grbsComment, [
    'переносится на', 'планируется на', 'планирование на',
    'перенос', 'перенесен', 'перенесён', 'отложен', 'переносится',
    // Операторы пишут перенос срока ещё и так (SIGNAL_VALIDATION §4):
    'срок изменён', 'срок изменен', 'изменён на', 'изменен на',
  ]);

  if (planDay !== null) {
    const daysUntilPlan = planDay - todayDay;

    // Просрочено: плановая дата прошла, нет факта, не подписан, не отменён,
    // НЕ в статусе «планирование»/«срок не наступил» (это forward план-график —
    // запланированная позиция, чья дата только что прошла, ещё не просрочка),
    // и нет известного переноса срока.
    // FP-fix 2026-06-05 (SIGNAL_VALIDATION §4): без !planning/!notDue сигнал давал
    // ~90% ложных Критических на сезонных план-графиках (УО 51/52).
    if (
      daysUntilPlan < 0 &&
      !hasFact &&
      !signed &&
      !canceled &&
      !hasScheduleTransfer &&
      !planning &&
      !notDue
    ) {
      overdue = true;
    }

    // Скоро срок: плановая дата в ближайшие 14 дней (и ещё не прошла)
    if (daysUntilPlan >= 0 && daysUntilPlan <= PLAN_SOON_DAYS && !signed && !canceled && !hasFact) {
      planSoon = true;
    }
  }

  // ── Финансирование (AE/AF) ──
  // "перенос" alone is too broad — it catches schedule changes, not just finance delays.
  // FP-fix 2026-07-16 (signal_audit §3.8): ложные классы подстроки «финансир» вырезаются
  // из текста ДО поиска — «софинансир*» (доведение софинансирования — не задержка),
  // «добавлени* финансирования» (сумму увеличили), «финансировани[ея] дефицита» (слово
  // в предмете закупки-кредита). Ядро («нет/отсутствие/после доведения финансирования»)
  // остаётся: если рядом с исключённой фразой есть честное «финансир» — сигнал живёт.
  // \w в JS не матчит кириллицу — только явный класс [а-яё].
  const financeText = grbsComment
    .replace(/софинансир[а-яё]*/g, '')
    .replace(/добавлени[а-яё]*\s+финансировани[а-яё]*/g, '')
    .replace(/финансировани[ея]\s+дефицита/g, '');
  const financeDelay = financeText.includes('финансир');

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
  // Канон столбца AD — «да»/«нет» (правило status_on_data_rows + calc-engine
  // GATE_ECONOMY_APPROVED: adFlag === 'да' || 'yes'). Техбаг-fix 2026-07-16
  // (signal_audit §3.1): старый поиск подстроки «эконом» никогда не матчил канон —
  // economyFlag был вечно false, случай (а) конфликта мёртв, зелёный бейдж «Экономия»
  // не показывался, а случай (б) давал 77 ложных срабатываний на строках с AD=да/нет.
  const economyFlag = adText === 'да' || adText === 'yes';
  // Флаг определён = орган принял решение («да» ИЛИ «нет»). Пусто/Х/· — не определён.
  const economyFlagDetermined = economyFlag || adText === 'нет' || adText === 'no';

  // Конфликт флага экономии:
  // (а) AD="да", но факт >= план — некорректный флаг;
  // (б) существенная экономия >15%, но финансовый орган НЕ определил флаг (AD пуст/Х/·).
  //     AD="нет" — это решение органа («экономией не является»), не пробел данных.
  //     EXCEPT for ЕП: economy on ЕП is just underspend vs allocation (лимит), not competitive savings.
  //     Missing AD flag on ЕП is normal and NOT an error.
  // Skip if factTotal === 0 — row hasn't been executed yet, no meaningful conflict possible.
  let economyConflict = false;
  if (!isNaN(planTotal) && planTotal > 0 && factTotal > 0) {
    const hasEconomyByNumbers = factTotal < planTotal;
    if (economyFlag && factTotal >= planTotal) {
      // Помечена экономия (AD=да), но факт >= план
      economyConflict = true;
    } else if (!economyFlagDetermined && hasEconomyByNumbers && !isEP) {
      // Есть числовая экономия, но орган не определил флаг.
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
  const planDateInPast = planDay !== null && planDay < todayDay;
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
    // FP-fix 2026-07-16 (signal_audit §3.2): 242 из 274 срабатываний были «план == факт
    // копейка-в-копейку» — операторы вписывают в план сумму заключённого контракта,
    // экономия 0% — арифметический артефакт заполнения, не мера конкуренции. Точное
    // равенство гасим. Ещё 12 дублировали singleParticipant (несостоявшиеся аукционы) —
    // дубль тоже гасим, сигнал «1 участник» информативнее.
    if (economyPct >= 0 && economyPct < LOW_COMPETITION_PERCENT
      && factTotal !== planTotal && !singleParticipant) {
      lowCompetition = true;
    }
  }

  // ── Раннее закрытие: кандидат на опечатку в дате ──
  // FP-fix 2026-07-16 (signal_audit §3.5): порог «>30 дней» шумел — 73 из 74 срабатываний
  // были нормальным ранним исполнением против квартальных план-дат (30.03/30.06/…).
  // Полезный сигнал прячется в экстремумах: смена календарного года (УД стр.101:
  // факт 15.04.2025 при плане 30.04.2026 — вероятна опечатка года) или разрыв > 180 дней.
  let earlyClosure = false;
  if (factDay !== null && planDay !== null && !canceled) {
    const diff = planDay - factDay; // planDate - factDate, в сутках
    // Смена года: факт в предыдущем календарном году относительно плана. Гард diff > 30
    // отсекает нормальное заключение декабрь→январь через Новый год.
    const yearJump = utcYearOfDay(factDay) < utcYearOfDay(planDay);
    // Retroactive date entry filter: if planDate is in the future, the dates may have been
    // entered retroactively (common in СВОД — operators fill in dates after the fact).
    const planInPast = todayDay > planDay; // now > planDate
    if (yearJump && diff > 30) {
      earlyClosure = true;
    } else if (diff > 180 && planInPast) {
      earlyClosure = true;
    }
  }

  // ── Дата факта в будущем: опечатка в годе ──
  // Гейт «сегодня» тот же, что у остальных дат-правил (todayDay), поэтому
  // сигнал не зависит от режима просмотра: он про качество данных, а не про
  // срез. Отменённые строки не трогаем — их даты могут быть мусорными.
  const futureFactDate = factDay !== null && !canceled && factDay > todayDay;

  // ── Факт > план ──
  // Skip canceled rows — their data may be stale/incorrect.
  // FP-fix 2026-06-05 (SIGNAL_VALIDATION §4): допуск 0.5% против округлительного шума —
  // план хранится в 2 знака, факт в 5, давало «Существенное» на превышении в 3.75 ₽ (УИО r24/25).
  // GAS гасил это допуском *1.05; берём более строгие *1.005.
  let factExceedsPlan = false;
  if (!isNaN(planTotal) && planTotal > 0 && factTotal > planTotal * 1.005 && !canceled) {
    factExceedsPlan = true;
  }

  // ── Подвисший контракт: статус "Подписан/Заключён", нет факт даты, план дата (N) просрочена >30 дней ──
  // Порог снижен с 60→30 дней — 60 было слишком консервативно, пропускало реальные случаи.
  // Skip canceled rows.
  let stalledContract = false;
  if (signed && !hasFactDate && planDay !== null && !canceled) {
    const daysOverdue = todayDay - planDay; // now - planDate
    if (daysOverdue > 30) {
      stalledContract = true;
    }
  }

  // ── budgetMismatch: УДАЛЁН — дублирует правило budget_sum_plan (RULE_BOOK #1a) ──
  // Проверка K = H+I+J выполняется ТОЛЬКО через RULE_BOOK → validate.ts.
  // Сигнал оставлен как false для обратной совместимости интерфейса RowSignals.
  const budgetMismatch = false;

  // ── ТД с заполненной графой программы (ТД-ПМ) — возможная ошибка заполнения ──
  const tdWithProgram = matchesActivityScope('td_pm', cells['F'], cells['D']);

  // ── Счётная строка без года плана (P) — невидима для формул СВОДа ──
  // Гейт «счётная»: есть способ закупки и плановые деньги — ровно такие
  // строки движок учитывает в отчётном году по нестрогому правилу, а лист
  // СВОД (строгий SUMIFS по году) молча теряет. «Х»/«-» — та же пустота:
  // операторы ставят заглушку вместо года.
  const planYearText = cellText(cells, 'P');
  const planYearEmpty = planYearText === '' || planYearText === 'х' || planYearText === 'x' || planYearText === '-';
  const planYearMissing = planYearEmpty && methodText !== '' && !isNaN(planTotal) && planTotal > 0 && !canceled;

  // Факт без планового квартала (блок А п.2): дата факта проставлена, а O
  // пуст/невалиден — строка выпадает из печатного года (Σ кварталов).
  const planQuarterNum = Number(cellText(cells, 'O').replace(',', '.'));
  const factQuarterMissing = hasFactDate && !canceled
    && !(planQuarterNum >= 1 && planQuarterNum <= 4);

  // ── Факты без дат / Даты без фактов ──
  // factWithoutDate: есть суммы факта, но нет даты — данные неполные
  // FP-fix 2026-06-05 (SIGNAL_VALIDATION §1): не флажить, если дата факта есть в комментарии AE
  // («01.02.2026 заключен контракт») — ≈73% «Факт суммы без даты» были ложными по этой причине.
  // FP-fix 2026-07-16 (signal_audit §3.6): периодические закупки «в течение года по мере
  // необходимости» (план-дата 30/31.12) по практике заполнения не имеют канонической
  // единственной даты факта — все 14 срабатываний прогона 15.07 были этим классом.
  // Проверяем комментарии (AE/AF) и обоснование (M); «в течении» — реальная опечатка операторов.
  const isPeriodicPurchase = textIncludes(grbsComment + ' ' + epJustification, [
    'в течение года', 'в течении года', 'по мере необходимости', 'по мере возникновения',
  ]);
  const factWithoutDate = hasFactAmounts && !hasFactDate && !canceled
    && !aeParsed.hasContractDate && !isPeriodicPurchase;
  // dateWithoutFact: есть факт дата, но нет факт сумм — ввели дату, забыли суммы
  const dateWithoutFact = hasFactDate && !hasFactAmounts && !canceled;

  // ── Факт дата раньше план даты ──
  // factDate < planDate on 1-30 day range (>30 → earlyClosure).
  // Previously excluded signed rows, but that filtered out ~95% of matches
  // because most rows with both dates ARE signed. Now checks ALL non-canceled rows.
  // For signed contracts, early fact date can still indicate a data entry error
  // (e.g., plan date was updated after the fact but the old plan date remained).
  let factDateBeforePlan = false;
  // FP-fix 2026-06-05 (SIGNAL_VALIDATION §4): только конкурентные методы. Для ЕП (ст.93)
  // нет извещения и 10-дневной паузы — досрочное заключение договора законно, не аномалия (~88% FP).
  if (factDay !== null && planDay !== null && !canceled && !isEP) {
    const diff = planDay - factDay; // planDate - factDate, в сутках
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
  // FP-fix 2026-06-05 (SIGNAL_VALIDATION §4): контингентные закупки «при необходимости»
  // (напр. резервный кредит УФБП на 32 млн) законно не имеют даты/исполнения — не «невыполненный план».
  const isContingent = textIncludes(grbsComment, ['при необходимости', 'по мере', 'в случае возникновения', 'в случае необходимости']);
  let planWithoutExecution = false;
  if (!isNaN(planTotal) && planTotal > 0 && !hasFact && !signed && !canceled && !planning && !notDue && !overdue && !isContingent) {
    // Gate: plan date must exist AND be in the past (>30 days ago to avoid noise on recent plans)
    // Without this gate, signal fires on 48% of rows including future-dated plans.
    if (planDay !== null) {
      const daysSincePlan = todayDay - planDay; // now - planDate
      if (daysSincePlan > 30) {
        planWithoutExecution = true;
      }
    } else {
      // No plan date but plan sum exists — only flag after April (Q2+) as before
      const currentMonth = now.getMonth(); // 0-indexed
      if (currentMonth >= 3) { // April+
        planWithoutExecution = true;
      }
    }
  }

  // ── ЕП без обоснования ──
  // ЕП (sole source) requires justification in column M per 44-ФЗ.
  // Missing justification = compliance risk.
  // Skip canceled rows and rows with legitimate EP markers already detected.
  // FP-fix 2026-06-05 (SIGNAL_VALIDATION §1): не «нарушение», если основание ЕП есть в комментарии AE
  // («Не учитывается по п.4 ч.1 ст.93») — УД r35 был ложным обвинением.
  const epJustificationMissing =
    isEP && !canceled && epJustification.length === 0 && !aeParsed.hasLegalBasis && !isNaN(planTotal) && planTotal > 0;

  // ── Классификация обоснования ЕП (M) по 15 каноническим кластерам (ep-reason-clusters) ──
  // Воскрешает 2 сигнала, потерянных при удалении signals-taxonomy.ts (DEADCODE_DISPOSITION_2026-06-05).
  // ReDoS-cap 2000 символов (SECURITY S-M5: regex некоторых кластеров содержат .*).
  const epReasonCluster = isEP ? canonicalizeReasonEp(epJustification.slice(0, 2000)).cluster : 'EMPTY';
  // methodReasonMismatch: ЕП + обоснование = процедура «малая электронная закупка» (EP_SMALL_EL_PURCH)
  const methodReasonMismatch =
    isEP && !canceled && epReasonCluster !== 'EMPTY' && epReasonCluster !== 'UNMAPPED' && isProceduralMismatch(epReasonCluster);
  // unmappedReasonEP: ЕП + обоснование не распознано (UNMAPPED) или расплывчатое (EP_CURRENT_LAW)
  const unmappedReasonEP =
    isEP && !canceled && (epReasonCluster === 'UNMAPPED' || epReasonCluster === 'EP_CURRENT_LAW');

  // ── Факт без плана (budget underallocation) ──
  // Y > 0 but K = 0 (or NaN) — execution without budget allocation.
  // This is a data integrity issue — spending money not in the plan.
  const budgetUnderallocation = factTotal > 0 && (isNaN(planTotal) || planTotal === 0) && !canceled;

  // ── Источники бюджета не указаны ──
  // H/I/J (columns 7,8,9 = ФБ/КБ/МБ план) все пусты/нули, но K (column 10 = план итого) > 0.
  // Это значит, что итого плана есть, но разбивка по бюджетам не заполнена.
  const planFB = toNumber(cells['H']);
  const planKB = toNumber(cells['I']);
  const planMB = toNumber(cells['J']);
  const budgetSourceMissing = !isNaN(planTotal) && planTotal > 0 && !canceled &&
    (isNaN(planFB) || planFB === 0) &&
    (isNaN(planKB) || planKB === 0) &&
    (isNaN(planMB) || planMB === 0);

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
    tdWithProgram,
    planYearMissing,
    factQuarterMissing,
    dateWithoutFact,
    factDateBeforePlan,
    futureFactDate,
    planWithoutExecution,
    epJustificationMissing,
    methodReasonMismatch,
    unmappedReasonEP,
    budgetUnderallocation,
    budgetSourceMissing,
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
  if (signals.futureFactDate) {
    badges.push({ label: 'Дата факта в будущем', color: 'red', icon: 'calendar-x' });
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
  if (signals.tdWithProgram) {
    badges.push({ label: 'ТД с программой', color: 'yellow', icon: 'git-branch' });
  }
  if (signals.planYearMissing) {
    badges.push({ label: 'Без финансирования', color: 'yellow', icon: 'calendar-x' });
  }
  if (signals.factQuarterMissing) {
    badges.push({ label: 'Факт без квартала', color: 'yellow', icon: 'calendar-x' });
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
  if (signals.budgetSourceMissing) {
    badges.push({ label: 'Нет разбивки бюджета', color: 'yellow', icon: 'wallet' });
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
