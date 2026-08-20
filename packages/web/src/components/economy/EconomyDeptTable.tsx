// ── Таблица «Экономия по управлениям»: сортируемые колонки, раскрытие
//    управления (бюджеты → структура расходов: аппарат + подведомственные),
//    инлайн-рекомендации (свыше 25 % / расхождения), итоговая строка.

import { Fragment } from 'react';
import clsx from 'clsx';
import {
  AlertTriangle, Building2, ChevronRight, ExternalLink,
  CircleDot, Layers, Sparkles, Zap,
} from 'lucide-react';
import { KBTooltip } from '../ui/kb-tooltip';
import { BT, EconomyProgress, FOCUS_RING, MiniSpark, PctBadge, SortChevron, TriBar } from './primitives';
import { formatPct } from '../../lib/economy/format';
import { pctOf } from '../../lib/economy/dept-economy';
import { ORG_ITSELF } from '../../lib/economy/types';
import type { DeptEconomy, SortDir, SortField, SubEconomy } from '../../lib/economy/types';
import type { EconomyTotals } from '../../lib/economy/dept-economy';

type Fmt = (v: number) => string;

/** Склонение «расхождение / расхождения / расхождений». */
function conflictWord(n: number): string {
  const abs = Math.abs(n) % 100;
  const d = abs % 10;
  if (abs > 10 && abs < 20) return 'расхождений';
  if (d === 1) return 'расхождение';
  if (d > 1 && d < 5) return 'расхождения';
  return 'расхождений';
}

/** Строка бюджета (ФБ/КБ/МБ) внутри раскрытого управления. */
function BudgetRow({ label, plan, fact, economy, fmt, tk }: {
  label: string; plan: number; fact: number; economy: number;
  fmt: Fmt; tk: 'fb' | 'kb' | 'mb';
}) {
  const t = BT[tk];
  return (
    <tr className="text-[10px] border-t border-zinc-100 dark:border-white/[0.03]">
      <td className="pl-10 pr-2 py-1">
        <span className={clsx('flex items-center gap-1.5 font-medium', t.text)}>
          <span className={clsx('w-1.5 h-1.5 rounded-full', t.dot)} aria-hidden="true" />
          {label}
        </span>
      </td>
      <td className="px-2 py-1 text-right tabular-nums text-zinc-500">{fmt(plan)}</td>
      <td className="px-2 py-1 text-right tabular-nums text-zinc-500">{fmt(fact)}</td>
      <td className="px-2 py-1 text-right tabular-nums text-emerald-600 dark:text-emerald-400 font-medium">{fmt(economy)}</td>
      <td className="px-2 py-1 text-right"><PctBadge pct={pctOf(economy, plan)} compact /></td>
      <td colSpan={3} />
    </tr>
  );
}

/** Строка подведомственной организации; клик — переход в Реестр строк. */
function SubRow({ sub, fmt, onNav }: { sub: SubEconomy; fmt: Fmt; onNav?: () => void }) {
  return (
    <tr className="text-[10px] border-t border-zinc-100 dark:border-white/[0.02] hover:bg-zinc-50 dark:hover:bg-white/[0.02] transition-colors group/sub">
      <td className="pl-10 pr-2 py-1">
        <button
          type="button"
          onClick={onNav}
          className={clsx(
            'text-zinc-600 dark:text-zinc-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors text-left truncate max-w-[180px] flex items-center gap-1.5',
            FOCUS_RING,
          )}
          title={`${sub.name} — открыть строки закупок в Реестре`}
        >
          <CircleDot size={7} className="shrink-0 text-zinc-500 dark:text-zinc-600" aria-hidden="true" />
          <span className="truncate">{sub.name}</span>
          <ExternalLink size={7} className="shrink-0 opacity-0 group-hover/sub:opacity-60 transition-opacity" aria-hidden="true" />
        </button>
      </td>
      <td className="px-2 py-1 text-right tabular-nums text-zinc-500">{fmt(sub.planTotal)}</td>
      <td className="px-2 py-1 text-right tabular-nums text-zinc-500">{fmt(sub.factTotal)}</td>
      <td className="px-2 py-1 text-right tabular-nums text-emerald-600/80 dark:text-emerald-400/80">{fmt(sub.economy)}</td>
      <td className="px-2 py-1 text-right"><PctBadge pct={sub.pct} compact /></td>
      <td className="px-2 py-1">
        <TriBar fb={sub.budget.economyFB} kb={sub.budget.economyKB} mb={sub.budget.economyMB} />
      </td>
      <td colSpan={2} />
    </tr>
  );
}

