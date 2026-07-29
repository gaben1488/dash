/**
 * svod-grid.ts — структурный ридер листа СВОД ТД-ПМ (ре-реверс 16.07.2026).
 *
 * ФАКТ листа (проба живого листа, не карта): каждый блок ЭА|ЕП × (ВСЕ + 8 ГРБС)
 * содержит строки-периоды с ЯВНЫМИ колонками B=«Квартал» (1..4) и C=«Год»
 * (2025|2026) — все кварталы двух лет, а не только 1 кв — плюс два итога:
 * «Итого … 2025+2026» и «Итого … 2026». Старый report-map мапил адресно только
 * 1 кв-2026 и годовой итог (~треть информации листа) — и это годами выдавалось за
 * структуру листа. Урок: утверждения о структуре — только пробой живого листа.
 *
 * Ридер НЕ адресный: блоки РАЗНОЙ высоты (у части ГРБС нет строки 1 кв-2025 —
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
  /** «Итого … 2025+2026» — двухлетний итог блока; row — строка листа. */
  totalBothYears?: SvodGridTotal & { row: number };
  /** «Итого … 2026» — итог текущего план-года; row — строка листа. */
  totalY2026?: SvodGridTotal & { row: number };
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

// ── Итоговый ярус листа: то, что лист считает САМ, помимо блоков ──────
//
// Найдено 29.07.2026 прямым чтением листа: parseSvodGrid читает только
// строки-периоды и «Итого <метод>», а лист держит ещё три яруса чисел,
// которые до сих пор не попадали в продукт ни разу:
//   • строка 2 — «Остаток к заключ.» с разбивкой ФБ/КБ/МБ/ИТОГО;
//   • «ИТОГО 2025+2026:» / «ИТОГО 2026:» по каждому скоупу — ЗАГЛАВНЫМИ,
//     поэтому проверка startsWith('Итого') их не ловила (18 строк);
//   • «Доля ЭА…» / «Доля ЕП:» и рядом «Расч. экономия» ФБ/КБ/МБ/ИТОГО —
//     та самая расчётная экономия остатка из ручного отчёта.

/** Колонки итогового яруса (0-based), отличные от периодных. */
const EXTRA_COLS = {
  /** Доля метода: G — за два года, H — за 2026. */
  shareBothYears: 6,
  shareY2026: 7,
  /** «Расч. экономия»: M — ИТОГО, N — ФБ, O — КБ, P — МБ. */
  calcEconomyTotal: 12,
  calcEconomyFB: 13,
  calcEconomyKB: 14,
  calcEconomyMB: 15,
  /** «Остаток к заключ.» (строка 2): L/M/N — ФБ/КБ/МБ, O — ИТОГО. */
  remainderFB: 11,
  remainderKB: 12,
  remainderMB: 13,
  remainderTotal: 14,
} as const;

/** Деньги в трёхсрезе с адресом строки — для провенанса до ячейки. */
export interface SvodMoneyRow {
  fb: number;
  kb: number;
  mb: number;
  total: number;
  /** Строка листа (1-based), откуда прочитано. */
  row: number;
}

/** Итоги и доли одного скоупа (район или ГРБС) — ярус ниже блоков. */
export interface SvodScopeSummary {
  scope: string;
  /** «ИТОГО 2025+2026:» — оба года, КП и ЕП вместе. */
  totalBothYears?: SvodGridTotal & { row: number };
  /** «ИТОГО 2026:» — текущий план-год, КП и ЕП вместе. */
  totalY2026?: SvodGridTotal & { row: number };
  /** Доля конкурентных: за два года и за 2026 (доли 0..1). */
  shareCompetitive?: { bothYears: number; y2026: number; row: number };
  /** Доля единственного поставщика — там же. */
  shareEp?: { bothYears: number; y2026: number; row: number };
  /** «Расч. экономия» — та, что печатается в ручном отчёте по остатку. */
  calcEconomy?: SvodMoneyRow;
}

