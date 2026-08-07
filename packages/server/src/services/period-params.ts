/**
 * Разбор параметров периода серверных роутов — единственный дом валидации
 * оси времени в @aemr/server.
 *
 * Дом по карте docs/superpowers/specs/2026-08-07-time-axis-map.md §3.4 и §4
 * (фаза 3, «серверные контракты»): роуты переводят CSV-мультизначения в общий
 * `TimeSelection` из @aemr/shared и опираются на его резолвер. Математика
 * выбора (поглощение квартал↔месяцы, дизъюнктность ключей, четверг недели)
 * остаётся в shared; здесь — только перевод HTTP-строк в канон и честные
 * русские отказы.
 *
 * Три инварианта, ради которых модуль отдельный:
 *   1. Старая форма запроса (year/quarter/asOf) обязана работать как прежде.
 *      Разбор легаси-скаляров повторяет прежний роут дословно, включая тексты
 *      ошибок; смешивать формы в одном запросе нельзя — иначе один из двух
 *      заданных периодов молча пропал бы (класс «молчаливой деградации»,
 *      против которого и написана карта оси времени).
 *   2. asOf и week — РАЗНЫЕ срезы. asOf уважается как задан (произвольная
 *      архивная дата), week нормализуется к продуктовому четвергу недели и
 *      клампится к последнему прошедшему. Свести одно к другому нельзя,
 *      поэтому заданы оба — отказ, а не тихий выбор победителя.
 *   3. Разрешение выбора не читает часы: «сегодня» приходит параметром
 *      (номер суток по календарю ПРОДУКТА, Камчатка +12). Продуктовый
 *      календарь живёт в роутах и сервисах, а не в разборе строк.
 */
import {
  EMPTY_TIME_SELECTION,
  dayNumberOf,
  isoOfDayNumber,
  parseTimeSelection,
  resolveTimeSelection,
  type Month,
  type PeriodKey,
  type Quarter,
  type TimeSelection,
} from '@aemr/shared';

const MS_PER_DAY = 86_400_000;

// ── Год плана: одна проверка вместо пяти копий по роутам ─────────────

/** Границы плана-года — те же 2020..2100, что стояли в пяти местах роутов. */
export const PLAN_YEAR_MIN = 2020;
export const PLAN_YEAR_MAX = 2100;

/** Целое в диапазоне плана-года. */
export function isPlanYear(value: unknown): value is number {
  return typeof value === 'number'
    && Number.isInteger(value)
    && value >= PLAN_YEAR_MIN
    && value <= PLAN_YEAR_MAX;
}

/**
 * СТРОГИЙ разбор года: `Number()` целиком, любой мусор → null.
 * Так год читает /api/report — «2026abc» обязан получить 400, а не молча
 * стать 2026.
 */
export function parsePlanYear(raw: unknown): number | null {
  if (raw === undefined || raw === null || raw === '') return null;
  const n = Number(raw);
  return isPlanYear(n) ? n : null;
}

/**
 * МЯГКИЙ разбор года-фильтра: 'all', пустое и мусор → undefined («фильтр
 * выключен»). Сознательно на `parseInt`, а не на `Number`: так ведут себя
 * четыре действующие копии (dashboard ×2, reconciliation, rows-filters), и
 * подключение этой функции обязано быть заменой поведения один-в-один, а не
 * попутным ужесточением контракта.
 */
export function parseYearFilterParam(raw: string | undefined | null): number | undefined {
  if (raw === undefined || raw === null || raw === '' || raw === 'all') return undefined;
  const n = parseInt(raw, 10);
  return isPlanYear(n) ? n : undefined;
}

// ── Разбор query ─────────────────────────────────────────────────────

/**
 * Query-параметры периода. Значения — `string | string[]`: fastify отдаёт
 * массив, когда ключ повторён (`?years=2025&years=2026`).
 */
