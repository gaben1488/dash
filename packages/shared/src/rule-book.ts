import type { ValidationRule, RuleCheckContext, RuleCheckResult, RuleScope } from './types.js';
import { DEPARTMENT_ROWS } from './report-map.js';

// ============================================================
// RuleBook — правила проверки данных АЕМР
// Основаны на РЕАЛЬНОЙ логике таблиц СВОД ТД-ПМ и листов подразделений.
// Каждое правило — это конкретная проверка spreadsheet-формулы или
// BI-эвристика (помечена origin: 'bi_heuristic').
// ============================================================

// --- Helpers ---

function toNumber(val: unknown): number | null {
  if (val === null || val === undefined || val === '') return null;
  if (typeof val === 'number' && !isNaN(val)) return val;
  if (typeof val === 'string') {
    const cleaned = val.replace(/\s/g, '').replace(/,/g, '.');
    const n = parseFloat(cleaned);
    if (!isNaN(n)) return n;
  }
  return null;
}

function hasData(val: unknown): boolean {
  return val !== null && val !== undefined && val !== '';
}

/**
 * Строка считается «строкой данных» (т.е. строкой закупки), если содержит
 * метод закупки (L) или тип (F) — заголовки/итоги/пустые строки таких не имеют.
 * Одни лишь числа в бюджетных столбцах НЕ достаточны — итоговые строки тоже имеют суммы.
 */
function isDataRow(cells: Record<string, unknown>): boolean {
  const method = cells['L'];
  const type = cells['F'];
  return hasData(method) || hasData(type);
}

// --- Допустимые значения ---

const VALID_METHODS = ['ЭА', 'ЕП', 'ЭК', 'ЭЗК'] as const;
const VALID_TYPES = [
  'Текущая деятельность',
  'Текущая деятельность в рамках программного мероприятия',
  'Текущая деятельность вне рамок программного мероприятия',
  'Программное мероприятие',
] as const;

// ============================================================
// ПРАВИЛО 1: Консистентность сумм бюджета
// K = H + I + J (план), O = L + M + N (факт)
// ============================================================
const budgetSumConsistencyPlan: ValidationRule = {
  id: 'budget_sum_plan',
  name: 'Консистентность плановых сумм бюджета',
  description:
    'K (итого план) должен равняться H + I + J (ФБ + КБ + МБ план). ' +
    'Допуск на округление: 1 руб. Работает на СВОД и листах подразделений.',
  severity: 'error',
  origin: 'spreadsheet_rule',
  scope: 'both',
  params: {},
  check(ctx: RuleCheckContext): RuleCheckResult {
    const TOLERANCE = 1.0;
    const total = toNumber(ctx.cells['K']);
    if (total === null) return { passed: true };

    let expectedSum = 0;
    let allPresent = true;
    for (const col of ['H', 'I', 'J']) {
      const val = toNumber(ctx.cells[col]);
      if (val === null) { allPresent = false; break; }
      expectedSum += val;
    }
    if (!allPresent) return { passed: true };

    const diff = Math.abs(total - expectedSum);
    if (diff > TOLERANCE) {
      return {
        passed: false,
        message:
          `K${ctx.rowIndex} (план) = ${total}, ожидалось ${expectedSum} ` +
          `(H + I + J). Разница: ${diff.toFixed(2)} руб.`,
        cell: `K${ctx.rowIndex}`,
        actual: total,
        expected: expectedSum,
      };
    }
    return { passed: true };
  },
};

const budgetSumConsistencyFact: ValidationRule = {
  id: 'budget_sum_fact',
  name: 'Консистентность фактических сумм бюджета (СВОД)',
  description:
    'O (итого факт) должен равняться L + M + N (ФБ + КБ + МБ факт). ' +
    'Допуск: 1 руб. Только для листа СВОД ТД-ПМ (на листах подразделений эти столбцы имеют другое назначение).',
  severity: 'error',
  origin: 'spreadsheet_rule',
  scope: 'svod',
  params: {},
  check(ctx: RuleCheckContext): RuleCheckResult {
    const TOLERANCE = 1.0;
    const total = toNumber(ctx.cells['O']);
    if (total === null) return { passed: true };

    let expectedSum = 0;
    let allPresent = true;
    for (const col of ['L', 'M', 'N']) {
      const val = toNumber(ctx.cells[col]);
      if (val === null) { allPresent = false; break; }
      expectedSum += val;
    }
    if (!allPresent) return { passed: true };

    const diff = Math.abs(total - expectedSum);
    if (diff > TOLERANCE) {
      return {
        passed: false,
        message:
          `O${ctx.rowIndex} (факт) = ${total}, ожидалось ${expectedSum} ` +
          `(L + M + N). Разница: ${diff.toFixed(2)} руб.`,
        cell: `O${ctx.rowIndex}`,
        actual: total,
        expected: expectedSum,
      };
    }
    return { passed: true };
  },
};

