import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useStore, hasExplicitPeriodFilter, AVAILABLE_YEARS, MONTHS } from '../store';
import { api, humanizeRequestError } from '../api';
import {
  SVOD_SPREADSHEET_ID,
  ACTIVITY_LABEL,
  THRESHOLDS,
  UI_LABELS,
  productLabel,
  quarterLabel,
  type SvodRow,
  type SvodBlock,
  type SvodView as SvodViewShape,
  type UnifiedGrid,
} from '@aemr/shared';
import { sliceUnified, type BudgetKey } from '../lib/unified-svod-view';
import { fmtCount, fmtPct } from '../lib/report/mappers';
import { KbHover } from '../components/contract/KbHover';
import { SkeletonTable } from '../components/Skeleton';
import {
  ACTIVITY_HINT,
  CAT_TO_ACTIVITY_KEY,
  SVOD_ACTIVITY_CATS,
  activityPhrase,
  catsFromActivities,
  effectiveScope,
  isAllCats,
} from '../lib/svod/activity';
import { activePeriodButton, resolveSvodPeriod } from '../lib/svod/period';
import { collapsePeriods, hasCellsForPeriods, isGridEmpty } from '../lib/svod/grid';
import {
  isCountMetric,
  reconAvailability,
  reconBadges,
  reconKeyLabel,
  reconMismatches,
  type ReconAvailability,
  type ReconBadge,
  type ReconRow,
} from '../lib/svod/recon';
import {
  FileSpreadsheet, ExternalLink, Columns3, Table2, ShieldCheck, ShieldAlert, ShieldOff,
  AlertTriangle, CalendarOff, Info,
} from 'lucide-react';
import clsx from 'clsx';

// ── Форматирование ───────────────────────────────────────────────────

const MONEY_DIV: Record<string, number> = { 'тыс': 1, 'млн': 1000, 'млрд': 1_000_000 };
// Подписи единиц — из канона; «млрд» в UI_LABELS нет, форма собрана по образцу двух выше.
const MONEY_LABEL: Record<string, string> = {
  'тыс': UI_LABELS['unit.thousand_rubles'],
  'млн': UI_LABELS['unit.million_rubles'],
  'млрд': 'млрд руб.',
};

/** Пустая клетка объясняет себя словами: «—» читателю ничего не говорит. */
const NO_DATA = 'нет данных';

function countText(n: number | null): string {
  return n === null || !Number.isFinite(n) ? NO_DATA : fmtCount(n);
}

/** Доля 0..1 → процент. Нулевой знаменатель даёт «нет плана», а не ноль. */
function pctText(fraction: number | null): string {
  if (fraction === null || !Number.isFinite(fraction)) return fmtPct(null);
  return fmtPct(fraction * 100);
}

function makeFmtMoney(unit: string) {
  const div = MONEY_DIV[unit] ?? 1;
  // Как в листах СВОД/ШДЮ: деньги в тыс. руб. — формат #,##0.00 (2 знака).
  const frac = unit === 'тыс' ? 2 : unit === 'млн' ? 1 : 2;
  return (n: number | null): string => {
    if (n === null || !Number.isFinite(n)) return NO_DATA;
    const v = n / div;
    if (Math.abs(v) < 1e-9) return '0';
    return v.toLocaleString('ru-RU', { maximumFractionDigits: frac });
  };
}

/**
 * Цвет процента исполнения — по каноническим порогам @aemr/shared.
 * Раньше здесь жили свои 80/50: два экрана красили одно и то же число
 * в разные цвета, потому что порог был переписан от руки.
 */
function execColorClass(fraction: number | null): string {
  if (fraction === null) return 'text-zinc-400 dark:text-zinc-500';
  if (fraction >= THRESHOLDS.EXECUTION.GOOD) return 'text-emerald-600 dark:text-emerald-400';
  if (fraction >= THRESHOLDS.EXECUTION.WARNING) return 'text-amber-600 dark:text-amber-400';
  return 'text-red-600 dark:text-red-400';
}

function deviationColor(n: number | null): string {
  if (n === null || Math.abs(n) < 1e-9) return 'text-zinc-400 dark:text-zinc-500';
  return n < 0 ? 'text-red-600 dark:text-red-400' : 'text-zinc-600 dark:text-zinc-300';
}

const SHEET_URL = `https://docs.google.com/spreadsheets/d/${SVOD_SPREADSHEET_ID}/edit`;

/** Общее кольцо фокуса: клавиатурный пользователь обязан видеть, где он. */
const FOCUS_RING =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 focus-visible:ring-offset-1 dark:focus-visible:ring-offset-zinc-800';

// ── Ответ сервера ────────────────────────────────────────────────────

interface UnifiedResp {
  grid: UnifiedGrid;
  reconciliation: ReconRow[];
  /** Год, за который сервер посчитал сетку. */
  year?: number;
}

// ── Разделы таблицы ──────────────────────────────────────────────────

type SectionKind = 'kp' | 'ep' | 'total';

const SECTION_META: Record<SectionKind, { label: string; hint: string; tagClass: string }> = {
  kp: {
    label: 'КП',
    hint: 'Конкурентные процедуры — аукцион, конкурс, запрос котировок',
    tagClass: 'bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300',
  },
  ep: {
    label: 'ЕП',
    hint: 'Закупки у единственного поставщика',
    tagClass: 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300',
  },
  total: {
    label: 'ИТОГО',
    hint: 'Конкурентные процедуры плюс закупки у единственного поставщика',
    tagClass: 'bg-zinc-100 text-zinc-700 dark:bg-zinc-700/60 dark:text-zinc-200',
  },
};

