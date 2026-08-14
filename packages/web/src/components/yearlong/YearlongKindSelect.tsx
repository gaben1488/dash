/**
 * YearlongKindSelect — выпадающий список разметки вида строки стадии
 * «в течение года» (канон п.83а: владелец размечает одним кликом, продукт
 * запоминает; исправить можно в любой момент).
 *
 * Компонент самодостаточен: сам читает и пишет разметку через общий кэш
 * useYearlongKinds. Вставка в карточку строки (RowDetailCard) — задача
 * гейт-агента; здесь только экспорт.
 *
 * Доступность: нативный <select> — полный клавиатурный обход (Tab, стрелки,
 * Enter) и корректное чтение экранным диктором даются платформой; подпись
 * связана через htmlFor, состояние сохранения объявляется aria-live.
 */
import { useId, useState } from 'react';
import {
  YEARLONG_KINDS,
  YEARLONG_SUBCLASS_LABELS,
  isYearlongKindId,
  resolveYearlongKind,
  type YearlongKindId,
} from '@aemr/shared';
import { toCanonicalDeptId } from '../../lib/dept-key';
import { useYearlongKinds } from './useYearlongKinds';

export function YearlongKindSelect({ dept, ppNum, className }: {
  /** Управление в любой форме ключа (латиница DTO или кириллица). */
  dept: string;
  /** № п/п строки (колонка A). */
  ppNum: unknown;
  className?: string;
}) {
  const { overrides, provisional, loading, error, setKind } = useYearlongKinds();
  const selectId = useId();
  const [saving, setSaving] = useState(false);
  const [savedNote, setSavedNote] = useState<string | null>(null);

  const deptCanon = toCanonicalDeptId(dept);
  const pp = String(ppNum ?? '').trim();
  const current = resolveYearlongKind(deptCanon, pp, overrides);
  const isProvisional = provisional.has(`${deptCanon}:${pp}`);

  if (pp === '') {
    // Без № п/п разметку не к чему привязать — честная причина вместо списка.
    return (
      <p className={className ?? 'text-[11px] text-zinc-500 dark:text-zinc-400'}>
        Вид не размечается: в книге не проставлен порядковый номер строки (колонка №&nbsp;п/п) —
        разметка привязывается к нему, а не к номеру строки листа.
      </p>
    );
  }

  const onChange = async (value: string) => {
    const kind: YearlongKindId | null = isYearlongKindId(value) ? value : null;
    setSaving(true);
    setSavedNote(null);
    // Выбор владельца — окончательная разметка (не «предварительная», п.83б).
    const ok = await setKind(deptCanon, pp, kind, false);
    setSaving(false);
    setSavedNote(ok
      ? (kind ? 'Вид сохранён' : 'Разметка снята — вид по стартовой разметке')
      : null);
  };

  return (
    <div className={className}>
      <label
        htmlFor={selectId}
        className="block text-[10px] uppercase tracking-wide text-zinc-400 dark:text-zinc-500 mb-1"
      >
        Вид закупки «в течение года»
      </label>
      <select
        id={selectId}
        value={current ?? ''}
        disabled={loading || saving}
        onChange={(e) => { void onChange(e.target.value); }}
        className="w-full px-2 py-1.5 text-xs rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-800 dark:text-zinc-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:opacity-60"
      >
        <option value="">вид не определён</option>
        {YEARLONG_KINDS.map((k) => (
          <option key={k.id} value={k.id}>
            {k.label} — {YEARLONG_SUBCLASS_LABELS[k.subclass]}
          </option>
        ))}
      </select>
      <p className="mt-1 text-[10px] text-zinc-400 dark:text-zinc-500" aria-live="polite">
        {saving
          ? 'Сохраняем…'
          : error
            ? `Разметка не сохранилась: ${error}`
            : savedNote
              ?? (isProvisional
                ? 'Разметка предварительная (подстраховка) — ваш выбор её заменит.'
                : 'Разметка запоминается для всех экранов; исправить можно в любой момент.')}
      </p>
    </div>
  );
}
