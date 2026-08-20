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

import {
  LAW_44FZ_THRESHOLDS,
  PLAN_SOURCE_COLUMNS,
  SIGNAL_LABELS,
  canonicalizeReasonEp,
  dayNumberOf,
  economyFlagVerdict,
  isAbsentCell,
  isProceduralMismatch,
  parseSheetDate,
} from '@aemr/shared';
import { sheetNumber } from '../timeline/row-timeline.js';
// parseAE снят 14.08.2026 (канон п.27 интервью): дата контракта и правовое
// основание из комментариев (AE/AF) — машинная интерпретация свободного
// текста, которая запрещена решением владельца.

// ────────────────────────────────────────────────────────────
// Типы
// ────────────────────────────────────────────────────────────

/**
 * Аналитические сигналы строки закупки.
 * Каждый флаг — результат детерминированной проверки одной строки.
 *
 * КАНОН п.27 (интервью 14.08.2026, решение владельца ДОСЛОВНО): свободный
 * текст исполнителей (U «Причина отклонения», AE «Обоснование необходимости»,
 * AF «Комментарий ГРБСа») машинно НЕ интерпретируется НИГДЕ — «то, что они
 * там пишут, отдельный смысл». Статус строки выводится ТОЛЬКО из структурных
 * колонок: даты (N, Q), суммы (H–K, V–Y), отметки (L, O, P, AD). Комментарий
 * показывается как есть. Живой урон старого чтения текста: «не заключен»
 * читался как «подписан» (баг #16 охоты 08.08, пп.40–41 интервью), «отменён»
 * гасил сигналы состоявшейся закупки.
 *
 * ВОСЕМЬ ВЕЧНО-ЛОЖНЫХ ПОЛЕЙ — единое объяснение (чистка 20.08.2026, зона В;
 * у самих полей — только пометка со ссылкой сюда): planning, notDue,
 * canceled, financeDelay, singleParticipant, stalledContract сняты каноном
 * п.27 (признак жил только в свободном тексте, структурного эквивалента в
 * книгах нет); tdWithProgram снят каноном п.30 (заполненная программа у ТД —
 * норма); budgetMismatch удалён как дубль правила budget_sum_plan из
 * RULE_BOOK. detectSignals выставляет их константой false — бейджи и
 * состояния по ним больше не рождаются.
 *
 * УБРАТЬ поля из типа нельзя — старые данные читаются по этим именам:
 *  — замечания (issues) в SQLite живут с category 'signal:stalledContract',
 *    'signal:budgetMismatch', 'signal:financeDelay' и т.п.; trust/scorer.ts
 *    и shared/issue-conversion читают эти категории и сегодня;
 *  — procurement_rows.row_state старых снимков хранит состояния 'planning',
 *    'not-due', 'canceled', 'finance-delay', выводившиеся из этих полей, —
 *    их члены в RowState ниже держатся той же совместимостью;
 *  — SIGNAL_LABELS (@aemr/shared) и веб (mechanism-groups, Dashboard)
 *    подписывают исторические ключи по этим же именам.
 * Совместимость старых снимков дороже восьми строк типа.
 */
