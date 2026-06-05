import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../store';
import { api } from '../api';
import {
  buildSvodView,
  hasSvodData,
  DEPARTMENT_ROWS,
  SVOD_SPREADSHEET_ID,
  type SvodRow,
  type SvodBlock,
  type SvodPeriod,
} from '@aemr/shared';
import {
  FileSpreadsheet, ExternalLink, Columns3, Table2, AlertTriangle, CheckCircle2, Scale, ArrowRight,
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
  const frac = unit === 'тыс' ? 0 : unit === 'млн' ? 1 : 2;
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

// ── Типы строк секции ────────────────────────────────────────────────

type SectionKind = 'kp' | 'ep' | 'total';

const SECTION_META: Record<SectionKind, { label: string; tagClass: string }> = {
  kp:    { label: 'КП',    tagClass: 'bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300' },
  ep:    { label: 'ЕП',    tagClass: 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300' },
  total: { label: 'ИТОГО', tagClass: 'bg-zinc-100 text-zinc-700 dark:bg-zinc-700/60 dark:text-zinc-200' },
};

// ── Главный компонент ────────────────────────────────────────────────

export function SvodView() {
  const { dashboardData, moneyUnit, selectedDepartments, selectedMethods, selectedBudgets, loading, isDemo } = useStore();

  const [period, setPeriod] = useState<SvodPeriod>('year');
  const [budgetFull, setBudgetFull] = useState(false);

  // Фильтр по способу закупки (КП=competitive, ЕП=single) — какие разделы блока показывать.
  const visibleKinds = useMemo<SectionKind[]>(() => {
    if (selectedMethods.size === 0 || selectedMethods.size >= 2) return ['kp', 'ep', 'total'];
    if (selectedMethods.has('competitive')) return ['kp'];
    if (selectedMethods.has('single')) return ['ep'];
    return ['kp', 'ep', 'total'];
  }, [selectedMethods]);

  // Бюджетный фильтр: выбор ФБ/КБ/МБ в шапке раскрывает разбивку по бюджетам.
  const showBudgetBreakdown = budgetFull || selectedBudgets.size > 0;

  const officialMetrics = dashboardData?.snapshot?.officialMetrics;
  const view = useMemo(() => {
    const metrics = officialMetrics ?? {};
    return hasSvodData(metrics) ? buildSvodView(metrics) : null;
  }, [officialMetrics]);

  const fmtMoney = useMemo(() => makeFmtMoney(moneyUnit), [moneyUnit]);
  const moneyLabel = MONEY_LABEL[moneyUnit] ?? 'тыс. руб.';

  // Фильтрация по выбранным ГРБС (глобальный фильтр). selectedDepartments может
  // содержать как id (uer), так и краткое имя (УЭР) — проверяем оба.
  const departments = useMemo(() => {
    if (!view) return [];
    if (selectedDepartments.size === 0) return view.departments;
    return view.departments.filter(
      (d) => selectedDepartments.has(d.id) || selectedDepartments.has(d.shortName),
    );
  }, [view, selectedDepartments]);

  // ── Состояния: загрузка / нет данных / демо ──
  if (loading && !view) {
    return (
      <div className="bg-white dark:bg-zinc-800/60 rounded-xl shadow-sm border border-zinc-100 dark:border-zinc-700/50 p-12 text-center">
        <div className="animate-spin w-8 h-8 border-2 border-cyan-500 border-t-transparent rounded-full mx-auto mb-3" />
        <p className="text-xs text-zinc-500">Загрузка СВОД ТД-ПМ…</p>
      </div>
    );
  }

  if (!view) {
    return (
      <div className="bg-white dark:bg-zinc-800/60 rounded-xl shadow-sm border border-amber-200 dark:border-amber-700/50 p-12 text-center">
        <FileSpreadsheet className="mx-auto text-amber-400 dark:text-amber-500 mb-3" size={40} />
        <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">Лист СВОД ТД-ПМ не загружен</p>
        <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-4 max-w-md mx-auto">
          Эта панель показывает числа напрямую из ячеек вашего листа «СВОД ТД-ПМ».
          Нажмите «Обновить» в шапке, чтобы загрузить Google Таблицу.
        </p>
      </div>
    );
  }

  const summaryYear = view.summary.total.year;
  const epShare =
    summaryYear.planCount && summaryYear.planCount > 0
      ? (view.summary.ep.year.planCount ?? 0) / summaryYear.planCount
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
              <h2 className="text-base font-semibold text-zinc-800 dark:text-zinc-100">СВОД ТД-ПМ</h2>
              <p className="text-xs text-zinc-400 dark:text-zinc-500 flex items-center gap-1.5">
                <CheckCircle2 size={12} className="text-emerald-500" />
                Точная копия листа · числа из ваших ячеек (Google Sheets)
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {/* Период */}
            <div className="flex items-center bg-zinc-100 dark:bg-zinc-700/50 rounded-lg p-0.5">
              {(['q1', 'year'] as SvodPeriod[]).map((p) => (
                <button
                  key={p}
                  onClick={() => setPeriod(p)}
                  className={clsx(
                    'px-3 py-1.5 rounded-md text-xs font-medium transition',
                    period === p
                      ? 'bg-cyan-600 text-white shadow-sm'
                      : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200',
                  )}
                >
                  {p === 'q1' ? '1 квартал' : 'Год'}
                </button>
              ))}
            </div>

            {/* Бюджеты: Итого / Все */}
            <button
              onClick={() => setBudgetFull((v) => !v)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-zinc-100 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-300 rounded-lg hover:bg-zinc-200 dark:hover:bg-zinc-600 transition"
              title={budgetFull ? 'Свернуть до «Итого»' : 'Показать ФБ / КБ / МБ'}
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

        {isDemo && (
          <div className="mt-3 flex items-center gap-2 text-[11px] text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 rounded-lg px-3 py-1.5">
            <AlertTriangle size={12} />
            Демо-данные: Google Таблицы недоступны. Числа условны.
          </div>
        )}

        {/* Сводные чипы — за «{период}» */}
        <div className="mt-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5">
          <SummaryChip label="План (кол-во)" value={fmtCount(pickRow(view.summary.total, period).planCount)} />
          <SummaryChip label="Факт (кол-во)" value={fmtCount(pickRow(view.summary.total, period).factCount)} />
          <SummaryChip
            label="Исполнение"
            value={fmtPct(pickRow(view.summary.total, period).executionPct)}
            valueClass={execColorClass(pickRow(view.summary.total, period).executionPct)}
            hint="по штукам (Факт ÷ План), как столбец G листа"
          />
          <SummaryChip label={`Экономия, ${moneyLabel}`} value={fmtMoney(pickRow(view.summary.total, period).economyTotal)} />
          <SummaryChip label="Доля ЕП" value={period === 'year' ? fmtPct(epShare) : '—'} hint="доля закупок у единственного поставщика по штукам (год)" />
        </div>
      </div>

      {/* ── Таблица СВОД ── */}
      <div className="bg-white dark:bg-zinc-800/60 rounded-xl shadow-sm border border-zinc-100 dark:border-zinc-700/50 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs border-collapse">
            <SvodTableHead budgetFull={showBudgetBreakdown} moneyLabel={moneyLabel} />
            <tbody>
              {/* Сводный блок */}
              <BlockGroup
                title="СВОД · все ГРБС"
                subtitle="агрегат по 8 управлениям"
                block={view.summary}
                period={period}
                budgetFull={showBudgetBreakdown}
                fmtMoney={fmtMoney}
                visibleKinds={visibleKinds}
                emphasized
              />
              {/* По управлениям */}
              {departments.map((d) => (
                <BlockGroup
                  key={d.id}
                  title={d.shortName}
                  subtitle={d.name}
                  block={d.block}
                  period={period}
                  budgetFull={showBudgetBreakdown}
                  fmtMoney={fmtMoney}
                  visibleKinds={visibleKinds}
                  sheetCell={depJumpCell(d.id)}
                />
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Сверка с ШДЮ ── */}
      <ShdyuReconSummary />

      <p className="text-[11px] text-zinc-400 dark:text-zinc-500 px-1">
        Источник — ваш лист «СВОД ТД-ПМ» (формулы COUNTIFS/SUMIFS), прочитанный через Google Sheets API.
        «ИТОГО» = КП + ЕП: количество и суммы складываются, исполнение пересчитывается как Факт ÷ План по штукам.
      </p>
    </div>
  );
}

// ── Подкомпоненты ────────────────────────────────────────────────────

function pickRow(section: { q1: SvodRow; year: SvodRow }, period: SvodPeriod): SvodRow {
  return period === 'q1' ? section.q1 : section.year;
}

/** Адрес ячейки для «прыжка» в Google Sheets к блоку ГРБС (строка КП-год). */
function depJumpCell(deptId: string): string | undefined {
  const cfg = (DEPARTMENT_ROWS as unknown as Record<string, { kpYear: number } | undefined>)[deptId];
  return cfg ? `A${cfg.kpYear}` : undefined;
}

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

function SvodTableHead({ budgetFull, moneyLabel }: { budgetFull: boolean; moneyLabel: string }) {
  const moneySpan = budgetFull ? 4 : 1;
  const th = 'px-2.5 py-2 font-semibold text-zinc-500 dark:text-zinc-400 border-b border-zinc-200 dark:border-zinc-700';
  const sub = 'px-2.5 py-1.5 font-medium text-[10px] text-zinc-400 dark:text-zinc-500 border-b border-zinc-200 dark:border-zinc-700 text-right';
  return (
    <thead className="sticky top-0 z-10 bg-zinc-50 dark:bg-zinc-900/80 backdrop-blur">
      <tr className="text-[10px] uppercase tracking-wider">
        <th className={clsx(th, 'text-left sticky left-0 bg-zinc-50 dark:bg-zinc-900/80')} rowSpan={2}>ГРБС / раздел</th>
        <th className={clsx(th, 'text-center border-l border-zinc-200 dark:border-zinc-700')} colSpan={4}>Количество, ед.</th>
        <th className={clsx(th, 'text-center border-l border-zinc-200 dark:border-zinc-700')} colSpan={moneySpan}>План, {moneyLabel}</th>
        <th className={clsx(th, 'text-center border-l border-zinc-200 dark:border-zinc-700')} colSpan={moneySpan}>Факт, {moneyLabel}</th>
        <th className={clsx(th, 'text-center border-l border-zinc-200 dark:border-zinc-700')} colSpan={moneySpan}>Экономия, {moneyLabel}</th>
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
  title, subtitle, block, period, budgetFull, fmtMoney, emphasized, sheetCell, visibleKinds,
}: {
  title: string;
  subtitle: string;
  block: SvodBlock;
  period: SvodPeriod;
  budgetFull: boolean;
  fmtMoney: (n: number | null) => string;
  emphasized?: boolean;
  sheetCell?: string;
  visibleKinds: SectionKind[];
}) {
  const colCount = 1 + 4 + (budgetFull ? 4 : 1) * 3;
  const allRows: Array<{ kind: SectionKind; row: SvodRow }> = [
    { kind: 'kp', row: pickRow(block.kp, period) },
    { kind: 'ep', row: pickRow(block.ep, period) },
    { kind: 'total', row: pickRow(block.total, period) },
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
            <span className="text-[10px] text-zinc-400 dark:text-zinc-500 truncate">{subtitle}</span>
            {sheetCell && (
              <a
                href={buildSheetUrl(sheetCell)}
                target="_blank"
                rel="noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="ml-auto p-1 rounded hover:bg-zinc-200/70 dark:hover:bg-zinc-700/60 transition text-zinc-400 hover:text-cyan-600 dark:hover:text-cyan-400"
                title="Открыть этот блок в Google Sheets"
              >
                <ExternalLink size={12} />
              </a>
            )}
          </div>
        </td>
      </tr>
      {/* 3 строки: КП / ЕП / ИТОГО */}
      {rows.map(({ kind, row }) => (
        <SvodDataRow key={kind} kind={kind} row={row} budgetFull={budgetFull} fmtMoney={fmtMoney} />
      ))}
    </>
  );
}

function SvodDataRow({
  kind, row, budgetFull, fmtMoney,
}: {
  kind: SectionKind;
  row: SvodRow;
  budgetFull: boolean;
  fmtMoney: (n: number | null) => string;
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
      {/* Раздел */}
      <td className="px-3 py-1.5 sticky left-0 z-[1] bg-inherit">
        <span className={clsx('inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold', meta.tagClass)}>
          {meta.label}
        </span>
      </td>

      {/* Количество */}
      <td className={clsx(numMuted, 'border-l border-zinc-100 dark:border-zinc-800/60')}>{fmtCount(row.planCount)}</td>
      <td className={numMuted}>{fmtCount(row.factCount)}</td>
      <td className={clsx(num, deviationColor(row.deviationCount))}>{fmtCount(row.deviationCount)}</td>
      <td className={clsx(num, 'font-semibold', execColorClass(row.executionPct))}>{fmtPct(row.executionPct)}</td>

      {/* План */}
      {budgetFull ? (
        <>
          <td className={clsx(numMuted, 'border-l border-zinc-100 dark:border-zinc-800/60')}>{fmtMoney(row.planFB)}</td>
          <td className={numMuted}>{fmtMoney(row.planKB)}</td>
          <td className={numMuted}>{fmtMoney(row.planMB)}</td>
          <td className={clsx(num, 'font-semibold text-zinc-700 dark:text-zinc-200')}>{fmtMoney(row.planTotal)}</td>
        </>
      ) : (
        <td className={clsx(num, 'font-medium text-zinc-700 dark:text-zinc-200 border-l border-zinc-100 dark:border-zinc-800/60')}>{fmtMoney(row.planTotal)}</td>
      )}

      {/* Факт */}
      {budgetFull ? (
        <>
          <td className={clsx(numMuted, 'border-l border-zinc-100 dark:border-zinc-800/60')}>{fmtMoney(row.factFB)}</td>
          <td className={numMuted}>{fmtMoney(row.factKB)}</td>
          <td className={numMuted}>{fmtMoney(row.factMB)}</td>
          <td className={clsx(num, 'font-semibold text-zinc-700 dark:text-zinc-200')}>{fmtMoney(row.factTotal)}</td>
        </>
      ) : (
        <td className={clsx(num, 'font-medium text-zinc-700 dark:text-zinc-200 border-l border-zinc-100 dark:border-zinc-800/60')}>{fmtMoney(row.factTotal)}</td>
      )}

      {/* Экономия */}
      {budgetFull ? (
        <>
          <td className={clsx(numMuted, 'border-l border-zinc-100 dark:border-zinc-800/60')}>{fmtMoney(row.economyFB)}</td>
          <td className={numMuted}>{fmtMoney(row.economyKB)}</td>
          <td className={numMuted}>{fmtMoney(row.economyMB)}</td>
          <td className={clsx(num, 'font-semibold text-emerald-700 dark:text-emerald-400')}>{fmtMoney(row.economyTotal)}</td>
        </>
      ) : (
        <td className={clsx(num, 'font-medium text-emerald-700 dark:text-emerald-400 border-l border-zinc-100 dark:border-zinc-800/60')}>{fmtMoney(row.economyTotal)}</td>
      )}
    </tr>
  );
}

function deviationColor(n: number | null): string {
  if (n === null || Math.abs(n) < 1e-9) return 'text-zinc-400 dark:text-zinc-500';
  return n < 0 ? 'text-red-600 dark:text-red-400' : 'text-zinc-600 dark:text-zinc-300';
}

// ── Секция: сверка с ШДЮ ──────────────────────────────────────────────

interface ReconMonthlyResp {
  counts?: { ok: number; warning: number; high: number; empty: number };
  overallStatus?: string;
  warning?: string | null;
}

/** Компактная сводка помесячной сверки «расчёт vs ШДЮ» прямо на странице Свод. */
function ShdyuReconSummary() {
  const navigateTo = useStore((s) => s.navigateTo);
  const [data, setData] = useState<ReconMonthlyResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    api
      .getReconciliationMonthly()
      .then((d: ReconMonthlyResp) => { if (alive) { setData(d); setLoading(false); } })
      .catch(() => { if (alive) { setFailed(true); setLoading(false); } });
    return () => { alive = false; };
  }, []);

  const counts = data?.counts;
  const reconciled = counts ? counts.ok + counts.warning + counts.high : 0;

  return (
    <div className="bg-white dark:bg-zinc-800/60 rounded-xl shadow-sm border border-zinc-100 dark:border-zinc-700/50 p-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-violet-50 dark:bg-violet-950/40 flex items-center justify-center flex-shrink-0">
            <Scale className="text-violet-600 dark:text-violet-400" size={20} />
          </div>
          <div>
            <h2 className="text-base font-semibold text-zinc-800 dark:text-zinc-100">Сверка с ШДЮ</h2>
            <p className="text-xs text-zinc-400 dark:text-zinc-500">
              Помесячное расхождение «расчёт vs ШДЮ» · по всем управлениям
            </p>
          </div>
        </div>
        <button
          onClick={() => navigateTo('recon')}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-300 rounded-lg hover:bg-red-100 dark:hover:bg-red-900/40 transition"
        >
          Полная сверка
          <ArrowRight size={13} />
        </button>
      </div>

      {loading ? (
        <div className="mt-4 flex items-center gap-2 text-xs text-zinc-500">
          <div className="animate-spin w-4 h-4 border-2 border-violet-500 border-t-transparent rounded-full" />
          Загрузка сверки…
        </div>
      ) : failed || !counts ? (
        <div className="mt-4 flex items-center gap-2 text-[11px] text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 rounded-lg px-3 py-1.5">
          <AlertTriangle size={12} />
          {data?.warning ?? 'Сверка с ШДЮ недоступна. Нажмите «Обновить» в шапке.'}
        </div>
      ) : (
        <>
          <div className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
            Статус: <span className="font-medium text-zinc-700 dark:text-zinc-200">{data.overallStatus ?? '—'}</span>
            {reconciled > 0 && (
              <> · строк сверено: <span className="tabular-nums">{reconciled.toLocaleString('ru-RU')}</span></>
            )}
          </div>
          <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            <ReconChip label="Совпало" value={counts.ok} tone="ok" />
            <ReconChip label="Внимание" value={counts.warning} tone="warn" />
            <ReconChip label="Расхождение" value={counts.high} tone="high" />
            <ReconChip label="Нет данных" value={counts.empty} tone="muted" />
          </div>
        </>
      )}
    </div>
  );
}

function ReconChip({ label, value, tone }: { label: string; value: number; tone: 'ok' | 'warn' | 'high' | 'muted' }) {
  const toneClass = {
    ok: 'text-emerald-600 dark:text-emerald-400',
    warn: 'text-amber-600 dark:text-amber-400',
    high: 'text-red-600 dark:text-red-400',
    muted: 'text-zinc-400 dark:text-zinc-500',
  }[tone];
  return (
    <div className="rounded-lg bg-zinc-50 dark:bg-zinc-900/40 border border-zinc-100 dark:border-zinc-700/40 px-3 py-2">
      <div className="text-[10px] text-zinc-400 dark:text-zinc-500 truncate">{label}</div>
      <div className={clsx('text-lg font-semibold tabular-nums mt-0.5', toneClass)}>{value.toLocaleString('ru-RU')}</div>
    </div>
  );
}
