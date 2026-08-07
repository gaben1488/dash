/**
 * Карточка первопричины расхождения — сверка, которая объясняет себя сама.
 *
 * Требование владельца 07.08: расхождение обязано показывать первопричину и
 * путь до строки-виновницы (лист, строка, ячейка, вклад). Каскад — одна
 * дельта, отзывающаяся в трёх показателях, — показывается ОДНОЙ карточкой
 * со списком задетых показателей, а не тремя одинаковыми жалобами.
 *
 * Класс, подпись и рекомендация берутся из единственного дома
 * (@aemr/shared/recon-root-cause): здесь своих формулировок нет.
 */

import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import {
  ROOT_CAUSE_ACTIONS,
  ROOT_CAUSE_LABELS,
  productLabel,
  type ReconRootCauseClass,
  type RootCauseGroup,
} from '@aemr/shared';

/**
 * Тон карточки по классу. Смысл, а не радуга: дефект данных — тревожный,
 * объяснимое поведение системы (после среза) — спокойное, нераспознанное —
 * нейтральное серое, потому что вины строки в этом нет.
 */
const TONE: Record<ReconRootCauseClass, { border: string; badge: string }> = {
  unfunded: { border: 'border-l-amber-500', badge: 'bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300' },
  factQuarterMissing: { border: 'border-l-amber-500', badge: 'bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300' },
  afterSlice: { border: 'border-l-emerald-500', badge: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300' },
  sign: { border: 'border-l-red-500', badge: 'bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-300' },
  method: { border: 'border-l-amber-500', badge: 'bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300' },
  cancelled: { border: 'border-l-amber-500', badge: 'bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300' },
  parsing: { border: 'border-l-red-500', badge: 'bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-300' },
  unknown: { border: 'border-l-zinc-400', badge: 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300' },
};

/** Деньги по-русски: разряды отбиты, копейки только когда они есть. */
function money(n: number): string {
  return n.toLocaleString('ru-RU', { maximumFractionDigits: 2 });
}

interface Props {
  group: RootCauseGroup;
  /** Сколько строк-виновниц показывать до раскрытия. */
  previewRows?: number;
}

export function RootCauseCard({ group, previewRows = 5 }: Props) {
  const [open, setOpen] = useState(false);
  const { cause, metrics, totalDelta } = group;
  const tone = TONE[cause.class];
  const rows = open ? cause.rows : cause.rows.slice(0, previewRows);
  const hidden = cause.rows.length - rows.length;

  return (
    <div className={`rounded-lg border border-zinc-200 dark:border-zinc-700 border-l-4 ${tone.border} bg-white dark:bg-zinc-800/60 p-3`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold ${tone.badge}`}>
            {ROOT_CAUSE_LABELS[cause.class]}
          </span>
          <p className="mt-1.5 text-xs text-zinc-700 dark:text-zinc-200">{cause.explanation}</p>
        </div>
        <div className="shrink-0 text-right">
          <div className="text-sm font-semibold tabular-nums text-zinc-800 dark:text-zinc-100">
            {money(totalDelta)}
          </div>
          <div className="text-[10px] text-zinc-400">вклад в расхождение</div>
        </div>
      </div>

      {/* Каскад: одна причина — несколько задетых показателей. */}
      {metrics.length > 1 && (
        <div className="mt-2 flex flex-wrap items-center gap-1 text-[10px] text-zinc-500 dark:text-zinc-400">
          <span>Задевает показатели:</span>
          {metrics.map((m) => (
            <span key={m} className="rounded bg-zinc-100 dark:bg-zinc-700/50 px-1.5 py-0.5">
              {productLabel(m)}
            </span>
          ))}
        </div>
      )}

      {/* Путь до строки-виновницы: лист, номер строки, адрес ячейки, вклад. */}
      {cause.rows.length > 0 && (
        <table className="mt-2 w-full text-[11px]">
          <thead>
            <tr className="text-[10px] uppercase tracking-wide text-zinc-400">
              <th className="text-left font-medium">Лист</th>
              <th className="text-left font-medium">Строка</th>
              <th className="text-left font-medium">Ячейка</th>
              <th className="text-right font-medium">Вклад</th>
            </tr>
          </thead>
          <tbody className="text-zinc-600 dark:text-zinc-300">
            {rows.map((r) => (
              <tr key={`${r.sheet}:${r.cell}`} className="border-t border-zinc-100 dark:border-zinc-700/50">
                <td className="py-0.5">{r.sheet}</td>
                <td className="py-0.5 tabular-nums">{r.row}</td>
                <td className="py-0.5 font-mono tabular-nums">{r.cell}</td>
                <td className="py-0.5 text-right tabular-nums">{money(r.delta)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {hidden > 0 && (
        <button
          onClick={() => setOpen(true)}
          className="mt-1 flex items-center gap-1 text-[11px] text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-200"
        >
          <ChevronRight size={12} /> Показать ещё {hidden}
        </button>
      )}
      {open && cause.rows.length > previewRows && (
        <button
          onClick={() => setOpen(false)}
          className="mt-1 flex items-center gap-1 text-[11px] text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-200"
        >
          <ChevronDown size={12} /> Свернуть
        </button>
      )}

      {/* Сверка ведёт к действию, а не к констатации. */}
      <p className="mt-2 border-t border-zinc-100 dark:border-zinc-700/50 pt-2 text-[11px] text-zinc-500 dark:text-zinc-400">
        <span className="font-medium text-zinc-600 dark:text-zinc-300">Что делать: </span>
        {ROOT_CAUSE_ACTIONS[cause.class]}
      </p>
    </div>
  );
}

/** Список первопричин расхождения: дороже сверху (порядок задаёт groupCascades). */
export function RootCauseList({ groups }: { groups: RootCauseGroup[] }) {
  if (groups.length === 0) return null;
  return (
    <div className="space-y-2">
      {groups.map((g) => (
        <RootCauseCard key={g.cause.id} group={g} />
      ))}
    </div>
  );
}
