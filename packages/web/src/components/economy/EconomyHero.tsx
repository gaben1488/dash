// ── Hero-полоса страницы «Экономия»: четыре метрики со спарклайнами и
//    дельтами, вертикальный разрез по бюджетам и четвёрка управлений с
//    наибольшей экономией. Store не читает — все данные и колбэки через пропсы.
//
//    Клик по метрике не просто подсвечивает плитку: он пересортировывает
//    таблицу ниже по этому же показателю. Подсветка без последствий была бы
//    имитацией управления.

import clsx from 'clsx';
import { KBTooltip } from '../ui/kb-tooltip';
import { Card, FOCUS_RING, MiniSpark, TriBar } from './primitives';
import { BT } from './primitives';
import { formatPct } from '../../lib/economy/format';
import { HIGH_ECONOMY_PCT } from '../../lib/economy/types';
import type { DeptEconomy } from '../../lib/economy/types';
import type { EconomyTotals } from '../../lib/economy/dept-economy';
import type { QuarterDeltas } from '../../lib/economy/quarterly';

/** Выбранная hero-метрика (подсветка активной плитки). */
export type HeroMetric = 'economy' | 'share' | 'high' | 'conflicts';

export interface EconomyHeroProps {
  /** Отфильтрованные строки ГРБС (списки в подписях + четвёрка лидеров). */
  rows: DeptEconomy[];
  totals: EconomyTotals;
  economySpark: number[];
  pctSpark: Array<number | null>;
  deltas: QuarterDeltas;
  /** Активная метрика; null — таблица отсортирована колонкой, которой тут нет. */
  heroMetric: HeroMetric | null;
  onHeroMetric: (metric: HeroMetric) => void;
  formatMoney: (v: number) => string;
  onToggleDepartment: (deptId: string) => void;
}

