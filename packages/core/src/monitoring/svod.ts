/**
 * svod.ts — лист «СВОДНЫЙ» книги «Ежедневный мониторинг» (спека §1.2, §2.2).
 *
 * Свод книги — таблица девять на восемь: строка 1 занята объединённым
 * заголовком, строки 2–3 держат двухэтажную шапку, строки 4–11 — восемь
 * управлений, строка 12 — «Итого:». Формулы: количество —
 * СЧЁТЕСЛИ по колонке цены, остальное — СУММ по колонкам листа управления.
 *
 * Продукт добавляет к своду три вещи, которых в книге нет и которые прямо
 * названы каноном п.101а (своя сверка, свои сигналы):
 *  1. КОЛОНКУ КОНТРОЛЯ «ВСЕГО = МБ+КБ+ФБ» — сегодня она сразу показывает
 *     три красные строки (УД, УФБП, УО) и разрыв 9 001 582,73 руб. по итогу;
 *  2. ПАРУ «как считает книга ↔ как считает продукт»: свод недосчитывает
 *     73 970 897,35 руб. НМЦК, потому что ячейка 5. УДТХиРКИ!D34 хранится
 *     текстом и формула СУММ её не видит;
 *  3. ЧЕСТНЫЙ СЧЁТЧИК: свод считает непустые ячейки цены (372), продукт
 *     считает строки (374) — разница объясняется, а не сглаживается.
 *
 * Победителя между книгой и продуктом модуль НЕ выбирает: он называет
 * расхождение и его размер, решение — за человеком (спека §7).
 */

import { monitoringNumber, monitoringText, round3 } from './cells.js';
import { MONITORING_SVOD_SHEET, type MonitoringProcedure } from './procedures.js';

/**
 * Написания управлений НА СВОДЕ — третий способ имени после имени листа
 * («4. УАГиЗО») и канонического ид продукта («УАГЗО»). Связь только явной
 * таблицей: подстрока здесь врёт (спека §1.2).
 */
export const MONITORING_SVOD_DEPT_NAMES: ReadonlyArray<{ svodName: string; dept: string }> = [
  { svodName: 'УЭР АЕМР', dept: 'УЭР' },
  { svodName: 'УКСиМП АЕМР', dept: 'УКСиМП' },
  { svodName: 'УИО АЕМР', dept: 'УИО' },
  { svodName: 'УАГЗО АЕМР', dept: 'УАГЗО' },
  { svodName: 'УДТХ АЕМР', dept: 'УДТХ' },
  { svodName: 'УД АЕМР', dept: 'УД' },
  { svodName: 'УФБП АЕМР', dept: 'УФБП' },
  { svodName: 'УО АЕМР', dept: 'УО' },
];

/** Колонки свода (0-based). */
const SVOD_COLUMNS = {
  ORDINAL: 0,
  NAME: 1,
  COUNT: 2,
  NMCK: 3,
  PRICE: 4,
  SAVINGS_TOTAL: 5,
  SAVINGS_MB: 6,
  SAVINGS_KB: 7,
  SAVINGS_FB: 8,
} as const;

/** Строка свода: восемь управлений и «Итого:». */
export interface MonitoringSvodRow {
  /** Номер строки листа СВОДНЫЙ (1-based) — адрес для карточки диагноста. */
  readonly row: number;
  /** Написание на своде («УДТХ АЕМР») либо «Итого:». */
  readonly svodName: string;
  /** Канонический ид продукта; null — итоговая строка. */
  readonly dept: string | null;
  /** true — строка «Итого:». */
  readonly isTotal: boolean;
  /** Количество процедур, как считает книга (непустые ячейки цены). */
  readonly count: number | null;
  readonly nmck: number | null;
  readonly price: number | null;
  readonly savingsTotal: number | null;
  readonly savingsMb: number | null;
  readonly savingsKb: number | null;
  readonly savingsFb: number | null;
  /** МБ+КБ+ФБ, руб. — то, чего на своде книги нет. */
  readonly savingsSplitSum: number | null;
  /** ВСЕГО − (МБ+КБ+ФБ), руб.; null — сравнивать нечего. */
  readonly controlGapRub: number | null;
  /** Контроль сошёлся; null — сравнивать нечего. */
  readonly controlAgrees: boolean | null;
}

export interface MonitoringSvod {
  readonly rows: MonitoringSvodRow[];
  /** Строка «Итого:» отдельно — на неё смотрит шапка вкладки. */
  readonly total: MonitoringSvodRow | null;
  /** Пояснение автора книги из ячейки C14 — переносится дословно. */
  readonly authorNote: string | null;
}

