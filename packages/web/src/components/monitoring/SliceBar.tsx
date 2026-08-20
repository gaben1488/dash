/**
 * Панель разрезов реестра — «смотреть по-разному» (канон п.101а, спека §2.6).
 *
 * ВОСЕМЬ РАЗРЕЗОВ, А НЕ ДВА ФИЛЬТРА. Первая версия вкладки давала стадию и
 * заказчика — этого хватало, чтобы показать таблицу, и не хватало, чтобы
 * ответить хоть на один вопрос начальства. Способ определения поставщика,
 * квартал, размер закупки, победитель по ИНН и год процедуры — это и есть те
 * пять вопросов, ради которых книгу читают.
 *
 * СПИСКИ СОБИРАЮТСЯ ИЗ ДАННЫХ, А НЕ ИЗ КОНСТАНТ. Заказчик, победитель и год
 * берутся из прочитанных строк: константа рано или поздно разойдётся с
 * книгой, и разрез начнёт молча терять строки. Рядом с каждым значением
 * стоит его частота — читатель видит вес выбора до нажатия.
 *
 * НА УЗКОМ ЭКРАНЕ (§6.3) панель складывается в одну кнопку с числом
 * действующих разрезов; крошки остаются на виду всегда — читатель обязан
 * видеть, почему в таблице двенадцать строк вместо трёхсот семидесяти
 * четырёх, не открывая панель.
 */
import { useMemo, useState } from 'react';
import { Search, SlidersHorizontal, X } from 'lucide-react';
import type { RegistryProcedure } from '../../lib/monitoring/contract';
import {
  NMCK_BUCKETS, clearSlice, describeSlices, emptySlices, hasAnySlice, procedureDefects,
  type SliceState,
} from '../../lib/monitoring/slices';
import { deptSheetName } from '../../lib/monitoring/modes';
import { METHOD_ORDER, methodLabel, stageShort, stagesPresent } from '../../lib/monitoring/stage-labels';
import { fmtCount } from '../../lib/monitoring/format';

const MONTHS = [
  'январь', 'февраль', 'март', 'апрель', 'май', 'июнь',
  'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь',
];

/** Значения разреза с частотой — вес выбора виден до нажатия. */
function tally(values: Array<string | null>): Array<{ value: string; count: number }> {
  const map = new Map<string, number>();
  for (const v of values) {
    if (v === null || v === '') continue;
    map.set(v, (map.get(v) ?? 0) + 1);
  }
  return [...map.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value, 'ru'));
}

function Select({
  label, value, onChange, children, wide = false,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  children: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <label className="flex flex-col gap-0.5 text-[10px] text-zinc-500 dark:text-zinc-400">
      {label}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={label}
        className={`${wide ? 'max-w-[18rem]' : 'max-w-[11rem]'} w-full truncate rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-2 py-1 text-xs text-zinc-700 dark:text-zinc-200`}
      >
        {children}
      </select>
    </label>
  );
}

export interface SliceBarProps {
  /** Строки ДО применения разрезов — из них собираются списки значений. */
  rows: readonly RegistryProcedure[];
  slices: SliceState;
  onChange: (next: SliceState) => void;
  /** Сколько строк осталось после разрезов — число на кнопке сброса. */
  shownCount: number;
}