// Цветовая кодировка метрик — как в листах СВОД/ШДЮ: план голубой, факт сиреневый,
// экономия зелёная (оригинал A4C2F4 / DDD6FE / B6D7A8, ИТОГО C9DAF8/D9D2E9/D9EAD3).
const GROUP_HEAD = {
  plan: 'bg-blue-100/70 dark:bg-blue-950/40 text-blue-800 dark:text-blue-200',
  fact: 'bg-violet-100/70 dark:bg-violet-950/40 text-violet-800 dark:text-violet-200',
  eco: 'bg-emerald-100/70 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-200',
} as const;
const GROUP_CELL = {
  plan: 'bg-blue-50/50 dark:bg-blue-950/20',
  fact: 'bg-violet-50/50 dark:bg-violet-950/20',
  eco: 'bg-emerald-50/50 dark:bg-emerald-950/20',
} as const;

/**
 * Названия бюджетов для перечисления во фразе — из канона подписей,
 * без хвостового слова «бюджет» (оно уже стоит перед перечислением).
 */
const budgetWord = (label: string) => label.toLowerCase().replace(/\s*бюджет\s*/, '');
const BUDGET_PHRASE: Record<BudgetKey, string> = {
  fb: budgetWord(UI_LABELS['budget.fb']),
  kb: budgetWord(UI_LABELS['budget.kb']),
  mb: budgetWord(UI_LABELS['budget.mb']),
};

// ── Главный компонент ────────────────────────────────────────────────

