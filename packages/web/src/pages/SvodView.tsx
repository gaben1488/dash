import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../store';
import { api } from '../api';
import {
  SVOD_SPREADSHEET_ID,
  ACTIVITY_SCOPES,
  ACTIVITY_LABEL,
  SVOD_QUARTER_KEYS,
  type ActivityScope,
  type SvodPeriodKey,
  type SvodRow,
  type SvodBlock,
  type SvodView as SvodViewShape,
  type UnifiedGrid,
} from '@aemr/shared';
import {
  sliceUnified,
  type BudgetKey,
} from '../lib/unified-svod-view';
import {
  FileSpreadsheet, ExternalLink, Columns3, Table2, CheckCircle2, ShieldCheck, ShieldAlert, Minus,
} from 'lucide-react';
import clsx from 'clsx';

// ── Форматирование ───────────────────────────────────────────────────

const MONEY_DIV: Record<string, number> = { 'тыс': 1, 'млн': 1000, 'млрд': 1_000_000 };
const MONEY_LABEL: Record<string, string> = { 'тыс': 'тыс. руб.', 'млн': 'млн руб.', 'млрд': 'млрд руб.' };

function fmtCount(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return '—';
  return Math.round(n).toLocaleString('ru-RU');
}
function makeFmtMoney(unit: string) {
  const div = MONEY_DIV[unit] ?? 1;
  // Как в листах СВОД/ШДЮ: деньги в тыс. руб. — формат #,##0.00 (2 знака).
  const frac = unit === 'тыс' ? 2 : unit === 'млн' ? 1 : 2;
  return (n: number | null): string => {
    if (n === null || !Number.isFinite(n)) return '—';
    const v = n / div;
    if (Math.abs(v) < 1e-9) return '0';
    return v.toLocaleString('ru-RU', { maximumFractionDigits: frac });
  };
}
function fmtPct(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return '—';
  return `${(n * 100).toFixed(1)}%`;
}

/** Цвет текста для % исполнения — как «светофор» начальницы. */
function execColorClass(frac: number | null): string {
  if (frac === null) return 'text-zinc-400 dark:text-zinc-500';
  const p = frac * 100;
  if (p >= 80) return 'text-emerald-600 dark:text-emerald-400';
  if (p >= 50) return 'text-amber-600 dark:text-amber-400';
  return 'text-red-600 dark:text-red-400';
}

function buildSheetUrl(cell?: string): string {
  let url = `https://docs.google.com/spreadsheets/d/${SVOD_SPREADSHEET_ID}/edit`;
  if (cell) url += `#gid=0&range=${cell}`;
  return url;
}

// ── Период ───────────────────────────────────────────────────────────

type PeriodMode = 'month' | 'quarter' | 'year';

const MONTH_LABEL = [
  'Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн', 'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек',
];

/** Человекочитаемая подпись выбранного периода. */
function periodLabel(key: SvodPeriodKey): string {
  if (key === 'year') return 'Год';
  if (key.startsWith('q')) return `${key.slice(1)} квартал`;
  const m = Number(key.slice(1));
  return MONTH_LABEL[m - 1] ?? key;
}

// ── Сверка (reconciliation из /api/svod/unified) ──────────────────────

type ReconStatus = 'ok' | 'warning' | 'high';
interface ReconRow {
  key: string;       // напр. competitive.q1.total_plan
  calc: number;
  official: number;
  deltaPct: number;
  status: ReconStatus;
}
interface UnifiedResp {
  grid: UnifiedGrid;
  reconciliation: ReconRow[];
  year?: number;
}

/** Бейдж сверки для строки (КП/ЕП): сводный статус по период-метод-срезу. */
interface ReconBadge {
  status: ReconStatus | 'none';
  /** worst Δ% по строке (для подсказки). */
  worstDeltaPct: number;
  /** число сверенных метрик в этой группе. */
  checked: number;
}

