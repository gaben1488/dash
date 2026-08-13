// ── Стражи правила «цвет = смысл».
//
// Проверяется не «красиво», а проверяемое: категориальная палитра не смеет
// повторять закреплённые смыслы (бюджеты, критичность), ряды должны
// различаться между собой и читаться на обеих подложках, а пороги
// исполнения обязаны совпадать с тем, что написано в базе знаний и
// напечатано в легенде.

import { describe, expect, it } from 'vitest';
import {
  BUDGET_COLORS,
  EXECUTION_BAND_MIN,
  METHOD_COLORS,
  SERIES_PATTERN_COUNT,
  getChartColor,
  getChartColors,
  getExecutionBand,
  getExecutionBarColor,
  getExecutionHeatBg,
  getExecutionTextClass,
  getSeriesPattern,
  getSeverityColor,
} from './chart-colors';

// ── Инструменты сравнения цветов ──

function rgb(hex: string): [number, number, number] {
  return [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number];
}

/** Тон в градусах круга HSL. */
function hue(hex: string): number {
  const [r, g, b] = rgb(hex);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  if (d === 0) return 0;
  const h = max === r ? 60 * (((g - b) / d) % 6)
    : max === g ? 60 * ((b - r) / d + 2)
      : 60 * ((r - g) / d + 4);
  return (h + 360) % 360;
}

/** Кратчайшее расстояние между тонами по кругу. */
function hueGap(a: string, b: string): number {
  const d = Math.abs(hue(a) - hue(b));
  return Math.min(d, 360 - d);
}