export interface PeriodQuery {
  /** Легаси: план-год среза. */
  year?: string | string[];
  /** Легаси: отчётный квартал 1..4. */
  quarter?: string | string[];
  /** Легаси: дата среза YYYY-MM-DD, уважается как задана. */
  asOf?: string | string[];
  /** Годы через запятую: `2025,2026`. */
  years?: string | string[];
  /** Кварталы `ГОД:КВАРТАЛ` через запятую: `2026:1,2026:2`. */
  quarters?: string | string[];
  /** Месяцы `ГОД:МЕСЯЦ` через запятую: `2026:5`. */
  months?: string | string[];
  /** Неделя-срез: любой день недели, нормализуется к понедельнику. */
  week?: string | string[];
}

/** Легаси-скаляры прежнего контракта — уже проверенные, но ещё не разрешённые. */
export interface LegacyPeriodParams {
  readonly year: number | null;
  readonly quarter: Quarter | null;
  /** Строка YYYY-MM-DD; корректность даты уже проверена. */
  readonly asOf: string | null;
}

export interface ParsedPeriodQuery {
  /** Канонический выбор из новых параметров; старая форма сюда не сворачивается. */
  readonly selection: TimeSelection;
  /** Заданы ли новые параметры — роут не меняет старый ответ, пока их нет. */
  readonly hasSelection: boolean;
  readonly legacy: LegacyPeriodParams;
  /** Русские объяснения отказа; пусто = запрос корректен. */
  readonly errors: readonly string[];
}

/**
 * Потолок числа периодов в одном запросе. Каждый ключ — отдельный прогон
 * счётного ядра по всем строкам, и `years=2020,…,2100` иначе превратил бы
 * один GET в восемьдесят полных пересчётов.
 */
export const MAX_PERIOD_KEYS = 12;

const YEAR_RE = /^\d{4}$/;
const QUARTER_RE = /^(\d{4}):([1-4])$/;
const MONTH_RE = /^(\d{4}):(\d{1,2})$/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Значение параметра как строка: повторы ключа склеиваются через запятую. */
function asText(raw: string | string[] | undefined): string | undefined {
  if (raw === undefined) return undefined;
  return Array.isArray(raw) ? raw.join(',') : raw;
}

/**
 * Значение НОВОГО параметра: пустое считается незаданным. Клиент, у которого
 * ось времени пуста, шлёт `years=` — отказывать на этом не за что. Легаси-поля
 * так не смягчаются: `?year=` и раньше отвечал 400, поведение сохраняется.
 */
function filled(raw: string | string[] | undefined): string | undefined {
  const text = asText(raw);
  return text !== undefined && text.trim() !== '' ? text : undefined;
}

/** Непустые значения CSV-списка; хвостовая запятая — не ошибка. */
function csvTokens(text: string): string[] {
  return text.split(',').map((t) => t.trim()).filter((t) => t !== '');
}

/** Дата YYYY-MM-DD, пережившая round-trip (защита от «2026-06-31» → 1 июля). */
function isCalendarDate(text: string): boolean {
  if (!ISO_DATE_RE.test(text)) return false;
  const day = dayNumberOf(text);
  return day !== null && isoOfDayNumber(day) === text;
}

/**
 * Query → канонический выбор + легаси-скаляры + список отказов.
 *
 * Разбор нового формата делегирован `parseTimeSelection` (@aemr/shared) —
 * один парсер на клиент и сервер. Отличие серверной стороны в том, что shared
 * молча отбрасывает мусор (восстановление ссылки не должно падать), а API
 * обязано ответить 400: поэтому каждое значение сперва проверяется здесь, и
 * до shared доходит уже канонический текст.
 */