export function SvodView() {
  const {
    moneyUnit, year, period, activeMonths, monthsByYear, periodMode,
    selectedDepartments, selectedMethods, selectedBudgets, selectedActivities, selectedSubordinates,
    searchQuery, setYear, navigateTo,
    toggleActivity, clearActivities, clearAllPeriods, toggleMonthInYear, toggleQuarterInYear,
  } = useStore();

  // Показ бюджетов в столбцах — это раскладка таблицы, а не фильтр данных,
  // поэтому единственное состояние, которое честно остаётся локальным.
  const [budgetFull, setBudgetFull] = useState(false);

  // ── Загрузка сетки (год — из глобального фильтра) ──
  const [resp, setResp] = useState<UnifiedResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    api
      .getSvodUnified(year)
      .then((d: UnifiedResp) => { if (alive) { setResp(d); setLoading(false); } })
      .catch((err: unknown) => { if (alive) { setError(humanizeRequestError(err)); setLoading(false); } });
    return () => { alive = false; };
  }, [year]);

  // ── Вид деятельности: одна ось со всем приложением ──
  // Канон п.30: категорий две (ПМ/ТД) — «всё выбрано» решает isAllCats,
  // а не магическое число (три категории ушли вместе со срезом ТД-ПМ).
  const cats = useMemo(() => catsFromActivities(selectedActivities), [selectedActivities]);
  const scope = effectiveScope(cats);
  const activityIsAll = isAllCats(cats);

  // ── Период: одна ось со всем приложением ──
  const gridYear = resp?.year ?? (typeof year === 'number' ? year : new Date().getFullYear());
  const explicitPeriod = hasExplicitPeriodFilter(periodMode, activeMonths, monthsByYear);
  const periodSel = useMemo(
    () => resolveSvodPeriod({ year: gridYear, period, months: activeMonths, explicit: explicitPeriod }),
    [gridYear, period, activeMonths, explicitPeriod],
  );
  const activeBtn = activePeriodButton(periodSel);
  // Год для записи выбора обратно в глобальный фильтр (как navigateTo: «все годы» → текущий).
  const targetYear = typeof year === 'number' ? year : gridYear;
  const pickYear = () => clearAllPeriods();
  const pickQuarter = (q: number) => { clearAllPeriods(); toggleQuarterInYear(targetYear, `q${q}`); };
  const pickMonth = (m: number) => { clearAllPeriods(); toggleMonthInYear(targetYear, m); };

  // ── Способ закупки ──
  const methodFilter: SectionKind | null =
    selectedMethods.size !== 1 ? null
      : selectedMethods.has('competitive') ? 'kp'
        : selectedMethods.has('single') ? 'ep' : null;
  const visibleKinds: SectionKind[] = methodFilter ? [methodFilter] : ['kp', 'ep', 'total'];

  // ── Бюджет: режет деньги, но не количества ──
  const budgetSet = useMemo<Set<BudgetKey>>(() => {
    const s = new Set<BudgetKey>();
    for (const b of selectedBudgets) {
      if (b === 'fb' || b === 'kb' || b === 'mb') s.add(b);
    }
    return s;
  }, [selectedBudgets]);
  const budgetFiltered = budgetSet.size > 0;
  const showBudgetBreakdown = budgetFull && !budgetFiltered;

  const fmtMoney = useMemo(() => makeFmtMoney(moneyUnit), [moneyUnit]);
  const moneyLabel = MONEY_LABEL[moneyUnit] ?? UI_LABELS['unit.thousand_rubles'];

  // ── Срез сетки под выбранные фильтры ──
  const grid = resp?.grid;
  const deptFilterActive = selectedDepartments.size > 0;
  const sliced = useMemo<SvodViewShape | null>(() => {
    if (!grid || isGridEmpty(grid)) return null;
    const collapsed = collapsePeriods(grid, periodSel.keys);
    return sliceUnified(collapsed.grid, {
      scope,
      scopes: cats,
      period: collapsed.period,
      budgets: budgetSet,
      depts: selectedDepartments,
    }).view;
  }, [grid, scope, cats, periodSel, budgetSet, selectedDepartments]);

  // ── Сверка с официальным листом ──
  const availability = useMemo(
    () => reconAvailability({
      activityIsAll,
      deptFiltered: deptFilterActive,
      budgetFiltered,
      period: periodSel.single,
      hasRows: (resp?.reconciliation ?? []).length > 0,
    }),
    [activityIsAll, deptFilterActive, budgetFiltered, periodSel, resp],
  );
  const badges = useMemo(
    () => reconBadges(resp?.reconciliation ?? [], availability, periodSel.single),
    [resp, availability, periodSel],
  );
  const mismatches = useMemo(
    () => reconMismatches(resp?.reconciliation ?? [], availability, periodSel.single),
    [resp, availability, periodSel],
  );

  // ── Что показывать вместо таблицы ──
  const headRow: SvodRow | null = sliced
    ? (methodFilter ? sliced.summary[methodFilter].year : sliced.summary.total.year)
    : null;
  const sliceEmpty =
    headRow !== null && (headRow.planCount ?? 0) === 0 && (headRow.factCount ?? 0) === 0;
  const periodMissing =
    grid !== undefined && !isGridEmpty(grid) && !hasCellsForPeriods(grid, periodSel.keys);

  const methodPhrase = methodFilter ? ` · только ${SECTION_META[methodFilter].label}` : '';
  const deptPhrase = deptFilterActive
    ? `выбранные управления (${sliced?.departments.length ?? selectedDepartments.size})`
    : 'все управления';
  const scopeLine = `${deptPhrase} · ${activityPhrase(cats)} · ${periodSel.fullLabel}${methodPhrase}`;

  return (
    <div className="space-y-5">
      {/* ── Шапка: заголовок-утверждение, оси, чипы ── */}
      <div className="bg-white dark:bg-zinc-800/60 rounded-xl shadow-sm border border-zinc-100 dark:border-zinc-700/50 p-5">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-cyan-50 dark:bg-cyan-950/40 flex items-center justify-center flex-shrink-0">
              <FileSpreadsheet className="text-cyan-600 dark:text-cyan-400" size={20} aria-hidden />
            </div>
            <div>
              <h2 className="text-base font-semibold text-zinc-800 dark:text-zinc-100">
                {headRow && !sliceEmpty
                  ? headline(headRow)
                  : 'Свод: план, факт и экономия по управлениям'}
              </h2>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                {loading && resp ? 'Пересчитываем свод за выбранный год…' : scopeLine}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {/* Обёртка со всплывающей подсказкой: выключенная кнопка сама
                событий мыши не получает, и причина «почему нельзя» пропала бы. */}
            <span
              title={budgetFiltered
                ? 'Раскладка по бюджетам выключена: бюджет уже выбран в шапке, суммы посчитаны только по нему'
                : budgetFull ? 'Свернуть суммы до одного столбца «Итого»' : 'Показать суммы по каждому бюджету отдельно'}
            >
              <button
                onClick={() => setBudgetFull((v) => !v)}
                className={clsx(
                  'flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-zinc-100 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-300 rounded-lg hover:bg-zinc-200 dark:hover:bg-zinc-600 transition disabled:opacity-40 disabled:cursor-not-allowed',
                  FOCUS_RING,
                )}
                aria-pressed={budgetFull}
                disabled={budgetFiltered}
              >
                {budgetFull ? <Table2 size={13} aria-hidden /> : <Columns3 size={13} aria-hidden />}
                {budgetFull ? 'Свернуть до итога' : 'Показать бюджеты'}
              </button>
            </span>

            <a
              href={SHEET_URL}
              target="_blank"
              rel="noreferrer"
              className={clsx(
                'flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-cyan-50 dark:bg-cyan-950/30 text-cyan-700 dark:text-cyan-300 rounded-lg hover:bg-cyan-100 dark:hover:bg-cyan-900/40 transition',
                FOCUS_RING,
              )}
            >
              <ExternalLink size={13} aria-hidden />
              Открыть официальный лист
            </a>
          </div>
        </div>

        {/* ── Оси: вид деятельности и период. Обе пишут в общий фильтр
              приложения — на этой странице шапка их не показывает, но
              состояние одно, поэтому выбор переживает переход на другой
              экран и обратно. ── */}
        <div className="mt-4 flex flex-col gap-3">
          <fieldset className="flex items-center gap-2 flex-wrap min-w-0">
            <legend className="sr-only">Вид деятельности</legend>
            <span aria-hidden className="text-[10px] uppercase tracking-wider text-zinc-400 dark:text-zinc-500 w-24">
              Деятельность
            </span>
            <div className="flex items-center bg-zinc-100 dark:bg-zinc-700/50 rounded-lg p-0.5">
              <button
                onClick={clearActivities}
                aria-pressed={activityIsAll}
                className={clsx(
                  'px-3 py-1.5 rounded-md text-xs font-medium transition', FOCUS_RING,
                  activityIsAll
                    ? 'bg-cyan-600 text-white shadow-sm'
                    : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200',
                )}
                title="Все строки: программные мероприятия и текущая деятельность целиком"
              >
                ВСЕ
              </button>
            </div>
            <div className="flex items-center gap-1 bg-zinc-100 dark:bg-zinc-700/50 rounded-lg p-0.5">
              {SVOD_ACTIVITY_CATS.map((c) => (
                <button
                  key={c}
                  onClick={() => toggleActivity(CAT_TO_ACTIVITY_KEY[c])}
                  aria-pressed={cats.has(c)}
                  className={clsx(
                    'px-3 py-1.5 rounded-md text-xs font-medium transition inline-flex items-center gap-1.5', FOCUS_RING,
                    cats.has(c)
                      ? 'bg-cyan-600 text-white shadow-sm'
                      : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200',
                  )}
                  title={ACTIVITY_HINT[c]}
                >
                  <span
                    aria-hidden
                    className={clsx(
                      'w-3 h-3 rounded-[4px] border inline-flex items-center justify-center text-[8px] leading-none',
                      cats.has(c)
                        ? 'bg-white/90 border-white/90 text-cyan-700'
                        : 'border-zinc-400 dark:border-zinc-500 text-transparent',
                    )}
                  >
                    ✓
                  </span>
                  {ACTIVITY_LABEL[c]}
                </button>
              ))}
            </div>
            <span className="text-[11px] text-zinc-500 dark:text-zinc-400">
              показано: {activityPhrase(cats)}
            </span>
          </fieldset>

          {/* Пояснение про «ТД-ПМ» удалено: срез упразднён каноном п.30
              (интервью 14.08.2026) — ТД-строки с заполненной графой программы
              входят в ТД целиком, отдельной категории нет. */}

          <fieldset className="flex items-center gap-2 flex-wrap min-w-0">
            <legend className="sr-only">Период</legend>
            <span aria-hidden className="text-[10px] uppercase tracking-wider text-zinc-400 dark:text-zinc-500 w-24">
              Период
            </span>
            {/* Год: шапка приложения на этой странице колесо времени не
                показывает, поэтому без этих кнопок год был бы недостижим. */}
            <div className="flex items-center gap-0.5 bg-zinc-100 dark:bg-zinc-700/50 rounded-lg p-0.5">
              {AVAILABLE_YEARS.map((y) => (
                <button
                  key={y}
                  onClick={() => setYear(y)}
                  aria-pressed={y === gridYear}
                  title={`Данные за ${y} год`}
                  className={clsx(
                    'px-2 py-1 rounded-md text-[11px] font-semibold tabular-nums transition', FOCUS_RING,
                    y === gridYear
                      ? 'bg-cyan-600 text-white shadow-sm'
                      : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200',
                  )}
                >
                  {y}
                </button>
              ))}
            </div>
            <div className="flex items-center bg-zinc-100 dark:bg-zinc-700/50 rounded-lg p-0.5">
              <button
                onClick={pickYear}
                aria-pressed={activeBtn?.kind === 'year'}
                title={`Все закупки ${gridYear} года, без разбивки по кварталам и месяцам`}
                className={clsx(
                  'px-3 py-1.5 rounded-md text-xs font-medium transition', FOCUS_RING,
                  activeBtn?.kind === 'year'
                    ? 'bg-cyan-600 text-white shadow-sm'
                    : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200',
                )}
              >
                Весь год
              </button>
            </div>
            <div className="flex items-center gap-0.5 bg-zinc-100 dark:bg-zinc-700/50 rounded-lg p-0.5">
              {[1, 2, 3, 4].map((q) => (
                <button
                  key={q}
                  onClick={() => pickQuarter(q)}
                  aria-pressed={activeBtn?.kind === 'quarter' && activeBtn.quarter === q}
                  title={`${quarterLabel(q)} ${gridYear} года`}
                  className={clsx(
                    'px-2.5 py-1 rounded-md text-xs font-medium transition', FOCUS_RING,
                    activeBtn?.kind === 'quarter' && activeBtn.quarter === q
                      ? 'bg-zinc-700 dark:bg-zinc-200 text-white dark:text-zinc-800 shadow-sm'
                      : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200',
                  )}
                >
                  {quarterLabel(q)}
                </button>
              ))}
            </div>
            <div className="flex items-center flex-wrap gap-0.5 bg-zinc-100 dark:bg-zinc-700/50 rounded-lg p-0.5">
              {MONTHS.map((m) => (
                <button
                  key={m.id}
                  onClick={() => pickMonth(m.id)}
                  aria-pressed={activeBtn?.kind === 'month' && activeBtn.month === m.id}
                  title={`${m.full} ${gridYear} года`}
                  className={clsx(
                    'px-2 py-1 rounded-md text-[11px] font-medium transition', FOCUS_RING,
                    activeBtn?.kind === 'month' && activeBtn.month === m.id
                      ? 'bg-zinc-700 dark:bg-zinc-200 text-white dark:text-zinc-800 shadow-sm'
                      : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200',
                  )}
                >
                  {m.short}
                </button>
              ))}
            </div>
            {activeBtn === null && (
              <span className="text-[11px] text-zinc-500 dark:text-zinc-400">
                выбраны {periodSel.shortLabel} — сложены без двойного счёта
              </span>
            )}
          </fieldset>
        </div>

        {/* Бюджет-фильтр режет деньги, но не количества — это надо сказать вслух:
            иначе читатель делит «свои» суммы на «все» штуки и получает неверную
            среднюю цену закупки. */}
        {budgetFiltered && (
          <Notice tone="info">
            Выбран бюджет: {[...budgetSet].map((b) => BUDGET_PHRASE[b]).join(', ')}.
            План, факт и экономия посчитаны только по нему. Количество закупок по бюджетам
            не делится — столбцы «Количество» показывают все закупки среза целиком.
          </Notice>
        )}

        {/* Фильтры, которые эта страница применить не может. Молчать о них
            нельзя: в шапке они видны крошкой, и читатель вправе считать, что
            числа под ними уже сужены. */}
        {selectedSubordinates.size > 0 && (
          <Notice tone="muted">
            Фильтр по подведомственным учреждениям здесь не действует: свод считается по
            управлениям целиком, разреза по учреждениям в нём нет. Показаны все учреждения
            выбранных управлений. Построчный разрез — на странице «Реестр».
          </Notice>
        )}
        {searchQuery.trim() !== '' && (
          <Notice tone="muted">
            Текстовый поиск «{searchQuery.trim()}» здесь не действует: свод показывает итоги
            по управлениям, а не отдельные закупки. Искать строки — на странице «Реестр».
          </Notice>
        )}

        {/* Сводные чипы — те же числа, что в строке ИТОГО таблицы */}
        {headRow && !sliceEmpty && (
          <div className="mt-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5">
            <SummaryChip
              metricKey="plan_count"
              value={countText(headRow.planCount)}
              live={`${countText(headRow.planCount)} закупок запланировано за ${periodSel.shortLabel}`}
            />
            <SummaryChip
              metricKey="fact_count"
              value={countText(headRow.factCount)}
              live={`${countText(headRow.factCount)} закупок состоялось за ${periodSel.shortLabel}`}
            />
            <SummaryChip
              metricKey="exec_count_pct"
              value={pctText(headRow.executionPct)}
              valueClass={execColorClass(headRow.executionPct)}
              live={`${pctText(headRow.executionPct)} = ${countText(headRow.factCount)} ÷ ${countText(headRow.planCount)}`}
            />
            <SummaryChip
              metricKey="economy_total"
              value={`${fmtMoney(headRow.economyTotal)} ${moneyLabel}`}
              live={`${fmtMoney(headRow.economyTotal)} = ${fmtMoney(headRow.economyFB)} + ${fmtMoney(headRow.economyKB)} + ${fmtMoney(headRow.economyMB)} (${moneyLabel})`}
            />
            {methodFilter === null && sliced && (
              <SummaryChip
                metricKey="ep_share_pct"
                value={pctText(epShareOf(sliced))}
                live={`${pctText(epShareOf(sliced))} = ${countText(sliced.summary.ep.year.planCount)} ÷ ${countText(sliced.summary.total.year.planCount)} (по количеству)`}
              />
            )}
          </div>
        )}
      </div>

      {/* ── Таблица либо честное объяснение, почему её нет ── */}
      {loading && !resp ? (
        <div>
          <p className="mb-2 text-xs text-zinc-500 dark:text-zinc-400">Считаем свод по строкам реестра…</p>
          <SkeletonTable rows={9} />
        </div>
      ) : error !== null ? (
        <StatePanel
          tone="error"
          icon={<AlertTriangle className="mx-auto text-red-400 dark:text-red-500 mb-3" size={40} aria-hidden />}
          title="Свод не загрузился"
          text="Данные читает сервер: он берёт книги управлений из Google Таблиц и считает свод. Повторите обновление в шапке, а если ошибка повторяется — сообщите администратору."
          detail={error}
        />
      ) : !grid || isGridEmpty(grid) ? (
        <StatePanel
          tone="warning"
          icon={<FileSpreadsheet className="mx-auto text-amber-400 dark:text-amber-500 mb-3" size={40} aria-hidden />}
          title="Книги управлений не прочитаны"
          text="Свод считается по строкам реестра, а строк сейчас нет. Нажмите «Обновить» в шапке; если и после этого пусто — проверьте доступ служебного пользователя к Google Таблицам."
        />
      ) : periodMissing ? (
        <StatePanel
          tone="neutral"
          icon={<CalendarOff className="mx-auto text-zinc-400 mb-3" size={40} aria-hidden />}
          title={`За выбранный период (${periodSel.shortLabel}) строк нет`}
          text="В книгах управлений нет ни одной закупки, отнесённой к этому периоду. Выберите другой период кнопками выше."
        />
      ) : !sliced || sliceEmpty ? (
        <StatePanel
          tone="neutral"
          icon={<CalendarOff className="mx-auto text-zinc-400 mb-3" size={40} aria-hidden />}
          title="Под выбранные условия строк не нашлось"
          text={`Выбрано: ${scopeLine}. Снимите часть условий — вид деятельности, управление или способ закупки — чтобы увидеть числа.`}
        />
      ) : (
        <div className="bg-white dark:bg-zinc-800/60 rounded-xl shadow-sm border border-zinc-100 dark:border-zinc-700/50 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse">
              <caption className="sr-only">
                Свод по управлениям: количество, план, факт и экономия. {scopeLine}
              </caption>
              <SvodTableHead budgetFull={showBudgetBreakdown} moneyLabel={moneyLabel} />
              <tbody>
                <BlockGroup
                  title={deptFilterActive ? 'Итог по выбранным управлениям' : 'Итог по всем управлениям'}
                  subtitle={scopeLine}
                  block={sliced.summary}
                  budgetFull={showBudgetBreakdown}
                  fmtMoney={fmtMoney}
                  visibleKinds={visibleKinds}
                  reconByKind={{ kp: badges.kp, ep: badges.ep }}
                  emphasized
                  onOpenRows={() => navigateTo('data')}
                  openRowsHint="Открыть Реестр с теми же фильтрами шапки: строки, из которых сложены эти итоги"
                />
                {sliced.departments.map((d) => (
                  <BlockGroup
                    key={d.id}
                    title={d.shortName}
                    subtitle={d.name}
                    block={d.block}
                    budgetFull={showBudgetBreakdown}
                    fmtMoney={fmtMoney}
                    visibleKinds={visibleKinds}
                    onOpenRows={() => navigateTo('data', { department: d.id })}
                    openRowsHint={`Открыть Реестр, оставив только строки управления «${d.shortName}»: период и способ из шапки сохранятся`}
                  />
                ))}
              </tbody>
            </table>
          </div>

          <ReconFooter
            availability={availability}
            mismatches={mismatches}
            fmtMoney={fmtMoney}
            periodLabel={periodSel.shortLabel}
          />

          <p className="px-4 py-2.5 text-[10px] text-zinc-400 dark:text-zinc-500 border-t border-zinc-100 dark:border-zinc-700/50">
            Числа посчитаны по строкам книг управлений, а не сняты с формул листа: лист служит
            эталоном для сверки. Как считает лист: план — по всем счётным строкам периода;
            факт и экономия — только по строкам с заполненной датой заключения, поэтому
            «закупки, проводимые в течение года» входят в план листа, но не в его факт и
            экономию. Единица листа — тысячи рублей. «ИТОГО» = конкурентные процедуры плюс
            единственный поставщик. Управление здесь — главный распорядитель бюджетных
            средств (ГРБС). Строки-вкладчицы любого блока открываются ссылкой «строки в
            Реестре» в его заголовке.
          </p>
        </div>
      )}
    </div>
  );
}

