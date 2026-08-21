/**
 * ChangeJournal — ПОДРОБНАЯ глубина журнала изменений (требование владельца
 * 21.08.2026: «и кратко, и вместе с тем подробно, необходимо и достаточно
 * увидеть, что именно поменялось»).
 *
 * Краткая глубина живёт в узле провенанса шапки (ProvenanceHub): четыре фразы,
 * которые читаются одним взглядом. Отсюда открывается вторая — полный список
 * правок с адресами, отбором и поиском.
 *
 * ЧТО ЗДЕСЬ ОБЯЗАТЕЛЬНО ЕСТЬ И ПОЧЕМУ:
 *
 *   • АДРЕС ПО № П/П. Не «строка 155», а «№ п/п 38»: строки листа двигаются от
 *     вставок и сортировок, и позиционный номер завтра указывает на другую
 *     закупку (канон п.98б). Запись, у которой источник ключа не дал, честно
 *     говорит об этом, а не подставляет номер строки под видом № п/п.
 *
 *   • ГРАНИЦА ИСТОЧНИКА ВСЛУХ. Журнал книги удаление строки НЕ ВИДИТ: закупка,
 *     убранная через меню таблицы, уходит без единой правки ячейки. Об этом
 *     сказано на экране всегда, а не только когда пропаж не нашлось.
 *
 *   • ЧЕСТНАЯ ПУСТОТА. «Правок не было» и «журнал не прочитан» — разные
 *     сообщения. Пустой список после отказа сервера был бы прямой ложью.
 *
 *   • ПРОВАЛ В РЕЕСТР. Из строки журнала можно уйти к самой закупке: отбор
 *     Реестра принимает № п/п поиском по колонке A, поэтому переход несёт
 *     книгу и номер, а не «примерно туда».
 *
 * Тексты — в change-story-text.ts под стражами. Компонент рисует, тот файл
 * решает, ЧТО написано.
 */
import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import clsx from 'clsx';
import { RefreshCw, Search, X } from 'lucide-react';
import { CHANGE_KIND_ORDER, type ChangeEntry, type ChangeKind } from '@aemr/core';
import { useStore } from '../../store';
import { useChangeStory } from '../../hooks/useChangeStory';
import {
  DELETION_NOTE,
  digestLines,
  emptinessLine,
  entryAddress,
  entryChangeLine,
  entryWhoWhen,
  kindLabel,
  originNote,
  shownLine,
} from './change-story-text';
import { relativeMoment } from './live-text';

/** Сколько правок просить у сервера. Больше человек не листает. */
const LIMIT = 400;

/** Окна, между которыми переключается читатель. */
const WINDOWS: ReadonlyArray<{ key: string; label: string; days: number | null }> = [
  { key: 'week', label: 'неделя', days: 7 },
  { key: 'month', label: 'месяц', days: 30 },
  { key: 'quarter', label: 'три месяца', days: 92 },
  { key: 'all', label: 'всё, что есть', days: null },
];

