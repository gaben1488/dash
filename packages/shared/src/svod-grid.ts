/**
 * svod-grid.ts — структурный ридер листа СВОД ТД-ПМ (ре-реверс 16.07.2026).
 *
 * ФАКТ листа (проба живого листа, не карта): каждый блок ЭА|ЕП × (ВСЕ + 8 ГРБС)
 * содержит строки-периоды с ЯВНЫМИ колонками B=«Квартал» (1..4) и C=«Год»
 * (2025|2026) — все кварталы двух лет, а не только Q1 — плюс два итога:
 * «Итого … 2025+2026» и «Итого … 2026». Старый report-map мапил адресно только
 * Q1-2026 и годовой итог (~треть информации листа) — и это годами выдавалось за
 * структуру листа. Урок: утверждения о структуре — только пробой живого листа.
 *
 * Ридер НЕ адресный: блоки РАЗНОЙ высоты (у части ГРБС нет строки Q1-2025 —
 * не было закупок), поэтому сканируем структуру: старт блока = строка с A из
 * реестра скоупов, период-строки = B∈1..4 и C∈{годы}, итоги = A начинается с
 * «Итого». Метод блока (КП|ЕП) — по ближайшему заголовку выше (D3/D15:
 * «ЭА, ЭЗК…» | «ЕП»).
 *
 * Колонки строки-периода (шапка стр.5-6 листа):
 *   D=план ед., E=факт ед., F=отклонение ед., G=выполнено % (доля 0..1),
 *   H..K = ПЛАН ФБ/КБ/МБ/ИТОГО (тыс. руб.), L..O = ФАКТ ФБ/КБ/МБ/ИТОГО,
 *   P=отклонение тыс., Q=потрачено % (доля), R..U = ЭКОНОМИЯ ФБ/КБ/МБ/ИТОГО.
 */

import { DEPARTMENT_REGISTRY } from './department-registry.js';

/** 0-based индексы колонок строки-периода. */
export const SVOD_GRID_COLS = {
  scope: 0,        // A
  quarter: 1,      // B
  year: 2,         // C
  planCount: 3,    // D
  factCount: 4,    // E
  devCount: 5,     // F
  execPct: 6,      // G (доля 0..1)
  planFB: 7,       // H
  planKB: 8,       // I
  planMB: 9,       // J
  planTotal: 10,   // K
  factFB: 11,      // L
  factKB: 12,      // M
  factMB: 13,      // N
  factTotal: 14,   // O
  devMoney: 15,    // P
  spentPct: 16,    // Q (доля 0..1)
  economyFB: 17,   // R
  economyKB: 18,   // S
  economyMB: 19,   // T
  economyTotal: 20, // U
} as const;

export interface SvodGridPeriod {
  quarter: 1 | 2 | 3 | 4;
  year: number;
  /**
   * Строка листа (1-based), из которой прочитан период — провенанс числа.
   * Хранится, а не вычисляется от startRow: блоки разной высоты, и любая
   * арифметика «старт + индекс» соврёт на первом же пропущенном квартале.
   * Адрес ячейки собирается с колонкой: `svodCellRef(row, 'factCount')`.
   */
  row: number;
  planCount: number;
  factCount: number;
  devCount: number;
  execPct: number;
  planFB: number; planKB: number; planMB: number; planTotal: number;
  factFB: number; factKB: number; factMB: number; factTotal: number;
  devMoney: number;
  spentPct: number;
  economyFB: number; economyKB: number; economyMB: number; economyTotal: number;
}

/** Итог блока (без quarter/year/row — строка «Итого …»). */
export type SvodGridTotal = Omit<SvodGridPeriod, 'quarter' | 'year' | 'row'>;

export interface SvodGridBlock {
  /** «ВСЕ» или короткое имя ГРБС («УЭР»…). */
  scope: string;
  /** КП = конкурентные (ЭА/ЭЗК/ЭК и аналоги), ЕП = единственный поставщик. */
  method: 'КП' | 'ЕП';
  /** Строка листа (1-based), с которой начинается блок — для трассировки. */
  startRow: number;
  periods: SvodGridPeriod[];
  /** «Итого … 2025+2026» — двухлетний итог блока. */
  totalBothYears?: SvodGridTotal;
  /** «Итого … 2026» — итог текущего план-года. */
  totalY2026?: SvodGridTotal;
}