// ── Подкомпоненты ────────────────────────────────────────────────────

/**
 * Заголовок-утверждение о числах, а не витринное название страницы.
 * Факт без плана — отдельная формулировка: «Исполнение нет плана» читалось бы
 * как поломка, хотя это осмысленное состояние данных.
 */
function headline(row: SvodRow): string {
  const plan = row.planCount ?? 0;
  const fact = row.factCount ?? 0;
  if (plan === 0) return `Плана нет, а закупок состоялось ${countText(fact)}`;
  return `Исполнение ${pctText(row.executionPct)} — ${countText(fact)} из ${countText(plan)} закупок`;
}

/** Доля ЕП по количеству плановых закупок; нулевой план → «нет плана». */
function epShareOf(view: SvodViewShape): number | null {
  const total = view.summary.total.year.planCount ?? 0;
  if (total === 0) return null;
  return (view.summary.ep.year.planCount ?? 0) / total;
}

/** Строка-пояснение под осями: что именно сейчас с числами делает фильтр. */
function Notice({ tone, children }: { tone: 'info' | 'muted'; children: ReactNode }) {
  return (
    <p
      className={clsx(
        'mt-3 flex items-start gap-2 text-[11px] leading-snug rounded-lg px-3 py-2 border',
        tone === 'info'
          ? 'text-blue-800 dark:text-blue-200 bg-blue-50/70 dark:bg-blue-950/30 border-blue-100 dark:border-blue-900/40'
          : 'text-zinc-600 dark:text-zinc-300 bg-zinc-50 dark:bg-zinc-900/40 border-zinc-100 dark:border-zinc-700/40',
      )}
    >
      <Info size={13} className="mt-px flex-shrink-0" aria-hidden />
      <span>{children}</span>
    </p>
  );
}