export interface RowSignals {
  /** Контракт заключён: дата заключения (Q) проставлена и разобрана — единственный структурный признак «подписан» (канон п.27) */
  signed: boolean;
  /** ВСЕГДА false — см. блок «восемь вечно-ложных полей» в шапке интерфейса. */
  planning: boolean;
  /** ВСЕГДА false — см. блок «восемь вечно-ложных полей» в шапке интерфейса. */
  notDue: boolean;
  /** ВСЕГДА false — см. блок «восемь вечно-ложных полей» в шапке интерфейса. */
  canceled: boolean;
  /** Просрочена: плановая дата прошла, факта (дата или суммы) нет */
  overdue: boolean;
  /** Есть фактические данные: факт дата ИЛИ факт суммы > 0 */
  hasFact: boolean;
  /** Плановая дата наступит в ближайшие 14 дней */
  planSoon: boolean;
  /** ВСЕГДА false — см. шапку интерфейса; необеспеченность финансированием живёт в planYearMissing (структурная колонка P). */
  financeDelay: boolean;
  /** Флаг экономии от уполномоченного органа: AD = «да» (канон столбца — «да»/«нет») */
  economyFlag: boolean;
  /**
   * Конфликт флага экономии: в графе «Статус» (AD) стоит «да», а факт не ниже
   * плана — экономии по числам нет.
   *
   * Второй случай («экономия 15–25 % без решения органа») отсюда снят
   * 21.08.2026: он был узкой полосой явления «Экономия без отметки» и жил под
   * вторым именем. Явление получило единый дом (@aemr/shared economy-flag.ts)
   * и собственный признак economyFlagUndetermined ниже.
   */
  economyConflict: boolean;
  /**
   * «Экономия без отметки» — план и факт заполнены, факт меньше плана, а в
   * графе «Статус» (AD) нет ни «да», ни «нет».
   *
   * Определение НЕ живёт здесь: оно одно на продукт и лежит в
   * @aemr/shared economy-flag.ts, откуда его берут и правило листа
   * status_on_data_rows, и карточка «Экономии», и срез Реестра. До
   * консолидации 21.08.2026 одно и то же положение дел считалось тремя
   * способами под тремя именами и давало три разных числа.
   */
  economyFlagUndetermined: boolean;
  /** ЕП (колонка L) с суммой > 600 тыс. руб. — лимит одной закупки по п.4 ч.1 ст.93 44-ФЗ */
  epRisk: boolean;
  /** Пустые обязательные поля — проблема качества данных */
  dataQuality: boolean;
  /** Формула вернула ошибку (#REF, #VALUE, #N/A и т.д.) */
  formulaBroken: boolean;
  /** ВСЕГДА false — см. блок «восемь вечно-ложных полей» в шапке интерфейса. */
  singleParticipant: boolean;
  /** Высокая экономия (лимит−факт) > 25%. Внимание: это лимит−факт, НЕ НМЦ−факт. Антидемпинг по ст.37 44-ФЗ требует НМЦК, которой нет в данных */
  highEconomy: boolean;
  /** Экономия 0-2% (без точного равенства план==факт и без дубля singleParticipant) — формальная конкуренция */
  lowCompetition: boolean;
  /** Раннее закрытие — кандидат на опечатку даты: факт в предыдущем календарном году (при опережении >30 дн) либо опережение >180 дней у конкурентного способа (у ЕП опережение мягкой плановой даты нормально, гейт 18.08.2026, В-9) */
  earlyClosure: boolean;
  /** Факт > план на >10% */
  factExceedsPlan: boolean;
  /**
   * По ЕП факт обязан равняться плану, а расходится (канон п.98м + п.102,
   * 18.08.2026). По ЕП в план (K) пишут планируемую сумму договора, «которая
   * по идее должна соответствовать потраченной» (Y) — тезис владельца: «по ЕП
   * не может быть экономии», торгов нет. Расхождение в любую сторону сверх
   * допуска округления — ошибка заполнения либо «экономия», которой по ЕП
   * быть не должно. Конкурентные способы сигнал не трогает: там план = НМЦК,
   * и факт < план — нормальная торговая экономия.
   */
  epFactDeviation: boolean;
  /** ВСЕГДА false — см. блок «восемь вечно-ложных полей» в шапке интерфейса. */
  stalledContract: boolean;
  /** @deprecated ВСЕГДА false — дубль правила budget_sum_plan (RULE_BOOK); см. шапку интерфейса. */
  budgetMismatch: boolean;
  /** Есть факт суммы но нет факт даты */
  factWithoutDate: boolean;
  /** Есть факт дата но нет факт сумм — потенциальное отсутствие данных */
  dateWithoutFact: boolean;
  /** Факт дата раньше плановой — ИНФОРМАЦИОННЫЙ сигнал (п.28 интервью 14.08.2026: «это не ошибка» — плановая дата ориентир, раннее заключение допустимо) */
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
  /** ВСЕГДА false (канон п.30) — см. блок «восемь вечно-ложных полей» в шапке интерфейса. */
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
   * Сломана формула производной даты. Канон п.93/45: рукописны только N
   * (план) и Q (факт); O/P и R/S считаются формулами от них. Если источник
   * заполнен датой, а производная пуста — формула в ячейке стёрта (формула
   * с датой в источнике не может дать пусто). Обратный перекос — производная
   * заполнена при пустом источнике — та же поломка (значение без формулы).
   * Живой пример 18.08.2026: УКСиМП строки 280/283 — N=30.11.2026/31.08.2026,
   * в O и P нет даже формулы; система ложно звала их «не обеспеченными
   * финансированием» (жалоба оператора: «все данные заполнены и сверены»).
   */
  derivedFormulaBroken: boolean;
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
 * Пункты ч.1 ст.93 44-ФЗ, при ссылке на которые лимит одной закупки в 600 тыс.
 * руб. неприменим: он живёт только в п.4 (и п.5 для учреждений культуры и
 * образования). Состав множества — ровно тот, что перечислял прежний список
 * `isLegitimateEP` строками «п.8», «п.1 ч.1», «п.6 ч.1», «п.29»; нового
 * правового суждения здесь не вводится.
 */
const ART93_POINTS_WITHOUT_SUM_LIMIT = new Set([1, 6, 8, 29]);

/**
 * Ссылка на пункт ч.1 ст.93 в любой живой записи операторов:
 * «п.6 ч. 1 ст. 93», «п. 8 ч. 1 ст. 93 44-ФЗ», «п.29 ч.1 ст.93».
 *
 * Прежний способ — поиск подстрок «п.8»/«п.6 ч.1» — ломался о пробел после
 * «ч.»: живая строка УАГЗО стр.9 № 42 («Услуги оказываются в соответствии с
 * п.6 ч. 1 ст. 93 ФЗ-44 ГАУ „Государственная экспертиза“», план 3 078,96 тыс.)
 * получала красное «ЕП свыше 600 тыс.», хотя её основание список как раз
 * собирался признать законным. Требование «ст. 93» рядом обязательно: без него
 * подстрока «п.8» ловила ещё и «пп. 8, п.1 Распоряжения АЕМР № 112» —
 * распоряжение администрации лимит 44-ФЗ не снимает.
 *
 * Проверено на живых книгах 19.08.2026 (E:/aemr-dumps/book-dumps, 3 885 строк
 * восьми управлений): среди 146 строк ЕП дороже 600 тыс. правило гасит ровно
 * одну — ту самую УАГЗО стр.9, и ни одной новой не зажигает.
 */
function citesUnlimitedArt93Point(text: string): boolean {
  const re = /п\.?\s*(\d{1,2})\s*ч\.?\s*1\s*ст\.?\s*93/gu;
  let match = re.exec(text);
  while (match !== null) {
    if (ART93_POINTS_WITHOUT_SUM_LIMIT.has(Number(match[1]))) return true;
    match = re.exec(text);
  }
  return false;
}

/**
 * Извлекает числовое значение из ячейки.
 * Обрабатывает: number, строку с пробелами/запятыми, пустые значения.
 * Возвращает NaN если невозможно распознать число.
 *
 * Тонкая обёртка над единой коэрцией ядра sheetNumber (чистка 20.08.2026,
 * зона В): семантика совпадает («мусор → null»), здесь null переводится в
 * NaN — весь модуль исторически проверяет isNaN, переписывать десятки
 * проверок ради формы «null» незачем.
 */
function toNumber(val: unknown): number {
  return sheetNumber(val) ?? NaN;
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
 * Бизнес-логика (после канона п.27 от 14.08.2026):
 * - Статус строки — ТОЛЬКО структурные колонки: «заключено» = дата Q,
 *   «есть факт» = дата Q или суммы V–Y. Свободный текст (U/AE/AF) не читается.
 * - Временны́е сигналы (overdue, planSoon) — сравнение плановой даты (столбец N)
 *   с текущей датой.
 * - Финансовые сигналы (epRisk, highEconomy, lowCompetition, economyConflict) —
 *   арифметические проверки сумм.
 * - Сигналы качества (dataQuality, formulaBroken) — полнота и корректность данных.
 * - Поле M («Обоснование ЕП») — обязательное правовое поле ст.93 44-ФЗ, а не
 *   комментарий: проверки его ЗАПОЛНЕННОСТИ и классификация по каноническим
 *   кластерам словаря (EP_REASON_DICT) остаются — они про качество самого
 *   поля, а не про вывод статуса строки из текста.
 */
export function detectSignals(cells: Record<string, unknown>, today?: Date): RowSignals {
  const now = today ?? new Date();
  // Календарный «сегодня» как номер суток — по ЛОКАЛЬНЫМ компонентам now
  // (календарный день пользователя). FP-fix 2026-07-16 (signal_audit §3.7): время
  // суток внутри now давало off-by-one — дедлайн «сегодня» (N=15.07 при прогоне
  // 15.07 вечером) помечался просроченным; просрочка — строго со следующего дня.
  // TZ-fix 2026-07-20: арифметика ниже — на целых номерах суток (toDayNumber).
  const todayDay = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) / 86400000;

  // ── Структурные поля ──
  // КАНОН п.27 (интервью 14.08.2026): свободный текст исполнителей — U
  // «Причина отклонения», AE «Обоснование необходимости», AF «Комментарий
  // ГРБСа» — здесь НЕ читается вовсе. Ни статус, ни дата, ни смягчение
  // сигналов из него не выводятся; комментарий показывается как есть.
  // Урок класса: «не заключен» матчился подстрокой «заключен» и делал строку
  // подписанной (баг #16 охоты 08.08), «отменён» при состоявшейся закупке
  // гасил её сигналы (п.41).
  // Графа «Статус» (AD) читается не здесь, а каноном economy-flag.ts —
  // единственным домом чтения этой отметки (консолидация 21.08.2026).
  const methodText = cellText(cells, 'L');

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

  // ── Статусные сигналы — только структура (канон п.27, 14.08.2026) ──
  // «Заключено» = дата заключения (Q) проставлена и разобрана. Подстрочный
  // поиск «подписан/заключен/исполнен» по U/AE/AF снят: он читал «не заключен»
  // как «подписан» (баг #16 охоты 08.08; живые подтверждения — пп.40–41
  // интервью 14.08). Текстовых статусов «планирование», «срок не наступил»,
  // «отменена» структурного эквивалента в книгах нет — сигналы сняты.
  const signed = hasFactDate;
  const planning = false;
  const notDue = false;
  const canceled = false;

  // ── Временны́е сигналы ──
  let overdue = false;
  let planSoon = false;

  if (planDay !== null) {
    const daysUntilPlan = planDay - todayDay;

    // Просрочено — чисто структурно: плановая дата прошла, факта нет.
    // Текстовые смягчители («переносится на…», «планирование», «срок не
    // наступил») сняты каноном п.27: их место — в колонке комментария,
    // которая показывается читателю как есть, а не в машинном статусе.
    if (daysUntilPlan < 0 && !hasFact) {
      overdue = true;
    }

    // Скоро срок: плановая дата в ближайшие 14 дней (и ещё не прошла)
    if (daysUntilPlan >= 0 && daysUntilPlan <= PLAN_SOON_DAYS && !hasFact) {
      planSoon = true;
    }
  }

  // ── Финансирование: вечно-ложное (см. шапку RowSignals). Структурная
  // замена — planYearMissing (пустой год P) ниже. ──
  const financeDelay = false;

  // ── ЕП detection (used by multiple signals below) ──
  const isEP = methodText.includes('еп') || methodText.includes('единствен');
  // Колонка M — «Обоснование ЕП»: обязательное правовое поле ст.93 44-ФЗ,
  // а не свободный комментарий; естественные монополии, поручения губернатора
  // и законные основания ЕП риском не считаются. Ветка чтения «монополист»
  // из комментария AE снята (канон п.27).
  const epJustification = cellText(cells, 'M');
  const isLegitimateEP = textIncludes(epJustification, [
    'монополист', 'монопол', 'естественн',           // natural monopoly (energy, water, telecom)
    'губернатор', 'поручен',                          // Governor's orders
    'региональный оператор',                          // regional operators (waste, etc.)
  ]) || citesUnlimitedArt93Point(epJustification);

  // ── Экономия: графа «Статус» (AD) ──
  // Чтение графы и явление «Экономия без отметки» — ЕДИНЫЙ канон @aemr/shared
  // (economy-flag.ts): план и факт заполнены, факт меньше плана, а в графе нет
  // ни «да», ни «нет». Тот же предикат зовёт правило листа status_on_data_rows,
  // поэтому счёт признака строки, счёт замечания и число карточки «Экономии»
  // больше не могут разойтись. Единственный поставщик в класс входит (решение
  // владельца 20.08) — род называется словами в карточке, а не вычёркиванием
  // строк из счёта.
  //
  // Техбаг-fix 2026-07-16 (signal_audit §3.1), ради которого канон и записан:
  // прежний поиск подстроки «эконом» не совпадал с каноном графы никогда —
  // economyFlag был вечно false, зелёный бейдж «Экономия» не показывался, а
  // разбор пустой отметки давал 77 ложных срабатываний на строках с «да»/«нет».
  const economyCanon = economyFlagVerdict({
    planTotal: isNaN(planTotal) ? null : planTotal,
    factTotal,
    adCell: cells['AD'],
    isEp: isEP,
  });
  const economyFlag = economyCanon.state === 'approved';
  const economyFlagUndetermined = economyCanon.matches;

  // Конфликт флага экономии — ОДИН случай: отметка «да» стоит, а факт не ниже
  // плана. Второй случай («экономия есть, отметки нет») с 21.08.2026 носит
  // собственное имя «Экономия без отметки» — он был тем же явлением под
  // вторым именем и с третьим счётом. Порог 15–25 %, разводивший его с
  // «Высокой экономией», ушёл вместе со случаем: делить полосами одно явление
  // больше не нужно.
  const economyConflict = economyFlag
    && !isNaN(planTotal) && planTotal > 0 && factTotal > 0
    && factTotal >= planTotal;

  // ── ЕП-риск (антикоррупция) ──
  // Гейт «!canceled» снят (п.27): «отменена» из текста больше не гасит риск.
  const epRisk = isEP && !isNaN(planTotal) && planTotal > EP_RISK_THRESHOLD && !isLegitimateEP;

  // ── Качество данных ──
  // Only check required fields if the row has actual execution (fact date present)
  // or if the plan date is in the past. Pure future-plan rows are expected to have
  // incomplete data (no method, no amounts yet).
  // Текстовые исключения («планирование», «отменена») сняты каноном п.27.
  let dataQuality = false;
  const planDateInPast = planDay !== null && planDay < todayDay;
  if (isDataRow(cells) && (hasFactDate || planDateInPast)) {
    dataQuality = REQUIRED_COLUMNS.some(col => {
      const val = cells[col];
      return val === null || val === undefined || String(val).trim() === '';
    });
  }

  // ── Формульные ошибки ──
  const formulaBroken = hasFormulaError(cells);

  // ── Единственный участник: вечно-ложное (см. шапку RowSignals). ──
  const singleParticipant = false;

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
    // равенство гасим. Прежний гейт «!singleParticipant» снят вместе с самим
    // сигналом «1 участник» (канон п.27): текст больше ничего не гасит.
    if (economyPct >= 0 && economyPct < LOW_COMPETITION_PERCENT
      && factTotal !== planTotal) {
      lowCompetition = true;
    }
  }

