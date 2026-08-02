/**
 * Страж бага «из фильтра пропала часть организаций»: неполный живой список
 * не должен вытеснять канон — только дополнять его.
 */
import { describe, expect, it } from 'vitest';
import { mergeSubordinates } from './subordinates';

const FALLBACK = {
  edu: ['Гимназия № 1', 'Школа № 2', 'Сад «Ромашка»'],
  culture: ['ДК Елизово'],
  admin: [],
};

describe('mergeSubordinates', () => {
  it('неполный ответ API не вытесняет канон — объединение, не замена', () => {
    const api = { edu: ['Школа № 2'] }; // книга прочитана частично
    const merged = mergeSubordinates(FALLBACK, api);
    expect(merged.edu).toEqual(['Гимназия № 1', 'Сад «Ромашка»', 'Школа № 2']);
  });

  it('живые имена, которых нет в каноне, добавляются', () => {
    const api = { edu: ['Новая школа № 9'] };
    expect(mergeSubordinates(FALLBACK, api).edu).toContain('Новая школа № 9');
  });

  it('недоступная книга (dept отсутствует в API) сохраняет канон целиком', () => {
    const merged = mergeSubordinates(FALLBACK, { edu: ['Школа № 2'] });
    expect(merged.culture).toEqual(['ДК Елизово']);
    expect(merged.admin).toEqual([]);
  });

  it('вход не мутируется', () => {
    const api = { culture: ['Музей'] };
    mergeSubordinates(FALLBACK, api);
    expect(FALLBACK.culture).toEqual(['ДК Елизово']);
  });
});
