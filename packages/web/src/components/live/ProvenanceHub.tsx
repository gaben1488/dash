/**
 * Узел провенанса в правом верхнем углу шапки (канон п.133).
 *
 * Требование владельца дословно: «понятно написанный, одновременно
 * показывающий всё и вместе с тем лаконичный провенанс и изменения — на
 * верхней линейке в правом верхнем углу справа от кнопки снятия фильтра и
 * смены темы».
 *
 * Отсюда двухслойность: в линейке живёт одна тихая строка («обновлено 3 мин
 * назад» плюс значок правок, если они были) — это «лаконично»; по щелчку
 * раскрывается панель, где сразу видно всё: откуда числа, каким способом они
 * обновляются, что изменилось в книгах с прошлого раза и какие именно строки
 * правили. Панель не всплывает по наведению: провенанс читают осознанно, а
 * случайное перекрытие шапки раздражает.
 *
 * Тексты — в provenance-text.ts под стражами: подписи здесь суть обещания
 * продукта, а не украшение.
 */
import { useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import { Database, ListTree } from 'lucide-react';
import type { ChangeDigest, ChangeGap } from '@aemr/core';
import { useStore } from '../../store';
import { useLiveEvents } from '../../hooks/useLiveEvents';
import { relativeMoment } from './live-text';
import { changeLines, newIssuesLine, provenancePill, refreshModeLine } from './provenance-text';
import { DELETION_NOTE, digestLines, emptinessLine } from './change-story-text';
import { ChangeJournal } from './ChangeJournal';
import { fetchChangeStory } from '../../lib/changes/change-story-client';
import { parseRefreshPassport, type RefreshPassport } from '../../pages/Settings.logic';
import { fetchJSON } from '../../api';

/** Как часто перерисовывать относительное время. Раз в 15 с — «только что» не врёт. */
const TICK_MS = 15_000;

/** Сколько правок строк показывать в панели: больше — это уже журнал, он на своей вкладке. */
const ROWS_SHOWN = 6;

export function ProvenanceHub({ className }: { className?: string }) {
  const lastRefreshed = useStore((s) => s.lastRefreshed);
  const live = useLiveEvents();
  const [, tick] = useState(0);
  const [open, setOpen] = useState(false);
  const [passport, setPassport] = useState<RefreshPassport | null>(null);
  const [passportAsked, setPassportAsked] = useState(false);
  const [journalOpen, setJournalOpen] = useState(false);
  // Свод журнала изменений: тот же ответ, что кормит подробную глубину, но
  // взятый с limit=1 — из него нужен только digest, а список правок остаётся
  // на своём экране. Спрашивается ОДИН раз и только при открытии панели.
  const [digest, setDigest] = useState<ChangeDigest | null>(null);
  const [digestGaps, setDigestGaps] = useState<readonly ChangeGap[]>([]);
  const [digestFailed, setDigestFailed] = useState(false);
  const [digestAsked, setDigestAsked] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const timer = setInterval(() => tick((n) => n + 1), TICK_MS);
    return () => clearInterval(timer);
  }, []);

  // Паспорт режима спрашивается один раз и только при открытии панели: в
  // свёрнутом виде он не нужен, а лишний запрос на каждой странице — плата
  // без пользы.
  useEffect(() => {
    if (!open || passportAsked) return;
    setPassportAsked(true);
    let alive = true;
    void fetchJSON<unknown>('/api/sources')
      .then((data) => { if (alive && data) setPassport(parseRefreshPassport(data)); })
      .catch(() => { /* молчание источника — честное «неизвестно» в тексте */ });
    return () => { alive = false; };
  }, [open, passportAsked]);

  // Свод правок — по той же причине и тем же образцом, что паспорт режима.
  useEffect(() => {
    if (!open || digestAsked) return;
    setDigestAsked(true);
    let alive = true;
    void fetchChangeStory({ limit: 1 })
      .then((story) => {
        if (!alive) return;
        setDigest(story.digest);
        setDigestGaps(story.gaps);
      })
      .catch(() => {
        // Молчание сервера НЕ показывается как «правок не было»: панель
        // скажет об отказе словами, а не пустотой.
        if (alive) setDigestFailed(true);
      });
    return () => { alive = false; };
  }, [open, digestAsked]);

  // Закрытие по щелчку вне узла и по Escape — панель не должна залипать.
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

  const pill = provenancePill(live, lastRefreshed);
  const mode = refreshModeLine(
    passport === null ? null : passport.webhookConfigured,
    passport === null ? null : passport.autoRefreshMinutes,
    passport === null ? null : passport.workWindowLabel,
  );
  const changes = changeLines(live.books);
  const issues = newIssuesLine(live.newIssues);

  return (
    <div ref={boxRef} className={clsx('relative', className)}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={pill.title}
        aria-expanded={open}
        aria-label={pill.title}
        className={clsx(
          'flex items-center gap-1 h-[22px] px-1.5 rounded-md text-[10px] whitespace-nowrap',
          'transition-colors duration-150 cursor-pointer select-none',
          open
            ? 'bg-[var(--surface-raised)] text-[var(--ink)]'
            : 'text-[var(--ink-faint)] hover:text-[var(--ink-muted)] hover:bg-[var(--surface-raised)]',
        )}
      >
        <span
          aria-hidden="true"
          className={clsx(
            'inline-block w-1.5 h-1.5 rounded-full',
            pill.live ? 'bg-emerald-500/70' : 'bg-[var(--ink-faint)]/50',
          )}
        />
        <span>{pill.moment}</span>
        {pill.changes > 0 && (
          <span
            aria-hidden="true"
            className="ml-0.5 px-1 rounded-full bg-[var(--surface-sunken)] text-[var(--ink-muted)] text-[9px] font-medium tabular-nums"
          >
            {pill.changes}
          </span>
        )}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Провенанс: откуда числа и что изменилось"
          className={clsx(
            'absolute right-0 top-[26px] z-50 w-[320px] rounded-lg p-3',
            'bg-[var(--surface-overlay)] text-[var(--ink)] shadow-lg',
            'ring-1 ring-black/5 dark:ring-white/10',
          )}
        >
          <div className="flex items-center gap-1.5 mb-2 text-[11px] font-medium text-[var(--ink-strong)]">
            <Database size={11} aria-hidden="true" />
            Откуда числа
          </div>

          <Row label="Момент чтения" detail={pill.moment.replace(/^обновлено /, '')} />
          <Row label={mode.label} detail={mode.detail} />
          <Row
            label="Прямой эфир"
            detail={pill.live
              ? 'открыт — правки в книгах приходят сами'
              : 'недоступен: числа обновляются по таймеру и по кнопке'}
          />

          {/* ── Краткая глубина журнала изменений (требование 21.08) ──
              Четыре фразы вместо счётчика: сколько правок, в скольких книгах,
              скольких закупок коснулись, каких родов, кем и когда. Полный
              список с адресами — кнопкой ниже, на своём экране. */}
          <div className="mt-2.5 mb-1.5 text-[11px] font-medium text-[var(--ink-strong)]">
            Что изменилось с последнего среза
          </div>

          {digestFailed ? (
            <p className="text-[10px] leading-snug text-amber-700 dark:text-amber-400">
              Журнал изменений не прочитан — сервер не ответил. Это не «правок не было».
            </p>
          ) : digest === null ? (
            <p className="text-[10px] text-[var(--ink-faint)] leading-snug">Читаем журналы книг…</p>
          ) : (
            <>
              <ul className="space-y-0.5">
                {digestLines(digest).map((line, i) => (
                  <li
                    key={line}
                    className={clsx(
                      'text-[10px] leading-snug',
                      i === 0 ? 'text-[var(--ink)] font-medium' : 'text-[var(--ink-muted)]',
                    )}
                  >
                    {line}
                  </li>
                ))}
              </ul>
              {emptinessLine(digest, digestGaps) !== null && (
                <p className="mt-1 text-[10px] leading-snug text-[var(--ink-faint)]">
                  {emptinessLine(digest, digestGaps)}
                </p>
              )}
            </>
          )}

          <button
            type="button"
            onClick={() => { setJournalOpen(true); setOpen(false); }}
            className={clsx(
              'mt-2 w-full flex items-center justify-center gap-1.5 h-[24px] rounded-md',
              'text-[10px] text-[var(--ink-muted)] bg-[var(--surface-raised)]',
              'hover:text-[var(--ink)] transition-colors',
            )}
          >
            <ListTree size={11} aria-hidden="true" />
            Весь журнал изменений — с адресами и поиском
          </button>

          {changes.length > 0 && (
            <>
              <div className="mt-2.5 mb-1 text-[11px] font-medium text-[var(--ink-strong)]">
                Прямо сейчас
              </div>
              <ul className="space-y-1">
                {changes.map((c) => (
                  <li key={c.label} className="text-[10px] leading-snug">
                    <span className="text-[var(--ink-strong)] font-medium">{c.label}</span>
                    <span className="text-[var(--ink-muted)]"> — {c.detail}</span>
                  </li>
                ))}
              </ul>
            </>
          )}

          {issues !== null && (
            <p className="mt-1.5 text-[10px] leading-snug text-amber-700 dark:text-amber-400">{issues}</p>
          )}

          {live.recentRows.length > 0 && (
            <>
              <div className="mt-2.5 mb-1 text-[11px] font-medium text-[var(--ink-strong)]">
                Последние правки строк
              </div>
              <ul className="space-y-0.5">
                {live.recentRows.slice(0, ROWS_SHOWN).map((r, i) => (
                  <li key={`${r.book}-${r.sheetRow}-${r.column}-${i}`} className="text-[10px] leading-snug text-[var(--ink-muted)]">
                    <span className="text-[var(--ink)]">{r.book}</span>
                    {' · '}
                    {/* Адрес строки по № п/п (п.98б): позиционный номер устаревает
                        при перемещениях, поэтому он идёт вторым, а не первым. */}
                    {r.rowSeq ? `№ ${r.rowSeq}` : `строка ${r.sheetRow}`}
                    {' · '}
                    {r.columnLabel ?? r.column}
                    {': '}
                    <span className="line-through opacity-60">{trim(r.before)}</span>
                    {' → '}
                    <span className="text-[var(--ink-strong)]">{trim(r.after)}</span>
                    {r.author ? <span className="opacity-70"> · {r.author}</span> : null}
                    <span className="opacity-60"> · {relativeMoment(r.at)}</span>
                  </li>
                ))}
              </ul>
              {live.recentRows.length > ROWS_SHOWN && (
                <p className="mt-1 text-[10px] text-[var(--ink-faint)]">
                  Показаны {ROWS_SHOWN} из {live.recentRows.length}; полный список — в журнале изменений.
                </p>
              )}
            </>
          )}

          {/* Граница источника произносится вслух ВСЕГДА, а не только при
              нулях: читатель обязан знать её до того, как сделает вывод. */}
          <p className="mt-2.5 pt-2 border-t border-[var(--border-subtle)] text-[10px] leading-snug text-[var(--ink-faint)]">
            {DELETION_NOTE}
          </p>
        </div>
      )}

      <ChangeJournal open={journalOpen} onClose={() => setJournalOpen(false)} />
    </div>
  );
}

function Row({ label, detail }: { label: string; detail: string }) {
  return (
    <p className="text-[10px] leading-snug mb-1">
      <span className="text-[var(--ink-faint)]">{label}: </span>
      <span className="text-[var(--ink-muted)]">{detail}</span>
    </p>
  );
}

/** Значение ячейки в одну строку списка: длинные тексты режутся, пустота видна. */
function trim(v: string): string {
  const s = String(v ?? '').trim();
  if (s === '') return '«пусто»';
  return s.length > 18 ? `${s.slice(0, 17)}…` : s;
}