export function parsePeriodQuery(query: PeriodQuery): ParsedPeriodQuery {
  const errors: string[] = [];

  const yearsRaw = filled(query.years);
  const quartersRaw = filled(query.quarters);
  const monthsRaw = filled(query.months);
  const weekRaw = filled(query.week);
  const hasSelection = yearsRaw !== undefined
    || quartersRaw !== undefined
    || monthsRaw !== undefined
    || weekRaw !== undefined;

  const yearRaw = asText(query.year);
  const quarterRaw = asText(query.quarter);
  const asOfRaw = asText(query.asOf);

  if (hasSelection && (yearRaw !== undefined || quarterRaw !== undefined)) {
    errors.push(
      'Параметры year/quarter и years/quarters/months/week нельзя задавать вместе: '
      + 'выберите одну форму запроса периода.',
    );
  }
  if (weekRaw !== undefined && asOfRaw !== undefined) {
    errors.push(
      'Параметры asOf и week нельзя задавать вместе: asOf — дата среза как задана, '
      + 'week — четверг выбранной недели.',
    );
  }

  // ── Легаси-скаляры: разбор и тексты ошибок — как в прежнем роуте ──
  let legacyYear: number | null = null;
  if (yearRaw !== undefined) {
    legacyYear = parsePlanYear(yearRaw);
    if (legacyYear === null) {
      errors.push(`Параметр year «${yearRaw}» вне диапазона ${PLAN_YEAR_MIN}..${PLAN_YEAR_MAX}.`);
    }
  }
  let legacyQuarter: Quarter | null = null;
  if (quarterRaw !== undefined) {
    const parsed = Number(quarterRaw);
    if (parsed !== 1 && parsed !== 2 && parsed !== 3 && parsed !== 4) {
      errors.push(`Параметр quarter «${quarterRaw}» не является кварталом 1..4.`);
    } else {
      legacyQuarter = parsed;
    }
  }
  let legacyAsOf: string | null = null;
  if (asOfRaw !== undefined) {
    if (!isCalendarDate(asOfRaw)) {
      errors.push(`Параметр asOf «${asOfRaw}» не является датой формата YYYY-MM-DD.`);
    } else {
      legacyAsOf = asOfRaw;
    }
  }

  // ── Новые параметры: проверка каждого значения до делегирования ──
  const canon: string[] = [];
  if (yearsRaw !== undefined) {
    const bad = csvTokens(yearsRaw).filter((t) => !YEAR_RE.test(t) || !isPlanYear(Number(t)));
    for (const t of bad) {
      errors.push(`Параметр years: значение «${t}» не является годом ${PLAN_YEAR_MIN}..${PLAN_YEAR_MAX}.`);
    }
    canon.push(`years=${yearsRaw}`);
  }
  if (quartersRaw !== undefined) {
    for (const t of csvTokens(quartersRaw)) {
      const m = t.match(QUARTER_RE);
      if (!m || !isPlanYear(Number(m[1]))) {
        errors.push(`Параметр quarters: значение «${t}» не имеет вида ГОД:КВАРТАЛ (например 2026:1).`);
      }
    }
    canon.push(`quarters=${quartersRaw}`);
  }
  if (monthsRaw !== undefined) {
    for (const t of csvTokens(monthsRaw)) {
      const m = t.match(MONTH_RE);
      const month = m ? Number(m[2]) : 0;
      if (!m || !isPlanYear(Number(m[1])) || month < 1 || month > 12) {
        errors.push(`Параметр months: значение «${t}» не имеет вида ГОД:МЕСЯЦ (например 2026:5).`);
      }
    }
    canon.push(`months=${monthsRaw}`);
  }
  if (weekRaw !== undefined) {
    if (!isCalendarDate(weekRaw)) {
      errors.push(`Параметр week «${weekRaw}» не является датой формата YYYY-MM-DD.`);
    }
    canon.push(`week=${weekRaw}`);
  }

  const selection = errors.length === 0 && hasSelection
    ? parseTimeSelection(canon.join('&'))
    : EMPTY_TIME_SELECTION;

  // Размер выбора считается ПОСЛЕ разбора: повторы («2026,2026») сворачиваются
  // множествами и потолка не задевают.
  let size = selection.years.size;
  for (const v of selection.byYear.values()) size += v.quarters.size + v.months.size;
  if (size > MAX_PERIOD_KEYS) {
    errors.push(`Выбрано слишком много периодов (${size}), максимум ${MAX_PERIOD_KEYS}: сузьте выбор.`);
  }

  return {
    selection: errors.length === 0 ? selection : EMPTY_TIME_SELECTION,
    hasSelection,
    legacy: { year: legacyYear, quarter: legacyQuarter, asOf: legacyAsOf },
    errors,
  };
}