/** Разобрать лист СВОДНЫЙ. Лист не прочитан → пустой разбор, не выдумка. */
export function parseMonitoringSvod(grid: unknown[][] | undefined): MonitoringSvod {
  const rows: MonitoringSvodRow[] = [];
  let total: MonitoringSvodRow | null = null;
  let authorNote: string | null = null;
  if (!grid) return { rows, total, authorNote };

  const byName = new Map(MONITORING_SVOD_DEPT_NAMES.map((e) => [e.svodName, e.dept]));

  for (let i = 0; i < grid.length; i++) {
    const raw = grid[i] ?? [];
    const name = monitoringText(raw[SVOD_COLUMNS.NAME]);
    const ordinalCell = monitoringText(raw[SVOD_COLUMNS.ORDINAL]);
    const isTotal = ordinalCell !== null && /^итого/iu.test(ordinalCell);
    const dept = name === null ? null : byName.get(name) ?? null;
    if (!isTotal && dept === null) {
      // Пояснение автора книги живёт в третьей колонке под таблицей.
      const note = monitoringText(raw[SVOD_COLUMNS.COUNT]);
      if (note !== null && /ячейка считает/iu.test(note)) authorNote = note;
      continue;
    }

    const savingsTotal = monitoringNumber(raw[SVOD_COLUMNS.SAVINGS_TOTAL]);
    const savingsMb = monitoringNumber(raw[SVOD_COLUMNS.SAVINGS_MB]);
    const savingsKb = monitoringNumber(raw[SVOD_COLUMNS.SAVINGS_KB]);
    const savingsFb = monitoringNumber(raw[SVOD_COLUMNS.SAVINGS_FB]);
    const savingsSplitSum = savingsMb === null && savingsKb === null && savingsFb === null
      ? null
      : round3((savingsMb ?? 0) + (savingsKb ?? 0) + (savingsFb ?? 0));
    const controlGapRub = savingsTotal !== null && savingsSplitSum !== null
      ? round3(savingsTotal - savingsSplitSum)
      : null;

    const svodRow: MonitoringSvodRow = {
      row: i + 1,
      svodName: isTotal ? (ordinalCell ?? 'Итого:') : (name ?? ''),
      dept: isTotal ? null : dept,
      isTotal,
      count: monitoringNumber(raw[SVOD_COLUMNS.COUNT]),
      nmck: monitoringNumber(raw[SVOD_COLUMNS.NMCK]),
      price: monitoringNumber(raw[SVOD_COLUMNS.PRICE]),
      savingsTotal,
      savingsMb,
      savingsKb,
      savingsFb,
      savingsSplitSum,
      controlGapRub,
      controlAgrees: controlGapRub === null ? null : Math.abs(controlGapRub) < 0.005,
    };
    rows.push(svodRow);
    if (isTotal) total = svodRow;
  }

  return { rows, total, authorNote };
}

// ── Пара «как считает книга ↔ как считает продукт» ───────────────────

/** Итог одного управления по нашему разбору листа — сторона продукта. */
export interface ProductSideTotals {
  readonly dept: string;
  readonly count: number;
  readonly nmck: number;
  readonly price: number;
  readonly savingsTotal: number;
  readonly savingsMb: number;
  readonly savingsKb: number;
  readonly savingsFb: number;
  /** Адреса ячеек, которые книга не сложила (сумма текстом) — объяснение разницы. */
  readonly textNumberAddresses: readonly string[];
}

/**
 * Сторона продукта по каждому управлению — из разобранных строк листов.
 *
 * Адреса ячеек с суммой-текстом собираются ТОЛЬКО по колонке начальной цены
 * (D): именно они объясняют, почему СУММ свода меньше нашего счёта. Сумма
 * текстом в других колонках — свой сигнал, но не эта разница.
 */
export function productTotalsByDept(
  procedures: readonly MonitoringProcedure[],
): ProductSideTotals[] {
  const acc = new Map<string, {
    count: number; nmck: number; price: number;
    savingsTotal: number; savingsMb: number; savingsKb: number; savingsFb: number;
    textNumbers: string[];
  }>();

  for (const p of procedures) {
    let b = acc.get(p.dept);
    if (b === undefined) {
      b = {
        count: 0, nmck: 0, price: 0,
        savingsTotal: 0, savingsMb: 0, savingsKb: 0, savingsFb: 0,
        textNumbers: [],
      };
      acc.set(p.dept, b);
    }
    b.count += 1;
    b.nmck += p.nmck ?? 0;
    b.price += p.auctionPrice ?? 0;
    b.savingsTotal += p.savingsTotal ?? 0;
    b.savingsMb += p.savingsMb ?? 0;
    b.savingsKb += p.savingsKb ?? 0;
    b.savingsFb += p.savingsFb ?? 0;
    for (const defect of p.defects) {
      if (defect.kind === 'text-number' && /![A-Z]*D\d+$/u.test(defect.address)) {
        b.textNumbers.push(defect.address);
      }
    }
  }

  return [...acc.entries()].map(([dept, b]) => ({
    dept,
    count: b.count,
    nmck: round3(b.nmck),
    price: round3(b.price),
    savingsTotal: round3(b.savingsTotal),
    savingsMb: round3(b.savingsMb),
    savingsKb: round3(b.savingsKb),
    savingsFb: round3(b.savingsFb),
    textNumberAddresses: b.textNumbers,
  }));
}

