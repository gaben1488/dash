/**
 * Таблица оценки управлений (маяк, Г-06 — «самый управленческий ответ во всём
 * API»): грейд A–D, индекс дисциплины 0–100, что тянет индекс вниз и до трёх
 * признаков, на которые стоит посмотреть.
 *
 * ДВА РОДА СТРОК. Оценённое управление показывает числа. Управление, у которого
 * нет счётной базы (плана за период нет вовсе), чисел НЕ показывает: вместо них
 * идёт причина во всю ширину. Ноль или грейд D на этом месте означали бы
 * «работает плохо» там, где на самом деле «оценивать не из чего» — ровно эту
 * подмену закрыла волна 0 (лист в такой ячейке печатает прочерк).
 *
 * ПОЧЕМУ ГРЕЙД И ИНДЕКС СТОЯТ РЯДОМ. Буква отвечает за исполнение и потому
 * груба; индекс складывает шесть долей и объясняет, чем именно буква вызвана.
 * Порознь они спорят: буква B при индексе 48 без объяснения читается как
 * ошибка продукта.
 */
import { Minus } from 'lucide-react';
import clsx from 'clsx';
import { KBTooltip } from '../ui/kb-tooltip';
import {
  FACTOR_LABEL,
  GRADE_MEANING,
  GRADE_STYLE,
  INDICATOR_LABEL,
  MODE_LABEL,
  ROLE_LABEL,
  fmtShare,
  isGraded,
  type ScorecardGraded,
  type ScorecardRow,
} from './contract';

/** Полоса индекса: длина — данные, цвет — порог. Число рядом обязательно. */
function DisciplineBar({ index }: { index: number }) {
  const tone =
    index >= 75
      ? 'bg-emerald-500 dark:bg-emerald-400'
      : index >= 50
        ? 'bg-amber-500 dark:bg-amber-400'
        : 'bg-red-500 dark:bg-red-400';
  return (
    <span className="inline-flex items-center gap-2 justify-end w-full">
      <span className="tabular-nums font-medium text-zinc-800 dark:text-zinc-100">{index}</span>
      <span
        aria-hidden="true"
        className="hidden sm:block h-1.5 w-14 rounded-full bg-zinc-200 dark:bg-zinc-700 overflow-hidden shrink-0"
      >
        <span className={clsx('block h-full rounded-full', tone)} style={{ width: `${index}%` }} />
      </span>
    </span>
  );
}

/** Признаки, на которые стоит посмотреть. Ноль признаков — прочерк, не «0». */
function FlagsCell({ entry }: { entry: ScorecardGraded }) {
  const { topFlags, anticorruptionFlags } = entry;
  if (topFlags.length === 0) {
    return (
      <span className="inline-flex items-center gap-1.5 text-zinc-400 dark:text-zinc-500">
        <Minus size={13} aria-hidden="true" />
        не нашлось
      </span>
    );
  }
  const hidden = anticorruptionFlags - topFlags.length;
  return (
    <span className="flex flex-wrap gap-1">
      {topFlags.map((flag, i) => (
        <span
          key={`${flag.indicator}-${flag.rowIndex ?? i}`}
          title={flag.message}
          className={clsx(
            'text-[10px] px-1.5 py-0.5 rounded-full font-medium',
            flag.severity === 'high'
              ? 'bg-red-100 dark:bg-red-950/40 text-red-700 dark:text-red-300'
              : flag.severity === 'medium'
                ? 'bg-amber-100 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300'
                : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300',
          )}
        >
          {INDICATOR_LABEL[flag.indicator]}
        </span>
      ))}
      {hidden > 0 && (
        <span className="text-[10px] px-1.5 py-0.5 text-zinc-500 dark:text-zinc-400">
          и ещё {hidden}
        </span>
      )}
    </span>
  );
}