// ── Разрешение выбора в срезы отчёта ─────────────────────────────────

/**
 * Один срез отчёта: пара (год, квартал), которую понимает счётное ядро.
 * `from` хранит породивший ключ выбора — по нему роут честно подписывает
 * срез, если запрошенная гранулярность (месяц) грубее не отображена.
 */
export interface PeriodSlice {
  readonly year: number;
  readonly quarter: Quarter;
  /** Ключ выбора; null — параметров не было, срез взят из даты среза. */
  readonly from: PeriodKey | null;
}

export interface ResolvedPeriodParams {
  /** Срезы выбора, минимум один; порядок канонический (годы, кварталы, месяцы). */
  readonly slices: readonly PeriodSlice[];
  /** Номер суток среза: явный asOf, четверг недели или «сегодня». */
  readonly asOfDay: number;
  /** Прямой эфир — ни asOf, ни week не заданы. */
  readonly live: boolean;
  /** Человекочитаемая подпись выбора (единственный дом — резолвер shared). */
  readonly label: string;
}

/** Квартал планового месяца: 1..3 → 1, 4..6 → 2 и так далее. */
const quarterOfMonth = (month: Month): Quarter => (Math.ceil(month / 3) as Quarter);

/**
 * Выбор → срезы отчёта.
 *
 * Дефолты повторяют прежний роут: без параметров — прямой эфир, год и квартал
 * из даты среза; явный год/квартал побеждают дефолт. Новое здесь только одно —
 * ключей может быть несколько, и тогда срезов тоже несколько.
 *
 * `todayDay` — «сегодня» по календарю ПРОДУКТА. Он же задаёт границу клампа
 * недели: будущий четверг не адресуем, иначе срез будущей недели вернул бы
 * сегодняшние числа под чужой датой.
 */
export function resolvePeriodParams(
  parsed: ParsedPeriodQuery,
  opts: { readonly todayDay: number },
): ResolvedPeriodParams {
  // Часы резолверу не нужны: момент задан номером суток продукта, поэтому
  // смещение пояса здесь нулевое — иначе оно применилось бы дважды.
  const resolved = resolveTimeSelection(parsed.selection, {
    now: new Date(opts.todayDay * MS_PER_DAY),
    utcOffsetHours: 0,
  });

  const { legacy } = parsed;
  const asOfDay = legacy.asOf !== null
    ? (dayNumberOf(legacy.asOf) ?? opts.todayDay)
    : (resolved.asOfDay ?? opts.todayDay);
  const live = legacy.asOf === null && resolved.asOfDay === null;

  const sliceDate = new Date(asOfDay * MS_PER_DAY);
  const defaultYear = legacy.year ?? sliceDate.getUTCFullYear();
  const defaultQuarter = legacy.quarter ?? ((Math.floor(sliceDate.getUTCMonth() / 3) + 1) as Quarter);

  const slices: PeriodSlice[] = [];
  const seen = new Set<string>();
  for (const key of resolved.keys) {
    // Год целиком ядро отчёта тоже считает при каком-то квартале: годовые
    // числа от него не зависят, квартальный раздел показывает дефолтный.
    const quarter = key.kind === 'quarter'
      ? key.quarter
      : key.kind === 'month' ? quarterOfMonth(key.month) : defaultQuarter;
    const dedupeKey = `${key.year}:${quarter}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    slices.push({ year: key.year, quarter, from: key });
  }
  if (slices.length === 0) {
    slices.push({ year: defaultYear, quarter: defaultQuarter, from: null });
  }

  return { slices, asOfDay, live, label: resolved.label };
}
