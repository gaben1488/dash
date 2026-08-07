// ── Плоский список подведомственных организаций: все подведы отфильтрованных
//    управлений по экономии убыв., максимум 60 строк на экране.
//    Клик по строке — переход в Реестр строк с фильтром по организации.

import { ExternalLink } from 'lucide-react';
import { FOCUS_RING, PctBadge, TriBar } from './primitives';
import type { SubordinateFlat } from '../../lib/economy/types';

/** Лимит строк на экране — дальше пользователя ведём в раскрытие по управлению. */
const MAX_ROWS = 60;

export interface EconomySubTableProps {
  subs: SubordinateFlat[];
  /** Есть ли управления в режиме «только само управление» — причина пустоты. */
  deptOnlyCount: number;
  formatMoney: (v: number) => string;
  onNavigateToSub: (deptId: string, subName: string) => void;
}

export function EconomySubTable({ subs, deptOnlyCount, formatMoney, onNavigateToSub }: EconomySubTableProps) {
  const TH = ({ label, align = 'right', w, hint }: {
    label: string; align?: 'left' | 'right' | 'center'; w?: string; hint?: string;
  }) => (
    <th
      scope="col"
      title={hint}
      className={`px-2 py-1.5 text-[9px] font-bold uppercase tracking-widest text-zinc-500 ${
        align === 'left' ? 'text-left' : align === 'center' ? 'text-center' : 'text-right'
      } ${w ?? ''}`}
    >
      {label}
    </th>
  );

  return (
    <table className="w-full">
      <caption className="sr-only">
        Подведомственные организации выбранных управлений, по убыванию экономии.
      </caption>
      <thead>
        <tr className="border-b border-white/[0.06]">
          <TH label="Организация" align="left" />
          <TH label="Управление" align="left" hint="Главный распорядитель, которому подведомственна организация" />
          <TH label="Лимит" />
          <TH label="Факт" />
          <TH label="Экономия" hint="Утверждённая финансовым органом" />
          <TH label="Доля от лимита" hint="Экономия, делённая на лимит" />
          <TH label="Бюджеты" align="center" w="w-16" hint="Из каких бюджетов сложилась экономия" />
        </tr>
      </thead>
      <tbody>
        {subs.length === 0 && (
          // Пустота с причиной: либо фильтр прячет подведы, либо их правда нет.
          <tr>
            <td colSpan={7} className="px-2 py-6 text-center text-[11px] text-zinc-500 leading-relaxed">
              {deptOnlyCount > 0
                ? 'Подведомственные организации скрыты режимом «только само управление». Снимите его в фильтре управлений, чтобы увидеть список.'
                : 'За выбранный период у выбранных управлений нет строк по подведомственным организациям.'}
            </td>
          </tr>
        )}
        {subs.slice(0, MAX_ROWS).map((sub, i) => (
          <tr
            key={`${sub.deptId}-${sub.name}-${i}`}
            className="border-b border-white/[0.02] hover:bg-white/[0.02] transition-colors cursor-pointer group/subrow"
            onClick={() => onNavigateToSub(sub.deptId, sub.name)}
          >
            <td className="px-2 py-1.5 text-[10px] text-zinc-300 max-w-[200px]">
              {/* Кнопка, а не просто ячейка: строка должна открываться и с клавиатуры */}
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onNavigateToSub(sub.deptId, sub.name); }}
                title={`${sub.name} — открыть строки закупок в Реестре`}
                className={`flex items-center gap-1 max-w-full text-left hover:text-blue-400 transition-colors ${FOCUS_RING}`}
              >
                <span className="truncate">{sub.name}</span>
                <ExternalLink size={8} className="shrink-0 opacity-0 group-hover/subrow:opacity-40 transition-opacity" aria-hidden="true" />
              </button>
            </td>
            <td className="px-2 py-1.5">
              <span className="text-[9px] font-bold text-zinc-500 bg-white/[0.04] px-1.5 py-0.5 rounded">
                {sub.deptName}
              </span>
            </td>
            <td className="px-2 py-1.5 text-right text-[10px] tabular-nums text-zinc-500">{formatMoney(sub.planTotal)}</td>
            <td className="px-2 py-1.5 text-right text-[10px] tabular-nums text-zinc-500">{formatMoney(sub.factTotal)}</td>
            <td className="px-2 py-1.5 text-right text-[10px] tabular-nums font-bold text-emerald-400">{formatMoney(sub.economy)}</td>
            <td className="px-2 py-1.5 text-right"><PctBadge pct={sub.pct} compact /></td>
            <td className="px-2 py-1.5 w-16">
              <TriBar fb={sub.budget.economyFB} kb={sub.budget.economyKB} mb={sub.budget.economyMB} />
            </td>
          </tr>
        ))}
        {subs.length > MAX_ROWS && (
          <tr>
            <td colSpan={7} className="px-2 py-2 text-center text-[10px] text-zinc-600">
              Показаны первые {MAX_ROWS} организаций из {subs.length} — сузьте фильтр
              или раскройте нужное управление на соседней вкладке.
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
}
