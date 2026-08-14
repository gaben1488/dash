import { describe, it, expect } from 'vitest';
import {
  NO_PLAN_REASON,
  figure,
  formatFigure,
  provenanceText,
  ratio,
  sumRatios,
  toPercent,
  unitText,
  type FigureProvenance,
  type RatioFigure,
} from './figure';
import { DEFAULT_PERIMETER } from './perimeter';

const ENGINE: FigureProvenance = { engine: 'движок: заключено ÷ план' };

/** Неразрывный пробел — тот же, что печатает formatFigure. */
const NBSP = ' ';

function fig(value: number | null, unit: Parameters<typeof figure>[0]['unit'], nullReason?: string) {
  return figure({ value, unit, perimeter: DEFAULT_PERIMETER, provenance: ENGINE, nullReason });
}

function rat(numerator: number, denominator: number, nullReason?: string): RatioFigure {
  return ratio({
    numerator,
    denominator,
    unit: 'шт',
    perimeter: DEFAULT_PERIMETER,
    provenance: ENGINE,
    nullReason,
  });
}

describe('formatFigure — единственный способ печати числа', () => {
  it('печатает штуки целыми, с русским разделителем разрядов', () => {
    expect(formatFigure(fig(2823, 'шт'))).toBe(`2${' '}823${NBSP}шт.`);
  });

  it('деньги подписывает «тыс. руб.» — не «руб.» (первопричина каскада п.52)', () => {
    expect(formatFigure(fig(137382.6, 'тыс.руб'))).toBe(`137${' '}382,6${NBSP}тыс. руб.`);
  });

  it('процент — с десятой и с неразрывным пробелом перед знаком', () => {
    expect(formatFigure(fig(62, '%'))).toBe(`62,0${NBSP}%`);
  });

  it('дни печатаются целыми', () => {
    expect(formatFigure(fig(5, 'дн'))).toBe(`5${NBSP}дн.`);
  });

  it('дробная часть — запятая, а не точка (одна запись на всех экранах)', () => {
    expect(formatFigure(fig(62.44, '%'))).toContain(',');
    expect(formatFigure(fig(62.44, '%'))).not.toContain('.');
  });

  it('ЗАКОН: пустое значение печатается причиной, а не нулём', () => {
    expect(formatFigure(fig(null, '%'))).toBe(NO_PLAN_REASON);
    expect(formatFigure(fig(null, '%'))).not.toContain('0');
  });

  it('причина берётся заданная, когда она точнее умолчания', () => {
    expect(formatFigure(fig(null, 'тыс.руб', 'книга не прочитана'))).toBe('книга не прочитана');
  });

  it('настоящий ноль остаётся нулём: он не путается с отсутствием базы', () => {
    expect(formatFigure(fig(0, 'шт'))).toBe(`0${NBSP}шт.`);
  });

  it('отрицательное значение печатается со знаком (перерасход не обрезается)', () => {
    expect(formatFigure(fig(-150.0, 'тыс.руб'))).toBe(`-150,0${NBSP}тыс. руб.`);
  });

  it('единицу можно снять для верстки в две ячейки, но не подменить', () => {
    expect(formatFigure(fig(62, '%'), { withUnit: false })).toBe('62,0');
  });
});

describe('figure() — не-конечное число это отсутствие числа', () => {
  it('NaN от 0/0 не доезжает до экрана', () => {
    const f = fig(Number.NaN, '%');
    expect(f.value).toBeNull();
    expect(formatFigure(f)).toBe(NO_PLAN_REASON);
  });

  it('бесконечность от деления на ноль тоже', () => {
    expect(fig(Number.POSITIVE_INFINITY, 'тыс.руб').value).toBeNull();
  });

  it('у непустого значения причины пустоты не остаётся', () => {
    expect(fig(5, 'шт', 'нет плана').nullReason).toBeUndefined();
  });
});

describe('RatioFigure / toPercent — проценты никогда не усредняются', () => {
  it('доля считается от сумм: 11 из 13 — это 84,6 %', () => {
    expect(formatFigure(toPercent(rat(11, 13)))).toBe(`84,6${NBSP}%`);
  });

  it('ЗАКОН: нулевой знаменатель даёт «нет плана», а не «0 %»', () => {
    const f = toPercent(rat(0, 0));
    expect(f.value).toBeNull();
    expect(formatFigure(f)).toBe(NO_PLAN_REASON);
  });

  it('факт без плана — тоже отсутствие базы, а не сверхисполнение', () => {
    expect(toPercent(rat(7, 0)).value).toBeNull();
  });

  it('отрицательный знаменатель базой не считается', () => {
    expect(toPercent(rat(5, -3)).value).toBeNull();
  });

  it('результат — процент со своей единицей и тем же периметром', () => {
    const f = toPercent(rat(1, 2));
    expect(f.unit).toBe('%');
    expect(f.perimeter).toBe(DEFAULT_PERIMETER);
    expect(f.provenance).toBe(ENGINE);
  });

  it('причина пустоты доезжает из доли в напечатанный процент', () => {
    expect(formatFigure(toPercent(rat(0, 0, 'книга не прочитана')))).toBe('книга не прочитана');
  });

  it('сложение долей идёт числителями и знаменателями', () => {
    // Два управления: 1 из 10 и 9 из 10. Доля района — 10 из 20 = 50,0 %.
    // Среднее долей дало бы те же 50 % случайно, поэтому проверяем на паре,
    // где ответы расходятся: 1 из 1 и 1 из 99.
    const summed = sumRatios([rat(1, 1), rat(1, 99)], rat(0, 0));
    expect(summed.numerator).toBe(2);
    expect(summed.denominator).toBe(100);
    expect(formatFigure(toPercent(summed))).toBe(`2,0${NBSP}%`);
    // Среднее арифметическое долей на тех же данных — 50,5 %: другое число,
    // не отвечающее ни на один вопрос управленца.
    const averaged = (100 + 1 / 99 * 100) / 2;
    expect(Math.round(averaged * 10) / 10).not.toBe(2);
  });

  it('пустой список долей — доля без базы, а не ноль процентов', () => {
    expect(toPercent(sumRatios([], rat(0, 0))).value).toBeNull();
  });
});

describe('провенанс и единицы — то, что видит читатель', () => {
  it('без адреса печатается один движок', () => {
    expect(provenanceText({ engine: 'движок: сумма ФБ+КБ+МБ' })).toBe('движок: сумма ФБ+КБ+МБ');
  });

  it('лист и ячейка адресуют число, как требует п.3 интервью', () => {
    expect(provenanceText({
      engine: 'официал листа',
      source: { sheet: 'СВОД ТД-ПМ', cell: 'O237' },
    })).toBe('официал листа · СВОД ТД-ПМ!O237');
  });

  it('лист без ячейки — тоже адрес, но не выдуманный', () => {
    expect(provenanceText({ engine: 'официал листа', source: { sheet: 'СВОД ТД-ПМ' } }))
      .toBe('официал листа · СВОД ТД-ПМ');
  });

  it('единицы человеку — кириллица и точки, без внутренних ключей', () => {
    expect(unitText('тыс.руб')).toBe('тыс. руб.');
    expect(unitText('шт')).toBe('шт.');
    expect(unitText('дн')).toBe('дн.');
    expect(unitText('%')).toBe('%');
  });
});
