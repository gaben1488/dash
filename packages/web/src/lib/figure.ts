// ── Число с паспортом: значение, единица, периметр, происхождение ──────────
//
//    Требование владельца дословно: «гарантии нужны, что в UI/UX правильно
//    посчитанные числа, соответствующие тому, что они считают, и из правильных
//    источников будешь выводить»; «я всегда должен точно понимать, что где
//    считается, по любой карточке, за какой период».
//
//    Отсюда контракт: голое `number` в интерфейс не выходит. Выходит `Figure` —
//    значение вместе с ответами на три вопроса читателя: в чём измерено, за
//    какой периметр посчитано, откуда взялось. Печать — только через
//    `formatFigure`: пока форматирование живёт в каждом компоненте своё, одно
//    и то же число печатается по-разному на соседних экранах, а `null`
//    неизбежно где-нибудь превращается в «0».
//
//    Два закона, которые модуль держит механически:
//
//    1. НЕТ ЗНАМЕНАТЕЛЯ — НЕТ ЧИСЛА. `value: null` печатается причиной («нет
//       плана»), а не нулём. Реестр расхождений §2: ноль вместо «нет базы»
//       давал беспланному управлению штраф 45 баллов и грейд D за «исполнение
//       0 %», а лист в том же месте честно печатает прочерк.
//    2. ПРОЦЕНТЫ НЕ УСРЕДНЯЮТСЯ. Доля существует как `RatioFigure` —
//       числитель и знаменатель — и превращается в проценты только через
//       `toPercent`. Складывать доли можно единственным способом: сложением
//       числителей и знаменателей (`sumRatios`); среднее арифметическое долей
//       управлений — не доля района, а другое число, которое ни на один
//       вопрос не отвечает.

import type { Perimeter } from './perimeter';

// ── Единицы ─────────────────────────────────────────────────────────────────

/**
 * Замкнутый список единиц продукта. «руб.» здесь нет намеренно: книги ведутся
 * в тысячах, и подпись «руб.» вместо «тыс. руб.» уже стоила разбора п.52
 * реестра интервью (каскад «Разница: 50.00 руб.» при разнице 50 тысяч).
 */
export type FigureUnit = 'шт' | 'тыс.руб' | '%' | 'дн';

/** Как единица выглядит в тексте. Ключ — машинный, значение — человеческое. */
const UNIT_TEXT: Readonly<Record<FigureUnit, string>> = {
  'шт': 'шт.',
  'тыс.руб': 'тыс. руб.',
  '%': '%',
  'дн': 'дн.',
};

/** Знаков после запятой по единице: штуки и дни целые, деньги и доли — с десятой. */
const UNIT_DECIMALS: Readonly<Record<FigureUnit, number>> = {
  'шт': 0,
  'тыс.руб': 1,
  '%': 1,
  'дн': 0,
};

// ── Провенанс ───────────────────────────────────────────────────────────────

/** Адрес в книге: лист обязателен, ячейка — когда известна достоверно. */
export interface FigureSourceRef {
  /** Имя ЛИСТА («СВОД ТД-ПМ»). Дефект п.3 интервью: текст проверки без листа. */
  readonly sheet: string;
  /** Ячейка («O237»). Не задана — адрес известен только до листа. */
  readonly cell?: string;
}

export interface FigureProvenance {
  /**
   * Чем посчитано — человеческой фразой («движок: заключено ÷ план по
   * количеству»). Внутренние ключи сюда не попадают: подпись видна читателю.
   */
  readonly engine: string;
  /**
   * Официальный адрес источника, если он ОДИН и известен достоверно.
   * Выдуманного провенанса не бывает: не знаем — не пишем.
   */
  readonly source?: FigureSourceRef;
}

// ── Figure ──────────────────────────────────────────────────────────────────

export interface Figure {
  /** `null` — считать было не из чего; ноль сюда подставлять запрещено. */
  readonly value: number | null;
  readonly unit: FigureUnit;
  readonly perimeter: Perimeter;
  readonly provenance: FigureProvenance;
  /** Причина пустоты человеку: «нет плана», «книга не прочитана». */
  readonly nullReason?: string;
}

/** Причина пустоты по умолчанию — самый частый случай продукта. */
export const NO_PLAN_REASON = 'нет плана';

/**
 * Конструктор с одной проверкой, которую иначе забывают: не-конечное число
 * (NaN от 0/0, Infinity от деления на ноль) — это ОТСУТСТВИЕ значения, а не
 * значение. Пропустить его дальше означает напечатать «NaN %» читателю.
 */
export function figure(input: {
  value: number | null | undefined;
  unit: FigureUnit;
  perimeter: Perimeter;
  provenance: FigureProvenance;
  nullReason?: string;
}): Figure {
  const raw = input.value;
  const ok = typeof raw === 'number' && Number.isFinite(raw);
  return {
    value: ok ? raw : null,
    unit: input.unit,
    perimeter: input.perimeter,
    provenance: input.provenance,
    nullReason: ok ? undefined : (input.nullReason ?? NO_PLAN_REASON),
  };
}

