/**
 * «Где затык» — чем кончились переобъявления (разрез витрины §6).
 *
 * ЕДИНСТВЕННОЕ МЕСТО КНИГИ, ГДЕ ВИДНА ПРИЧИНА ПОВТОРНОГО КРУГА. Листы
 * управлений говорят, ЧТО стало с процедурой (цена, победитель, стадия), но
 * молчат, ПОЧЕМУ пришлось объявлять заново. Ответ лежит в первой колонке
 * переходящего реестра «25-26», куда специалисты пишут судьбу руками:
 * «Повторный аукцион», «С отклонением участника», «ФАС», «На доработке у
 * Заказчика».
 *
 * КЛАСС РЯДОМ С СЫРЫМ ТЕКСТОМ (п.27). Свободный текст статусом не становится:
 * ядро разбирает написания в закрытый словарь, но исходник показывается тут
 * же. Класс без исходника читатель не может ни проверить, ни оспорить — а
 * прочтение рукописной пометки оспаривать иногда есть за что.
 *
 * ЧИСЛО — НИЖНЯЯ ГРАНИЦА, И БЛОК ГОВОРИТ ЭТО ВСЛУХ. Пометка ставится рукой и
 * не обязательна: процедуру могли объявить заново, ничего не записав. Выдать
 * счёт помеченных за полный счёт переобъявлений значило бы соврать в меньшую
 * сторону — тем опаснее, что незаметно.
 *
 * КЛАССЫ НЕ СКЛАДЫВАЮТСЯ В «ОБЩЕЕ ЧИСЛО НЕУДАЧ»: жалоба в антимонопольную
 * службу и последовавший за ней повторный аукцион — один путь, записанный
 * двумя строками.
 */
import {
  Bar, BarChart, CartesianGrid, ResponsiveContainer,
  Tooltip as RechartsTooltip, XAxis, YAxis,
} from 'recharts';
import type { RejoinedFates as RejoinedFatesData } from '../../lib/monitoring/bi';
import { BI_KB, biKbProps } from '../../lib/monitoring/bi-kb';
import { fmtCount, fmtPct, pluralCount } from '../../lib/monitoring/format';
import {
  getAxisColor, getChartColor, getGridColor, getTooltipStyle,
} from '../../lib/chart-colors';
import { useTheme } from '../ThemeProvider';
import { KBTooltip } from '../ui/kb-tooltip';
import { AnalyticsCard, CardEmpty } from './AnalyticsCard';
import { RULE_ROW_TOP, TILE } from './surfaces';

export interface RejoinedFatesProps {
  fates: RejoinedFatesData;
  periodLabel: string;
  /** Лист «25-26» сервер не отдал — это не «пометок нет». */
  journalPending?: boolean;
  /** Клик по классу — открыть переходящий реестр с поиском по написанию. */
  onPickFate?: (sample: string) => void;
}