// ============================================================
// ПРАВИЛО 2: Расчёт процента исполнения
// G = E / D * 100 (при D > 0). Если D=0 и E=0, G=0 или пусто — не ошибка.
// ============================================================
const executionPercentage: ValidationRule = {
  id: 'execution_percentage',
  name: 'Расчёт процента исполнения (СВОД)',
  description:
    'G (% исполнения) = E / D * 100 при D > 0. ' +
    'Только для СВОД (на листах подразделений столбцы D/E/G имеют другое назначение).',
  severity: 'error',
  origin: 'spreadsheet_rule',
  scope: 'svod',
  params: {},
  check(ctx: RuleCheckContext): RuleCheckResult {
    const TOLERANCE = 0.5; // допуск 0.5%

    const d = toNumber(ctx.cells['D']); // план количество
    const e = toNumber(ctx.cells['E']); // факт количество
    const g = toNumber(ctx.cells['G']); // % исполнения

    // Нет данных для проверки
    if (d === null && e === null) return { passed: true };
    if (g === null) return { passed: true };

    // D = 0 и E = 0 → G должен быть 0 или пусто
    if (d === 0 && e === 0) {
      if (g === 0) return { passed: true };
      return {
        passed: false,
        message: `G${ctx.rowIndex} = ${g}%, но D и E равны 0 — ожидается G = 0`,
        cell: `G${ctx.rowIndex}`,
        actual: g,
        expected: 0,
      };
    }

    // D = 0 и E > 0 → деление на ноль, G должен быть 0 или пусто
    if (d === 0 && e !== null && e !== 0) {
      if (g !== 0) {
        return {
          passed: false,
          message: `G${ctx.rowIndex} = ${g}%, но D = 0 при E = ${e} — деление на ноль, ожидается G = 0 или пусто`,
          cell: `G${ctx.rowIndex}`,
          actual: g,
          expected: 0,
        };
      }
      return { passed: true };
    }

    // D > 0 → проверяем формулу
    if (d !== null && d > 0) {
      const ratio = (e ?? 0) / d;
      // G может быть в формате 0-1 (десятичная доля, Excel «%») или 0-100 (число)
      // Если G <= 1.5 и expected > 1.5, значит G в десятичном формате
      const expectedPct = ratio * 100;
      // Smart normalization: pick whichever interpretation (raw or ×100) is closer
      const diffAsIs = Math.abs(g - expectedPct);
      const diffScaled = Math.abs(g * 100 - expectedPct);
      const gNormalized = (diffScaled < diffAsIs) ? g * 100 : g;
      const diff = Math.abs(gNormalized - expectedPct);
      if (diff > TOLERANCE) {
        return {
          passed: false,
          message:
            `G${ctx.rowIndex} = ${gNormalized.toFixed(2)}%, ожидалось ${expectedPct.toFixed(2)}% ` +
            `(E/D*100 = ${e}/${d}*100)`,
          cell: `G${ctx.rowIndex}`,
          actual: gNormalized,
          expected: +expectedPct.toFixed(2),
        };
      }
    }

    return { passed: true };
  },
};

