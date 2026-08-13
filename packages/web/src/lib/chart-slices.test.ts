// ── Инварианты круга долей.
//
// Круг обещает читателю две вещи: показанные сектора складываются в целое,
// и это целое — то же число, что и в остальном на экране. Оба обещания
// проверяются здесь, без отрисовки.

import { describe, expect, it } from 'vitest';
import { isMeaningfulGap, splitDrawable } from './chart-slices';

const slice = (id: string, value: number) => ({ id, value });

describe('круг показывает только то, что умеет нарисовать', () => {
  it('отрицательные срезы не рисуются, но и не пропадают из счёта', () => {
    const { drawable, hidden } = splitDrawable([
      slice('a', 40), slice('b', -12), slice('c', 25), slice('d', -3),
    ]);
    expect(drawable.map(d => d.id)).toEqual(['a', 'c']);
    expect(hidden).toEqual({ count: 2, sum: -15 });
  });

  it('ровный ноль не считается спрятанным срезом — рисовать нечего и терять нечего', () => {
    const { drawable, hidden } = splitDrawable([slice('a', 10), slice('b', 0)]);
    expect(drawable.map(d => d.id)).toEqual(['a']);
    expect(hidden).toEqual({ count: 0, sum: 0 });
  });

  it('срезы упорядочены по убыванию — крупное впереди', () => {
    const { drawable } = splitDrawable([slice('a', 5), slice('b', 50), slice('c', 20)]);
    expect(drawable.map(d => d.value)).toEqual([50, 20, 5]);
  });

  it('сумма нарисованных плюс сумма спрятанных равна сумме всех', () => {
    const all = [slice('a', 40), slice('b', -12), slice('c', 25)];
    const { drawable, hidden } = splitDrawable(all);
    const drawn = drawable.reduce((s, x) => s + x.value, 0);
    expect(drawn + hidden.sum).toBe(all.reduce((s, x) => s + x.value, 0));
  });

  it('пустой набор не выдумывает срезов', () => {
    expect(splitDrawable([])).toEqual({ drawable: [], hidden: { count: 0, sum: 0 } });
  });
});

describe('расхождение итога с суммой частей', () => {
  it('копеечная разница на больших суммах — округление источника, не расхождение', () => {
    expect(isMeaningfulGap(0.0000001, 1_500_000)).toBe(false);
  });

  it('та же разница на малой базе уже значима', () => {
    expect(isMeaningfulGap(0.6, 100)).toBe(true);
  });

  it('порог не зависит от знака разницы', () => {
    expect(isMeaningfulGap(-900, 100_000)).toBe(isMeaningfulGap(900, 100_000));
  });

  it('потерянный процент итога виден всегда', () => {
    expect(isMeaningfulGap(1_000, 100_000)).toBe(true);
  });

  it('нулевой итог не делает любую разницу значимой по проценту', () => {
    // При нулевой базе работает абсолютный порог: половина единицы.
    expect(isMeaningfulGap(0.4, 0)).toBe(false);
    expect(isMeaningfulGap(2, 0)).toBe(true);
  });
});
