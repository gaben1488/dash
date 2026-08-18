import type { ClassifiedRow, ValidationRule, RuleCheckContext, RuleCheckResult } from './types.js';
import { DEPARTMENT_REGISTRY } from './department-registry.js';
import {
  detectCellHygiene,
  detectSubordinateNameHygiene,
  type TextHygieneFinding,
} from './text-hygiene.js';

// ============================================================
// RuleBook — правила проверки данных АЕМР
// Основаны на РЕАЛЬНОЙ логике таблиц СВОД ТД-ПМ и листов подразделений.
// Каждое правило — это конкретная проверка spreadsheet-формулы или
// BI-эвристика (помечена origin: 'bi_heuristic').
// ============================================================

// --- Helpers ---

/**
 * Канон разбора «число листа» (пробелы-разряды, запятая-десятичная).
 * Экспортирован: копии этого разбора расползлись по репо (simplify 03.08) —
 * новые места обязаны звать его, не переизобретать.
 */
export function toNumber(val: unknown): number | null {
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
// ПРАВИЛО 4: 1 кв <= Год (cross-row)
// Квартальные значения не должны превышать годовые.
// Это правило работает с allRows — проверяется отдельно.
// ============================================================
/**
 * Build Q1->Year row pairs from DEPARTMENT_ROWS for reliable cross-row comparison.
 * Each pair maps a Q1 summary row to its corresponding Year summary row.
 */
const Q1_YEAR_PAIRS: Array<{ q1Row: number; yearRow: number; label: string }> = [
  // Summary level: row 9 = КП 1 кв, row 14 = КП Year; row 21 = ЕП 1 кв, row 26 = ЕП Year
  { q1Row: 9, yearRow: 14, label: 'КП (СВОД)' },
  { q1Row: 21, yearRow: 26, label: 'ЕП (СВОД)' },
  // Per-department pairs from DEPARTMENT_REGISTRY (canonical source)
  ...DEPARTMENT_REGISTRY.flatMap(dept => [
    { q1Row: dept.svod.kpQ1, yearRow: dept.svod.kpYear, label: `КП (${dept.latinId})` },
    { q1Row: dept.svod.epQ1, yearRow: dept.svod.epYear, label: `ЕП (${dept.latinId})` },
  ]),
];

const q1LeqYear: ValidationRule = {
  id: 'q1_leq_year',
  name: '1 кв <= Год: квартал не превышает год',
  description:
    'Плановое количество (D) и плановая сумма (K) за 1 кв не должны превышать ' +
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
            `${col}${ctx.rowIndex} (1 кв ${pair.label}) = ${q1Val} превышает ` +
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

    // FP-fix 2026-06-05 (SIGNAL_VALIDATION §1): Z/AA/AB — экономия в ТЫС ₽ с float-резидуалами
    // («рваные дроби» 0.0003, «−0»). Без округления и порога значимости сигнал давал ~⅔ ложных
    // (срабатывал на 0.00025 тыс и «−0 руб»). Округляем до 10 ₽ и флажим только при |экономии| ≥ 1 тыс ₽.
    // Заодно чиним единицы: было «руб» при значении в тыс (УИО r12 «100 руб» = реально 100 тыс).
    const ecoNorm = Math.round(ecoTotal * 100) / 100; // до 0.01 тыс = 10 ₽
    const ECONOMY_FLAG_MIN_THOUSAND = 1; // порог значимости: 1 тыс ₽

    // Only flag if a MATERIAL economy exists but AD is not set
    if (Math.abs(ecoNorm) >= ECONOMY_FLAG_MIN_THOUSAND && !hasData(ad)) {
      return {
        passed: false,
        message:
          `AD${ctx.rowIndex} пуст, но экономия ${ecoNorm.toLocaleString('ru')} тыс ₽. ` +
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
// ПРАВИЛО 13: Сквозная нумерация «№ п/п» (колонка A) — канон п.98з
// (docs/superpowers/audits/2026-08-14-interview-register.md).
// Проверка УРОВНЯ ЛИСТА, не строки: дубли, пропуски и пустые номера
// собираются в ОДНУ карточку со списком адресов (каскад п.53), а не в
// россыпь замечаний по каждой строке.
// ============================================================

/**
 * Счётная строка для нумерации — строка, обязанная нести «№ п/п»:
 * классифицирована как данные (procurement / procurement_derived / service)
 * либо несёт явные признаки закупки (способ L + план K > 0) при сомнительной
 * классификации. Служебные строки (шапка, разделитель, «итого», текстовая
 * пометка) номера не носят — пустая A у них не дефект.
 */
const NUMBERED_CLASSES: ReadonlySet<string> = new Set([
  'procurement',
  'procurement_derived',
  'service',
]);

function isNumberedRow(row: ClassifiedRow): boolean {
  if (NUMBERED_CLASSES.has(row.classification)) return true;
  // Шапку validateData не проверяет вовсе: якорь на ней молча отключил бы
  // проверку всего листа — поэтому header из страховки исключён.
  if (row.classification === 'header') return false;
  return hasData(row.cells['L']) && (toNumber(row.cells['K']) ?? 0) > 0;
}

/**
 * Якорь листа — первая счётная строка. check() зовётся для каждой строки, а
 * карточка на лист нужна одна (каскад п.53), поэтому анализ выполняется только
 * на якоре. WeakMap-кэш по массиву строк листа избавляет от повторного
 * сканирования на каждой строке (лист управления — сотни строк).
 */
const numberingAnchorCache = new WeakMap<ClassifiedRow[], number | null>();

function numberingAnchor(all: ClassifiedRow[]): number | null {
  const cached = numberingAnchorCache.get(all);
  if (cached !== undefined) return cached;
  let min: number | null = null;
  for (const r of all) {
    if (isNumberedRow(r) && (min === null || r.rowIndex < min)) min = r.rowIndex;
  }
  numberingAnchorCache.set(all, min);
  return min;
}

/** Пределы перечней в карточке: диагноз, а не простыня (тон п.53). */
const NUMBERING_LIST_CAP = 20;
const NUMBERING_DUPES_CAP = 10;

const rowNumbering: ValidationRule = {
  id: 'row_numbering',
  name: 'Сквозная нумерация «№ п/п» (колонка A)',
  description:
    'Счётные строки листа несут сквозную нумерацию в колонке A: без повторов, ' +
    'пропусков и пустых номеров. Проверка уровня листа — одна карточка со ' +
    'списком адресов (канон п.98з; каскад п.53).',
  severity: 'warning',
  origin: 'bi_heuristic',
  scope: 'department',
  params: {},
  check(ctx: RuleCheckContext): RuleCheckResult {
    if (!ctx.allRows || ctx.allRows.length === 0) return { passed: true };
    const anchor = numberingAnchor(ctx.allRows);
    if (anchor === null || ctx.rowIndex !== anchor) return { passed: true };

    const counted = ctx.allRows
      .filter(isNumberedRow)
      .sort((a, b) => a.rowIndex - b.rowIndex);

    // Разбор колонки A: пустые номера, дубли (по нормализованному значению),
    // целые номера — для поиска пропусков в последовательности.
    const emptyRows: number[] = [];
    const byNo = new Map<string, number[]>();
    const ints = new Set<number>();
    for (const r of counted) {
      const raw = String(r.cells['A'] ?? '').trim();
      if (!raw) {
        emptyRows.push(r.rowIndex);
        continue;
      }
      const n = toNumber(raw);
      const intNo = n !== null && Number.isInteger(n) ? n : null;
      if (intNo !== null) ints.add(intNo);
      // «531» и 531 — один номер; нецелые/нечисловые сверяются как текст.
      const key = intNo !== null ? String(intNo) : raw;
      const at = byNo.get(key);
      if (at) at.push(r.rowIndex);
      else byNo.set(key, [r.rowIndex]);
    }

    const dupes = [...byNo.entries()].filter(([, at]) => at.length > 1);

    // Пропуски: макс−мин против количества уникальных целых №.
    let minNo = 0;
    let maxNo = 0;
    let missingCount = 0;
    const missingList: number[] = [];
    if (ints.size >= 2) {
      minNo = Math.min(...ints);
      maxNo = Math.max(...ints);
      missingCount = maxNo - minNo + 1 - ints.size;
      if (missingCount > 0) {
        // Скан ограничен и по перечню, и по числу шагов: номер-опечатка
        // (53 → 5300) раздувает диапазон, карточка не должна раздуваться с ним.
        for (
          let n = minNo + 1, scanned = 0;
          n < maxNo && missingList.length < NUMBERING_LIST_CAP && scanned < 100_000;
          n++, scanned++
        ) {
          if (!ints.has(n)) missingList.push(n);
        }
      }
    }

    if (dupes.length === 0 && missingCount === 0 && emptyRows.length === 0) {
      return { passed: true };
    }

    const parts: string[] = [];
    if (dupes.length > 0) {
      const shown = dupes
        .slice(0, NUMBERING_DUPES_CAP)
        .map(([no, at]) => `№ ${no} — строки листа ${at.join(', ')}`);
      parts.push(
        `повторяются: ${shown.join('; ')}` +
          (dupes.length > NUMBERING_DUPES_CAP
            ? `; и ещё ${dupes.length - NUMBERING_DUPES_CAP} повторяющихся №`
            : ''),
      );
    }
    if (missingCount > 0) {
      parts.push(
        `отсутствуют: № ${missingList.join(', ')}` +
          (missingCount > missingList.length ? ` и ещё ${missingCount - missingList.length}` : '') +
          ` (диапазон ${minNo}–${maxNo} вмещает ${maxNo - minNo + 1} №, в колонке ${ints.size})`,
      );
    }
    if (emptyRows.length > 0) {
      const shown = emptyRows.slice(0, NUMBERING_LIST_CAP);
      parts.push(
        `без номера счётные строки листа ${shown.join(', ')}` +
          (emptyRows.length > shown.length ? ` и ещё ${emptyRows.length - shown.length}` : ''),
      );
    }

    return {
      passed: false,
      message:
        `Нумерация «№ п/п» (колонка A) листа сбита — ${parts.join('; ')}. ` +
        `№ п/п — стабильный адрес строки: лист живёт, строки двигаются, и найти ` +
        `строку при перемещениях можно только по нему (п.98б).`,
      actual: `${dupes.length} повторов, ${missingCount} пропусков, ${emptyRows.length} пустых`,
      expected: 'сквозная нумерация без повторов, пропусков и пустых № п/п',
    };
  },
};

// ============================================================
// ПРАВИЛО 14: Гигиена текста — канон п.98д (пакет поручений 18.08) + п.95/55
// (docs/superpowers/audits/2026-08-14-interview-register.md).
// Проверка УРОВНЯ ЛИСТА, как и нумерация A: находки по колонкам C (подвед)
// и G (предмет) собираются в ОДНУ карточку «ячейка → дефект → готовое
// исправление» (каскад п.53), а не в россыпь по каждой строке.
// ============================================================

/** Пределы перечня карточки гигиены: диагноз, а не простыня (тон п.53). */
const HYGIENE_LIST_CAP = 20;

const textHygiene: ValidationRule = {
  id: 'text_hygiene',
  name: 'Гигиена текста (C — подвед, G — предмет)',
  description:
    'Технические дефекты набора в текстовых ячейках: двойные и краевые ' +
    'пробелы, пробел не с той стороны знака препинания, невидимые символы, ' +
    'латиница внутри кириллического слова, имя подведа с отступлением от ' +
    'справочника. Одна карточка на лист: адрес → дефект → готовое ' +
    'исправленное значение, скопировать и вставить (п.98д).',
  severity: 'info',
  origin: 'bi_heuristic',
  scope: 'department',
  params: {},
  check(ctx: RuleCheckContext): RuleCheckResult {
    if (!ctx.allRows || ctx.allRows.length === 0) return { passed: true };
    // Якорь и предикат счётной строки — те же, что у нумерации A: одна
    // карточка на лист рождается на первой счётной строке, служебные строки
    // («итого», разделители) чистке не подлежат.
    const anchor = numberingAnchor(ctx.allRows);
    if (anchor === null || ctx.rowIndex !== anchor) return { passed: true };

    const counted = ctx.allRows
      .filter(isNumberedRow)
      .sort((a, b) => a.rowIndex - b.rowIndex);

    // Одна запись перечня = одна ячейка: дефекты ячейки сливаются в одну
    // строку, потому что fix у них общий — готовое значение всей ячейки.
    const items: Array<{ cell: string; what: string; fix: string }> = [];
    const pushCell = (col: 'C' | 'G', rowIndex: number, findings: TextHygieneFinding[]) => {
      if (findings.length === 0) return;
      const labels = [...new Set(findings.map((f) => f.label))];
      items.push({ cell: `${col}${rowIndex}`, what: labels.join(', '), fix: findings[0].fix });
    };

    for (const r of counted) {
      // C сличается со справочником имён подведов, G — только механика:
      // предмет закупки — свободный текст, канона имён у него нет.
      pushCell('C', r.rowIndex, detectSubordinateNameHygiene(r.cells['C']));
      pushCell('G', r.rowIndex, detectCellHygiene(r.cells['G']));
    }

    if (items.length === 0) return { passed: true };

    const shown = items
      .slice(0, HYGIENE_LIST_CAP)
      .map((i) => `${i.cell} — ${i.what} → вставить: «${i.fix}»`);
    const rest = items.length > shown.length ? `; и ещё ${items.length - shown.length} ячеек` : '';

    return {
      passed: false,
      // Адрес первой находки — точка входа карточки; остальные в перечне.
      cell: items[0].cell,
      message:
        `Текст листа несёт технические дефекты набора в ${items.length} ` +
        `ячейках (C — подвед, G — предмет): ${shown.join('; ')}${rest}. ` +
        `Каждое исправление — готовое значение ячейки: скопировать и ` +
        `вставить целиком (п.98д).`,
      actual: `${items.length} ячеек с дефектами текста`,
      expected: 'текст без лишних и невидимых символов, имена подведов по справочнику',
    };
  },
};

// ============================================================
// ПРАВИЛО 12: УДАЛЕНО — dept_fact_leq_plan
// Дублировало сигнал factExceedsPlan (signals.ts, порог 10%).
// Проверка Y>K на dept sheets выполняется ТОЛЬКО через signal → Issue.
// Правило fact_leq_plan (СВОД, E>D, кол-во) остаётся — другой scope и предмет.
// ============================================================

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
  rowNumbering,              // 13 -- № п/п (A): дубли/пропуски/пустые, одна карточка на лист (п.98з)
  textHygiene,               // 14 -- гигиена текста C/G: одна карточка на лист с готовыми исправлениями (п.98д)
  // deptFactLeqPlan УДАЛЁН (#12) — дубль сигнала factExceedsPlan
  // formulaContinuity УДАЛЁН (#13) — дублирует budget_sum_plan (#1a) + dept_fact_sum (#10)
];

/** Получить все правила (все активны по умолчанию) */
export function getActiveRules(): ValidationRule[] {
  return RULE_BOOK;
}
