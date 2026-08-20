/**
 * Сигналы книги карточками диагноста (канон п.53, спека §5).
 *
 * КАРТОЧКА ДИАГНОСТА — ЭТО ТРИ ВЕЩИ, И БЕЗ ЛЮБОЙ ИЗ НИХ ОНА БЕСПОЛЕЗНА:
 * механизм («отчего так вышло»), АДРЕС («где именно») и действие («что
 * сделать»). Сигнал без адреса заставляет читателя искать иголку в
 * трёхстах семидесяти строках и потому не будет разобран никогда.
 *
 * ТОН — МЕХАНИЗМ, НЕ УПРЁК (п.104). Красный цвет достаётся важности сигнала,
 * а не человеку, который заполнял книгу; в подписях нет ни «ошибки
 * заполнения», ни «нарушения».
 *
 * Адреса сворачиваются: тридцать адресов в развёрнутом виде хоронят под
 * собой остальные сигналы. Число сказано на кнопке, список — под ней.
 */
import { AlertTriangle, ChevronDown, Info } from 'lucide-react';
import { useState } from 'react';
import type { MonitoringSignal } from '../../lib/monitoring/contract';
import { fmtCount, pluralCount } from '../../lib/monitoring/format';

/** Порядок важности — сверху то, что меняет числа, снизу то, что мешает читать. */
const SEVERITY_ORDER = ['high', 'medium', 'low'];

const SEVERITY_LABEL: Record<string, string> = {
  high: 'Меняет числа',
  medium: 'Искажает разрезы',
  low: 'Мешает читать',
};

const SEVERITY_TONE: Record<string, string> = {
  high: 'border-red-200 dark:border-red-900/60',
  medium: 'border-amber-200 dark:border-amber-900/60',
  low: 'border-zinc-200 dark:border-zinc-700',
};

function SignalCard({ s }: { s: MonitoringSignal }) {
  const [open, setOpen] = useState(false);
  const Icon = s.severity === 'high' ? AlertTriangle : Info;
  return (
    <li className={`rounded-xl border bg-white dark:bg-zinc-800/60 p-3 ${SEVERITY_TONE[s.severity] ?? SEVERITY_TONE.low}`}>
      <div className="flex items-start gap-2">
        <Icon
          size={13}
          aria-hidden="true"
          className={`mt-0.5 shrink-0 ${s.severity === 'high' ? 'text-red-600 dark:text-red-400' : 'text-amber-600 dark:text-amber-400'}`}
        />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium text-zinc-800 dark:text-zinc-100">
            {s.title}
            <span className="ml-1.5 tabular-nums text-[10px] font-normal text-zinc-400 dark:text-zinc-500">
              {pluralCount(s.count, 'случай', 'случая', 'случаев')}
            </span>
          </p>
          <p className="mt-1 text-[11px] leading-relaxed text-zinc-600 dark:text-zinc-300">{s.mechanism}</p>
          {s.action !== '' && (
            <p className="mt-1 text-[11px] leading-relaxed text-zinc-700 dark:text-zinc-200">
              <span className="text-zinc-400 dark:text-zinc-500">Что сделать: </span>{s.action}
            </p>
          )}
          {s.addresses.length > 0 && (
            <>
              <button
                type="button"
                onClick={() => setOpen((v) => !v)}
                aria-expanded={open}
                className="mt-1.5 inline-flex items-center gap-1 text-[10px] text-zinc-500 dark:text-zinc-400 hover:underline"
              >
                <ChevronDown size={10} aria-hidden="true" className={open ? 'rotate-180' : ''} />
                {open ? 'скрыть адреса' : `показать адреса (${fmtCount(s.addresses.length)})`}
              </button>
              {open && (
                <ul className="mt-1 space-y-0.5 font-mono text-[10px] text-zinc-500 dark:text-zinc-400 max-h-60 overflow-y-auto">
                  {s.addresses.map((a) => <li key={a}>{a}</li>)}
                </ul>
              )}
            </>
          )}
        </div>
      </div>
    </li>
  );
}

export interface SignalCardsProps {
  signals: readonly MonitoringSignal[];
}

export function SignalCards({ signals }: SignalCardsProps) {
  const groups = SEVERITY_ORDER
    .map((sev) => ({ sev, items: signals.filter((s) => s.severity === sev) }))
    .filter((g) => g.items.length > 0);
  const rest = signals.filter((s) => !SEVERITY_ORDER.includes(s.severity));
  if (rest.length > 0) groups.push({ sev: 'other', items: rest });

  return (
    <section aria-label="Сигналы книги" className="space-y-3">
      <div>
        <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">
          Сигналы книги — {pluralCount(signals.length, 'класс', 'класса', 'классов')}
        </h2>
        <p className="mt-0.5 text-[11px] text-zinc-500 dark:text-zinc-400 max-w-3xl">
          Каждый сигнал — механизм расхождения и адреса ячеек, по которым его видно в книге.
          Это не оценка работы отдела: почти все они возникают от того, что книгу ведут руками
          в таблице без проверок ввода.
        </p>
      </div>
      {groups.map((g) => (
        <div key={g.sev}>
          <p className="text-[10px] font-medium uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
            {SEVERITY_LABEL[g.sev] ?? 'Прочее'}
          </p>
          <ul className="mt-1.5 grid gap-2 md:grid-cols-2">
            {g.items.map((s) => <SignalCard key={s.id || s.title} s={s} />)}
          </ul>
        </div>
      ))}
    </section>
  );
}
