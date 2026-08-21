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
 *
 * ЛИСТЫ СЧИТАЮТСЯ ОДИН РАЗ. Раньше к `sheetsRead` сервера — а он УЖЕ содержит
 * свод, «25-26» и справочник — прибавлялась ещё единица за каждый непустой
 * раздел ответа, и те же три листа считались дважды. При полном чтении из
 * этого случайно выходило «14 из 14», как будто прочитаны и листы-предки; при
 * неполном число не значило заявленного. Знаменатель называет сервер
 * (`sheetsExpected`), и второго ответа на «сколько всего листов» больше нет.
 *
 * СИГНАЛЫ СЧИТАЮТСЯ ПО ТОМУ ЖЕ СРЕЗУ, ЧТО И КАРТОЧКИ НИЖЕ (канон п.127).
 * Полоса брала все сигналы книги, а `SignalCards` показывала срезанные
 * управлением: читатель видел «сигналов: 12» и три карточки под ними. Число,
 * которое нельзя пересчитать глазами на том же экране, — не число, а слух.
 * Сигналы уровня всей книги при этом не исчезают: их остаток назван отдельно.
 */
import { AlertTriangle, BookOpen, RotateCcw } from 'lucide-react';
import type { MonitoringPayload, MonitoringSignal } from '../../lib/monitoring/contract';
import { ANCESTOR_SHEET_NAMES } from '../../lib/monitoring/contract';
import { fmtCount, pluralCount } from '../../lib/monitoring/format';
import { CARD } from './surfaces';

export interface BookStatusStripProps {
  data: MonitoringPayload;
  /** Сколько строк реестра прочитано (до применения разрезов). */
  rowsTotal: number;
  /**
   * Сигналы В ТОМ ЖЕ СРЕЗЕ, в каком читатель увидит их карточки ниже.
   * Не передан — полоса берёт сигналы книги целиком: это верно там, где среза
   * нет вовсе, и никогда не должно подменять срезанный список.
   */
  scopedSignals?: readonly MonitoringSignal[];
  onReload: () => void;
}

export function BookStatusStrip({
  data, rowsTotal, scopedSignals, onReload,
}: BookStatusStripProps) {
  const failed = Object.entries(data.source.sheetsFailed);

  // Что из книги доехало до экрана. Разделы, которых сервер ещё не отдаёт,
  // называются вслух — иначе «прочитано 8 из 14» выглядело бы отказом сети,
  // хотя на деле это незаконченная труба чтения.
  const missing: string[] = [];
  if (data.svod === null) missing.push('«СВОДНЫЙ»');
  if (data.journal === null) missing.push('«25-26»');
  if (data.directory === null) missing.push('«Перечень ГРБС»');

  // Листы, прочитанные сервером, — как есть. Свод, «25-26» и справочник в этом
  // списке уже стоят: раздел ответа их не добавляет, а лишь говорит, доехал ли
  // разбор до экрана (об этом — строка «Ещё не приходят с сервера»).
  const readCount = data.source.sheetsRead.length;
  const expected = data.source.sheetsExpected;

  const allSignals = data.signals ?? [];
  const signals = scopedSignals ?? allSignals;
  const outsideScope = allSignals.length - signals.length;
  const bySeverity = {
    high: signals.filter((s) => s.severity === 'high').length,
    medium: signals.filter((s) => s.severity === 'medium').length,
    low: signals.filter((s) => s.severity === 'low').length,
  };

  // Предков называет сервер; своя копия — запас, а не источник.
  const ancestorNames = data.ancestors?.sheets.map((s) => s.sheet) ?? ANCESTOR_SHEET_NAMES;

  return (
    <section
      aria-label="Состояние книги-источника"
      className={`${CARD} px-4 py-3 text-xs text-zinc-600 dark:text-zinc-300`}
    >
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <span className="inline-flex items-center gap-1.5 font-medium text-zinc-700 dark:text-zinc-200">
          <BookOpen size={13} aria-hidden="true" />
          {expected === null
            ? `Прочитано ${fmtCount(readCount)} листов книги с данными`
            : `Прочитано ${fmtCount(readCount)} из ${fmtCount(expected)} листов книги с данными`}
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
          {pluralCount(ancestorNames.length, 'лист', 'листа', 'листов')} книги скрыты
          и данных не несут — показаны формой
        </span>
      </div>

      {/* Остаток сигналов за срезом — не пропажа, а другой адрес (п.36, п.127). */}
      {outsideScope > 0 && (
        <p className="mt-1.5 text-zinc-500 dark:text-zinc-400">
          Ещё {pluralCount(outsideScope, 'сигнал', 'сигнала', 'сигналов')} книги
          относятся к другим листам либо к книге целиком (свод, «25-26», справочник) — они
          видны в срезе «все управления». Числа выше пересчитываются по тому же срезу, что и
          карточки сигналов ниже.
        </p>
      )}

      {missing.length > 0 && (
        <p className="mt-2 text-zinc-500 dark:text-zinc-400">
          Ещё не приходят с сервера: {missing.join(', ')}. Режимы этих листов открываются
          и честно говорят, чего именно ждут, — счётчики выше их не учитывают.
        </p>
      )}

      {/* Оговорка об отказе чтения — вложенная поверхность полосы, а не
          управление: в тёмной теме её отделяет светлота тёплой заливки
          (amber-500/10 поверх карточки zinc-800/60 — 1,188 : 1), и коричневая
          обводка amber-800 ей не нужна (п.129). Прежняя заливка amber-950/20
          давала всего 1,016 : 1 — оттого блок и держался на рамке. */}
      {failed.length > 0 && (
        <div className="mt-2 flex items-start gap-2 rounded-lg bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-transparent px-3 py-2">
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