const num = (v: unknown): number => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  if (v === null || v === undefined || v === '') return 0;
  const parsed = Number.parseFloat(String(v).replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : 0;
};

const C = SVOD_GRID_COLS;

/**
 * Адрес ячейки листа СВОД в нотации A1 — провенанс официального числа.
 * Читателю он говорит, куда смотреть в живой книге, а нам — что число
 * не выдумано: `svodCellRef(268, 'factCount')` → «E268».
 * Колонки листа не заходят за Z, поэтому одной буквы достаточно.
 */
export function svodCellRef(row: number, col: keyof typeof SVOD_GRID_COLS): string {
  return `${String.fromCharCode(65 + SVOD_GRID_COLS[col])}${row}`;
}

function readMetrics(row: unknown[]): SvodGridTotal {
  return {
    planCount: num(row[C.planCount]),
    factCount: num(row[C.factCount]),
    devCount: num(row[C.devCount]),
    execPct: num(row[C.execPct]),
    planFB: num(row[C.planFB]), planKB: num(row[C.planKB]), planMB: num(row[C.planMB]), planTotal: num(row[C.planTotal]),
    factFB: num(row[C.factFB]), factKB: num(row[C.factKB]), factMB: num(row[C.factMB]), factTotal: num(row[C.factTotal]),
    devMoney: num(row[C.devMoney]),
    spentPct: num(row[C.spentPct]),
    economyFB: num(row[C.economyFB]), economyKB: num(row[C.economyKB]), economyMB: num(row[C.economyMB]), economyTotal: num(row[C.economyTotal]),
  };
}

/** Скоупы блоков: «ВСЕ» + короткие имена ГРБС из реестра. */
function knownScopes(): Set<string> {
  return new Set(['ВСЕ', ...DEPARTMENT_REGISTRY.map(d => d.shortName)]);
}

/**
 * Разобрать значения листа СВОД ТД-ПМ в структурную модель блоков.
 * Значения — как отдаёт Sheets API (UNFORMATTED_VALUE), 0-based массив строк.
 */
export function parseSvodGrid(values: unknown[][]): SvodGridBlock[] {
  const scopes = knownScopes();
  const blocks: SvodGridBlock[] = [];
  /** Метод по последнему встреченному заголовку колонки D («ЭА…» | «ЕП»). */
  let currentMethod: 'КП' | 'ЕП' = 'КП';
  let block: SvodGridBlock | null = null;

  for (let i = 0; i < values.length; i++) {
    const row = values[i] ?? [];
    const a = String(row[C.scope] ?? '').trim();
    const dHeader = String(row[C.planCount] ?? '').trim();

    // Заголовок секции («ГРБС | Квартал | Год | ЭА…/ЕП») задаёт метод следующего блока.
    if (a === 'ГРБС' && dHeader) {
      currentMethod = /^ЕП/i.test(dHeader) ? 'ЕП' : 'КП';
      block = null;
      continue;
    }

    const quarter = num(row[C.quarter]);
    const year = num(row[C.year]);
    const isPeriodRow = quarter >= 1 && quarter <= 4 && year >= 2000;

    // Старт блока: A = известный скоуп И это период-строка.
    if (a && scopes.has(a) && isPeriodRow) {
      block = { scope: a, method: currentMethod, startRow: i + 1, periods: [] };
      blocks.push(block);
    }

    if (block && isPeriodRow) {
      block.periods.push({ quarter: quarter as 1 | 2 | 3 | 4, year, row: i + 1, ...readMetrics(row) });
      continue;
    }

    // Итоги блока: «Итого ЭА 2025+2026» / «Итого ЕП 2026» / …
    if (block && a.startsWith('Итого')) {
      if (a.includes('2025+2026')) block.totalBothYears = readMetrics(row);
      else block.totalY2026 = readMetrics(row);
      continue;
    }

    // Любая другая непустая A-строка (ИТОГО:, доли, пустые разделители) закрывает блок.
    if (block && a && !scopes.has(a)) block = null;
  }

  return blocks;
}