export function RejoinedFatesCard({
  fates, periodLabel, journalPending = false, onPickFate,
}: RejoinedFatesProps) {
  const isDark = useTheme((s) => s.theme) === 'dark';
  const tooltip = getTooltipStyle(isDark);

  const bars = fates.rows.map((r) => ({
    key: r.fate,
    label: r.label,
    count: r.count,
  }));

  const top = fates.rows[0];
  const title = journalPending
    ? 'Судьбы переобъявлений: переходящий реестр не прочитан'
    : fates.markedRows === 0
      ? 'В переходящем реестре нет ни одной пометки о судьбе процедуры'
      : top === undefined
        ? 'Судьбы переобъявлений'
        : `Чаще всего повторный круг начинается так: ${top.label.toLowerCase()} — ${pluralCount(top.count, 'случай', 'случая', 'случаев')}`;

  return (
    <AnalyticsCard
      kicker="Где затык · повторный круг"
      title={title}
      periodLabel={periodLabel}
      periodNote="переходящий реестр — районный лист, срез по управлению к нему не применяется"
      method={(
        <>
          Читается пометка из первой колонки листа «25-26» — её пишут руками. Написания разбираются в
          закрытый словарь классов, сырой текст показан рядом. Разделители годовых блоков судьбой не
          считаются. Число помеченных — нижняя граница: процедуру могли объявить заново, ничего не
          записав.
        </>
      )}
    >
      {journalPending ? (
        <CardEmpty>
          Лист «25-26» сервер пока не отдаёт, поэтому судьбы переобъявлений собрать не из чего. Это
          незаконченная труба чтения, а не «пометок в книге нет»: числа не потеряны, их просто ещё
          не читают.
        </CardEmpty>
      ) : fates.markedRows === 0 ? (
        <CardEmpty>
          Переходящий реестр прочитан ({fmtCount(fates.totalRows)} строк), но пометок о судьбе
          процедуры в первой колонке нет ни одной. Это пустота самой книги: причину повторного круга
          в ней сейчас не записывают.
        </CardEmpty>
      ) : (
        <>
          <div className="grid gap-2 sm:grid-cols-3">
            <KBTooltip {...biKbProps(BI_KB.rejoined_fates)} showIcon>
              <div className={`${TILE} p-3 text-left`}>
                <p className="text-[10px] text-zinc-500 dark:text-zinc-400">Строк с пометкой судьбы</p>
                <p className="mt-0.5 text-lg font-semibold tabular-nums text-zinc-800 dark:text-zinc-100">
                  {fmtCount(fates.markedRows)}
                </p>
                <p className="mt-1 text-[10px] tabular-nums text-zinc-500 dark:text-zinc-400">
                  из {fmtCount(fates.totalRows)} строк листа · {fmtPct(fates.markedSharePct)}
                </p>
              </div>
            </KBTooltip>

            <div className={`${TILE} p-3`}>
              <p className="text-[10px] text-zinc-500 dark:text-zinc-400">Разных причин</p>
              <p className="mt-0.5 text-lg font-semibold tabular-nums text-zinc-800 dark:text-zinc-100">
                {fmtCount(fates.rows.length)}
              </p>
              <p className="mt-1 text-[10px] leading-relaxed text-zinc-500 dark:text-zinc-400">
                классов словаря встретилось в книге
              </p>
            </div>

            <div className={`${TILE} p-3`}>
              <p className="text-[10px] text-zinc-500 dark:text-zinc-400">Это нижняя граница</p>
              <p className="mt-1 text-[10px] leading-relaxed text-zinc-600 dark:text-zinc-300">
                Пометка ставится рукой и не обязательна. Процедуру могли объявить заново, ничего не
                записав, — такой случай сюда не попадёт.
              </p>
            </div>
          </div>

          <div className="mt-3 h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={bars}
                layout="vertical"
                margin={{ top: 8, right: 20, bottom: 22, left: 8 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke={getGridColor(isDark)} horizontal={false} />
                <XAxis
                  type="number"
                  tick={{ fontSize: 10, fill: getAxisColor(isDark) }}
                  height={30}
                  allowDecimals={false}
                  label={{
                    value: 'строк переходящего реестра',
                    position: 'insideBottom', offset: -4,
                    style: { fontSize: 9, fill: getAxisColor(isDark) },
                  }}
                />
                <YAxis
                  type="category"
                  dataKey="label"
                  tick={{ fontSize: 9, fill: getAxisColor(isDark) }}
                  width={168}
                />
                <RechartsTooltip
                  {...tooltip}
                  formatter={(v: number) => [fmtCount(v), 'строк']}
                />
                <Bar dataKey="count" fill={getChartColor(1, isDark)} radius={[0, 3, 3, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Текстовый дубль с сырыми написаниями: класс без исходника не проверить. */}
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-[11px]">
              <caption className="sr-only">Судьбы процедур по пометкам переходящего реестра</caption>
              <thead>
                <tr className="text-left text-zinc-500 dark:text-zinc-400">
                  <th className="py-1 pr-2 font-normal">Причина повторного круга</th>
                  <th className="py-1 pr-2 text-right font-normal">Строк</th>
                  <th className="py-1 pr-2 text-right font-normal">Доля помеченных</th>
                  <th className="py-1 font-normal">Как записано в книге</th>
                </tr>
              </thead>
              <tbody className="text-zinc-700 dark:text-zinc-200">
                {fates.rows.map((r) => (
                  <tr key={r.fate} className={RULE_ROW_TOP}>
                    <td className="py-1 pr-2 font-medium">{r.label}</td>
                    <td className="py-1 pr-2 text-right tabular-nums">{fmtCount(r.count)}</td>
                    <td className="py-1 pr-2 text-right tabular-nums">{fmtPct(r.sharePct)}</td>
                    <td className="py-1 text-zinc-600 dark:text-zinc-300">
                      {r.samples.length === 0 ? '—' : r.samples.map((s, i) => (
                        <span key={s}>
                          {i > 0 && '; '}
                          {onPickFate === undefined ? `«${s}»` : (
                            <button
                              type="button"
                              onClick={() => onPickFate(s)}
                              className="underline decoration-dotted underline-offset-2 hover:text-zinc-900 dark:hover:text-white"
                            >
                              «{s}»
                            </button>
                          )}
                        </span>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="mt-2 text-[11px] leading-relaxed text-zinc-600 dark:text-zinc-300">
            Складывать классы в «общее число неудач» нельзя: жалоба в антимонопольную службу и
            последовавший за ней повторный аукцион — один путь, записанный двумя строками.
            {onPickFate !== undefined && ' Клик по написанию открывает переходящий реестр с поиском по нему — видно сами строки за числом.'}
          </p>
        </>
      )}
    </AnalyticsCard>
  );
}