  // ── Раннее закрытие: кандидат на опечатку в дате ──
  // FP-fix 2026-07-16 (signal_audit §3.5): порог «>30 дней» шумел — 73 из 74 срабатываний
  // были нормальным ранним исполнением против квартальных план-дат (30.03/30.06/…).
  // Полезный сигнал прячется в экстремумах: смена календарного года (УД стр.101:
  // факт 15.04.2025 при плане 30.04.2026 — вероятна опечатка года) или разрыв > 180 дней.
  let earlyClosure = false;
  if (factDay !== null && planDay !== null) {
    const diff = planDay - factDay; // planDate - factDate, в сутках
    // Смена года: факт в предыдущем календарном году относительно плана. Гард diff > 30
    // отсекает нормальное заключение декабрь→январь через Новый год.
    const yearJump = utcYearOfDay(factDay) < utcYearOfDay(planDay);
    // Retroactive date entry filter: if planDate is in the future, the dates may have been
    // entered retroactively (common in СВОД — operators fill in dates after the fact).
    const planInPast = todayDay > planDay; // now > planDate
    if (yearJump && diff > 30) {
      earlyClosure = true;
    } else if (diff > 180 && planInPast && !isEP) {
      // Гейт по способу закупки 18.08.2026 (SIGNAL_VALIDATION В-9, «половина
      // ложных»). Смысл сигнала — опечатка в дате, а не претензия к сроку.
      // У ЕП извещения и паузы нет: договор заключают, когда возникла нужда,
      // и полугодовое опережение мягкой плановой даты — обычное исполнение,
      // а не описка (то же основание, что у гейта !isEP на factDateBeforePlan,
      // п.28 интервью 14.08: «плановая дата — ориентир»). Ветка смены года
      // гейта НЕ получает: перепутанный год — ошибка при любом способе.
      // Живая проверка (18.08.2026, восемь книг, 8476 строк): сигнал зажигался
      // 5 раз, все пять — ЕП. Три остаются (смена года: УД/101 план 30.04.2026
      // против факта 15.04.2025; УО/1585 план 31.10.2026 против 22.12.2025;
      // УО/2587 план 27.07.2026 против 27.07.2025 — ровно год в год), два
      // гаснут (УО/1591 план 31.07.2026, факт 23.01.2026; УО/1684 план
      // 15.07.2026, факт 12.01.2026 — тот же год, ЕП, факт равен плану).
      earlyClosure = true;
    }
  }