const RECON_PREFIX: Record<'kp' | 'ep', string> = { kp: 'competitive', ep: 'sole' };
const RECON_FIELD_LABEL: Record<string, string> = {
  count: 'кол-во',
  total_plan: 'план',
  total_fact: 'факт',
  economy_total: 'экономия',
};

/**
 * Сводит строки reconciliation в бейджи по методу (КП/ЕП) для выбранного периода.
 * Лист СВОД ТД-ПМ покрывает только 1 кв и Год — для прочих периодов бейдж 'none'.
 * Статус строки = худший статус его метрик (high > warning > ok).
 */
function reconBadges(
  recon: ReconRow[],
  period: SvodPeriodKey,
): { kp: ReconBadge; ep: ReconBadge } {
  const init = (): ReconBadge => ({ status: 'none', worstDeltaPct: 0, checked: 0 });
  const out = { kp: init(), ep: init() };
  // Эталон есть только для 1 кв/Год.
  if (period !== 'q1' && period !== 'year') return out;

  for (const m of ['kp', 'ep'] as const) {
    const prefix = `${RECON_PREFIX[m]}.${period}.`;
    const rows = recon.filter((r) => r.key.startsWith(prefix));
    if (rows.length === 0) continue;
    let worst: ReconStatus = 'ok';
    let worstDelta = 0;
    for (const r of rows) {
      if (r.status === 'high' || (r.status === 'warning' && worst === 'ok')) worst = r.status;
      if (Math.abs(r.deltaPct) > Math.abs(worstDelta)) worstDelta = r.deltaPct;
    }
    out[m] = { status: worst, worstDeltaPct: worstDelta, checked: rows.length };
  }
  return out;
}

// ── Типы строк секции ────────────────────────────────────────────────

type SectionKind = 'kp' | 'ep' | 'total';

