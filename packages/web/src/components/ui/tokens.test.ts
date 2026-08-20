// ── Страж равноправия тем.
//
//    Требование владельца: «идеально выглядящая безошибочная и тёмная и
//    светлая тема». Безошибочность здесь проверяемая, а не декларируемая:
//    если роль определена на светлой теме и забыта на тёмной, значение
//    протечёт из светлой — и на чёрном фоне встанет светло-кремовая
//    поверхность. Такой дефект глазами ловится случайно, а тестом —
//    всегда.
//
//    Тест читает сам `index.css`, а не копию значений: копия разъехалась
//    бы с оригиналом на первой же правке.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  THEMED_TOKENS,
  TEXT_SCALE,
  SPACE_SCALE,
  DENSITY_TOKENS,
  categoricalVar,
  dataVar,
  textClass,
} from './tokens';

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(resolve(here, '../../index.css'), 'utf8');

/** Вырезать тело правила по его селектору: `:root {…}` или `.dark {…}`. */
function ruleBodies(selector: string): string[] {
  const bodies: string[] = [];
  let from = 0;
  for (;;) {
    const at = css.indexOf(selector, from);
    if (at === -1) break;
    const open = css.indexOf('{', at);
    if (open === -1) break;
    const close = css.indexOf('}', open);
    if (close === -1) break;
    bodies.push(css.slice(open + 1, close));
    from = close + 1;
  }
  return bodies;
}

const lightBlock = ruleBodies(':root {').join('\n');
const darkBlock = ruleBodies('.dark {').join('\n');
const densityBlock = ruleBodies("[data-density='comfortable'] {").join('\n');

function defines(block: string, token: string): boolean {
  return new RegExp(`${token}\\s*:`).test(block);
}

function valueOf(block: string, token: string): string | undefined {
  const m = new RegExp(`${token}\\s*:\\s*([^;]+);`).exec(block);
  return m?.[1]?.trim();
}

describe('словарь облика', () => {
  it('каждая роль определена на светлой теме', () => {
    const missing = THEMED_TOKENS.filter((t) => !defines(lightBlock, t));
    expect(missing).toEqual([]);
  });

  it('каждая роль определена на тёмной теме — темы равноправны', () => {
    const missing = THEMED_TOKENS.filter((t) => !defines(darkBlock, t));
    expect(missing).toEqual([]);
  });

  it('тёмная тема не повторяет светлую дословно — иначе перекрытие бессмысленно', () => {
    const same = THEMED_TOKENS.filter((t) => {
      const light = valueOf(lightBlock, t);
      const dark = valueOf(darkBlock, t);
      return light !== undefined && dark !== undefined && light === dark;
    });
    expect(same).toEqual([]);
  });

  it('чистый чёрный и чистый белый под запретом: нейтраль тонирована', () => {
    const forbidden = [...THEMED_TOKENS].filter((t) => {
      const values = [valueOf(lightBlock, t), valueOf(darkBlock, t)];
      return values.some((v) => v === '#000' || v === '#fff' || v === '#000000' || v === '#ffffff');
    });
    expect(forbidden).toEqual([]);
  });

  it('шкала кегля возрастает без повторов', () => {
    const sizes = TEXT_SCALE.map((t) => {
      const raw = valueOf(lightBlock, t);
      expect(raw, `ступень ${t} не определена`).toBeDefined();
      return Number.parseFloat(raw!.replace('rem', ''));
    });
    for (let i = 1; i < sizes.length; i += 1) {
      expect(sizes[i]!, `ступень ${TEXT_SCALE[i]}`).toBeGreaterThan(sizes[i - 1]!);
    }
  });

  it('шкала отступов возрастает без повторов', () => {
    const steps = SPACE_SCALE.map((t) => Number.parseFloat(valueOf(lightBlock, t)!.replace('rem', '')));
    for (let i = 1; i < steps.length; i += 1) {
      expect(steps[i]!).toBeGreaterThan(steps[i - 1]!);
    }
  });

  it('просторный режим переопределяет ровно те же имена плотности', () => {
    const missing = DENSITY_TOKENS.filter((t) => !defines(densityBlock, t));
    expect(missing).toEqual([]);
    // И сам компактный режим их тоже задаёт — иначе имя было бы пустым
    // до первого переключения.
    expect(DENSITY_TOKENS.filter((t) => !defines(lightBlock, t))).toEqual([]);
  });

  it('просторный режим просторнее компактного, а не просто другой', () => {
    for (const t of DENSITY_TOKENS) {
      const compact = Number.parseFloat(valueOf(lightBlock, t)!.replace('rem', ''));
      const roomy = Number.parseFloat(valueOf(densityBlock, t)!.replace('rem', ''));
      expect(roomy, `${t}: просторный режим обязан быть больше компактного`).toBeGreaterThan(compact);
    }
  });

  it('ступень кегля называется классом, а не числом в разметке', () => {
    expect(textClass('text-sm')).toBe('ds-text-sm');
    expect(css).toContain('.ds-text-sm');
  });

  it('роль данных отдаётся переменной, а не краской', () => {
    expect(dataVar('bad')).toBe('var(--data-bad)');
  });

  it('категориальный ряд закольцовывается и не выходит за словарь', () => {
    expect(categoricalVar(0)).toBe('var(--cat-1)');
    expect(categoricalVar(8)).toBe('var(--cat-1)');
    expect(categoricalVar(-1)).toBe('var(--cat-8)');
  });

  it('режим высокой контрастности системы описан — иначе рамки пропадают', () => {
    expect(css).toContain('forced-colors: active');
  });
});
