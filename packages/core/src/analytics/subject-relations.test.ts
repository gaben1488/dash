import { describe, expect, it } from 'vitest';
import { compareSubjectDescriptions as compare } from './subject-relations.js';

/**
 * Source-level regression: wording similarity is not procurement identity.
 * These pairs come from recurrent situations in the eight procurement books.
 */
describe('Смысловые отношения текстов: безопасный первый слой', () => {
  it('дословное совпадение означает только совпадение текста', () => {
    const found = compare('Масло сливочное', 'Масло сливочное');
    expect(found.kind).toBe('exact_text');
    expect(found.blocked).toBe(false);
    expect(found.evidence.length).toBeGreaterThan(0);
  });

  it('ТКО и полная расшифровка обозначают одну услугу на уровне категории', () => {
    const found = compare(
      'Услуги по обращению с ТКО',
      'Оказание услуг по обращению с твердыми коммунальными отходами',
    );
    expect(found.kind).toBe('same_kind');
    expect(found.blocked).toBe(false);
  });

  it('приобретение и поставка канцтоваров относятся к одной предметной категории', () => {
    expect(compare('Приобретение канцелярских товаров', 'Поставка канцелярских товаров').kind).toBe('same_kind');
  });

  it('заправка с восстановлением не эквивалентна простой заправке', () => {
    const found = compare('Заправка картриджей', 'Заправка и восстановление картриджей');
    expect(found.kind).toBe('material_difference');
    expect(found.blocked).toBe(true);
  });

  it('разработка ПСД на ремонт не означает выполнение ремонта', () => {
    const found = compare('Капитальный ремонт кровли', 'Разработка ПСД на капитальный ремонт кровли');
    expect(found.kind).toBe('different_action');
    expect(found.blocked).toBe(true);
  });

  it('капитальный и текущий ремонт — разный объём работ', () => {
    expect(compare('Капитальный ремонт кровли', 'Текущий ремонт кровли').kind).toBe('material_difference');
  });

  it('различающиеся номера объекта сохраняются как материальное расхождение', () => {
    expect(compare('Ремонт кровли корпуса № 1', 'Ремонт кровли корпуса № 2').kind).toBe('material_difference');
  });

  it('год правового документа нельзя менять как обычную орфографию', () => {
    expect(compare('Распоряжение № 112 от 03.09.2025', 'Распоряжение № 112 от 03.09.2026').kind).toBe('material_difference');
  });

  it('не оплачено и оплачено — противоположные утверждения, не синонимы', () => {
    const found = compare('Не оплачено 45000 за 2 здания', 'Оплачено 45000 за 2 здания');
    expect(found.kind).toBe('contradiction');
    expect(found.blocked).toBe(true);
  });

  it('название программы «Растем вместе» защищено от частотной подмены', () => {
    expect(compare('Растем вместе', 'Растем месте').blocked).toBe(true);
  });

  it('интерактивные задания не превращаются в здания по расстоянию букв', () => {
    expect(compare('интерактивных заданий', 'интерактивных зданий').blocked).toBe(true);
  });
});