  // ── Дата факта в будущем: опечатка в годе ──
  // Гейт «сегодня» тот же, что у остальных дат-правил (todayDay), поэтому
  // сигнал не зависит от режима просмотра: он про качество данных, а не про
  // срез. Текстовая «отменённость» больше не гасит (канон п.27).
  const futureFactDate = factDay !== null && factDay > todayDay;

  // ── Факт > план ──
  // FP-fix 2026-06-05 (SIGNAL_VALIDATION §4): допуск 0.5% против округлительного шума —
  // план хранится в 2 знака, факт в 5, давало «Существенное» на превышении в 3.75 ₽ (УИО r24/25).
  // GAS гасил это допуском *1.05; берём более строгие *1.005.
  // Гейт «!canceled» снят (п.27, п.41): состоявшаяся закупка со словом
  // «отменён» в комментарии обязана сохранять свои сигналы.
  let factExceedsPlan = false;
  if (!isNaN(planTotal) && planTotal > 0 && factTotal > planTotal * 1.005) {
    factExceedsPlan = true;
  }

  // ── Расхождение факт/план по ЕП (канон п.98м + семантика п.102, 18.08.2026) ──
  // По ЕП в план (K) пишут планируемую сумму договора, обязанную равняться
  // потраченной (Y): торгов нет, тезис владельца — «по ЕП не может быть
  // экономии». Расхождение в любую сторону сверх допуска — ошибка заполнения
  // либо «экономия», которой по ЕП быть не должно. Допуск округления тот же
  // 0.5%, что у factExceedsPlan выше (план в 2 знака, факт в 5 — шум).
  // Конкурентные способы (ЭА/ЭК/ЭЗК) не трогаются: там план = НМЦК, и
  // факт < план — нормальная торговая экономия (п.102).
  const epFactDeviation = isEP
    && !isNaN(planTotal) && planTotal > 0 && factTotal > 0
    && Math.abs(factTotal - planTotal) > planTotal * 0.005;