// ============================================================
// ПРАВИЛО 3: Расчёт отклонения
// F = E - D (факт - план) — конвенция СВОД таблицы
// ============================================================
const deviationCalc: ValidationRule = {
  id: 'deviation_calc',
  name: 'Расчёт отклонения количества (СВОД)',
  description:
    'F (отклонение) = E - D (факт − план количество). ' +
    'Только для СВОД (на листах подразделений F — тип закупки, D — описание).',
  severity: 'error',
  origin: 'spreadsheet_rule',
  scope: 'svod',
  params: {},
  check(ctx: RuleCheckContext): RuleCheckResult {
    const d = toNumber(ctx.cells['D']); // план
    const e = toNumber(ctx.cells['E']); // факт
    const f = toNumber(ctx.cells['F']); // отклонение

    if (d === null || e === null || f === null) return { passed: true };

    // Spreadsheet convention: F = E - D (факт минус план)
    const expected = e - d;

    if (Math.abs(f - expected) > 0.01) {
      return {
        passed: false,
        message:
          `F${ctx.rowIndex} = ${f}, ожидалось ${expected} (E-D). ` +
          `D=${d}, E=${e}`,
        cell: `F${ctx.rowIndex}`,
        actual: f,
        expected,
      };
    }

    return { passed: true };
  },
};

// ============================================================
// ПРАВИЛО 4: Q1 <= Год (cross-row)
// Квартальные значения не должны превышать годовые.
// Это правило работает с allRows — проверяется отдельно.
// ============================================================
/**
 * Build Q1->Year row pairs from DEPARTMENT_ROWS for reliable cross-row comparison.
 * Each pair maps a Q1 summary row to its corresponding Year summary row.
 */
const Q1_YEAR_PAIRS: Array<{ q1Row: number; yearRow: number; label: string }> = [
  // Summary level: row 9 = КП Q1, row 14 = КП Year; row 21 = ЕП Q1, row 26 = ЕП Year
  { q1Row: 9, yearRow: 14, label: 'КП (СВОД)' },
  { q1Row: 21, yearRow: 26, label: 'ЕП (СВОД)' },
  // Per-department pairs from DEPARTMENT_ROWS
  ...Object.values(DEPARTMENT_ROWS).flatMap(cfg => [
    { q1Row: cfg.kpQ1, yearRow: cfg.kpYear, label: `КП (${cfg.id})` },
    { q1Row: cfg.epQ1, yearRow: cfg.epYear, label: `ЕП (${cfg.id})` },
  ]),
];

const q1LeqYear: ValidationRule = {
  id: 'q1_leq_year',
  name: 'Q1 <= Год: квартал не превышает год',
  description:
    'Плановое количество (D) и плановая сумма (K) за Q1 не должны превышать ' +
    'соответствующие годовые значения. Проверяется по известным парам строк из DEPARTMENT_ROWS.',
  severity: 'error',
  origin: 'spreadsheet_rule',
  scope: 'svod',
  params: {},
  check(ctx: RuleCheckContext): RuleCheckResult {
    if (!ctx.allRows || ctx.allRows.length === 0) return { passed: true };

    // Only fire on known Q1 rows
    const pair = Q1_YEAR_PAIRS.find(p => p.q1Row === ctx.rowIndex);
    if (!pair) return { passed: true };

    const yearRow = ctx.allRows.find(r => r.rowIndex === pair.yearRow);
    if (!yearRow) return { passed: true };

    const columnsToCheck = ['D', 'K'];
    for (const col of columnsToCheck) {
      const q1Val = toNumber(ctx.cells[col]);
      const yearVal = toNumber(yearRow.cells[col]);
      if (q1Val === null || yearVal === null) continue;

      if (q1Val > yearVal) {
        return {
          passed: false,
          message:
            `${col}${ctx.rowIndex} (Q1 ${pair.label}) = ${q1Val} превышает ` +
            `${col}${pair.yearRow} (Год) = ${yearVal}`,
          cell: `${col}${ctx.rowIndex}`,
          actual: q1Val,
          expected: yearVal,
        };
      }
    }

    return { passed: true };
  },
};

// ============================================================
// ПРАВИЛО 5: Факт <= План (количество)
// E <= D — BI-эвристика, т.к. превышение может быть легитимным
// (не является формулой таблицы, а бизнес-ожиданием)
// ============================================================
const factLeqPlan: ValidationRule = {
  id: 'fact_leq_plan',
  name: 'Факт <= План количество (СВОД)',
  description:
    'E (факт кол-во) <= D (план кол-во). ' +
    'Только для СВОД (на листах подразделений D — описание, E — другое поле).',
  severity: 'warning',
  origin: 'bi_heuristic',
  scope: 'svod',
  params: {},
  check(ctx: RuleCheckContext): RuleCheckResult {
    const d = toNumber(ctx.cells['D']); // план
    const e = toNumber(ctx.cells['E']); // факт

    if (d === null || e === null) return { passed: true };
    if (d === 0) return { passed: true }; // нечего сравнивать

    if (e > d) {
      return {
        passed: false,
        message:
          `E${ctx.rowIndex} (факт=${e}) превышает D${ctx.rowIndex} (план=${d}). ` +
          `Возможно, это дополнительные закупки.`,
        cell: `E${ctx.rowIndex}`,
        actual: e,
        expected: d,
      };
    }

    return { passed: true };
  },
};

