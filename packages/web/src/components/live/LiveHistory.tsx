import { productLabel } from '@aemr/shared';
/** Трёхстрочный эфирный барабан и серверный журнал с контрольного среза.
 * Перечитываем при открытии, раскрытии и принятом чтении источников; SSE и
 * подтверждение уведомления не сбрасывают серверный накопленный итог. */
import { useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import { useLiveEvents, type RowChange } from '../../hooks/useLiveEvents';
import { useStore } from '../../store';
import { fetchChangeStory, type ChangeStoryResponse } from '../../lib/changes/change-story-client';
import { entryAddress, entryChangeLine, entryWhoWhen } from './change-story-text';


/** Сколько правок показывает раскрытый журнал: дальше — вкладка «Объяснения». */
const JOURNAL_SHOWN = 30;


/** «09:15:20» — момент правки местным временем, с секундами: эфир живой. */
function fmtClock(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—:—:—';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** «09:15» — момент последнего чтения книги, без секунд. */
function fmtHm(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—:—';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** Пустое значение в правке — читателю честнее слово, чем дыра. */
const val = (s: string): string => (s.trim() === '' ? 'пусто' : s);

export function LiveHistory() {
  const live = useLiveEvents();
  const lastRefreshed = useStore((s) => s.lastRefreshed);
  const [open, setOpen] = useState(false);
  const [readGeneration, setReadGeneration] = useState(0);
  const [journal, setJournal] = useState<ChangeStoryResponse | null>(null);
  const [journalFailed, setJournalFailed] = useState(false);
  /** Момент последнего удачного чтения журнала (мс) — подпись «журнал на чч:мм». */
  const [journalAt, setJournalAt] = useState<number | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  const history = live.history ?? [];

  // Перечитываем при первом открытии страницы, раскрытии и принятом чтении.
  // Закрытие, подтверждение уведомлений и отдельные события SSE не запрашивают журнал.
  // Прежний список на время чтения остаётся на экране — раскрытие не мигает
  // «Читаем…» поверх уже известных правок.
  useEffect(() => {
    let alive = true;
    setJournalFailed(false);
    fetchChangeStory({ limit: JOURNAL_SHOWN })
      .then((d) => {
        if (!alive) return;
        setJournal(d);
        setJournalAt(Date.now());
      })
      .catch(() => { if (alive) setJournalFailed(true); });
    return () => { alive = false; };
  }, [readGeneration, lastRefreshed]);

  // Закрытие по щелчку вне угла и по Escape — панель не должна залипать.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // Молчание в тишине: ни одной правки с открытия вкладки — предмета нет.
  // Первый серверный ответ виден и без SSE; отсутствие чтения не равно нулю.

  const visible = history.length > 0 ? history.slice(-3) : (journal?.entries ?? []).slice(0, 3).reverse().map((e) => ({
    book: e.book, sheetRow: e.sheetRow ?? 0, column: e.column ?? '', columnLabel: e.columnLabel ?? undefined,
    before: e.before, after: e.after, at: e.at ?? '',
  }));
  const recalcMs = live.recalculatedThrough ? Date.parse(live.recalculatedThrough) : null;
  /** Серая ступень: правка новее последнего пересчёта — в числах её ещё нет. */
  const isGray = (r: RowChange): boolean =>
    history.length > 0 && (recalcMs === null || Date.parse(r.at) > recalcMs);

  const incomplete = journalFailed || (journal?.gaps.length ?? 0) > 0;
  const summary = journalFailed ? 'Журнал не прочитан' : incomplete ? 'Сведения неполны' : journal === null ? 'Читаем журнал…' : `${journal.total} записей журнала с контрольного среза`;

  const toggle = () => {
    if (!open) setReadGeneration((n) => n + 1);
    setOpen((v) => !v);
  };

  return (
    <div ref={boxRef} className="lh-corner">
      <div
        role="button"
        tabIndex={0}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={`Эфир: ${summary}. Раскрыть журнал изменений`}
        title="Последние правки в книгах. Нажмите — раскрыть журнал: что менялось, было → стало, кто правил"
        className="lh-drum"
        onClick={toggle}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
        }}
      >
        {visible.map((r, i) => (
          <div
            key={`${r.book}-${r.sheetRow}-${r.column}-${r.at}-${i}`}
            className={clsx(
              'lh-row',
              visible.length === 3 && i === 0 && 'lh-row-first',
              visible.length >= 2 && i === visible.length - 1 && 'lh-row-last',
              isGray(r) && 'lh-gray',
            )}
            title={isGray(r)
              ? 'Правка увидена; числа пересчитываются — строка нальётся цветом, когда пересчёт закончится'
              : history.length > 0 ? 'Правка учтена: числа на экране её уже содержат' : 'Запись серверного журнала с контрольного среза'}
          >
            <span className="lh-t">{fmtClock(r.at)}</span>
            <span className="lh-b">{productLabel(r.book)}</span>
            <span className="lh-s">
              {r.columnLabel ?? r.column} {val(r.before)} → <b>{val(r.after)}</b>
            </span>
          </div>
        ))}
        <div className="lh-count">
          {journal !== null && !incomplete ? <><span className="lh-count-n">{journal.total}</span>{' '}записей журнала с контрольного среза</> : summary}
          {journal !== null ? ` · ${journal.since}` : ''}
          {lastRefreshed ? ` · чтение ${fmtHm(lastRefreshed)}` : ''}
          <span className="lh-open">журнал {open ? '▴' : '▾'}</span>
        </div>
      </div>

      {open && (
        <div
          role="dialog"
          aria-label="Журнал изменений: правки книг, было и стало, авторы"
          className={clsx(
            'absolute right-0 top-[calc(100%+6px)] z-50 rounded-lg p-3',
            'w-[min(400px,calc(100vw-16px))]',
            'bg-[var(--surface-overlay)] text-[var(--ink)] shadow-lg',
            'ring-1 ring-black/5 dark:ring-white/10',
          )}
        >
          <div className="mb-2 text-[11px] font-medium text-[var(--ink-strong)]">
            Что изменилось
            {journal !== null && (
              <span className="font-normal text-[var(--ink-faint)]"> · последние {journal.entries.length}</span>
            )}
            {/* Возраст списка — словами: журнал перечитан при этом раскрытии,
                и подпись называет момент чтения, а не оставляет его угадывать. */}
            {journalAt !== null && (
              <span className="font-normal text-[var(--ink-faint)]"> · журнал на {fmtHm(new Date(journalAt).toISOString())}</span>
            )}
          </div>

          {journal?.gaps.map((gap, i) => <p key={i} className="text-[10px] text-amber-700">Сведения неполны: {gap.detail}</p>)}
          {journalFailed ? (
            <p className="text-[10px] leading-snug text-amber-700 dark:text-amber-400">
              Журнал правок не прочитан — сервер не ответил. Это не «правок не было».
            </p>
          ) : journal === null ? (
            <p className="text-[10px] text-[var(--ink-faint)] leading-snug">Читаем журналы книг…</p>
          ) : journal.entries.length === 0 ? (
            <p className="text-[10px] text-[var(--ink-muted)] leading-snug">
              {incomplete ? 'Часть источников недоступна — отсутствие записей не означает отсутствие изменений.' : 'С контрольного среза записей журнала не зафиксировано.'}
            </p>
          ) : (
            <ul className="space-y-0.5 max-h-[300px] overflow-y-auto">
              {journal.entries.map((r, i) => (
                <li
                  key={`${r.id}-${i}`}
                  title={`${entryAddress(r)} · ${entryChangeLine(r)} · ${entryWhoWhen(r)}`}
                  className="flex items-baseline gap-1.5 text-[10px] leading-snug whitespace-nowrap overflow-hidden"
                >
                  <span className="shrink-0 tabular-nums text-[var(--ink-faint)]">{r.at?.slice(11, 16) ?? '—'}</span>
                  <span className="shrink-0 font-medium text-[var(--ink-strong)]">{productLabel(r.book)}</span>
                  <span className="shrink-0 text-[var(--ink-muted)]">{entryAddress(r)}</span>
                  <span className="min-w-0 truncate">{entryChangeLine(r)}</span>
                  <span className="ml-auto shrink-0 text-[9px] text-[var(--ink-faint)] max-w-[90px] truncate">
                    {entryWhoWhen(r)}
                  </span>
                </li>
              ))}
            </ul>
          )}

          <p className="mt-2 pt-1.5 border-t border-[var(--line-card)] text-[9px] leading-snug text-[var(--ink-faint)] whitespace-normal">
            Удаления строк журнал книги не пишет — их ловит сравнение двух чтений.
            Полная история с адресами и поиском — в узле провенанса, «Весь журнал изменений».
          </p>
        </div>
      )}
    </div>
  );
}
