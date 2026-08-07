import { describe, expect, it } from 'vitest';
import { CHECK_REGISTRY } from '@aemr/shared';
import { recommendationWhere, resolveRecommendation } from './recommendation-source';

const anyCheck = CHECK_REGISTRY.find((c) => c.recommendation.trim() !== '')!;

describe('resolveRecommendation (текст только канонический, иначе честная пустота)', () => {
  it('свой текст замечания побеждает — конвейер уже перенёс его из проверки', () => {
    const r = resolveRecommendation({ recommendation: 'Проставить плановый квартал', checkId: anyCheck.id });
    expect(r.origin).toBe('issue');
    expect(r.text).toBe('Проставить плановый квартал');
  });

  it('без своего текста берётся рекомендация проверки из реестра', () => {
    const r = resolveRecommendation({ checkId: anyCheck.id });
    expect(r.origin).toBe('registry');
    expect(r.text).toBe(anyCheck.recommendation);
  });

  it('category с id правила тоже находит проверку', () => {
    const r = resolveRecommendation({ category: anyCheck.id });
    expect(r.origin).toBe('registry');
    expect(r.text).toBe(anyCheck.recommendation);
  });

  it('неизвестная проверка не даёт сочинённого совета', () => {
    const r = resolveRecommendation({ category: 'signal:overdue', sheet: 'uo', row: 148 });
    expect(r.origin).toBe('none');
    expect(r.text).toBeNull();
  });

  it('пробел вместо текста считается пустотой, а не рекомендацией', () => {
    const r = resolveRecommendation({ recommendation: '   ' });
    expect(r.origin).toBe('none');
    expect(r.text).toBeNull();
  });
});

describe('recommendationWhere (место в книге, без букв колонок)', () => {
  it('лист называется словарной подписью, ячейка — адресом', () => {
    expect(recommendationWhere({ sheet: 'uo', cell: 'K1481' })).toBe('лист УО, ячейка K1481');
  });

  it('без ячейки указывается строка', () => {
    expect(recommendationWhere({ sheet: 'uo', row: 148 })).toBe('лист УО, строка 148');
  });

  it('без листа и без места — null, а не выдуманный «лист»', () => {
    expect(recommendationWhere({})).toBeNull();
  });

  it('одиночная буква колонки местом не считается — есть только адрес ячейки', () => {
    const where = recommendationWhere({ sheet: 'uo', cell: 'U' });
    // Адрес без номера строки — не место в книге, но и не выдумка: показываем
    // ровно то, что дал конвейер, не превращая букву в «колонку U».
    expect(where).toBe('лист УО, ячейка U');
    expect(where).not.toContain('колонк');
  });
});
