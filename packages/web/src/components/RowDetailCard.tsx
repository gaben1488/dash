import { useEffect, useCallback, useId, useRef } from 'react';
import { BUDGET_SOURCE_META, isYearlongStageRow, productLabel } from '@aemr/shared';
import { useStore } from '../store';
import { X, CheckCircle2, Clock, XCircle, AlertTriangle } from 'lucide-react';
import clsx from 'clsx';
import { KbHover } from './contract/KbHover';
import { formatDateCell } from '../lib/sheet-date';
import { toCanonicalDeptId } from '../lib/dept-key';
import { activityRowLabel, signalChipText, signalTone } from '../lib/rows/registry-view';
import { looksLikeEconomyDisposal } from '../lib/economy/disposal';
import { RowTimelineSection } from './timeline/RowTimelineSection';
import { YearlongBadge } from './yearlong/YearlongBadge';
import { YearlongKindSelect } from './yearlong/YearlongKindSelect';

/**
 * Карточка строки реестра — «доказательство числа» для одной закупки.
 *
 * Подписи признаков сюда НЕ копируются: локальная копия SIGNAL_LABELS уже
 * однажды разошлась со словарём продукта (в ней жили «Качество» и
 * «Факт > план» вместо канонических фраз), и читатель видел в реестре одно
 * слово, а в карточке — другое. Единственный дом подписей — словарь
 * @aemr/shared, единственный дом оформления — lib/rows/registry-view.
 */

/** Строка реестра, как её отдаёт /api/rows (экспорт — для вызывающих карточку извне Реестра). */
export interface RowDetailRow {
  id: number | string;
  subject?: string;
  dept?: string;
  type?: string;
  method?: string;
  planSum?: number;
  factSum?: number;
  economy?: number;
  status?: string;
  signals?: string[];
  [key: string]: unknown;
}

interface RowDetailCardProps {
  row: RowDetailRow;
  onClose: () => void;
}

/** Число ячейки строки; нечисловое и пустое — ноль (как в расчёте). */
function num(value: unknown): number {
  const n = typeof value === 'number' ? value : parseFloat(String(value ?? ''));
  return Number.isFinite(n) ? n : 0;
}

/** Текст ячейки или null, если в книге пусто (пустая строка — это не значение). */
function text(value: unknown): string | null {
  const s = String(value ?? '').trim();
  return s === '' ? null : s;
}

/** Подпись поля с честной пустотой: причина вместо безмолвного прочерка. */
function FieldValue({ value, missing }: { value: string | null; missing: string }) {
  if (value) return <span className="text-sm font-medium text-zinc-700 dark:text-zinc-200">{value}</span>;
  return <span className="text-xs text-zinc-400 dark:text-zinc-500">{missing}</span>;
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-[10px] uppercase tracking-wider font-semibold text-zinc-400 dark:text-zinc-500 mb-2">
      {children}
    </h3>
  );
}

