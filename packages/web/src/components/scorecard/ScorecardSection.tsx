/**
 * Вкладка «Контроль → Оценка управлений» (маяк продукта, Г-06 и Г-09).
 *
 * ПОЧЕМУ ЭТОТ ЭКРАН ПОЯВИЛСЯ. Два маршрута аналитики отвечали с первого дня и
 * ни разу не были вызваны интерфейсом: `/api/analytics/scorecard` — грейд,
 * индекс дисциплины и признаки по каждому ГРБС, `/api/analytics/compliance` —
 * нарушения норм 44-ФЗ. Считалось, показывалось никому.
 *
 * ПОЧЕМУ ИМЕННО НА «КОНТРОЛЕ». Вкладка уже отвечает на вопрос «что не так с
 * данными и с исполнением»: сверка ловит расхождение с листом, качество
 * заполнения — небрежность в книгах, замечания — построчные дефекты. Оценка
 * управления — тот же вопрос ярусом выше: не «какая строка неверна», а «у кого
 * из восьми управлений отклонение от ожидания больше прочих». Держать её на
 * «Пульте» значило бы поставить буквенную оценку рядом с деньгами района, где
 * она читалась бы как приговор.
 *
 * ЧЕТЫРЕ ОБЕЩАНИЯ ЭКРАНА:
 *   1. ориентир назван неподтверждённым до того, как читатель увидит буквы;
 *   2. периметр подписан свой — 1 кв по исполнению, год по доле ЕП, фильтры
 *      шапки на эти числа не действуют (канон п.58);
 *   3. управление без счётной базы получает причину, а не грейд D;
 *   4. нарушение закона предъявляется карточкой диагноста — механизм, адрес
 *      «лист · строка · ячейка», действие с адресатом (канон п.53), а не
 *      простынёй «строка N».
 */
import { useMemo } from 'react';
import { AlertTriangle, Clock, RotateCcw, Scale } from 'lucide-react';
import { useStore } from '../../store';
import { deptScopeOf, filterByDeptScope } from '../../lib/selectors/dept-isolation';
import { DiagnosticCardList } from '../DiagnosticCards';
import { EmptyState } from '../EmptyState';
import { SkeletonCard } from '../Skeleton';
import { KBTooltip } from '../ui/kb-tooltip';
import { ScorecardTable } from './ScorecardTable';
import {
  BASELINE_CAVEAT,
  PERIMETER_CAVEAT,
  SCORECARD_KB,
  fmtMoment,
  isGraded,
  sortScorecard,
  toDiagnosticIssues,
} from './contract';
import { useScorecard } from './useScorecard';

/** Плашка периода данных секции: момент чтения плюс честная оговорка. */
function ScorecardPeriodBadge({ readAt }: { readAt: string }) {
  return (
    <div className="flex flex-col items-end gap-1 shrink-0">
      <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-zinc-100 dark:bg-zinc-800 text-[10px] font-medium text-zinc-600 dark:text-zinc-300">
        <Clock size={10} aria-hidden="true" />
        <span className="tabular-nums">ответ получен {fmtMoment(readAt)}</span>
      </div>
      <span
        className="text-[9px] leading-tight text-amber-700 dark:text-amber-400 text-right max-w-[15rem]"
        title="Маршруты оценки не принимают ни года, ни квартала: они считают по всему снимку книг. Выбранное в шапке управление сужает показ (канон п.127)."
      >
        {PERIMETER_CAVEAT}
      </span>
    </div>
  );
}

/** Отказ маршрута: причина по-русски и кнопка повтора, без пустого места. */
function FailurePlate({
  message,
  hasStale,
  onRetry,
}: {
  message: string;
  hasStale: boolean;
  onRetry: () => void;
}) {
  return (
    <div className="flex items-start gap-2 text-xs bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-xl px-4 py-3">
      <AlertTriangle size={14} className="text-amber-600 dark:text-amber-400 mt-px shrink-0" aria-hidden="true" />
      <div className="text-amber-800 dark:text-amber-300">
        <p>
          {message}
          {hasStale && ' Ниже — числа предыдущего чтения; момент указан в плашке.'}
        </p>
        <button
          type="button"
          onClick={onRetry}
          className="mt-1.5 inline-flex items-center gap-1 font-medium hover:underline"
        >
          <RotateCcw size={11} aria-hidden="true" /> Прочитать ещё раз
        </button>
      </div>
    </div>
  );
}