// ============================================================
// ПРАВИЛО 6: Валидация метода закупки (листы подразделений)
// Столбец L: допустимые значения ЭА, ЕП, ЭК, ЭЗК
// ============================================================
const methodValidation: ValidationRule = {
  id: 'method_validation',
  name: 'Валидация метода закупки',
  description:
    'Столбец L (метод закупки) на листах подразделений должен содержать ' +
    'одно из значений: ЭА, ЕП, ЭК, ЭЗК.',
  severity: 'error',
  origin: 'spreadsheet_rule',
  scope: 'department',
  params: {},
  check(ctx: RuleCheckContext): RuleCheckResult {
    const method = ctx.cells['L'];
    if (!hasData(method)) return { passed: true };

    const val = String(method).trim();
    if ((VALID_METHODS as readonly string[]).includes(val)) {
      return { passed: true };
    }

    return {
      passed: false,
      message:
        `L${ctx.rowIndex} = "${val}" — недопустимый метод закупки. ` +
        `Допустимые: ${VALID_METHODS.join(', ')}`,
      cell: `L${ctx.rowIndex}`,
      actual: val,
      expected: VALID_METHODS.join(' | '),
    };
  },
};

// ============================================================
// ПРАВИЛО 7: Валидация типа закупки (листы подразделений)
// Столбец F: "Текущая деятельность" или "Программное мероприятие"
// ============================================================
const typeValidation: ValidationRule = {
  id: 'type_validation',
  name: 'Валидация типа закупки',
  description:
    'Столбец F (тип закупки) на листах подразделений должен содержать ' +
    'одно из значений: "Текущая деятельность" или "Программное мероприятие".',
  severity: 'error',
  origin: 'spreadsheet_rule',
  scope: 'department',
  params: {},
  check(ctx: RuleCheckContext): RuleCheckResult {
    const type = ctx.cells['F'];
    if (!hasData(type)) return { passed: true };

    const val = String(type).trim();
    if ((VALID_TYPES as readonly string[]).includes(val)) {
      return { passed: true };
    }

    return {
      passed: false,
      message:
        `F${ctx.rowIndex} = "${val}" — недопустимый тип закупки. ` +
        `Допустимые: ${VALID_TYPES.join(', ')}`,
      cell: `F${ctx.rowIndex}`,
      actual: val,
      expected: VALID_TYPES.join(' | '),
    };
  },
};

// ============================================================
// ПРАВИЛО 8: Столбец AD (статус) — проверка только на строках данных
// Пустой AD на заголовках/пустых строках — НЕ ошибка.
// Ошибка только если строка — строка данных (есть метод, тип, деньги),
// а AD пуст.
// ============================================================
const statusOnDataRows: ValidationRule = {
  id: 'status_on_data_rows',
  name: 'Статус (AD) на строках данных',
  description:
    'Столбец AD = шлюз для расчёта экономии в СВОД (SUMIFS с AD="да"). ' +
    'Флагирует строки, где есть экономия (Z/AA/AB ≠ 0) но AD не заполнен.',
  severity: 'info',
  origin: 'bi_heuristic',
  scope: 'department',
  params: {},
  check(ctx: RuleCheckContext): RuleCheckResult {
    const ad = ctx.cells['AD'];

    // AD is a GATE for economy calculation in СВОД formulas:
    //   SUMIFS(..., AD="да") — only rows with AD="да" contribute to economy.
    // Empty AD is NORMAL for rows without savings. It is NOT an error.
    //
    // Flag ONLY when there's evidence of savings that should be captured:
    //   - fact < plan (savings exist) AND economy columns (Z/AA/AB) are non-zero
    //   - but AD is empty → potential missing economy flag
    if (!hasData(ctx.cells['L'])) return { passed: true };
    const plan = toNumber(ctx.cells['K']);
    const fact = toNumber(ctx.cells['Y']);
    if (plan === null || fact === null || fact === 0) return { passed: true };

    // Check economy columns (Z/AA/AB on dept sheets)
    const ecoFB = toNumber(ctx.cells['Z']) ?? 0;
    const ecoKB = toNumber(ctx.cells['AA']) ?? 0;
    const ecoMB = toNumber(ctx.cells['AB']) ?? 0;
    const ecoTotal = ecoFB + ecoKB + ecoMB;

    // Only flag if economy values exist but AD is not set
    if (ecoTotal !== 0 && !hasData(ad)) {
      return {
        passed: false,
        message:
          `AD${ctx.rowIndex} пуст, но экономия ${ecoTotal.toLocaleString('ru')} руб. ` +
          `Укажите "да" или "нет" для учёта экономии в СВОД.`,
        cell: `AD${ctx.rowIndex}`,
        actual: null,
        expected: '"да" или "нет"',
      };
    }

    return { passed: true };
  },
};

