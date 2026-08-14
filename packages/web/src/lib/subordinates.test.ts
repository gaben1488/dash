/**
 * Страж бага «из фильтра пропала часть организаций»: неполный живой список
 * не должен вытеснять канон — только дополнять его.
 */
import { describe, expect, it } from 'vitest';
import { mergeSubordinates } from './subordinates';
import { SUBORDINATES_FALLBACK } from '../store';

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

  it('п.51: живой список = канон (canonicalName ⇔ колонка C) → без дублей и роста', () => {
    // Страж класса «счётчик подведов завышен» (УКСиМП 23 вместо 22):
    // fallback обязан состоять из canonicalName — дословных значений
    // колонки C книги; тогда объединение с /api/rows/subordinates даёт
    // ровно те же позиции, а не вторую копию организации под иным
    // написанием («КДМШ» рядом с «МБУ ДО "КДМШ"»).
    const uksimp = SUBORDINATES_FALLBACK['УКСиМП'];
    const merged = mergeSubordinates(
      { 'УКСиМП': uksimp },
      { 'УКСиМП': [...uksimp] }, // живая колонка C = те же дословные значения
    );
    expect(merged['УКСиМП']).toHaveLength(uksimp.length); // 21: без роста
    expect(new Set(merged['УКСиМП']).size).toBe(merged['УКСиМП'].length); // без дублей
  });
});