export function EconomyHero({
  rows, totals, economySpark, pctSpark, deltas,
  heroMetric, onHeroMetric, formatMoney, onToggleDepartment,
}: EconomyHeroProps) {
  // Разброс долей показываем только когда управлений с лимитом больше одного —
  // «мин 8 % / макс 8 %» по единственной строке смысла не несёт.
  const spread = totals.ratedCount > 1 && totals.pctMin !== null && totals.pctMax !== null
    ? `разброс ${formatPct(totals.pctMin)} — ${formatPct(totals.pctMax)}`
    : null;
  // Среднее по управлениям — НЕ доля района: управления входят в него с
  // одинаковым весом независимо от объёма. Поэтому оно живёт в подписи и
  // названо своим именем, а крупным кеглем стоит взвешенная доля района.
  const avgNote = totals.avgPct !== null
    ? `в среднем по управлениям ${formatPct(totals.avgPct)} (без учёта объёма)`
    : 'лимитов нет — доля не считается';

  const shareIsHigh = totals.share !== null && totals.share > HIGH_ECONOMY_PCT;

  const metrics = [
    {
      key: 'economy' as const,
      label: 'Экономия',
      value: formatMoney(totals.economy),
      // Стрелка «лимит → факт» подсказывала бы, что экономия = лимит − факт.
      // Это ровно та подмена, от которой предостерегает канон метрик.
      sub: `лимит ${formatMoney(totals.plan)} · факт ${formatMoney(totals.fact)}`,
      title: 'Утверждённая экономия по выбранным управлениям',
      delta: deltas.economy !== 0 ? formatMoney(Math.abs(deltas.economy)) : null,
      deltaUp: deltas.economy > 0,
      color: 'text-emerald-400',
      metric: 'total_economy',
      status: totals.economy < 0 ? 'border-red-500/40' : '',
      spark: economySpark,
    },
    {
      key: 'share' as const,
      label: 'Доля от лимита',
      value: formatPct(totals.share),
      sub: spread ? `${avgNote} · ${spread}` : avgNote,
      title: 'Экономия района ÷ сумма лимитов района',
      delta: deltas.pct !== null && deltas.pct !== 0 ? formatPct(Math.abs(deltas.pct)) : null,
      deltaUp: (deltas.pct ?? 0) > 0,
      color: shareIsHigh ? 'text-red-400' : 'text-blue-400',
      metric: 'economy_rate',
      status: shareIsHigh ? 'border-red-500/40' : '',
      spark: pctSpark,
    },
    {
      key: 'high' as const,
      label: 'Свыше 25 %',
      value: String(totals.highCount),
      sub: totals.highCount > 0
        ? rows.filter(d => d.highEconomy).map(d => d.dept).join(', ')
        : 'таких управлений нет',
      title: 'Управления, где экономия превысила четверть лимита',
      delta: null,
      deltaUp: false,
      color: totals.highCount > 0 ? 'text-red-400' : 'text-emerald-400',
      metric: null,
      status: totals.highCount > 0 ? 'border-red-500/40' : '',
      spark: null,
    },
    {
      key: 'conflicts' as const,
      label: 'Расхождения',
      value: String(totals.conflicts),
      sub: totals.conflicts > 0
        ? rows.filter(d => d.conflicts > 0).map(d => `${d.dept} (${d.conflicts})`).join(', ')
        : 'расхождений нет',
      title: 'Строки, где финансовый орган и управление разошлись в признании экономии',
      delta: null,
      deltaUp: false,
      color: totals.conflicts > 0 ? 'text-amber-400' : 'text-emerald-400',
      metric: 'economy_conflicts',
      status: totals.conflicts > 3 ? 'border-red-500/40' : totals.conflicts > 0 ? 'border-amber-500/40' : '',
      spark: null,
    },
  ];

  const budgetLegend = [
    { token: BT.fb, val: totals.fbEco, color: 'text-blue-400' },
    { token: BT.kb, val: totals.kbEco, color: 'text-emerald-400' },
    { token: BT.mb, val: totals.mbEco, color: 'text-amber-400' },
  ];

  // Четвёрка лидеров считается по экономии всегда — даже когда таблица
  // отсортирована другой колонкой. Иначе подпись обещала бы одно, а список
  // показывал другое.
  const topByEconomy = [...rows].sort((a, b) => b.economy - a.economy).slice(0, 4);

  return (
    <Card accent="emerald" className="animate-[slideUp_400ms_ease-out]">
      <div className="grid grid-cols-[1fr_1px_auto] lg:grid-cols-[2fr_1px_auto_1px_auto]">

        {/* ── Слева: 4 метрики-селектора (клик = сортировка таблицы) ── */}
        <div className="grid grid-cols-2 lg:grid-cols-4">
          {metrics.map((m, i) => {
            const active = heroMetric === m.key;
            const body = (
              <div className="min-w-0">
                <div className="text-[9px] font-bold uppercase tracking-widest text-zinc-500 mb-0.5">{m.label}</div>
                <div className="flex items-baseline gap-1">
                  <span className={clsx('text-sm font-black tabular-nums leading-none tracking-tight', m.color)}>{m.value}</span>
                  {m.delta && (
                    <span
                      className={clsx(
                        'inline-flex items-center gap-px text-[7px] font-bold tabular-nums whitespace-nowrap',
                        m.deltaUp ? 'text-emerald-400' : 'text-red-400',
                      )}
                      title={`${deltas.label}: ${m.deltaUp ? 'рост' : 'снижение'} на ${m.delta}`}
                    >
                      <span aria-hidden="true">{m.deltaUp ? '↑' : '↓'}</span>
                      {m.delta}
                      <span className="sr-only">{`${m.deltaUp ? 'рост' : 'снижение'}, ${deltas.label}`}</span>
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1 mt-0.5">
                  {m.spark && <MiniSpark data={m.spark} w={40} h={10} color={m.color.includes('red') ? '#ef4444' : '#10b981'} />}
                  <span className="text-[8px] text-zinc-600 truncate" title={m.sub}>{m.sub}</span>
                </div>
              </div>
            );
            return (
              <button
                key={m.key}
                type="button"
                onClick={() => onHeroMetric(m.key)}
                aria-pressed={active}
                title={`${m.title}. Нажмите, чтобы отсортировать таблицу по этому показателю`}
                className={clsx(
                  'relative px-3 py-2 text-left transition-all group/metric',
                  FOCUS_RING,
                  active ? 'bg-white/[0.04]' : 'hover:bg-white/[0.02]',
                  i > 0 && 'border-l border-white/[0.04]',
                  m.status,
                )}
              >
                {active && (
                  <div className="absolute bottom-0 inset-x-0 h-0.5 bg-gradient-to-r from-transparent via-emerald-400 to-transparent" aria-hidden="true" />
                )}
                {m.metric
                  ? <KBTooltip metric={m.metric} side="bottom" showIcon>{body}</KBTooltip>
                  : (
                    // Записи базы знаний ровно под этот счётчик нет: готовые ключи
                    // считают строки закупок, а здесь — управления. Подставлять
                    // чужую карточку нельзя, поэтому объяснение своё.
                    <KBTooltip
                      side="bottom"
                      showIcon
                      description="Управления с высокой экономией"
                      whatIs="Сколько управлений сэкономили больше четверти своего лимита. Считается по строкам таблицы ниже, а не по отдельным закупкам."
                      howCalc="Для каждого управления: экономия ÷ лимит × 100. Если больше 25 % — управление попадает в счётчик."
                      thresholdsFull={'🟢 ни одного управления — норма\n🔴 есть управления — запросить обоснование начальной цены'}
                      lawFull={'44-ФЗ, ст. 37 — антидемпинговые меры\nПри снижении цены на четверть и более участник предоставляет повышенное обеспечение исполнения контракта.'}
                      actions="Запросить у управления обоснование начальной цены (ст. 22) и проверить применение антидемпинговых мер (ст. 37)."
                      pitfalls="Порог считается от лимита программы, а ст. 37 оперирует снижением от начальной цены закупки — это разные базы, показатель служит указателем, а не доказательством."
                    >
                      {body}
                    </KBTooltip>
                  )}
              </button>
            );
          })}
        </div>

        <div className="bg-white/[0.06] hidden lg:block" aria-hidden="true" />

        {/* ── Центр: разрез по бюджетам ── */}
        <div className="hidden lg:flex flex-col justify-center px-3 py-1.5 gap-1 min-w-[140px]">
          <h3 className="text-[9px] font-bold uppercase tracking-widest text-zinc-500">Из каких бюджетов</h3>
          <TriBar fb={totals.fbEco} kb={totals.kbEco} mb={totals.mbEco} h="h-1.5" />
          <div className="flex flex-col gap-px">
            {budgetLegend.map(b => (
              <div key={b.token.label} className="flex items-center gap-1">
                <span className={clsx('w-1 h-1 rounded-full shrink-0', b.token.dot)} aria-hidden="true" />
                <span className="text-[8px] text-zinc-500 w-4" title={b.token.full}>{b.token.label}</span>
                <span className={clsx('text-[9px] font-bold tabular-nums', b.color)}>{formatMoney(b.val)}</span>
                <span className="text-[8px] text-zinc-600 ml-auto">
                  {totals.economy > 0 ? formatPct((b.val / totals.economy) * 100, 0) : ''}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-white/[0.06] hidden lg:block" aria-hidden="true" />

        {/* ── Справа: четвёрка управлений с наибольшей экономией ── */}
        <div className="hidden lg:block px-3 py-1.5 min-w-[140px] max-w-[170px]">
          <h3 className="text-[9px] font-bold uppercase tracking-widest text-zinc-500 mb-1">Больше всего сэкономили</h3>
          {topByEconomy.map((d, i) => (
            <button
              key={d.deptId}
              type="button"
              onClick={() => onToggleDepartment(d.deptId)}
              title={`Оставить в фильтре только ${d.dept}`}
              className={clsx(
                'w-full flex items-center gap-1.5 py-0.5 hover:bg-white/[0.03] rounded transition-colors group/rank',
                FOCUS_RING,
              )}
            >
              <span className="text-[9px] font-bold text-zinc-600 w-3" aria-hidden="true">{i + 1}</span>
              <span className="text-[10px] text-zinc-400 group-hover/rank:text-blue-400 transition-colors truncate flex-1 text-left">{d.dept}</span>
              <span className="text-[10px] font-bold tabular-nums text-emerald-400">{formatMoney(d.economy)}</span>
            </button>
          ))}
        </div>
      </div>
    </Card>
  );
}
