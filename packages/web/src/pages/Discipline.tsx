/**
 * «Дисциплина» — исход 3: закупочная дисциплина как СВОЙ результат управления.
 *
 * Экран — СПИСОК ДЕЛ, а не рейтинг штрафов: действия с эффектом в рублях,
 * собранные из признаков строк и сгруппированные ПО ДЕЙСТВИЮ («проставить
 * плановые даты в N строках — вернёт X в лимит года»), с переходом в Реестр
 * на готовый фильтр. Тон рабочий: без «ТРЕВОГА» и алых ярлыков, критичность —
 * только цветом денег эффекта (бриф переплавки §2.3).
 *
 * Сводный индекс дисциплины сознательно НЕ показывается: веса слагаемых не
 * утверждены (развилка Р-16). Вместо него — счётчик «дел на сегодня» и деньги,
 * которые вернёт их выполнение.
 */
import { useCallback, useMemo } from 'react';
import { AlertTriangle, ClipboardCheck, RotateCcw } from 'lucide-react';
import { productLabel, sumInitiativeRows } from '@aemr/shared';
import { useStore } from '../store';
import { toCanonicalDeptId } from '../lib/dept-key';
import { pluralRu } from '../lib/economy-copy';
import { EmptyState } from '../components/EmptyState';
import { SkeletonCard } from '../components/Skeleton';
import { KBTooltip } from '../components/ui/kb-tooltip';
import { GROUP3_KB_ADDITIONS, kbCardProps } from './kb-additions';
import { ActionCard } from '../components/discipline/ActionCard';
import { UpcomingSection } from '../components/timeline/UpcomingSection';
import { DisciplinePeriodBadge } from '../components/discipline/DisciplinePeriodBadge';
import { useDisciplineRows } from '../components/discipline/useDisciplineRows';
import {
  buildDisciplineActions,
  moneyToneClass,
  type DisciplineRow,
} from '../components/discipline/actions';

function делРу(n: number): string {
  return pluralRu(n, 'дело', 'дела', 'дел');
}

