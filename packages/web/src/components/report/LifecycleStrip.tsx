/**
 * Этапность закупок ГРБС — то, что лист знает, а продукт не показывал.
 *
 * Две полосы состава по одним и тем же строкам года: вид деятельности
 * (текущая / программные мероприятия) и стадия жизненного цикла
 * (заключено / в работе / плановая дата прошла / без подтверждённого
 * финансирования / без плановых денег). Стадия «без подтверждённого
 * финансирования» — строки, вынесенные из счёта года (консолидация 07.08).
 *
 * Полоса всегда продублирована числами (канон «текстовый дубль
 * визуального»): доля читается и в чёрно-белой печати. Каждая доля несёт
 * подпись из канон-словаря и попап БЗ с живой подстановкой — сколько
 * строк, на какие плановые деньги и по какому признаку колонки листа.
 */
import type { LifecycleBucket } from '@aemr/core';
import { productLabel } from '@aemr/shared';
import { fmtCount } from '../../lib/report/mappers';
import { KbHover } from '../contract/KbHover';

/** Цвет доли: смысл, а не радуга (заключено — спокойный, просрочка — тревога). */
const TONE: Record<string, { bar: string; text: string }> = {
  lifecycle_type_current: { bar: 'bg-blue-400', text: 'text-blue-700 dark:text-blue-400' },
  lifecycle_type_program: { bar: 'bg-violet-400', text: 'text-violet-700 dark:text-violet-400' },
  lifecycle_type_other: { bar: 'bg-zinc-400', text: 'text-zinc-600 dark:text-zinc-400' },
  lifecycle_type_unknown: { bar: 'bg-zinc-300', text: 'text-zinc-500 dark:text-zinc-400' },
  lifecycle_stage_concluded: { bar: 'bg-emerald-500', text: 'text-emerald-700 dark:text-emerald-400' },
  lifecycle_stage_in_work: { bar: 'bg-blue-400', text: 'text-blue-700 dark:text-blue-400' },
  lifecycle_stage_overdue: { bar: 'bg-amber-500', text: 'text-amber-700 dark:text-amber-400' },
  lifecycle_stage_no_funding: { bar: 'bg-violet-500', text: 'text-violet-700 dark:text-violet-400' },
  lifecycle_stage_unfunded: { bar: 'bg-zinc-400', text: 'text-zinc-600 dark:text-zinc-400' },
};

/** Признак строки листа, по которому доля собрана — для блока «Сейчас». */
const RULE: Record<string, string> = {
  lifecycle_type_current: 'Колонка F листа = «Текущая деятельность».',
  lifecycle_type_program: 'Колонка F листа = «Программное мероприятие».',
  lifecycle_type_other: 'Колонка F листа заполнена иным значением.',
  lifecycle_type_unknown: 'Колонка F листа пуста — вид деятельности не указан.',
  lifecycle_stage_concluded: 'Заполнена дата заключения (колонка Q) не позже среза.',
  lifecycle_stage_in_work: 'Даты заключения нет, плановая дата (N) ещё не прошла.',
  lifecycle_stage_overdue: 'Даты заключения нет, а плановая дата (N) уже прошла.',
  lifecycle_stage_no_funding:
    'Способ и плановые деньги есть, а года плана (P) нет — финансирование не подтверждено. ' +
    'В счёт года и в лимиты не входит (как и в формулы листа СВОД); состав — в секции внизу отчёта.',
  lifecycle_stage_unfunded: 'Плановые суммы (H–K) нулевые: позиция без денег.',
};

function Strip({ title, buckets }: { title: string; buckets: LifecycleBucket[] }) {
  const total = buckets.reduce((s, b) => s + b.count, 0);
  if (total === 0) return null;
  return (
    <div>
      <div className="mb-1 text-[10px] uppercase tracking-wide text-zinc-400 dark:text-zinc-500">{title}</div>
      <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800" aria-hidden="true">
        {buckets.map((b) => (
          <span
            key={b.metricKey}
            className={`block h-full ${TONE[b.metricKey]?.bar ?? 'bg-zinc-400'}`}
            style={{ width: `${(b.count / total) * 100}%` }}
          />
        ))}
      </div>
      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] tabular-nums">
        {buckets.map((b) => (
          <KbHover
            key={b.metricKey}
            metricKey={b.metricKey}
            live={
              `${fmtCount(b.count)} из ${fmtCount(total)} позиций (${Math.round((b.count / total) * 100)} %), ` +
              `плановые деньги ${fmtCount(b.planTotal)} тыс. руб.\n${RULE[b.metricKey] ?? ''}`
            }
          >
            <span className="whitespace-nowrap">
              <span className={`font-medium ${TONE[b.metricKey]?.text ?? ''}`}>{productLabel(b.metricKey)}</span>
              {' '}{fmtCount(b.count)}
            </span>
          </KbHover>
        ))}
      </div>
    </div>
  );
}

export function LifecycleStrip({
  byType, byStage, year,
}: { byType: LifecycleBucket[]; byStage: LifecycleBucket[]; year: number }) {
  if (byType.length === 0 && byStage.length === 0) return null;
  return (
    <div className="space-y-2 rounded-lg border border-zinc-200/70 px-3 py-2.5 dark:border-zinc-700/60">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[11px] font-semibold text-zinc-600 dark:text-zinc-300">Этапность закупок</span>
        <span className="text-[10px] text-zinc-400 dark:text-zinc-500">все строки плана {year} года</span>
      </div>
      <Strip title="Вид деятельности" buckets={byType} />
      <Strip title="Стадия" buckets={byStage} />
    </div>
  );
}
