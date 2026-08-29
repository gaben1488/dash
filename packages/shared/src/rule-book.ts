import type { ClassifiedRow, ValidationRule, RuleCheckContext, RuleCheckResult } from './types.js';
import { DEPARTMENT_REGISTRY } from './department-registry.js';
import {
  ECONOMY_FLAG_BOOK_WORDS,
  ECONOMY_FLAG_CANON,
  economyFlagVerdict,
  isEconomyFlagGarbage,
} from './economy-flag.js';
import { GRBS_BOOK_METHODS } from './dictionaries/method-families.js';
import { EP_REASON_DICT } from './dictionaries/ep-reason-clusters.js';
import { isAbsentCell } from './absence.js';
import { hasFactDate } from './fact-date.js';
import { dayNumberOf, parseSheetDate } from './parse-sheet-date.js';
import {
  detectCellHygiene,
  detectSubordinateNameHygiene,
  TEXT_HYGIENE_KIND_LABELS,
  TEXT_HYGIENE_KIND_ORDER,
  type TextHygieneFinding,
  type TextHygieneKind,
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

/**
 * Способы, законные в колонке L КНИГИ ГРБС, — единый дом словаря
 * (`dictionaries/method-families.ts`, GRBS_BOOK_METHODS). Здесь список НЕ
 * переписывается: копия словаря — это и есть тот класс дефекта, из-за
 * которого продукт признавал «ЭК»/«ЭЗК» нормой книги, где их не бывает.
 * Полный набор процедур уполномоченного органа живёт отдельно
 * (procedure-ref.ts, PROCEDURE_FAMILIES) и этому правилу не подчиняется.
 */

/**
 * Виды деятельности (колонка F) — канон книги: РОВНО ДВА значения.
 *
 * Паспорт (решение владельца §22 п.2 от 30.08.2026):
 * — Проверка ввода книги (canon.cjs, goldenValidation F) — строгий список
 *   ['Программное мероприятие','Текущая деятельность'].
 * — Замер 30.08.2026: «Текущая деятельность» — 3418 строк, «Программное
 *   мероприятие» — 541; длинных формулировок в живых данных нет.
 * — Канон п.30 (интервью 14.08.2026) СНЯЛ разбивку ТД на «в рамках» и «вне
 *   рамок»: заполненная привязка к программе у текущей деятельности — норма
 *   и подкатегории не образует. Значит четырёхзначный список был наследием
 *   упразднённого среза, а не описанием данных.
 */
const VALID_TYPES = [
  'Текущая деятельность',
  'Программное мероприятие',
] as const;

/**
 * ЛЕГАСИ вида деятельности — ТОЛЬКО для чтения старых снимков, где эти
 * формулировки уже записаны. В проверке валидности НОВЫХ данных не
 * участвуют: канон п.30 снял разбивку, и книга такое значение при вводе
 * отклоняет. Обе строки означают обычную «Текущую деятельность».
 *
 * Второй носитель того же легаси — VALID_ACTIVITY_TYPES_RAW в
 * `dictionaries/activity-types.ts`: там список пока держит все четыре
 * значения. Разводить их дальше нельзя — при следующей правке вида
 * деятельности оба места читаются вместе.
 */
export const LEGACY_TYPES = [
  'Текущая деятельность в рамках программного мероприятия',
  'Текущая деятельность вне рамок программного мероприятия',
] as const;

/**
 * ДОПУСК СВЕРКИ ИТОГОВ — 5 РУБЛЕЙ, выраженные в единицах книги.
 *
 * Паспорт (решение владельца §22 п.3 от 30.08.2026):
 * — Книги ГРБС ведутся в ТЫСЯЧАХ рублей (канон report-map.ts), поэтому
 *   5 руб. = 0,005 в единицах ячейки.
 * — Столько же требует сама книга: контрольные условные форматы сверяют
 *   `ROUND($K4-SUM($H4:$J4);2)<>0` — округление до копеек, то есть допуск
 *   порядка копеечного шума, а не тысячи рублей.
 * — Что было до. `TOLERANCE = 1.0` читалось «1 рубль» (так и обещали
 *   паспорта в check-registry), а на деле означало ОДНУ ТЫСЯЧУ рублей:
 *   расхождение до 1000 руб. проходило молча. Мина: на дампе 30.08.2026
 *   в этом зазоре 0 строк из 3959, поэтому первое же настоящее расхождение
 *   было бы пропущено без единого признака.
 */
const SUM_TOLERANCE_THOUSAND_RUB = 0.005;

/** Тот же допуск в рублях — для текста замечания читателю. */
const SUM_TOLERANCE_RUB = 5;

/**
 * Разница сумм из единиц книги (тыс. руб.) в рубли для текста замечания.
 * До 30.08.2026 разница печаталась как есть с подписью «руб.» — читатель
 * видел «0.90 руб.» там, где книга разошлась на 900 рублей.
 */
function diffToRubText(diffThousandRub: number): string {
  return (diffThousandRub * 1000).toFixed(2);
}

// ============================================================
// ПРАВИЛО 1: Консистентность сумм бюджета
// K = H + I + J (план), O = L + M + N (факт)
// ============================================================
const budgetSumConsistencyPlan: ValidationRule = {
  id: 'budget_sum_plan',
  name: 'Консистентность плановых сумм бюджета',
  description:
    'K (итого план) должен равняться H + I + J (ФБ + КБ + МБ план). ' +
    'Допуск: расхождение свыше 5 руб. Работает на СВОД и листах подразделений.',
  severity: 'error',
  origin: 'spreadsheet_rule',
  scope: 'both',
  params: {},
  check(ctx: RuleCheckContext): RuleCheckResult {
    const TOLERANCE = SUM_TOLERANCE_THOUSAND_RUB;
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
          `(H + I + J). Разница: ${diffToRubText(diff)} руб. ` +
          `(допуск ${SUM_TOLERANCE_RUB} руб.)`,
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
    'Допуск: расхождение свыше 5 руб. Только для листа СВОД ТД-ПМ (на листах подразделений эти столбцы имеют другое назначение).',
  severity: 'error',
  origin: 'spreadsheet_rule',
  scope: 'svod',
  params: {},
  check(ctx: RuleCheckContext): RuleCheckResult {
    const TOLERANCE = SUM_TOLERANCE_THOUSAND_RUB;
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
          `(L + M + N). Разница: ${diffToRubText(diff)} руб. ` +
          `(допуск ${SUM_TOLERANCE_RUB} руб.)`,
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
// ПРАВИЛО 6: Валидация способа закупки (листы подразделений)
// Столбец L: допустимые значения книги ГРБС — ЕП и ЭА.
//
// Разделение словаря по источникам (решение владельца §22 п.1, 30.08.2026):
// книга ГРБС ведёт два способа, полный набор процедур (ЭА, ЭАС, ЭК, ЭЗК,
// ЭЕП) живёт в книге мониторинга уполномоченного органа и имеет свой дом —
// PROCEDURE_FAMILIES (procedure-ref.ts). Это правило судит ТОЛЬКО строки
// книг ГРБС (scope: 'department') и словаря мониторинга не касается.
// ============================================================
const methodValidation: ValidationRule = {
  id: 'method_validation',
  name: 'Валидация способа закупки',
  description:
    'Столбец L (способ закупки) на листах подразделений должен содержать ' +
    'одно из значений: ЕП, ЭА. Электронный конкурс и запрос котировок ' +
    'ведутся в книге мониторинга уполномоченного органа, а не здесь.',
  severity: 'error',
  origin: 'spreadsheet_rule',
  scope: 'department',
  params: {},
  check(ctx: RuleCheckContext): RuleCheckResult {
    const method = ctx.cells['L'];
    if (!hasData(method)) return { passed: true };

    const val = String(method).trim();
    if ((GRBS_BOOK_METHODS as readonly string[]).includes(val)) {
      return { passed: true };
    }

    return {
      passed: false,
      message:
        `L${ctx.rowIndex} = "${val}" — недопустимый способ закупки для книги ГРБС. ` +
        `Допустимые: ${GRBS_BOOK_METHODS.join(', ')}`,
      cell: `L${ctx.rowIndex}`,
      actual: val,
      expected: GRBS_BOOK_METHODS.join(' | '),
    };
  },
};

// ============================================================
// ПРАВИЛО 7: Валидация вида деятельности (листы подразделений)
// Столбец F: «Текущая деятельность» или «Программное мероприятие».
//
// Решение владельца §22 п.2 (30.08.2026): значений ровно два. Длинные
// формулировки «в рамках/вне рамок программного мероприятия» — легаси
// снятой каноном п.30 разбивки (LEGACY_TYPES выше); в проверке валидности
// новых данных они не участвуют, книга их при вводе отклоняет.
// ============================================================
const typeValidation: ValidationRule = {
  id: 'type_validation',
  name: 'Валидация вида деятельности',
  description:
    'Столбец F (вид деятельности) на листах подразделений должен содержать ' +
    'одно из значений: «Текущая деятельность» или «Программное мероприятие».',
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

    // Легаси старых снимков названо своими словами: это не мусор оператора,
    // а упразднённая каноном п.30 подкатегория текущей деятельности.
    const legacyHint = (LEGACY_TYPES as readonly string[]).includes(val)
      ? ' Это упразднённая (канон п.30) разбивка текущей деятельности —'
        + ' значение приводится к «Текущая деятельность».'
      : '';

    return {
      passed: false,
      message:
        `F${ctx.rowIndex} = "${val}" — недопустимый вид деятельности. ` +
        `Допустимые: ${VALID_TYPES.join(', ')}.${legacyHint}`,
      cell: `F${ctx.rowIndex}`,
      actual: val,
      expected: VALID_TYPES.join(' | '),
    };
  },
};

// ============================================================
// ПРАВИЛО 8: «Экономия без отметки» — графа «Статус» (AD)
//
// Консолидация 21.08.2026 (решение владельца 20.08). Правило перестало
// считать явление по-своему и зовёт единый канон (economy-flag.ts): план и
// факт заполнены, факт меньше плана, а в графе «Статус» нет ни «да», ни
// «нет». Прежний гейт требовал вдобавок ненулевых столбцов экономии
// (Z/AA/AB) и целой тысячи рублей — из-за этого правило давало СВОЁ число,
// не сходившееся ни с сигналом строки, ни с карточкой «Экономии»: одно
// положение дел жило под тремя именами и тремя счётчиками.
//
// Столбцы Z/AA/AB здесь больше не гейт, а источник суммы для текста: пока
// отметки нет, они у большинства строк пусты (их считает формула по «да»),
// и требовать их означало не видеть само явление.
// ============================================================
const statusOnDataRows: ValidationRule = {
  id: 'status_on_data_rows',
  name: ECONOMY_FLAG_CANON.name,
  description: ECONOMY_FLAG_CANON.definition,
  severity: 'info',
  origin: 'bi_heuristic',
  scope: 'department',
  params: {},
  check(ctx: RuleCheckContext): RuleCheckResult {
    // Гейт счётной строки: без способа закупки строка не закупка (заголовок,
    // разделитель, остаток разметки) — пустая графа «Статус» там не дефект.
    if (!hasData(ctx.cells['L'])) return { passed: true };

    const method = String(ctx.cells['L'] ?? '').trim().toLowerCase();
    const verdict = economyFlagVerdict({
      planTotal: toNumber(ctx.cells['K']),
      factTotal: toNumber(ctx.cells['Y']),
      adCell: ctx.cells['AD'],
      isEp: method.includes('еп') || method.includes('единствен'),
    });
    if (!verdict.matches) return { passed: true };

    // Род называется вслух (канон: «ЕП включённо, но с пометкой рода»).
    const kindNote = verdict.kind === 'ep'
      ? ' Способ — единственный поставщик: по нему экономии быть не должно вовсе, поэтому строку'
        + ' стоит разобрать заодно с проверкой «По ЕП факт не равен плану».'
      : '';

    return {
      passed: false,
      message:
        `AD${ctx.rowIndex}: экономия по числам ${verdict.economy.toLocaleString('ru', { maximumFractionDigits: 2 })} тыс ₽ `
        + `(${verdict.sharePct.toLocaleString('ru', { maximumFractionDigits: 1 })} % плана), `
        + `а отметки о ней нет — в графе «Статус» ни «да», ни «нет». `
        + `Лист СВОД складывает экономию только по строкам с «да».${kindNote}`,
      cell: `AD${ctx.rowIndex}`,
      actual: ctx.cells['AD'] ?? null,
      expected: '«да» или «нет»',
    };
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
    'Допуск: расхождение свыше 5 руб. Только для листов подразделений.',
  severity: 'error',
  origin: 'spreadsheet_rule',
  scope: 'department',
  params: {},
  check(ctx: RuleCheckContext): RuleCheckResult {
    const TOLERANCE = SUM_TOLERANCE_THOUSAND_RUB;
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
          `(V + W + X). Разница: ${diffToRubText(diff)} руб. ` +
          `(допуск ${SUM_TOLERANCE_RUB} руб.)`,
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
    'Допуск: расхождение свыше 5 руб. Только для листов подразделений.',
  severity: 'error',
  origin: 'spreadsheet_rule',
  scope: 'department',
  params: {},
  check(ctx: RuleCheckContext): RuleCheckResult {
    const TOLERANCE = SUM_TOLERANCE_THOUSAND_RUB;
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
          `(Z + AA + AB). Разница: ${diffToRubText(diff)} руб. ` +
          `(допуск ${SUM_TOLERANCE_RUB} руб.)`,
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
    'Счётные строки листа несут сквозную нумерацию в колонке A. Нарушения — ' +
    'повторы номеров (адрес двусмыслен) и пустые A (строка без адреса). ' +
    'Пропуски номеров нарушением НЕ являются (п.118): нумерация всегда идёт ' +
    'вперёд, дыра — след удалённой строки, по дырам продукт видит пропажи. ' +
    'Проверка уровня листа — одна карточка со списком адресов (п.98з; п.53).',
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
    let minNo: number;
    let maxNo: number;
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

    // Пропуски (дыры) нарушением НЕ являются — канон п.118: нумерация всегда
    // идёт вперёд, дыра — след удалённой строки, и её сознательно не закрывают:
    // по дырам продукт ловит пропажи закупок. Карточка встаёт только на
    // настоящие нарушения адресации — повторы и пустые номера.
    if (dupes.length === 0 && emptyRows.length === 0) {
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
    if (emptyRows.length > 0) {
      const shown = emptyRows.slice(0, NUMBERING_LIST_CAP);
      parts.push(
        `без номера счётные строки листа ${shown.join(', ')}` +
          (emptyRows.length > shown.length ? ` и ещё ${emptyRows.length - shown.length}` : ''),
      );
    }
    // Дыры упоминаются справкой, чтобы читатель не принял их за недосмотр
    // карточки — но чинить их не предлагается.
    const gapNote = missingCount > 0
      ? ` Пропуски № (${missingList.slice(0, 8).join(', ')}${missingCount > 8 ? '…' : ''}, всего ${missingCount}) — не дефект: дыра остаётся после удаления строки и сознательно не закрывается (п.118).`
      : '';

    return {
      passed: false,
      message:
        `Нумерация «№ п/п» (колонка A) листа сбита — ${parts.join('; ')}. ` +
        `№ п/п — стабильный адрес строки: лист живёт, строки двигаются, и найти ` +
        `строку при перемещениях можно только по нему (п.98б). Новые номера — ` +
        `только вперёд, продолжая счёт листа.${gapNote}`,
      actual: `${dupes.length} повторов, ${emptyRows.length} пустых (пропусков ${missingCount} — информация, не дефект)`,
      expected: 'без повторов и пустых № п/п; пропуски допустимы (след удалённых строк, п.118)',
    };
  },
};

// ============================================================
// ПРАВИЛО 14: Гигиена текста — канон п.98д (пакет поручений 18.08) + п.95/55
// (docs/superpowers/audits/2026-08-14-interview-register.md).
// Проверка УРОВНЯ ЛИСТА, как и нумерация A: находки по колонкам C (подвед)
// и G (предмет) собираются в ОДНУ карточку (каскад п.53).
//
// ПОДАЧА — СВОДКА, НЕ ПРОСТЫНЯ (канон п.122, приказ владельца 20.08).
// Раньше message перечислял ВСЕ находки с готовыми исправлениями в одну
// строку — на экране это читалось сплошным абзацем. Теперь карточка несёт
// счёт по родам дефектов и отсылает к разделу «Гигиена текста» на вкладке
// «Контроль»: там каждый адрес — строкой таблицы, с контекстом, готовым
// значением и кнопкой «скопировать» (роут /api/text-hygiene).
// ============================================================

/** Русское склонение слова «ячейка» по числу находок. */
function cellsWord(n: number): string {
  const mod100 = Math.abs(n) % 100;
  if (mod100 >= 11 && mod100 <= 14) return 'ячейках';
  const mod10 = mod100 % 10;
  if (mod10 === 1) return 'ячейке';
  return 'ячейках';
}

const textHygiene: ValidationRule = {
  id: 'text_hygiene',
  name: 'Гигиена текста (C — подвед, G — предмет)',
  description:
    'Технические дефекты набора в текстовых ячейках: двойные и краевые ' +
    'пробелы, пробел не с той стороны знака препинания, невидимые символы, ' +
    'латиница внутри кириллического слова, имя подведа с отступлением от ' +
    'справочника. Одна карточка на лист — сводка по родам дефектов; полный ' +
    'перечень с готовыми значениями — вкладка «Контроль», раздел «Гигиена ' +
    'текста» (п.98д, п.122).',
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

    // Ячейки с дефектами и счёт по родам. Адрес первой дефектной ячейки
    // остаётся точкой входа карточки; сами перечни живут на Контроле.
    let firstCell: string | null = null;
    let cellCount = 0;
    const byKind = new Map<TextHygieneKind, number>();
    const takeCell = (col: 'C' | 'G', rowIndex: number, findings: TextHygieneFinding[]) => {
      if (findings.length === 0) return;
      cellCount += 1;
      if (firstCell === null) firstCell = `${col}${rowIndex}`;
      // Род считается по ячейкам: две латинские буквы в одном слове — одна
      // ячейка «латиницы в кириллице», а не две находки в счётчике.
      for (const kind of new Set(findings.map((f) => f.kind))) {
        byKind.set(kind, (byKind.get(kind) ?? 0) + 1);
      }
    };

    for (const r of counted) {
      // C сличается со справочником имён подведов, G — только механика:
      // предмет закупки — свободный текст, канона имён у него нет.
      takeCell('C', r.rowIndex, detectSubordinateNameHygiene(r.cells['C']));
      takeCell('G', r.rowIndex, detectCellHygiene(r.cells['G']));
    }

    if (cellCount === 0 || firstCell === null) return { passed: true };

    const parts = TEXT_HYGIENE_KIND_ORDER
      .filter((kind) => byKind.has(kind))
      .map((kind) => `${TEXT_HYGIENE_KIND_LABELS[kind]} — ${byKind.get(kind)}`);

    return {
      passed: false,
      cell: firstCell,
      message:
        `Текст листа несёт дефекты набора в ${cellCount} ${cellsWord(cellCount)} ` +
        `(C — подвед, G — предмет): ${parts.join(', ')}. ` +
        `Полный перечень с готовыми исправлениями — на вкладке «Контроль», ` +
        `в разделе «Гигиена текста»: каждое значение копируется и вставляется ` +
        `целиком (п.98д, п.122).`,
      actual: `${cellCount} ${cellsWord(cellCount)} с дефектами текста`,
      expected: 'текст без лишних и невидимых символов, имена подведов по справочнику',
    };
  },
};

// ============================================================
// ОБМОТКА НАД КНИГОЙ (30.08.2026) — правила самой книги, которых у продукта
// не было. Решение владельца §22: «слепоту продукта стоит решать и убирать
// полностью».
//
// ОТКУДА ВЗЯЛИСЬ. Матрица сверки
// `docs/superpowers/audits/2026-08-30-pravila-matrica.md` положила рядом канон
// таблиц (`scripts/etalon-sync/canon.cjs`: 21 контрольный условный формат,
// проверка ввода, эталонные формулы) и канон продукта — и насчитала девять
// мест, где книга красит ячейку красным, а продукт молчит. Причина слепоты
// одна на все девять: продукт читает книгу ЗНАЧЕНИЯМИ и никогда не читал ни
// условных форматов, ни проверки ввода — то есть половина правил, по которым
// живёт оператор, у него просто не существовала.
//
// ПОЧЕМУ ЗДЕСЬ, А НЕ В ПРИЗНАКАХ СТРОКИ. Предмет каждого правила ниже — ЯЧЕЙКА
// и её заполнение («здесь не дата», «здесь не число», «здесь не слово из
// словаря»), а не аналитический вывод о ходе закупки. Это ровно тот род,
// который RULE_BOOK и держит: validate.ts рождает по нему замечание с адресом
// ячейки, а паспорт (CHECK_REGISTRY, тот же id) объясняет класс читателю.
// Признаки строки (@aemr/core signals.ts) остаются про смысл закупки.
//
// ГЕЙТ ВСЕХ ПРАВИЛ — «в графе A стоит номер закупки»: ровно так гейтит себя и
// сама книга (`=AND($A4<>""; …)` в каждом контрольном условном формате).
// Пустой хвост листа и служебная разметка номера не носят, и правила их не
// трогают — этот же урок отдельно оплачен приёмкой 30.08.2026, где ручной
// инструмент счёл дырами 58 пустых строк хвоста УО.
// ============================================================

/**
 * Счётная строка КНИГИ: в графе A стоит номер закупки.
 * Тот же предикат, которым гейтит себя каждый контрольный условный формат.
 */
function hasRowNumber(cells: Record<string, unknown>): boolean {
  return String(cells['A'] ?? '').trim() !== '';
}

/**
 * Номер суток из ячейки-даты — тем же рецептом, что у движка признаков
 * (@aemr/core signals.ts, toDayNumber): сперва TZ-инвариантный `dayNumberOf`,
 * затем `parseSheetDate` для экзотических записей, которые понимает только
 * `new Date`. Рецепт повторён СОЗНАТЕЛЬНО и обязан оставаться тем же: если
 * правило листа начнёт считать датой не то, что считает движок, вернётся класс
 * «два канона одного понятия» — ровно он и чинился 30.08.2026 по пустоте даты
 * факта. Обе половины рецепта живут в @aemr/shared, своего разбора здесь нет.
 */
function dayOfDateCell(value: unknown): number | null {
  const day = dayNumberOf(value);
  if (day !== null) return day;
  const parsed = parseSheetDate(value);
  return parsed ? dayNumberOf(parsed) : null;
}

/**
 * ОПОЗДАНИЕ ПО СТРУКТУРЕ — число суток между плановой датой (N) и датой
 * заключения (Q), когда факт позже плана; иначе null.
 *
 * Считается по РУКОПИСНЫМ графам N и Q, а не по производной графе T (канон
 * п.93/45: первичны N и Q, T — формула от них). Перебитая T поэтому расчёт не
 * искажает — и это не теория: матрица правил называет целостность T отдельной
 * слепотой продукта, а формульный дамп 30.08.2026 нашёл живую перебитую T в
 * книге УО (строка 2645, вбито 46255).
 *
 * Один расчёт на два правила — «исполнено с опозданием» и «просрочка без
 * причины»: иначе одно и то же опоздание считалось бы двумя способами.
 */
function daysLateOfRow(cells: Record<string, unknown>): number | null {
  const planDay = dayOfDateCell(cells['N']);
  const factDay = dayOfDateCell(cells['Q']);
  if (planDay === null || factDay === null) return null;
  const diff = factDay - planDay;
  return diff > 0 ? diff : null;
}

/** Русское склонение слова «день» по числу суток. */
function daysWord(n: number): string {
  const mod100 = Math.abs(n) % 100;
  if (mod100 >= 11 && mod100 <= 14) return 'дней';
  switch (mod100 % 10) {
    case 1: return 'день';
    case 2:
    case 3:
    case 4: return 'дня';
    default: return 'дней';
  }
}

// ============================================================
// ПРАВИЛО 15: Плановая дата не читается как дата (условный формат книги №6)
// ============================================================
const planDateGarbage: ValidationRule = {
  id: 'plan_date_garbage',
  name: 'Плановая дата не читается как дата',
  description:
    'Графа N (плановая дата) заполнена, но её значение не дата и не маркер ' +
    'отсутствия «Х». Такая строка молча остаётся «без даты»: сроков у неё нет, ' +
    'а признака дефекта — тоже.',
  severity: 'error',
  origin: 'spreadsheet_rule',
  scope: 'department',
  params: {},
  check(ctx: RuleCheckContext): RuleCheckResult {
    if (!hasRowNumber(ctx.cells)) return { passed: true };
    const raw = ctx.cells['N'];
    // Пустая графа и маркер отсутствия — законные состояния, у них свои классы
    // («не обеспечена финансированием»). Канон маркера — @aemr/shared
    // absence.ts (п.62): «Х»/«X»/прочерк, ровно то, что пропускает и проверка
    // ввода книги (`REGEXMATCH(...;"^[ХX]$")`).
    if (isAbsentCell(raw)) return { passed: true };
    if (dayOfDateCell(raw) !== null) return { passed: true };

    const shown = String(raw).trim();
    return {
      passed: false,
      message:
        `N${ctx.rowIndex} = "${shown}" — не дата и не маркер отсутствия «Х». ` +
        `Плановой даты у строки нет, а вместе с ней нет ни квартала, ни года ` +
        `плана: строка выпадает из срезов и из контроля сроков, оставаясь на ` +
        `вид заполненной.`,
      cell: `N${ctx.rowIndex}`,
      actual: shown,
      expected: 'дата (дд.мм.гггг) либо маркер отсутствия «Х»',
    };
  },
};

// ============================================================
// ПРАВИЛО 16: Число не читается числом (условные форматы книги №7, 8, 9)
// H:J план, V:X факт, Z:AB остаток
// ============================================================

/** Денежные графы книги, обязанные нести число: план, факт, остаток. */
const NUMERIC_BOOK_COLUMNS: ReadonlyArray<{ col: string; what: string }> = [
  { col: 'H', what: 'план, федеральный бюджет' },
  { col: 'I', what: 'план, краевой бюджет' },
  { col: 'J', what: 'план, муниципальный бюджет' },
  { col: 'V', what: 'факт, федеральный бюджет' },
  { col: 'W', what: 'факт, краевой бюджет' },
  { col: 'X', what: 'факт, муниципальный бюджет' },
  { col: 'Z', what: 'остаток, федеральный бюджет' },
  { col: 'AA', what: 'остаток, краевой бюджет' },
  { col: 'AB', what: 'остаток, муниципальный бюджет' },
];

const numericCellUnreadable: ValidationRule = {
  id: 'numeric_cell_unreadable',
  name: 'Денежная графа заполнена не числом',
  description:
    'В графах сумм (H:J план, V:X факт, Z:AB остаток) стоит значение, которое ' +
    'числом не читается. Сверки итогов такую графу молча пропускают, и строка ' +
    'выпадает из сумм.',
  severity: 'error',
  origin: 'spreadsheet_rule',
  scope: 'department',
  params: {},
  check(ctx: RuleCheckContext): RuleCheckResult {
    if (!hasRowNumber(ctx.cells)) return { passed: true };

    const bad: Array<{ col: string; what: string; shown: string }> = [];
    for (const { col, what } of NUMERIC_BOOK_COLUMNS) {
      const raw = ctx.cells[col];
      if (!hasData(raw)) continue;
      if (toNumber(raw) !== null) continue;
      bad.push({ col, what, shown: String(raw).trim() });
    }
    if (bad.length === 0) return { passed: true };

    const list = bad.map(b => `${b.col}${ctx.rowIndex} = "${b.shown}" (${b.what})`).join('; ');
    return {
      passed: false,
      message:
        `Денежные графы строки заполнены не числом: ${list}. ` +
        `Сверки итогов (K = H+I+J, Y = V+W+X, AC = Z+AA+AB) при нечитаемом ` +
        `слагаемом молчат — расхождение не всплывёт нигде, а сумма строки ` +
        `посчитается без этой графы.`,
      cell: `${bad[0].col}${ctx.rowIndex}`,
      actual: bad.map(b => `${b.col}="${b.shown}"`).join(', '),
      expected: 'число (сумма в тыс. руб.) либо пустая ячейка',
    };
  },
};

// ============================================================
// ПРАВИЛО 17: Мусор в графе «Статус» (условный формат книги №13)
// ============================================================
const economyFlagGarbage: ValidationRule = {
  id: 'economy_flag_garbage',
  name: 'Графа «Статус» заполнена не по словарю',
  description:
    'В графе «Статус» (AD) стоит значение, которого словарь книги не знает: ' +
    'принимаются только «да» и «нет». Лист СВОД складывает экономию строго по ' +
    '«да», поэтому любое иное слово для расчёта равно пустоте.',
  severity: 'warning',
  origin: 'spreadsheet_rule',
  scope: 'department',
  params: {},
  check(ctx: RuleCheckContext): RuleCheckResult {
    if (!hasRowNumber(ctx.cells)) return { passed: true };
    if (!isEconomyFlagGarbage(ctx.cells['AD'])) return { passed: true };

    const shown = String(ctx.cells['AD']).trim();
    return {
      passed: false,
      message:
        `AD${ctx.rowIndex} = "${shown}" — словарь графы «Статус» знает только ` +
        `«${ECONOMY_FLAG_BOOK_WORDS.join('» и «')}». Для расчёта такое значение ` +
        `равно пустой ячейке: лист СВОД суммирует экономию по строкам с «да», ` +
        `и строка в него не войдёт.`,
      cell: `AD${ctx.rowIndex}`,
      actual: shown,
      expected: ECONOMY_FLAG_BOOK_WORDS.join(' | '),
    };
  },
};

// ============================================================
// ПРАВИЛО 18: Просрочка без причины (условные форматы книги №16, №17)
// «Срок нарушен» в T либо дни просрочки > 0, а графа U пуста.
// ============================================================
const overdueReasonMissing: ValidationRule = {
  id: 'overdue_reason_missing',
  name: 'Срок нарушен, а причина (U) не заполнена',
  description:
    'Срок по строке нарушен — либо графа T говорит «Срок нарушен», либо дни ' +
    'просрочки больше нуля, — а графа U (причина отклонения) пуста.',
  severity: 'warning',
  origin: 'spreadsheet_rule',
  scope: 'department',
  params: {},
  check(ctx: RuleCheckContext): RuleCheckResult {
    if (!hasRowNumber(ctx.cells)) return { passed: true };

    // Опоздание видно двумя путями. Структурный (даты N и Q) — основной, он не
    // зависит от целостности формулы T. Графа T нужна для строк БЕЗ факта:
    // там «нарушен ли срок» решают часы («сегодня» против плановой даты), а у
    // правила листа часов нет — их держит формула книги, сравнивающая план с
    // датой среза из настроек.
    const late = daysLateOfRow(ctx.cells);
    const verdictT = String(ctx.cells['T'] ?? '').trim().toLowerCase();
    const daysT = toNumber(ctx.cells['T']);
    const overdueByBook = verdictT.includes('срок нарушен') || (daysT !== null && daysT > 0);
    if (late === null && !overdueByBook) return { passed: true };

    // ПУСТОТА — СТРУКТУРНАЯ, СОДЕРЖИМОЕ НЕ ЧИТАЕТСЯ. Канон п.27 запрещает
    // машинно толковать свободный текст исполнителя (U «Причина отклонения»),
    // но не запрещает видеть, что графы нет вовсе: ровно так же продукт
    // проверяет заполненность обоснования ЕП (M). Маркер отсутствия «Х»
    // считается незаполненностью — канон п.62.
    if (!isAbsentCell(ctx.cells['U'])) return { passed: true };

    const howLate = late !== null
      ? `Заключение позже плановой даты на ${late} ${daysWord(late)}.`
      : 'Плановая дата прошла, факта нет.';
    return {
      passed: false,
      message:
        `U${ctx.rowIndex} пуста, а срок по строке нарушен. ${howLate} ` +
        `Причина отклонения — единственное место, где объясняется срыв: без ` +
        `неё строка приходит в отчёт руководству голой просрочкой. Содержимое ` +
        `графы продукт не толкует (канон п.27) — проверяется только сам факт ` +
        `пустоты.`,
      cell: `U${ctx.rowIndex}`,
      actual: null,
      expected: 'причина отклонения от планового срока',
    };
  },
};

// ============================================================
// ПРАВИЛО 19: Исполнено с опозданием (визуальный слой книги — дни в T > 0)
// ============================================================
const lateSigned: ValidationRule = {
  id: 'late_signed',
  name: 'Исполнено с опозданием',
  description:
    'Договор заключён (дата в Q) позже плановой даты (N). Строка закрыта, но ' +
    'срок сорван — признак просрочки у неё гаснет вместе с появлением факта.',
  severity: 'warning',
  origin: 'bi_heuristic',
  scope: 'department',
  params: {},
  check(ctx: RuleCheckContext): RuleCheckResult {
    if (!hasRowNumber(ctx.cells)) return { passed: true };
    const late = daysLateOfRow(ctx.cells);
    if (late === null) return { passed: true };

    return {
      passed: false,
      message:
        `Заключение (Q${ctx.rowIndex}) позже плановой даты (N${ctx.rowIndex}) ` +
        `на ${late} ${daysWord(late)}. Это не упрёк, а факт исполнения: строка ` +
        `состоялась, и признак просрочки по ней погас — до этой проверки ` +
        `закрытая с нарушением срока закупка выглядела чистой.`,
      cell: `Q${ctx.rowIndex}`,
      actual: `+${late} ${daysWord(late)}`,
      expected: 'заключение не позже плановой даты (N)',
    };
  },
};

// ============================================================
// ПРАВИЛО 20: Вне периметра 44-ФЗ (условные форматы книги №20, №21)
// ============================================================

/**
 * Названа ли в тексте ячейки закупка по другому закону.
 *
 * ЕДИНСТВЕННЫЙ ДОМ ВЫРАЖЕНИЙ — запись `EP_LAW_223` словаря причин ЕП: и это
 * правило, и жетон Реестра (@aemr/web lib/rows/outside-44fz.ts) берут образцы
 * оттуда. Второй набор выражений завёл бы второй канон, и «223» на двух
 * поверхностях считался бы по-разному — ровно тот класс дефекта, который эта
 * волна и убирает.
 *
 * Почему выражения напрямую, а не `canonicalizeReasonEp`: канонизация
 * возвращает ПЕРВЫЙ совпавший кластер из пятнадцати по фиксированному порядку,
 * и причина «аукцион не состоялся, закупаем по положению о закупках» ушла бы в
 * кластер несостоявшегося аукциона — метка периметра пропала бы. Вопрос здесь
 * другой: относится ли строка к другому закону ВООБЩЕ, и ответ не должен
 * зависеть от того, чем ещё объяснена строка.
 */
function mentionsLaw223(raw: unknown): boolean {
  if (typeof raw !== 'string') return false;
  const cleaned = raw.trim();
  if (cleaned === '') return false;
  const normalized = cleaned.toLowerCase().replace(/\s+/g, ' ');
  return EP_REASON_DICT.EP_LAW_223.regex.some(re => re.test(normalized));
}

const outOf44fzPerimeter: ValidationRule = {
  id: 'out_of_44fz_perimeter',
  name: 'Закупка вне периметра 44-ФЗ (223-ФЗ)',
  description:
    'Строка живёт в книге 44-ФЗ, а закупка идёт по 223-ФЗ: либо в графе ' +
    'обоснования (M) назван другой закон, либо он назван в примечании ГРБС ' +
    '(AF) при способе не ЕП. Образцы — из словаря причин ЕП, запись «Закупка ' +
    'по 223-ФЗ». Гейт «не ЕП» стоит только на примечании и повторяет условный ' +
    'формат книги: у единственного поставщика 223-ФЗ в примечании — норма, а не ' +
    'нарушение. Жетон строки в Реестре шире (он о принадлежности, а не о ' +
    'нарушении) и такую строку всё равно метит — расхождение намеренное.',
  severity: 'info',
  origin: 'bi_heuristic',
  scope: 'department',
  params: {},
  check(ctx: RuleCheckContext): RuleCheckResult {
    if (!hasRowNumber(ctx.cells)) return { passed: true };

    // Графа M — обязательное правовое поле (основание выбора ЕП), а не
    // комментарий: её продукт разбирает словарём кластеров с самого начала.
    const byReason = mentionsLaw223(ctx.cells['M']);

    // Графа AF — свободный текст, и канон п.27 запрещает ТОЛКОВАТЬ его. Здесь
    // толкования нет: ищется названная ссылка на другой закон, как ищет её и
    // сама книга. Тот же узкий приём уже применён к маркеру инициативной
    // заявки. Гейт «способ не ЕП» — из условного формата книги: у ЕП ссылка на
    // 223-ФЗ обычно часть правового основания, а не признак чужого периметра.
    const method = String(ctx.cells['L'] ?? '').trim().toLowerCase();
    const isEp = method.includes('еп') || method.includes('единствен');
    const byComment = !isEp && mentionsLaw223(ctx.cells['AF']);

    if (!byReason && !byComment) return { passed: true };

    const where = byReason
      ? `в графе обоснования (M) назван 223-ФЗ либо положение о закупках`
      : `в примечании ГРБС (AF) назван 223-ФЗ, а способ закупки — не ЕП`;
    return {
      passed: false,
      message:
        `Строка помечена как закупка вне периметра 44-ФЗ: ${where}. ` +
        `Это не дефект книги, а род строки: закупка по 223-ФЗ живёт по другому ` +
        `закону, и её план с фактом попадают в счёты исполнения 44-ФЗ наравне ` +
        `с остальными. Исключением таких строк из счётов управляет отдельный ` +
        `переключатель «показать вместе» (решение владельца §22 п.5); пока он ` +
        `не введён, признак только называет строки, чтобы их можно было ` +
        `показать целиком.`,
      cell: byReason ? `M${ctx.rowIndex}` : `AF${ctx.rowIndex}`,
      actual: String((byReason ? ctx.cells['M'] : ctx.cells['AF']) ?? '').trim(),
      expected: 'закупка в периметре 44-ФЗ либо явная пометка иного периметра',
    };
  },
};

// ============================================================
// ПРАВИЛО 21: Экономия по компонентам (эталон формул книги)
// Z = H − V, AA = I − W, AB = J − X; при отсутствии даты факта — ноль.
// ============================================================

/** Тройка «остаток ← план − факт» по уровням бюджета. */
const ECONOMY_COMPONENT_TRIPLES: ReadonlyArray<{
  rest: string; plan: string; fact: string; what: string;
}> = [
  { rest: 'Z', plan: 'H', fact: 'V', what: 'федеральный бюджет' },
  { rest: 'AA', plan: 'I', fact: 'W', what: 'краевой бюджет' },
  { rest: 'AB', plan: 'J', fact: 'X', what: 'муниципальный бюджет' },
];

const economyComponents: ValidationRule = {
  id: 'economy_components',
  name: 'Экономия по компонентам не равна «план − факт»',
  description:
    'Остаток по каждому уровню бюджета обязан равняться разности плана и ' +
    'факта: Z = H − V, AA = I − W, AB = J − X; пока даты заключения нет, все ' +
    'три равны нулю. Допуск — 5 руб., как у прочих сверок книги.',
  severity: 'error',
  origin: 'spreadsheet_rule',
  scope: 'department',
  params: {},
  check(ctx: RuleCheckContext): RuleCheckResult {
    if (!hasRowNumber(ctx.cells)) return { passed: true };
    const TOLERANCE = SUM_TOLERANCE_THOUSAND_RUB;

    // Пустота даты факта — ЕДИНЫЙ ДОМ канона (@aemr/shared fact-date.ts): в
    // книге заглушкой обычно стоит «Х», но канон знает все девять её написаний,
    // и сверять их здесь заново значило бы завести второй дом одного понятия.
    const factSigned = hasFactDate(ctx.cells['Q']);

    const bad: string[] = [];
    for (const { rest, plan, fact, what } of ECONOMY_COMPONENT_TRIPLES) {
      const restVal = toNumber(ctx.cells[rest]);
      if (restVal === null) continue;

      let expected: number;
      if (!factSigned) {
        // Договора нет — тратить было нечего, остаток равен нулю. Это не наша
        // выдумка, а эталонная формула самой книги.
        expected = 0;
      } else {
        const planVal = toNumber(ctx.cells[plan]);
        const factVal = toNumber(ctx.cells[fact]);
        // Нечитаемое слагаемое — предмет соседнего правила
        // (numeric_cell_unreadable), здесь молчим, чтобы не судить дважды.
        if (planVal === null || factVal === null) continue;
        expected = planVal - factVal;
      }

      const diff = Math.abs(restVal - expected);
      if (diff <= TOLERANCE) continue;
      bad.push(
        `${rest}${ctx.rowIndex} (${what}) = ${restVal}, ожидалось ${expected}` +
        (factSigned ? ` (${plan} − ${fact})` : ' (даты заключения нет)') +
        `; разница ${diffToRubText(diff)} руб.`,
      );
    }
    if (bad.length === 0) return { passed: true };

    return {
      passed: false,
      message:
        `Экономия по компонентам не сходится с «план − факт»: ${bad.join(' ')} ` +
        `(допуск ${SUM_TOLERANCE_RUB} руб.). Сверка итога экономии ` +
        `(AC = Z + AA + AB) такую строку пропускает: тройка между собой сходится, ` +
        `а сумма в ней вбита не та.`,
      cell: `${ECONOMY_COMPONENT_TRIPLES[0].rest}${ctx.rowIndex}`,
      actual: bad.length,
      expected: 'Z = H − V, AA = I − W, AB = J − X (без даты заключения — нули)',
    };
  },
};

// ============================================================
// ПРАВИЛО 22: Способ закупки не указан (условный формат книги №3)
// ============================================================
const methodMissing: ValidationRule = {
  id: 'method_missing',
  name: 'Способ закупки (L) не указан',
  description:
    'В графе A стоит номер закупки, а графа L (способ закупки) пуста. Без ' +
    'способа строка не относится ни к единственному поставщику, ни к аукциону: ' +
    'правовой режим закупки неизвестен.',
  severity: 'error',
  origin: 'spreadsheet_rule',
  scope: 'department',
  params: {},
  check(ctx: RuleCheckContext): RuleCheckResult {
    if (!hasRowNumber(ctx.cells)) return { passed: true };
    // Строго пустота, а не маркер отсутствия: «Х» в графе способа — уже
    // недопустимое ЗНАЧЕНИЕ, и о нём говорит method_validation. Два замечания
    // об одной ячейке читателю не помогают.
    if (String(ctx.cells['L'] ?? '').trim() !== '') return { passed: true };

    return {
      passed: false,
      message:
        `L${ctx.rowIndex} пуста — способ закупки не указан, хотя строка ` +
        `счётная (№ ${String(ctx.cells['A']).trim()}). Без способа по строке ` +
        `не считаются ни лимит единственного поставщика, ни ожидание «план ` +
        `равен факту», ни род экономии: она молча выпадает из всех разборов по ` +
        `способу. Допустимые значения книги ГРБС: ${GRBS_BOOK_METHODS.join(', ')}.`,
      cell: `L${ctx.rowIndex}`,
      actual: null,
      expected: GRBS_BOOK_METHODS.join(' | '),
    };
  },
};

// ============================================================
// ПРАВИЛО 12: УДАЛЕНО — dept_fact_leq_plan
// Дублировало сигнал factExceedsPlan (signals.ts, допуск округления 0,5%).
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
  methodValidation,          // 6  -- L in {ЕП,ЭА} — словарь КНИГИ ГРБС (§22 п.1)
  typeValidation,            // 7  -- F in {ТД,ПМ} (COUNTIFS X$37 criterion)
  statusOnDataRows,          // 8  -- «Экономия без отметки»: канон economy-flag.ts
  deptFactSumConsistency,    // 10 -- Y=V+W+X (dept fact total)
  deptEconomySumConsistency, // 11 -- AC=Z+AA+AB (dept economy total)
  rowNumbering,              // 13 -- № п/п (A): дубли/пропуски/пустые, одна карточка на лист (п.98з)
  textHygiene,               // 14 -- гигиена текста C/G: одна карточка на лист с готовыми исправлениями (п.98д)

  // -- Обмотка над книгой (§22, 30.08.2026): девять слепот продукта --
  planDateGarbage,           // 15 -- N не дата и не «Х» (условный формат книги №6)
  numericCellUnreadable,     // 16 -- H:J, V:X, Z:AB не числа (№7, №8, №9)
  economyFlagGarbage,        // 17 -- AD не «да»/«нет» (№13)
  overdueReasonMissing,      // 18 -- срок нарушен, причина U пуста (№16, №17)
  lateSigned,                // 19 -- заключено позже плановой даты (дни в T > 0)
  outOf44fzPerimeter,        // 20 -- 223-ФЗ в M или AF при способе не ЕП (№20, №21)
  economyComponents,         // 21 -- Z=H−V, AA=I−W, AB=J−X (эталон формул книги)
  methodMissing,             // 22 -- пустой способ L при непустом номере A (№3)
  // deptFactLeqPlan УДАЛЁН (#12) — дубль сигнала factExceedsPlan
  // formulaContinuity УДАЛЁН (#13) — дублирует budget_sum_plan (#1a) + dept_fact_sum (#10)
];

/** Получить все правила (все активны по умолчанию) */
export function getActiveRules(): ValidationRule[] {
  return RULE_BOOK;
}