/** Дата N дней назад в форме YYYY-MM-DD. null — окно не ограничено. */
function sinceOf(days: number | null): string | undefined {
  if (days === null) return '2020-01-01';
  const d = new Date(Date.now() - days * 86400000);
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function ChangeJournal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigateTo = useStore((s) => s.navigateTo);

  const [windowKey, setWindowKey] = useState('week');
  const [books, setBooks] = useState<string[]>([]);
  const [kinds, setKinds] = useState<ChangeKind[]>([]);
  const [author, setAuthor] = useState<string>('');
  const [search, setSearch] = useState('');
  // Поиск догоняющий: журнал в тридцать тысяч строк не перечитывается на
  // каждую букву.
  const [searchApplied, setSearchApplied] = useState('');

  useEffect(() => {
    const timer = setTimeout(() => setSearchApplied(search), 350);
    return () => clearTimeout(timer);
  }, [search]);

  const query = useMemo(() => ({
    since: sinceOf(WINDOWS.find((w) => w.key === windowKey)?.days ?? 7),
    books,
    kinds,
    authors: author === '' ? [] : [author],
    search: searchApplied,
    limit: LIMIT,
  }), [windowKey, books, kinds, author, searchApplied]);

  const { response, entries, loading, error, readAt, reload } = useChangeStory(query, open);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const digest = response?.digest ?? null;
  const gaps = response?.gaps ?? [];
  const facets = response?.facets ?? { books: [], authors: [] };
  const empty = digest === null ? null : emptinessLine(digest, gaps);

  const toggleBook = (book: string) =>
    setBooks((prev) => (prev.includes(book) ? prev.filter((b) => b !== book) : [...prev, book]));
  const toggleKind = (kind: ChangeKind) =>
    setKinds((prev) => (prev.includes(kind) ? prev.filter((k) => k !== kind) : [...prev, kind]));

  /**
   * Провал к закупке в Реестре. Ведёт № п/п: отбор Реестра ищет его по
   * колонке A. Если ключа нет, ведём предметом — это хуже точного адреса, и
   * потому второй, а не первый.
   */
  const drillTo = (entry: ChangeEntry) => {
    const needle = entry.rowSeq ?? entry.subject ?? '';
    if (needle === '') return;
    navigateTo('data', { department: entry.book, search: needle });
    onClose();
  };

  /**
   * ПОЧЕМУ ПОРТАЛ, А НЕ ПРОСТО `fixed`. Узел провенанса живёт в шапке, а у
   * шапки `backdrop-blur` (index.css, .header-glass). Размытие фона делает
   * элемент точкой отсчёта для потомков с `position: fixed` — панель на весь
   * экран схлопнулась бы в полоску шапки. Поэтому она выносится в тело
   * страницы, где «весь экран» действительно означает весь экран.
   */
  return createPortal((
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Журнал изменений: что именно поменялось"
      className="fixed inset-0 z-[100] flex items-start justify-center bg-black/40 backdrop-blur-[2px] p-4 sm:p-8"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-4xl max-h-full flex flex-col rounded-xl bg-[var(--surface-overlay)] text-[var(--ink)] shadow-2xl ring-1 ring-black/10 dark:ring-white/10">

        {/* ── Шапка: что это и когда прочитано ── */}
        <div className="flex items-start gap-3 px-4 pt-3.5 pb-3 border-b border-[var(--border-subtle)]">
          <div className="flex-1 min-w-0">
            <h2 className="text-[13px] font-semibold text-[var(--ink-strong)]">Журнал изменений</h2>
            {digest !== null && (
              <ul className="mt-1 space-y-0.5">
                {digestLines(digest).map((line, i) => (
                  <li
                    key={line}
                    className={clsx(
                      'text-[11px] leading-snug',
                      i === 0 ? 'text-[var(--ink)] font-medium' : 'text-[var(--ink-muted)]',
                    )}
                  >
                    {line}
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-1 text-[10px] text-[var(--ink-faint)]">
              {readAt === null ? 'журнал ещё не прочитан' : `прочитано ${relativeMoment(readAt)}`}
              {response?.comparison
                ? ` · пропажи найдены сравнением снимков ${response.comparison.beforeAt.slice(0, 10)} и ${response.comparison.afterAt.slice(0, 10)}`
                : ''}
            </p>
          </div>
          <button
            type="button"
            onClick={reload}
            title="Перечитать журнал"
            aria-label="Перечитать журнал"
            className="p-1.5 rounded-md text-[var(--ink-faint)] hover:text-[var(--ink)] hover:bg-[var(--surface-raised)]"
          >
            <RefreshCw size={13} className={clsx(loading && 'animate-spin')} aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="Закрыть журнал"
            className="p-1.5 rounded-md text-[var(--ink-faint)] hover:text-[var(--ink)] hover:bg-[var(--surface-raised)]"
          >
            <X size={14} aria-hidden="true" />
          </button>
        </div>

        {/* ── Отбор: окно, книга, род, автор, поиск ── */}
        <div className="px-4 py-2.5 border-b border-[var(--border-subtle)] space-y-2">
          <FilterRow label="Окно">
            {WINDOWS.map((w) => (
              <Chip key={w.key} active={windowKey === w.key} onClick={() => setWindowKey(w.key)}>
                {w.label}
              </Chip>
            ))}
          </FilterRow>

          {facets.books.length > 0 && (
            <FilterRow label="Книга">
              {facets.books.map((b) => (
                <Chip key={b.book} active={books.includes(b.book)} onClick={() => toggleBook(b.book)}>
                  {b.book} <span className="opacity-60 tabular-nums">{b.count}</span>
                </Chip>
              ))}
            </FilterRow>
          )}

          <FilterRow label="Род правки">
            {CHANGE_KIND_ORDER.map((k) => {
              const count = digest?.byKind[k] ?? 0;
              if (count === 0 && !kinds.includes(k)) return null;
              return (
                <Chip key={k} active={kinds.includes(k)} onClick={() => toggleKind(k)}>
                  {kindLabel(k)} <span className="opacity-60 tabular-nums">{count}</span>
                </Chip>
              );
            })}
          </FilterRow>

          <div className="flex flex-wrap items-center gap-2">
            {facets.authors.length > 0 && (
              <label className="flex items-center gap-1.5 text-[10px] text-[var(--ink-faint)]">
                Автор
                <select
                  value={author}
                  onChange={(e) => setAuthor(e.target.value)}
                  className="text-[11px] px-1.5 py-1 rounded-md bg-[var(--surface-raised)] text-[var(--ink)] border border-[var(--border-subtle)]"
                >
                  <option value="">кто угодно</option>
                  {facets.authors.map((a) => (
                    <option key={a.author} value={a.author}>{a.author} ({a.count})</option>
                  ))}
                </select>
              </label>
            )}
            <label className="flex items-center gap-1.5 flex-1 min-w-[180px]">
              <Search size={12} className="text-[var(--ink-faint)]" aria-hidden="true" />
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="поиск по предмету закупки, № п/п, значению"
                aria-label="Поиск по предмету закупки"
                className="flex-1 text-[11px] px-2 py-1 rounded-md bg-[var(--surface-raised)] text-[var(--ink)] border border-[var(--border-subtle)] placeholder:text-[var(--ink-faint)]"
              />
            </label>
          </div>
        </div>

        {/* ── Список правок ── */}
        <div className="flex-1 overflow-y-auto px-4 py-2">
          {error !== null && (
            <p className="mb-2 text-[11px] leading-snug text-amber-700 dark:text-amber-400">{error}</p>
          )}

          {loading && entries.length === 0 && (
            <p className="text-[11px] text-[var(--ink-faint)]">Читаем журналы книг…</p>
          )}

          {!loading && entries.length === 0 && error === null && (
            <p className="text-[11px] leading-snug text-[var(--ink-muted)]">
              {empty ?? 'В выбранном окне и отборе правок нет.'}
            </p>
          )}

          <ul className="divide-y divide-[var(--border-subtle)]">
            {entries.map((e) => (
              <li key={e.id} className="py-1.5 flex items-start gap-2">
                <div className="flex-1 min-w-0">
                  <p className="text-[10px] text-[var(--ink-faint)] truncate" title={entryAddress(e)}>
                    {entryAddress(e)}
                  </p>
                  <p className="text-[11px] leading-snug text-[var(--ink)] break-words">
                    {entryChangeLine(e)}
                  </p>
                  <p className="text-[10px] text-[var(--ink-faint)]">
                    {entryWhoWhen(e)} · {originNote(e)}
                  </p>
                </div>
                {(e.rowSeq !== null || e.subject !== null) && (
                  <button
                    type="button"
                    onClick={() => drillTo(e)}
                    className="shrink-0 mt-0.5 px-1.5 py-0.5 rounded-md text-[10px] text-[var(--ink-muted)] hover:text-[var(--ink)] hover:bg-[var(--surface-raised)]"
                    title="Открыть эту закупку в Реестре"
                  >
                    в Реестре
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>

        {/* ── Подвал: сколько показано и чего источник не видит ── */}
        <div className="px-4 py-2.5 border-t border-[var(--border-subtle)] space-y-1">
          {response !== null && (
            <p className="text-[10px] text-[var(--ink-muted)]">{shownLine(entries.length, response.total)}</p>
          )}
          {gaps.map((g) => (
            <p key={`${g.book}-${g.reason}`} className="text-[10px] leading-snug text-amber-700 dark:text-amber-400">
              {g.detail}
            </p>
          ))}
          <p className="text-[10px] leading-snug text-[var(--ink-faint)]">{DELETION_NOTE}</p>
        </div>
      </div>
    </div>
  ), document.body);
}

function FilterRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2">
      <span className="shrink-0 pt-1 text-[10px] text-[var(--ink-faint)] w-[74px]">{label}</span>
      <div className="flex flex-wrap gap-1">{children}</div>
    </div>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={clsx(
        'px-1.5 py-0.5 rounded-md text-[10px] whitespace-nowrap transition-colors',
        active
          ? 'bg-[var(--ink)] text-[var(--surface-overlay)]'
          : 'bg-[var(--surface-raised)] text-[var(--ink-muted)] hover:text-[var(--ink)]',
      )}
    >
      {children}
    </button>
  );
}