const SECTION_META: Record<SectionKind, { label: string; tagClass: string }> = {
  kp:    { label: 'КП',    tagClass: 'bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300' },
  ep:    { label: 'ЕП',    tagClass: 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300' },
  total: { label: 'ИТОГО', tagClass: 'bg-zinc-100 text-zinc-700 dark:bg-zinc-700/60 dark:text-zinc-200' },
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

// ── Главный компонент ────────────────────────────────────────────────

export function SvodView() {
  const { moneyUnit, selectedDepartments, selectedMethods, selectedBudgets, year } = useStore();

  // Активность (ВСЕ/ПМ/ТД/ТД-ПМ) и период (мес/кв/год).
  const [scope, setScope] = useState<ActivityScope>('all');
  const [periodMode, setPeriodMode] = useState<PeriodMode>('year');
  const [monthSel, setMonthSel] = useState(1);
  const [quarterSel, setQuarterSel] = useState(1);
  const [budgetFull, setBudgetFull] = useState(false);

  // Текущий период-ключ единой сетки.
  const periodKey = useMemo<SvodPeriodKey>(() => {
    if (periodMode === 'year') return 'year';
    if (periodMode === 'quarter') return `q${quarterSel}` as SvodPeriodKey;
    return `m${monthSel}` as SvodPeriodKey;
  }, [periodMode, quarterSel, monthSel]);

  // ── Фетч единой сетки /api/svod/unified (year из глобального фильтра) ──
  const [resp, setResp] = useState<UnifiedResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setFailed(false);
    api
      .getSvodUnified(year)
      .then((d: UnifiedResp) => { if (alive) { setResp(d); setLoading(false); } })
      .catch(() => { if (alive) { setFailed(true); setLoading(false); } });
    return () => { alive = false; };
  }, [year]);

  // Фильтр по способу закупки (КП=competitive, ЕП=single) — какие разделы блока показывать.
  const visibleKinds = useMemo<SectionKind[]>(() => {
    if (selectedMethods.size === 0 || selectedMethods.size >= 2) return ['kp', 'ep', 'total'];
    if (selectedMethods.has('competitive')) return ['kp'];
    if (selectedMethods.has('single')) return ['ep'];
    return ['kp', 'ep', 'total'];
  }, [selectedMethods]);

  // Реальный бюджет-фильтр: при выборе ФБ/КБ/МБ денежные суммы (план/факт/экономия)
  // считаются ТОЛЬКО по выбранным бюджетам. Количества по бюджету не делятся.
  const budgetFiltered = selectedBudgets.size > 0;
  const showBudgetBreakdown = budgetFull && !budgetFiltered;

  const fmtMoney = useMemo(() => makeFmtMoney(moneyUnit), [moneyUnit]);
  const moneyLabel = MONEY_LABEL[moneyUnit] ?? 'тыс. руб.';

  // Бюджеты store ('fb'|'kb'|'mb') → BudgetKey set для среза.
  const budgetSet = useMemo<Set<BudgetKey>>(() => {
    const s = new Set<BudgetKey>();
    for (const b of selectedBudgets) {
      if (b === 'fb' || b === 'kb' || b === 'mb') s.add(b);
    }
    return s;
  }, [selectedBudgets]);

  // ── Срез единой сетки под выбранные фильтры → одна таблица ──
  const grid = resp?.grid;
  const hasGrid = Boolean(grid && Object.keys(grid.cells).length > 0);
  const sliced = useMemo<SvodViewShape | null>(() => {
    if (!grid) return null;
    return sliceUnified(grid, {
      scope,
      period: periodKey,
      budgets: budgetSet,
      depts: selectedDepartments,
    }).view;
  }, [grid, scope, periodKey, budgetSet, selectedDepartments]);

  // Сверка из API считалась для среза ВСЕ (сумма по всем ГРБС) против листа СВОД ТД-ПМ.
  // Поэтому индикатор сверки валиден только при scope=ВСЕ и без ГРБС-фильтра — иначе
  // сравнивать срез-подмножество с полным эталоном листа некорректно.
  const deptFilterActive = selectedDepartments.size > 0;
  const reconApplies = scope === 'all' && !deptFilterActive;

  // Бейджи сверки (КП/ЕП) для сводного блока за выбранный период.
  const badges = useMemo(
    () => reconBadges(reconApplies ? resp?.reconciliation ?? [] : [], periodKey),
    [resp, periodKey, reconApplies],
  );
  // Список реальных расхождений (warning/high) за период — под таблицей.
  const mismatches = useMemo(() => {
    if (!reconApplies || (periodKey !== 'q1' && periodKey !== 'year')) return [];
    return (resp?.reconciliation ?? [])
      .filter((r) => r.status !== 'ok')
      .sort((a, b) => Math.abs(b.deltaPct) - Math.abs(a.deltaPct));
  }, [resp, periodKey, reconApplies]);

  // ── Состояния: загрузка / ошибка ──
  if (loading && !resp) {
    return (
      <div className="bg-white dark:bg-zinc-800/60 rounded-xl shadow-sm border border-zinc-100 dark:border-zinc-700/50 p-12 text-center">
        <div className="animate-spin w-8 h-8 border-2 border-cyan-500 border-t-transparent rounded-full mx-auto mb-3" />
        <p className="text-xs text-zinc-500">Загрузка единой сетки СВОД…</p>
      </div>
    );
  }

  if (failed || !sliced || !hasGrid) {
    return (
      <div className="bg-white dark:bg-zinc-800/60 rounded-xl shadow-sm border border-amber-200 dark:border-amber-700/50 p-12 text-center">
        <FileSpreadsheet className="mx-auto text-amber-400 dark:text-amber-500 mb-3" size={40} />
        <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">Единая сетка СВОД не загружена</p>
        <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-4 max-w-md mx-auto">
          Сетка считается ядром (CalcEngine) из строк реестра. Нажмите «Обновить» в шапке,
          чтобы загрузить Google Таблицы.
        </p>
      </div>
    );
  }

  // Сводные чипы за выбранный период (срез ВСЕ ГРБС, ИТОГО КП+ЕП).
  const summaryTotal = sliced.summary.total.year; // обе ноги = выбранный период
  const epShare =
    sliced.summary.total.year.planCount && sliced.summary.total.year.planCount > 0
      ? (sliced.summary.ep.year.planCount ?? 0) / (sliced.summary.total.year.planCount ?? 1)
      : null;

  return (
    <div className="space-y-5">
      {/* ── Шапка ── */}
      <div className="bg-white dark:bg-zinc-800/60 rounded-xl shadow-sm border border-zinc-100 dark:border-zinc-700/50 p-5">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-cyan-50 dark:bg-cyan-950/40 flex items-center justify-center flex-shrink-0">
              <FileSpreadsheet className="text-cyan-600 dark:text-cyan-400" size={20} />
            </div>
            <div>
              <h2 className="text-base font-semibold text-zinc-800 dark:text-zinc-100">СВОД — единая сетка</h2>
              <p className="text-xs text-zinc-400 dark:text-zinc-500 flex items-center gap-1.5">
                <CheckCircle2 size={12} className="text-emerald-500" />
                Считается ядром из строк реестра · сверена с листом СВОД ТД-ПМ
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {/* Бюджеты: Итого / Все */}
            <button
              onClick={() => setBudgetFull((v) => !v)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-zinc-100 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-300 rounded-lg hover:bg-zinc-200 dark:hover:bg-zinc-600 transition disabled:opacity-40"
              title={budgetFiltered ? 'Активен бюджет-фильтр (ФБ/КБ/МБ из шапки)' : budgetFull ? 'Свернуть до «Итого»' : 'Показать ФБ / КБ / МБ'}
              disabled={budgetFiltered}
            >
              {budgetFull ? <Table2 size={13} /> : <Columns3 size={13} />}
              {budgetFull ? 'Итого' : 'Все бюджеты'}
            </button>

            {/* Открыть в Google Sheets */}
            <a
              href={buildSheetUrl()}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-cyan-50 dark:bg-cyan-950/30 text-cyan-700 dark:text-cyan-300 rounded-lg hover:bg-cyan-100 dark:hover:bg-cyan-900/40 transition"
            >
              <ExternalLink size={13} />
              Открыть лист
            </a>
          </div>
        </div>

        {/* ── Тумблеры: активность + период ── */}
        <div className="mt-4 flex flex-col gap-3">
          {/* Активность (4 среза) */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[10px] uppercase tracking-wider text-zinc-400 dark:text-zinc-500 w-20">Активность</span>
            <div className="flex items-center bg-zinc-100 dark:bg-zinc-700/50 rounded-lg p-0.5">
              {ACTIVITY_SCOPES.map((s) => (
                <button
                  key={s}
                  onClick={() => setScope(s)}
                  className={clsx(
                    'px-3 py-1.5 rounded-md text-xs font-medium transition',
                    scope === s
                      ? 'bg-cyan-600 text-white shadow-sm'
                      : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200',
                  )}
                  title={SCOPE_HINT[s]}
                >
                  {ACTIVITY_LABEL[s]}
                </button>
              ))}
            </div>
          </div>

          {/* Период (мес / кв / год) */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[10px] uppercase tracking-wider text-zinc-400 dark:text-zinc-500 w-20">Период</span>
            <div className="flex items-center bg-zinc-100 dark:bg-zinc-700/50 rounded-lg p-0.5">
              {(['month', 'quarter', 'year'] as PeriodMode[]).map((m) => (
                <button
                  key={m}
                  onClick={() => setPeriodMode(m)}
                  className={clsx(
                    'px-3 py-1.5 rounded-md text-xs font-medium transition',
                    periodMode === m
                      ? 'bg-cyan-600 text-white shadow-sm'
                      : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200',
                  )}
                >
                  {m === 'month' ? 'Месяц' : m === 'quarter' ? 'Квартал' : 'Год'}
                </button>
              ))}
            </div>

            {/* Вторичный селектор: конкретный месяц или квартал */}
            {periodMode === 'quarter' && (
              <div className="flex items-center bg-zinc-100 dark:bg-zinc-700/50 rounded-lg p-0.5">
                {SVOD_QUARTER_KEYS.map((q, i) => (
                  <button
                    key={q}
                    onClick={() => setQuarterSel(i + 1)}
                    className={clsx(
                      'px-2.5 py-1 rounded-md text-xs font-medium transition',
                      quarterSel === i + 1
                        ? 'bg-zinc-700 dark:bg-zinc-200 text-white dark:text-zinc-800 shadow-sm'
                        : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200',
                    )}
                  >
                    Q{i + 1}
                  </button>
                ))}
              </div>
            )}
            {periodMode === 'month' && (
              <div className="flex items-center flex-wrap gap-0.5 bg-zinc-100 dark:bg-zinc-700/50 rounded-lg p-0.5">
                {MONTH_LABEL.map((lbl, i) => (
                  <button
                    key={lbl}
                    onClick={() => setMonthSel(i + 1)}
                    className={clsx(
                      'px-2 py-1 rounded-md text-[11px] font-medium transition',
                      monthSel === i + 1
                        ? 'bg-zinc-700 dark:bg-zinc-200 text-white dark:text-zinc-800 shadow-sm'
                        : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200',
                    )}
                  >
                    {lbl}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Сводные чипы — за выбранный период/срез */}
        <div className="mt-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5">
          <SummaryChip label="План (кол-во)" value={fmtCount(summaryTotal.planCount)} />
          <SummaryChip label="Факт (кол-во)" value={fmtCount(summaryTotal.factCount)} />
          <SummaryChip
            label="Исполнение"
            value={fmtPct(summaryTotal.executionPct)}
            valueClass={execColorClass(summaryTotal.executionPct)}
            hint="по штукам (Факт ÷ План)"
          />
          <SummaryChip label={`Экономия, ${moneyLabel}`} value={fmtMoney(summaryTotal.economyTotal)} />
          <SummaryChip label="Доля ЕП" value={fmtPct(epShare)} hint="доля закупок у единственного поставщика по штукам" />
        </div>
      </div>

      {/* ── Единая таблица ── */}
      <div className="bg-white dark:bg-zinc-800/60 rounded-xl shadow-sm border border-zinc-100 dark:border-zinc-700/50 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs border-collapse">
            <SvodTableHead budgetFull={showBudgetBreakdown} moneyLabel={moneyLabel} />
            <tbody>
              {/* Сводный блок — с бейджами сверки */}
              <BlockGroup
                title={`СВОД · ${deptFilterActive ? 'выбранные ГРБС' : 'все ГРБС'} · ${ACTIVITY_LABEL[scope]} · ${periodLabel(periodKey)}`}
                subtitle={`агрегат по ${sliced.departments.length} ${deptFilterActive ? 'выбранным' : ''} управлениям`.replace('  ', ' ')}
                block={sliced.summary}
                budgetFull={showBudgetBreakdown}
                fmtMoney={fmtMoney}
                visibleKinds={visibleKinds}
                reconByKind={{ kp: badges.kp, ep: badges.ep }}
                emphasized
              />
              {/* По управлениям */}
              {sliced.departments.map((d) => (
                <BlockGroup
                  key={d.id}
                  title={d.shortName}
                  subtitle={d.name}
                  block={d.block}
                  budgetFull={showBudgetBreakdown}
                  fmtMoney={fmtMoney}
                  visibleKinds={visibleKinds}
                />
              ))}
            </tbody>
          </table>
        </div>

        {/* Легенда сверки + расхождения */}
        <ReconFooter periodKey={periodKey} mismatches={mismatches} fmtMoney={fmtMoney} reconApplies={reconApplies} />

        <p className="px-4 py-2.5 text-[10px] text-zinc-400 dark:text-zinc-500 border-t border-zinc-100 dark:border-zinc-700/50">
          Источник — единая сетка ядра (CalcEngine из строк реестра, 33 колонки). «Сверено» —
          сравнение среза ВСЕ с ячейками листа СВОД ТД-ПМ (1 кв и Год). «ИТОГО» = КП + ЕП.
        </p>
      </div>
    </div>
  );
}

// ── Подкомпоненты ────────────────────────────────────────────────────

const SCOPE_HINT: Record<ActivityScope, string> = {
  all: 'ВСЕ — ТД + ПМ (любая строка)',
  pm: 'ПМ — программные мероприятия',
  td: 'ТД — текущая деятельность',
  td_pm: 'ТД-ПМ — текущая деятельность с программой (графа D ≠ X/Х/пусто)',
};

function SummaryChip({
  label, value, valueClass, hint,
}: { label: string; value: string; valueClass?: string; hint?: string }) {
  return (
    <div className="rounded-lg bg-zinc-50 dark:bg-zinc-900/40 border border-zinc-100 dark:border-zinc-700/40 px-3 py-2" title={hint}>
      <div className="text-[10px] text-zinc-400 dark:text-zinc-500 truncate">{label}</div>
      <div className={clsx('text-sm font-semibold tabular-nums mt-0.5', valueClass ?? 'text-zinc-800 dark:text-zinc-100')}>
        {value}
      </div>
    </div>
  );
}

/** Бейдж «сверено ✓ / ⚠» рядом с тегом раздела (КП/ЕП) сводного блока. */
function ReconBadgeTag({ badge }: { badge: ReconBadge }) {
  if (badge.status === 'none') return null;
  if (badge.status === 'ok') {
    return (
      <span
        className="inline-flex items-center gap-0.5 px-1 py-0.5 rounded text-[9px] font-semibold bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
        title={`Сверено с листом СВОД ТД-ПМ: ${badge.checked} метрик совпали (Δ<1%)`}
      >
        <ShieldCheck size={10} /> ✓
      </span>
    );
  }
  const warn = badge.status === 'warning';
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-0.5 px-1 py-0.5 rounded text-[9px] font-semibold',
        warn
          ? 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300'
          : 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300',
      )}
      title={`Расхождение с листом СВОД ТД-ПМ до ${badge.worstDeltaPct.toFixed(1)}% (${badge.checked} метрик)`}
    >
      <ShieldAlert size={10} /> ⚠ {badge.worstDeltaPct.toFixed(0)}%
    </span>
  );
}

function SvodTableHead({ budgetFull, moneyLabel }: { budgetFull: boolean; moneyLabel: string }) {
  const moneySpan = budgetFull ? 4 : 1;
  const th = 'px-2.5 py-2 font-semibold text-zinc-500 dark:text-zinc-400 border-b border-zinc-200 dark:border-zinc-700';
  const sub = 'px-2.5 py-1.5 font-medium text-[10px] text-zinc-400 dark:text-zinc-500 border-b border-zinc-200 dark:border-zinc-700 text-right';
  return (
    <thead className="sticky top-0 z-10 bg-zinc-50 dark:bg-zinc-900/80 backdrop-blur">
      <tr className="text-[10px] uppercase tracking-wider">
        <th className={clsx(th, 'text-left sticky left-0 bg-zinc-50 dark:bg-zinc-900/80')} rowSpan={2}>ГРБС / раздел</th>
        <th className={clsx(th, 'text-center border-l border-zinc-200 dark:border-zinc-700')} colSpan={4}>Количество, ед.</th>
        <th className={clsx(th, GROUP_HEAD.plan, 'text-center border-l border-zinc-200 dark:border-zinc-700')} colSpan={moneySpan}>План, {moneyLabel}</th>
        <th className={clsx(th, GROUP_HEAD.fact, 'text-center border-l border-zinc-200 dark:border-zinc-700')} colSpan={moneySpan}>Факт, {moneyLabel}</th>
        <th className={clsx(th, GROUP_HEAD.eco, 'text-center border-l border-zinc-200 dark:border-zinc-700')} colSpan={moneySpan}>Экономия, {moneyLabel}</th>
      </tr>
      <tr>
        <th className={clsx(sub, 'border-l border-zinc-200 dark:border-zinc-700')}>План</th>
        <th className={sub}>Факт</th>
        <th className={sub}>Откл.</th>
        <th className={sub}>Вып. %</th>
        {budgetFull ? (
          <>
            <th className={clsx(sub, 'border-l border-zinc-200 dark:border-zinc-700')}>ФБ</th>
            <th className={sub}>КБ</th>
            <th className={sub}>МБ</th>
            <th className={clsx(sub, 'font-semibold text-zinc-500')}>Итого</th>
            <th className={clsx(sub, 'border-l border-zinc-200 dark:border-zinc-700')}>ФБ</th>
            <th className={sub}>КБ</th>
            <th className={sub}>МБ</th>
            <th className={clsx(sub, 'font-semibold text-zinc-500')}>Итого</th>
            <th className={clsx(sub, 'border-l border-zinc-200 dark:border-zinc-700')}>ФБ</th>
            <th className={sub}>КБ</th>
            <th className={sub}>МБ</th>
            <th className={clsx(sub, 'font-semibold text-zinc-500')}>Итого</th>
          </>
        ) : (
          <>
            <th className={clsx(sub, 'border-l border-zinc-200 dark:border-zinc-700')}>Итого</th>
            <th className={clsx(sub, 'border-l border-zinc-200 dark:border-zinc-700')}>Итого</th>
            <th className={clsx(sub, 'border-l border-zinc-200 dark:border-zinc-700')}>Итого</th>
          </>
        )}
      </tr>
    </thead>
  );
}

function BlockGroup({
  title, subtitle, block, budgetFull, fmtMoney, emphasized, visibleKinds, reconByKind,
}: {
  title: string;
  subtitle: string;
  block: SvodBlock;
  budgetFull: boolean;
  fmtMoney: (n: number | null) => string;
  emphasized?: boolean;
  visibleKinds: SectionKind[];
  reconByKind?: Partial<Record<SectionKind, ReconBadge>>;
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
      {/* Заголовок блока ГРБС */}
      <tr className={clsx(emphasized ? 'bg-cyan-50/60 dark:bg-cyan-950/20' : 'bg-zinc-50/70 dark:bg-zinc-900/30')}>
        <td colSpan={colCount} className="px-3 py-2 sticky left-0 z-[1] backdrop-blur-sm bg-inherit">
          <div className="flex items-center gap-2">
            <span className={clsx('font-semibold', emphasized ? 'text-cyan-800 dark:text-cyan-200' : 'text-zinc-700 dark:text-zinc-200')}>
              {title}
            </span>
            <span className="text-[10px] truncate text-zinc-400 dark:text-zinc-500">{subtitle}</span>
          </div>
        </td>
      </tr>
      {/* 3 строки: КП / ЕП / ИТОГО */}
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
      {/* Раздел + бейдж сверки */}
      <td className="px-3 py-1.5 sticky left-0 z-[1] bg-inherit">
        <span className="inline-flex items-center gap-1.5">
          <span className={clsx('inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold', meta.tagClass)}>
            {meta.label}
          </span>
          {reconBadge && <ReconBadgeTag badge={reconBadge} />}
        </span>
      </td>

      {/* Количество */}
      <td className={clsx(numMuted, 'border-l border-zinc-100 dark:border-zinc-800/60')}>{fmtCount(row.planCount)}</td>
      <td className={numMuted}>{fmtCount(row.factCount)}</td>
      <td className={clsx(num, deviationColor(row.deviationCount))}>{fmtCount(row.deviationCount)}</td>
      <td className={clsx(num, 'font-semibold', execColorClass(row.executionPct))}>{fmtPct(row.executionPct)}</td>

      {/* План — голубая группа (как лист) */}
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

      {/* Факт — сиреневая группа */}
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

      {/* Экономия — зелёная группа */}
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

/** Легенда сверки + список расхождений среза ВСЕ против листа СВОД ТД-ПМ. */
function ReconFooter({
  periodKey, mismatches, fmtMoney, reconApplies,
}: {
  periodKey: SvodPeriodKey;
  mismatches: ReconRow[];
  fmtMoney: (n: number | null) => string;
  reconApplies: boolean;
}) {
  // Сверка эталонна только для среза ВСЕ без ГРБС-фильтра (так считал API).
  if (!reconApplies) {
    return (
      <div className="px-4 py-2.5 border-t border-zinc-100 dark:border-zinc-700/50 flex items-center gap-2 text-[11px] text-zinc-500 dark:text-zinc-400">
        <Minus size={12} className="text-zinc-400" />
        Сверка с листом СВОД ТД-ПМ доступна для среза «ВСЕ» без фильтра по ГРБС
        (лист одноактивностный, эталон — сводный блок ВСЕ).
      </div>
    );
  }
  const hasReference = periodKey === 'q1' || periodKey === 'year';
  if (!hasReference) {
    return (
      <div className="px-4 py-2.5 border-t border-zinc-100 dark:border-zinc-700/50 flex items-center gap-2 text-[11px] text-zinc-500 dark:text-zinc-400">
        <Minus size={12} className="text-zinc-400" />
        Лист СВОД ТД-ПМ покрывает только 1 квартал и год — для этого периода эталона сверки нет.
      </div>
    );
  }
  if (mismatches.length === 0) {
    return (
      <div className="px-4 py-2.5 border-t border-emerald-100 dark:border-emerald-900/40 flex items-center gap-2 text-[11px] text-emerald-700 dark:text-emerald-300 bg-emerald-50/50 dark:bg-emerald-950/20">
        <ShieldCheck size={12} />
        Срез ВСЕ полностью сходится с листом СВОД ТД-ПМ за {periodLabel(periodKey).toLowerCase()} (Δ&lt;1%).
      </div>
    );
  }
  return (
    <div className="p-4 border-t border-zinc-100 dark:border-zinc-700/50 space-y-1.5">
      <div className="text-[11px] font-medium text-zinc-600 dark:text-zinc-300 flex items-center gap-1.5">
        <ShieldAlert size={13} className="text-amber-500" />
        Расхождения среза ВСЕ с листом СВОД ТД-ПМ ({periodLabel(periodKey).toLowerCase()}):
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
            {r.deltaPct > 0 ? '+' : ''}{r.deltaPct.toFixed(1)}%
          </span>
          <span className="text-zinc-700 dark:text-zinc-300">
            {reconKeyLabel(r.key)}
            <span className="text-zinc-400 dark:text-zinc-500">
              {' · '}расчёт {reconValue(r.key, r.calc, fmtMoney)} vs лист {reconValue(r.key, r.official, fmtMoney)}
            </span>
          </span>
        </div>
      ))}
    </div>
  );
}

/** Человекочитаемая подпись ключа сверки (competitive.q1.total_plan → «КП · план»). */
function reconKeyLabel(key: string): string {
  const [prefix, , field] = key.split('.');
  const method = prefix === 'competitive' ? 'КП' : prefix === 'sole' ? 'ЕП' : prefix;
  return `${method} · ${RECON_FIELD_LABEL[field] ?? field}`;
}

/** Форматирует значение метрики сверки: count — штуки, суммы — деньги. */
function reconValue(key: string, v: number, fmtMoney: (n: number | null) => string): string {
  return key.endsWith('.count') ? fmtCount(v) : fmtMoney(v);
}

function deviationColor(n: number | null): string {
  if (n === null || Math.abs(n) < 1e-9) return 'text-zinc-400 dark:text-zinc-500';
  return n < 0 ? 'text-red-600 dark:text-red-400' : 'text-zinc-600 dark:text-zinc-300';
}
