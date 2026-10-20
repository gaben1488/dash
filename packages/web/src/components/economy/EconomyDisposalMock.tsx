// Пять состояний утверждены владельцем 22.08 (owner-week, п.86).
// Демонстрационные суммы в рублях; форматтер Dash принимает тысячи рублей.
// Запись финансовых решений требует подтверждённого источника, прав и хранилища.

import clsx from 'clsx';
import { useState } from 'react';
import { FlaskConical, SendHorizonal } from 'lucide-react';
import { CHROME_BOX, Card, FOCUS_RING, SectionHead, TILE } from './primitives';

/** Ключи статусов свободной экономии (постановка вопроса 72). */
export type DisposalStatusKey = 'free' | 'keptByGrbs' | 'takenByUfbp' | 'disputed' | 'returned';

export interface DisposalStatusMock {
  key: DisposalStatusKey;
  /** Короткое имя статуса — заголовок мини-карточки и подпись доли. */
  label: string;
  /** МАКЕТ: иллюстративная сумма, рублей. */
  amount: number;
  /** Объяснение словами: механизм + кто распоряжается + что дальше (тон п.53). */
  explain: string;
  /** Цвет сегмента стек-бара (inline, чтобы Tailwind не потерял класс). */
  fill: string;
  /** Классы точки-легенды и акцента карточки. */
  dot: string;
  text: string;
}

/**
 * МАКЕТ: иллюстративные суммы по статусам. Не данные — реквизит для
 * скриншота владельцу (п.101д). Порядок = жизнь суммы: от «решения нет»
 * к «вернулась в бюджет».
 */
export const DISPOSAL_MOCK: readonly DisposalStatusMock[] = [
  {
    key: 'free',
    label: 'Свободна — решения нет',
    amount: 12_400_000, // МАКЕТ
    explain:
      'Экономия утверждена, но её судьбу ещё никто не решал. Сумма числится '
      + 'за строкой-источником и ждёт: либо заявки ГРБС на перераспределение, '
      + 'либо решения УФ об изъятии.',
    fill: '#3b82f6',
    dot: 'bg-blue-500',
    text: 'text-blue-600 dark:text-blue-400',
  },
  {
    key: 'keptByGrbs',
    label: 'Оставлена ГРБС',
    amount: 8_100_000, // МАКЕТ
    explain:
      'УФ решил не забирать — дальше распоряжается сам ГРБС и распределяет '
      + 'сумму внутри своих закупок (п.99/68). В книге управления появятся '
      + 'строки-приёмники на эти деньги.',
    fill: '#10b981',
    dot: 'bg-emerald-500',
    text: 'text-emerald-600 dark:text-emerald-400',
  },
  {
    key: 'takenByUfbp',
    label: 'Изъята УФ',
    amount: 5_600_000, // МАКЕТ
    explain:
      'Финансовый орган забрал экономию: деньги отданы другому ГРБС или '
      + 'в резерв района. У управления-источника этой суммы больше нет — '
      + 'распоряжаться ею оно не может.',
    fill: '#a855f7',
    dot: 'bg-purple-500',
    text: 'text-purple-600 dark:text-purple-400',
  },
  {
    key: 'disputed',
    label: 'Спорная',
    amount: 2_300_000, // МАКЕТ
    explain:
      'ГРБС просит УФ не считать сумму экономией (например, закупка ещё '
      + 'будет доторговываться). Арбитра в споре нет (п.99/71) — пока он не '
      + 'решён, сумма не распределяется и не изымается.',
    fill: '#f59e0b',
    dot: 'bg-amber-500',
    text: 'text-amber-600 dark:text-amber-400',
  },
  {
    key: 'returned',
    label: 'Возвращена в бюджет',
    amount: 3_900_000, // МАКЕТ
    explain:
      'Возврат средств зафиксирован. Исходная позиция и история сохраняются; '
      + 'основание возврата подтверждает ответственный.',
    fill: '#71717a',
    dot: 'bg-zinc-500',
    text: 'text-zinc-600 dark:text-zinc-400',
  },
];

/** Сумма всех статусов — знаменатель долей стек-бара. */
const MOCK_TOTAL = DISPOSAL_MOCK.reduce((s, r) => s + r.amount, 0);