  // ── Три вечно-ложных (см. шапку RowSignals): подвисший контракт,
  // дубль budget_sum_plan (проверка K = H+I+J живёт ТОЛЬКО в RULE_BOOK →
  // validate.ts) и «ТД с программой». ──
  const stalledContract = false;
  const budgetMismatch = false;
  const tdWithProgram = false;

  // ── Счётная строка без года плана (P) — невидима для формул СВОДа ──
  // Гейт «счётная»: есть способ закупки и плановые деньги — ровно такие
  // строки движок учитывает в отчётном году по нестрогому правилу, а лист
  // СВОД (строгий SUMIFS по году) молча теряет. «Х»/«-» — та же пустота:
  // операторы ставят заглушку вместо года.
  const planYearText = cellText(cells, 'P');
  const planYearEmpty = planYearText === '' || planYearText === 'х' || planYearText === 'x' || planYearText === '-';
  // Канон п.93/45 (фикс 18.08.2026, п.98а): «не обеспечено финансированием»
  // решает РУКОПИСНАЯ N, а не производная P. Пустая P при заполненной N —
  // сломанная формула листа (сигнал derivedFormulaBroken ниже), строка при
  // этом профинансирована. Оба пусты — настоящая невидимка для SUMIFS СВОДа.
  const planDateText = cellText(cells, 'N');
  const planDateAbsent = planDateText === '' || isAbsentCell(planDateText);
  const planYearMissing = planDateAbsent && planYearEmpty
    && methodText !== '' && !isNaN(planTotal) && planTotal > 0;

