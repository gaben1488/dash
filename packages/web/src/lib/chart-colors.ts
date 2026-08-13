/**
 * Цвет как смысл — единственный дом цветовых решений графиков.
 *
 * Три словаря, которые нельзя смешивать между собой:
 *
 *   1. ЗАКРЕПЛЁННАЯ СЕМАНТИКА — бюджеты (ФБ/КБ/МБ), способ закупки (КП/ЕП),
 *      критичность сигналов. У каждого значения свой цвет навсегда.
 *   2. ШКАЛА ИСПОЛНЕНИЯ — пороги ровно те, что записаны в базе знаний
 *      (`execution_pct`, `exec_count_pct`: «🟢 ≥ 80 % · 🟡 50–79 % · 🔴 < 50 %
 *      · 🟣 > 100 %») и напечатаны в легенде под графиком на «Обзоре».
 *   3. КАТЕГОРИАЛЬНАЯ ПАЛИТРА — ряды без собственного смысла: управления,
 *      организации, произвольные группы.
 *
 * Почему разделение важно. Раньше первые три категориальных цвета были
 * байт-в-байт бюджетной тройкой (#3b82f6, #10b981, #f59e0b). Круг по
 * управлениям красился теми же синим/зелёным/янтарным, что и круг по
 * бюджетам, и читатель, запомнивший «синий — федеральный», видел бюджеты
 * там, где их не было. Категориальные оттенки уведены от закреплённых по
 * тону; тест `chart-colors.test.ts` стережёт этот отступ.
 */

// ────────────────────────────────────────────────────────────────
// 1. Закреплённая семантика
// ────────────────────────────────────────────────────────────────

export type BudgetKey = 'ФБ' | 'КБ' | 'МБ';

/**
 * Единственная закреплённая тройка бюджетов (DESIGN.md, «Цветовая стратегия»):
 * ФБ синий, КБ изумруд, МБ янтарь. На тёмной теме те же тона светлее — иначе
 * насыщенный синий на zinc-950 садится ниже порога различимости.
 */
export const BUDGET_COLORS: Record<BudgetKey, { light: string; dark: string }> = {
  'ФБ': { light: '#3b82f6', dark: '#60a5fa' },
  'КБ': { light: '#10b981', dark: '#34d399' },
  'МБ': { light: '#f59e0b', dark: '#fbbf24' },
};

export function getBudgetColor(budget: BudgetKey, isDark: boolean): string {
  const pair = BUDGET_COLORS[budget];
  return isDark ? pair.dark : pair.light;
}

export type MethodKey = 'КП' | 'ЕП';

/**
 * Способ определения поставщика. Конкурентная закупка — обычный порядок, её
 * цвет нейтральный; закупка у единственного поставщика — то, на что смотрит
 * контроль, поэтому она выделена. Пурпур намеренно взят вне шкалы критичности:
 * высокая доля ЕП — повод посмотреть, а не нарушение, и красным это красить
 * нельзя. Прежде КП и ЕП красились цветами ФБ и МБ — на одном и том же
 * круге два разных смысла делили один цвет.
 */
export const METHOD_COLORS: Record<MethodKey, { light: string; dark: string }> = {
  'КП': { light: '#52525b', dark: '#a1a1aa' },
  'ЕП': { light: '#be185d', dark: '#f472b6' },
};

export function getMethodColor(method: MethodKey, isDark: boolean): string {
  const pair = METHOD_COLORS[method];
  return isDark ? pair.dark : pair.light;
}

/**
 * Критичность сигналов. Оттенки те же, что у бейджей `SEVERITY_COLORS`
 * из `@aemr/shared`, но насыщенные: там пастель под текст на плашке, здесь
 * заливка фигуры на графике.
 *
 * Пара читается как [светлая тема, тёмная]. У «info» пара прежде стояла
 * наоборот: на тёмном фоне выводился более тёмный из двух оттенков, и
 * информационные столбцы тонули в подложке. Светлые значения «significant»
 * и «warning» приглушены до тонов 600: янтарь #f59e0b на белом даёт
 * контраст около 2,2 : 1 — ниже порога различимости фигуры (3 : 1).
 */
const SEVERITY_PAIRS: Record<string, readonly [string, string]> = {
  critical: ['#ef4444', '#f87171'],
  error: ['#ef4444', '#f87171'],
  significant: ['#ea580c', '#fb923c'],
  warning: ['#d97706', '#fbbf24'],
  info: ['#64748b', '#94a3b8'],
};