function StatePanel({
  tone, icon, title, text, detail,
}: {
  tone: 'error' | 'warning' | 'neutral';
  icon: ReactNode;
  title: string;
  text: string;
  /** Технический текст — мелким и в скобках, не в заголовке. */
  detail?: string;
}) {
  const border =
    tone === 'error' ? 'border-red-200 dark:border-red-700/50'
      : tone === 'warning' ? 'border-amber-200 dark:border-amber-700/50'
        : 'border-zinc-100 dark:border-zinc-700/50';
  return (
    <div
      role={tone === 'error' ? 'alert' : undefined}
      className={clsx('bg-white dark:bg-zinc-800/60 rounded-xl shadow-sm border p-12 text-center', border)}
    >
      {icon}
      <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">{title}</p>
      <p className="text-xs text-zinc-500 dark:text-zinc-400 max-w-md mx-auto">{text}</p>
      {detail && (
        <p className="mt-3 text-[10px] text-zinc-400 dark:text-zinc-500 max-w-md mx-auto break-words">
          ({detail})
        </p>
      )}
    </div>
  );
}

function SummaryChip({
  metricKey, value, valueClass, live,
}: { metricKey: string; value: string; valueClass?: string; live: string }) {
  return (
    <div className="rounded-lg bg-zinc-50 dark:bg-zinc-900/40 border border-zinc-100 dark:border-zinc-700/40 px-3 py-2">
      <div className="text-[10px] text-zinc-400 dark:text-zinc-500 truncate">{productLabel(metricKey)}</div>
      <div className={clsx('text-sm font-semibold tabular-nums mt-0.5', valueClass ?? 'text-zinc-800 dark:text-zinc-100')}>
        <KbHover metricKey={metricKey} live={live}>{value}</KbHover>
      </div>
    </div>
  );
}