  // ── Сломана формула производной даты (п.98а, живой кейс УКСиМП 280/283) ──
  // Пары источник→производные: N→(O,P), Q→(R,S). Рассинхрон в любую сторону
  // (дата без производной или производная без даты) = стёртая/битая формула.
  const planQuarterText = cellText(cells, 'O');
  const planQuarterEmpty = planQuarterText === '' || isAbsentCell(planQuarterText);
  const factQuarterText = cellText(cells, 'R');
  const factYearText = cellText(cells, 'S');
  // Валидность производного квартала: формула листа даёт строго 1..4, поэтому
  // «0», «5» или текст при заполненной N — та же стёртая формула, что и пустота
  // (канон 20.08.2026: первичны рукописные N и Q, O/P/R/S — вторичная история).
  const planQuarterNum = Number(planQuarterText.replace(',', '.'));
  const planQuarterValid = planQuarterNum >= 1 && planQuarterNum <= 4;
  const planDerivedPresent = !planQuarterEmpty || !planYearEmpty;
  const planPairBroken = (planDay !== null && (!planQuarterValid || planYearEmpty))
    || (planDateAbsent && planDerivedPresent);
  const factDerivedPresent = (factQuarterText !== '' && !isAbsentCell(factQuarterText))
    || (factYearText !== '' && !isAbsentCell(factYearText));
  const factPairBroken = (factDay !== null && (factQuarterText === '' || factYearText === ''))
    || (factDay === null && factDerivedPresent);
  const derivedFormulaBroken = (methodText !== '' && !isNaN(planTotal) && planTotal > 0)
    && (planPairBroken || factPairBroken);

  // Факт без планового квартала (блок А п.2) — ОСТАТОЧНАЯ страховка.
  // Первопричина почти всегда выше и называется своим сигналом (п.34):
  // пустая N — «не обеспечено финансированием», N есть при битой O —
  // «сломана формула даты». Здесь остаётся только хвост, который те не
  // ловят: строка без способа/плана (не счётная для них), где факт есть,
  // а квартала нет — она всё равно выпадает из печатного года (Σ кварталов
  // по O). Живой замер 20.08.2026: 0 срабатываний на 2 979 строк с фактом.
  const factQuarterMissing = hasFactDate && !planQuarterValid
    && !derivedFormulaBroken && !planYearMissing;

  // ── Факты без дат / Даты без фактов ──
  // factWithoutDate: есть суммы факта, но нет даты — структурная неполнота.
  // Прежние текстовые гейты сняты каноном п.27 (14.08.2026): дата из
  // комментария (ae-parser) и фразы «в течение года / по мере необходимости»
  // — машинная интерпретация свободного текста. Пояснение исполнителя
  // читатель видит как есть рядом с сигналом, а не вместо него.
  const factWithoutDate = hasFactAmounts && !hasFactDate;
  // dateWithoutFact: есть факт дата, но нет факт сумм — ввели дату, забыли суммы
  const dateWithoutFact = hasFactDate && !hasFactAmounts;

  // ── Факт дата раньше план даты — ИНФОРМАЦИОННО (п.28 интервью 14.08) ──
  // factDate < planDate on 1-30 day range (>30 → earlyClosure).
  // По оценке аудитории «это не ошибка»: плановая дата — ориентир, раннее
  // заключение допустимо. Сигнал понижен до информационного (severity 'info'
  // в CHECK_REGISTRY, синий бейдж), но не снят: остаётся справкой.
  let factDateBeforePlan = false;
  // FP-fix 2026-06-05 (SIGNAL_VALIDATION §4): только конкурентные методы. Для ЕП (ст.93)
  // нет извещения и 10-дневной паузы — досрочное заключение договора законно, не аномалия (~88% FP).
  if (factDay !== null && planDay !== null && !isEP) {
    const diff = planDay - factDay; // planDate - factDate, в сутках
    // factDate < planDate means diff > 0. Only flag 1-30 day range (not caught by earlyClosure).
    if (diff > 0 && diff <= 30) {
      factDateBeforePlan = true;
    }
  }

