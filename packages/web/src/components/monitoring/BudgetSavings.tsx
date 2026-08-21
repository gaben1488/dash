/**
 * «Где деньги» — чей рубль сэкономлен (разрез витрины §2).
 *
 * ПОЧЕМУ ЭТО НЕ ОДНО ЧИСЛО «ЭКОНОМИЯ». Экономия в 116 миллионов ничего не
 * говорит распорядителю, пока не сказано, чей план она меняет: у местного,
 * краевого и федерального бюджетов разные хозяева и разные сроки возврата
 * неиспользованных денег. Разрез отвечает именно на этот вопрос.
 *
 * ЛОВУШКА ШАПКИ, из-за которой первая версия вкладки читала книгу неверно:
 * подпись «Экономия, руб.» стоит в L1 и служит надшапкой всей группы J:N.
 * Настоящие имена читаются во второй строке: J — ВСЕГО, K — контроль,
 * L/M/N — разбивка ЭКОНОМИИ по бюджетам. Колонка L это НЕ «начальная цена
 * местного бюджета», и карточка базы знаний говорит об этом прямым текстом.
 *
 * РАЗРЫВ НЕ СГЛАЖИВАЕТСЯ. «ВСЕГО» и сумма трёх бюджетов расходятся там, где
 * разбивка не заполнена. Показать одну сумму вместо двух значило бы решить
 * за читателя, какая из них верна, — а этого витрина не знает.
 *
 * ЦВЕТ БЮДЖЕТА БЕРЁТСЯ ИЗ СЛОВАРЯ РОЛЕЙ (`BUDGET_COLORS`), а не сырым кодом:
 * тот же местный бюджет должен быть того же тона на всех экранах продукта.
 */
import {
  Bar, BarChart, CartesianGrid, ResponsiveContainer,
  Tooltip as RechartsTooltip, XAxis, YAxis,
} from 'recharts';
import type { BudgetSavings as BudgetSavingsData } from '../../lib/monitoring/bi';
import { BI_KB, biKbProps } from '../../lib/monitoring/bi-kb';
import { fmtCount, fmtPct, fmtRub, pluralCount } from '../../lib/monitoring/format';
import {
  getAxisColor, getBudgetColor, getGridColor, getTooltipStyle, type BudgetKey,
} from '../../lib/chart-colors';
import { useTheme } from '../ThemeProvider';
import { KBTooltip } from '../ui/kb-tooltip';
import { AnalyticsCard, CardEmpty } from './AnalyticsCard';
import { RULE_ROW_TOP, TILE } from './surfaces';

export interface BudgetSavingsProps {
  budget: BudgetSavingsData;
  periodLabel: string;
  /** Клик по управлению — разрез реестра его листом (п.119). */
  onPickDept?: (dept: string) => void;
}

