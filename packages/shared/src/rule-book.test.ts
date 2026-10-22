/**
 * Стражи RULE_BOOK — решения владельца §22 (30.08.2026,
 * `docs/superpowers/specs/2026-08-22-pulse-feedback-2.md`).
 *
 * Держат три правила от возврата:
 *   п.1 — словарь способов разделён по источникам (книга ГРБС знает ЕП и ЭА);
 *   п.2 — видов деятельности ровно два, длинные формулировки — легаси;
 *   п.3 — допуск сверки итогов K/Y/AC/O равен 5 рублям, а не тысяче.
 */
import { describe, expect, it } from 'vitest';
import { LEGACY_TYPES, RULE_BOOK } from './rule-book.js';
import { GRBS_BOOK_METHODS, PROCUREMENT_METHODS } from './dictionaries/method-families.js';
import { PROCEDURE_FAMILIES } from './procedure-ref.js';
import type { RuleCheckResult, ValidationRule } from './types.js';

function rule(id: string): ValidationRule {
  const found = RULE_BOOK.find((r) => r.id === id);
  if (!found) throw new Error(`Правило «${id}» пропало из RULE_BOOK`);
  return found;
}

function check(id: string, cells: Record<string, unknown>): RuleCheckResult {
  return rule(id).check({
    cells,
    rowIndex: 42,
    sheet: 'ВСЕ',
    classification: 'procurement',
  });
}

describe('неполные исходные значения не доказывают правильность арифметики', () => {
  it.each([
    ['budget_sum_plan', { K: 100, H: 100, I: 0, J: '#REF!' }],
    ['budget_sum_fact', { O: 100, L: 100, M: '#REF!', N: 0 }],
    ['execution_percentage', { D: 10, G: 0 }],
    ['deviation_calc', { D: 10, F: -10 }],
    ['fact_leq_plan', { D: 10, E: '#REF!' }],
  ])('%s сообщает недостаточность данных', (id, cells) => {
    expect(check(String(id), cells as Record<string, unknown>).passed).toBeNull();
  });
});

describe('квартал сравнивается с годом только по прочитанным значениям', () => {
  const context = { cells: { D: 2, K: 50 }, rowIndex: 9, sheet: 'СВОД ТД-ПМ', classification: 'summary' as const };
  const year = { ...context, rowIndex: 14, classificationConfidence: 1, classificationReasons: [] };
  it('не объявляет проверенным отсутствующий годовой контекст', () => {
    expect(rule('q1_leq_year').check(context).passed).toBeNull();
    expect(rule('q1_leq_year').check({ ...context, allRows: [] }).passed).toBeNull();
  });
  it('не объявляет проверенной нечитаемую годовую сумму', () => {
    expect(rule('q1_leq_year').check({ ...context,
      allRows: [{ ...year, cells: { D: 3, K: '#REF!' } }] }).passed).toBeNull();
  });
  it('сохраняет доказанное превышение количества при неизвестной сумме', () => {
    expect(rule('q1_leq_year').check({ ...context,
      allRows: [{ ...year, cells: { D: 1, K: '#REF!' } }] })).toMatchObject({ passed: false, cell: 'D9' });
  });
  it('не требует годовую пару у неприменимой строки', () => {
    expect(rule('q1_leq_year').check({ ...context, rowIndex: 1 }).passed).toBe(true);
  });
});

describe('причина задержки следует датам, а не устаревшему значению T', () => {
  it.each([
    { N: '01.03.2026', Q: '01.03.2026', T: 12 },
    { N: '01.03.2026', Y: 50, T: 12 },
    { N: '', T: 12 },
  ])('не требует причины неподтверждённой задержки', cells => {
    expect(check('overdue_reason_missing', { A: 1, U: '', ...cells }).passed).toBe(true);
  });
  it('определяет текущую задержку по дню среза даже при пустой T', () => {
    const result = rule('overdue_reason_missing').check({ cells: { A: 1, N: '01.03.2026', U: '' },
      rowIndex: 42, sheet: 'УО', classification: 'procurement', asOf: new Date('2026-03-02T00:00:00Z') });
    expect(result.passed).toBe(false);
    expect(result.message).toContain('заключение не подтверждено');
  });
});