  // ── План без исполнения ──
  // Plan exists (K > 0), no fact, plan date is in past (or absent after April).
  // Текстовый гейт «при необходимости» (контингентные закупки) снят каноном
  // п.27. Вместо него — структурное подавление следствий (п.34 интервью
  // 14.08.2026): строка «не обеспечена финансированием» (planYearMissing,
  // пустой год P — это и есть кредитные линии «при необходимости», п.39)
  // НЕ получает вдобавок «план без исполнения» — первопричина главнее,
  // двойное замечание по одной строке путает исполнителей.
  let planWithoutExecution = false;
  if (!isNaN(planTotal) && planTotal > 0 && !hasFact && !overdue && !planYearMissing) {
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
  // Missing justification = compliance risk. Проверяется ЗАПОЛНЕННОСТЬ
  // обязательного поля M — это структурный факт. Гейт «основание есть в
  // комментарии AE» (ae-parser) снят каноном п.27: правовое основание обязано
  // жить в своей колонке, комментарий показывается как есть.
  // Маркер отсутствия считается незаполненностью — канон п.62 интервью
  // (14.08.2026) прямо называет основание выбора ЕП и требует относить «X»,
  // «х», «—» к «не заполнено». До правки 19.08.2026 признак сравнивал длину
  // строки, поэтому заглушка молчала дважды: сигнал не зажигался, а кластер
  // обоснования у неё и так EMPTY, то есть и «обоснование не распознано» не
  // говорило ничего. Читатель при этом видел в карточке «Основание выбора ЕП:
  // Х» — ровно тот дефект, который описан в шапке shared/absence.ts.
  // Живые книги 19.08.2026 (E:/aemr-dumps/book-dumps, 3 397 строк ЕП): пустая
  // M ровно одна, а заглушек десять — УАГЗО стр.33 № 47, УКСиМП стр.360-362,
  // 397, 461, УО стр.9 № 6, стр.21 № 18 и другие; счёт замечания вырастает
  // с 1 до 11.
  const epJustificationMissing =
    isEP && isAbsentCell(epJustification) && !isNaN(planTotal) && planTotal > 0;

  // ── Классификация обоснования ЕП (M) по 15 каноническим кластерам (ep-reason-clusters) ──
  // Воскрешает 2 сигнала, потерянных при удалении signals-taxonomy.ts (DEADCODE_DISPOSITION_2026-06-05).
  // ReDoS-cap 2000 символов (SECURITY S-M5: regex некоторых кластеров содержат .*).
  const epReasonCluster = isEP ? canonicalizeReasonEp(epJustification.slice(0, 2000)).cluster : 'EMPTY';
  // methodReasonMismatch: ЕП + обоснование = процедура «малая электронная закупка» (EP_SMALL_EL_PURCH)
  const methodReasonMismatch =
    isEP && epReasonCluster !== 'EMPTY' && epReasonCluster !== 'UNMAPPED' && isProceduralMismatch(epReasonCluster);
  // unmappedReasonEP: ЕП + обоснование не распознано (UNMAPPED) или расплывчатое (EP_CURRENT_LAW)
  const unmappedReasonEP =
    isEP && (epReasonCluster === 'UNMAPPED' || epReasonCluster === 'EP_CURRENT_LAW');

  // ── Факт без плана (budget underallocation) ──
  // Y > 0 but K = 0 (or NaN) — execution without budget allocation.
  // This is a data integrity issue — spending money not in the plan.
  const budgetUnderallocation = factTotal > 0 && (isNaN(planTotal) || planTotal === 0);

  // ── Источники бюджета не указаны ──
  // Плановые колонки источников (ФБ/КБ/МБ) все пусты/нули, но K (план итого) > 0:
  // итого плана есть, а разбивка по бюджетам не заполнена.
  //
  // Колонки берутся из справочника PLAN_SOURCE_COLUMNS, а не переписаны здесь
  // буквами (DEADCODE_DISPOSITION_2026-06-05 §W-7): справочник заведён ровно
  // под это правило и до 18.08.2026 лежал без потребителей, пока сигнал читал
  // 'H'/'I'/'J' от руки — добавление четвёртого источника молча прошло бы мимо.
  const planBySource = PLAN_SOURCE_COLUMNS.map(col => toNumber(cells[col]));
  const budgetSourceMissing = !isNaN(planTotal) && planTotal > 0 &&
    planBySource.every(v => isNaN(v) || v === 0);

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
    economyFlagUndetermined,
    epRisk,
    dataQuality,
    formulaBroken,
    singleParticipant,
    highEconomy,
    lowCompetition,
    earlyClosure,
    factExceedsPlan,
    epFactDeviation,
    stalledContract,
    budgetMismatch,
    factWithoutDate,
    tdWithProgram,
    planYearMissing,
    derivedFormulaBroken,
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
 * - Заключённая процедура (есть дата Q) — финальное состояние.
 * - Просрочка — критический сигнал для руководства.
 * - Далее по убыванию приоритета идут факт, скорый срок и т.д.
 *
 * С 14.08.2026 (канон п.27) состояния 'canceled', 'planning', 'not-due',
 * 'finance-delay' недостижимы: они выводились из свободного текста
 * комментариев. Ветки сохранены для совместимости со старыми снимками,
 * где RowState уже записан в атомах.
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
 * Подпись бейджа — из ЕДИНОГО дома имён (@aemr/shared SIGNAL_CLASS_NAMES,
 * короткая форма SIGNAL_LABELS). Своих строк бейджи больше не держат:
 * ручное зеркало было тем самым механизмом, которым разъехались шестнадцать
 * имён (инвентаризация 20.08.2026) — «Флаг экономии» на бейдже против
 * «Конфликта флага экономии» в чипе, «Факт без плана» против «Факта без
 * планового бюджета». Ключа нет в словаре — возвращаем сам ключ, и это
 * ловится стражем в signals.test.ts, а не глазами пользователя.
 */
function badgeLabel(key: keyof RowSignals): string {
  return SIGNAL_LABELS[key] ?? key;
}

/**
 * Формирует массив бейджей для отображения сигналов строки в UI.
 * Каждый бейдж содержит русскоязычную метку, цвет и иконку.
 *
 * @param signals — набор сигналов строки
 * @returns массив бейджей, отсортированных по важности (красные первыми)
 *
 * Бизнес-логика:
 * - Красные бейджи: просрочка, ЕП-риск, высокая экономия, ошибка формулы, конфликт отметки.
 * - Жёлтые: задержка финансирования, скорый срок, формальная конкуренция, пустые поля.
 * - Зелёные: подписано, есть факт, экономия.
 * - Синие: планирование, срок не наступил.
 * - Серые: отменено.
 */
export function getSignalBadges(signals: RowSignals): Array<SignalBadge> {
  const badges: SignalBadge[] = [];

  // ── Красные (критические) ──
  if (signals.overdue) {
    badges.push({ label: badgeLabel('overdue'), color: 'red', icon: 'alert-circle' });
  }
  if (signals.formulaBroken) {
    badges.push({ label: badgeLabel('formulaBroken'), color: 'red', icon: 'alert-triangle' });
  }
  if (signals.epRisk) {
    badges.push({ label: badgeLabel('epRisk'), color: 'red', icon: 'shield-alert' });
  }
  if (signals.highEconomy) {
    badges.push({ label: badgeLabel('highEconomy'), color: 'red', icon: 'trending-down' });
  }
  if (signals.economyConflict) {
    badges.push({ label: badgeLabel('economyConflict'), color: 'red', icon: 'alert-octagon' });
  }
  if (signals.factExceedsPlan) {
    badges.push({ label: badgeLabel('factExceedsPlan'), color: 'red', icon: 'trending-up' });
  }
  if (signals.epFactDeviation) {
    // Тон предупреждения (жёлтый), не критики: расхождение факт/план по ЕП —
    // чаще всего ошибка заполнения, а не нарушение (канон п.98м + п.102).
    badges.push({ label: badgeLabel('epFactDeviation'), color: 'yellow', icon: 'scale' });
  }
  if (signals.stalledContract) {
    badges.push({ label: badgeLabel('stalledContract'), color: 'yellow', icon: 'pause-circle' });
  }
  // budgetMismatch УДАЛЁН — дублирует правило budget_sum_plan (отображается через Issues)
  if (signals.earlyClosure) {
    badges.push({ label: badgeLabel('earlyClosure'), color: 'yellow', icon: 'fast-forward' });
  }
  if (signals.futureFactDate) {
    badges.push({ label: badgeLabel('futureFactDate'), color: 'red', icon: 'calendar-x' });
  }

  // ── Жёлтые (предупреждения) ──
  if (signals.financeDelay) {
    badges.push({ label: badgeLabel('financeDelay'), color: 'yellow', icon: 'clock' });
  }
  if (signals.planSoon) {
    badges.push({ label: badgeLabel('planSoon'), color: 'yellow', icon: 'calendar' });
  }
  if (signals.lowCompetition) {
    badges.push({ label: badgeLabel('lowCompetition'), color: 'yellow', icon: 'users' });
  }
  if (signals.singleParticipant) {
    badges.push({ label: badgeLabel('singleParticipant'), color: 'yellow', icon: 'user' });
  }
  if (signals.dataQuality) {
    badges.push({ label: badgeLabel('dataQuality'), color: 'yellow', icon: 'file-warning' });
  }
  // «Экономия без отметки» — решение органа не принято, а не нарушение:
  // тон предупреждения, не критики (канон п.104 — без упрёка).
  if (signals.economyFlagUndetermined) {
    badges.push({ label: badgeLabel('economyFlagUndetermined'), color: 'yellow', icon: 'flag-off' });
  }
  // tdWithProgram СНЯТ (канон п.30, 14.08.2026): бейдж не рисуется даже для
  // старых снимков, где сигнал записан true — заполненная программа у ТД норма.
  if (signals.planYearMissing) {
    // Канон имени класса — п.23 интервью 14.08.2026: «не обеспечено
    // финансированием» (прежний лейбл «Без финансирования» снят).
    badges.push({ label: badgeLabel('planYearMissing'), color: 'yellow', icon: 'calendar-x' });
  }
  if (signals.derivedFormulaBroken) {
    badges.push({ label: badgeLabel('derivedFormulaBroken'), color: 'red', icon: 'calendar-x' });
  }
  if (signals.factQuarterMissing) {
    badges.push({ label: badgeLabel('factQuarterMissing'), color: 'yellow', icon: 'calendar-x' });
  }
  if (signals.planWithoutExecution) {
    badges.push({ label: badgeLabel('planWithoutExecution'), color: 'yellow', icon: 'calendar-off' });
  }
  if (signals.epJustificationMissing) {
    badges.push({ label: badgeLabel('epJustificationMissing'), color: 'red', icon: 'file-x' });
  }
  if (signals.budgetUnderallocation) {
    badges.push({ label: badgeLabel('budgetUnderallocation'), color: 'red', icon: 'banknote' });
  }
  if (signals.budgetSourceMissing) {
    badges.push({ label: badgeLabel('budgetSourceMissing'), color: 'yellow', icon: 'wallet' });
  }

  // ── Зелёные (позитивные) ──
  if (signals.signed) {
    badges.push({ label: badgeLabel('signed'), color: 'green', icon: 'check-circle' });
  }
  if (signals.hasFact && !signals.signed) {
    badges.push({ label: badgeLabel('hasFact'), color: 'green', icon: 'check' });
  }
  if (signals.economyFlag && !signals.economyConflict) {
    badges.push({ label: badgeLabel('economyFlag'), color: 'green', icon: 'piggy-bank' });
  }

  // ── Синие (информационные) ──
  // «Факт дата < план» понижен до информационного (п.28 интервью 14.08.2026:
  // «это не ошибка» — плановая дата ориентир): был жёлтым предупреждением.
  if (signals.factDateBeforePlan) {
    badges.push({ label: badgeLabel('factDateBeforePlan'), color: 'blue', icon: 'calendar-x' });
  }
  if (signals.planning) {
    badges.push({ label: badgeLabel('planning'), color: 'blue', icon: 'edit' });
  }
  if (signals.notDue) {
    badges.push({ label: badgeLabel('notDue'), color: 'blue', icon: 'hourglass' });
  }

  // ── Серые ──
  if (signals.canceled) {
    badges.push({ label: badgeLabel('canceled'), color: 'gray', icon: 'x-circle' });
  }

  return badges;
}