// ============================================================
// ПРАВИЛО 9: Проверка знака экономии
// U (экономия) >= 0. Отрицательная экономия — предупреждение.
// Это BI-эвристика: отрицательная экономия не является нарушением
// формулы таблицы, а лишь индикатором возможного перерасхода.
// ============================================================
const economySignCheck: ValidationRule = {
  id: 'economy_sign_check',
  name: 'Проверка знака экономии (СВОД)',
  description:
    'U (экономия СВОД) >= 0. ' +
    'Только для СВОД (на листах подразделений U — статус, экономия в Z/AA/AB).',
  severity: 'warning',
  origin: 'bi_heuristic',
  scope: 'svod',
  params: {},
  check(ctx: RuleCheckContext): RuleCheckResult {
    const u = toNumber(ctx.cells['U']);

    if (u === null) return { passed: true };

    if (u < 0) {
      return {
        passed: false,
        message:
          `U${ctx.rowIndex} = ${u} — отрицательная экономия. ` +
          `Возможен перерасход или ошибка.`,
        cell: `U${ctx.rowIndex}`,
        actual: u,
        expected: '>= 0',
      };
    }

    return { passed: true };
  },
};

// ============================================================
// ПРАВИЛО 10: Консистентность сумм факта (листы подразделений)
// Y = V + W + X (итого факт = ФБ факт + КБ факт + МБ факт)
// ============================================================
const deptFactSumConsistency: ValidationRule = {
  id: 'dept_fact_sum',
  name: 'Консистентность фактических сумм (подразделения)',
  description:
    'Y (итого факт) = V + W + X (ФБ + КБ + МБ факт). ' +
    'Допуск: 1 руб. Только для листов подразделений.',
  severity: 'error',
  origin: 'spreadsheet_rule',
  scope: 'department',
  params: {},
  check(ctx: RuleCheckContext): RuleCheckResult {
    const TOLERANCE = 1.0;
    const total = toNumber(ctx.cells['Y']);
    if (total === null) return { passed: true };

    let expectedSum = 0;
    let allPresent = true;
    for (const col of ['V', 'W', 'X']) {
      const val = toNumber(ctx.cells[col]);
      if (val === null) { allPresent = false; break; }
      expectedSum += val;
    }
    if (!allPresent) return { passed: true };

    const diff = Math.abs(total - expectedSum);
    if (diff > TOLERANCE) {
      return {
        passed: false,
        message:
          `Y${ctx.rowIndex} (факт итого) = ${total}, ожидалось ${expectedSum} ` +
          `(V + W + X). Разница: ${diff.toFixed(2)} руб.`,
        cell: `Y${ctx.rowIndex}`,
        actual: total,
        expected: expectedSum,
      };
    }
    return { passed: true };
  },
};

