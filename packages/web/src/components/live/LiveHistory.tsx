/**
 * Эфир-история — мини-барабан последних правок в правом углу шапки
 * (контракт пробы, раздел «угол», пп.10–11 второго круга).
 *
 * УСТРОЙСТВО. Три строки моноширинного набора «чч:мм:сс КНИГА что → стало»
 * живут той же физикой, что большие барабаны линейки: крайние ряды наклонены
 * и утоплены (рецепт tg-row-first/last из index.css), серединный плоский.
 * Прокручивается ТОЛЬКО при настоящем событии эфира (row-changed из
 * useLiveEvents) — никакого таймера, в тишине предмет неподвижен; в полной
 * тишине (ни одной правки с открытия вкладки) он молчит целиком.
 *
 * ДВЕ СТУПЕНИ (п.11). Правка приходит приглушённо-серой: она увидена, но в
 * числах экрана её ещё нет. Когда сервер пересобрал снимок (snapshot-rebuilt,
 * recalculatedThrough в useLiveEvents), строка наливается цветом: числа
 * пересчитаны. Так угол честно отличает «заметили» от «учли».
 *
 * ЖУРНАЛ. Нажатие раскрывает панель журнала: правки «было → стало» с
 * зачёркиванием и автором — данные существующим приёмом GET /api/changes
 * (тот же, что кормит ленту правок Отчёта). Язык атрибутов — язык продукта
 * (humanAttribute из ChangesSection), не шапка оператора. Журнал перечитывается
 * ПРИ КАЖДОМ РАСКРЫТИИ (а не один раз на вкладку): вкладка живёт часами, эфир
 * приносит новые правки, а журнал, прочитанный утром, показывал бы утро до
 * перезагрузки страницы. Цена честная — запрос только по жесту читателя,
 * свёрнутый угол сервер не дёргает; момент чтения назван подписью
 * «журнал на чч:мм», чтобы возраст списка не приходилось угадывать.
 *
 * РАЗДЕЛЕНИЕ РОЛЕЙ. Нижняя полоса LiveUpdateBar эфир НЕ дублирует: с 21.08
 * она — только предупреждение о невозможной или сорвавшейся тихой подмене
 * чисел. Показ изменений живёт здесь и в узле провенанса.
 */
import { useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import { useLiveEvents, type RowChange } from '../../hooks/useLiveEvents';
import { useStore } from '../../store';
import { api } from '../../api';
import { countWord, plural } from './live-text';
import { fmtAt, humanAttribute } from '../report/ChangesSection';

/** Сколько правок показывает раскрытый журнал: дальше — вкладка «Объяснения». */
const JOURNAL_SHOWN = 30;

/** Окно счётчика «N правок за час». */
const HOUR_MS = 60 * 60 * 1000;

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

interface JournalRecord {
  dept: string; sheet: string; cell: string; attribute: string;
  oldValue: string; newValue: string; atMs: number; author: string;
}

export function LiveHistory() {
  const live = useLiveEvents();
  const lastRefreshed = useStore((s) => s.lastRefreshed);
  const [open, setOpen] = useState(false);
  const [journal, setJournal] = useState<JournalRecord[] | null>(null);
  const [journalFailed, setJournalFailed] = useState(false);
  /** Момент последнего удачного чтения журнала (мс) — подпись «журнал на чч:мм». */
  const [journalAt, setJournalAt] = useState<number | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  const history = live.history ?? [];

  // Журнал перечитывается при КАЖДОМ раскрытии (см. шапку файла): запрос
  // идёт только по жесту читателя, свёрнутый угол сервер не дёргает.
  // Прежний список на время чтения остаётся на экране — раскрытие не мигает
  // «Читаем…» поверх уже известных правок.
  useEffect(() => {
    if (!open) return;
    let alive = true;
    setJournalFailed(false);
    api.getChanges()
      .then((d) => {
        if (!alive) return;
        setJournal([...d.records].sort((a, b) => b.atMs - a.atMs).slice(0, JOURNAL_SHOWN));
        setJournalAt(Date.now());
      })
      .catch(() => { if (alive) setJournalFailed(true); });
    return () => { alive = false; };
  }, [open]);

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
  if (history.length === 0) return null;

  const visible = history.slice(-3);
  const recalcMs = live.recalculatedThrough ? Date.parse(live.recalculatedThrough) : null;
  /** Серая ступень: правка новее последнего пересчёта — в числах её ещё нет. */
  const isGray = (r: RowChange): boolean =>
    recalcMs === null || Date.parse(r.at) > recalcMs;

  const nowMs = Date.now();
  const perHour = history.filter((r) => nowMs - Date.parse(r.at) < HOUR_MS).length;

  const toggle = () => setOpen((v) => !v);

  return (
    <div ref={boxRef} className="lh-corner">
      <div
        role="button"
        tabIndex={0}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={`Эфир: ${countWord(perHour, 'правка', 'правки', 'правок')} за час. Раскрыть журнал изменений`}
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
              : 'Правка учтена: числа на экране её уже содержат'}
          >
            <span className="lh-t">{fmtClock(r.at)}</span>
            <span className="lh-b">{r.book}</span>
            <span className="lh-s">
              {r.columnLabel ?? r.column} {val(r.before)} → <b>{val(r.after)}</b>
            </span>
          </div>
        ))}
        <div className="lh-count">
          <span className="lh-count-n">{perHour}</span>
          {' '}{plural(perHour, 'правка', 'правки', 'правок')} за час
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
              <span className="font-normal text-[var(--ink-faint)]"> · последние {journal.length}</span>
            )}
            {/* Возраст списка — словами: журнал перечитан при этом раскрытии,
                и подпись называет момент чтения, а не оставляет его угадывать. */}
            {journalAt !== null && (
              <span className="font-normal text-[var(--ink-faint)]"> · журнал на {fmtHm(new Date(journalAt).toISOString())}</span>
            )}
          </div>

          {journalFailed ? (
            <p className="text-[10px] leading-snug text-amber-700 dark:text-amber-400">
              Журнал правок не прочитан — сервер не ответил. Это не «правок не было».
            </p>
          ) : journal === null ? (
            <p className="text-[10px] text-[var(--ink-faint)] leading-snug">Читаем журналы книг…</p>
          ) : journal.length === 0 ? (
            <p className="text-[10px] text-[var(--ink-muted)] leading-snug">
              С даты среза правок в книгах не зафиксировано.
            </p>
          ) : (
            <ul className="space-y-0.5 max-h-[300px] overflow-y-auto">
              {journal.map((r, i) => (
                <li
                  key={`${r.dept}-${r.sheet}-${r.cell}-${r.atMs}-${i}`}
                  className="flex items-baseline gap-1.5 text-[10px] leading-snug whitespace-nowrap overflow-hidden"
                >
                  <span className="shrink-0 tabular-nums text-[var(--ink-faint)]">{fmtAt(r.atMs)}</span>
                  <span className="shrink-0 font-medium text-[var(--ink-strong)]">{r.dept}</span>
                  <span className="shrink-0 text-[var(--ink-muted)]">{humanAttribute(r.cell, r.attribute)}</span>
                  <span className="min-w-0 truncate">
                    <span className="text-[var(--ink-muted)] line-through decoration-red-700/50">{val(r.oldValue)}</span>
                    <span aria-hidden="true" className="text-[var(--ink-faint)]"> → </span>
                    <span className="font-medium text-[var(--ink-strong)]">{val(r.newValue)}</span>
                  </span>
                  <span className="ml-auto shrink-0 text-[9px] text-[var(--ink-faint)] max-w-[90px] truncate">
                    {r.author || 'без подписи'}
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
