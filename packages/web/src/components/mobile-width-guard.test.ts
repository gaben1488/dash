/**
 * Grep-страж мобильной вёрстки (директива п.73а): в новых компонентах волн не
 * должно быть фиксированных ширин больше 430px — такой элемент гарантированно
 * ломает вёрстку на смартфоне (360–430px), выталкивая страницу в горизонтальную
 * прокрутку. Ширине больше порога разрешено существовать только как «потолку»
 * (max-w-*) или с прижимом к экрану (min(...px, calc(100vw - ...))) — их страж
 * не трогает.
 *
 * Визуальных регрессий у проекта нет — это дешёвая замена: новый компонент с
 * жёсткой шириной упадёт здесь, а не на телефоне владельца.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));

/** Периметр стража: компоненты новых волн + канонические плашка и подсказки. */
const GUARDED = [
  'competition',
  'discipline',
  'timeline',
  'yearlong',
  'DiagnosticCards.tsx',
  'PeriodBadge.tsx',
  'EmptyState.tsx',
  join('ui', 'kb-tooltip.tsx'),
  join('contract', 'KbHover.tsx'),
];

/** Максимальная жёсткая ширина, безопасная для смартфона. */
const MAX_FIXED_PX = 430;

function collectFiles(path: string): string[] {
  const st = statSync(path);
  if (st.isFile()) return path.endsWith('.tsx') || path.endsWith('.ts') ? [path] : [];
  return readdirSync(path).flatMap((name) => collectFiles(join(path, name)));
}

interface Violation { file: string; match: string }

/**
 * Жёсткие ширины: tailwind-классы w-[NNNpx] / min-w-[NNNpx] / basis-[NNNpx]
 * и инлайновые width: 'NNNpx'. max-w и min(...) — потолки, они безопасны.
 */
function findFixedWidths(source: string, file: string): Violation[] {
  const out: Violation[] = [];
  const classRe = /(?<!max-)(?:min-)?(?:w|basis)-\[(\d+)px\]/g;
  const styleRe = /(?<![a-zA-Z-])width:\s*'?(\d+)px/g;
  for (const re of [classRe, styleRe]) {
    for (const m of source.matchAll(re)) {
      if (Number(m[1]) > MAX_FIXED_PX) out.push({ file, match: m[0] });
    }
  }
  return out;
}

describe('мобильный страж: нет фиксированных ширин шире 430px', () => {
  it('новые компоненты волн умещаются в смартфонный экран', () => {
    const violations: Violation[] = [];
    for (const entry of GUARDED) {
      for (const file of collectFiles(join(HERE, entry))) {
        violations.push(...findFixedWidths(readFileSync(file, 'utf8'), relative(HERE, file)));
      }
    }
    expect(
      violations,
      `Жёсткая ширина шире ${MAX_FIXED_PX}px ломает телефон: ${violations
        .map((v) => `${v.file} → ${v.match}`)
        .join('; ')}. Замените на max-w-*, проценты или min(...px, calc(100vw - 32px)).`,
    ).toEqual([]);
  });
});
