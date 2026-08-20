// ── Момент чтения: когда именно прочитаны книги, из которых взято число ──────
//
//    Механизм М2 атласа. Болезнь, ради которой он существует, названа в карте
//    «Реестра» (§4-П0-1): период на странице честен, «момент чтения книг нет
//    нигде на странице». Число без момента выглядит вечным — читатель принимает
//    его за сегодняшнее, хотя книга могла не читаться с утра.
//
//    Главное правило (канон п.53 «честная пустота», п.104 «родословная»):
//
//        НЕЗНАНИЕ МОМЕНТА — НЕ СВЕЖЕСТЬ.
//
//    Сервер не назвал момент — так и пишем: «момент чтения неизвестен». Писать
//    в этом месте «на сейчас» или «только что» означает выдать молчание за
//    подтверждённую свежесть; такой же дефект уже разбирался в узле провенанса
//    (`components/live/provenance-text.ts`), и формулировка здесь та же
//    намеренно — одна фраза продукта на одно состояние.
//
//    Три состояния, а не два:
//      • эфир    — числа на текущее состояние книг, момент чтения известен;
//      • срез    — архивный день (сверка требует одного момента у обеих сторон,
//                  канон п.64(г));
//      • незнание — момента нам не сообщили.

// Относительная фраза («3 минуты назад») уже живёт в текстах прямого эфира и
// согласована по-русски. Заводить вторую такую же в lib означало бы два дома
// одной подписи — ровно то, что канон п.112 запрещает. Модуль чистый, разметки
// и React в нём нет.
import { relativeMoment } from '../components/live/live-text';

// ── Контракт ────────────────────────────────────────────────────────────────

export type ReadingMomentKind = 'live' | 'snapshot' | 'unknown';

export interface ReadingMoment {
  readonly kind: ReadingMomentKind;
  /** Короткая подпись для бейджа: «на сейчас», «срез на 14.08.2026». */
  readonly label: string;
  /** Полная фраза для подсказки: «книги прочитаны 3 минуты назад (14.08 09:12)». */
  readonly phrase: string;
  /** ISO момента, когда он известен; иначе `null` — и это видно снаружи. */
  readonly iso: string | null;
  /**
   * Числа успели остыть: момент чтения дальше порога. Незнание остывшим НЕ
   * считается — у незнания нет возраста, о нём сказано отдельным состоянием.
   */
  readonly stale: boolean;
}

export interface ReadingMomentInput {
  /**
   * День архивного среза (Date либо «ГГГГ-ММ-ДД»). Задан — числа показаны на
   * тот день; нечитаемое значение срезом не считается.
   */
  asOf?: Date | string | null;
  /**
   * Момент чтения книг. `null` — сервер его не назвал (честное незнание);
   * ключ вообще не передан — вызывающий эту ось не заявлял, и подпись
   * остаётся прежней «на сейчас».
   */
  readAt?: Date | string | null;
  /** Порог остывания в минутах; по умолчанию час. */
  staleAfterMinutes?: number;
  /** Точка отсчёта для относительной фразы (тесты задают явно). */
  now?: number;
}

// ── Готовые подписи ─────────────────────────────────────────────────────────

/** Эфир: числа на текущее состояние книг. */
export const LIVE_MOMENT_LABEL = 'на сейчас';

/** Незнание. Дословно та же фраза, что в узле провенанса, — одна на продукт. */
export const UNKNOWN_MOMENT_LABEL = 'момент чтения неизвестен';

const DEFAULT_STALE_MINUTES = 60;

// ── Разбор ──────────────────────────────────────────────────────────────────

/**
 * Дата из того, что пришло. Голая «ГГГГ-ММ-ДД» читается как местная полночь:
 * иначе день среза на восточной долготе съезжает на сутки назад.
 */
function parseMoment(value: Date | string | null | undefined): Date | null {
  if (value == null || value === '') return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00` : value;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** «14.08.2026» — день человеку. */
function dayHuman(date: Date): string {
  return date.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

/** «14.08.2026 09:12» — день и час: без часа «прочитано сегодня» ничего не значит. */
function dayTimeHuman(date: Date): string {
  const time = date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  return `${dayHuman(date)} ${time}`;
}

// ── Сборка ──────────────────────────────────────────────────────────────────

/**
 * ЕДИНСТВЕННЫЙ способ назвать момент чтения словами. Вкладка не сочиняет фразу
 * сама и не подставляет «только что» вместо молчания сервера.
 */
export function readingMoment(input: ReadingMomentInput = {}): ReadingMoment {
  const snapshot = parseMoment(input.asOf);
  if (snapshot) {
    const day = dayHuman(snapshot);
    return {
      kind: 'snapshot',
      label: `срез на ${day}`,
      phrase: `архивный срез на ${day} — числа показаны на тот день, а не на сейчас`,
      iso: snapshot.toISOString(),
      stale: false,
    };
  }

  // Ось не заявлена вовсе: вызывающий про момент чтения ничего не сказал.
  // Это не молчание сервера, а отсутствие вопроса, — прежняя подпись эфира.
  if (!('readAt' in input)) {
    return {
      kind: 'live',
      label: LIVE_MOMENT_LABEL,
      phrase: 'числа на текущее состояние книг',
      iso: null,
      stale: false,
    };
  }

  const readAt = parseMoment(input.readAt);
  if (!readAt) {
    // Правило (б): незнание отличается от свежести. Никакого «только что».
    return {
      kind: 'unknown',
      label: UNKNOWN_MOMENT_LABEL,
      phrase: 'момент чтения книг неизвестен — сервер его не назвал',
      iso: null,
      stale: false,
    };
  }

  const now = input.now ?? Date.now();
  const iso = readAt.toISOString();
  const minutes = (now - readAt.getTime()) / 60_000;
  const threshold = input.staleAfterMinutes ?? DEFAULT_STALE_MINUTES;
  const stale = minutes >= threshold;
  const ago = relativeMoment(iso, now);

  return {
    kind: 'live',
    // Пока числа свежие, бейджу хватает канонического «на сейчас»; как только
    // они остыли, короткая подпись обязана сказать об этом сама — читатель
    // бейджа до подсказки может и не добраться.
    label: stale ? `прочитано ${ago}` : LIVE_MOMENT_LABEL,
    phrase: `книги прочитаны ${ago} (${dayTimeHuman(readAt)})`,
    iso,
    stale,
  };
}
