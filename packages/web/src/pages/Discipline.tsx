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
 *
 * РЕЖИМ ПОДВЕДОВ (приказ владельца 20.08.2026). Выбран один ГРБС «с
 * подведомственными» — сводка перестаёт быть одной строкой управления и
 * раскладывается ПО УЧРЕЖДЕНИЯМ: аппарат первым, дальше подведы. Числа считает
 * та же чистая сборка дел (buildDisciplineActions), что и сводку целиком, —
 * вторых формул здесь нет, и разбивка не может разойтись с итогом. Подвед без
 * единой строки в выборке из разбивки НЕ пропадает: «строк нет» и «учреждения
 * нет» — разные новости.
 *
 * ОБЛИК (канон п.129). Обводок на атомах нет: поверхность даёт карточка
 * продукта, чипы и плашки отделяет светлота ролей.
 */
import { useCallback, useMemo } from 'react';
import { AlertTriangle, ClipboardCheck, RotateCcw } from 'lucide-react';
import { productLabel, subordinateKey, sumInitiativeRows } from '@aemr/shared';
import { useStore } from '../store';
import { toCanonicalDeptId } from '../lib/dept-key';
import { pluralRu } from '../lib/economy-copy';
import { EmptyState } from '../components/EmptyState';
import { SkeletonCard } from '../components/Skeleton';
import { KBTooltip } from '../components/ui/kb-tooltip';
import { GROUP3_KB_ADDITIONS, kbCardProps } from './kb-additions';
import { ActionCard } from '../components/discipline/ActionCard';
import { UpcomingSection } from '../components/timeline/UpcomingSection';
import { WorkloadSection } from '../components/workload/WorkloadSection';
import { DisciplinePeriodBadge } from '../components/discipline/DisciplinePeriodBadge';
import { PageHeader } from '../components/ui/page-header';
import { Card, CardHeader } from '../components/ui/card';
import { Chip } from '../components/ui/chip';
import { Stat } from '../components/ui/stat';
import { DataTable, TBody, THead, Td, Th, Tr } from '../components/ui/data-table';
import { useOrgScope } from '../lib/selectors/org-scope';
import { useDisciplineRows } from '../components/discipline/useDisciplineRows';
import {
  buildDisciplineActions,
  moneyToneClass,
  type DisciplineRow,
} from '../components/discipline/actions';

function делРу(n: number): string {
  return pluralRu(n, 'дело', 'дела', 'дел');
}