export function ScorecardTable({ rows }: { rows: readonly ScorecardRow[] }) {
  return (
    <div className="bg-white dark:bg-zinc-800/60 rounded-xl shadow-sm border border-zinc-100 dark:border-zinc-700/50 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <caption className="sr-only">
            Оценка управлений: грейд за исполнение, индекс дисциплины, что тянет индекс
            вниз, исполнение первого квартала, доля единственного поставщика и признаки,
            на которые стоит посмотреть. Порядок — по индексу возрастанием.
          </caption>
          <thead>
            <tr className="bg-zinc-50 dark:bg-zinc-900/50 text-left text-xs font-medium text-zinc-500 dark:text-zinc-400">
              <th scope="col" className="px-4 py-2.5">Управление</th>
              <th scope="col" className="px-3 py-2.5 text-center" title="Оценка исполнения закупок: A — по ожиданию и выше, D — отставание вместе с нарушениями">
                Грейд
              </th>
              <th scope="col" className="px-3 py-2.5 text-right" title="Взвешенная сумма шести долей: исполнение, динамика, доля ЕП, качество данных, аномалии, нормы закона">
                Индекс
              </th>
              <th scope="col" className="px-3 py-2.5">Что тянет вниз</th>
              <th scope="col" className="px-3 py-2.5 text-right" title="Факт к плану первого квартала — не выбранного в шапке периода">
                Исполнение 1 кв
              </th>
              <th scope="col" className="px-3 py-2.5 text-right" title="Доля единственного поставщика в плановых деньгах года">
                Доля ЕП, деньги
              </th>
              <th scope="col" className="px-4 py-2.5">На что посмотреть</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-700/50">
            {rows.map((row) => {
              const entry = row.entry;
              const graded = isGraded(entry);
              return (
                <tr
                  key={row.grbsId}
                  className={clsx(
                    'transition',
                    graded
                      ? 'hover:bg-zinc-50 dark:hover:bg-zinc-700/30'
                      : 'bg-zinc-50/60 dark:bg-zinc-900/30',
                  )}
                >
                  <th
                    scope="row"
                    className="px-4 py-2.5 text-left font-medium text-zinc-700 dark:text-zinc-200 whitespace-nowrap"
                  >
                    {entry.grbsShort}
                    <span className="block text-[10px] font-normal text-zinc-400 dark:text-zinc-500">
                      {ROLE_LABEL[entry.role]}
                    </span>
                  </th>
                  {isGraded(entry) ? (
                    <>
                      <td className="px-3 py-2.5 text-center">
                        <span
                          title={`${GRADE_MEANING[entry.grade]} Баллов: ${entry.gradeScore} из 100.`}
                          className={clsx(
                            'inline-block min-w-6 px-1.5 py-0.5 rounded-md text-xs font-bold',
                            GRADE_STYLE[entry.grade],
                          )}
                        >
                          {entry.grade}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <DisciplineBar index={entry.discipline} />
                      </td>
                      <td className="px-3 py-2.5 text-xs text-zinc-600 dark:text-zinc-300">
                        <span title={entry.narrative}>
                          {FACTOR_LABEL[entry.dominantFactor]}
                          <span className="block text-[10px] text-zinc-400 dark:text-zinc-500">
                            {MODE_LABEL[entry.mode]}
                          </span>
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-zinc-600 dark:text-zinc-300">
                        {fmtShare(entry.execPct)}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-zinc-600 dark:text-zinc-300">
                        {fmtShare(entry.epShare)}
                      </td>
                      <td className="px-4 py-2.5 text-xs">
                        <FlagsCell entry={entry} />
                      </td>
                    </>
                  ) : (
                    // Чисел нет вовсе: грейд без счётной базы — выдумка, а не
                    // строгость. Причина сервера идёт во всю ширину строки.
                    <td colSpan={6} className="px-3 py-2.5 text-xs text-zinc-500 dark:text-zinc-400">
                      {entry.noDataReason}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="px-4 py-2.5 text-[11px] text-zinc-500 dark:text-zinc-400 border-t border-zinc-100 dark:border-zinc-700/50">
        Порядок строк — по индексу дисциплины возрастанием: наверху то управление,
        которому внимание нужнее.{' '}
        <KBTooltip
          whatIs="Столбец «На что посмотреть» показывает до трёх признаков из шести, которые ищет проверка: дробление закупок, торги без снижения цены, цена выше типичной, ЕП свыше разового лимита, годовая доля ЕП, концентрация на одном поставщике."
          pitfalls="Признак — повод посмотреть строку, а не доказанное нарушение. Каждый признак несёт свой текст: наведите на плашку."
          showIcon
        >
          <span className="underline decoration-dotted underline-offset-2">
            Что значат признаки
          </span>
        </KBTooltip>
      </p>
    </div>
  );
}