export function EconomyDisposalMock({ formatMoney }: { formatMoney: (v: number) => string }) {
  const [selected, setSelected] = useState<DisposalStatusKey>('free');
  const selectedStatus = DISPOSAL_MOCK.find(row => row.key === selected)!;
  return (
    <Card accent="purple">
      <SectionHead
        icon={<FlaskConical size={12} className="text-purple-500/70" />}
        title="Распоряжение экономией"
        hint="куда уходит свободная экономия после утверждения"
        right={
          // Честная пометка макета: числа не из книг, а из констант — блок
          // финансовые решения и исходные книги этот макет не изменяет.
          <span
            className="shrink-0 inline-flex items-center px-1.5 py-0.5 rounded-md text-xs font-bold uppercase tracking-wider bg-purple-500/10 text-purple-600 dark:text-purple-400 ring-1 ring-inset ring-purple-500/20"
            title="Демонстрационные данные. Пять состояний утверждены; запись решений пока не подключена."
          >
            Интерактивный макет
          </span>
        }
      />

      <div className="px-4 py-3 space-y-4">
        <p className="text-sm text-zinc-500">Демонстрационные данные · всего {formatMoney(MOCK_TOTAL / 1000)}. Выберите состояние, чтобы увидеть порядок действий.</p>
        {/* ── Стек-бар долей: одна полоса, пять сегментов ── */}
        <div
          role="img"
          aria-label={DISPOSAL_MOCK
            .map(r => `${r.label}: ${((r.amount / MOCK_TOTAL) * 100).toFixed(1).replace('.', ',')} %`)
            .join(', ')}
          title="Доли статусов от всей утверждённой экономии (данные иллюстративные)"
          className="w-full h-2.5 rounded-full overflow-hidden flex bg-zinc-200 dark:bg-zinc-800/40"
        >
          {DISPOSAL_MOCK.map(r => (
            <div
              key={r.key}
              className="h-full transition-all duration-500"
              style={{ width: `${(r.amount / MOCK_TOTAL) * 100}%`, background: r.fill }}
            />
          ))}
        </div>

        {/* ── Мини-карточки статусов: сумма + доля + объяснение словами ── */}
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-2">
          {DISPOSAL_MOCK.map(r => (
            <button
              type="button"
              aria-pressed={selected === r.key}
              onClick={() => setSelected(r.key)}
              key={r.key}
              // Плитку статуса отделяет светлота поверхности, не обводка (п.129).
              className={clsx(TILE, FOCUS_RING, 'min-h-32 px-3 py-3 space-y-2 text-left', selected === r.key && 'ring-2 ring-purple-500/60')}
            >
              <div className="flex items-center gap-1.5">
                <span className={clsx('w-1.5 h-1.5 rounded-full shrink-0', r.dot)} aria-hidden="true" />
                <span className="text-sm font-semibold text-zinc-700 dark:text-zinc-300 leading-tight">
                  {r.label}
                </span>
              </div>
              <div className="flex flex-wrap items-baseline gap-1.5">
                <span className={clsx('text-lg font-bold tabular-nums', r.text)}>
                  {formatMoney(r.amount / 1000)}
                </span>
                <span className="text-xs text-zinc-500 tabular-nums">
                  {((r.amount / MOCK_TOTAL) * 100).toFixed(1).replace('.', ',')} %
                </span>
              </div>
              <p className="text-xs text-zinc-500 leading-relaxed">{r.explain}</p>
            </button>
          ))}
        </div>

        <div className="rounded-xl bg-purple-500/5 p-4 text-sm space-y-2" aria-live="polite">
          <p className="font-semibold">Выбрано: {selectedStatus.label}</p>
          <p>{selectedStatus.explain}</p>
          <p className="text-zinc-500">Связь решения: исходная закупка → заявка ГРБС → решение УФ → получатель или возврат → история. Текст комментария сам по себе не подтверждает финансовое решение.</p>
        </div>
        {/* ── Шов с заявкой на перераспределение (п.99/68-69): кнопка-заглушка.
              Disabled-кнопка не показывает title в части браузеров — тултип
              несёт обёртка, кнопке остаётся aria-disabled и honest disabled. ── */}
        <div className="flex items-center justify-between gap-3 flex-wrap pt-1 border-t border-zinc-200/70 dark:border-white/[0.04]">
          <p className="text-sm text-zinc-500 leading-relaxed max-w-xl">
            Свободная экономия — кандидат на заявку: ГРБС подаёт заявку на
            перераспределение, УФ решает «забирать или нет» (п.99/68).
            Пять состояний согласованы. Отправка станет доступна после подключения
            подтверждённых данных, прав и хранилища решений.
          </p>
          <span title="Отправка недоступна: подтверждённый источник, права и хранилище решений ещё не подключены">
            <button
              type="button"
              disabled
              aria-disabled="true"
              className={clsx(
                'inline-flex items-center gap-1.5 min-h-[44px] px-3 py-2 rounded-lg text-xs font-bold uppercase tracking-wider',
                CHROME_BOX,
                'text-zinc-400 dark:text-zinc-600 cursor-not-allowed',
                FOCUS_RING,
              )}
            >
              <SendHorizonal size={10} aria-hidden="true" />
              Подать заявку на перераспределение
            </button>
          </span>
        </div>
      </div>
    </Card>
  );
}
