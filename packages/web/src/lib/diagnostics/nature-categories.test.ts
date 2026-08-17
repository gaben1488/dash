import { describe, it, expect } from 'vitest';
import { natureOf, NATURE_CATEGORIES, NATURE_ORDER } from './nature-categories';
import { CHECK_REGISTRY } from '@aemr/shared';

describe('natureOf — категории по природе (канон п.88/26б)', () => {
  it('пустые обязательные поля — ошибка заполнения книги', () => {
    expect(natureOf({ checkId: 'data_quality' }).id).toBe('fill');
  });

  it('несведённые итоги (итог ≠ ФБ+КБ+МБ) — ошибка заполнения книги, слова владельца', () => {
    expect(natureOf({ checkId: 'budget_sum_plan' }).id).toBe('fill');
    expect(natureOf({ checkId: 'dept_fact_sum' }).id).toBe('fill');
  });

  it('формула возвращает ошибку — дефект формул листа', () => {
    expect(natureOf({ checkId: 'formula_broken' }).id).toBe('sheet');
  });

  it('просрочка и антидемпинг — исполнение закупок', () => {
    expect(natureOf({ checkId: 'overdue' }).id).toBe('execution');
    expect(natureOf({ checkId: 'anti_dumping' }).id).toBe('execution');
  });

  it('старый ключ категории `signal:overdue` понимается', () => {
    expect(natureOf({ category: 'signal:overdue' }).id).toBe('execution');
  });

  it('сигнал в camelCase (factWithoutDate) приводится к реестровому ключу', () => {
    expect(natureOf({ signal: 'factWithoutDate' }).id).toBe('fill');
  });

  it('неизвестная проверка не притягивается — уходит в «прочие»', () => {
    expect(natureOf({ checkId: 'какая_то_новая' }).id).toBe('other');
  });

  it('запасной путь по группе реестра работает', () => {
    expect(natureOf({ checkId: 'нет_такого', group: 'formula_consistency' }).id).toBe('sheet');
  });

  it('КАЖДАЯ проверка живого реестра имеет природу (не «прочие»)', () => {
    for (const check of CHECK_REGISTRY) {
      const nature = natureOf({ checkId: check.id, group: check.group });
      expect(nature.id, `проверка ${check.id} без природы`).not.toBe('other');
    }
  });

  it('подписи категорий — канон владельца, без термина «доверие»', () => {
    expect(NATURE_CATEGORIES.fill.label).toBe('Ошибка заполнения книги');
    expect(NATURE_CATEGORIES.sheet.label).toBe('Дефект формул листа');
    expect(NATURE_CATEGORIES.execution.label).toBe('Исполнение закупок');
    for (const id of NATURE_ORDER) {
      expect(NATURE_CATEGORIES[id].label.toLowerCase()).not.toContain('довери');
    }
  });
});
