/**
 * ProofOverlay — доказательство числа по клику (бриф «Отчёт++», шаг 6).
 *
 * Требование владельца: доказательство БЕЗ переходов в Реестр — читатель
 * остаётся на странице отчёта. Слои сверху вниз ровно те, что назывались:
 * ФОРМУЛА (как получено) → СТРОКИ-АТОМЫ (из чего сложено) → ЯЧЕЙКА
 * (где это лежит в официальном листе).
 *
 * Оверлей ничего не считает сам: он показывает то, что ему дали. Второй
 * дом арифметики завёлся бы мгновенно, а числа обязаны совпадать с теми,
 * что уже напечатаны на странице.
 */
import { useEffect } from 'react';
import { X, FileSpreadsheet } from 'lucide-react';
import { productLabel } from '@aemr/shared';

/** Одна строка-атом доказательства: откуда взялось слагаемое. */
export interface ProofRow {
  /** Лист книги ГРБС. */
  sheet: string;
  /** Номер строки листа, как видит человек. */
  row: number;
  /** Предмет закупки — чтобы строка узнавалась без открытия книги. */
  subject: string;
  /** Подвед; пусто — само управление. */
  subordinate?: string;
  /** Вклад строки в число. */
  value: number;
  /** Адрес ячейки, из которой взят вклад. */
  cell?: string;
}

export interface ProofData {
  /** Ключ показателя — подпись берётся из словаря продукта. */
  metricKey: string;
  /** Само число, которое доказываем (уже отформатированное). */
  displayValue: string;
  /** Формула словами: «86,6 % = 2 440 ÷ 2 819 × 100». */
  formula?: string;
  /** Происхождение: пересчёт продукта или ячейка официального листа. */
  origin: 'calc' | 'svod';
  /** Адрес ячейки официального листа, если число оттуда или сверяется с ним. */
  svodCell?: string;
  /** Строки-атомы. Пусто — показываем честную причину, а не пустоту. */
  rows: ProofRow[];
  /** Почему строк нет (например, число взято с листа целиком). */
  emptyReason?: string;
}

function money(n: number): string {
  return n.toLocaleString('ru-RU', { maximumFractionDigits: 2 });
}

interface Props {
  proof: ProofData | null;
  onClose: () => void;
}

export function ProofOverlay({ proof, onClose }: Props) {
  // Escape закрывает оверлей: доказательство — не ловушка, выход всегда рядом.
  useEffect(() => {
    if (!proof) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [proof, onClose]);

  if (!proof) return null;

  const total = proof.rows.reduce((s, r) => s + r.value, 0);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-zinc-900/40 p-4 backdrop-blur-sm"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="mt-12 w-full max-w-3xl rounded-xl border border-zinc-200 bg-white shadow-xl dark:border-transparent dark:bg-zinc-900"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={`Доказательство: ${productLabel(proof.metricKey)}`}
      >
        <div className="flex items-start justify-between gap-4 border-b border-zinc-100 px-5 py-3.5 dark:border-zinc-700/60">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-zinc-400">Доказательство</div>
            <h2 className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">
              {productLabel(proof.metricKey)}
            </h2>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-lg font-semibold tabular-nums text-zinc-800 dark:text-zinc-100">
              {proof.displayValue}
            </span>
            <button
              onClick={onClose}
              className="rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800"
              aria-label="Закрыть доказательство"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        <div className="space-y-4 px-5 py-4">
          {/* Слой 1 — формула. */}
          {proof.formula && (
            <section>
              <h3 className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
                Как получено
              </h3>
              <p className="font-mono text-[12px] leading-relaxed text-zinc-700 dark:text-zinc-200">
                {proof.formula}
              </p>
            </section>
          )}

          {/* Слой 2 — строки-атомы. */}
          <section>
            <h3 className="mb-1 flex items-baseline justify-between text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
              <span>Из чего сложено</span>
              {proof.rows.length > 0 && (
                <span className="font-normal normal-case tracking-normal">
                  строк: {proof.rows.length}, сумма {money(total)}
                </span>
              )}
            </h3>
            {proof.rows.length === 0 ? (
              <p className="text-[12px] text-zinc-500 dark:text-zinc-400">
                {proof.emptyReason ??
                  'Строк-слагаемых нет: число взято с официального листа целиком, без пересчёта по строкам.'}
              </p>
            ) : (
              <div className="max-h-72 overflow-y-auto rounded border border-zinc-100 dark:border-transparent">
                <table className="w-full text-[11px]">
                  <thead className="sticky top-0 bg-zinc-50 text-[10px] uppercase tracking-wide text-zinc-400 dark:bg-zinc-800">
                    <tr>
                      <th className="px-2 py-1 text-left font-medium">Лист</th>
                      <th className="px-2 py-1 text-left font-medium">Строка</th>
                      <th className="px-2 py-1 text-left font-medium">Предмет</th>
                      <th className="px-2 py-1 text-left font-medium">Учреждение</th>
                      <th className="px-2 py-1 text-right font-medium">Вклад</th>
                    </tr>
                  </thead>
                  <tbody className="text-zinc-600 dark:text-zinc-300">
                    {proof.rows.map((r) => (
                      <tr
                        key={`${r.sheet}:${r.row}`}
                        className="border-t border-zinc-100 dark:border-zinc-700/40"
                      >
                        <td className="px-2 py-1">{r.sheet}</td>
                        <td className="px-2 py-1 tabular-nums">{r.cell ?? r.row}</td>
                        <td className="px-2 py-1">{r.subject}</td>
                        <td className="px-2 py-1 text-zinc-500">{r.subordinate || 'само управление'}</td>
                        <td className="px-2 py-1 text-right tabular-nums">{money(r.value)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* Слой 3 — где лежит в официальном листе. */}
          <section className="flex items-center gap-2 border-t border-zinc-100 pt-3 text-[11px] text-zinc-500 dark:border-zinc-700/60 dark:text-zinc-400">
            <FileSpreadsheet size={13} className="shrink-0" />
            {proof.origin === 'svod' ? (
              <span>
                Официальное число листа СВОД
                {proof.svodCell ? <>, ячейка <span className="font-mono">{proof.svodCell}</span></> : null}
                {' '}— взято как есть, без пересчёта.
              </span>
            ) : (
              <span>
                Пересчёт продукта по строкам книг
                {proof.svodCell ? (
                  <> ; официальный аналог — ячейка <span className="font-mono">{proof.svodCell}</span></>
                ) : null}
                .
              </span>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
