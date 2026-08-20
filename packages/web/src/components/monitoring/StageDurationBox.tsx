/**
 * Сроки этапов пути: публикация → торги → итог, медиана и разброс, самые
 * долгие процедуры с адресами (спека §3.4).
 *
 * МЕДИАНА, А НЕ СРЕДНЕЕ. Одна процедура с датой, набранной с опечаткой,
 * сдвигает среднее на месяцы; медиана к таким выбросам равнодушна. Среднее
 * всё равно показано рядом — расхождение медианы и среднего само по себе
 * сигнал: оно означает длинный хвост.
 *
 * ОТРИЦАТЕЛЬНАЯ ДЛИТЕЛЬНОСТЬ НЕ ПРЯЧЕТСЯ. Торги раньше публикации — не
 * ошибка расчёта, а находка: в книге такие строки есть. Шкала намеренно
 * начинается не позже нуля, ящик заезжает левее, и каждая такая строка
 * уезжает в список выбросов с адресом.
 *
 * ЯЩИК С УСАМИ ВРУЧНУЮ, БЕЗ БИБЛИОТЕКИ. Четыре полосы по общей шкале дней
 * читаются точнее любого графика: этапы сравниваются между собой, а не
 * каждый в своём масштабе.
 */
import type { DurationStats } from '../../lib/monitoring/analytics-contract';
import { durationBoxes } from '../../lib/monitoring/charts';
import { fmtCount, fmtDays, pluralCount } from '../../lib/monitoring/format';
import { AnalyticsCard, CardEmpty } from './AnalyticsCard';

export interface StageDurationBoxProps {
  durations: DurationStats[];
  periodLabel: string;
}

export function StageDurationBox({ durations, periodLabel }: StageDurationBoxProps) {
  const { boxes, scale } = durationBoxes(durations);
  const total = boxes.find((b) => b.key === 'total');
  const negatives = boxes.reduce((s, b) => s + b.negativeCount, 0);

  const title = total?.medianDays == null
    ? 'Сроки этапов пути процедуры'
    : `Половина процедур проходит путь «заявка → торги» быстрее ${fmtDays(total.medianDays)}`;

  return (
    <AnalyticsCard
      kicker="Сроки этапов"
      title={title}
      periodLabel={periodLabel}
      periodNote={negatives > 0
        ? `у ${fmtCount(negatives)} строк длительность этапа отрицательна — даты набраны с ошибкой`
        : undefined}
      method={(
        <>
          Длительность — календарные дни между двумя датами книги. Строка участвует в этапе, только
          если обе даты заполнены. Ящик показывает середину распределения (от первой до третьей
          четверти), риска внутри — медиану, подпись рядом — крайние значения.
        </>
      )}
    >
      {scale === null ? (
        <CardEmpty>
          Ни у одного этапа нет пары заполненных дат, поэтому сроки считать не из чего. Это
          пустота дат в книге, а не мгновенное прохождение пути.
        </CardEmpty>
      ) : (
        <>
          <ul className="space-y-3">
            {boxes.map((b) => (
              <li key={b.key}>
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 text-[11px]">
                  <span className="text-zinc-600 dark:text-zinc-300">{b.label}</span>
                  <span className="tabular-nums text-zinc-500 dark:text-zinc-400">
                    медиана {fmtDays(b.medianDays)} · среднее {fmtDays(b.meanDays)} ·{' '}
                    {pluralCount(b.count, 'процедура', 'процедуры', 'процедур')}
                  </span>
                </div>
                <div className="relative mt-1 h-5 rounded bg-zinc-100 dark:bg-zinc-700/40">
                  {/* Отметка нуля: без неё отрицательный хвост не читается. */}
                  <div
                    className="absolute inset-y-0 w-px bg-zinc-300 dark:bg-zinc-600"
                    style={{
                      left: `${((0 - scale.minDays) / Math.max(scale.maxDays - scale.minDays, 1)) * 100}%`,
                    }}
                    role="presentation"
                  />
                  {b.box === null ? (
                    <span className="absolute inset-0 flex items-center justify-center text-[10px] text-zinc-500 dark:text-zinc-400">
                      четвертей у этого этапа нет — строк слишком мало
                    </span>
                  ) : (
                    <>
                      <div
                        className="absolute inset-y-1 rounded bg-zinc-400/60 dark:bg-zinc-400/40"
                        style={{ left: `${b.box.leftPct}%`, width: `${b.box.widthPct}%` }}
                        role="presentation"
                      />
                      <div
                        className="absolute inset-y-0 w-0.5 bg-zinc-700 dark:bg-zinc-200"
                        style={{ left: `${b.box.medianPct}%` }}
                        role="presentation"
                      />
                    </>
                  )}
                </div>
                <p className="mt-0.5 text-[10px] tabular-nums text-zinc-500 dark:text-zinc-400">
                  крайние значения: от {fmtDays(b.minDays)} до {fmtDays(b.maxDays)}
                  {b.negativeCount > 0 && (
                    <span className="text-amber-700 dark:text-amber-400">
                      {' '}· отрицательных: {fmtCount(b.negativeCount)}
                    </span>
                  )}
                </p>
              </li>
            ))}
          </ul>

          {/* ── Самые долгие и невозможные: адрес обязателен (п.53) ── */}
          <h4 className="mt-4 text-[11px] font-medium text-zinc-700 dark:text-zinc-200">
            Выбивающиеся из ряда процедуры
          </h4>
          <p className="mt-0.5 text-[10px] leading-relaxed text-zinc-500 dark:text-zinc-400">
            Сюда попадают строки с отрицательной длительностью (торги раньше публикации — значит,
            дата набрана неверно) и строки длиннее полутора межчетвертных размахов от третьей
            четверти. Долгий срок сам по себе не нарушение: закупка могла ждать согласования.
          </p>
          <ul className="mt-1.5 space-y-1">
            {boxes.flatMap((b) => b.outliers.slice(0, 6).map((o) => (
              <li
                key={`${b.key}:${o.sheet}:${o.row}`}
                className="text-[10px] leading-relaxed text-zinc-600 dark:text-zinc-300"
              >
                <span className="font-mono text-zinc-500 dark:text-zinc-400">
                  {o.sheet} · строка {o.row}
                  {o.code !== null && ` · ${o.code}`}
                </span>{' '}
                — {b.label.toLowerCase()}: {fmtDays(o.days)}
                {o.reason === 'negative' && ' (дата торгов раньше предыдущей — набор дат в книге)'}
              </li>
            )))}
            {boxes.every((b) => b.outliers.length === 0) && (
              <li className="text-[10px] text-zinc-500 dark:text-zinc-400">
                Выбивающихся строк нет: все длительности лежат в обычном разбросе.
              </li>
            )}
          </ul>
        </>
      )}
    </AnalyticsCard>
  );
}
