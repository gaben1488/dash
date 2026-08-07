import { describe, expect, it } from 'vitest';
import {
  activityPhrase,
  catsFromActivities,
  effectiveScope,
  type SvodActivityCat,
} from './activity';

const cats = (...list: SvodActivityCat[]) => new Set<SvodActivityCat>(list);

describe('ось деятельности «Свода» = глобальная ось фильтра', () => {
  it('ключи глобального фильтра переводятся в категории сетки', () => {
    expect(catsFromActivities(['program', 'current_program'])).toEqual(cats('pm', 'td_pm'));
    expect(catsFromActivities(['current_non_program'])).toEqual(cats('td_clean'));
  });

  it('чужой ключ отбрасывается, а не превращается в мусорный срез', () => {
    expect(catsFromActivities(['program', 'junk'])).toEqual(cats('pm'));
  });

  it('пусто и все три — один и тот же срез «ВСЕ»', () => {
    expect(effectiveScope(cats())).toBe('all');
    expect(effectiveScope(cats('pm', 'td_clean', 'td_pm'))).toBe('all');
  });

  it('текущая деятельность целиком — это чистая плюс с программой', () => {
    expect(effectiveScope(cats('td_clean', 'td_pm'))).toBe('td');
  });

  it('одна категория адресуется своей ячейкой сетки', () => {
    expect(effectiveScope(cats('td_pm'))).toBe('td_pm');
  });

  it('фраза для заголовка — по-русски, в каноническом порядке кнопок', () => {
    expect(activityPhrase(cats())).toBe('все виды деятельности');
    expect(activityPhrase(cats('td_pm', 'pm'))).toBe('ПМ + ТД-ПМ');
  });
});
