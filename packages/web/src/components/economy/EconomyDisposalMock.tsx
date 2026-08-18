// ────────────────────────────────────────────────────────────────
// МАКЕТ «Распоряжение экономией» (канон п.101д, вопрос 72).
//
// Владелец решает по скриншоту: показать, на какие статусы распадается
// свободная экономия, — и только потом он ответит, «какой ещё может быть»
// статус и в какой момент экономия считается погашенной (п.99/72).
// Все числа здесь ИЛЛЮСТРАТИВНЫЕ — из констант ниже, к данным книг блок
// не подключён и подключён быть не может до решения владельца.
//
// Откуда статусы (не выдуманы):
//  • п.99/68 — УФБП решает только «забирать или нет»; что не забрали —
//    распоряжается сам ГРБС → статусы «изъята УФБП» и «оставлена ГРБС»;
//  • п.99/71 — арбитра нет: ГРБС просит УФБП не считать остаток
//    экономией → статус «спорная»;
//  • «решения ещё нет» и «возвращена в бюджет» — крайние точки жизни
//    суммы: до первого решения и после конца года (БК РФ, фронт п.101е).
//
// Почему НЕ lib/economy/disposal.ts: там только текстовая ПОДСВЕТКА
// «похоже на распоряжение» (безопасная версия п.85/12б), категорий
// статусов в ней нет — счёт по статусам появится лишь после решения
// владельца и подтверждения строк человеком. Store не читает — только
// пропсы, как все блоки страницы «Экономия».
// ────────────────────────────────────────────────────────────────

import clsx from 'clsx';
import { FlaskConical, SendHorizonal } from 'lucide-react';
import { Card, FOCUS_RING, SectionHead } from './primitives';

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
      + 'либо решения УФБП об изъятии.',
    fill: '#3b82f6',
    dot: 'bg-blue-500',
    text: 'text-blue-600 dark:text-blue-400',
  },
  {
    key: 'keptByGrbs',
    label: 'Оставлена ГРБС',
    amount: 8_100_000, // МАКЕТ
    explain:
      'УФБП решил не забирать — дальше распоряжается сам ГРБС и распределяет '
      + 'сумму внутри своих закупок (п.99/68). В книге управления появятся '
      + 'строки-приёмники на эти деньги.',
    fill: '#10b981',
    dot: 'bg-emerald-500',
    text: 'text-emerald-600 dark:text-emerald-400',
  },
  {
    key: 'takenByUfbp',
    label: 'Изъята УФБП',
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
      'ГРБС просит УФБП не считать сумму экономией (например, закупка ещё '
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
      'Деньги вернулись в бюджет и в закупках этого года больше не участвуют. '
      + 'Конечная точка: перераспределить возвращённое уже нельзя.',
    fill: '#71717a',
    dot: 'bg-zinc-500',
    text: 'text-zinc-600 dark:text-zinc-400',
  },
];

/** Сумма всех статусов — знаменатель долей стек-бара. */
const MOCK_TOTAL = DISPOSAL_MOCK.reduce((s, r) => s + r.amount, 0);

export function EconomyDisposalMock({ formatMoney }: { formatMoney: (v: number) => string }) {
  return (
    <Card accent="purple">
      <SectionHead
        icon={<FlaskConical size={12} className="text-purple-500/70" />}
        title="Распоряжение экономией"
        hint="куда уходит свободная экономия после утверждения"
        right={
          // Честная пометка макета: числа не из книг, а из констант — блок
          // существует, чтобы владелец решил по скриншоту (п.101д).
          <span className="shrink-0 inline-flex items-center px-1.5 py-0.5 rounded-md text-[9px] font-bold uppercase tracking-wider bg-purple-500/10 text-purple-600 dark:text-purple-400 ring-1 ring-inset ring-purple-500/20">
            макет — данные иллюстративные
          </span>
        }
      />

      <div className="px-4 py-3 space-y-3">
        {/* ── Стек-бар долей: одна полоса, пять сегментов ── */}
        <div
          role="img"
          aria-label={DISPOSAL_MOCK
            .map(r => `${r.label}: ${((r.amount / MOCK_TOTAL) * 100).toFixed(0)} %`)
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
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2">
          {DISPOSAL_MOCK.map(r => (
            <div
              key={r.key}
              className="rounded-lg border border-zinc-200/70 dark:border-white/[0.05] bg-zinc-50/50 dark:bg-white/[0.02] px-2.5 py-2 space-y-1"
            >
              <div className="flex items-center gap-1.5">
                <span className={clsx('w-1.5 h-1.5 rounded-full shrink-0', r.dot)} aria-hidden="true" />
                <span className="text-[10px] font-semibold text-zinc-700 dark:text-zinc-300 leading-tight">
                  {r.label}
                </span>
              </div>
              <div className="flex items-baseline gap-1.5">
                <span className={clsx('text-sm font-bold tabular-nums', r.text)}>
                  {formatMoney(r.amount)}
                </span>
                <span className="text-[9px] text-zinc-500 tabular-nums">
                  {((r.amount / MOCK_TOTAL) * 100).toFixed(0)} %
                </span>
              </div>
              <p className="text-[9px] text-zinc-500 leading-relaxed">{r.explain}</p>
            </div>
          ))}
        </div>

        {/* ── Шов с заявкой на перераспределение (п.99/68-69): кнопка-заглушка.
              Disabled-кнопка не показывает title в части браузеров — тултип
              несёт обёртка, кнопке остаётся aria-disabled и honest disabled. ── */}
        <div className="flex items-center justify-between gap-3 flex-wrap pt-1 border-t border-zinc-200/70 dark:border-white/[0.04]">
          <p className="text-[10px] text-zinc-500 leading-relaxed max-w-xl">
            Свободная экономия — кандидат на заявку: ГРБС подаёт заявку на
            перераспределение, УФБП решает «забирать или нет» (п.99/68).
            Статусы заявок будет вести продукт (п.99/69) — после решения
            владельца по этому макету.
          </p>
          <span title="Кнопка заработает после решения владельца по вопросу 72 — сейчас это макет">
            <button
              type="button"
              disabled
              aria-disabled="true"
              className={clsx(
                'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider',
                'border border-zinc-200/70 dark:border-white/[0.06] text-zinc-400 dark:text-zinc-600',
                'bg-zinc-100/70 dark:bg-white/[0.03] cursor-not-allowed',
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
