/**
 * Шесть чисел портрета реестра (спека §6.1) с раскрытием процента снижения до
 * трёх коэффициентов.
 *
 * У каждого числа — подсказка базы знаний (директива п.91): формула, источник
 * и подводные камни. У блока — плашка периода (п.58), и она называет не «год»
 * из шапки приложения, а то, что числа описывают на самом деле: показанный
 * срез книги на момент её чтения.
 *
 * ЧЕСТНЫЕ ПУСТОТЫ (п.36). Нет состоявшихся торгов — вместо «0 %» написано,
 * почему процента нет. Ноль в цене аукциона прочерком не рисуется никогда:
 * это содержательный исход, а не отсутствие данных.
 */
import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { KBTooltip } from '../ui/kb-tooltip';
import { MONITORING_KB_ADDITIONS, kbCardProps } from '../../pages/kb-additions';
import type { RegistryPortrait } from '../../lib/monitoring/portrait';
import { fmtCount, fmtPct, fmtRub, pluralCount } from '../../lib/monitoring/format';
import { BookPeriodBadge } from './BookPeriodBadge';

/** Одно число портрета: крупная цифра, подпись и подсказка БЗ. */
function Figure({
  kbKey, value, caption, tone = 'plain',
}: {
  kbKey: string;
  value: string;
  caption: string;
  tone?: 'plain' | 'good' | 'warn';
}) {
  const entry = MONITORING_KB_ADDITIONS[kbKey];
  const color = tone === 'good'
    ? 'text-emerald-700 dark:text-emerald-400'
    : tone === 'warn'
      ? 'text-amber-700 dark:text-amber-400'
      : 'text-zinc-800 dark:text-zinc-100';
  const body = (
    <div>
      <p className={`text-xl sm:text-2xl font-semibold tabular-nums ${color}`}>{value}</p>
      <p className="text-[11px] leading-tight text-zinc-500 dark:text-zinc-400">{caption}</p>
    </div>
  );
  // Карточки БЗ ещё нет — число всё равно показывается: дыра в объяснении не
  // повод прятать данные, она повод её закрыть.
  return entry ? <KBTooltip {...kbCardProps(entry)} showIcon>{body}</KBTooltip> : body;
}

export interface PortraitNumbersProps {
  portrait: RegistryPortrait;
  /** Что за срез описан: «весь реестр книги» либо «выбранные разрезы». */
  scopeLabel: string;
  /** Момент чтения книги словами — «прочитано 18.08.2026, 14:05». */
  readAtLabel: string;
}

