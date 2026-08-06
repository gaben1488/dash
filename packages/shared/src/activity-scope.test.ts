import { describe, expect, it } from 'vitest';
import {
  ACTIVITY_AN4,
  ACTIVITY_F_VALUE,
  ACTIVITY_SCOPES,
  matchesActivityScope,
  parseActivityScope,
} from './activity-scope';

describe('activity-scope', () => {
  it('перечисляет пять срезов; td_pm и td_clean не имеют AN4 листа (CalcEngine-only)', () => {
    // 06.08: добавлен td_clean (мультивыбор «по отдельности и вместе»);
    // порядок = порядок кнопок UI: целые срезы, затем состав ТД.
    expect(ACTIVITY_SCOPES).toEqual(['all', 'pm', 'td', 'td_clean', 'td_pm']);
    expect(ACTIVITY_AN4).toEqual({ all: '*', td: 'ТД', pm: 'ПМ', td_pm: null, td_clean: null });
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

describe('td_clean — чистая текущая деятельность (мультивыбор 06.08)', () => {
  it('ТД без программы попадает, ТД с программой нет', () => {
    expect(matchesActivityScope('td_clean', 'Текущая деятельность', 'X')).toBe(true);
    expect(matchesActivityScope('td_clean', 'Текущая деятельность', '')).toBe(true);
    expect(matchesActivityScope('td_clean', 'Текущая деятельность', 'МП «Развитие образования»')).toBe(false);
    expect(matchesActivityScope('td_clean', 'Программное мероприятие', 'X')).toBe(false);
  });

  it('категории не пересекаются и в сумме дают ТД: td = td_clean + td_pm', () => {
    const rows: Array<[string, string]> = [
      ['Текущая деятельность', 'X'],
      ['Текущая деятельность', 'МП «Культура»'],
      ['Программное мероприятие', 'МП «Культура»'],
    ];
    for (const [f, d] of rows) {
      const inClean = matchesActivityScope('td_clean', f, d);
      const inTdPm = matchesActivityScope('td_pm', f, d);
      const inTd = matchesActivityScope('td', f, d);
      expect(inClean && inTdPm).toBe(false);        // не пересекаются
      expect(inClean || inTdPm).toBe(inTd);          // вместе = вся ТД
    }
  });

  it('parseActivityScope узнаёт новую категорию', () => {
    expect(parseActivityScope('ТД чистая')).toBe('td_clean');
    expect(parseActivityScope('td_clean')).toBe('td_clean');
  });
});
