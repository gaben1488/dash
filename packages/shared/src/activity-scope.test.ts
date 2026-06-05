import { describe, expect, it } from 'vitest';
import {
  ACTIVITY_AN4,
  ACTIVITY_F_VALUE,
  ACTIVITY_SCOPES,
  matchesActivityScope,
  parseActivityScope,
} from './activity-scope';

describe('activity-scope', () => {
  it('перечисляет четыре среза; td_pm не имеет AN4 листа (CalcEngine-only)', () => {
    expect(ACTIVITY_SCOPES).toEqual(['all', 'td', 'pm', 'td_pm']);
    expect(ACTIVITY_AN4).toEqual({ all: '*', td: 'ТД', pm: 'ПМ', td_pm: null });
  });

  it('td_pm: ТД И графа программы (D) ≠ X/Х/пусто', () => {
    const TD = 'Текущая деятельность';
    expect(matchesActivityScope('td_pm', TD, 'Муниципальная программа «Развитие…»')).toBe(true);
    expect(matchesActivityScope('td_pm', TD, 'X')).toBe(false);
    expect(matchesActivityScope('td_pm', TD, 'Х')).toBe(false);
    expect(matchesActivityScope('td_pm', TD, '')).toBe(false);
    expect(matchesActivityScope('td_pm', TD, null)).toBe(false);
    // ПМ-строка не попадает в td_pm даже с программой
    expect(matchesActivityScope('td_pm', 'Программное мероприятие', 'Программа N')).toBe(false);
    // td (без под-разбивки) включает обе ТД-строки
    expect(matchesActivityScope('td', TD, 'X')).toBe(true);
    expect(matchesActivityScope('td', TD, 'Программа')).toBe(true);
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

  it('claim 1: длинные канонические формы F классифицируются по подстроке', () => {
    // VALID_ACTIVITY_TYPES_RAW: длинные формы — реальные значения столбца F.
    expect(matchesActivityScope('td', 'Текущая деятельность в рамках программного мероприятия')).toBe(true);
    expect(matchesActivityScope('td', 'Текущая деятельность вне рамок программного мероприятия')).toBe(true);
    // длинная ТД-форма содержит «программного мероприятия», но это НЕ ПМ (ПМ-проверка по подстроке «программное мероприятие»)
    expect(matchesActivityScope('pm', 'Текущая деятельность в рамках программного мероприятия')).toBe(false);
    // td_pm на длинной форме + графа программы (D≠X)
    expect(matchesActivityScope('td_pm', 'Текущая деятельность в рамках программного мероприятия', 'Программа N')).toBe(true);
    expect(matchesActivityScope('td_pm', 'Текущая деятельность вне рамок программного мероприятия', 'X')).toBe(false);
  });

  it('parseActivityScope: AN4 / F / алиасы → ActivityScope', () => {
    expect(parseActivityScope('*')).toBe('all');
    expect(parseActivityScope('ТД-ПМ')).toBe('td_pm');
    expect(parseActivityScope('ТД')).toBe('td');
    expect(parseActivityScope('Текущая деятельность')).toBe('td');
    expect(parseActivityScope('ПМ')).toBe('pm');
    expect(parseActivityScope('Программное мероприятие')).toBe('pm');
    expect(parseActivityScope('')).toBeNull();
    expect(parseActivityScope('чушь')).toBeNull();
  });
});
