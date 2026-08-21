/**
 * Страж границ поверхностей — канон п.129, жалоба владельца, повторённая
 * четырежды: «убери эти уродливые обводки», «коричневое г по всему проекту».
 *
 * ПРАВИЛО. В тёмной теме поверхности разделяет СВЕТЛОТА, а не обводка:
 * карточка светлее страницы, плитка светлее карточки. Обводка сохраняется
 * только у того, что человек трогает (кнопка, поле ввода, переключатель),
 * у линеек таблиц и у окон поверх страницы — там светлота не работает,
 * потому что фон под ними произвольный.
 *
 * ПОЧЕМУ СТРАЖ ИМЕННО ТАКОЙ. Первая чистка искала строки вида
 * `dark:border-zinc-700/50` и пропустила два источника: границу из токена
 * темы (`border-[var(--line-strong)]` — поиск по «dark:border» её не видит)
 * и цветные рамки состояния (`dark:border-amber-700/40`). Поэтому страж
 * проверяет ТРИ вещи разом: сам токен темы, отсутствие цветных рамок
 * состояния и отсутствие серых рамок на поверхностях.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const SRC = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      walk(full, out);
    } else if (extname(full) === '.tsx' && !full.includes('.test.')) {
      out.push(full);
    }
  }
  return out;
}

/** Строки, где обводка законна: управление, линейка, состояние фокуса. */
const LEGITIMATE = /focus|hover:|ring-|border-b|border-t|border-l|border-r|divide-/;

describe('границы поверхностей в тёмной теме', () => {
  it('тема объявляет карточный токен, и в тёмной он прозрачен', () => {
    const css = readFileSync(join(SRC, 'index.css'), 'utf8');
    expect(css, 'светлая тема обязана объявить --line-card').toMatch(/--line-card:\s*#[0-9a-f]{6}/i);
    // В блоке тёмной темы карточный токен гаснет.
    const darkBlock = css.slice(css.indexOf('--surface-page: #0a0a0b'));
    expect(darkBlock, 'в тёмной теме --line-card обязан быть прозрачным')
      .toMatch(/--line-card:\s*transparent/);
  });

  it('карточка-примитив рисует границу карточным токеном, а не крепким', () => {
    const card = readFileSync(join(SRC, 'components/ui/card.tsx'), 'utf8');
    expect(card).toContain('border-[var(--line-card)]');
    expect(card, 'карточка не должна брать границу управления').not.toContain('border-[var(--line-strong)]');
  });

  it('ни одна поверхность не несёт цветной рамки состояния в тёмной теме', () => {
    const offenders: string[] = [];
    for (const file of walk(join(SRC, 'components')).concat(walk(join(SRC, 'pages')))) {
      const text = readFileSync(file, 'utf8');
      text.split('\n').forEach((line, i) => {
        if (LEGITIMATE.test(line)) return;
        if (/dark:border-(amber|red|orange|emerald|blue|green|rose|yellow|purple|cyan|indigo)-\d{3}/.test(line)) {
          offenders.push(`${file.split(/[\\/]/).pop()}:${i + 1}`);
        }
      });
    }
    expect(offenders, 'состояние несут заливка, акцент и слово — не рамка').toEqual([]);
  });

  it('ни одна поверхность не несёт серой рамки в тёмной теме', () => {
    const offenders: string[] = [];
    for (const file of walk(join(SRC, 'components')).concat(walk(join(SRC, 'pages')))) {
      const text = readFileSync(file, 'utf8');
      text.split('\n').forEach((line, i) => {
        if (LEGITIMATE.test(line)) return;
        if (/dark:border-zinc-\d{3}/.test(line)) {
          offenders.push(`${file.split(/[\\/]/).pop()}:${i + 1}`);
        }
      });
    }
    expect(offenders, 'поверхности разделяет светлота, а не частокол обводок').toEqual([]);
  });
});