/**
 * Бейдж сверки. Негорящий бейдж не исчезает: молчаливое исчезновение читалось
 * как «всё сверено», хотя сверки не было вовсе.
 */
function ReconBadgeTag({ badge }: { badge: ReconBadge }) {
  if (badge.status === 'none') {
    return (
      <span
        className="inline-flex items-center gap-0.5 px-1 py-0.5 rounded text-[9px] font-medium bg-zinc-100 text-zinc-500 dark:bg-zinc-700/60 dark:text-zinc-400"
        title={badge.reason}
        aria-label={`Сверка не выполнена. ${badge.reason}`}
      >
        <ShieldOff size={10} aria-hidden /> нет сверки
      </span>
    );
  }
  if (badge.status === 'ok') {
    return (
      <span
        className="inline-flex items-center gap-0.5 px-1 py-0.5 rounded text-[9px] font-semibold bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
        title={`Сверено с официальным листом: ${badge.checked} показателей совпали, расхождение меньше 1 %`}
        aria-label={`Сверено с официальным листом: ${badge.checked} показателей совпали`}
      >
        <ShieldCheck size={10} aria-hidden /> сверено
      </span>
    );
  }
  const warn = badge.status === 'warning';
  const text = `Расхождение с официальным листом до ${pctText(badge.worstDeltaPct / 100)} по ${badge.checked} показателям`;
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-0.5 px-1 py-0.5 rounded text-[9px] font-semibold',
        warn
          ? 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300'
          : 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300',
      )}
      title={text}
      aria-label={text}
    >
      <ShieldAlert size={10} aria-hidden /> {pctText(badge.worstDeltaPct / 100)}
    </span>
  );
}