/** Ярус листа поверх блоков: остаток к заключению и сводки по скоупам. */
export interface SvodSheetExtras {
  /** «Остаток к заключ.» из шапки листа (строка 2). */
  remainderToConclude?: SvodMoneyRow;
  /** Сводки по каждому скоупу в порядке появления на листе. */
  scopes: SvodScopeSummary[];
}

/**
 * Прочитать итоговый ярус листа. Отдельная функция, а не расширение
 * parseSvodGrid: у блоков и у этого яруса разная геометрия (ярус живёт
 * МЕЖДУ блоками и после них), и смешивать их разбор — плодить ветвления
 * в цикле, который и так самый хрупкий в файле.
 */
export function parseSvodExtras(values: unknown[][]): SvodSheetExtras {
  const scopes = knownScopes();
  const out: SvodSheetExtras = { scopes: [] };

  // Строка 2: «Остаток к заключ.» — подпись в K, числа правее.
  for (let i = 0; i < Math.min(6, values.length); i++) {
    const row = values[i] ?? [];
    const label = String(row[SVOD_GRID_COLS.planTotal] ?? '').trim().toLowerCase();
    if (label.startsWith('остаток')) {
      out.remainderToConclude = {
        fb: num(row[EXTRA_COLS.remainderFB]),
        kb: num(row[EXTRA_COLS.remainderKB]),
        mb: num(row[EXTRA_COLS.remainderMB]),
        total: num(row[EXTRA_COLS.remainderTotal]),
        row: i + 1,
      };
      break;
    }
  }

  /** Скоуп, к которому относится ярус: последний встреченный выше по листу. */
  let current: SvodScopeSummary | null = null;
  const ensure = (scope: string): SvodScopeSummary => {
    if (current?.scope !== scope) {
      current = { scope };
      out.scopes.push(current);
    }
    return current;
  };
  let lastScope = '';

  for (let i = 0; i < values.length; i++) {
    const row = values[i] ?? [];
    const a = String(row[C.scope] ?? '').trim();
    if (a && scopes.has(a)) lastScope = a;

    // «ИТОГО 2025+2026:» / «ИТОГО 2026:» — заглавными, с двоеточием.
    const upper = a.toUpperCase();
    if (lastScope && upper.startsWith('ИТОГО')) {
      const s = ensure(lastScope);
      const metrics = { ...readMetrics(row), row: i + 1 };
      if (a.includes('2025+2026')) s.totalBothYears = metrics;
      else s.totalY2026 = metrics;
      continue;
    }

    // «Доля ЭА…» / «Доля ЕП:» — подпись в D, доли в G/H; у района рядом
    // в M/N/O/P стоит «Расч. экономия».
    const d = String(row[C.planCount] ?? '').trim();
    if (lastScope && d.toLowerCase().startsWith('доля')) {
      const s = ensure(lastScope);
      const share = {
        bothYears: num(row[EXTRA_COLS.shareBothYears]),
        y2026: num(row[EXTRA_COLS.shareY2026]),
        row: i + 1,
      };
      if (/ЕП/i.test(d)) s.shareEp = share;
      else s.shareCompetitive = share;

      const ecoTotal = num(row[EXTRA_COLS.calcEconomyTotal]);
      if (ecoTotal !== 0) {
        s.calcEconomy = {
          total: ecoTotal,
          fb: num(row[EXTRA_COLS.calcEconomyFB]),
          kb: num(row[EXTRA_COLS.calcEconomyKB]),
          mb: num(row[EXTRA_COLS.calcEconomyMB]),
          row: i + 1,
        };
      }
    }
  }

  return out;
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
      const metrics = { ...readMetrics(row), row: i + 1 };
      if (a.includes('2025+2026')) block.totalBothYears = metrics;
      else block.totalY2026 = metrics;
      continue;
    }

    // Любая другая непустая A-строка (ИТОГО:, доли, пустые разделители) закрывает блок.
    if (block && a && !scopes.has(a)) block = null;
  }

  return blocks;
}
