// ── Страж: в тёмной теме поверхности зоны «контроль, дисциплина, аналитика»
//    разделяет СВЕТЛОТА, а не обводка (канон п.129).
//
//    ПОВОД. Владелец трижды жаловался на «частокол обводок» и «коричневые
//    прямоугольники». Второе оказалось не фигурой речи, а точным описанием:
//    плита предупреждения `bg-amber-950/20` отличалась от страницы на
//    1,033 : 1 — глазом не видно вовсе, — а её обводка `border-amber-800` на
//    2,716 : 1. Всю работу делал бурый ободок, заливка не делала никакой.
//    Плиты переложили на заливку, ободок в тёмной теме сняли.
//
//    ЦЕНА ТАКОЙ КОНСТРУКЦИИ. Если ступень светлоты окажется мелкой, край
//    поверхности перестанет читаться ВООБЩЕ, а проверка типов и тесты
//    разметки этого не заметят: класс на месте, «всё работает». Ловится
//    только счётом контраста — им и занят этот файл.
//
//    ЧТО ПРОВЕРЯЕТСЯ:
//      1. страница → карточка → плитка различаются не меньше чем на 1,12 : 1;
//      2. каждая смысловая плита `NOTE` читается И на странице, И внутри
//         карточки — постоянного соседа у неё нет;
//      3. в тёмной теме у карточки, плитки и плит обводка погашена, а в
//         светлой тонкая линия осталась;
//      4. линейки таблиц объявлены тише текста и различают темы.

import { describe, it, expect } from 'vitest';
import { CARD, NOTE, PLATE, RULE_HEAD, RULE_ROW, TILE_SKIN } from './surfaces';

/**
 * Порог читаемого разделения соседних поверхностей. Это не порог WCAG для
 * текста (там 4,5 : 1): у края поверхности задача скромнее — быть замеченным.
 */
const MIN_SURFACE_RATIO = 1.12;

/** Краски палитры, на которые ссылается словарь. Значения — Tailwind. */
const PALETTE: Record<string, [number, number, number]> = {
  'zinc-950': [0x09, 0x09, 0x0b],
  'zinc-800': [0x27, 0x27, 0x2a],
  'amber-500': [0xf5, 0x9e, 0x0b],
  'red-500': [0xef, 0x44, 0x44],
  'emerald-500': [0x10, 0xb9, 0x81],
  // `tailwind.config.ts` переводит всю палитру blue/sky/indigo в крем: класс
  // зовётся синим, а рисуется кремовым. Счёт обязан знать краску, которая
  // окажется на экране, а не ту, что читается в имени класса.
  'blue-500': [0xbf, 0xa1, 0x61],
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
 * Разбирает объявление фона тёмной темы из строки словаря: `dark:bg-zinc-800/60`,
 * `dark:bg-white/[0.05]`, `dark:bg-amber-500/[0.12]`. Читаем именно строку словаря,
 * а не копию значений: копия — второй дом, который однажды разойдётся с первым.
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

describe('Поверхности зоны «контроль, дисциплина, аналитика» в тёмной теме', () => {
  const card = darkFill(CARD);
  const cardRGB = over(card.color, card.alpha, PAGE);
  const tile = darkFill(TILE_SKIN);
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

  it('плита-оговорка отделяется от страницы светлотой', () => {
    const plate = darkFill(PLATE);
    const ratio = contrast(PAGE, over(plate.color, plate.alpha, PAGE));
    expect(ratio, `страница → плита: ${ratio.toFixed(3)} : 1`).toBeGreaterThanOrEqual(MIN_SURFACE_RATIO);
  });

  it('каждая смысловая плита читается и на странице, и внутри карточки', () => {
    // У плиты состояния нет постоянного соседа: та же янтарная оговорка стоит
    // и прямо на странице настроек, и внутри карточки сверки. Доля заливки
    // обязана держать порог в обоих случаях — иначе на одном из экранов плита
    // исчезнет, и рамку захочется вернуть.
    for (const [tone, value] of Object.entries(NOTE)) {
      const fill = darkFill(value);
      const onPage = contrast(PAGE, over(fill.color, fill.alpha, PAGE));
      const onCard = contrast(cardRGB, over(fill.color, fill.alpha, cardRGB));
      expect(onPage, `NOTE.${tone} на странице: ${onPage.toFixed(3)} : 1`).toBeGreaterThanOrEqual(MIN_SURFACE_RATIO);
      expect(onCard, `NOTE.${tone} на карточке: ${onCard.toFixed(3)} : 1`).toBeGreaterThanOrEqual(MIN_SURFACE_RATIO);
    }
  });

  it('обводка снята в тёмной теме и оставлена в светлой', () => {
    const dictionary: Array<readonly [string, string]> = [
      ['CARD', CARD],
      ['TILE_SKIN', TILE_SKIN],
      ['PLATE', PLATE],
      ...Object.entries(NOTE).map(([tone, value]) => [`NOTE.${tone}`, value] as const),
    ];
    for (const [name, value] of dictionary) {
      expect(value, `${name}: в тёмной теме обводка не погашена`).toContain('dark:border-transparent');
      expect(value, `${name}: в светлой теме поверхность осталась без линии`).toMatch(/border-[a-z]+-\d{2,3}/);
    }
  });

  it('доля заливки написана так, что класс действительно рождается', () => {
    // Шкала прозрачности Tailwind знает 0, 5, 10, 20, 25, 30, 40, 50, 60, 70,
    // 75, 80, 90, 95, 100. Доля вне шкалы, написанная числом (`/12`), не даёт
    // класса вовсе: заливка молча исчезает, плита становится прозрачной, и ни
    // проверка типов, ни тесты разметки об этом не скажут. В скобках (`/[0.12]`)
    // рождается любая доля.
    const SCALE = new Set([0, 5, 10, 20, 25, 30, 40, 50, 60, 70, 75, 80, 90, 95, 100]);
    const dictionary: Array<[string, string]> = [
      ...Object.entries(NOTE).map(([tone, value]) => [`NOTE.${tone}`, value] as [string, string]),
      ['CARD', CARD], ['TILE_SKIN', TILE_SKIN], ['PLATE', PLATE],
      ['RULE_HEAD', RULE_HEAD], ['RULE_ROW', RULE_ROW],
    ];
    for (const [name, value] of dictionary) {
      for (const m of value.matchAll(/-(\d{2,3})\/(\d{1,3})(?![\d.\]])/g)) {
        expect(
          SCALE.has(Number(m[2])),
          `${name}: доля ${m[2]} вне шкалы Tailwind — класс «${m[0]}» не родится, поверхность останется прозрачной`,
        ).toBe(true);
      }
    }
  });

  it('линейки таблиц объявлены тише текста и различают темы', () => {
    for (const [name, value] of [['RULE_HEAD', RULE_HEAD], ['RULE_ROW', RULE_ROW]] as const) {
      expect(value, `${name}: нет цвета линейки для тёмной темы`).toMatch(/dark:border-white\/\[0\.\d+\]/);
      expect(value, `${name}: нет цвета линейки для светлой темы`).toMatch(/border-zinc-\d{2,3}/);
    }
  });
});