function SvodTableHead({ budgetFull, moneyLabel }: { budgetFull: boolean; moneyLabel: string }) {
  const moneySpan = budgetFull ? 4 : 1;
  const th = 'px-2.5 py-2 font-semibold text-zinc-500 dark:text-zinc-400 border-b border-zinc-200 dark:border-zinc-700';
  const sub = 'px-2.5 py-1.5 font-medium text-[10px] text-zinc-400 dark:text-zinc-500 border-b border-zinc-200 dark:border-zinc-700 text-right';
  const budgetHeads = (
    <>
      <th scope="col" className={clsx(sub, 'border-l border-zinc-200 dark:border-zinc-700')} title={UI_LABELS['budget.fb']}>ФБ</th>
      <th scope="col" className={sub} title={UI_LABELS['budget.kb']}>КБ</th>
      <th scope="col" className={sub} title={UI_LABELS['budget.mb']}>МБ</th>
      <th scope="col" className={clsx(sub, 'font-semibold text-zinc-500')}>Итого</th>
    </>
  );
  return (
    <thead className="sticky top-0 z-10 bg-zinc-50 dark:bg-zinc-900/80 backdrop-blur">
      <tr className="text-[10px] uppercase tracking-wider">
        <th scope="col" className={clsx(th, 'text-left sticky left-0 bg-zinc-50 dark:bg-zinc-900/80')} rowSpan={2}>
          Управление · раздел
        </th>
        <th scope="colgroup" className={clsx(th, 'text-center border-l border-zinc-200 dark:border-zinc-700')} colSpan={4}>
          Количество, ед.
        </th>
        {/* Подписи «как считает лист» (задание группы): по наведению на группу
            столбцов видно правило формул официального листа — с ним и сверяемся. */}
        <th
          scope="colgroup"
          className={clsx(th, GROUP_HEAD.plan, 'text-center border-l border-zinc-200 dark:border-zinc-700')}
          colSpan={moneySpan}
          title="Как считает лист: плановые деньги суммируются по всем счётным строкам периода — условия по дате заключения у формул плана нет, поэтому «закупки, проводимые в течение года» в план входят."
        >
          План, {moneyLabel}
        </th>
        <th
          scope="colgroup"
          className={clsx(th, GROUP_HEAD.fact, 'text-center border-l border-zinc-200 dark:border-zinc-700')}
          colSpan={moneySpan}
          title="Как считает лист: фактические деньги суммируются только по строкам с заполненной датой заключения — строки без даты (стадия «в течение года») в факт листа не попадают."
        >
          Факт, {moneyLabel}
        </th>
        <th
          scope="colgroup"
          className={clsx(th, GROUP_HEAD.eco, 'text-center border-l border-zinc-200 dark:border-zinc-700')}
          colSpan={moneySpan}
          title="Как считает лист: экономия суммируется по тем же строкам, что и факт, — только при заполненной дате заключения. Экономии без заключения не бывает."
        >
          Экономия, {moneyLabel}
        </th>
      </tr>
      <tr>
        <th scope="col" className={clsx(sub, 'border-l border-zinc-200 dark:border-zinc-700')}>План</th>
        <th scope="col" className={sub}>Факт</th>
        <th scope="col" className={sub} title="Факт минус план: отрицательное значение — недобор">Откл.</th>
        <th scope="col" className={sub} title="Факт ÷ план по количеству закупок">Вып. %</th>
        {budgetFull ? (
          <>
            {budgetHeads}
            {budgetHeads}
            {budgetHeads}
          </>
        ) : (
          <>
            <th scope="col" className={clsx(sub, 'border-l border-zinc-200 dark:border-zinc-700')}>Итого</th>
            <th scope="col" className={clsx(sub, 'border-l border-zinc-200 dark:border-zinc-700')}>Итого</th>
            <th scope="col" className={clsx(sub, 'border-l border-zinc-200 dark:border-zinc-700')}>Итого</th>
          </>
        )}
      </tr>
    </thead>
  );
}

function BlockGroup({
  title, subtitle, block, budgetFull, fmtMoney, emphasized, visibleKinds, reconByKind,
  onOpenRows, openRowsHint,
}: {
  title: string;
  subtitle: string;
  block: SvodBlock;
  budgetFull: boolean;
  fmtMoney: (n: number | null) => string;
  emphasized?: boolean;
  visibleKinds: SectionKind[];
  reconByKind?: Partial<Record<SectionKind, ReconBadge>>;
  /** Шов Свод → Реестр (п.91-8): показать строки-вкладчицы блока. */
  onOpenRows?: () => void;
  openRowsHint?: string;
}) {
  const colCount = 1 + 4 + (budgetFull ? 4 : 1) * 3;
  // Срез кладёт выбранный период в обе ноги секции — берём year.
  const allRows: Array<{ kind: SectionKind; row: SvodRow }> = [
    { kind: 'kp', row: block.kp.year },
    { kind: 'ep', row: block.ep.year },
    { kind: 'total', row: block.total.year },
  ];
  const rows = allRows.filter((r) => visibleKinds.includes(r.kind));

  return (
    <>
      <tr className={clsx(emphasized ? 'bg-cyan-50/60 dark:bg-cyan-950/20' : 'bg-zinc-50/70 dark:bg-zinc-900/30')}>
        <th
          scope="colgroup"
          colSpan={colCount}
          className="px-3 py-2 text-left sticky left-0 z-[1] backdrop-blur-sm bg-inherit font-normal"
        >
          <span className="flex items-center gap-2 min-w-0">
            <span className={clsx('font-semibold', emphasized ? 'text-cyan-800 dark:text-cyan-200' : 'text-zinc-700 dark:text-zinc-200')}>
              {title}
            </span>
            <span className="text-[10px] truncate text-zinc-400 dark:text-zinc-500">{subtitle}</span>
            {/* Провенанс блока: те же строки — в Реестре (взаимный шов со «Строками») */}
            {onOpenRows && (
              <button
                type="button"
                onClick={onOpenRows}
                title={openRowsHint}
                className={clsx(
                  'ml-auto flex-shrink-0 text-[10px] font-medium text-cyan-700 dark:text-cyan-300 hover:underline whitespace-nowrap',
                  FOCUS_RING,
                )}
              >
                строки в Реестре
              </button>
            )}
          </span>
        </th>
      </tr>
      {rows.map(({ kind, row }) => (
        <SvodDataRow
          key={kind}
          kind={kind}
          row={row}
          budgetFull={budgetFull}
          fmtMoney={fmtMoney}
          reconBadge={reconByKind?.[kind]}
        />
      ))}
    </>
  );
}