export function DisciplinePage() {
  const subordinatesMap = useStore((s) => s.subordinatesMap);
  const selectedDepartments = useStore((s) => s.selectedDepartments);
  const toggleDepartment = useStore((s) => s.toggleDepartment);
  const selectAllDepartments = useStore((s) => s.selectAllDepartments);
  const year = useStore((s) => s.year);
  const formatMoney = useStore((s) => s.formatMoney);
  const navigateTo = useStore((s) => s.navigateTo);

  // Список управлений — как в Реестре: ключи subordinatesMap (кириллический
  // канон). Выбор — ГЛОБАЛЬНЫЙ фильтр ГРБС: чипы здесь и полоса организаций
  // слева — один и тот же отбор, страница не заводит второй периметр.
  const allDepartments = useMemo(() => Object.keys(subordinatesMap), [subordinatesMap]);
  const deptsToLoad = useMemo(
    () => (selectedDepartments.size > 0 ? [...selectedDepartments] : allDepartments),
    [selectedDepartments, allDepartments],
  );

  const { rows, loading, failedDepts, reason, reload } = useDisciplineRows(deptsToLoad, year);

  const summary = useMemo(
    () => buildDisciplineActions(rows as unknown as DisciplineRow[]),
    [rows],
  );

  // «В т.ч. инициативные заявки» (канон п.76б): план строк, чьё примечание
  // целиком равно маркеру словаря «хотелки», подписывается отдельно — это
  // стадия «инициативная заявка без подтверждённой потребности», не риск.
  const initiative = useMemo(() => sumInitiativeRows(rows), [rows]);

  /** Переход в Реестр с готовым фильтром: признак дела (+ управление). */
  const openInRegistry = useCallback((signal: string, dept?: string) => {
    navigateTo('data', {
      signals: [signal],
      ...(dept ? { department: dept } : {}),
    });
  }, [navigateTo]);

  const scopeLabel = selectedDepartments.size === 0
    ? 'все управления'
    : [...selectedDepartments].map((d) => productLabel(toCanonicalDeptId(d))).join(', ');

  return (
    <div className="space-y-5">
      {/* ── Шапка раздела: заголовок + выбор управления + подпись периода ── */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-lg font-semibold text-zinc-800 dark:text-zinc-100">Дисциплина</h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400 max-w-2xl mt-0.5">
            Список дел по книгам управлений: что заполнить, сколько денег это вернёт
            в план и какие строки закрывает. Не рейтинг и не упрёк — рабочий список.
          </p>
        </div>
        <DisciplinePeriodBadge />
      </div>

      <div className="flex items-center gap-1.5 flex-wrap" role="group" aria-label="Выбор управления">
        <button
          type="button"
          onClick={selectAllDepartments}
          aria-pressed={selectedDepartments.size === 0}
          className={
            selectedDepartments.size === 0
              ? 'px-2.5 py-1 text-xs font-medium rounded-full bg-zinc-800 text-white dark:bg-zinc-100 dark:text-zinc-900'
              : 'px-2.5 py-1 text-xs font-medium rounded-full border border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-700/40 transition'
          }
        >
          Все управления
        </button>
        {allDepartments.map((dept) => {
          const active = selectedDepartments.has(dept);
          return (
            <button
              key={dept}
              type="button"
              onClick={() => toggleDepartment(dept)}
              aria-pressed={active}
              title={`Считать дела только по ${productLabel(dept)} (общий фильтр управлений)`}
              className={
                active
                  ? 'px-2.5 py-1 text-xs font-medium rounded-full bg-zinc-800 text-white dark:bg-zinc-100 dark:text-zinc-900'
                  : 'px-2.5 py-1 text-xs font-medium rounded-full border border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-700/40 transition'
              }
            >
              {productLabel(dept)}
            </button>
          );
        })}
      </div>

      {/* ── Близкие к плановой дате (канон п.75б): просроченные + окно 14 дней.
            Секция живёт своим запросом /api/timeline/upcoming и своим
            периметром «от сегодня» — дела ниже она не задерживает. ── */}
      <UpcomingSection />

      {/* ── Книги, которые не прочитались: честная плашка, а не тишина ── */}
      {failedDepts.length > 0 && !loading && (
        <div className="flex items-start gap-2 text-xs bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-xl px-4 py-3">
          <AlertTriangle size={14} className="text-amber-600 dark:text-amber-400 mt-px shrink-0" aria-hidden="true" />
          <div className="text-amber-800 dark:text-amber-300">
            <p>
              Книги не прочитались: {failedDepts.map((d) => productLabel(toCanonicalDeptId(d))).join(', ')}.
              Дела по ним не посчитаны — счётчики ниже неполные.
            </p>
            {reason && <p className="mt-0.5 text-amber-700/70 dark:text-amber-400/60">({reason})</p>}
            <button
              type="button"
              onClick={reload}
              className="mt-1.5 inline-flex items-center gap-1 font-medium hover:underline"
            >
              <RotateCcw size={11} aria-hidden="true" /> Прочитать ещё раз
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="space-y-4" role="status" aria-live="polite">
          <span className="sr-only">Читаем строки книг управлений</span>
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          tone={failedDepts.length > 0 ? 'problem' : 'neutral'}
          title={failedDepts.length > 0
            ? 'Строки книг не прочитаны — дела посчитать не из чего'
            : `За ${typeof year === 'number' ? `${year} год` : 'выбранные годы'} в книгах выбранных управлений нет ни одной строки`}
          description={failedDepts.length > 0
            ? 'Сервер не отдал ни одной книги. Дела появятся, как только чтение пройдёт.'
            : 'Дела собираются из строк реестра. Если строки ожидались — проверьте год в шапке и выбор управлений выше.'}
          detail={reason ?? undefined}
          action={{ label: 'Прочитать ещё раз', onClick: reload }}
          secondaryAction={{ label: 'Открыть Реестр', onClick: () => navigateTo('data') }}
        />
      ) : (
        <>
          {/* ── Сводка: счётчик дел и деньги — вместо сводного индекса ── */}
          <section
            aria-label="Сводка дел"
            className="bg-white dark:bg-zinc-800/60 rounded-xl shadow-sm border border-zinc-100 dark:border-zinc-700/50 p-5"
          >
            <div className="flex items-center justify-between gap-6 flex-wrap">
              <div className="flex items-center gap-8 flex-wrap">
                {/* Карточка БЗ сводки дел (п.91-2): что такое дело, как считаются
                    строки и деньги эффекта, почему нет сводного индекса. */}
                <KBTooltip {...kbCardProps(GROUP3_KB_ADDITIONS.discipline_actions)} showIcon>
                  <div>
                    <p className="text-2xl font-semibold tabular-nums text-zinc-800 dark:text-zinc-100">
                      {summary.totalActions}
                    </p>
                    <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                      {делРу(summary.totalActions)} на сегодня
                    </p>
                  </div>
                </KBTooltip>
                <div>
                  <p className="text-2xl font-semibold tabular-nums text-zinc-800 dark:text-zinc-100">
                    {summary.totalRows}
                  </p>
                  <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                    {pluralRu(summary.totalRows, 'строка ждёт', 'строки ждут', 'строк ждут')} действия
                  </p>
                </div>
                <div>
                  <p className={`text-2xl font-semibold tabular-nums ${moneyToneClass(summary.totalMoney)}`}>
                    {formatMoney(summary.totalMoney)}
                  </p>
                  <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                    деньги в строках дел
                  </p>
                </div>
              </div>
              <div className="text-right text-[11px] text-zinc-500 dark:text-zinc-400">
                <p>Периметр: {scopeLabel}</p>
                <p className="mt-0.5">строки — из последнего чтения книг управлений</p>
              </div>
            </div>
            {/* Подпись плана по канону п.76б: инициативные заявки видны, но
                подписаны отдельно — это стадия, а не риск и не дело. */}
            {initiative.rows > 0 && (
              <p
                className="mt-2 text-[11px] text-violet-700 dark:text-violet-400 tabular-nums"
                title="Стадия «инициативная заявка без подтверждённой потребности»: примечание строки целиком равно маркеру словаря «хотелки» (три написания). План таких строк входит в общий план книги, но подписывается отдельно и в риск-списки не шумит."
              >
                В плане книг — в т.ч. инициативные заявки {formatMoney(initiative.planSum)}{' '}
                ({initiative.rows} {pluralRu(initiative.rows, 'строка', 'строки', 'строк')})
              </p>
            )}
            <p className="mt-3 pt-3 border-t border-zinc-100 dark:border-zinc-700/50 text-[11px] text-zinc-500 dark:text-zinc-400">
              Сводный индекс дисциплины здесь не показывается: веса его слагаемых не
              утверждены. Считаются только проверяемые вещи — дела, строки и деньги.
            </p>
          </section>

          {/* ── Список дел ── */}
          {summary.totalActions === 0 ? (
            <EmptyState
              icon={ClipboardCheck}
              title="Дел на сегодня нет"
              description={`По строкам (${scopeLabel}) проверки не нашли ни одного незаполненного поля, влияющего на план: плановые даты, кварталы, даты заключения, разбивка по бюджетам и обоснования ЕП на месте.`}
              action={{ label: 'Открыть Реестр', onClick: () => navigateTo('data') }}
            />
          ) : (
            <div className="space-y-3">
              {summary.actions.map((action) => (
                <ActionCard
                  key={action.def.signal}
                  action={action}
                  formatMoney={formatMoney}
                  onOpen={(dept) => openInRegistry(action.def.signal, dept)}
                  showDeptShares={selectedDepartments.size !== 1}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