export function RowDetailCard({ row, onClose }: RowDetailCardProps) {
  const formatMoney = useStore(s => s.formatMoney);
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') onClose();
  }, [onClose]);

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  // Фокус входит в окно и возвращается туда, откуда пришёл: без этого
  // клавиатурный читатель после закрытия оказывался в начале страницы.
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();
    return () => previous?.focus?.();
  }, []);

  /** Клавиша перехода не должна уводить фокус за пределы модального окна. */
  const trapTab = useCallback((e: React.KeyboardEvent) => {
    if (e.key !== 'Tab' || !panelRef.current) return;
    const focusables = Array.from(
      panelRef.current.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      ),
    ).filter(el => !el.hasAttribute('disabled'));
    if (focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }, []);

  const planSum = num(row.planSum);
  const factSum = num(row.factSum);
  const economy = num(row.economy);
  const signals = row.signals ?? [];
  const rowIndex = Number(row.rowIndex ?? 0);
  const deptId = toCanonicalDeptId(String(row.dept ?? ''));
  const deptName = productLabel(deptId);

  // Нулевой план — это не «ноль процентов», а отсутствие знаменателя: так и
  // говорим. Перерасход не подрезается до 100 %: подрезка прятала бы ровно тот
  // случай, ради которого на процент и смотрят.
  const hasPlan = planSum > 0;
  const executionPct = hasPlan ? (factSum / planSum) * 100 : null;
  const economyPct = hasPlan ? (economy / planSum) * 100 : null;
  const barWidth = executionPct === null ? 0 : Math.min(executionPct, 100);

  /** Адрес ячейки книги — доказательство происхождения числа. */
  const cell = (column: string) => (rowIndex > 0 ? `${column}${rowIndex}` : 'адрес строки неизвестен');

  // Стадия «Закупки, проводимые в течение года» (канон п.71): структурный
  // предикат — способ ЕП, заглушка свода в дате заключения, факт больше нуля.
  // Текст комментариев не читается (п.27 в силе).
  const isYearlong = isYearlongStageRow({
    method: row.method,
    factDateCell: row.factDateRaw,
    factSum,
  });

  const planDate = formatDateCell(row.planDate);
  const factDate = formatDateCell(row.factDate);
  const planYear = Number(row.planYear ?? 0);
  const epReason = text(row.epReason);
  const comments: Array<{ label: string; value: string | null }> = [
    { label: 'Комментарий управления', value: text(row.commentGRBS) },
    { label: 'Комментарий отдела экономики', value: text(row.commentExtra) },
    { label: 'Комментарий финансового управления', value: text(row.commentUFBP) },
  ];
  const filledComments = comments.filter(c => c.value);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onClose}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={trapTab}
        className="bg-white dark:bg-zinc-800 rounded-xl shadow-2xl max-w-lg w-full mx-4 max-h-[85vh] overflow-y-auto outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Шапка */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-100 dark:border-zinc-700/50 sticky top-0 bg-white dark:bg-zinc-800 z-10">
          <div className="min-w-0">
            <div className="text-xs text-zinc-400 dark:text-zinc-500 mb-0.5">
              Строка № {text(row.id) ?? 'без номера'} · {deptName || 'управление не указано'}
            </div>
            {/* Полное имя закупки без обрезания (интервью п.50): заголовок
                верстается в несколько строк — «Оказание услуг по текущему
                ремо…» лишал карточку смысла, предмет и есть главный ответ. */}
            <h2 id={titleId} className="text-sm font-semibold text-zinc-800 dark:text-zinc-100 break-words leading-snug">
              {text(row.subject) ?? 'Предмет закупки не указан'}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Закрыть карточку строки"
            className="p-1.5 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-700 transition text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 flex-shrink-0 ml-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        {/* Тело */}
        <div className="px-6 py-5 space-y-5">
          {/* Кто и что */}
          <div>
            <SectionTitle>Кто и что закупает</SectionTitle>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="text-[10px] text-zinc-400 dark:text-zinc-500">Управление</div>
                <FieldValue value={deptName || null} missing="не указано" />
              </div>
              <div>
                <div className="text-[10px] text-zinc-400 dark:text-zinc-500">Способ определения поставщика</div>
                <div>
                  {text(row.method) ? (
                    <span className={clsx(
                      'inline-block px-1.5 py-0.5 rounded text-[10px] font-bold',
                      row.method === 'ЕП'
                        ? 'bg-orange-50 dark:bg-orange-950/30 text-orange-700 dark:text-orange-400'
                        : 'bg-blue-50 dark:bg-blue-950/30 text-blue-700 dark:text-blue-400',
                    )}>
                      {row.method}
                    </span>
                  ) : (
                    <span className="text-xs text-zinc-400 dark:text-zinc-500">не заполнен в книге</span>
                  )}
                </div>
              </div>
              <div>
                <div className="text-[10px] text-zinc-400 dark:text-zinc-500">Заказчик</div>
                <FieldValue value={text(row.subordinate)} missing="закупка самого управления" />
              </div>
              <div>
                <div className="text-[10px] text-zinc-400 dark:text-zinc-500">Вид деятельности</div>
                <FieldValue value={activityRowLabel(row.type, row.programName)} missing="не указан" />
              </div>
              <div>
                <div className="text-[10px] text-zinc-400 dark:text-zinc-500">Состояние</div>
                <div>
                  {text(row.status) ? (
                    <span className={clsx(
                      'inline-flex items-center gap-1 text-xs font-medium',
                      row.status === 'Подписан' && 'text-emerald-600 dark:text-emerald-400',
                      row.status === 'Отменён' && 'text-zinc-400 dark:text-zinc-500',
                      row.status === 'Планирование' && 'text-blue-600 dark:text-blue-400',
                      row.status === 'Исполнение' && 'text-amber-600 dark:text-amber-400',
                      row.status === 'Просрочен' && 'text-red-600 dark:text-red-400',
                    )}>
                      {row.status === 'Подписан' && <CheckCircle2 size={13} aria-hidden="true" />}
                      {row.status === 'Отменён' && <XCircle size={13} aria-hidden="true" />}
                      {row.status === 'Планирование' && <Clock size={13} aria-hidden="true" />}
                      {row.status}
                    </span>
                  ) : (
                    <span className="text-xs text-zinc-400 dark:text-zinc-500">не рассчитано: нет ни сроков, ни сумм</span>
                  )}
                </div>
              </div>
              <div>
                <div className="text-[10px] text-zinc-400 dark:text-zinc-500">Год плана</div>
                <FieldValue value={planYear > 0 ? String(planYear) : null} missing="не проставлен — годовой фильтр строку не проверял" />
              </div>
            </div>
          </div>

          {/* Сроки */}
          <div>
            <SectionTitle>Сроки</SectionTitle>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="text-[10px] text-zinc-400 dark:text-zinc-500">Плановая дата ({cell('N')})</div>
                <FieldValue value={planDate || null} missing="не проставлена" />
              </div>
              <div>
                <div className="text-[10px] text-zinc-400 dark:text-zinc-500">Дата заключения ({cell('Q')})</div>
                <FieldValue value={factDate || null} missing="контракт не заключён" />
              </div>
            </div>
          </div>

          {/* Деньги */}
          <div>
            <SectionTitle>Деньги</SectionTitle>
            <div className="grid grid-cols-3 gap-3 mb-3">
              <div>
                <div className="text-[10px] text-zinc-400 dark:text-zinc-500">План</div>
                <div className="text-sm font-semibold text-zinc-700 dark:text-zinc-200 tabular-nums">
                  {hasPlan ? (
                    <KbHover
                      metricKey="plan_total"
                      live={`${formatMoney(planSum)} — плановый итог этой строки.\nЯчейка книги: ${cell('K')} (сумма ${cell('H')}, ${cell('I')}, ${cell('J')}).`}
                    >
                      <span>{formatMoney(planSum)}</span>
                    </KbHover>
                  ) : (
                    <span className="text-xs font-normal text-zinc-400 dark:text-zinc-500">
                      плановых денег нет ({cell('K')} пуста)
                    </span>
                  )}
                </div>
              </div>
              <div>
                <div className="text-[10px] text-zinc-400 dark:text-zinc-500">Факт</div>
                <div className="text-sm font-semibold text-zinc-700 dark:text-zinc-200 tabular-nums">
                  {factSum > 0 ? (
                    <KbHover
                      metricKey="fact_total"
                      live={`${formatMoney(factSum)} — цена заключённого контракта.\nЯчейка книги: ${cell('Y')} (сумма ${cell('V')}, ${cell('W')}, ${cell('X')}).`}
                    >
                      <span>{formatMoney(factSum)}</span>
                    </KbHover>
                  ) : (
                    <span className="text-xs font-normal text-zinc-400 dark:text-zinc-500">контракт не заключён</span>
                  )}
                </div>
              </div>
              <div>
                <div className="text-[10px] text-zinc-400 dark:text-zinc-500">Экономия</div>
                <div className="text-sm font-semibold tabular-nums">
                  {economy > 0 ? (
                    <KbHover
                      metricKey="economy_total"
                      live={`${formatMoney(economy)} — экономия по этой строке.\nЯчейки книги: ${cell('Z')}, ${cell('AA')}, ${cell('AB')}.${
                        economyPct !== null ? `\nЭто ${economyPct.toFixed(1)} % планового итога ${cell('K')}.` : ''
                      }`}
                    >
                      <span className="text-emerald-600 dark:text-emerald-400">
                        {formatMoney(economy)}
                        {economyPct !== null && (
                          <span className="text-[10px] font-normal"> ({economyPct.toFixed(1)} %)</span>
                        )}
                      </span>
                    </KbHover>
                  ) : (
                    <span className="text-xs font-normal text-zinc-400 dark:text-zinc-500">
                      {factSum > 0 ? 'не зафиксирована' : 'появится после факта'}
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Разрез по источникам финансирования: где именно лежат деньги.
                Названия уровней — из канон-словаря BUDGET_SOURCE_META, не из головы.
                Адреса ячеек здесь — книги управления (план H/I/J, факт V/W/X);
                поля planColumn/factColumn словаря относятся к листу СВОД и сюда не годятся. */}
            <div className="grid grid-cols-3 gap-3 mb-3 text-[10px] text-zinc-500 dark:text-zinc-400">
              {([
                [BUDGET_SOURCE_META.fb.label, num(row.planFB), num(row.factFB), 'H', 'V'],
                [BUDGET_SOURCE_META.kb.label, num(row.planKB), num(row.factKB), 'I', 'W'],
                [BUDGET_SOURCE_META.mb.label, num(row.planMB), num(row.factMB), 'J', 'X'],
              ] as [string, number, number, string, string][]).map(([label, plan, fact, planCol, factCol]) => (
                <div
                  key={label}
                  className="rounded-lg bg-zinc-50 dark:bg-zinc-900/40 px-2 py-1.5"
                  title={`План — ячейка ${cell(planCol)}, факт — ячейка ${cell(factCol)}`}
                >
                  <div className="font-medium text-zinc-600 dark:text-zinc-300">{label}</div>
                  {plan > 0 || fact > 0 ? (
                    <div className="tabular-nums">
                      план {formatMoney(plan)} · факт {fact > 0 ? formatMoney(fact) : 'нет'}
                    </div>
                  ) : (
                    <div>не участвует</div>
                  )}
                </div>
              ))}
            </div>

            {/* Исполнение */}
            <div
              className="relative h-2 bg-zinc-100 dark:bg-zinc-700/50 rounded-full overflow-hidden"
              role="img"
              aria-label={
                executionPct === null
                  ? 'Доля исполнения не считается: планового итога нет'
                  : `Исполнено ${executionPct.toFixed(1)} процента планового итога`
              }
            >
              <div
                className={clsx(
                  'absolute inset-y-0 left-0 rounded-full transition-all',
                  executionPct === null ? 'bg-zinc-300 dark:bg-zinc-600'
                    : executionPct > 100 ? 'bg-red-500'
                    : executionPct >= 80 ? 'bg-emerald-500'
                    : executionPct >= 50 ? 'bg-amber-500'
                    : 'bg-zinc-400 dark:bg-zinc-500',
                )}
                style={{ width: `${barWidth}%` }}
              />
            </div>
            <div className="text-[10px] text-zinc-400 dark:text-zinc-500 mt-1">
              {executionPct === null
                ? 'Доля исполнения не считается: планового итога у строки нет'
                : executionPct > 100
                  ? `Факт превысил план: ${executionPct.toFixed(1)} % планового итога`
                  : `Исполнено ${executionPct.toFixed(1)} % планового итога`}
            </div>
          </div>

          {/* Обоснование единственного поставщика */}
          {(epReason || row.method === 'ЕП') && (
            <div>
              <SectionTitle>Основание выбора единственного поставщика</SectionTitle>
              {epReason ? (
                <p className="text-xs text-zinc-600 dark:text-zinc-300 leading-relaxed">
                  {epReason}
                  <span className="text-zinc-400 dark:text-zinc-500"> (ячейка {cell('M')})</span>
                </p>
              ) : (
                <p className="text-xs text-amber-600 dark:text-amber-400">
                  Основание не заполнено, хотя способ — единственный поставщик (ячейка {cell('M')} пуста)
                </p>
              )}
            </div>
          )}

          {/* Комментарии. Подсветка «похоже на распоряжение экономией» —
              безопасная версия слоя перераспределения (канон п.85/12б):
              подсвечиваем автоматически, но НИЧЕГО не считаем и статуса не
              выводим — учёт возможен только после подтверждения человеком
              (п.27: свободный текст не источник статусов). */}
          {filledComments.length > 0 && (
            <div>
              <SectionTitle>Комментарии</SectionTitle>
              <div className="space-y-2">
                {filledComments.map(c => {
                  const disposal = looksLikeEconomyDisposal(c.value);
                  return (
                    <div
                      key={c.label}
                      className={clsx(disposal && 'border-l-2 border-violet-400 dark:border-violet-500 pl-2')}
                    >
                      <div className="text-[10px] text-zinc-400 dark:text-zinc-500 flex items-center gap-1.5 flex-wrap">
                        {c.label}
                        {disposal && (
                          <span
                            className="px-1.5 py-px rounded-full text-[9px] font-medium bg-violet-50 dark:bg-violet-950/40 text-violet-700 dark:text-violet-300"
                            title="Подсветка автоматическая — по словам о перераспределении сэкономленных денег. Статус строки из текста не выводится, в счётчики такие строки не попадают: распоряжение учитывается только после подтверждения ответственным."
                          >
                            похоже на распоряжение экономией
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-zinc-600 dark:text-zinc-300 leading-relaxed">{c.value}</p>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Признаки */}
          <div>
            <SectionTitle>Признаки строки</SectionTitle>
            {signals.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {signals.map((sig: string) => {
                  const chip = signalChipText(sig);
                  const tone = signalTone(sig);
                  return (
                    <span
                      key={sig}
                      title={chip.hint}
                      className={clsx('px-2 py-1 rounded-lg text-xs font-medium', tone.bg, tone.text)}
                    >
                      {sig === 'epRisk' && <AlertTriangle size={11} className="inline mr-1 -mt-0.5" aria-hidden="true" />}
                      {sig === 'overdue' && <Clock size={11} className="inline mr-1 -mt-0.5" aria-hidden="true" />}
                      {sig === 'factExceedsPlan' && <AlertTriangle size={11} className="inline mr-1 -mt-0.5" aria-hidden="true" />}
                      {chip.text}
                    </span>
                  );
                })}
              </div>
            ) : (
              <p className="text-xs text-zinc-400 dark:text-zinc-500">Проверки к этой строке замечаний не нашли</p>
            )}
          </div>

          {/* Стадия «в течение года» (каноны п.71, п.81, п.83): собственная
              подпись стадии вместо лживого «есть факт» + разметка вида одним
              кликом. Секция появляется только у строк, прошедших структурный
              предикат стадии, — вне стадии её нет вовсе. */}
          {isYearlong && (
            <div>
              <SectionTitle>Стадия «в течение года»</SectionTitle>
              <YearlongBadge
                row={{
                  dept: String(row.dept ?? ''),
                  id: row.id,
                  method: row.method,
                  factDateRaw: row.factDateRaw,
                  factSum,
                }}
              />
              <p className="text-[10px] text-zinc-400 dark:text-zinc-500 mt-1.5 leading-relaxed">
                Статья исполняется серией договоров или платежей в течение года: факт и экономия
                этой строки в свод не попадают (так считают формулы листа), план — входит.
              </p>
              <YearlongKindSelect dept={String(row.dept ?? '')} ppNum={row.id} className="mt-2" />
            </div>
          )}

          {/* История строки: журнал правок + снимки + срезы недель (канон п.75в).
              Ленивая: запрос уходит только при раскрытии секции. */}
          <div>
            <SectionTitle>История строки</SectionTitle>
            <RowTimelineSection deptId={deptId} sheetRow={rowIndex} />
          </div>

          {/* Происхождение: где именно лежит первичка */}
          <p className="text-[10px] text-zinc-400 dark:text-zinc-500 border-t border-zinc-100 dark:border-zinc-700/50 pt-3">
            {rowIndex > 0
              ? `Все числа взяты из книги управления ${deptName || ''} — строка ${rowIndex} листа закупок. Адреса ячеек указаны рядом с показателями.`
              : 'Адрес строки в книге неизвестен: числа показаны как пришли от сервера.'}
          </p>
        </div>
      </div>
    </div>
  );
}