export interface EconomyDeptTableProps {
  rows: DeptEconomy[];
  totals: EconomyTotals;
  expandedDepts: ReadonlySet<string>;
  onToggleExpand: (dept: string) => void;
  sortField: SortField;
  sortDir: SortDir;
  onSort: (field: SortField) => void;
  /** Квартальные спарклайны по deptKey. */
  deptSparks: Record<string, number[]>;
  /** Активен фильтр по бюджетам: расхождения он не сужает — об этом надо сказать. */
  budgetFiltered: boolean;
  /**
   * Режим подведов (org-scope): канонические подведы выбранного управления,
   * у которых в выборке НЕТ ни одной строки. Передаётся только при одном
   * выбранном ГРБС «с подведомственными»; такие учреждения присутствуют в
   * разбивке с честным «строк нет» — «строк нет» и «организации нет» обязаны
   * различаться (честная пустота).
   */
  canonicalEmptySubs?: readonly string[];
  formatMoney: Fmt;
  onToggleDepartment: (deptId: string) => void;
  onNavigateToSub: (deptId: string, subName: string) => void;
}

export function EconomyDeptTable({
  rows, totals, expandedDepts, onToggleExpand,
  sortField, sortDir, onSort, deptSparks, budgetFiltered,
  canonicalEmptySubs, formatMoney, onToggleDepartment, onNavigateToSub,
}: EconomyDeptTableProps) {
  // Канонические подведы без строк участвуют в разбивке только в режиме
  // одного ГРБС «с подведомственными» — при нескольких управлениях список
  // не к кому отнести.
  const emptyCanon = rows.length === 1 ? (canonicalEmptySubs ?? []) : [];
  /**
   * Заголовок-сортировщик. aria-sort принадлежит ячейке заголовка, а кнопка
   * внутри даёт клавиатуре точку входа — раньше сортировка жила на onClick
   * самого <th> и с клавиатуры была недостижима.
   */
  const TH = ({ label, field, metric, hint, align = 'right', w }: {
    label: string; field: SortField; metric?: string; hint?: string;
    align?: 'left' | 'right' | 'center'; w?: string;
  }) => {
    const inner = (
      <button
        type="button"
        onClick={() => onSort(field)}
        title={hint ? `${hint}. Нажмите, чтобы отсортировать` : 'Нажмите, чтобы отсортировать'}
        className={clsx('inline-flex items-center gap-0.5 hover:text-zinc-700 dark:hover:text-zinc-300 transition-colors', FOCUS_RING)}
      >
        {label}<SortChevron field={field} active={sortField} dir={sortDir} />
      </button>
    );
    return (
      <th
        scope="col"
        aria-sort={sortField === field ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
        className={clsx(
          'px-2 py-1.5 text-[9px] font-bold uppercase tracking-widest select-none whitespace-nowrap text-zinc-500',
          align === 'left' ? 'text-left' : align === 'center' ? 'text-center' : 'text-right',
          w,
        )}
      >
        {metric ? <KBTooltip metric={metric} side="top" showIcon>{inner}</KBTooltip> : inner}
      </th>
    );
  };

  return (
    <table className="w-full">
      <caption className="sr-only">
        Экономия по управлениям: лимит, факт, утверждённая экономия, доля от лимита,
        разбивка по бюджетам, расхождения и число подведомственных организаций.
      </caption>
      <thead>
        <tr className="border-b border-zinc-200 dark:border-white/[0.06]">
          <TH label="Управление" field="dept" align="left" w="w-[180px]" hint="Главный распорядитель бюджетных средств" />
          <TH label="Лимит" field="limit" metric="plan_total" hint="Плановая сумма мероприятий" />
          <TH label="Факт" field="price" metric="fact_total" hint="Сумма заключённых контрактов" />
          <TH label="Экономия" field="economy" metric="total_economy" hint="Утверждённая финансовым органом" />
          {/* Ключ базы знаний — economy_rate: это доля утверждённой экономии в
              лимите. Прежний avg_reduction_pct описывает «лимит минус факт» —
              другую величину, и всплывающая справка объясняла не то число. */}
          <TH label="Доля от лимита" field="pct" metric="economy_rate" hint="Экономия, делённая на лимит" />
          <th scope="col" className="px-2 py-1.5 text-[9px] font-bold uppercase tracking-widest text-zinc-500 text-center w-20">
            <KBTooltip metric="total_economy" side="top">
              <span title="Из каких бюджетов сложилась экономия: федерального, краевого, муниципального">
                Бюджеты
              </span>
            </KBTooltip>
          </th>
          {/* Подпись — из словаря продукта: буква колонки листа наружу не выходит (канон §6.3). */}
          <TH label="Расхождения" field="conflicts" metric="economy_conflicts" align="center"
            hint={budgetFiltered
              ? 'Спор о признании экономии. Считаются по всем бюджетам — фильтр бюджетов их не сужает'
              : 'Спор о признании экономии между финансовым органом и управлением'} />
          <TH label="Организаций" field="subCount" align="center" hint="Подведомственные организации управления" />
        </tr>
      </thead>
      <tbody>
        {rows.map((d) => {
          const isExp = expandedDepts.has(d.dept);
          const b = d.budget;
          const spark = deptSparks[d.dept];
          const orgItself = d.subordinates.find(s => s.name === ORG_ITSELF);
          const realSubs = d.subordinates.filter(s => s.name !== ORG_ITSELF);
          return (
            <Fragment key={d.dept}>
              <tr
                className={clsx(
                  'transition-all duration-150 cursor-pointer group/row border-b',
                  isExp
                    ? 'bg-blue-500/[0.04] border-blue-500/10'
                    : 'border-zinc-100 dark:border-white/[0.03] hover:bg-zinc-50 dark:hover:bg-white/[0.02]',
                )}
                onClick={() => onToggleExpand(d.dept)}
              >
                <td className="px-2 py-1.5">
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); onToggleExpand(d.dept); }}
                      aria-expanded={isExp}
                      aria-label={`${isExp ? 'Свернуть' : 'Раскрыть'} состав расходов: ${d.dept}`}
                      className={clsx('shrink-0', FOCUS_RING)}
                    >
                      <ChevronRight
                        size={11}
                        aria-hidden="true"
                        className={clsx(
                          'text-zinc-500 dark:text-zinc-600 transition-transform duration-200',
                          isExp && 'rotate-90 text-blue-600 dark:text-blue-400',
                        )}
                      />
                    </button>
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); onToggleDepartment(d.deptId); }}
                      className={clsx(
                        'text-[11px] font-bold text-zinc-700 dark:text-zinc-300 hover:text-blue-600 dark:hover:text-blue-400 transition-colors truncate max-w-[140px]',
                        FOCUS_RING,
                      )}
                      title={`Оставить в фильтре только ${d.dept}`}
                    >
                      {d.dept}
                    </button>
                    {d.highEconomy && (
                      <span
                        className="inline-flex items-center gap-0.5 px-1 py-px rounded bg-red-500/10 text-[8px] font-black text-red-600 dark:text-red-400 tracking-wider whitespace-nowrap"
                        title="Экономия превысила четверть лимита — нужна проверка обоснования цены"
                      >
                        <Zap size={7} aria-hidden="true" />свыше 25 %
                      </span>
                    )}
                  </div>
                </td>
                <td className="px-2 py-1.5 text-right text-[11px] tabular-nums text-zinc-600 dark:text-zinc-400">{formatMoney(d.limit)}</td>
                <td className="px-2 py-1.5 text-right text-[11px] tabular-nums text-zinc-600 dark:text-zinc-400">{formatMoney(d.price)}</td>
                <td className="px-2 py-1.5 text-right">
                  <div className="space-y-0.5">
                    <div className="flex items-center justify-end gap-1.5">
                      <MiniSpark data={spark} color={d.economy >= 0 ? '#10b981' : '#ef4444'} />
                      <span className="text-[11px] font-bold tabular-nums text-emerald-600 dark:text-emerald-400">{formatMoney(d.economy)}</span>
                    </div>
                    <EconomyProgress limit={d.limit} fact={d.price} className="w-full" />
                  </div>
                </td>
                <td className="px-2 py-1.5 text-right"><PctBadge pct={d.pct} /></td>
                <td className="px-2 py-1.5 w-20">
                  <TriBar fb={b.economyFB} kb={b.economyKB} mb={b.economyMB} />
                </td>
                <td className="px-2 py-1.5 text-center">
                  {d.conflicts > 0 ? (
                    <span className="inline-flex items-center gap-0.5 text-[10px] font-bold text-amber-600 dark:text-amber-400"
                      title={`${d.conflicts} ${conflictWord(d.conflicts)} по признанию экономии`}>
                      <AlertTriangle size={9} aria-hidden="true" />{d.conflicts}
                    </span>
                  ) : (
                    <span className="text-[10px] text-emerald-600 dark:text-emerald-500/70" title="Расхождений по признанию экономии нет">нет</span>
                  )}
                </td>
                <td className="px-2 py-1.5 text-center">
                  {d.deptOnly ? (
                    // Пустота здесь имеет причину: включён режим «только само
                    // управление», подведомственные исключены фильтром, а не
                    // отсутствуют. Прочерк соврал бы «их нет».
                    <span className="text-[9px] text-zinc-500" title="Включён режим «только само управление» — подведомственные исключены фильтром">
                      скрыты
                    </span>
                  ) : d.realSubCount > 0 ? (
                    <span className={clsx(
                      'text-[10px] tabular-nums font-semibold',
                      isExp ? 'text-blue-600 dark:text-blue-400' : 'text-zinc-500',
                    )}>
                      {d.realSubCount}
                    </span>
                  ) : (
                    <span className="text-[9px] text-zinc-500 dark:text-zinc-600" title="Подведомственных организаций с закупками в выборке нет">нет</span>
                  )}
                </td>
              </tr>

              {isExp && (
                <>
                  <BudgetRow label="ФБ (федеральный)" plan={b.planFB} fact={b.factFB} economy={b.economyFB} fmt={formatMoney} tk="fb" />
                  <BudgetRow label="КБ (краевой)" plan={b.planKB} fact={b.factKB} economy={b.economyKB} fmt={formatMoney} tk="kb" />
                  <BudgetRow label="МБ (муниципальный)" plan={b.planMB} fact={b.factMB} economy={b.economyMB} fmt={formatMoney} tk="mb" />

                  {d.deptOnly && (
                    <tr className="border-t border-zinc-100 dark:border-white/[0.03]">
                      <td colSpan={8} className="pl-10 pr-4 py-1.5 text-[10px] text-zinc-500">
                        Состав расходов не показан: включён режим «только само управление».
                        Снимите его в фильтре управлений, чтобы увидеть подведомственные организации.
                      </td>
                    </tr>
                  )}

                  {!d.deptOnly && d.subordinates.length === 0 && emptyCanon.length === 0 && (
                    <tr className="border-t border-zinc-100 dark:border-white/[0.03]">
                      <td colSpan={8} className="pl-10 pr-4 py-1.5 text-[10px] text-zinc-500">
                        За выбранный период у управления нет строк ни по аппарату, ни по подведомственным организациям.
                      </td>
                    </tr>
                  )}

                  {(d.subordinates.length > 0 || (!d.deptOnly && emptyCanon.length > 0)) && (
                    <>
                      <tr className="border-t border-zinc-100 dark:border-white/[0.03]">
                        <td colSpan={8} className="pl-8 pr-4 pt-1.5 pb-0.5">
                          <span className="text-[9px] font-black text-zinc-500 dark:text-zinc-600 uppercase tracking-[0.15em] flex items-center gap-1.5">
                            <Building2 size={8} aria-hidden="true" />
                            Структура расходов
                          </span>
                        </td>
                      </tr>

                      {/* Аппарат управления — собственные закупки ГРБС, не подвед */}
                      {orgItself && (
                        <tr className="text-[10px] border-t border-zinc-100 dark:border-white/[0.02] bg-blue-500/[0.03]">
                          <td className="pl-10 pr-2 py-1">
                            <span className="flex items-center gap-1.5 font-semibold text-blue-700 dark:text-blue-300"
                              title="Собственные закупки управления, без подведомственных организаций">
                              <Building2 size={7} className="shrink-0" aria-hidden="true" />
                              {d.dept}: аппарат управления
                            </span>
                          </td>
                          <td className="px-2 py-1 text-right tabular-nums text-zinc-600 dark:text-zinc-400">{formatMoney(orgItself.planTotal)}</td>
                          <td className="px-2 py-1 text-right tabular-nums text-zinc-600 dark:text-zinc-400">{formatMoney(orgItself.factTotal)}</td>
                          <td className="px-2 py-1 text-right tabular-nums text-emerald-600 dark:text-emerald-400 font-medium">{formatMoney(orgItself.economy)}</td>
                          <td className="px-2 py-1 text-right"><PctBadge pct={orgItself.pct} compact /></td>
                          <td className="px-2 py-1">
                            <TriBar fb={orgItself.budget.economyFB} kb={orgItself.budget.economyKB} mb={orgItself.budget.economyMB} />
                          </td>
                          <td colSpan={2} />
                        </tr>
                      )}

                      {(realSubs.length > 0 || (!d.deptOnly && emptyCanon.length > 0)) && (
                        <>
                          <tr className="border-t border-zinc-100 dark:border-white/[0.03]">
                            <td colSpan={8} className="pl-8 pr-4 py-1">
                              <span className="text-[9px] font-black text-zinc-500 dark:text-zinc-600 uppercase tracking-[0.15em] flex items-center gap-1.5">
                                <Layers size={8} aria-hidden="true" />
                                Подведомственные организации ({realSubs.length + emptyCanon.length})
                                <span className="ml-auto text-[8px] font-medium normal-case tracking-normal text-zinc-400 dark:text-zinc-700">
                                  клик — переход в Реестр строк
                                </span>
                              </span>
                            </td>
                          </tr>
                          {realSubs.map(sub => (
                            <SubRow
                              key={sub.name}
                              sub={sub}
                              fmt={formatMoney}
                              onNav={() => onNavigateToSub(d.deptId, sub.name)}
                            />
                          ))}
                          {/* Честная пустота (org-scope): организация есть в
                              каноне управления, а строк за период нет —
                              присутствует словами, а не пропадает молча. */}
                          {!d.deptOnly && emptyCanon.map(name => (
                            <tr key={`canon-${name}`} className="text-[10px] border-t border-zinc-100 dark:border-white/[0.02]">
                              <td className="pl-10 pr-2 py-1">
                                <span className="flex items-center gap-1.5 text-zinc-500 dark:text-zinc-600">
                                  <CircleDot size={7} className="shrink-0" aria-hidden="true" />
                                  <span className="truncate max-w-[180px]" title={name}>{name}</span>
                                </span>
                              </td>
                              <td colSpan={7} className="px-2 py-1 text-[9px] text-zinc-500 dark:text-zinc-600">
                                строк за выбранный период нет — организация числится за управлением
                              </td>
                            </tr>
                          ))}
                        </>
                      )}
                    </>
                  )}

                  {(d.highEconomy || d.conflicts > 0) && (
                    <tr className="border-t border-amber-500/10">
                      <td colSpan={8} className="px-8 py-1.5">
                        <div className="flex items-start gap-2 text-[10px]">
                          <Sparkles size={10} className="text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" aria-hidden="true" />
                          <div className="text-amber-700 dark:text-amber-300/80 space-y-0.5">
                            {d.highEconomy && (
                              <p>Экономия {formatPct(d.pct)} — запросить обоснование начальной цены (ст. 22) и проверить антидемпинговые меры (ст. 37, 44-ФЗ).</p>
                            )}
                            {d.conflicts > 0 && (
                              <p>{d.conflicts} {conflictWord(d.conflicts)} по признанию экономии — направить запрос финансовому органу.</p>
                            )}
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              )}
            </Fragment>
          );
        })}
      </tbody>

      <tfoot>
        <tr className="border-t border-zinc-200 dark:border-white/[0.08] bg-zinc-50/70 dark:bg-white/[0.02]">
          <th scope="row" className="px-2 py-2 text-left text-[11px] font-black text-zinc-700 dark:text-zinc-300 uppercase tracking-wider">Итого</th>
          <td className="px-2 py-2 text-right text-[11px] tabular-nums font-bold text-zinc-700 dark:text-zinc-300">{formatMoney(totals.plan)}</td>
          <td className="px-2 py-2 text-right text-[11px] tabular-nums font-bold text-zinc-700 dark:text-zinc-300">{formatMoney(totals.fact)}</td>
          <td className="px-2 py-2 text-right text-[11px] tabular-nums font-black text-emerald-600 dark:text-emerald-400">{formatMoney(totals.economy)}</td>
          {/* Итоговая доля — взвешенная (сумма экономии ÷ сумма лимитов), а не
              среднее строк: усреднять проценты по управлениям здесь нельзя. */}
          <td className="px-2 py-2 text-right"><PctBadge pct={totals.share} /></td>
          <td className="px-2 py-2">
            <TriBar fb={totals.fbEco} kb={totals.kbEco} mb={totals.mbEco} h="h-1.5" />
          </td>
          <td className="px-2 py-2 text-center text-[10px] font-bold text-amber-600 dark:text-amber-400">
            {totals.conflicts > 0
              ? totals.conflicts
              : <span className="font-medium text-emerald-600 dark:text-emerald-500/70">нет</span>}
          </td>
          <td className="px-2 py-2 text-center text-[10px] tabular-nums text-zinc-600 dark:text-zinc-400">
            {totals.deptOnlyCount > 0
              ? <span title={`У ${totals.deptOnlyCount} управлений подведомственные скрыты режимом «только само управление»`}>{totals.subCount}*</span>
              : totals.subCount}
          </td>
        </tr>
      </tfoot>
    </table>
  );
}
