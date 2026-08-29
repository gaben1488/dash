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