function luminance(hex: string): number {
  const [r, g, b] = rgb(hex).map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

/** Подложки карточек: белая в светлой теме, zinc-900 в тёмной. */
const SURFACE = { light: '#ffffff', dark: '#18181b' };

/** Всё, у чего цвет уже занят смыслом. */
const RESERVED = [
  BUDGET_COLORS['ФБ'].light,
  BUDGET_COLORS['КБ'].light,
  BUDGET_COLORS['МБ'].light,
  getSeverityColor('critical', false),
  getSeverityColor('significant', false),
  getSeverityColor('warning', false),
];

describe('категориальная палитра не спорит с закреплёнными смыслами', () => {
  it('ни один категориальный цвет не совпадает с бюджетным или сигнальным', () => {
    for (const isDark of [false, true]) {
      for (const color of getChartColors(isDark)) {
        expect(RESERVED).not.toContain(color.toLowerCase());
      }
    }
  });

  it('категориальные тона отстоят от закреплённых не меньше чем на 25°', () => {
    for (const isDark of [false, true]) {
      for (const color of getChartColors(isDark)) {
        for (const reserved of RESERVED) {
          expect(hueGap(color, reserved)).toBeGreaterThanOrEqual(25);
        }
      }
    }
  });

  it('соседние ряды разведены по тону не меньше чем на 40°', () => {
    for (const isDark of [false, true]) {
      const palette = getChartColors(isDark);
      for (let i = 0; i < palette.length; i++) {
        for (let j = i + 1; j < palette.length; j++) {
          expect(hueGap(palette[i]!, palette[j]!)).toBeGreaterThanOrEqual(40);
        }
      }
    }
  });

  it('все ряды читаются на своей подложке (не ниже 3 : 1 по WCAG 1.4.11)', () => {
    for (const [theme, surface] of Object.entries(SURFACE)) {
      for (const color of getChartColors(theme === 'dark')) {
        expect(contrast(color, surface)).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it('ряды равнозаметны: разброс контраста внутри темы меньше 1,5', () => {
    for (const [theme, surface] of Object.entries(SURFACE)) {
      const ratios = getChartColors(theme === 'dark').map(c => contrast(c, surface));
      expect(Math.max(...ratios) - Math.min(...ratios)).toBeLessThan(1.5);
    }
  });

  it('цвет ряда стабилен и зациклен по длине палитры', () => {
    const palette = getChartColors(true);
    expect(getChartColor(0, true)).toBe(palette[0]);
    expect(getChartColor(palette.length, true)).toBe(palette[0]);
  });
});

describe('штриховка даёт нецветовой признак различия', () => {
  it('штриховок меньше, чем тонов, — иначе пара повторяется вместе с цветом', () => {
    expect(SERIES_PATTERN_COUNT).toBeLessThan(getChartColors(false).length);
  });

  it('пара «цвет + штриховка» не повторяется раньше, чем через 12 рядов', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 12; i++) {
      seen.add(`${getChartColor(i, true)}|${getSeriesPattern(i)}`);
    }
    expect(seen.size).toBe(12);
  });
});

describe('способ закупки и бюджеты не делят цвет', () => {
  it('КП и ЕП не окрашены ни в один из бюджетных цветов', () => {
    for (const isDark of [false, true]) {
      const budgets = Object.values(BUDGET_COLORS).map(p => (isDark ? p.dark : p.light));
      for (const pair of Object.values(METHOD_COLORS)) {
        expect(budgets).not.toContain(isDark ? pair.dark : pair.light);
      }
    }
  });

  it('ЕП не красится по шкале критичности — высокая доля ЕП не нарушение', () => {
    const severities = ['critical', 'significant', 'warning', 'info'];
    for (const isDark of [false, true]) {
      const ep = isDark ? METHOD_COLORS['ЕП'].dark : METHOD_COLORS['ЕП'].light;
      for (const s of severities) {
        expect(hueGap(ep, getSeverityColor(s, isDark))).toBeGreaterThan(20);
      }
    }
  });
});

describe('критичность различима в обеих темах', () => {
  it('на тёмной подложке каждый уровень светлее, чем на светлой', () => {
    for (const s of ['critical', 'significant', 'warning', 'info']) {
      expect(luminance(getSeverityColor(s, true)))
        .toBeGreaterThan(luminance(getSeverityColor(s, false)));
    }
  });

  it('каждый уровень читается на своей подложке', () => {
    for (const s of ['critical', 'significant', 'warning', 'info']) {
      expect(contrast(getSeverityColor(s, false), SURFACE.light)).toBeGreaterThanOrEqual(3);
      expect(contrast(getSeverityColor(s, true), SURFACE.dark)).toBeGreaterThanOrEqual(3);
    }
  });
});

describe('шкала исполнения — одни пороги на весь продукт', () => {
  it('границы полос те же, что в базе знаний: 100 / 80 / 50', () => {
    expect(EXECUTION_BAND_MIN).toEqual({ over: 100, good: 80, watch: 50 });
  });

  it('полоса определяется по границам, а не по месту показа', () => {
    expect(getExecutionBand(120)).toBe('over');
    expect(getExecutionBand(100)).toBe('good');
    expect(getExecutionBand(80)).toBe('good');
    expect(getExecutionBand(79.9)).toBe('watch');
    expect(getExecutionBand(50)).toBe('watch');
    expect(getExecutionBand(49.9)).toBe('bad');
    expect(getExecutionBand(0)).toBe('bad');
  });

  it('столбец, текст и тепловая карта дают одну полосу для одного числа', () => {
    // 85 % — «в графике» на всех трёх представлениях; раньше текст красил
    // это число в жёлтый (порог 90), а столбец — в зелёный (порог 80).
    expect(getExecutionBarColor(85, true)).toBe(getExecutionBarColor(95, true));
    expect(getExecutionTextClass(85)).toBe(getExecutionTextClass(95));
    expect(getExecutionHeatBg(85, true)).toBe(getExecutionHeatBg(95, true));
  });

  it('текст исполнения читается и на светлой теме', () => {
    expect(getExecutionTextClass(95)).toContain('text-emerald-600');
    expect(getExecutionTextClass(95)).toContain('dark:text-emerald-400');
  });

  it('отсутствие значения не красится как провал', () => {
    expect(getExecutionTextClass(null)).toContain('text-zinc-500');
    expect(getExecutionHeatBg(null, true)).toBe(getExecutionHeatBg(0, true));
  });
});