export function ScorecardSection() {
  const { data, loading, error, reload } = useScorecard();

  // Изоляция по управлению (канон п.127): выбранное в шапке управление сужает
  // и таблицу оценок, и карточки норм закона — чужие грейды и чужие строки
  // в срез не попадают. Периметр ПЕРИОДА у секции по-прежнему свой (п.58б):
  // маршруты считают 1 кв и год, выбор квартала в шапке на числа не влияет.
  const selectedDepartments = useStore((s) => s.selectedDepartments);
  const deptScope = useMemo(() => deptScopeOf(selectedDepartments), [selectedDepartments]);

  const allRows = data ? sortScorecard(data.scorecard) : [];
  const rows = filterByDeptScope(allRows, deptScope, (r) => r.grbsId);
  const graded = rows.filter((r) => isGraded(r.entry)).length;
  const complianceIssues = filterByDeptScope(
    data?.compliance?.issues ?? [], deptScope, (i) => i.grbsId,
  );
  const complianceCritical = complianceIssues.filter((i) => i.severity === 'critical').length;

  return (
    <div className="space-y-6">
      <section aria-label="Оценка управлений" className="space-y-4">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <KBTooltip {...SCORECARD_KB} showIcon>
              <h2 className="text-base font-semibold text-zinc-800 dark:text-zinc-100">
                Оценка управлений
              </h2>
            </KBTooltip>
            <p className="text-sm text-zinc-500 dark:text-zinc-400 max-w-2xl mt-0.5">
              Грейд за исполнение, индекс дисциплины и признаки, на которые стоит
              посмотреть, — по каждому из восьми управлений. Это отклонение от ожидания,
              а не оценка законности: буква ставится сравнением с внутренним ориентиром,
              и ориентир этот документом не подтверждён.
            </p>
          </div>
          {data && <ScorecardPeriodBadge readAt={data.readAt} />}
        </div>

        {/* Оговорка стоит ДО чисел: прочитанная после букв, она уже не работает. */}
        <p className="text-xs leading-relaxed text-zinc-600 dark:text-zinc-300 bg-zinc-50 dark:bg-zinc-900/40 border border-zinc-200 dark:border-zinc-700/60 rounded-xl px-4 py-3">
          {BASELINE_CAVEAT}
        </p>

        {error && <FailurePlate message={`Оценка не прочитана: ${error}`} hasStale={data !== null} onRetry={reload} />}

        {loading && !data ? (
          <div role="status" aria-live="polite">
            <span className="sr-only">Считаем грейд и индекс дисциплины по книгам управлений</span>
            <SkeletonCard />
          </div>
        ) : !data ? (
          !error && (
            <EmptyState
              tone="problem"
              title="Оценка управлений не посчитана"
              description="Сервер не отдал ни одного управления: без пересчёта плана-факта грейд ставить не из чего."
              action={{ label: 'Прочитать ещё раз', onClick: reload }}
            />
          )
        ) : rows.length === 0 ? (
          deptScope !== null && allRows.length > 0 ? (
            <EmptyState
              title="По выбранным управлениям оценки нет"
              description={
                'Оценённые управления есть, но все они — вне выбранного в шапке среза. ' +
                'Снимите отбор управления, чтобы увидеть таблицу целиком.'
              }
            />
          ) : (
            <EmptyState
              tone="problem"
              title="Ни одно управление не оценено"
              description={
                'Оценка строится на пересчёте плана-факта по книгам. Сейчас пересчёта нет ' +
                'ни по одной книге, поэтому вместо букв — эта причина: грейд без счётной ' +
                'базы был бы выдуман.'
              }
              action={{ label: 'Прочитать ещё раз', onClick: reload }}
            />
          )
        ) : (
          <>
            {graded === 0 && (
              <EmptyState
                tone="problem"
                title="Счётной базы нет ни у одного управления"
                description={
                  'Управления в таблице ниже названы, но чисел у них нет: плана за период ' +
                  'не нашлось. «Нет плана» — это не «исполнение ноль», и грейд D здесь был ' +
                  'бы неправдой.'
                }
              />
            )}
            <ScorecardTable rows={rows} />
          </>
        )}
      </section>

      <section aria-label="Нормы закона о закупках" className="space-y-3">
        <div>
          <h2 className="text-base font-semibold text-zinc-800 dark:text-zinc-100 flex items-center gap-2">
            <Scale size={16} className="text-zinc-400 dark:text-zinc-500" aria-hidden="true" />
            Нормы закона о закупках
          </h2>
          <p className="text-sm text-zinc-500 dark:text-zinc-400 max-w-2xl mt-0.5">
            Что нашли проверки статей 93 и 37 в строках книг. Одна карточка — один
            механизм: сначала объяснение, затем адреса строк, затем действие. Признак —
            повод посмотреть строку, а не доказанное нарушение.
          </p>
        </div>

        {data?.complianceError && (
          <FailurePlate
            message={`Нарушения норм закона не прочитаны: ${data.complianceError} Оценка выше от этого не зависит.`}
            hasStale={false}
            onRetry={reload}
          />
        )}

        {loading && !data ? (
          <div role="status" aria-live="polite">
            <span className="sr-only">Проверяем строки книг по нормам закона</span>
            <SkeletonCard />
          </div>
        ) : data && !data.complianceError && complianceIssues.length === 0 ? (
          deptScope !== null && (data.compliance?.issues.length ?? 0) > 0 ? (
            <EmptyState
              tone="neutral"
              title="По выбранным управлениям строк под проверками нет"
              description={
                'Проверки норм закона нашли строки, но все они — у других управлений. ' +
                'Их карточки видны в срезе «все управления».'
              }
            />
          ) : (
            <EmptyState
              tone="neutral"
              title="Проверки норм закона не нашли ни одной строки"
              description={
                'Проверены три механизма: разовая закупка у единственного поставщика выше ' +
                '600 тыс., годовой объём малых закупок и снижение больше четверти. Ни одна ' +
                'строка книг под них не подошла.'
              }
            />
          )
        ) : complianceIssues.length > 0 ? (
          <>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Строк под проверками в текущем срезе — {complianceIssues.length}:
              критических {complianceCritical}, предупреждений{' '}
              {complianceIssues.length - complianceCritical}. Ниже они свёрнуты в классы.
            </p>
            <DiagnosticCardList issues={toDiagnosticIssues(complianceIssues)} />
          </>
        ) : null}
      </section>
    </div>
  );
}
