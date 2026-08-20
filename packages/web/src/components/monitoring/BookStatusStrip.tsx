/**
 * Полоса состояния книги — одна строка над всем остальным.
 *
 * Отвечает на вопрос, который читатель задаёт первым и обычно не получает
 * ответа: НАСКОЛЬКО ПОЛНО прочитан источник. Четырнадцать листов в книге, из
 * них одиннадцать несут данные, три — только форму. Прочитано меньше —
 * недостающие называются поимённо, а счётчики честно объявляются неполными.
 *
 * Это НЕ ошибка и не тревога: лист может не ответить по сети, а лист-предок
 * данных не имеет по природе. Поэтому тон — состояние источника, а красный
 * цвет достаётся только настоящему отказу чтения.
 */
import { AlertTriangle, BookOpen, RotateCcw } from 'lucide-react';
import type { MonitoringPayload } from '../../lib/monitoring/contract';
import { ANCESTOR_SHEET_NAMES } from '../../lib/monitoring/contract';
import { fmtCount, pluralCount } from '../../lib/monitoring/format';

/** Всего листов в книге: 11 с данными + 3 скрытых предка. */
const SHEETS_IN_BOOK = 14;

export interface BookStatusStripProps {
  data: MonitoringPayload;
  /** Сколько строк реестра прочитано (до применения разрезов). */
  rowsTotal: number;
  onReload: () => void;
}

export function BookStatusStrip({ data, rowsTotal, onReload }: BookStatusStripProps) {
  const failed = Object.entries(data.source.sheetsFailed);

  // Что из книги доехало до экрана. Разделы, которых сервер ещё не отдаёт,
  // называются вслух — иначе «прочитано 8 из 14» выглядело бы отказом сети,
  // хотя на деле это незаконченная труба чтения.
  const missing: string[] = [];
  if (data.svod === null) missing.push('«СВОДНЫЙ»');
  if (data.journal === null) missing.push('«25-26»');
  if (data.directory === null) missing.push('«Перечень ГРБС»');

  const readCount = data.source.sheetsRead.length
    + (data.svod !== null ? 1 : 0)
    + (data.journal !== null ? 1 : 0)
    + (data.directory !== null ? 1 : 0);

  const signals = data.signals ?? [];
  const bySeverity = {
    high: signals.filter((s) => s.severity === 'high').length,
    medium: signals.filter((s) => s.severity === 'medium').length,
    low: signals.filter((s) => s.severity === 'low').length,
  };

  return (
    <section
      aria-label="Состояние книги-источника"
      className="bg-white dark:bg-zinc-800/60 rounded-xl border border-zinc-100 dark:border-zinc-700/50 px-4 py-3 text-xs text-zinc-600 dark:text-zinc-300"
    >
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <span className="inline-flex items-center gap-1.5 font-medium text-zinc-700 dark:text-zinc-200">
          <BookOpen size={13} aria-hidden="true" />
          Прочитано {fmtCount(readCount)} из {SHEETS_IN_BOOK} листов книги
        </span>
        <span className="tabular-nums">{pluralCount(rowsTotal, 'строка', 'строки', 'строк')} реестра</span>
        {signals.length > 0 && (
          <span className="tabular-nums">
            сигналов: {signals.length}
            {bySeverity.high > 0 && ` · высшей важности ${bySeverity.high}`}
            {bySeverity.medium > 0 && ` · средней ${bySeverity.medium}`}
            {bySeverity.low > 0 && ` · низкой ${bySeverity.low}`}
          </span>
        )}
        <span className="text-zinc-400 dark:text-zinc-500">
          {ANCESTOR_SHEET_NAMES.length + 1} листа книги скрыты и данных не несут — показаны формой
        </span>
      </div>

      {missing.length > 0 && (
        <p className="mt-2 text-zinc-500 dark:text-zinc-400">
          Ещё не приходят с сервера: {missing.join(', ')}. Режимы этих листов открываются
          и честно говорят, чего именно ждут, — счётчики выше их не учитывают.
        </p>
      )}

      {failed.length > 0 && (
        <div className="mt-2 flex items-start gap-2 rounded-lg bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 px-3 py-2">
          <AlertTriangle size={13} className="text-amber-600 dark:text-amber-400 mt-px shrink-0" aria-hidden="true" />
          <div className="text-amber-800 dark:text-amber-300">
            <p>
              Листы не прочитались:{' '}
              {failed.map(([sheet, reason]) => `${sheet} (${reason})`).join('; ')}. Числа
              ниже собраны по остальным листам и потому неполные.
            </p>
            <button
              type="button"
              onClick={onReload}
              className="mt-1 inline-flex items-center gap-1 font-medium hover:underline"
            >
              <RotateCcw size={11} aria-hidden="true" /> Прочитать книгу ещё раз
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