function SvodDataRow({
  kind, row, budgetFull, fmtMoney, reconBadge,
}: {
  kind: SectionKind;
  row: SvodRow;
  budgetFull: boolean;
  fmtMoney: (n: number | null) => string;
  reconBadge?: ReconBadge;
}) {
  const meta = SECTION_META[kind];
  const isTotal = kind === 'total';
  const num = 'px-2.5 py-1.5 text-right tabular-nums whitespace-nowrap';
  const numMuted = clsx(num, 'text-zinc-600 dark:text-zinc-300');

  return (
    <tr
      className={clsx(
        'border-b border-zinc-100 dark:border-zinc-800/60 transition',
        isTotal
          ? 'bg-zinc-50/80 dark:bg-zinc-900/40 font-semibold'
          : 'hover:bg-zinc-50 dark:hover:bg-zinc-700/20',
      )}
    >
      <th scope="row" className="px-3 py-1.5 text-left font-normal sticky left-0 z-[1] bg-inherit">
        <span className="inline-flex items-center gap-1.5">
          <span
            className={clsx('inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold', meta.tagClass)}
            title={meta.hint}
          >
            {meta.label}
          </span>
          {reconBadge && <ReconBadgeTag badge={reconBadge} />}
        </span>
      </th>

      <td className={clsx(numMuted, 'border-l border-zinc-100 dark:border-zinc-800/60')}>{countText(row.planCount)}</td>
      <td className={numMuted}>{countText(row.factCount)}</td>
      <td className={clsx(num, deviationColor(row.deviationCount))}>{countText(row.deviationCount)}</td>
      <td className={clsx(num, 'font-semibold', execColorClass(row.executionPct))}>{pctText(row.executionPct)}</td>

      {budgetFull ? (
        <>
          <td className={clsx(numMuted, GROUP_CELL.plan, 'border-l border-zinc-200 dark:border-zinc-700')}>{fmtMoney(row.planFB)}</td>
          <td className={clsx(numMuted, GROUP_CELL.plan)}>{fmtMoney(row.planKB)}</td>
          <td className={clsx(numMuted, GROUP_CELL.plan)}>{fmtMoney(row.planMB)}</td>
          <td className={clsx(num, GROUP_CELL.plan, 'font-semibold text-blue-800 dark:text-blue-200')}>{fmtMoney(row.planTotal)}</td>
        </>
      ) : (
        <td className={clsx(num, GROUP_CELL.plan, 'font-medium text-blue-800 dark:text-blue-200 border-l border-zinc-200 dark:border-zinc-700')}>{fmtMoney(row.planTotal)}</td>
      )}

      {budgetFull ? (
        <>
          <td className={clsx(numMuted, GROUP_CELL.fact, 'border-l border-zinc-200 dark:border-zinc-700')}>{fmtMoney(row.factFB)}</td>
          <td className={clsx(numMuted, GROUP_CELL.fact)}>{fmtMoney(row.factKB)}</td>
          <td className={clsx(numMuted, GROUP_CELL.fact)}>{fmtMoney(row.factMB)}</td>
          <td className={clsx(num, GROUP_CELL.fact, 'font-semibold text-violet-800 dark:text-violet-200')}>{fmtMoney(row.factTotal)}</td>
        </>
      ) : (
        <td className={clsx(num, GROUP_CELL.fact, 'font-medium text-violet-800 dark:text-violet-200 border-l border-zinc-200 dark:border-zinc-700')}>{fmtMoney(row.factTotal)}</td>
      )}

      {budgetFull ? (
        <>
          <td className={clsx(numMuted, GROUP_CELL.eco, 'border-l border-zinc-200 dark:border-zinc-700')}>{fmtMoney(row.economyFB)}</td>
          <td className={clsx(numMuted, GROUP_CELL.eco)}>{fmtMoney(row.economyKB)}</td>
          <td className={clsx(numMuted, GROUP_CELL.eco)}>{fmtMoney(row.economyMB)}</td>
          <td className={clsx(num, GROUP_CELL.eco, 'font-semibold text-emerald-700 dark:text-emerald-300')}>{fmtMoney(row.economyTotal)}</td>
        </>
      ) : (
        <td className={clsx(num, GROUP_CELL.eco, 'font-medium text-emerald-700 dark:text-emerald-300 border-l border-zinc-200 dark:border-zinc-700')}>{fmtMoney(row.economyTotal)}</td>
      )}
    </tr>
  );
}

/** Итог сверки под таблицей: доступна ли она, и что именно разошлось. */
function ReconFooter({
  availability, mismatches, fmtMoney, periodLabel,
}: {
  availability: ReconAvailability;
  mismatches: ReconRow[];
  fmtMoney: (n: number | null) => string;
  periodLabel: string;
}) {
  if (!availability.available) {
    return (
      <div className="px-4 py-2.5 border-t border-zinc-100 dark:border-zinc-700/50 flex items-start gap-2 text-[11px] text-zinc-500 dark:text-zinc-400">
        <ShieldOff size={12} className="mt-px flex-shrink-0 text-zinc-400" aria-hidden />
        <span>Сверка с официальным листом не выполнена. {availability.reason}</span>
      </div>
    );
  }
  if (mismatches.length === 0) {
    return (
      <div className="px-4 py-2.5 border-t border-emerald-100 dark:border-emerald-900/40 flex items-start gap-2 text-[11px] text-emerald-700 dark:text-emerald-300 bg-emerald-50/50 dark:bg-emerald-950/20">
        <ShieldCheck size={12} className="mt-px flex-shrink-0" aria-hidden />
        <span>Расчёт полностью сходится с официальным листом за {periodLabel}: расхождение меньше 1 %.</span>
      </div>
    );
  }
  return (
    <div className="p-4 border-t border-zinc-100 dark:border-zinc-700/50 space-y-1.5">
      <div className="text-[11px] font-medium text-zinc-600 dark:text-zinc-300 flex items-center gap-1.5">
        <ShieldAlert size={13} className="text-amber-500" aria-hidden />
        Расчёт и официальный лист разошлись за {periodLabel}:
      </div>
      {mismatches.map((r) => (
        <div key={r.key} className="flex items-start gap-2 text-[11px]">
          <span
            className={clsx(
              'mt-px px-1.5 py-0.5 rounded font-semibold tabular-nums flex-shrink-0',
              r.status === 'high'
                ? 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300'
                : 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300',
            )}
          >
            {r.deltaPct > 0 ? '+' : ''}{pctText(r.deltaPct / 100)}
          </span>
          <span className="text-zinc-700 dark:text-zinc-300">
            {reconKeyLabel(r.key)}
            <span className="text-zinc-400 dark:text-zinc-500">
              {' · '}расчёт {reconValue(r.key, r.calc, fmtMoney)} против листа {reconValue(r.key, r.official, fmtMoney)}
            </span>
          </span>
        </div>
      ))}
    </div>
  );
}

/** Значение показателя сверки: количество — штуками, суммы — деньгами. */
function reconValue(key: string, v: number, fmtMoney: (n: number | null) => string): string {
  return isCountMetric(key) ? countText(v) : fmtMoney(v);
}