// ============================================================
// ПРАВИЛО 11: Экономия: сумма компонент = итого (листы подразделений)
// AC = Z + AA + AB (итого экономия = ФБ + КБ + МБ экономия)
// ============================================================
const deptEconomySumConsistency: ValidationRule = {
  id: 'dept_economy_sum',
  name: 'Консистентность сумм экономии (подразделения)',
  description:
    'AC (итого экономия) = Z + AA + AB (ФБ + КБ + МБ экономия). ' +
    'Допуск: 1 руб. Только для листов подразделений.',
  severity: 'error',
  origin: 'spreadsheet_rule',
  scope: 'department',
  params: {},
  check(ctx: RuleCheckContext): RuleCheckResult {
    const TOLERANCE = 1.0;
    const total = toNumber(ctx.cells['AC']);
    if (total === null) return { passed: true };

    let expectedSum = 0;
    let allPresent = true;
    for (const col of ['Z', 'AA', 'AB']) {
      const val = toNumber(ctx.cells[col]);
      if (val === null) { allPresent = false; break; }
      expectedSum += val;
    }
    if (!allPresent) return { passed: true };

    const diff = Math.abs(total - expectedSum);
    if (diff > TOLERANCE) {
      return {
        passed: false,
        message:
          `AC${ctx.rowIndex} (экономия итого) = ${total}, ожидалось ${expectedSum} ` +
          `(Z + AA + AB). Разница: ${diff.toFixed(2)} руб.`,
        cell: `AC${ctx.rowIndex}`,
        actual: total,
        expected: expectedSum,
      };
    }
    return { passed: true };
  },
};

// ============================================================
// ПРАВИЛО 12: УДАЛЕНО — dept_fact_leq_plan
// Дублировало сигнал factExceedsPlan (signals.ts, порог 10%).
// Проверка Y>K на dept sheets выполняется ТОЛЬКО через signal → Issue.
// Правило fact_leq_plan (СВОД, E>D, кол-во) остаётся — другой scope и предмет.
// ============================================================

// ============================================================
// ПРАВИЛО 13: Formula Continuity (BI heuristic)
// Обнаружение случайно удалённых формул по паттерну соседей.
// ============================================================
const formulaContinuity: ValidationRule = {
  id: 'formula_continuity',
  name: 'Целостность итоговых сумм',
  description:
    'K (план итого) = H+I+J (ФБ+КБ+МБ), Y (факт итого) = V+W+X. ' +
    'Расхождение указывает на ошибку данных в источнике.',
  severity: 'warning',
  origin: 'bi_heuristic',
  scope: 'department',
  params: {},
  check(ctx: RuleCheckContext): RuleCheckResult {
    if (!isDataRow(ctx.cells)) return { passed: true };

    // Data is imported from Google Sheets (cached values, no native formulas).
    // Instead of neighbor-based heuristics, check actual sum consistency:
    //   K (plan total) should = H + I + J (budget components)
    //   Y (fact total) should = V + W + X (fact components)
    // A mismatch indicates data integrity issue in the source.

    const h = toNumber(ctx.cells['H']) ?? 0;
    const i = toNumber(ctx.cells['I']) ?? 0;
    const j = toNumber(ctx.cells['J']) ?? 0;
    const k = toNumber(ctx.cells['K']);
    const sumHIJ = h + i + j;

    // K should equal H+I+J when components exist
    if (k !== null && sumHIJ > 0 && Math.abs(k - sumHIJ) > 0.01) {
      return {
        passed: false,
        message:
          `K${ctx.rowIndex}=${k?.toLocaleString('ru')}, но H+I+J=${sumHIJ.toLocaleString('ru')}. ` +
          `Сумма лимитов не сходится.`,
        cell: `K${ctx.rowIndex}`,
        actual: k,
        expected: sumHIJ,
      };
    }

    // K=0 but components > 0 → total missing
    if ((k === null || k === 0) && sumHIJ > 0) {
      return {
        passed: false,
        message:
          `K${ctx.rowIndex} пуст/0, но H+I+J=${sumHIJ.toLocaleString('ru')}. ` +
          `Итого (план) не заполнено.`,
        cell: `K${ctx.rowIndex}`,
        actual: k ?? 0,
        expected: sumHIJ,
      };
    }

    // Same for fact: Y vs V+W+X
    const factDateVal = ctx.cells['Q'];
    const factPlaceholders = ['х', 'x', 'не состоялась', 'не состоялось', ''];
    const hasFact = hasData(factDateVal) &&
      !factPlaceholders.includes(String(factDateVal).trim().toLowerCase());

    if (hasFact) {
      const v = toNumber(ctx.cells['V']) ?? 0;
      const w = toNumber(ctx.cells['W']) ?? 0;
      const x = toNumber(ctx.cells['X']) ?? 0;
      const y = toNumber(ctx.cells['Y']);
      const sumVWX = v + w + x;

      if (y !== null && sumVWX > 0 && Math.abs(y - sumVWX) > 0.01) {
        return {
          passed: false,
          message:
            `Y${ctx.rowIndex}=${y?.toLocaleString('ru')}, но V+W+X=${sumVWX.toLocaleString('ru')}. ` +
            `Сумма факта не сходится.`,
          cell: `Y${ctx.rowIndex}`,
          actual: y,
          expected: sumVWX,
        };
      }

      if ((y === null || y === 0) && sumVWX > 0) {
        return {
          passed: false,
          message:
            `Y${ctx.rowIndex} пуст/0, но V+W+X=${sumVWX.toLocaleString('ru')}. ` +
            `Итого (факт) не заполнено.`,
          cell: `Y${ctx.rowIndex}`,
          actual: y ?? 0,
          expected: sumVWX,
        };
      }
    }

    return { passed: true };
  },
};