export function getSeverityColor(severity: string, isDark: boolean): string {
  const pair = SEVERITY_PAIRS[severity] ?? SEVERITY_PAIRS.info!;
  return isDark ? pair[1] : pair[0];
}

/** Положительная и отрицательная величина (экономия, отклонение). */
export function getPositiveColor(isDark: boolean): string {
  return isDark ? '#34d399' : '#10b981';
}

export function getNegativeColor(isDark: boolean): string {
  return isDark ? '#f87171' : '#ef4444';
}

// ────────────────────────────────────────────────────────────────
// 2. Шкала исполнения — один дом порогов
// ────────────────────────────────────────────────────────────────

export type ExecutionBand = 'over' | 'good' | 'watch' | 'bad';

/**
 * Нижние границы полос исполнения. Значения взяты из базы знаний
 * (`METRIC_KB.exec_count_pct.thresholdsFull`) и совпадают с легендой под
 * графиком исполнения. До этого по продукту жили три разных набора порогов
 * для одного и того же числа: 100/80/50 у столбцов, 90/70 у текста и
 * 90/70/50 у плитки — одно исполнение окрашивалось по-разному в зависимости
 * от того, где его показывали.
 */
export const EXECUTION_BAND_MIN: Record<Exclude<ExecutionBand, 'bad'>, number> = {
  over: 100,
  good: 80,
  watch: 50,
};

/** Словесная расшифровка полосы — визуальное всегда дублируется текстом. */
export const EXECUTION_BAND_LABELS: Record<ExecutionBand, string> = {
  over: 'больше 100 %: факт выше плана',
  good: 'больше 80 %',
  watch: 'от 50 до 80 %',
  bad: 'меньше 50 %',
};

export function getExecutionBand(pct: number): ExecutionBand {
  if (pct > EXECUTION_BAND_MIN.over) return 'over';
  if (pct >= EXECUTION_BAND_MIN.good) return 'good';
  if (pct >= EXECUTION_BAND_MIN.watch) return 'watch';
  return 'bad';
}

const EXECUTION_BAND_COLORS: Record<ExecutionBand, { light: string; dark: string }> = {
  over: { light: '#8b5cf6', dark: '#a78bfa' },
  good: { light: '#10b981', dark: '#34d399' },
  watch: { light: '#f59e0b', dark: '#fbbf24' },
  bad: { light: '#ef4444', dark: '#f87171' },
};

/** Заливка столбца исполнения. */
export function getExecutionBarColor(pct: number, isDark: boolean): string {
  const pair = EXECUTION_BAND_COLORS[getExecutionBand(pct)];
  return isDark ? pair.dark : pair.light;
}

const EXECUTION_TEXT_CLASS: Record<ExecutionBand, string> = {
  over: 'text-violet-600 dark:text-violet-400',
  good: 'text-emerald-600 dark:text-emerald-400',
  watch: 'text-amber-600 dark:text-amber-400',
  bad: 'text-red-600 dark:text-red-400',
};

/**
 * Класс цвета текста для процента исполнения. Светлый вариант обязателен:
 * `text-emerald-400` на белом фоне даёт контраст около 1,9 : 1 — число
 * читается как выцветшее пятно.
 */
export function getExecutionTextClass(pct: number | null): string {
  if (pct === null) return 'text-zinc-500 dark:text-zinc-400';
  return EXECUTION_TEXT_CLASS[getExecutionBand(pct)];
}

const EXECUTION_BAR_CLASS: Record<ExecutionBand, string> = {
  over: 'bg-violet-500',
  good: 'bg-emerald-500',
  watch: 'bg-amber-500',
  bad: 'bg-red-500',
};

/** Класс заливки полосы прогресса исполнения. */
export function getExecutionBarClass(pct: number): string {
  return EXECUTION_BAR_CLASS[getExecutionBand(pct)];
}

const EXECUTION_HEAT: Record<ExecutionBand, { bg: [string, string]; text: [string, string] }> = {
  // пары читаются как [светлая тема, тёмная]
  over: { bg: ['#ede9fe', '#2e1065'], text: ['#5b21b6', '#c4b5fd'] },
  good: { bg: ['#bbf7d0', '#052e16'], text: ['#166534', '#86efac'] },
  watch: { bg: ['#fef08a', '#422006'], text: ['#854d0e', '#fde047'] },
  bad: { bg: ['#fecaca', '#450a0a'], text: ['#991b1b', '#fca5a5'] },
};