export function SliceBar({ rows, slices, onChange, shownCount }: SliceBarProps) {
  const [openOnMobile, setOpenOnMobile] = useState(false);

  const options = useMemo(() => ({
    depts: tally(rows.map((p) => p.dept)),
    stages: stagesPresent(rows.map((p) => p.stage)),
    methods: tally(rows.map((p) => p.method)),
    customers: tally(rows.map((p) => p.customer)),
    winners: tally(rows.map((p) => (p.winnerInn === null ? null : p.winnerInn))),
    winnerNames: new Map(rows.filter((p) => p.winnerInn !== null)
      .map((p) => [p.winnerInn as string, p.winnerName ?? p.winnerInn as string])),
    procedureYears: tally(rows.map((p) => (p.year === null ? null : String(p.year)))),
    defectRows: rows.filter((p) => procedureDefects(p).length > 0).length,
  }), [rows]);

  const crumbs = describeSlices(slices, deptSheetName);
  const active = hasAnySlice(slices);
  const set = (patch: Partial<SliceState>): void => onChange({ ...slices, ...patch });
  const opt = (v: string | null): string => v ?? '';

  return (
    <section
      aria-label="Разрезы реестра"
      className="bg-white dark:bg-zinc-800/60 rounded-xl border border-zinc-100 dark:border-zinc-700/50 p-3 sm:p-4 space-y-3"
    >
      <div className="flex items-center gap-2">
        <div className="relative flex-1 min-w-0">
          <Search
            size={13}
            aria-hidden="true"
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-400"
          />
          <input
            type="search"
            value={slices.query}
            onChange={(e) => set({ query: e.target.value })}
            placeholder="Поиск по коду, предмету, заказчику и ИНН победителя"
            aria-label="Поиск по реестру"
            className="w-full rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 pl-8 pr-2 py-1.5 text-xs text-zinc-700 dark:text-zinc-200 placeholder:text-zinc-400"
          />
        </div>
        {/* Кнопка-складка: только на телефоне, на большом экране панель открыта. */}
        <button
          type="button"
          onClick={() => setOpenOnMobile((v) => !v)}
          aria-expanded={openOnMobile}
          className="sm:hidden shrink-0 inline-flex items-center gap-1 rounded-lg border border-zinc-200 dark:border-zinc-700 px-2.5 py-1.5 text-xs text-zinc-600 dark:text-zinc-300"
        >
          <SlidersHorizontal size={13} aria-hidden="true" />
          Разрезы
          {crumbs.length > 0 && (
            <span className="tabular-nums rounded-full bg-zinc-800 dark:bg-zinc-100 text-white dark:text-zinc-900 px-1.5">
              {crumbs.length}
            </span>
          )}
        </button>
      </div>

      <div className={`${openOnMobile ? 'grid' : 'hidden'} sm:grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-2`}>
        <Select label="Управление" value={opt(slices.dept)} onChange={(v) => set({ dept: v || null })}>
          <option value="">все восемь листов</option>
          {options.depts.map((d) => (
            <option key={d.value} value={d.value}>{deptSheetName(d.value)} · {d.count}</option>
          ))}
        </Select>

        <Select label="Стадия" value={opt(slices.stage)} onChange={(v) => set({ stage: v || null })}>
          <option value="">любая стадия</option>
          {options.stages.map((s) => (
            <option key={s} value={s}>{stageShort(s)}</option>
          ))}
        </Select>

        <Select label="Способ определения поставщика" value={opt(slices.method)} onChange={(v) => set({ method: v || null })}>
          <option value="">любой способ</option>
          {[...options.methods].sort(
            (a, b) => METHOD_ORDER.indexOf(a.value) - METHOD_ORDER.indexOf(b.value),
          ).map((m) => (
            <option key={m.value} value={m.value}>{m.value} — {methodLabel(m.value)} · {m.count}</option>
          ))}
        </Select>

        <Select
          label="Период считать по дате"
          value={slices.periodBasis}
          onChange={(v) => set({ periodBasis: v === 'auction' ? 'auction' : 'publication' })}
        >
          <option value="publication">публикации</option>
          <option value="auction">проведения торгов</option>
        </Select>

        <Select label="Квартал" value={slices.periodQuarter === null ? '' : String(slices.periodQuarter)} onChange={(v) => set({ periodQuarter: v === '' ? null : Number(v) })}>
          <option value="">весь год</option>
          {[1, 2, 3, 4].map((q) => <option key={q} value={q}>{q} квартал</option>)}
        </Select>

        <Select label="Месяц" value={slices.periodMonth === null ? '' : String(slices.periodMonth)} onChange={(v) => set({ periodMonth: v === '' ? null : Number(v) })}>
          <option value="">все месяцы</option>
          {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
        </Select>

        <Select label="Заказчик" wide value={opt(slices.customer)} onChange={(v) => set({ customer: v || null })}>
          <option value="">все заказчики</option>
          {options.customers.map((c) => (
            <option key={c.value} value={c.value}>{c.value} · {c.count}</option>
          ))}
        </Select>

        <Select label="Победитель (по ИНН)" wide value={opt(slices.winnerInn)} onChange={(v) => set({ winnerInn: v || null })}>
          <option value="">все победители</option>
          {options.winners.map((w) => (
            <option key={w.value} value={w.value}>
              {options.winnerNames.get(w.value) ?? w.value} · {w.count}
            </option>
          ))}
        </Select>

        <Select label="Размер НМЦК" value={opt(slices.nmckBucket)} onChange={(v) => set({ nmckBucket: v || null })}>
          <option value="">любой размер</option>
          {NMCK_BUCKETS.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}
        </Select>

        <Select label="Год процедуры (из кода)" value={slices.procedureYear === null ? '' : String(slices.procedureYear)} onChange={(v) => set({ procedureYear: v === '' ? null : Number(v) })}>
          <option value="">оба года книги</option>
          {options.procedureYears.map((y) => (
            <option key={y.value} value={y.value}>{y.value} · {y.count}</option>
          ))}
        </Select>

        <label className="col-span-2 md:col-span-1 flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-300 self-end pb-1">
          <input
            type="checkbox"
            checked={slices.defectsOnly}
            onChange={(e) => set({ defectsOnly: e.target.checked })}
            className="rounded border-zinc-300 dark:border-zinc-600"
          />
          Только строки с дефектами
          <span className="tabular-nums text-zinc-400">({fmtCount(options.defectRows)})</span>
        </label>
      </div>

      {/* ── Крошки: видны всегда, в том числе со сложенной панелью ── */}
      {active && (
        <div className="flex flex-wrap items-center gap-1.5 border-t border-zinc-100 dark:border-zinc-700/50 pt-2.5">
          <span className="text-[10px] text-zinc-400 dark:text-zinc-500">
            показано {fmtCount(shownCount)} из {fmtCount(rows.length)}:
          </span>
          {crumbs.map((c) => (
            <button
              key={String(c.key)}
              type="button"
              onClick={() => onChange(clearSlice(slices, c.key))}
              className="inline-flex items-center gap-1 rounded-full bg-zinc-100 dark:bg-zinc-700/50 px-2 py-0.5 text-[10px] text-zinc-600 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700"
            >
              {c.label}
              <X size={9} aria-hidden="true" />
              <span className="sr-only">снять разрез</span>
            </button>
          ))}
          <button
            type="button"
            onClick={() => onChange(emptySlices())}
            className="text-[10px] text-zinc-500 dark:text-zinc-400 hover:underline"
          >
            снять все
          </button>
        </div>
      )}
    </section>
  );
}