/** Строка сравнения: книга и продукт рядом, победитель не выбирается. */
export interface SvodComparisonRow {
  readonly dept: string;
  readonly svodName: string;
  /** Сторона книги (формулы свода). */
  readonly book: {
    readonly count: number | null;
    readonly nmck: number | null;
    readonly price: number | null;
    readonly savingsTotal: number | null;
  };
  /** Сторона продукта (наш разбор листа управления). */
  readonly product: {
    readonly count: number;
    readonly nmck: number;
    readonly price: number;
    readonly savingsTotal: number;
  };
  /** Продукт − книга, руб. и штуки; null — книга молчит. */
  readonly nmckDeltaRub: number | null;
  readonly priceDeltaRub: number | null;
  readonly savingsDeltaRub: number | null;
  readonly countDelta: number | null;
  /** Почему расходится, одной фразой без упрёка; null — сходится. */
  readonly explanation: string | null;
}

export interface SvodComparison {
  readonly rows: SvodComparisonRow[];
  /** Итог обеих сторон — то, что стоит в шапке вкладки. */
  readonly bookTotals: { nmck: number | null; price: number | null; savingsTotal: number | null; count: number | null };
  readonly productTotals: { nmck: number; price: number; savingsTotal: number; count: number };
}

/**
 * Сопоставить свод книги с нашим разбором листов.
 *
 * Разница по НМЦК объясняется адресно: ячейки, где сумма записана текстом,
 * известны построчно, и их вес складывается в объяснение. Там, где объяснить
 * нечем, продукт так и говорит — «расходится, причина не установлена».
 */
export function compareSvodWithProduct(
  svod: MonitoringSvod,
  productByDept: ReadonlyArray<ProductSideTotals>,
): SvodComparison {
  const productMap = new Map(productByDept.map((p) => [p.dept, p]));
  const rows: SvodComparisonRow[] = [];

  for (const svodRow of svod.rows) {
    if (svodRow.isTotal || svodRow.dept === null) continue;
    const product = productMap.get(svodRow.dept);
    if (product === undefined) continue;

    const nmckDeltaRub = svodRow.nmck === null ? null : round3(product.nmck - svodRow.nmck);
    const priceDeltaRub = svodRow.price === null ? null : round3(product.price - svodRow.price);
    const savingsDeltaRub = svodRow.savingsTotal === null
      ? null
      : round3(product.savingsTotal - svodRow.savingsTotal);
    const countDelta = svodRow.count === null ? null : product.count - svodRow.count;

    let explanation: string | null = null;
    if (nmckDeltaRub !== null && Math.abs(nmckDeltaRub) >= 0.005) {
      explanation = product.textNumberAddresses.length > 0
        ? `Начальная цена в ячейках ${product.textNumberAddresses.join(', ')} хранится текстом, и формула СУММ её не складывает — свод меньше нашего счёта на эту сумму.`
        : 'Свод и разбор листа расходятся; ячейки с суммой-текстом на листе не найдены — причина требует взгляда человека.';
    } else if (countDelta !== null && countDelta !== 0) {
      explanation = 'Свод считает непустые ячейки цены аукциона, продукт считает строки листа: у части процедур цены нет вовсе.';
    }

    rows.push({
      dept: svodRow.dept,
      svodName: svodRow.svodName,
      book: {
        count: svodRow.count,
        nmck: svodRow.nmck,
        price: svodRow.price,
        savingsTotal: svodRow.savingsTotal,
      },
      product: {
        count: product.count,
        nmck: round3(product.nmck),
        price: round3(product.price),
        savingsTotal: round3(product.savingsTotal),
      },
      nmckDeltaRub,
      priceDeltaRub,
      savingsDeltaRub,
      countDelta,
      explanation,
    });
  }

  const productTotals = productByDept.reduce(
    (acc, p) => ({
      nmck: round3(acc.nmck + p.nmck),
      price: round3(acc.price + p.price),
      savingsTotal: round3(acc.savingsTotal + p.savingsTotal),
      count: acc.count + p.count,
    }),
    { nmck: 0, price: 0, savingsTotal: 0, count: 0 },
  );

  return {
    rows,
    bookTotals: {
      nmck: svod.total?.nmck ?? null,
      price: svod.total?.price ?? null,
      savingsTotal: svod.total?.savingsTotal ?? null,
      count: svod.total?.count ?? null,
    },
    productTotals,
  };
}

/** Адрес разрыва свода — карточка диагноста ссылается на конкретные ячейки. */
export const SVOD_CONTROL_ADDRESS = `${MONITORING_SVOD_SHEET}!F12 против G12+H12+I12`;