/**
 * Фон ячейки тепловой карты. Ноль и отсутствие значения — разные вещи, но
 * обе не окрашиваются: ноль исполнения при нулевом плане не «провал», а
 * отсутствие базы, и красным его подсвечивать нельзя.
 */
export function getExecutionHeatBg(v: number | null, isDark: boolean): string {
  if (v === null || v === 0) return isDark ? '#1e293b' : '#f1f5f9';
  return EXECUTION_HEAT[getExecutionBand(v)].bg[isDark ? 1 : 0];
}

/** Цвет текста ячейки тепловой карты. */
export function getExecutionHeatText(v: number | null, isDark: boolean): string {
  if (v === null || v === 0) return isDark ? '#64748b' : '#94a3b8';
  return EXECUTION_HEAT[getExecutionBand(v)].text[isDark ? 1 : 0];
}

// ────────────────────────────────────────────────────────────────
// 3. Категориальная палитра
// ────────────────────────────────────────────────────────────────

/**
 * Шесть тонов для рядов без закреплённого смысла. Подобраны так, что:
 *   • ни один не повторяет и не соседствует с бюджетной тройкой и шкалой
 *     критичности (отступ по тону не меньше 25°);
 *   • соседние тона разведены не меньше чем на 44° — при дейтеранопии и
 *     протанопии пары «зелёный/красный» и «синий/фиолетовый» сливаются, и
 *     тесная упаковка тонов первой ломается именно у них;
 *   • контраст к подложке у всех рядов одинаков (≈4,2 : 1 на белом,
 *     ≈5,4 : 1 на zinc-900) — ни один ряд не выглядит важнее прочих просто
 *     потому, что темнее.
 *
 * Шести цветов достаточно: восьми ГРБС хватает шести тонов в паре с
 * четырьмя штриховками (см. `getSeriesPattern`), а увеличение числа тонов
 * съедает расстояние между ними.
 */
const LIGHT_PALETTE = ['#776cda', '#bb49d2', '#d24984', '#268897', '#318d23', '#768321'];
const DARK_PALETTE = ['#8d84db', '#c26bd4', '#d46b98', '#319aaa', '#3ea22f', '#88962c'];

export function getChartColors(isDark: boolean): string[] {
  return isDark ? DARK_PALETTE : LIGHT_PALETTE;
}

export function getChartColor(index: number, isDark: boolean): string {
  const palette = isDark ? DARK_PALETTE : LIGHT_PALETTE;
  return palette[index % palette.length]!;
}

/**
 * Штриховка ряда — второй, нецветовой признак различия.
 *
 * Канон «текстовый дубль визуального» требует, чтобы всякая визуальная
 * кодировка дублировалась чем-то ещё: печать бывает чёрно-белой, а около
 * восьми процентов мужчин не различают часть тонов. Подпись в легенде
 * закрывает это для списка, но не для самой фигуры на графике — фигуру
 * различает штриховка. Четыре штриховки на шесть тонов дают двенадцать
 * несовпадающих пар подряд (наименьшее общее кратное), тогда как один
 * только цвет повторился бы уже на седьмом ряду.
 */
export type SeriesPattern = 'solid' | 'diagonal' | 'dots' | 'grid';

const SERIES_PATTERNS: readonly SeriesPattern[] = ['solid', 'diagonal', 'dots', 'grid'];

export const SERIES_PATTERN_COUNT = SERIES_PATTERNS.length;

export function getSeriesPattern(index: number): SeriesPattern {
  return SERIES_PATTERNS[index % SERIES_PATTERNS.length]!;
}

/** Словесное имя штриховки — для подсказок и печатных легенд. */
export const SERIES_PATTERN_LABELS: Record<SeriesPattern, string> = {
  solid: 'сплошная заливка',
  diagonal: 'косая штриховка',
  dots: 'точки',
  grid: 'клетка',
};

// ────────────────────────────────────────────────────────────────
// 4. Хром графика
// ────────────────────────────────────────────────────────────────

export function getTooltipStyle(isDark: boolean) {
  return {
    contentStyle: {
      backgroundColor: isDark ? '#1e293b' : '#ffffff',
      border: `1px solid ${isDark ? '#334155' : '#e2e8f0'}`,
      borderRadius: '8px',
      fontSize: '12px',
      color: isDark ? '#e2e8f0' : '#334155',
    },
  };
}

export function getGridColor(isDark: boolean): string {
  return isDark ? '#334155' : '#e2e8f0';
}

export function getAxisColor(isDark: boolean): string {
  return isDark ? '#94a3b8' : '#64748b';
}
