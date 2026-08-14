import { describe, expect, it } from 'vitest';
import {
  activityPhrase,
  catsFromActivities,
  effectiveScope,
  isAllCats,
  SVOD_ACTIVITY_CATS,
  type SvodActivityCat,
} from './activity';

const cats = (...list: SvodActivityCat[]) => new Set<SvodActivityCat>(list);

describe('ось деятельности «Свода» = глобальная ось фильтра (канон п.30)', () => {
  it('категорий ровно две — срез «ТД-ПМ» упразднён (страж класса п.30)', () => {
    expect(SVOD_ACTIVITY_CATS).toEqual(['pm', 'td']);
    expect(SVOD_ACTIVITY_CATS as readonly string[]).not.toContain('td_pm');
    expect(SVOD_ACTIVITY_CATS as readonly string[]).not.toContain('td_clean');
  });

  it('ключи глобального фильтра переводятся в категории сетки', () => {
    expect(catsFromActivities(['program'])).toEqual(cats('pm'));
    expect(catsFromActivities(['current_non_program'])).toEqual(cats('td'));
  });

  it('легаси-ключ ТД-ПМ (current_program) сводится в ТД, а не в отдельный срез', () => {
    // Канон п.30: строки ТД-ПМ полностью входят в ТД. Старое состояние
    // фильтра (URL/шапка) с current_program обязано дать ТД целиком.
    expect(catsFromActivities(['current_program'])).toEqual(cats('td'));
    expect(catsFromActivities(['current_program', 'current_non_program'])).toEqual(cats('td'));
  });

  it('чужой ключ отбрасывается, а не превращается в мусорный срез', () => {
    expect(catsFromActivities(['program', 'junk'])).toEqual(cats('pm'));
  });

  it('пусто и обе категории — один и тот же срез «ВСЕ»', () => {
    expect(effectiveScope(cats())).toBe('all');
    expect(effectiveScope(cats('pm', 'td'))).toBe('all');
    expect(isAllCats(cats())).toBe(true);
    expect(isAllCats(cats('pm', 'td'))).toBe(true);
    expect(isAllCats(cats('td'))).toBe(false);
  });

  it('одна категория адресуется своей ячейкой сетки', () => {
    expect(effectiveScope(cats('td'))).toBe('td');
    expect(effectiveScope(cats('pm'))).toBe('pm');
  });

  it('фраза для заголовка — по-русски, в каноническом порядке кнопок', () => {
    expect(activityPhrase(cats())).toBe('все виды деятельности');
    expect(activityPhrase(cats('td'))).toBe('ТД');
    expect(activityPhrase(cats('pm'))).toBe('ПМ');
  });
});
