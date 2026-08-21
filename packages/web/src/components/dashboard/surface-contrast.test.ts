// ── Страж: в тёмной теме вложенные поверхности зоны «Пульт и Отчёт»
//    разделяет СВЕТЛОТА, а не обводка (канон п.129).
//
//    ПОВОД. Владелец трижды жаловался на «частокол обводок» и «коричневые
//    прямоугольники» — рамку на каждой плитке числа. Обводки сняли, разделение
//    переложили на светлоту фона. У такой конструкции есть цена: если ступень
//    светлоты окажется слишком мелкой, граница плитки перестанет читаться
//    ВООБЩЕ — а проверка типов и тесты разметки этого не заметят, потому что
//    класс на месте и «всё работает». Ловится это только счётом контраста.
//
//    ЧТО ПРОВЕРЯЕТСЯ:
//      1. соседние поверхности тёмной темы (страница → карточка → плитка)
//         различаются не меньше чем на 1,12 : 1 — порог, ниже которого край
//         поверхности угадывается, а не виден;
//      2. в тёмной теме у карточки и плитки обводка погашена, а в светлой
//         тонкая линия осталась: на белом фоне разница светлот не читается;
//      3. ни одна поверхность зоны не объявлена светлотой мельче плитки —
//         правило «не хватает разделения, поднимай светлоту, а не возвращай
//         рамку» должно оставаться исполнимым.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CARD, TILE, RULE_HEAD, RULE_ROW } from './surfaces';

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Порог читаемого разделения соседних поверхностей. Это не порог WCAG для
 * текста (там 4,5 : 1): у края поверхности задача скромнее — быть замеченным.
 */
const MIN_SURFACE_RATIO = 1.12;

/**
 * Краски палитры, на которые ссылается словарь. Держим ровно те, что нужны
 * счёту: страница и подложка карточки. Значения — Tailwind, внешняя константа.
 */
const PALETTE: Record<string, [number, number, number]> = {
  'zinc-950': [0x09, 0x09, 0x0b],
  'zinc-800': [0x27, 0x27, 0x2a],
  white: [255, 255, 255],
};

type RGB = [number, number, number];

function over(fg: RGB, alpha: number, bg: RGB): RGB {
  return [0, 1, 2].map((i) => alpha * fg[i]! + (1 - alpha) * bg[i]!) as RGB;
}

function channel(value: number): number {
  const c = value / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function luminance([r, g, b]: RGB): number {
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrast(a: RGB, b: RGB): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/**
 * Разбирает объявление фона тёмной темы из строки словаря: `dark:bg-zinc-800/60`
 * или `dark:bg-white/[0.05]`. Читаем именно строку словаря, а не копию
 * значений: копия — второй дом, который однажды разойдётся с первым.
 */
function darkFill(classes: string): { color: RGB; alpha: number } {
  const hit = /dark:bg-([a-z]+(?:-\d{2,3})?)\/(?:\[(\d*\.?\d+)\]|(\d{1,3}))/.exec(classes);
  if (!hit) throw new Error(`В строке словаря нет фона тёмной темы: «${classes}»`);
  const name = hit[1]!;
  const color = PALETTE[name];
  if (!color) throw new Error(`Краска ${name} не описана в страже — палитру дополнили, а счёт нет`);
  const alpha = hit[2] ? Number(hit[2]) : Number(hit[3]) / 100;
  return { color, alpha };
}

const PAGE: RGB = PALETTE['zinc-950']!;

describe('Поверхности зоны «Пульт и Отчёт» в тёмной теме', () => {
  const card = darkFill(CARD);
  const tile = darkFill(TILE);
  const cardRGB = over(card.color, card.alpha, PAGE);
  const tileRGB = over(tile.color, tile.alpha, cardRGB);

  it('карточка отделяется от страницы светлотой', () => {
    const ratio = contrast(PAGE, cardRGB);
    expect(ratio, `страница → карточка: ${ratio.toFixed(3)} : 1`).toBeGreaterThanOrEqual(MIN_SURFACE_RATIO);
  });

  it('плитка отделяется от карточки светлотой', () => {
    // Ровно тот случай, ради которого страж и написан: плитка внутри карточки
    // живёт без рамки, и вся её граница держится на этой ступени.
    const ratio = contrast(cardRGB, tileRGB);
    expect(ratio, `карточка → плитка: ${ratio.toFixed(3)} : 1`).toBeGreaterThanOrEqual(MIN_SURFACE_RATIO);
  });

  it('обводка снята в тёмной теме и оставлена в светлой', () => {
    for (const [name, value] of [['CARD', CARD], ['TILE', TILE]] as const) {
      expect(value, `${name}: в тёмной теме обводка не погашена`).toContain('dark:border-transparent');
      expect(value, `${name}: в светлой теме поверхность осталась без линии`).toMatch(/border-zinc-\d{2,3}/);
    }
  });

  it('линейки таблиц объявлены тише текста и различают темы', () => {
    for (const [name, value] of [['RULE_HEAD', RULE_HEAD], ['RULE_ROW', RULE_ROW]] as const) {
      expect(value, `${name}: нет цвета линейки для тёмной темы`).toMatch(/dark:border-white\/\[0\.\d+\]/);
      expect(value, `${name}: нет цвета линейки для светлой темы`).toMatch(/border-zinc-\d{2,3}/);
    }
  });
});

describe('Светлоты поверхностей в файлах зоны', () => {
  /** Файлы зоны, где живут собственные ступени светлоты. */
  const files = [
    join(here, '..', '..', 'pages', 'Dashboard.tsx'),
    join(here, '..', '..', 'pages', 'Report.tsx'),
    join(here, '..', '..', 'pages', 'SvodView.tsx'),
    join(here, 'DeptPortrait.tsx'),
    ...readdirSync(join(here, '..', 'report'))
      .filter((f) => f.endsWith('.tsx'))
      .map((f) => join(here, '..', 'report', f)),
  ];

  it('ни одна поверхность не светлее фона меньше, чем плитка словаря', () => {
    // Ступень мельче плиточной (white/[0.05]) даёт меньше 1,12 : 1 над
    // карточкой — такую поверхность на экране не отличить от подложки, и
    // соблазн вернуть ей рамку становится непреодолимым.
    const floor = darkFill(TILE).alpha;
    const weak: string[] = [];
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      for (const m of text.matchAll(/dark:bg-white\/\[(\d*\.?\d+)\]/g)) {
        const alpha = Number(m[1]);
        if (alpha < floor) weak.push(`${file.split(/[\\/]/).pop()}: dark:bg-white/[${m[1]}]`);
      }
    }
    expect(weak).toEqual([]);
  });
});
