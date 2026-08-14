/**
 * Страж домов понятий.
 *
 * Класс дефекта: одно понятие живёт в нескольких местах, копии расходятся, и
 * два экрана честно показывают разные числа из одних данных. Сейчас в коде три
 * разных fmtPct и дюжина самописных коэрций «строка → число» — каждая со своим
 * мнением о неразрывном пробеле и запятой.
 *
 * Тест не требует убрать долг разом: он фиксирует известные копии поимённо и
 * краснеет только на НОВЫХ. Убыль копий волной В0 — повод вычеркнуть строку
 * из списка ниже, прибыль — повод объяснить человеку, зачем ещё одна.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/** Корень монорепы по пакетам: путь этого файла — packages/shared/src. */
const PACKAGES = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const SKIP = new Set(['node_modules', 'dist', 'build', 'coverage', '.vite']);

function sources(dir: string = PACKAGES, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry)) continue;
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) sources(p, out);
    else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(p);
  }
  return out;
}

/** Дом форматирования отчётных чисел. */
const FMT_HOME = 'web/src/lib/report/mappers.ts';
/** Дом коэрции: этой функцией считается официальный СВОД. */
const COERCE_HOME = 'shared/src/svod-grid.ts';

/** Долг: копии форматтеров вне дома. Сокращается волной В0. */
const FMT_DEBT: Record<string, string[]> = {
  'web/src/lib/recon/format.ts': ['fmtPct'],
  'web/src/pages/SvodView.tsx': ['fmtCount', 'fmtPct', 'fmtMoney'],
};

/** Долг: сколько самописных коэрций в файле известно. Сокращается волной В0. */
const COERCE_DEBT: Record<string, number> = {
  // Волна «строка во времени» (14.08, п.75): две локальные sheetNumber с РАЗНОЙ
  // семантикой мусора — у таймлайна мусор → null (дифф не выдумывает нулей),
  // у «близких к реализации» мусор → 0 (слагаемое суммы). Консолидация в дом
  // коэрции — волной В0, вместе с остальными строками этого списка.
  'core/src/timeline/row-timeline.ts': 1,
  'core/src/timeline/upcoming.ts': 1,
  'core/src/pipeline/ingest.ts': 1,
  'core/src/pipeline/normalize.ts': 1,
  'core/src/pipeline/normalizer-rules.ts': 2,
  'core/src/pipeline/signals.ts': 1,
  'server/src/routes/reconciliation.ts': 1,
  'server/src/routes/rows.ts': 2,
  'server/src/services/rows-dto.ts': 1,
  'shared/src/rule-book.ts': 1,
  'web/src/components/TableEditor.tsx': 1,
};

const FMT_DECL = /^\s*(?:export\s+)?(?:async\s+)?(?:function|const)\s+(fmtPct|fmtMoney|fmtCount|fmtThousands)\b/;

describe('дома понятий', () => {
  const fmtFound: string[] = [];
  const coerceFound: Record<string, number> = {};

  for (const file of sources()) {
    const rel = relative(PACKAGES, file).split(sep).join('/');
    const lines = readFileSync(file, 'utf8').split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const decl = lines[i].match(FMT_DECL);
      if (decl) fmtFound.push(`${rel}:${decl[1]}`);
      // Срезание ВСЕХ пробелов — подпись числовой коэрции; parseFloat/Number
      // рядом (окно ±6 строк) отличает её от нормализации текста.
      if (!lines[i].includes('replace(/\\s/g')) continue;
      const near = lines.slice(Math.max(0, i - 6), i + 7).join('\n');
      if (/parseFloat|parseInt|\bNumber\s*[.(]/.test(near)) coerceFound[rel] = (coerceFound[rel] ?? 0) + 1;
    }
  }

  it('форматтеры отчётных чисел объявлены в доме либо числятся в долге', () => {
    const strays = fmtFound.filter((hit) => {
      const [rel, name] = hit.split(':');
      return rel !== FMT_HOME && !(FMT_DEBT[rel] ?? []).includes(name);
    });
    expect(strays).toEqual([]);
  });

  it('коэрция «строка → число» не расплодилась сверх учтённого долга', () => {
    const strays: string[] = [];
    for (const [rel, count] of Object.entries(coerceFound)) {
      if (rel === COERCE_HOME) continue;
      const known = COERCE_DEBT[rel] ?? 0;
      if (count > known) strays.push(`${rel}: копий ${count}, в долге ${known}`);
    }
    expect(strays).toEqual([]);
  });

  it('оба дома существуют — иначе страж сторожит пустоту', () => {
    // Без этой проверки переименование файла-дома молча превратит тест в
    // «всё разрешено»: дома нет, значит и нарушений нет.
    expect(fmtFound.some((h) => h.startsWith(`${FMT_HOME}:`))).toBe(true);
    expect(coerceFound[COERCE_HOME]).toBeGreaterThan(0);
  });
});
