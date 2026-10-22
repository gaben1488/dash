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
import { LEGACY_TYPES, RULE_BOOK, toNumber } from './rule-book.js';
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

describe('§22 п.3 — порог сверки итогов начинается с 5 рублей', () => {
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

describe('hotfix: Google SUM and ROUND parity', () => {
  const cases: Array<{ id: string; total: string; parts: string[] }> = [
    { id: 'budget_sum_plan', total: 'K', parts: ['H', 'I', 'J'] },
    { id: 'dept_fact_sum', total: 'Y', parts: ['V', 'W', 'X'] },
    { id: 'dept_economy_sum', total: 'AC', parts: ['Z', 'AA', 'AB'] },
    { id: 'budget_sum_fact', total: 'O', parts: ['L', 'M', 'N'] },
  ];

  for (const { id, total, parts } of cases) {
    const input = (sum: unknown, a: unknown, b: unknown = 0, d: unknown = 0) =>
      ({ A: '12/1', [total]: sum, [parts[0]]: a, [parts[1]]: b, [parts[2]]: d });

    it(`${id}: an exact 5-ruble discrepancy is visible, as ROUND(diff;2) requires`, () => {
      expect(check(id, input(100.005, 100)).passed).toBe(false);
      expect(check(id, input(99.995, 100)).passed).toBe(false);
      expect(check(id, input(100.0049, 100)).passed).toBe(true);
    });

    it(`${id}: blank components have the same zero meaning as Sheets SUM`, () => {
      expect(check(id, input(100, 100, '')).passed).toBe(true);
      expect(check(id, input(130, 100, '')).passed).toBe(false);
    });

    it(`${id}: incomplete or invalid totals are not a successful arithmetic check`, () => {
      for (const invalid of [null, '', 'not a number']) {
        const result = check(id, input(invalid, 100));
        expect(result.passed).toBe(false);
        expect(result.message).toContain('НЕ выполнена');
      }
    });

    it(`${id}: invalid nonempty components cannot silently skip the sum`, () => {
      const result = check(id, input(100, '12abc', 50));
      expect(result.passed).toBe(false);
      expect(result.message).toContain('НЕ выполнена');
    });
  }

  it('numeric parsing must consume the entire cell, not the prefix', () => {
    expect(toNumber('12abc')).toBeNull();
    expect(toNumber('12/1')).toBeNull();
    expect(toNumber('1 234,50')).toBe(1234.5);
    expect(toNumber('12.5.9')).toBeNull();
  });
});

describe('hotfix: compound procurement sequence IDs are not merged', () => {
  const runSequenceCheck = (ids: Array<string | number>) => {
    const rows = ids.map((id, index) => ({
      rowIndex: index + 4,
      sheet: 'ВСЕ',
      classification: 'procurement' as const,
      classificationConfidence: 1,
      classificationReasons: [],
      cells: { A: id, G: 'Поставка', L: 'ЕП', K: 100 },
    }));
    return rule('row_numbering').check({
      cells: rows[0].cells,
      rowIndex: 4,
      sheet: 'ВСЕ',
      classification: 'procurement',
      allRows: rows,
    });
  };

  it('treats 12, 12/1 and 12/01 as three distinct intact addresses', () => {
    expect(runSequenceCheck([12, '12/1', '12/01']).passed).toBe(true);
  });

  it('detects a true duplicate 12/1 without rewriting it as 12', () => {
    const result = runSequenceCheck([12, '12/1', '12/1']);
    expect(result.passed).toBe(false);
    expect(result.message).toContain('12/1');
    expect(result.message).not.toContain('№ 12 —');
  });
});
