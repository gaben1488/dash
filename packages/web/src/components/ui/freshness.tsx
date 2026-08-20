// ── Доверие к числу: свежесть и состояние сверки.
//
//    ЧТО ВЗЯТО ГОТОВЫМ (канон п.112). Это не библиотека, а разобранная
//    практика зрелых панелей аналитики — и взято из неё ровно три решения,
//    каждое из которых мы бы иначе выдумывали заново и хуже:
//
//    1. СОСТОЯНИЙ ШЕСТЬ, А НЕ ЧЕТЫРЕ. Обычно рисуют «хорошо / устарело /
//       сбой», и в этой тройке нет места двум самым частым случаям:
//       «проверить не удалось» и «проверка не настроена». У dbt (Data
//       Health Signals) они разведены намеренно, и разведены не из
//       педантизма: именно они дают ложное спокойствие. Число, которое
//       никто не сверял, выглядит в тройке точно так же, как сверенное.
//
//    2. ОТСУТСТВИЕ ДОКАЗАТЕЛЬСТВА — ЭТО «ОСТОРОЖНО», А НЕ «ХОРОШО».
//       Правило dbt: жёлтым помечается не только сработавшая проверка, но
//       и ненастроенная. Мы приняли его дословно — `uncovered` и
//       `unmeasurable` идут тревожным тоном, а не нейтральным.
//
//    3. ОДИН ЗНАЧОК НА КАРТОЧКУ, ПО НАИХУДШЕМУ. Гирлянда значков на
//       плитке — узнаваемая болезнь панелей; лечится тем, что показывают
//       ровно один, самый тяжёлый, а остальное отдают раскрытию. Поэтому
//       здесь есть `worstState` и нет способа поставить в ряд пять меток.
//
//    ЧТО НАДСТРОЕНО (канон п.114). Готовая практика знает про «свежесть
//    таблицы»; наш читатель спрашивает не про таблицу, а про то, можно ли
//    нести это число начальнику. Отсюда два обязательства, которых в
//    источнике нет и которые здесь держит система типов:
//
//    • ПРИЧИНА ОБЯЗАТЕЛЬНА ВСЕГДА. Метка без причины — цвет ради цвета.
//    • ДЛЯ ЛЮБОГО НЕБЛАГОПОЛУЧНОГО СОСТОЯНИЯ ОБЯЗАТЕЛЬНО «ЧТО ДЕЛАТЬ»
//      (правило «сигнал без действия в интерфейс не выпускается»). Тип
//      `FreshnessBad` не собирается без поля `whatToDo`, поэтому забыть
//      его нельзя — это не договорённость, а проверка компилятора.

import clsx from 'clsx';
import type { DataTone } from './tokens';

/** Шесть состояний. Порядок в перечне — порядок тяжести, по возрастанию. */
export type FreshnessState =
  /** Сверено с источником вручную и совпало. */
  | 'verified'
  /** Прочитано недавно, сверка проходила. */
  | 'fresh'
  /** Прочитано давно: источник мог уйти вперёд. */
  | 'stale'
  /** Сверка прошла и не сошлась. */
  | 'failed'
  /** Сверку запускали, но она не смогла дать ответ. */
  | 'unmeasurable'
  /** Сверка для этого числа не настроена вовсе. */
  | 'uncovered';

/** Тяжесть состояния — по ней выбирается единственный показанный значок. */
const SEVERITY: Readonly<Record<FreshnessState, number>> = {
  verified: 0,
  fresh: 1,
  uncovered: 2,
  unmeasurable: 3,
  stale: 4,
  failed: 5,
};

interface StateFace {
  word: string;
  tone: DataTone;
}

/**
 * Слово и тон каждого состояния.
 *
 * Слово несёт смысл целиком: на чёрно-белой печати и у читателя, не
 * различающего красный, останется только оно.
 */
const FACE: Readonly<Record<FreshnessState, StateFace>> = {
  verified: { word: 'сверено', tone: 'good' },
  fresh: { word: 'свежее', tone: 'good' },
  // Ненастроенная и несостоявшаяся сверка идут тревожным тоном намеренно:
  // «мы не знаем» — это не «всё хорошо».
  uncovered: { word: 'сверка не настроена', tone: 'warn' },
  unmeasurable: { word: 'сверить не удалось', tone: 'warn' },
  stale: { word: 'устарело', tone: 'warn' },
  failed: { word: 'не сошлось', tone: 'bad' },
};

/** Благополучные состояния: причина нужна, действие — нет. */
interface FreshnessGood {
  state: 'verified' | 'fresh';
  /** Отчего так считаем: «прочитано 18.08 в 09:14, лист не менялся». */
  reason: string;
  whatToDo?: never;
}

/** Неблагополучные: без «что делать» не собирается. */
interface FreshnessBad {
  state: 'stale' | 'failed' | 'unmeasurable' | 'uncovered';
  reason: string;
  /**
   * Что читателю делать. Действие, а не упрёк: «нажать „Обновить“ —
   * снимок старше суток», не «данные устарели».
   */
  whatToDo: string;
}

export type FreshnessInfo = FreshnessGood | FreshnessBad;

export interface FreshnessMarkProps {
  info: FreshnessInfo;
  /** Момент чтения: «18.08, 09:14». Число без момента — не число (п.58). */
  readAt?: string;
  className?: string;
}

/**
 * Метка доверия к числу. Одна на карточку.
 *
 * Причина и действие уезжают в `title` и в текст для диктора целиком: они
 * не украшение подсказки, а единственное, ради чего метка существует.
 */
export function FreshnessMark({ info, readAt, className }: FreshnessMarkProps) {
  const face = FACE[info.state];
  const full = info.whatToDo ? `${info.reason}. ${info.whatToDo}` : info.reason;

  return (
    <span
      className={clsx('inline-flex items-baseline gap-1 ds-text-3xs', className)}
      title={full}
      data-freshness={info.state}
    >
      {/* Точка — только отражение слова. Слово стоит рядом всегда, поэтому
          метка не пропадает ни на чёрно-белой печати, ни у читателя, не
          различающего красный. */}
      <span
        aria-hidden="true"
        className="inline-block h-1.5 w-1.5 shrink-0 translate-y-[-0.1em] rounded-full"
        style={{ backgroundColor: `var(--data-${face.tone})` }}
      />
      <span style={{ color: `var(--data-${face.tone})` }}>{face.word}</span>
      {readAt && (
        <span className="tabular-nums text-[var(--ink-faint)]">· {readAt}</span>
      )}
      {/* Причина и действие — диктору целиком: он не наведёт мышь на title. */}
      <span className="sr-only">. {full}</span>
    </span>
  );
}

/**
 * Самое тяжёлое из нескольких состояний.
 *
 * Нужно ровно затем, чтобы на карточке стоял ОДИН значок, а не гирлянда:
 * карточка собирает состояния своих чисел и показывает худшее, а полный
 * перечень отдаёт раскрытию.
 */
export function worstState(states: readonly FreshnessState[]): FreshnessState | null {
  if (states.length === 0) return null;
  return states.reduce((worst, next) => (SEVERITY[next] > SEVERITY[worst] ? next : worst));
}

/** Слово состояния — для мест, где метка не нужна, а слово нужно. */
export function freshnessWord(state: FreshnessState): string {
  return FACE[state].word;
}

/** Тон состояния — для мест, где раскраску делает вызывающий. */
export function freshnessTone(state: FreshnessState): DataTone {
  return FACE[state].tone;
}