describe('§22 п.1 — словарь способов разделён по источникам', () => {
  it('СТРАЖ: книга ГРБС знает ровно два способа — ЕП и ЭА', () => {
    expect([...GRBS_BOOK_METHODS]).toEqual(['ЕП', 'ЭА']);
  });

  it('СТРАЖ: строки книги ГРБС со способом ЕП и ЭА проходят', () => {
    for (const method of GRBS_BOOK_METHODS) {
      expect(check('method_validation', { L: method }).passed).toBe(true);
    }
    // Пустая ячейка — предмет другой проверки (полнота), не словаря.
    expect(check('method_validation', { L: '' }).passed).toBe(true);
  });

  it('СТРАЖ: чужой способ в книге ГРБС бракуется, а не считается нормой', () => {
    for (const method of ['ЭК', 'ЭЗК', 'ЭАС', 'ЭЕП', 'Конкурс']) {
      const result = check('method_validation', { L: method });
      expect(result.passed).toBe(false);
      expect(result.cell).toBe('L42');
      expect(result.message).toContain(method);
    }
  });

  it('СТРАЖ: словарь мониторинга сужение книг ГРБС не затронуло', () => {
    // Полный набор процедур уполномоченного органа живёт в своём доме и
    // обязан продолжать знать конкурс, котировки, совместный аукцион и ЕП.
    for (const family of ['ЭА', 'ЭЗК', 'ЭЕП', 'ЭАС', 'ЭК']) {
      expect(PROCEDURE_FAMILIES as readonly string[]).toContain(family);
    }
    // Ось аналитики (группировки «конкурентные / ЕП») тоже не сужалась:
    // иначе процедуры мониторинга выпали бы из фильтров и разрезов.
    expect(new Set(PROCUREMENT_METHODS)).toEqual(new Set(['ЭА', 'ЕП', 'ЭК', 'ЭЗК']));
  });
});

describe('§22 п.2 — вид деятельности: два значения, остальное легаси', () => {
  it('СТРАЖ: оба канонных значения проходят', () => {
    expect(check('type_validation', { F: 'Текущая деятельность' }).passed).toBe(true);
    expect(check('type_validation', { F: 'Программное мероприятие' }).passed).toBe(true);
  });

  it('СТРАЖ: длинные формулировки — легаси, в валидности новых данных не участвуют', () => {
    for (const legacy of LEGACY_TYPES) {
      const result = check('type_validation', { F: legacy });
      expect(result.passed).toBe(false);
      // Легаси названо своими словами, а не свалено в «мусор оператора».
      expect(result.message).toContain('п.30');
    }
  });

  it('СТРАЖ: посторонний текст бракуется без легаси-пояснения', () => {
    const result = check('type_validation', { F: 'Прочее' });
    expect(result.passed).toBe(false);
    expect(result.message).not.toContain('п.30');
  });
});

