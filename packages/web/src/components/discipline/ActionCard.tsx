/**
 * Карточка одного дела на вкладке «Дисциплина».
 *
 * Тон — рабочий список, не тревога (бриф исхода 3): никаких алых ярлыков и
 * слова «ошибка»; критичность видна только цветом ДЕНЕГ эффекта. Карточка —
 * три части канона п.53: механизм простыми словами, счёт строк-виновниц,
 * действие; кнопка ведёт в Реестр с уже включённым фильтром признака.
 */
import { ExternalLink } from 'lucide-react';
import { productLabel } from '@aemr/shared';
import { pluralRu } from '../../lib/economy-copy';
import { moneyToneClass, type DisciplineAction } from './actions';

export interface ActionCardProps {
  action: DisciplineAction;
  /** Форматирование денег из store — единицы шапки (тыс/млн). */
  formatMoney: (v: number) => string;
  /** Открыть строки дела в Реестре; dept — сузить до одного управления. */
  onOpen: (dept?: string) => void;
  /** Показывать ли разбивку по управлениям (при выборе одного — нет). */
  showDeptShares: boolean;
}

export function ActionCard({ action, formatMoney, onOpen, showDeptShares }: ActionCardProps) {
  const { def, rows, money, byDept } = action;
  const headingId = `discipline-action-${def.signal}`;

  return (
    <article
      aria-labelledby={headingId}
      className="bg-white dark:bg-zinc-800/60 rounded-xl shadow-sm border border-zinc-100 dark:border-zinc-700/50 p-5"
    >
      <div className="flex items-start justify-between gap-6 flex-wrap">
        <div className="flex-1 min-w-[16rem]">
          {def.stage && (
            <span className="inline-block mb-1.5 px-2 py-0.5 rounded-full text-[10px] font-medium bg-blue-50 dark:bg-blue-950/30 text-blue-700 dark:text-blue-300">
              {def.stage}
            </span>
          )}
          <h3 id={headingId} className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">
            {def.title(rows)}
          </h3>
          <p className="text-xs leading-relaxed text-zinc-500 dark:text-zinc-400 mt-1.5">
            {def.mechanism}
          </p>
          <p className="text-xs leading-relaxed text-zinc-600 dark:text-zinc-300 mt-2">
            <span className="font-medium">Что сделать:</span> {def.action}
          </p>
        </div>

        <div className="text-right shrink-0">
          <p className={`text-xl font-semibold tabular-nums ${moneyToneClass(money)}`}>
            {money > 0 ? formatMoney(money) : '—'}
          </p>
          <p className="text-[11px] text-zinc-500 dark:text-zinc-400 max-w-[12rem]">
            {money > 0
              ? def.moneyLabel
              : 'сумм по этим строкам в книге нет'}
          </p>
        </div>
      </div>

      <div className="mt-4 pt-3 border-t border-zinc-100 dark:border-zinc-700/50 flex items-center gap-2 flex-wrap">
        {showDeptShares && byDept.length > 1 && (
          <ul className="flex items-center gap-1.5 flex-wrap list-none m-0 p-0" aria-label="Вклад управлений">
            {byDept.map((share) => (
              <li key={share.dept || 'нет'}>
                <button
                  type="button"
                  onClick={() => onOpen(share.dept || undefined)}
                  title={`${productLabel(share.dept) || 'Управление не указано'}: ${share.rows} ${pluralRu(share.rows, 'строка', 'строки', 'строк')}, ${formatMoney(share.money)}. Открыть в Реестре.`}
                  className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-zinc-100 dark:bg-zinc-700/60 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-600 transition"
                >
                  {productLabel(share.dept) || 'без управления'}
                  {' · '}
                  <span className="tabular-nums">{share.rows}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <button
          type="button"
          onClick={() => onOpen()}
          className="ml-auto inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-medium text-blue-700 dark:text-blue-300 rounded-lg border border-blue-200 dark:border-blue-800 hover:bg-blue-50 dark:hover:bg-blue-950/30 transition"
        >
          <ExternalLink size={11} aria-hidden="true" />
          Открыть {rows} {pluralRu(rows, 'строку', 'строки', 'строк')} в Реестре
        </button>
      </div>
    </article>
  );
}
