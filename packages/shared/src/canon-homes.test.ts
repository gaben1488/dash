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
  // Шов 17 реестра швов 09.07.2026 (сверка 18.08): волны августа завели свои
  // форматтеры мимо дома. Оба файла принадлежат живым волнам («Нагрузка
  // управлений» и «Мониторинг») — переносить их в дом чужой рукой нельзя,
  // поэтому копии учтены здесь поимённо. Консолидация — волной В0.
  'web/src/components/workload/contract.ts': ['fmtCount'],
  'web/src/lib/monitoring/format.ts': ['fmtPct', 'fmtCount'],
  // Волна «Гигиена текстов» (20.08, п.122) — живая на момент сверки зоны В:
  // её fmtCount учтён тем же порядком, что и два соседа выше. Консолидация
  // всех форматтеров в дом — волной В0.
  'web/src/components/text-hygiene/contract.ts': ['fmtCount'],
};

/** Долг: сколько самописных коэрций в файле известно. Сокращается волной В0. */
const COERCE_DEBT: Record<string, number> = {
  // Волна «строка во времени» (14.08, п.75), ужата чисткой 20.08 (зона В):
  // sheetNumber (row-timeline) — ЕДИНСТВЕННАЯ null-коэрция ядра. К ней
  // сведены копии upcoming.ts («мусор → 0» = `sheetNumber(v) ?? 0`),
  // ingest.ts (getCellNumber удалена вместе с мёртвым grid-путём), а также
  // normalize.ts, normalizer-rules.ts (2 шт.) и signals.ts (toNumber =
  // `sheetNumber(v) ?? NaN`) — у всех семантика «мусор → null/NaN»
  // совпадала. Оставшаяся единственная — до В0: дом (svod-grid) отдаёт 0
  // и на пустоту, и на мусор, а диффу таймлайна нужен честный null;
  // в В0 sheetNumber переезжает в дом как его null-вариант.
  'core/src/timeline/row-timeline.ts': 1,
  'server/src/routes/reconciliation.ts': 1,
  'server/src/routes/rows.ts': 2,
  'server/src/services/rows-dto.ts': 1,
  'shared/src/rule-book.ts': 1,
  // Волна «Мониторинг» (18.08, п.69в/п.101а): monitoringNumber читает книгу
  // «Ежедневный мониторинг» — там суммы В РУБЛЯХ и часто текстом с
  // неразрывными пробелами («2 250 000,00»), а нечисло обязано давать null,
  // не ноль: ноль в цене аукциона — содержательное «торги без результата».
  // Дом коэрции (svod-grid) заточен под сетку СВОДа в тысячах, поэтому
  // семантика не совпадает; консолидация — волной В0 вместе с остальным.
  'core/src/monitoring/procedures.ts': 1,
  'web/src/components/TableEditor.tsx': 1,
  // Волна «Провенанс плановых сумм» (18.08, п.102). Обе коэрции обязаны
  // отличать ПУСТУЮ плановую ячейку от НУЛЕВОЙ: null значит «плана нет», 0 —
  // «план равен нулю», и это разные факты (нулевой план — заполненная ячейка).
  // Дом коэрции (svod-grid) отдаёт 0 и на пустоту, и на мусор, то есть стирает
  // ровно то различие, на котором стоит провенанс; вдобавок ядро отличает
  // третье состояние — «журнал сам не знает прежнего значения». Консолидация —
  // волной В0, но только вместе с введением в доме варианта, дающего null.
  'core/src/provenance/plan-provenance.ts': 1,
  'server/src/routes/provenance.ts': 1,
  // Шов 17 реестра швов 09.07.2026 (сверка 18.08): четыре коэрции волн августа
  // мимо дома. У каждой семантика расходится с домом (svod-grid отдаёт 0 и на
  // пустоту, и на мусор), поэтому механически перевести нельзя:
  //  — journalNumber (журнал правок): пусто и «(пусто)» → null — журнал пишет
  //    и числом, и текстом, и «684.0» рядом с 684;
  //  — num (контракт мониторинга): ноль — значение, а не пустота; мусор → null;
  //  — hasFactMoney (согласованность комментариев): не коэрция-значение, а
  //    предикат «есть ли деньги хоть в одной из V/W/X/Y» — мусор просто false.
  // Все четыре файла принадлежат живым волнам (аналитика, мониторинг,
  // согласованность комментариев). Консолидация — волной В0, после появления
  // в доме варианта с null-семантикой (см. запись про plan-provenance выше).
  'core/src/analytics/anomaly-detection.ts': 1,
  'core/src/monitoring/cells.ts': 1,
  'core/src/pipeline/comment-consistency.ts': 1,
  'web/src/lib/monitoring/contract.ts': 1,
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
