import { describe, expect, it } from 'vitest';
import {
  ACTIVITY_AN4,
  ACTIVITY_F_VALUE,
  ACTIVITY_SCOPES,
  matchesActivityScope,
  parseActivityScope,
} from './activity-scope';

describe('activity-scope', () => {
  it('перечисляет три среза с AN4-маппингом таблицы', () => {
    expect(ACTIVITY_SCOPES).toEqual(['all', 'td', 'pm']);
    expect(ACTIVITY_AN4).toEqual({ all: '*', td: 'ТД', pm: 'ПМ' });
  });

  it('matchesActivityScope: all — любая строка', () => {
    expect(matchesActivityScope('all', 'Программное мероприятие')).toBe(true);
    expect(matchesActivityScope('all', '')).toBe(true);
    expect(matchesActivityScope('all', null)).toBe(true);
  });

  it('matchesActivityScope: td/pm сверяют значение столбца F (регистро/пробел-устойчиво)', () => {
    expect(matchesActivityScope('td', '  Текущая деятельность ')).toBe(true);
    expect(matchesActivityScope('td', 'текущая деятельность')).toBe(true);
    expect(matchesActivityScope('pm', 'Программное мероприятие')).toBe(true);
    // не путать срезы
    expect(matchesActivityScope('td', 'Программное мероприятие')).toBe(false);
    expect(matchesActivityScope('pm', 'Текущая деятельность')).toBe(false);
    expect(matchesActivityScope('pm', '')).toBe(false);
    expect(ACTIVITY_F_VALUE.td).toBe('Текущая деятельность');
  });

  it('parseActivityScope: AN4 / F / алиасы → ActivityScope', () => {
    expect(parseActivityScope('*')).toBe('all');
    expect(parseActivityScope('ТД-ПМ')).toBe('all');
    expect(parseActivityScope('ТД')).toBe('td');
    expect(parseActivityScope('Текущая деятельность')).toBe('td');
    expect(parseActivityScope('ПМ')).toBe('pm');
    expect(parseActivityScope('Программное мероприятие')).toBe('pm');
    expect(parseActivityScope('')).toBeNull();
    expect(parseActivityScope('чушь')).toBeNull();
  });
});
