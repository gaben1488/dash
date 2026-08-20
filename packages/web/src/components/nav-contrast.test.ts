// @vitest-environment jsdom
// ── Страж: активная кнопка навигации обязана быть видна в обеих темах.
//
//    ПОВОД (регресс, замечен владельцем 19.08.2026). Активная кнопка
//    построена как «заливка цветом раздела плюс подпись поверх». Такая
//    конструкция держится на одном допущении: заливка отличается от фона
//    страницы по светлоте. Тона разделов подбирались под тёмную тему (фон
//    почти чёрный), поэтому все они светлые. Когда продукт получил
//    равноправную светлую тему (фон кремовый), светлая заливка на светлом
//    фоне дала около 1,3 : 1 — силуэта у кнопки не стало, коническое
//    свечение тем же тоном пропало, подпись стала выглядеть вялой.
//
//    Ошибка этого класса не ловится ни проверкой типов, ни тестами
//    разметки: цвет на месте, класс на месте, кнопка «работает». Ловится
//    она только счётом контраста — поэтому счёт здесь.
//
//    ЧТО ПРОВЕРЯЕТСЯ, для каждого раздела и КАЖДОЙ темы:
//      1. подпись на заливке — не ниже 4,5 : 1 (WCAG 2.2, обычный текст);
//      2. заливка на фоне страницы — не ниже 3 : 1, иначе у активной
//         кнопки нет силуэта и её не отличить от соседних БЕЗ цвета;
//      3. у каждого раздела есть оба значения тона, и они разные.
//
//    Пороговые краски берутся из `index.css`, а не переписываются сюда:
//    копия порога — это второй дом, который разъедется с первым.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NAV_ITEMS } from './Header';

const here = dirname(fileURLToPath(import.meta.url));
const CSS = readFileSync(join(here, '..', 'index.css'), 'utf8');

/** Значение роли из нужного блока темы `index.css`. */
function token(name: string, theme: 'light' | 'dark'): string {
  // Светлая тема живёт в блоке `:root`, тёмная — в `.dark`. Берём
  // последнее объявление в нужном блоке: ниже по файлу побеждает.
  const blocks = theme === 'light'
    ? [...CSS.matchAll(/:root\s*\{([^}]*)\}/g)]
    : [...CSS.matchAll(/\.dark\s*\{([^}]*)\}/g)];
  let found: string | null = null;
  for (const block of blocks) {
    const hit = [...block[1]!.matchAll(new RegExp(`${name}\\s*:\\s*([^;]+);`, 'g'))].pop();
    if (hit) found = hit[1]!.trim();
  }
  if (!found) throw new Error(`Роль ${name} не найдена в теме «${theme}» — index.css разошёлся со стражем`);
  return found;
}

function channel(value: number): number {
  const c = value / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const clean = hex.replace('#', '');
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** Отношение контраста по WCAG. */
export function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/**
 * Тело правила по его точному селектору.
 *
 * Искать выражением по всему файлу здесь нельзя: `.np-btn` — начало десятка
 * других селекторов (`.np-btn:hover`, `.np-btn-active`, `.dark .np-btn`), и
 * выражение цепляет не то правило. Поэтому берётся строка с ровно таким
 * селектором и открывающей скобкой.
 */
function block(selector: string): string {
  const lines = CSS.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === `${selector} {`);
  if (start < 0) throw new Error(`Правило «${selector}» в index.css не найдено`);
  const end = lines.findIndex((line, i) => i > start && line.trim() === '}');
  return lines.slice(start + 1, end).join('\n');
}

const THEMES = [
  {
    name: 'светлая',
    tone: (item: (typeof NAV_ITEMS)[number]) => item.colorLight,
    ink: token('--accent-ink', 'light'),
    page: token('--surface-page', 'light'),
  },
  {
    name: 'тёмная',
    tone: (item: (typeof NAV_ITEMS)[number]) => item.color,
    ink: token('--accent-ink', 'dark'),
    page: token('--surface-page', 'dark'),
  },
] as const;

describe('Активная кнопка навигации', () => {
  it('у каждого раздела есть тон для обеих тем, и они разные', () => {
    for (const item of NAV_ITEMS) {
      expect(item.color, `${item.label}: нет тона тёмной темы`).toMatch(/^#[0-9a-f]{6}$/i);
      expect(item.colorLight, `${item.label}: нет тона светлой темы`).toMatch(/^#[0-9a-f]{6}$/i);
      // Одинаковые значения означают, что тон под одну из тем не подобран,
      // а просто скопирован, — и там он снова сольётся с фоном.
      expect(item.color.toLowerCase(), `${item.label}: тон не различает темы`)
        .not.toBe(item.colorLight.toLowerCase());
    }
  });

  for (const theme of THEMES) {
    it(`подпись читается на заливке — ${theme.name} тема, не ниже 4,5 : 1`, () => {
      const weak = NAV_ITEMS
        .map((item) => ({ label: item.label, ratio: contrast(theme.tone(item), theme.ink) }))
        .filter((row) => row.ratio < 4.5)
        .map((row) => `${row.label}: ${row.ratio.toFixed(2)} : 1`);
      expect(weak).toEqual([]);
    });

    it(`у активной кнопки есть силуэт на фоне страницы — ${theme.name} тема, не ниже 3 : 1`, () => {
      // Порог силуэта — то, чем активная кнопка отличается от неактивной
      // БЕЗ участия цвета: только светлотой. Ровно этого и не стало в
      // регрессе 19.08, когда светлая заливка легла на светлый фон.
      const weak = NAV_ITEMS
        .map((item) => ({ label: item.label, ratio: contrast(theme.tone(item), theme.page) }))
        .filter((row) => row.ratio < 3)
        .map((row) => `${row.label}: ${row.ratio.toFixed(2)} : 1`);
      expect(weak).toEqual([]);
    });
  }
});

describe('Сборка активной кнопки в index.css', () => {
  // Счёт контраста выше доказывает, что НАБОРЫ ТОНОВ годятся. Здесь
  // проверяется вторая половина утверждения: что заливка действительно берётся
  // из тона, зависящего от темы, а не из прежнего одного на обе темы `--np-color`.
  // Без этого стража правка одной строки CSS вернула бы регресс целиком,
  // а счёт контраста остался бы зелёным — он смотрит на числа, а не на разметку.

  it('заливка берётся из тона, зависящего от темы', () => {
    const rule = /\.np-btn-active \.np-content \{[^}]*\}/.exec(CSS)?.[0] ?? '';
    expect(rule, 'правило активной кнопки не найдено').not.toBe('');
    expect(rule).toContain('var(--np-tone)');
    // Прямое обращение к `--np-color` здесь и есть регресс: этот тон
    // подобран только под тёмную тему.
    expect(rule).not.toContain('var(--np-color)');
    // Подпись — роль, а не жёсткий чёрный: на тёмной заливке
    // светлой темы чёрным по чёрному не прочесть.
    expect(rule).toContain('var(--accent-ink)');
    expect(rule).not.toContain('#1b170f');
  });

  it('тон объявлён для обеих тем и тёмная перекрывает светлую', () => {
    expect(block('.np-btn')).toContain('--np-tone: var(--np-color-light');
    expect(block('.dark .np-btn')).toContain('--np-tone: var(--np-color,');
  });

  it('свечение идёт тем же тоном, что и заливка', () => {
    const glow = /\.np-glow \{[^}]*\}/.exec(CSS)?.[0] ?? '';
    expect(glow).toContain('--np-tone');
    expect(glow).not.toContain('var(--np-color,');
  });
});