// ── RatioFigure ─────────────────────────────────────────────────────────────

/**
 * Доля до превращения в проценты. Хранит ЧИСЛИТЕЛЬ и ЗНАМЕНАТЕЛЬ, потому что
 * только из них доля складывается правильно: сумма долей — это доля суммы, а
 * не среднее долей.
 */
export interface RatioFigure {
  readonly numerator: number;
  readonly denominator: number;
  /** Единица числителя и знаменателя — она же попадает в подпись при разборе. */
  readonly unit: FigureUnit;
  readonly perimeter: Perimeter;
  readonly provenance: FigureProvenance;
  /** Причина, которую покажет `toPercent` при нулевом знаменателе. */
  readonly nullReason?: string;
}

export function ratio(input: {
  numerator: number;
  denominator: number;
  unit: FigureUnit;
  perimeter: Perimeter;
  provenance: FigureProvenance;
  nullReason?: string;
}): RatioFigure {
  return {
    numerator: input.numerator,
    denominator: input.denominator,
    unit: input.unit,
    perimeter: input.perimeter,
    provenance: input.provenance,
    nullReason: input.nullReason,
  };
}

/**
 * Доля в процентах. Нулевой (или неположительный, или нечисловой) знаменатель
 * даёт `null` с причиной — как прочерк листа `IF(D13=0,"-",E13/D13)`, а не ноль
 * процентов.
 */
export function toPercent(r: RatioFigure, opts?: { decimals?: number }): Figure {
  const decimals = opts?.decimals ?? UNIT_DECIMALS['%'];
  const hasBase = Number.isFinite(r.denominator) && r.denominator > 0 && Number.isFinite(r.numerator);
  const pct = hasBase ? +((r.numerator / r.denominator) * 100).toFixed(decimals) : null;
  return figure({
    value: pct,
    unit: '%',
    perimeter: r.perimeter,
    provenance: r.provenance,
    nullReason: r.nullReason ?? NO_PLAN_REASON,
  });
}

/**
 * ЕДИНСТВЕННЫЙ разрешённый способ сложить доли: сложить числители и
 * знаменатели. Периметр и провенанс берутся у первого слагаемого — складывать
 * доли РАЗНЫХ периметров бессмысленно, и вызывающий обязан это обеспечить.
 * Пустой список — доля без базы (`null` при печати), а не ноль процентов.
 */
export function sumRatios(parts: readonly RatioFigure[], fallback: RatioFigure): RatioFigure {
  const head = parts[0] ?? fallback;
  let numerator = 0;
  let denominator = 0;
  for (const p of parts) {
    if (Number.isFinite(p.numerator)) numerator += p.numerator;
    if (Number.isFinite(p.denominator)) denominator += p.denominator;
  }
  return { ...head, numerator, denominator };
}

// ── Печать ──────────────────────────────────────────────────────────────────

/** Неразрывный пробел: единица не отрывается от числа при переносе строки. */
const NBSP = ' ';

const formatters = new Map<number, Intl.NumberFormat>();
function nf(decimals: number): Intl.NumberFormat {
  let f = formatters.get(decimals);
  if (!f) {
    f = new Intl.NumberFormat('ru-RU', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
    formatters.set(decimals, f);
  }
  return f;
}

/**
 * ЕДИНСТВЕННЫЙ способ напечатать число продукта.
 *
 *   «1 234 шт.» · «137 382,6 тыс. руб.» · «62,0 %» · «нет плана»
 *
 * Пустое значение печатается ПРИЧИНОЙ. Ноль вместо причины запрещён: «0 %»
 * читается как достигнутый результат, а не как отсутствие базы расчёта.
 */
export function formatFigure(f: Figure, opts?: { decimals?: number; withUnit?: boolean }): string {
  if (f.value === null) return f.nullReason ?? NO_PLAN_REASON;

  const decimals = opts?.decimals ?? UNIT_DECIMALS[f.unit];
  const num = nf(decimals).format(f.value);
  if (opts?.withUnit === false) return num;
  return `${num}${NBSP}${UNIT_TEXT[f.unit]}`;
}

/** Единица человеку отдельно от числа — для подписей осей и легенд. */
export function unitText(unit: FigureUnit): string {
  return UNIT_TEXT[unit];
}

/**
 * Провенанс одной строкой для подсказки по наведению:
 * «движок: заключено ÷ план · СВОД ТД-ПМ!O237».
 */
export function provenanceText(p: FigureProvenance): string {
  const addr = p.source
    ? p.source.cell
      ? `${p.source.sheet}!${p.source.cell}`
      : p.source.sheet
    : null;
  return addr ? `${p.engine} · ${addr}` : p.engine;
}
