import { describe, it, expect } from 'vitest';
import {
  type ThousandRub,
  type Rub,
  RUB_PER_THOUSAND,
  thousandRub,
  rub,
  toRub,
  toThousandRub,
  moneyValue,
  sumThousandRub,
  addThousandRub,
  subThousandRub,
  absDiffThousandRub,
  exceedsThousandRub,
  shareThousandRub,
} from './money-units.js';

/**
 * СТРАЖ НЕВОЗМОЖНОСТИ СМЕШЕНИЯ.
 *
 * Половина проверок здесь не выполняется во время прогона — они срабатывают
 * раньше, при проверке типов. Пометки `@ts-expect-error` требуют, чтобы строка
 * под ними НЕ компилировалась. Если защиту однажды снимут (например, вернут
 * денежным величинам обычный `number`), эти пометки станут лишними, и `tsc`
 * упадёт с «ошибки не было» — то есть страж сообщит о своей смерти вместо того,
 * чтобы промолчать. Проверяется командой `pnpm typecheck`, не только vitest.
 */
describe('деньги: тысячи и рубли — разные типы', () => {
  it('перевод в обе стороны сходится', () => {
    const план: ThousandRub = thousandRub(601);
    expect(moneyValue(toRub(план))).toBe(601_000);
    expect(moneyValue(toThousandRub(toRub(план)))).toBe(601);
    expect(RUB_PER_THOUSAND).toBe(1000);
  });

  it('рубли и тысячи одного и того же не равны как числа', () => {
    const тысячи = thousandRub(600);
    const рубли = toRub(тысячи);
    expect(moneyValue(рубли)).not.toBe(moneyValue(тысячи));
    expect(moneyValue(рубли)).toBe(moneyValue(тысячи) * RUB_PER_THOUSAND);
  });

  it('арифметика сохраняет единицу', () => {
    const a = thousandRub(100);
    const b = thousandRub(40);
    expect(moneyValue(addThousandRub(a, b))).toBe(140);
    expect(moneyValue(subThousandRub(b, a))).toBe(-60);
    expect(moneyValue(absDiffThousandRub(b, a))).toBe(60);
    expect(moneyValue(sumThousandRub([a, b, thousandRub(0.5)]))).toBe(140.5);
    expect(moneyValue(sumThousandRub([]))).toBe(0);
  });

  it('доля: знаменатель ноль или меньше — доли нет', () => {
    expect(shareThousandRub(thousandRub(50), thousandRub(200))).toBe(0.25);
    expect(shareThousandRub(thousandRub(50), thousandRub(0))).toBeNull();
    expect(shareThousandRub(thousandRub(50), thousandRub(-1))).toBeNull();
  });

  it('порог сравнивается в своей единице', () => {
    const порогТысяч = thousandRub(600);
    expect(exceedsThousandRub(thousandRub(601), порогТысяч)).toBe(true);
    expect(exceedsThousandRub(thousandRub(600), порогТысяч)).toBe(false);
  });

  it('ВОСПРОИЗВЕДЕНИЕ БАГА #1: порог в рублях против суммы в тысячах не собирается', () => {
    // Ровно та ошибка охоты 2026-08-08: порог 600 000 записан в РУБЛЯХ, а
    // плановая сумма строки книги — в ТЫСЯЧАХ. Раньше обе были `number`, и
    // сравнение молча компилировалось, а проверка не срабатывала никогда.
    const планСтроки: ThousandRub = thousandRub(601);
    const порогВРублях: Rub = rub(600_000);

    // @ts-expect-error порог в рублях нельзя сравнить с суммой в тысячах
    exceedsThousandRub(планСтроки, порогВРублях);

    // Верно — привести порог к единице книги; тогда нарушение видно.
    expect(exceedsThousandRub(планСтроки, toThousandRub(порогВРублях))).toBe(true);
  });

  it('голое число не проходит за деньги, а единицы не подменяют друг друга', () => {
    const тысячи: ThousandRub = thousandRub(1);
    const рубли: Rub = rub(1);

    // @ts-expect-error голое число не является суммой в тысячах
    const _1: ThousandRub = 100;
    // @ts-expect-error рубли не являются тысячами
    const _2: ThousandRub = рубли;
    // @ts-expect-error тысячи не являются рублями
    const _3: Rub = тысячи;
    // @ts-expect-error перевод из тысяч ожидает тысячи, а не рубли
    toRub(рубли);
    // @ts-expect-error перевод из рублей ожидает рубли, а не тысячи
    toThousandRub(тысячи);
    // @ts-expect-error складывать тысячи с рублями нельзя
    addThousandRub(тысячи, рубли);
    // @ts-expect-error в сумму тысяч не проходит список рублей
    sumThousandRub([рубли]);

    expect([_1, _2, _3].every((v) => typeof v === 'number')).toBe(true);
  });
});