export function BudgetSavingsCard({ budget, periodLabel, onPickDept }: BudgetSavingsProps) {
  const isDark = useTheme((s) => s.theme) === 'dark';
  const tooltip = getTooltipStyle(isDark);

  const bars = budget.byDept
    .filter((d) => d.splitTotalRub !== 0)
    .map((d) => ({
      key: d.dept,
      label: d.dept,
      МБ: d.mbRub / 1_000_000,
      КБ: d.kbRub / 1_000_000,
      ФБ: d.fbRub / 1_000_000,
    }));

  const local = budget.levels.find((l) => l.key === 'mb');
  const title = local?.sharePct === null || local === undefined || budget.splitTotalRub === 0
    ? 'Экономия книги в разрезе бюджетов'
    : `${fmtPct(local.sharePct, 0)} расписанной экономии — деньги местного бюджета`;

  return (
    <AnalyticsCard
      kicker="Где деньги · бюджеты"
      title={title}
      periodLabel={periodLabel}
      method={(
        <>
          Складываются колонки «МБ», «КБ» и «ФБ» — это разбивка ЭКОНОМИИ, а не начальной цены. Доля
          бюджета считается от расписанной суммы, а не от «ВСЕГО»: иначе нерасписанный остаток молча
          размазался бы по трём бюджетам. Разрыв между «ВСЕГО» и суммой трёх показан отдельно.
        </>
      )}
    >
      {budget.bookTotalRub === 0 && budget.splitTotalRub === 0 ? (
        <CardEmpty>
          В этом срезе экономия нигде не записана: ни в «ВСЕГО», ни в разбивке по бюджетам. Это
          пустая книга на данном участке, а не нулевая экономия при состоявшихся торгах.
        </CardEmpty>
      ) : (
        <>
          {/* ── Три бюджета и разрыв ── */}
          <div className="grid gap-2 sm:grid-cols-4">
            {budget.levels.map((l) => (
              <KBTooltip key={l.key} {...biKbProps(BI_KB.budget_savings)} showIcon>
                <div className={`${TILE} p-3 text-left`}>
                  <p className="text-[10px] text-zinc-500 dark:text-zinc-400">
                    {l.short} — {l.label}
                  </p>
                  <p className="mt-0.5 text-lg font-semibold tabular-nums text-zinc-800 dark:text-zinc-100">
                    {fmtRub(l.rub)}
                  </p>
                  <p className="mt-1 text-[10px] tabular-nums text-zinc-500 dark:text-zinc-400">
                    руб. · {fmtPct(l.sharePct)} расписанной экономии
                  </p>
                </div>
              </KBTooltip>
            ))}

            <div className={`${TILE} p-3`}>
              <p className="text-[10px] text-zinc-500 dark:text-zinc-400">Без адреса бюджета</p>
              <p className={`mt-0.5 text-lg font-semibold tabular-nums ${
                Math.abs(budget.unallocatedRub) > 0.005
                  ? 'text-amber-700 dark:text-amber-400'
                  : 'text-zinc-800 dark:text-zinc-100'
              }`}
              >
                {fmtRub(budget.unallocatedRub)}
              </p>
              <p className="mt-1 text-[10px] leading-relaxed text-zinc-500 dark:text-zinc-400">
                руб. · «ВСЕГО» минус сумма трёх бюджетов
              </p>
            </div>
          </div>

          <p className="mt-2 text-[11px] leading-relaxed text-zinc-600 dark:text-zinc-300">
            Книга записала экономии {fmtRub(budget.bookTotalRub)} руб., расписала по бюджетам{' '}
            {fmtRub(budget.splitTotalRub)} руб.
            {Math.abs(budget.unallocatedRub) <= 0.005
              ? ' Разрыва нет: у каждого сэкономленного рубля назван бюджет.'
              : ` Разрыв в ${fmtRub(budget.unallocatedRub)} руб. бюджетного адреса не имеет — по нему нельзя сказать, чей план меняется. Это может быть и незаполненная разбивка, и опечатка в «ВСЕГО»: разобрать способна только строка книги.`}
          </p>

          {/* ── Разбивка по управлениям ── */}
          {bars.length === 0 ? (
            <CardEmpty>
              Ни у одного управления разбивка экономии по бюджетам не заполнена, поэтому столбцы
              строить не из чего. Экономия при этом в книге есть — она вся в разрыве выше.
            </CardEmpty>
          ) : (
            <div className="mt-3 h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={bars} margin={{ top: 8, right: 8, bottom: 24, left: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={getGridColor(isDark)} vertical={false} />
                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: 10, fill: getAxisColor(isDark) }}
                    interval={0}
                    height={28}
                  />
                  <YAxis
                    tick={{ fontSize: 10, fill: getAxisColor(isDark) }}
                    width={46}
                    label={{
                      value: 'экономия, млн ₽',
                      angle: -90, position: 'insideLeft',
                      style: { fontSize: 9, fill: getAxisColor(isDark) },
                    }}
                  />
                  <RechartsTooltip
                    {...tooltip}
                    formatter={(v: number, name: string) => [`${fmtRub(v * 1_000_000)} руб.`, name]}
                  />
                  {(['МБ', 'КБ', 'ФБ'] as BudgetKey[]).map((b, i) => (
                    <Bar
                      key={b}
                      dataKey={b}
                      stackId="budget"
                      name={b}
                      fill={getBudgetColor(b, isDark)}
                      radius={i === 2 ? [3, 3, 0, 0] : undefined}
                      cursor={onPickDept !== undefined ? 'pointer' : undefined}
                      onClick={(d: { key?: string }) => {
                        if (onPickDept !== undefined && typeof d.key === 'string') onPickDept(d.key);
                      }}
                    />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Легенда словами: три бюджета названы полностью, а не буквами. */}
          <p className="mt-1 text-[10px] text-zinc-500 dark:text-zinc-400">
            МБ — местный бюджет, КБ — краевой, ФБ — федеральный.
            {onPickDept !== undefined && ' Клик по столбу ставит реестру разрез листом этого управления.'}
          </p>

          {/* ── Строки, где разбивки нет либо контроль книги спорит ── */}
          {(budget.rowsWithoutSplit > 0 || budget.rowsControlError > 0) && (
            <details className={`${TILE} mt-3 px-3 py-2 text-[11px] text-zinc-600 dark:text-zinc-300`}>
              <summary className="cursor-pointer">
                Где именно экономия без адреса:{' '}
                {pluralCount(budget.rowsWithoutSplit, 'строка', 'строки', 'строк')} без разбивки и{' '}
                {pluralCount(budget.rowsControlError, 'строка', 'строки', 'строк')} со спором
                самопроверки книги
              </summary>

              {budget.rowsWithoutSplit > 0 && (
                <>
                  <h5 className="mt-2 font-medium text-zinc-700 dark:text-zinc-200">
                    Экономия записана, бюджет не назван
                  </h5>
                  <RefTable
                    refs={budget.rowsWithoutSplitRefs}
                    valueHead="Экономия ВСЕГО, руб."
                  />
                </>
              )}

              {budget.rowsControlError > 0 && (
                <>
                  <h5 className="mt-3 font-medium text-zinc-700 dark:text-zinc-200">
                    Самопроверка книги показывает «ошибка»
                  </h5>
                  <p className="mt-0.5 text-[10px] leading-relaxed text-zinc-500 dark:text-zinc-400">
                    Колонка «Проверка данных» сравнивает «ВСЕГО» с суммой трёх бюджетов. Ниже —
                    разрыв в рублях по каждой спорной строке.
                  </p>
                  <RefTable refs={budget.rowsControlErrorRefs} valueHead="Разрыв, руб." />
                </>
              )}
            </details>
          )}

          {/* Текстовый дубль столбцов. */}
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-[11px]">
              <caption className="sr-only">Экономия по бюджетам в разрезе управлений</caption>
              <thead>
                <tr className="text-left text-zinc-500 dark:text-zinc-400">
                  <th className="py-1 pr-2 font-normal">Управление</th>
                  <th className="py-1 pr-2 text-right font-normal">МБ, руб.</th>
                  <th className="py-1 pr-2 text-right font-normal">КБ, руб.</th>
                  <th className="py-1 pr-2 text-right font-normal">ФБ, руб.</th>
                  <th className="py-1 text-right font-normal">Расписано, руб.</th>
                </tr>
              </thead>
              <tbody className="text-zinc-700 dark:text-zinc-200">
                {budget.byDept.map((d) => (
                  <tr key={d.dept} className={RULE_ROW_TOP}>
                    <td className="py-1 pr-2">{d.dept}</td>
                    <td className="py-1 pr-2 text-right tabular-nums">{fmtRub(d.mbRub)}</td>
                    <td className="py-1 pr-2 text-right tabular-nums">{fmtRub(d.kbRub)}</td>
                    <td className="py-1 pr-2 text-right tabular-nums">{fmtRub(d.fbRub)}</td>
                    <td className="py-1 text-right tabular-nums">{fmtRub(d.splitTotalRub)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </AnalyticsCard>
  );
}

/** Адреса строк-оснований: лист, строка, код, заказчик и спорная сумма. */
function RefTable({
  refs, valueHead,
}: { refs: readonly { sheet: string; row: number; code: string | null; customer: string; rub: number | null }[]; valueHead: string }) {
  const shown = refs.slice(0, 20);
  return (
    <>
      <div className="mt-1 overflow-x-auto">
        <table className="w-full text-[11px]">
          <thead>
            <tr className="text-left text-zinc-500 dark:text-zinc-400">
              <th className="py-1 pr-2 font-normal">Адрес в книге</th>
              <th className="py-1 pr-2 font-normal">Код</th>
              <th className="py-1 pr-2 font-normal">Заказчик</th>
              <th className="py-1 text-right font-normal">{valueHead}</th>
            </tr>
          </thead>
          <tbody className="text-zinc-700 dark:text-zinc-200">
            {shown.map((r) => (
              <tr key={`${r.sheet}:${r.row}`} className={RULE_ROW_TOP}>
                <td className="py-1 pr-2 font-mono text-[10px]">{r.sheet}!{r.row}</td>
                <td className="py-1 pr-2 font-mono text-[10px]">{r.code ?? '—'}</td>
                <td className="py-1 pr-2">{r.customer}</td>
                <td className="py-1 text-right tabular-nums">{fmtRub(r.rub)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {refs.length > shown.length && (
        <p className="mt-1 text-[10px] text-zinc-500 dark:text-zinc-400">
          Показаны первые {fmtCount(shown.length)} адресов из {fmtCount(refs.length)}; остальные
          видны в реестре разрезом «только строки с находками».
        </p>
      )}
    </>
  );
}