// ============================================================
// Экспорт
// ============================================================

/**
 * Все правила валидации.
 *
 * Верификация против формул СВОД (2026-04-12):
 *   1a. K=H+I+J — ✅ matches СВОД Pattern F (K=SUM(H:J))
 *   1b. O=L+M+N — ✅ matches СВОД Pattern F (O=SUM(L:N))
 *   2.  G=E/D   — ✅ matches СВОД Pattern F (G=IF(D=0,"-",E/D))
 *   3.  F=E-D   — ✅ matches СВОД deviation formula (факт − план)
 *   4.  Q1≤Year — ✅ logical invariant
 *   5.  E≤D     — BI heuristic (procurement: executed ≤ planned)
 *   6.  L valid  — ✅ matches COUNTIFS criterion (L in {ЭА,ЕП,ЭК,ЭЗК})
 *   7.  F valid  — ✅ matches COUNTIFS criterion (F = X$37 switcher values)
 *   8.  AD gate  — ✅ matches SUMIFS economy gating (AD="да")
 *   9.  U≥0      — BI heuristic (negative economy = overspend indicator)
 *  10.  Y=V+W+X  — ✅ dept fact sum consistency
 *  11.  AC=Z+AA+AB — ✅ dept economy sum consistency
 *  12.  Y≤K      — BI heuristic (fact ≤ plan on dept sheets)
 *  13.  K/Y sum integrity — ✅ cross-checks component sums (overlaps with #1a/#10)
 */
export const RULE_BOOK: ValidationRule[] = [
  // -- Обе области (СВОД + подразделения) --
  budgetSumConsistencyPlan,  // 1a -- K=H+I+J (СВОД: K=SUM(H:J))

  // -- Только СВОД ТД-ПМ --
  budgetSumConsistencyFact,  // 1b -- O=L+M+N (СВОД: O=SUM(L:N))
  executionPercentage,       // 2  -- G=E/D*100 (СВОД: G=IF(D=0,"-",E/D))
  deviationCalc,             // 3  -- F=E-D (СВОД: факт − план)
  q1LeqYear,                 // 4  -- Q1<=Year (logical invariant)
  factLeqPlan,               // 5  -- E<=D (bi_heuristic: executed ≤ planned)
  economySignCheck,          // 9  -- U>=0 (bi_heuristic: negative economy)

  // -- Только листы подразделений --
  methodValidation,          // 6  -- L in {ЭА,ЕП,ЭК,ЭЗК} (COUNTIFS criterion)
  typeValidation,            // 7  -- F in {ТД,ПМ} (COUNTIFS X$37 criterion)
  statusOnDataRows,          // 8  -- AD gate: economy cols ≠ 0 → AD required
  deptFactSumConsistency,    // 10 -- Y=V+W+X (dept fact total)
  deptEconomySumConsistency, // 11 -- AC=Z+AA+AB (dept economy total)
  // deptFactLeqPlan УДАЛЁН (#12) — дубль сигнала factExceedsPlan
  formulaContinuity,         // 13 -- K/Y sum integrity (component-sum check)
];

/** Получить все правила (все активны по умолчанию) */
export function getActiveRules(): ValidationRule[] {
  return RULE_BOOK;
}
