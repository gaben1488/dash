import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useStore, hasExplicitPeriodFilter, AVAILABLE_YEARS, MONTHS } from '../store';
import { api, humanizeRequestError } from '../api';
import {
  SVOD_SPREADSHEET_ID,
  ACTIVITY_LABEL,
  buildSheetUrl,
  SVOD_SHEET_BLOCK_TITLES,
  SVOD_SHEET_EXTRAS,
  SVOD_SWITCH_BY_SCOPE,
  THRESHOLDS,
  UI_LABELS,
  productLabel,
  quarterLabel,
  svodSheetName,
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
import {
  orderDeptBlocks,
  SVOD_ORDER_HINT,
  SVOD_ORDER_LABEL,
  type SvodOrder,
} from '../lib/svod/order';
import { collapsePeriods, hasCellsForPeriods, isGridEmpty } from '../lib/svod/grid';
import {
  epShareByCount,
  methodShares,
  remainderToConclude,
  type SvodMethodShares,
  type SvodRemainder,
} from '../lib/svod/sheet-metrics';
import { Notice } from '../components/report/FilterNotices';
import { PeriodBadge } from '../components/PeriodBadge';
import { SourceBadge } from '../components/contract/SourceBadge';
import { useOrgScope, type OrgScope } from '../lib/selectors/org-scope';
import { readingMoment } from '../lib/reading-moment';
import {
  isCountMetric,
  reconAvailability,
  reconBadges,
  reconDiagnosis,
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
import { CARD, CARD_SURFACE, RULE_HEAD, RULE_ROW } from '../components/dashboard/surfaces';

// Словарь линеек «Свода» (канон п.129). Поверхности в тёмной теме
// разделяет светлота, но таблица без линеек читается хуже: границы групп
// столбцов и разделители строк остаются, но самыми тихими тонами.
const RULE_T = `border-t ${RULE_HEAD}`;
const RULE_ROW_T = `border-t ${RULE_ROW}`;
const RULE_ROW_B = `border-b ${RULE_ROW}`;
const RULE_ROW_L = `border-l ${RULE_ROW}`;
const RULE_HEAD_B = `border-b ${RULE_HEAD}`;
/** Граница между группами столбцов (план / факт / экономия). */
const COL_RULE = `border-l ${RULE_HEAD}`;


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

// Подсказки разделов — заголовки блоков листа СВОД ТД-ПМ дословно (D3/D15/A28):
// раздел на экране и раздел на листе обязаны называться одним и тем же.
const SECTION_META: Record<SectionKind, { label: string; hint: string; tagClass: string }> = {
  kp: {
    label: 'КП',
    hint: `Блок листа «${SVOD_SHEET_BLOCK_TITLES.kp}»`,
    tagClass: 'bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300',
  },
  ep: {
    label: 'ЕП',
    hint: `Блок листа «${SVOD_SHEET_BLOCK_TITLES.ep}»`,
    tagClass: 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300',
  },
  total: {
    label: 'ИТОГО',
    hint: `Строка листа «${SVOD_SHEET_BLOCK_TITLES.total}»: конкурентные процедуры плюс единственный поставщик`,
    tagClass: 'bg-zinc-100 text-zinc-700 dark:bg-zinc-700/60 dark:text-zinc-200',
  },
};

// Цветовая кодировка групп столбцов повторяет листы СВОД/ШДЮ: план, факт и
// экономия отличаются заливкой, как в оригинале (A4C2F4 / DDD6FE / B6D7A8,
// ИТОГО C9DAF8 / D9D2E9 / D9EAD3). Оговорка про имена классов, чтобы не
// вводить читателя кода в заблуждение: палитры blue/sky/indigo в настройках
// оформления переопределены кремовой шкалой (п.115), поэтому «blue» ниже
// рисуется КРЕМОВЫМ, а не голубым; сиреневая и зелёная группы — свои цвета.
// Смысл группы держит подпись столбца («План», «Факт», «Экономия»), а не
// заливка: текстовый дубль обязателен, печать бывает чёрно-белой.
const GROUP_HEAD = {
  plan: 'bg-blue-100/70 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300',
  fact: 'bg-violet-100/70 dark:bg-violet-950/40 text-violet-800 dark:text-violet-200',
  eco: 'bg-emerald-100/70 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-200',
} as const;
const GROUP_CELL = {
  plan: 'bg-blue-50/60 dark:bg-blue-950/30',
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

  // Порядок блоков управлений (работа 5.3 карты вкладки). Тоже раскладка, а
  // не фильтр: ни одно число от него не меняется, меняется только строка, с
  // которой читатель начинает. Потому и состояние местное — переносить
  // порядок таблицы на соседние экраны было бы нечего.
  const [deptOrder, setDeptOrder] = useState<SvodOrder>('registry');

  // Организационный срез (приказ владельца 20.08.2026). Свод строится по
  // главным распорядителям: ячейка единой сетки заведена на ГРБС, разреза по
  // подведомственным учреждениям в ней нет вовсе. Значит, разбивку по подведам
  // эта страница построить не может — и обязана сказать об этом словами, а не
  // молча показать строку управления так, будто выбор режима на неё повлиял.
  const orgScope = useOrgScope();

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

  // Блоки управлений в выбранном порядке. Числа не трогаются — меняется
  // только последовательность (правила — `lib/svod/order.ts`).
  const orderedDepartments = useMemo(
    () => (sliced ? orderDeptBlocks(sliced.departments, deptOrder) : []),
    [sliced, deptOrder],
  );

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

  // ── Ярус листа поверх блоков (до 18.08.2026 вкладка его не показывала) ──
  // «Остаток к заключ.» шапки листа и строки долей ЭА/ЕП. Считаются по строке
  // ИТОГО текущего среза, а не по одной ячейке листа: срез шире, арифметика та же.
  const remainder = useMemo<SvodRemainder | null>(
    () => (headRow ? remainderToConclude(headRow) : null),
    [headRow],
  );
  const shares = useMemo<SvodMethodShares | null>(
    () => (sliced ? methodShares(sliced.summary) : null),
    [sliced],
  );
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
      <div className={`${CARD} rounded-xl shadow-sm dark:shadow-none p-5`}>
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-cyan-50 dark:bg-cyan-950/40 flex items-center justify-center flex-shrink-0">
              <FileSpreadsheet className="text-cyan-600 dark:text-cyan-400" size={20} aria-hidden />
            </div>
            <div>
              {/* Имя раздела существительным — оно не меняется от чисел;
                  рядом происхождение: всё на странице пересчитано по строкам
                  книг, лист служит эталоном сверки, а не источником. */}
              <div className="flex items-center gap-2 mb-0.5">
                <span className="text-[10px] uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
                  Свод по управлениям
                </span>
                <span title="Числа пересчитаны по строкам книг управлений; официальный лист СВОД служит эталоном сверки — её итог под таблицей.">
                  <SourceBadge source="calc" />
                </span>
              </div>
              <h2 className="text-base font-semibold text-zinc-800 dark:text-zinc-100">
                {headRow && !sliceEmpty
                  ? headline(headRow)
                  : 'План, факт и экономия по управлениям'}
              </h2>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                {loading && resp ? 'Пересчитываем свод за выбранный год…' : scopeLine}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {/* Периметр у самих чисел, а не только в строке охвата под
                заголовком (канон п.58): плашка называет период, которому числа
                подчиняются, а подпись рядом — момент, на который они верны.
                Период и момент — разные оси: «весь 2026 год» ничего не говорит
                о том, когда книги читали в последний раз. */}
            <ReadMomentNote />
            <PeriodBadge />
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
                  {/* Квадратик отбора — орган управления: его обводка остаётся
                      в обеих темах (канон п.129 снимает рамку с поверхностей,
                      не с флажков). Пустой флажок без края — пустое место. */}
                  <span
                    aria-hidden
                    className={clsx(
                      'w-3 h-3 rounded-[4px] border inline-flex items-center justify-center text-[8px] leading-none',
                      cats.has(c)
                        ? 'bg-white/90 border-white/90 text-cyan-700'
                        : 'border-zinc-400 dark:border-transparent text-transparent',
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
            {/* Тот же выбор на листе — переключатель B1. Молчать об этом нельзя:
                ВСЕ формулы листа несут условие «вид деятельности = B1», и
                читатель, сверяющий число с листом, обязан знать, в каком
                положении переключатель даёт то же самое. */}
            <span
              className="text-[11px] text-zinc-400 dark:text-zinc-500"
              title={`Все COUNTIFS и SUMIFS листа фильтруют строки условием «вид деятельности = B1». Расшифровка листа: «${SVOD_SHEET_EXTRAS.switchLegend}». Одно отличие: критерий «*» на листе ловит только НЕПУСТОЙ вид деятельности, поэтому строка с пустой графой в число листа не входит, а в срез «ВСЕ» здесь входит.`}
            >
              на листе это переключатель B1 = «{SVOD_SWITCH_BY_SCOPE[scope]}»
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

        {/* Организационный срез: что режим подведомственных делает — и чего
            не делает — с числами этой страницы. */}
        <OrgScopeNotice scope={orgScope} onOpenRows={() => navigateTo('data')} />

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

        {/* Сводные чипы — те же числа, что в строке ИТОГО таблицы. Подписи
            берутся из карты имён листа (SVOD_SHEET_FIELDS), а не пишутся тут:
            после переименования 18.08.2026 экран обязан говорить словами листа. */}
        {headRow && !sliceEmpty && (
          <div className="mt-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
            <SummaryChip
              metricKey="plan_count"
              label={svodSheetName('planCount')}
              value={countText(headRow.planCount)}
              live={`${countText(headRow.planCount)} закупок запланировано за ${periodSel.shortLabel}`}
            />
            <SummaryChip
              metricKey="fact_count"
              label={svodSheetName('factCount')}
              value={countText(headRow.factCount)}
              live={`${countText(headRow.factCount)} закупок состоялось за ${periodSel.shortLabel}`}
            />
            <SummaryChip
              metricKey="exec_count_pct"
              label={svodSheetName('executionPct')}
              value={pctText(headRow.executionPct)}
              valueClass={execColorClass(headRow.executionPct)}
              live={`${pctText(headRow.executionPct)} = ${countText(headRow.factCount)} ÷ ${countText(headRow.planCount)} (столбец G листа)`}
            />
            {/* Столбец Q листа. Его на вкладке не было вовсе, хотя число уже
                считалось: «Законтрактовано» — деньги, «Заключено» — штуки. */}
            <SummaryChip
              metricKey="savings_pct"
              label={svodSheetName('spentPct')}
              value={pctText(headRow.spentPct)}
              valueClass={execColorClass(headRow.spentPct)}
              live={`${pctText(headRow.spentPct)} = ${fmtMoney(headRow.factTotal)} ÷ ${fmtMoney(headRow.planTotal)} (${moneyLabel}, столбец Q листа)`}
            />
            <SummaryChip
              metricKey="economy_total"
              value={`${fmtMoney(headRow.economyTotal)} ${moneyLabel}`}
              live={`${fmtMoney(headRow.economyTotal)} = ${fmtMoney(headRow.economyFB)} + ${fmtMoney(headRow.economyKB)} + ${fmtMoney(headRow.economyMB)} (${moneyLabel})`}
            />
            {/* Доля ЕП — ПО ДЕНЬГАМ, как строка «Доля ЕП:» листа (O/O плана и
                факта). Прежний чип считал её по штукам под тем же словом. */}
            {methodFilter === null && shares && (
              <SummaryChip
                metricKey="share_ep_money"
                label={`${SVOD_SHEET_EXTRAS.shareEp.replace(/:$/, '')}, план`}
                value={pctText(shares.ep.plan)}
                live={`${pctText(shares.ep.plan)} = ${fmtMoney(sliced?.summary.ep.year.planTotal ?? null)} ÷ ${fmtMoney(sliced?.summary.total.year.planTotal ?? null)} (${moneyLabel})`}
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
        <>
        {/* Порядок блоков управлений (работа 5.3 карты вкладки). Это
            РАСКЛАДКА, а не фильтр: ни одно число не меняется, из таблицы
            ничего не исчезает — меняется только строка, с которой читатель
            начинает. Сказано вслух рядом с кнопками, чтобы порядок не
            приняли за отбор. Итог по управлениям порядку не подчиняется:
            он не управление, а сумма, и стоит первым всегда. */}
        {orderedDepartments.length > 1 && (
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-1">
            <span className="text-[10px] uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
              Порядок управлений
            </span>
            <div className="inline-flex overflow-hidden rounded-md border border-zinc-200 dark:border-transparent">
              {(['registry', 'execution', 'plan', 'economy'] as const).map((o) => (
                <button
                  key={o}
                  type="button"
                  onClick={() => setDeptOrder(o)}
                  aria-pressed={deptOrder === o}
                  title={SVOD_ORDER_HINT[o]}
                  className={clsx(
                    'border-l px-2.5 py-0.5 text-[10px] font-medium transition-colors first:border-l-0',
                    RULE_HEAD,
                    deptOrder === o
                      ? 'bg-cyan-600 text-white'
                      : 'bg-white text-zinc-500 hover:bg-zinc-50 dark:bg-zinc-800/60 dark:text-zinc-400 dark:hover:bg-zinc-700/40',
                    FOCUS_RING,
                  )}
                >
                  {SVOD_ORDER_LABEL[o]}
                </button>
              ))}
            </div>
            <span className="text-[10px] text-zinc-400 dark:text-zinc-500">
              порядок строк, не отбор: числа и состав таблицы не меняются
              {deptOrder !== 'registry' && ' · управления без плана — внизу'}
            </span>
          </div>
        )}
        <div className={`${CARD} rounded-xl shadow-sm dark:shadow-none overflow-hidden`}>
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
                {orderedDepartments.map((d) => (
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
            onOpenRows={() => navigateTo('data')}
          />

          <p className={`px-4 py-2.5 text-[10px] text-zinc-400 dark:text-zinc-500 ${RULE_T}`}>
            Числа посчитаны по строкам книг управлений, а не сняты с формул листа: лист служит
            эталоном для сверки. Как считает лист: план — по всем счётным строкам периода;
            факт и экономия — только по строкам с заполненной датой заключения, поэтому
            «закупки, проводимые в течение года» входят в план листа, но не в его факт и
            экономию. Единица листа — тысячи рублей. «ИТОГО» = конкурентные процедуры плюс
            единственный поставщик. Управление здесь — главный распорядитель бюджетных
            средств (ГРБС). Строки-вкладчицы любого блока открываются ссылкой «строки в
            Реестре» в его заголовке. Столбцы названы словами листа: владелец переименовал
            их 18.08.2026 («Выполнено, %» → «Заключено, %», «Потрачено, %» →
            «Законтрактовано, %»), расчёт при этом не менялся. Расчётной экономии (около
            8 %) и расчётной экономии без УИО на листе больше нет — поэтому нет их и здесь.
          </p>
        </div>

        <SheetExtras
          remainder={remainder}
          shares={shares}
          epByCount={sliced ? epShareByCount(sliced.summary) : null}
          budgets={budgetSet}
          fmtMoney={fmtMoney}
          moneyLabel={moneyLabel}
          methodFiltered={methodFilter !== null}
        />
        </>
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

/**
 * Ярус листа поверх таблицы: «Остаток к заключению» и доли способов закупки.
 *
 * Оба показателя лист считает сам, а вкладка не показывала ни одного. Карточки
 * держат правило вкладок (канон п.58): каждая называет период своих данных
 * плашкой и оговаривает, чем её охват отличается от охвата листа.
 */
function SheetExtras({
  remainder, shares, epByCount, budgets, fmtMoney, moneyLabel, methodFiltered,
}: {
  remainder: SvodRemainder | null;
  shares: SvodMethodShares | null;
  epByCount: number | null;
  budgets: ReadonlySet<BudgetKey>;
  fmtMoney: (n: number | null) => string;
  moneyLabel: string;
  /** Выбран один способ закупки: доли считать не от чего. */
  methodFiltered: boolean;
}) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
      <RemainderCard
        remainder={remainder}
        budgets={budgets}
        fmtMoney={fmtMoney}
        moneyLabel={moneyLabel}
      />
      <SharesCard shares={shares} epByCount={epByCount} methodFiltered={methodFiltered} />
    </div>
  );
}

/** Каркас карточки яруса — кремовый хром, цвет отдан числам. */
function ExtrasCard({ title, subtitle, children }: {
  title: string;
  subtitle: string;
  children: ReactNode;
}) {
  return (
    <section className={`${CARD} rounded-xl shadow-sm dark:shadow-none`}>
      <header className="flex items-start justify-between gap-3 px-5 pt-4 pb-3 flex-wrap">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-[13px] font-semibold text-zinc-700 dark:text-zinc-200">{title}</h3>
            {/* Происхождение числа у каждой карточки, а не только у страницы:
                арифметика взята у листа, но применена к видимому срезу —
                значит, это пересчёт, а не цитата официальной ячейки. */}
            <span title="Формула повторяет формулу листа СВОД, но считается по строкам видимого среза — это пересчёт, а не значение официальной ячейки.">
              <SourceBadge source="calc" />
            </span>
          </div>
          <p className="text-[11px] text-zinc-500 dark:text-zinc-400 mt-0.5 leading-relaxed max-w-xl">
            {subtitle}
          </p>
        </div>
        {/* Период И момент — разные оси (канон п.58). Плашка называет, за
            какое время посчитаны числа карточки; подпись рядом — когда книги
            читали в последний раз. Раньше момент стоял только в шапке
            страницы, а карточки яруса живут своим пересчётом и от шапки
            прокручиваются далеко: читатель их видел без момента вовсе. */}
        <div className="flex items-center gap-2 flex-shrink-0">
          <ReadMomentNote />
          <PeriodBadge />
        </div>
      </header>
      <div className="px-5 pb-5">{children}</div>
    </section>
  );
}

/**
 * Одно число яруса: подпись сверху, значение снизу — как в чипах шапки.
 *
 * Число объясняет себя записью базы знаний, а не одним лишь атрибутом
 * `title` (работа P1-3 карты вкладки). Всплывающая подсказка браузера с
 * пальца недоступна вовсе — на планшете эти два числа оставались без
 * объяснения (канон п.73а: объяснение открывается и по нажатию). `KbHover`
 * открывается и по наведению, и по фокусу, и по касанию, и несёт ярус
 * происхождения — откуда число родом и по какому адресу лежит первоисточник.
 */
function ExtrasValue({ label, value, valueClass, hint, metricKey }: {
  label: string;
  value: string;
  valueClass?: string;
  hint?: string;
  /** Ключ записи БЗ; без него число остаётся с одной лишь подсказкой. */
  metricKey?: string;
}) {
  const number = (
    <div className={clsx('text-sm font-semibold tabular-nums mt-0.5', valueClass ?? 'text-zinc-800 dark:text-zinc-100')}>
      {value}
    </div>
  );
  return (
    // Обводки у плитки нет (канон п.129): от карточки её отделяет светлота
    // поверхности, а не рамка — иначе на экране вырастает частокол.
    <div className="rounded-lg bg-zinc-50 dark:bg-zinc-900/40 px-3 py-2" title={metricKey === undefined ? hint : undefined}>
      <div className="text-[10px] text-zinc-400 dark:text-zinc-500 truncate">{label}</div>
      {metricKey === undefined ? number : (
        <KbHover metricKey={metricKey} title={label} {...(hint ? { live: hint } : {})}>
          {number}
        </KbHover>
      )}
    </div>
  );
}

/**
 * «Остаток к заключению» — новый блок листа (K1:O2, добавлен начальницей).
 * План минус факт по каждому источнику: сколько плановых денег ещё не связано
 * контрактами. Знак положительный, когда часть плана не выбрана.
 */
function RemainderCard({ remainder, budgets, fmtMoney, moneyLabel }: {
  remainder: SvodRemainder | null;
  budgets: ReadonlySet<BudgetKey>;
  fmtMoney: (n: number | null) => string;
  moneyLabel: string;
}) {
  const filtered = budgets.size > 0;
  const cell = (key: BudgetKey, label: string, value: number | null) => {
    // Бюджет вне фильтра — не ноль: ноль читался бы как «всё законтрактовано».
    if (filtered && !budgets.has(key)) {
      return (
        <ExtrasValue
          key={key}
          label={label}
          value="вне фильтра"
          valueClass="text-zinc-400 dark:text-zinc-500 text-xs font-normal"
          hint={`${label}: бюджет не выбран в шапке, суммы по нему не считались`}
        />
      );
    }
    return (
      <ExtrasValue
        key={key}
        label={label}
        metricKey="remainder_to_conclude"
        value={value === null ? NO_DATA : `${fmtMoney(value)} ${moneyLabel}`}
        valueClass={value !== null && value < 0 ? 'text-violet-700 dark:text-violet-300' : undefined}
        hint={`${label}: план минус факт по видимому срезу. ${
          value === null
            ? 'Строк под выбранные условия нет — величины нет.'
            : `Сейчас ${fmtMoney(value)} ${moneyLabel}.`
        } Отрицательное значение — факт превысил план. На листе тот же остаток посчитан только по конкурентным процедурам за год.`}
      />
    );
  };
  return (
    <ExtrasCard
      title={SVOD_SHEET_EXTRAS.remainderFull}
      subtitle={`Блок листа «${SVOD_SHEET_EXTRAS.remainderGroup}» (шапка, строка «${SVOD_SHEET_EXTRAS.remainder}»): плановые деньги минус законтрактованные, по каждому источнику. На листе он посчитан по конкурентным процедурам за год; здесь — по всему видимому срезу.`}
    >
      {remainder === null ? (
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          Под выбранные условия строк нет — остаток считать не от чего.
        </p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
          {cell('fb', UI_LABELS['budget.fb'], remainder.fb)}
          {cell('kb', UI_LABELS['budget.kb'], remainder.kb)}
          {cell('mb', UI_LABELS['budget.mb'], remainder.mb)}
          <ExtrasValue
            label={UI_LABELS['budget.total']}
            metricKey="remainder_to_conclude"
            value={remainder.total === null ? NO_DATA : `${fmtMoney(remainder.total)} ${moneyLabel}`}
            valueClass="text-blue-700 dark:text-blue-300"
            hint={`Итог — сумма остатков по трём источникам${
              remainder.total === null ? '' : `: сейчас ${fmtMoney(remainder.total)} ${moneyLabel}`
            }. Та же величина, что «Отклонение, тыс. руб» в таблице, с обратным знаком.`}
          />
        </div>
      )}
    </ExtrasCard>
  );
}

/**
 * Значение доли, объясняющее себя (работа P1-3 карты вкладки). Долю ЕП по
 * деньгам и по штукам продукт когда-то называл одним словом, поэтому именно
 * здесь объяснение обязательно: подстановка живых чисел прямо говорит, что
 * стоит в знаменателе — суммы или процедуры.
 */
function ShareValue({ metricKey, label, live, text }: {
  metricKey: string;
  label: string;
  live: string;
  text: string;
}) {
  return (
    <KbHover metricKey={metricKey} title={label} live={live}>
      <span>{text}</span>
    </KbHover>
  );
}

/**
 * Доли способов закупки — строки «Доля ЭА…» и «Доля ЕП:» листа, ПО ДЕНЬГАМ,
 * двумя колонками «факт» и «план». Раньше вкладка показывала долю ЕП по
 * штукам под тем же словом — два разных числа назывались одинаково.
 */
function SharesCard({ shares, epByCount, methodFiltered }: {
  shares: SvodMethodShares | null;
  epByCount: number | null;
  methodFiltered: boolean;
}) {
  const cellCls = 'px-2.5 py-1.5 text-right tabular-nums whitespace-nowrap font-semibold';
  return (
    <ExtrasCard
      title="Доли способов закупки"
      subtitle={`Строки листа «${SVOD_SHEET_EXTRAS.shareKp}» и «${SVOD_SHEET_EXTRAS.shareEp}» — доли считаются ПО ДЕНЬГАМ: своя сумма делится на сумму «${SVOD_SHEET_EXTRAS.totalYear}». Колонка «${SVOD_SHEET_EXTRAS.shareFact}» — от фактических сумм, «${SVOD_SHEET_EXTRAS.sharePlan}» — от плановых.`}
    >
      {methodFiltered ? (
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          Выбран один способ закупки, поэтому долей нет: доля считается от суммы обоих
          способов. Снимите фильтр способа в шапке, чтобы увидеть числа.
        </p>
      ) : shares === null ? (
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          Под выбранные условия строк нет — доли считать не от чего.
        </p>
      ) : (
        <>
          <table className="w-full text-xs border-collapse">
            <caption className="sr-only">Доли конкурентных процедур и единственного поставщика по деньгам</caption>
            <thead>
              <tr className="text-[10px] uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
                <th scope="col" className="px-2.5 py-1.5 text-left font-medium">Способ</th>
                <th scope="col" className="px-2.5 py-1.5 text-right font-medium">{SVOD_SHEET_EXTRAS.shareFact}</th>
                <th scope="col" className="px-2.5 py-1.5 text-right font-medium">{SVOD_SHEET_EXTRAS.sharePlan}</th>
              </tr>
            </thead>
            <tbody>
              <tr className={RULE_ROW_T}>
                <th scope="row" className="px-2.5 py-1.5 text-left font-normal text-zinc-600 dark:text-zinc-300">
                  <span className={clsx('inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold', SECTION_META.kp.tagClass)} title={SECTION_META.kp.hint}>
                    {SECTION_META.kp.label}
                  </span>
                  <span className="ml-2 text-[11px] text-zinc-500 dark:text-zinc-400">
                    {SVOD_SHEET_EXTRAS.shareKp.replace(/:$/, '')}
                  </span>
                </th>
                <td className={clsx(cellCls, 'text-blue-700 dark:text-blue-300')}>
                  <ShareValue
                    metricKey="ep_share_pct"
                    label={`${SVOD_SHEET_EXTRAS.shareKp.replace(/:$/, '')} · ${SVOD_SHEET_EXTRAS.shareFact}`}
                    live={`${pctText(shares.kp.fact)} — фактические суммы конкурентных процедур, делённые на фактическую сумму «${SVOD_SHEET_EXTRAS.totalYear}» видимого среза. Доля считается ПО ДЕНЬГАМ, не по числу процедур.`}
                    text={pctText(shares.kp.fact)}
                  />
                </td>
                <td className={clsx(cellCls, 'text-blue-700 dark:text-blue-300')}>
                  <ShareValue
                    metricKey="ep_share_pct"
                    label={`${SVOD_SHEET_EXTRAS.shareKp.replace(/:$/, '')} · ${SVOD_SHEET_EXTRAS.sharePlan}`}
                    live={`${pctText(shares.kp.plan)} — плановые суммы конкурентных процедур, делённые на плановую сумму «${SVOD_SHEET_EXTRAS.totalYear}» видимого среза.`}
                    text={pctText(shares.kp.plan)}
                  />
                </td>
              </tr>
              <tr className={RULE_ROW_T}>
                <th scope="row" className="px-2.5 py-1.5 text-left font-normal text-zinc-600 dark:text-zinc-300">
                  <span className={clsx('inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold', SECTION_META.ep.tagClass)} title={SECTION_META.ep.hint}>
                    {SECTION_META.ep.label}
                  </span>
                  <span className="ml-2 text-[11px] text-zinc-500 dark:text-zinc-400">
                    {SVOD_SHEET_EXTRAS.shareEp.replace(/:$/, '')}
                  </span>
                </th>
                <td className={clsx(cellCls, 'text-amber-700 dark:text-amber-300')}>
                  <ShareValue
                    metricKey="ep_share_pct"
                    label={`${SVOD_SHEET_EXTRAS.shareEp.replace(/:$/, '')} · ${SVOD_SHEET_EXTRAS.shareFact}`}
                    live={`${pctText(shares.ep.fact)} — фактические суммы единственного поставщика, делённые на фактическую сумму «${SVOD_SHEET_EXTRAS.totalYear}» видимого среза. По штукам эта доля другая — она названа отдельной строкой ниже.`}
                    text={pctText(shares.ep.fact)}
                  />
                </td>
                <td className={clsx(cellCls, 'text-amber-700 dark:text-amber-300')}>
                  <ShareValue
                    metricKey="ep_share_pct"
                    label={`${SVOD_SHEET_EXTRAS.shareEp.replace(/:$/, '')} · ${SVOD_SHEET_EXTRAS.sharePlan}`}
                    live={`${pctText(shares.ep.plan)} — плановые суммы единственного поставщика, делённые на плановую сумму «${SVOD_SHEET_EXTRAS.totalYear}» видимого среза.`}
                    text={pctText(shares.ep.plan)}
                  />
                </td>
              </tr>
            </tbody>
          </table>
          {/* Доля ЕП по штукам — наше число, не листовое. Названо иначе, чтобы
              его больше не путали с долей по деньгам. */}
          <p className="mt-3 text-[11px] text-zinc-500 dark:text-zinc-400">
            Доля ЕП по числу процедур —{' '}
            <ShareValue
              metricKey="ep_share_pct"
              label="Доля ЕП по числу процедур"
              live={`${pctText(epByCount)} — число закупок у единственного поставщика, делённое на общее число закупок видимого среза. База ШТУКИ, а не деньги: денежная доля ЕП выше в таблице и обычно отличается.`}
              text={pctText(epByCount)}
            />. Это отдельный показатель:
            на листе долей по количеству нет, там обе доли только денежные.
          </p>
          {/* Лист печатает доли и под каждым блоком ГРБС. Здесь они получаются
              выбором управления в шапке: срез считает итог по видимым
              управлениям, поэтому одно выбранное даёт ровно его доли. */}
          <p className="mt-1.5 text-[11px] text-zinc-400 dark:text-zinc-500">
            Лист повторяет обе доли под блоком каждого управления. Чтобы увидеть доли
            одного управления, выберите его в шапке: числа пересчитаются по нему.
          </p>
        </>
      )}
    </ExtrasCard>
  );
}

/**
 * Организационный срез свода (приказ владельца 20.08.2026: карточки переходят
 * в разбивку по подведомственным учреждениям, где это осмысленно).
 *
 * Здесь это НЕ осмысленно, и молчать об этом нельзя. Единая сетка свода
 * заведена на главного распорядителя: её ячейка — «управление × вид
 * деятельности × способ × период», графы учреждения в ней нет. Разложить
 * готовую ячейку по подведам можно было бы только выдумав пропорцию — то
 * есть соврав. Поэтому страница называет своё ограничение прямо и ведёт
 * туда, где разбивка настоящая: в Реестр, у строк которого заказчик записан
 * в самой строке.
 *
 * Отдельный случай — «только управление». На свод режим не влияет вовсе:
 * формулы считают управление целиком, вместе с закупками его учреждений.
 * Промолчать здесь опаснее всего: читатель увидел бы прежние числа под новой
 * подписью и решил, что подведы из них вычтены.
 */
function OrgScopeNotice({ scope, onOpenRows }: { scope: OrgScope; onOpenRows: () => void }) {
  if (scope.mode === 'district') return null;

  const rowsLink = (
    <button
      type="button"
      onClick={onOpenRows}
      className={clsx(
        'font-medium text-cyan-700 dark:text-cyan-300 hover:underline',
        FOCUS_RING,
      )}
      title="Открыть Реестр с теми же фильтрами шапки: в его строках заказчик указан поимённо, поэтому разрез по учреждениям там настоящий"
    >
      строки этого управления в Реестре
    </button>
  );

  if (scope.mode === 'withSubs') {
    return (
      <Notice tone="muted">
        {scope.hasSubs ? (
          <>
            Выбрано управление вместе с подведомственными учреждениями. Свод показывает его
            одной строкой: сетка заведена на главного распорядителя, графы учреждения в ней
            нет — разложить готовый итог по учреждениям можно было бы только выдумав пропорцию.
            Разбивка по учреждениям есть там, где заказчик записан в самой строке: {rowsLink}.
          </>
        ) : (
          <>
            У этого управления подведомственных учреждений нет — строка управления и есть весь
            его срез, делить её не на что. Построчная выборка: {rowsLink}.
          </>
        )}
      </Notice>
    );
  }

  return (
    <Notice tone="muted">
      {scope.hasSubs ? (
        <>
          Выбран режим «только управление», но на свод он не действует: формулы считают
          управление целиком, вместе с закупками его подведомственных учреждений, — числа ниже
          те же, что и с учреждениями. Отделить закупки аппарата от учреждений можно построчно:
          {' '}{rowsLink}.
        </>
      ) : (
        <>
          Выбран режим «только управление». Подведомственных учреждений у него нет, поэтому
          режим ничего не меняет: числа ниже те же самые.
        </>
      )}
    </Notice>
  );
}

/**
 * Момент чтения книг у чисел свода (канон п.58). Фраза приходит из
 * единственного дома продукта — `lib/reading-moment`, где закреплено правило
 * «незнание момента — не свежесть»: молчание сервера остаётся молчанием, а не
 * превращается в бодрое «на сейчас».
 */
function ReadMomentNote() {
  const lastRefreshed = useStore((s) => s.lastRefreshed);
  const moment = readingMoment({ readAt: lastRefreshed });
  return (
    <span
      title={moment.phrase}
      className={clsx(
        'text-[10px]',
        // Остывшие числа говорят об этом сами: до подсказки читатель может и
        // не добраться.
        moment.stale ? 'text-amber-700 dark:text-amber-400' : 'text-zinc-400 dark:text-zinc-500',
      )}
    >
      {moment.label}
    </span>
  );
}

// Плашка «Notice» переехала в общий дом зоны «Отчёт + Свод»
// (`components/report/FilterNotices.tsx`, 21.08): у «Отчёта» появились свои
// плашки о неприменяемых фильтрах, и вторая редакция одной фразы на соседнем
// экране означала бы два разных тона у одного смысла (канон п.112).

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
  // Тревога и предупреждение оставляют свою обводку в обеих темах: цвет края
  // здесь — сам сигнал, а не хром. Спокойная панель — обычная поверхность:
  // в тёмной теме её отделяет светлота карточки, а не рамка (канон п.129).
  const border =
    tone === 'error' ? 'border-red-200 dark:border-red-700/50'
      : tone === 'warning' ? 'border-amber-200 dark:border-amber-700/50'
        : 'border-zinc-100 dark:border-transparent';
  return (
    <div
      role={tone === 'error' ? 'alert' : undefined}
      className={clsx(CARD_SURFACE, 'rounded-xl shadow-sm dark:shadow-none border p-12 text-center', border)}
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

/**
 * Чип показателя. `label` перебивает словарную подпись там, где показатель
 * называется на листе иначе, чем в движке: на экране «Свода» побеждает имя
 * листа, а ключ БЗ остаётся движковым, чтобы попап объяснял ту же метрику.
 */
function SummaryChip({
  metricKey, label, value, valueClass, live,
}: { metricKey: string; label?: string; value: string; valueClass?: string; live: string }) {
  return (
    // Обводки нет (канон п.129): плитку от карточки отделяет светлота фона.
    <div className="rounded-lg bg-zinc-50 dark:bg-zinc-900/40 px-3 py-2">
      <div className="text-[10px] text-zinc-400 dark:text-zinc-500 truncate">{label ?? productLabel(metricKey)}</div>
      <div className={clsx('text-sm font-semibold tabular-nums mt-0.5', valueClass ?? 'text-zinc-800 dark:text-zinc-100')}>
        {/* Попап открывается под тем же именем, что стоит на чипе: иначе
            читатель наводит на «Заключено, %», а видит заголовок из движка. */}
        <KbHover metricKey={metricKey} title={label} live={live}>{value}</KbHover>
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
  const th = `px-2.5 py-2 font-semibold text-zinc-500 dark:text-zinc-400 ${RULE_HEAD_B}`;
  const sub = `px-2.5 py-1.5 font-medium text-[10px] text-zinc-400 dark:text-zinc-500 ${RULE_HEAD_B} text-right`;
  const budgetHeads = (
    <>
      <th scope="col" className={clsx(sub, COL_RULE)} title={UI_LABELS['budget.fb']}>ФБ</th>
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
        <th scope="colgroup" className={clsx(th, 'text-center', COL_RULE)} colSpan={4}>
          Количество, ед.
        </th>
        {/* Подписи «как считает лист» (задание группы): по наведению на группу
            столбцов видно правило формул официального листа — с ним и сверяемся. */}
        <th
          scope="colgroup"
          className={clsx(th, GROUP_HEAD.plan, 'text-center', COL_RULE)}
          colSpan={moneySpan}
          title="Как считает лист: плановые деньги суммируются по всем счётным строкам периода — условия по дате заключения у формул плана нет, поэтому «закупки, проводимые в течение года» в план входят."
        >
          План, {moneyLabel}
        </th>
        <th
          scope="colgroup"
          className={clsx(th, GROUP_HEAD.fact, 'text-center', COL_RULE)}
          colSpan={moneySpan}
          title="Как считает лист: фактические деньги суммируются только по строкам с заполненной датой заключения — строки без даты (стадия «в течение года») в факт листа не попадают."
        >
          Факт, {moneyLabel}
        </th>
        {/* P и Q листа. На листе их шапка объединена по вертикали (P5:P6, Q5:Q6),
            здесь та же геометрия — rowSpan, а не выдуманное имя группы. */}
        <th
          scope="col"
          className={clsx(th, 'text-right', COL_RULE, 'normal-case')}
          rowSpan={2}
          title={`Столбец P листа «${svodSheetName('amountDeviation')}»: факт минус план в деньгах. Отрицательное значение — план не выбран.`}
        >
          Отклонение, {moneyLabel}
        </th>
        <th
          scope="col"
          className={clsx(th, GROUP_HEAD.fact, 'text-right', COL_RULE, 'normal-case')}
          rowSpan={2}
          title={`Столбец Q листа «${svodSheetName('spentPct')}»: факт ÷ план в деньгах. Считается по тем же строкам, что и факт, — только при заполненной дате заключения.`}
        >
          {svodSheetName('spentPct')}
        </th>
        <th
          scope="colgroup"
          className={clsx(th, GROUP_HEAD.eco, 'text-center', COL_RULE)}
          colSpan={moneySpan}
          title="Как считает лист: экономия суммируется по тем же строкам, что и факт, — только при заполненной дате заключения. Экономии без заключения не бывает."
        >
          Экономия, {moneyLabel}
        </th>
      </tr>
      <tr>
        {/* Подписи счётной группы — дословно из шапки листа (столбцы D–G). */}
        <th scope="col" className={clsx(sub, COL_RULE, 'normal-case')}>
          {svodSheetName('planCount')}
        </th>
        <th scope="col" className={clsx(sub, 'normal-case')}>{svodSheetName('factCount')}</th>
        <th
          scope="col"
          className={clsx(sub, 'normal-case')}
          title={`Столбец F листа «${svodSheetName('deviationCount')}»: факт минус план; отрицательное значение — недобор`}
        >
          {svodSheetName('deviationCount')}
        </th>
        <th
          scope="col"
          className={clsx(sub, 'normal-case')}
          title={`Столбец G листа «${svodSheetName('executionPct')}»: факт ÷ план по количеству закупок`}
        >
          {svodSheetName('executionPct')}
        </th>
        {budgetFull ? (
          <>
            {budgetHeads}
            {budgetHeads}
            {budgetHeads}
          </>
        ) : (
          <>
            <th scope="col" className={clsx(sub, COL_RULE)}>Итого</th>
            <th scope="col" className={clsx(sub, COL_RULE)}>Итого</th>
            <th scope="col" className={clsx(sub, COL_RULE)}>Итого</th>
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
  // 1 подпись + 4 счётных + три денежных группы + два одиночных столбца листа
  // («Отклонение, тыс. руб» и «Законтрактовано, %»).
  const colCount = 1 + 4 + (budgetFull ? 4 : 1) * 3 + 2;
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
        RULE_ROW_B, 'transition',
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

      <td className={clsx(numMuted, RULE_ROW_L)}>{countText(row.planCount)}</td>
      <td className={numMuted}>{countText(row.factCount)}</td>
      <td className={clsx(num, deviationColor(row.deviationCount))}>{countText(row.deviationCount)}</td>
      <td className={clsx(num, 'font-semibold', execColorClass(row.executionPct))}>{pctText(row.executionPct)}</td>

      {budgetFull ? (
        <>
          <td className={clsx(numMuted, GROUP_CELL.plan, COL_RULE)}>{fmtMoney(row.planFB)}</td>
          <td className={clsx(numMuted, GROUP_CELL.plan)}>{fmtMoney(row.planKB)}</td>
          <td className={clsx(numMuted, GROUP_CELL.plan)}>{fmtMoney(row.planMB)}</td>
          <td className={clsx(num, GROUP_CELL.plan, 'font-semibold text-blue-700 dark:text-blue-300')}>{fmtMoney(row.planTotal)}</td>
        </>
      ) : (
        <td className={clsx(num, GROUP_CELL.plan, 'font-medium text-blue-700 dark:text-blue-300', COL_RULE)}>{fmtMoney(row.planTotal)}</td>
      )}

      {budgetFull ? (
        <>
          <td className={clsx(numMuted, GROUP_CELL.fact, COL_RULE)}>{fmtMoney(row.factFB)}</td>
          <td className={clsx(numMuted, GROUP_CELL.fact)}>{fmtMoney(row.factKB)}</td>
          <td className={clsx(numMuted, GROUP_CELL.fact)}>{fmtMoney(row.factMB)}</td>
          <td className={clsx(num, GROUP_CELL.fact, 'font-semibold text-violet-800 dark:text-violet-200')}>{fmtMoney(row.factTotal)}</td>
        </>
      ) : (
        <td className={clsx(num, GROUP_CELL.fact, 'font-medium text-violet-800 dark:text-violet-200', COL_RULE)}>{fmtMoney(row.factTotal)}</td>
      )}

      {/* Столбцы P и Q листа: до сверки 18.08.2026 вкладка их не рисовала,
          хотя оба числа модель уже держала. */}
      <td className={clsx(num, deviationColor(row.amountDeviation), COL_RULE)}>
        {fmtMoney(row.amountDeviation)}
      </td>
      <td className={clsx(num, GROUP_CELL.fact, 'font-semibold', COL_RULE, execColorClass(row.spentPct))}>
        {pctText(row.spentPct)}
      </td>

      {budgetFull ? (
        <>
          <td className={clsx(numMuted, GROUP_CELL.eco, COL_RULE)}>{fmtMoney(row.economyFB)}</td>
          <td className={clsx(numMuted, GROUP_CELL.eco)}>{fmtMoney(row.economyKB)}</td>
          <td className={clsx(numMuted, GROUP_CELL.eco)}>{fmtMoney(row.economyMB)}</td>
          <td className={clsx(num, GROUP_CELL.eco, 'font-semibold text-emerald-700 dark:text-emerald-300')}>{fmtMoney(row.economyTotal)}</td>
        </>
      ) : (
        <td className={clsx(num, GROUP_CELL.eco, 'font-medium text-emerald-700 dark:text-emerald-300', COL_RULE)}>{fmtMoney(row.economyTotal)}</td>
      )}
    </tr>
  );
}

/** Итог сверки под таблицей: доступна ли она, и что именно разошлось. */
function ReconFooter({
  availability, mismatches, fmtMoney, periodLabel, onOpenRows,
}: {
  availability: ReconAvailability;
  mismatches: ReconRow[];
  fmtMoney: (n: number | null) => string;
  periodLabel: string;
  /** Дверь к строкам-основаниям расчёта — с периметром шапки (п.119). */
  onOpenRows?: () => void;
}) {
  if (!availability.available) {
    return (
      <div className={`px-4 py-2.5 ${RULE_T} flex items-start gap-2 text-[11px] text-zinc-500 dark:text-zinc-400`}>
        <ShieldOff size={12} className="mt-px flex-shrink-0 text-zinc-400" aria-hidden />
        <span>Сверка с официальным листом не выполнена. {availability.reason}</span>
      </div>
    );
  }
  if (mismatches.length === 0) {
    return (
      /* Полосу «сверка чиста» в тёмной теме отделяет от карточки заливка:
         прежняя пара «emerald-950/20 плюс край emerald-900/40» давала 1,018:1 —
         полосы фактически не было видно, границу рисовал только край. Зелень на
         десятую даёт 1,159:1 при пороге 1,12:1 (канон п.129: не хватает
         разделения — поднимай светлоту, а не возвращай рамку). */
      <div className="px-4 py-2.5 border-t border-emerald-100 dark:border-transparent flex items-start gap-2 text-[11px] text-emerald-700 dark:text-emerald-300 bg-emerald-50/50 dark:bg-emerald-500/10">
        <ShieldCheck size={12} className="mt-px flex-shrink-0" aria-hidden />
        <span>Расчёт полностью сходится с официальным листом за {periodLabel}: расхождение меньше 1 %.</span>
      </div>
    );
  }
  return (
    <div className={`p-4 ${RULE_T} space-y-1.5`}>
      <div className="text-[11px] font-medium text-zinc-600 dark:text-zinc-300 flex items-center gap-1.5">
        <ShieldAlert size={13} className="text-amber-500" aria-hidden />
        Расчёт и официальный лист разошлись за {periodLabel}:
      </div>
      {/* Карточка диагноста целиком (канон п.53, работа P0-4): какая строка,
          что в ней, почему — и что сделать, с адресатом. Раньше здесь были
          только два числа, и читатель оставался с вопросом «и куда мне
          теперь смотреть». Адрес ячейки берётся из карты официальных метрик,
          а не сочиняется экраном. */}
      {mismatches.map((r) => {
        const d = reconDiagnosis(r);
        return (
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
          <span className="min-w-0 text-zinc-700 dark:text-zinc-300">
            {reconKeyLabel(r.key)}
            <span className="text-zinc-400 dark:text-zinc-500">
              {' · '}расчёт {reconValue(r.key, r.calc, fmtMoney)} против листа {reconValue(r.key, r.official, fmtMoney)}
              {d.cell !== '' && (
                <>
                  {' · '}
                  <a
                    href={buildSheetUrl(SVOD_SPREADSHEET_ID, d.cell, d.sheet)}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={`Открыть ${d.officialLabel} — лист «${d.sheet}», ячейка ${d.cell}`}
                    className={clsx('font-mono text-cyan-700 dark:text-cyan-300 hover:underline', FOCUS_RING)}
                  >
                    {d.sheet !== '' ? `${d.sheet} · ${d.cell}` : d.cell}
                  </a>
                </>
              )}
            </span>
            <span className="mt-0.5 block text-zinc-500 dark:text-zinc-400">
              {d.what} {d.why}
            </span>
            <span className="mt-0.5 block text-zinc-600 dark:text-zinc-300">
              Что сделать: {d.action}
              {d.owner === 'books' && onOpenRows && (
                <>
                  {' '}
                  <button
                    type="button"
                    onClick={onOpenRows}
                    title="Открыть Реестр с фильтрами шапки — строки, из которых собран расчёт этой стороны сверки"
                    className={clsx('font-medium text-cyan-700 dark:text-cyan-300 hover:underline', FOCUS_RING)}
                  >
                    строки в Реестре
                  </button>
                </>
              )}
            </span>
          </span>
        </div>
        );
      })}
    </div>
  );
}

/** Значение показателя сверки: количество — штуками, суммы — деньгами. */
function reconValue(key: string, v: number, fmtMoney: (n: number | null) => string): string {
  return isCountMetric(key) ? countText(v) : fmtMoney(v);
}