export function PortraitNumbers({ portrait, scopeLabel, readAtLabel }: PortraitNumbersProps) {
  const [openCoefficients, setOpenCoefficients] = useState(false);
  const p = portrait;

  return (
    <section
      aria-label="Портрет реестра"
      className="bg-white dark:bg-zinc-800/60 rounded-xl shadow-sm border border-zinc-100 dark:border-zinc-700/50 p-4 sm:p-5"
    >
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">
          Портрет реестра · {scopeLabel}
        </h2>
        <BookPeriodBadge
          label={readAtLabel}
          note="числа за весь показанный срез книги; период в шапке приложения их не сужает"
        />
      </div>

      {/* Сетка два на три на телефоне (спека §6.3), в ряд — на большом экране. */}
      <div className="mt-4 grid grid-cols-2 gap-4 sm:gap-6 md:grid-cols-3 xl:grid-cols-6">
        <Figure
          kbKey="monitoring_procedures_total"
          value={fmtCount(p.total)}
          caption="процедур в реестре"
        />
        <Figure
          kbKey="monitoring_nmck_total"
          value={fmtRub(p.nmckTotal)}
          caption={p.nmckMissing > 0
            ? `НМЦК, руб. · у ${pluralCount(p.nmckMissing, 'строки', 'строк', 'строк')} сумма не читается числом`
            : 'НМЦК всех процедур, руб.'}
        />
        <Figure
          kbKey="monitoring_contract_price"
          value={fmtRub(p.priceTotal)}
          caption={`цена контрактов, руб. · по ${pluralCount(p.awardedCount, 'состоявшейся', 'состоявшимся', 'состоявшимся')}`}
        />
        <Figure
          kbKey="monitoring_auction_savings"
          value={fmtRub(p.savingsTotal)}
          caption="экономия на торгах, руб."
          tone={p.savingsTotal > 0 ? 'good' : 'plain'}
        />
        <Figure
          kbKey="monitoring_reduction_pct"
          value={fmtPct(p.portfolio.value)}
          caption={p.portfolio.value === null
            ? 'снижения нет: состоявшихся торгов в срезе нет'
            : 'снижение портфеля — один из трёх коэффициентов'}
        />
        <Figure
          kbKey="monitoring_no_result"
          value={fmtCount(p.noResultCount)}
          caption={p.noResultCount === 0
            ? 'процедур без результата нет'
            : `без результата · за ними ${fmtRub(p.noResultNmck)} руб. НМЦК`}
          tone={p.noResultCount > 0 ? 'warn' : 'plain'}
        />
      </div>

      {/* ── Три коэффициента снижения: раскрытие, а не сноска ── */}
      <button
        type="button"
        onClick={() => setOpenCoefficients((v) => !v)}
        aria-expanded={openCoefficients}
        className="mt-4 inline-flex items-center gap-1 text-[11px] font-medium text-zinc-600 dark:text-zinc-300 hover:underline"
      >
        <ChevronDown
          size={12}
          aria-hidden="true"
          className={openCoefficients ? 'rotate-180 transition' : 'transition'}
        />
        Почему «сколько мы обычно экономим» имеет три разных ответа
      </button>

      {openCoefficients && (
        <div className="mt-3 space-y-2 border-t border-zinc-100 dark:border-zinc-700/50 pt-3">
          <p className="text-[11px] leading-relaxed text-zinc-500 dark:text-zinc-400">
            Коэффициенты расходятся не от ошибки счёта, а потому, что у{' '}
            {pluralCount(p.noReductionCount, 'процедуры', 'процедур', 'процедур')} из{' '}
            {fmtCount(p.awardedCount)} состоявшихся цена в точности равна начальной — торги
            прошли без единого шага снижения. Отношение сумм такие процедуры разбавляет,
            среднее построчных — тянет к нулю, а среднее по снизившимся их не видит вовсе.
          </p>
          <dl className="grid gap-2 sm:grid-cols-3">
            {[
              {
                title: 'Портфельный',
                c: p.portfolio,
                what: 'на сколько подешевел весь портфель денег',
                how: 'разность сумм НМЦК и цен, делённая на сумму НМЦК состоявшихся',
              },
              {
                title: 'Среднее построчных',
                c: p.perRow,
                what: 'как ведёт себя типичная процедура, включая те, где снижения не было',
                how: 'среднее арифметическое процентов снижения по каждой состоявшейся строке',
              },
              {
                title: 'Среднее по снизившимся',
                c: p.whenReduced,
                what: 'насколько падает цена, когда торги реально идут',
                how: 'то же среднее, но только по строкам, где цена оказалась ниже начальной',
              },
            ].map((x) => (
              <div
                key={x.title}
                className="rounded-lg bg-zinc-50 dark:bg-zinc-900/40 px-3 py-2"
              >
                <dt className="text-[11px] font-medium text-zinc-600 dark:text-zinc-300">{x.title}</dt>
                <dd className="mt-0.5">
                  <span className="text-base font-semibold tabular-nums text-zinc-800 dark:text-zinc-100">
                    {fmtPct(x.c.value)}
                  </span>
                  {x.c.median !== null && (
                    <span className="ml-1.5 text-[11px] tabular-nums text-zinc-500 dark:text-zinc-400">
                      медиана {fmtPct(x.c.median)}
                    </span>
                  )}
                  <p className="mt-1 text-[10px] leading-tight text-zinc-500 dark:text-zinc-400">
                    {x.what}. Считается: {x.how}. В знаменателе —{' '}
                    {pluralCount(x.c.base, 'процедура', 'процедуры', 'процедур')}.
                  </p>
                </dd>
              </div>
            ))}
          </dl>
        </div>
      )}
    </section>
  );
}