describe('§22 п.3 — допуск сверки итогов равен 5 рублям', () => {
  // Суммы книг ведутся в ТЫСЯЧАХ рублей: 0,999 в ячейке — это 999 рублей.
  const cases: Array<{ id: string; total: string; parts: string[] }> = [
    { id: 'budget_sum_plan', total: 'K', parts: ['H', 'I', 'J'] },
    { id: 'dept_fact_sum', total: 'Y', parts: ['V', 'W', 'X'] },
    { id: 'dept_economy_sum', total: 'AC', parts: ['Z', 'AA', 'AB'] },
    { id: 'budget_sum_fact', total: 'O', parts: ['L', 'M', 'N'] },
  ];

  for (const { id, total, parts } of cases) {
    it(`СТРАЖ ${id}: расхождение 999 руб. рождает замечание (прежний код молчал)`, () => {
      const cells: Record<string, unknown> = { [total]: 100.999 };
      cells[parts[0]] = 100;
      cells[parts[1]] = 0;
      cells[parts[2]] = 0;

      const result = check(id, cells);
      expect(result.passed).toBe(false);
      // Разница печатается в РУБЛЯХ: до 30.08.2026 читатель видел «1.00 руб.»
      // там, где книга разошлась на 999 рублей.
      expect(result.message).toContain('999.00 руб.');
    });

    it(`СТРАЖ ${id}: расхождение 4 руб. — копеечный шум, замечания нет`, () => {
      const cells: Record<string, unknown> = { [total]: 100.004 };
      cells[parts[0]] = 100;
      cells[parts[1]] = 0;
      cells[parts[2]] = 0;

      expect(check(id, cells).passed).toBe(true);
    });

    it(`СТРАЖ ${id}: расхождение 6 руб. уже видно`, () => {
      const cells: Record<string, unknown> = { [total]: 100.006 };
      cells[parts[0]] = 100;
      cells[parts[1]] = 0;
      cells[parts[2]] = 0;

      expect(check(id, cells).passed).toBe(false);
    });
  }
});

describe('integrated hotfix: sums follow Google ROUND without hiding missing inputs', () => {
  const examples: Array<{ id: string; total: string; parts: string[] }> = [
    { id: 'budget_sum_plan', total: 'K', parts: ['H', 'I', 'J'] },
    { id: 'dept_fact_sum', total: 'Y', parts: ['V', 'W', 'X'] },
    { id: 'dept_economy_sum', total: 'AC', parts: ['Z', 'AA', 'AB'] },
    { id: 'budget_sum_fact', total: 'O', parts: ['L', 'M', 'N'] },
  ];

  for (const { id, total, parts } of examples) {
    const input = (sum: unknown, x: unknown, y: unknown = 0, z: unknown = 0) => ({
      A: '12/1', [total]: sum, [parts[0]]: x, [parts[1]]: y, [parts[2]]: z,
    });

    it(`${id}: 4.9 rub is within rounding, exact 5 rub is not`, () => {
      expect(check(id, input(100.0049, 100)).passed).toBe(true);
      expect(check(id, input(100.005, 100)).passed).toBe(false);
      expect(check(id, input(99.995, 100)).passed).toBe(false);
    });

    it(`${id}: blank SUM component counts as zero, not unverified`, () => {
      expect(check(id, input(100, 100, '')).passed).toBe(true);
      expect(check(id, input(130, 100, '')).passed).toBe(false);
    });

    it(`${id}: missing or malformed total is UNKNOWN, not falsely passed`, () => {
      for (const sum of [undefined, null, '', 'text']) {
        const result = check(id, input(sum, 100));
        expect(result.passed).toBeNull();
      }
    });

    it(`${id}: malformed nonempty component is UNKNOWN, not silently zero`, () => {
      expect(check(id, input(100, '12abc', 0)).passed).toBeNull();
    });
  }
});

describe('integrated hotfix: composite IDs are distinct in the rule book', () => {
  const makeRows = (ids: string[]) => ids.map((id, i) => ({
    sheet: 'ВСЕ', rowIndex: i + 4, classification: 'procurement' as const,
    classificationConfidence: 1, classificationReasons: [], cells: {
      A: id, G: 'Предмет', K: 100, L: 'ЕП',
    },
  }));

  it('does not merge numeric 12 with composite 12/1', () => {
    const allRows = makeRows(['12', '12/1', '12/2']);
    const result = rule('row_numbering').check({
      cells: allRows[0].cells, rowIndex: 4,
      sheet: 'ВСЕ', classification: 'procurement', allRows,
    });
    expect(result.passed).toBe(true);
  });

  it('still reports two identical 12/1 IDs as a genuine duplicate', () => {
    const allRows = makeRows(['12', '12/1', '12/1']);
    const result = rule('row_numbering').check({
      cells: allRows[0].cells, rowIndex: 4,
      sheet: 'ВСЕ', classification: 'procurement', allRows,
    });
    expect(result.passed).toBe(false);
    expect(result.message).toContain('12/1');
  });
});
