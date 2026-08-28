/**
 * Страж §16.1 «Подпись не обрезается никогда» + точечные §16.2 —
 * канон docs/superpowers/specs/2026-08-22-pulse-feedback-2.md.
 *
 * ПРАВИЛО §16.1. Плотность добирается размером и перестройкой ячейки, а не
 * многоточием: перенос ряда, короткое имя из словаря, другой порядок.
 * Многоточие в навигации и барабанах = брак вёрстки («Дисципл…»,
 * «Монитор…», слипшиеся «МайИюн» — разбор владельца 29.08).
 *
 * ПЕРИМЕТР. Зона шапки/линейки: навигация (np-*), жетоны отбора (sel-*),
 * эфир угла (lh-*, hdr-*), кнопки фильтров (vf-*), барабаны времени (tg-*),
 * полоса организаций (ob-*) и мёртвое семейство os-*. Зоны ВНЕ шапки
 * (таблицы, карточки страниц) — вне периметра этого стража.
 *
 * ПРАВИЛО §16.2. Лазурь — привилегия кремовых предметов: кремовая вкладка
 * и кремовый переключатель несут лазурную пару (ореол крупному, кромка
 * мелкому; во тьме ярче), некремовые светятся собственным тоном раздела.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const css = readFileSync(join(SRC, 'index.css'), 'utf8');
/** CSS без комментариев: чтобы упоминание свойства в тексте не считалось. */
const cssBare = css.replace(/\/\*[\s\S]*?\*\//g, '');

/** Листовые правила: `селектор { объявления }` без вложенных скобок.
 * Тела @media/@layer содержат скобки и сами не матчатся — их внутренние
 * правила ловятся по отдельности, вложенность безразлична. */
function leafRules(): { selector: string; body: string }[] {
  const out: { selector: string; body: string }[] = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(cssBare)) !== null) {
    const selector = m[1].trim();
    if (selector.startsWith('@')) continue; // @property, @keyframes-кадры и т.п.
    out.push({ selector, body: m[2] });
  }
  return out;
}

/** Все тела правил, чей селектор содержит данный класс (включая @media-копии). */
function bodiesOf(cls: string): string {
  return leafRules()
    .filter((r) => r.selector.includes(cls))
    .map((r) => r.body)
    .join('\n');
}

/** Префиксы классов зоны шапки/навигации/жетонов. */
const ZONE = ['.np-', '.nav-', '.sel-', '.lh-', '.hdr-', '.vf-', '.tg-', '.os-', '.ob-'];

/** Именованный долг: лечение требует перестройки строки в LiveHistory.tsx
 * (тикер мини-барабана эфира — фиксированные 14px, перенос невозможен без
 * смены устройства строки), что вне периметра css-волны 29.08. Любой НОВЫЙ
 * ellipsis в зоне стража всё равно валит тест. */
const DEBT = new Set(['.lh-s']);

describe('§16.1 — многоточие в зоне шапки/навигации/жетонов', () => {
  const offenders: string[] = [];
  for (const { selector, body } of leafRules()) {
    if (!ZONE.some((p) => selector.includes(p))) continue;
    if (/text-overflow\s*:\s*ellipsis/.test(body)) {
      offenders.push(selector.replace(/\s+/g, ' '));
    }
  }

  it('инвентарь ellipsis в зоне шапки пуст (кроме именованного долга)', () => {
    const fresh = offenders.filter((s) => ![...DEBT].some((d) => s.includes(d)));
    expect(fresh, 'подпись не режется: перенос ряда или короткое имя из словаря').toEqual([]);
  });

  it('долг существует, пока он в списке (вычеркнуть при лечении LiveHistory)', () => {
    for (const d of DEBT) {
      expect(
        offenders.some((s) => s.includes(d)),
        `${d} вылечен — убрать его из DEBT, чтобы страж стал строже`,
      ).toBe(true);
    }
  });

  it('вылеченные подписи несут перенос, а не просто голый обрез', () => {
    for (const cls of ['.np-label', '.sel-chip-label', '.ob-chip', '.ob-dept-name']) {
      expect(bodiesOf(cls), `${cls} обязан переносить текст (overflow-wrap)`)
        .toMatch(/overflow-wrap\s*:\s*anywhere/);
    }
  });
});

describe('§16.2 — лазурь только кремовым, остальным свой тон', () => {
  it('активная вкладка по умолчанию светится собственным тоном раздела', () => {
    const rule = leafRules().find(
      (r) => r.selector.trim() === '.np-btn-active .np-content',
    );
    expect(rule, 'правило .np-btn-active .np-content обязано существовать').toBeDefined();
    expect(rule!.body, 'некремовая вкладка лазурь не получает').not.toContain('--lazur');
    expect(rule!.body, 'свечение — тоном раздела').toMatch(/box-shadow[\s\S]*var\(--np-tone\)/);
  });

  it('лазурный ореол вкладки ограничен кремовыми красками', () => {
    const creamRules = leafRules().filter(
      (r) => r.selector.includes('.np-btn-active') && /--lazur/.test(r.body),
    );
    expect(creamRules.length, 'ореол зари обязан существовать').toBeGreaterThan(0);
    for (const r of creamRules) {
      // Каждый селектор с лазурью привязан к кремовой краске раздела.
      for (const part of r.selector.split(',')) {
        expect(
          /#e5d3a9|#fde68a/.test(part),
          `лазурь без кремовой привязки: ${part.trim()}`,
        ).toBe(true);
      }
    }
  });

  /** Доля лазури в первой color-mix-кромке тела правила. */
  function lazurShare(body: string): number {
    const m = body.match(/color-mix\(in srgb, var\(--lazur\)\s*(\d+)%/);
    expect(m, 'лазурная кромка не найдена').not.toBeNull();
    return Number(m![1]);
  }

  it('кремовый переключатель единиц несёт лазурную кромку, во тьме ярче', () => {
    const light = leafRules().find((r) => r.selector.trim() === '.vf-cur-active');
    const dark = leafRules().find((r) => r.selector.trim() === '.dark .vf-cur-active');
    expect(light).toBeDefined();
    expect(dark).toBeDefined();
    expect(light!.body).toMatch(/0 0 0 1px color-mix\(in srgb, var\(--lazur\)/);
    expect(dark!.body).toMatch(/0 0 0 1px color-mix\(in srgb, var\(--lazur\)/);
    expect(lazurShare(dark!.body), 'тёмная кромка — на ступень ярче светлой')
      .toBeGreaterThan(lazurShare(light!.body));
  });

  it('полный квартал несёт вписанную лазурную кромку, во тьме ярче', () => {
    const light = leafRules().find((r) => r.selector.trim() === '.tg-quarter-tab-full');
    const dark = leafRules().find((r) => r.selector.trim() === '.dark .tg-quarter-tab-full');
    expect(light).toBeDefined();
    expect(dark).toBeDefined();
    expect(light!.body).toMatch(/inset 0 0 0 1px color-mix\(in srgb, var\(--lazur\)/);
    expect(dark!.body).toMatch(/inset 0 0 0 1px color-mix\(in srgb, var\(--lazur\)/);
    expect(lazurShare(dark!.body), 'тёмная кромка — на ступень ярче светлой')
      .toBeGreaterThan(lazurShare(light!.body));
  });
});