function строкРу(n: number): string {
  return pluralRu(n, 'строка', 'строки', 'строк');
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

  // ── Режим подведов (org-scope, приказ владельца 20.08.2026) ──────────────
  // Ключ ведра — ДОСЛОВНОЕ значение колонки C: только оно строково совпадает
  // с живыми строками книги (канон п.51).
  const subKeyOf = useCallback(
    (row: Record<string, unknown>) => subordinateKey(row.subordinate),
    [],
  );
  const orgScope = useOrgScope(rows, subKeyOf);

  /**
   * Дела каждой организации управления. Считает та же чистая сборка, что и
   * сводку целиком: разбивка не может разойтись с итогом по построению.
   */
  const subSummaries = useMemo(
    () => orgScope.subordinates.map((group) => ({
      key: group.key,
      label: group.label,
      rowsInScope: group.rows.length,
      summary: buildDisciplineActions(group.rows as unknown as DisciplineRow[]),
    })),
    [orgScope],
  );

  /** Переход в Реестр к строкам одной организации управления. */
  const openSubordinate = useCallback((subKey: string) => {
    navigateTo('data', {
      ...(orgScope.dept ? { department: orgScope.dept } : {}),
      subordinate: subKey,
    });
  }, [navigateTo, orgScope.dept]);

  const scopeLabel = selectedDepartments.size === 0
    ? 'все управления'
    : [...selectedDepartments].map((d) => productLabel(toCanonicalDeptId(d))).join(', ');

  return (
    <div className="space-y-5">
      {/* ── Шапка раздела: заголовок + выбор управления + подпись периода ──
           18.08: собственная вёрстка шапки заменена общим примитивом.
           Плашка периода отдана в `actions` — раньше она держалась
           на соседстве во flex-контейнере, теперь на роли. */}
      <PageHeader
        title="Дисциплина"
        lead="Список дел по книгам управлений: что заполнить, сколько денег это вернёт в план и какие строки закрывает. Не рейтинг и не упрёк — рабочий список."
        actions={<DisciplinePeriodBadge />}
      />

      {/* Отбор управлений — тот же ГЛОБАЛЬНЫЙ фильтр, что и полоса организаций
          слева: страница второго периметра не заводит. Чипы — общий примитив
          продукта, а не своя строка классов: нажатое состояние слышно диктору
          (aria-pressed), краски приходят ролями (п.115, п.129). */}
      <div className="flex items-center gap-1.5 flex-wrap" role="group" aria-label="Выбор управления">
        <Chip
          tone="neutral"
          pressed={selectedDepartments.size === 0}
          onClick={selectAllDepartments}
          title="Считать дела по книгам всех управлений района"
        >
          Все управления
        </Chip>
        {allDepartments.map((dept) => (
          <Chip
            key={dept}
            tone="neutral"
            pressed={selectedDepartments.has(dept)}
            onClick={() => toggleDepartment(dept)}
            title={`Считать дела только по ${productLabel(dept)} (общий фильтр управлений)`}
          >
            {productLabel(dept)}
          </Chip>
        ))}
      </div>

      {/* ── Близкие к плановой дате (канон п.75б): просроченные + окно 14 дней.
            Секция живёт своим запросом /api/timeline/upcoming и своим
            периметром «от сегодня» — дела ниже она не задерживает. ── */}
      <UpcomingSection />

      {/* ── Книги, которые не прочитались: честная плашка, а не тишина ── */}
      {failedDepts.length > 0 && !loading && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-[var(--radius-card)] px-4 py-3 ds-text-xs"
          style={{
            backgroundColor: 'color-mix(in srgb, var(--data-warn) 10%, transparent)',
            color: 'var(--data-warn)',
          }}
        >
          <AlertTriangle size={14} className="mt-px shrink-0" aria-hidden="true" />
          <div>
            <p>
              Книги не прочитались: {failedDepts.map((d) => productLabel(toCanonicalDeptId(d))).join(', ')}.
              Дела по ним не посчитаны — счётчики ниже неполные.
            </p>
            {reason && <p className="mt-0.5 ds-text-3xs opacity-80">({reason})</p>}
            <button
              type="button"
              onClick={reload}
              className="mt-1.5 inline-flex items-center gap-1 font-[var(--weight-medium)] hover:underline"
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
          <section aria-label="Сводка дел">
            <Card className="space-y-[var(--space-3)]">
              <CardHeader
                className="mb-0"
                // Карточка БЗ сводки дел (п.91-2): что такое дело, как считаются
                // строки и деньги эффекта, почему нет сводного индекса.
                title={
                  <KBTooltip {...kbCardProps(GROUP3_KB_ADDITIONS.discipline_actions)} showIcon>
                    <span>Сводка дел</span>
                  </KBTooltip>
                }
                scope={`${scopeLabel} · строки последнего чтения книг`}
                note="Дело — класс незаполненных полей, влияющих на план: одно действие закрывает все свои строки разом. Сводный индекс дисциплины здесь не показывается — веса его слагаемых не утверждены; считаются только проверяемые вещи: дела, строки и деньги."
              />

              <div className="flex flex-wrap items-start gap-x-[var(--space-8)] gap-y-[var(--space-3)]">
                <Stat
                  label={`${делРу(summary.totalActions)} на сегодня`}
                  value={String(summary.totalActions)}
                  hint="Классы дел, у которых нашлась хотя бы одна строка."
                />
                <Stat
                  label={`${pluralRu(summary.totalRows, 'строка ждёт', 'строки ждут', 'строк ждут')} действия`}
                  value={String(summary.totalRows)}
                  hint="Строка, попавшая в два дела, считается одной."
                />
                {/* Деньги — единственное место цвета в сводке (бриф §2.3:
                    критичность только тоном денег эффекта). Пороги тона живут
                    в одном доме — components/discipline/actions.ts. */}
                <div className="ds-stat min-w-0">
                  <div className="ds-text-2xs text-[var(--ink-muted)]">деньги в строках дел</div>
                  <div className="mt-0.5 flex items-baseline gap-1">
                    <span
                      data-numeric
                      className={`ds-text-2xl font-[var(--weight-strong)] tabular-nums ${moneyToneClass(summary.totalMoney)}`}
                    >
                      {formatMoney(summary.totalMoney)}
                    </span>
                  </div>
                  <p className="ds-prose mt-1 ds-text-3xs text-[var(--ink-faint)]">
                    План строк планового дела, иначе факт. Это деньги строк, а не сумма дел.
                  </p>
                </div>
              </div>

              {/* Подпись плана по канону п.76б: инициативные заявки видны, но
                  подписаны отдельно — это стадия, а не риск и не дело. */}
              {initiative.rows > 0 && (
                <p
                  className="ds-text-2xs tabular-nums text-violet-700 dark:text-violet-400"
                  title="Стадия «инициативная заявка без подтверждённой потребности»: примечание строки целиком равно маркеру словаря «хотелки» (три написания). План таких строк входит в общий план книги, но подписывается отдельно и в риск-списки не шумит."
                >
                  В плане книг — в т.ч. инициативные заявки {formatMoney(initiative.planSum)}{' '}
                  ({initiative.rows} {строкРу(initiative.rows)})
                </p>
              )}

              {/* ── Режим подведов: сводка раскладывается по учреждениям ── */}
              {orgScope.mode === 'withSubs' && orgScope.hasSubs && (
                <>
                  <DataTable
                    caption={`Дела по организациям управления: ${subSummaries.length} ${pluralRu(subSummaries.length, 'организация', 'организации', 'организаций')} в выборке ${scopeLabel}`}
                    maxHeight="22rem"
                  >
                    <THead>
                      <tr>
                        <Th>Организация</Th>
                        <Th numeric title="Классы дел, у которых у этой организации есть строки">
                          Дел
                        </Th>
                        <Th numeric title="Строки этой организации, ждущие действия">
                          Строк ждут
                        </Th>
                        <Th numeric title="Деньги строк, ждущих действия">
                          Деньги дел
                        </Th>
                        <Th numeric title="Все строки организации в текущей выборке">
                          Строк в выборке
                        </Th>
                      </tr>
                    </THead>
                    <TBody>
                      {subSummaries.map((group) => (
                        <Tr
                          key={group.key}
                          onClick={group.rowsInScope > 0 ? () => openSubordinate(group.key) : undefined}
                        >
                          <th
                            scope="row"
                            className="text-left font-[var(--weight-medium)] text-[var(--ink-strong)]"
                            style={{ padding: 'var(--cell-pad-y) var(--cell-pad-x)' }}
                          >
                            <span
                              title={group.rowsInScope > 0
                                ? `${group.label}. Открыть строки организации в Реестре`
                                : group.label}
                            >
                              {group.label}
                            </span>
                          </th>
                          {group.rowsInScope === 0 ? (
                            // Учреждение без строк из разбивки не пропадает:
                            // «строк нет» и «организации нет» — разные новости.
                            <Td colSpan={4} muted>
                              строк этой организации в выборке нет — дела считать не из чего
                            </Td>
                          ) : (
                            <>
                              <Td numeric>{group.summary.totalActions}</Td>
                              <Td numeric muted>{group.summary.totalRows}</Td>
                              <Td numeric className={moneyToneClass(group.summary.totalMoney)}>
                                {formatMoney(group.summary.totalMoney)}
                              </Td>
                              <Td numeric muted>{group.rowsInScope}</Td>
                            </>
                          )}
                        </Tr>
                      ))}
                    </TBody>
                  </DataTable>
                  <p className="ds-text-3xs text-[var(--ink-faint)]">
                    Разбивка появилась потому, что в фильтре выбрано одно управление «с
                    подведомственными». Организация без строк из перечня не исчезает: пустая
                    строка означает «закупок в выборке нет», а не «учреждения нет».
                  </p>
                </>
              )}

              {orgScope.mode === 'withSubs' && !orgScope.hasSubs && (
                <p className="ds-text-2xs text-[var(--ink-muted)]">
                  У этого управления подведомственных учреждений нет: все дела выше — по
                  закупкам самого аппарата управления, и раскладывать их не на что.
                </p>
              )}

              {orgScope.mode === 'grbs' && (
                <p className="ds-text-2xs text-[var(--ink-muted)]">
                  Выбран режим «только ГРБС»: дела считаются по строкам аппарата и подведов
                  вместе, но разбивка по учреждениям скрыта этим режимом. Вернуть её —
                  переключить управление в фильтре на «с подведомственными».
                </p>
              )}
            </Card>
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

      {/* ── Нагрузка управлений и три рода событий (канон п.103/п.105) ──
            Секция живёт своим запросом /api/workload и своим периметром: она
            меряет книги целиком и не подчиняется ни выбору управлений выше, ни
            периоду в шапке. Стоит она здесь, а не отдельной вкладкой, потому
            что отвечает на вопрос, который порождает список дел: почему у
            одного управления дел вдесятеро больше. Показывается всегда — в том
            числе когда строк для дел не прочиталось: собственную пустоту
            секция объясняет сама. ── */}
      <WorkloadSection />
    </div>
  );
}
