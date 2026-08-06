import { describe, expect, it } from 'vitest';
import {
  ACTIVITY_AN4,
  ACTIVITY_F_VALUE,
  ACTIVITY_SCOPES,
  classifyActivity,
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

describe('classifyActivity — единый дом категории строки (Д16)', () => {
  it('ПМ → program; ТД → по графе программы D', () => {
    expect(classifyActivity('Программное мероприятие', 'Программа N')).toBe('program');
    expect(classifyActivity('Текущая деятельность', 'МП «Развитие»')).toBe('current_program');
    expect(classifyActivity('Текущая деятельность', 'X')).toBe('current_non_program');
    expect(classifyActivity('Текущая деятельность', '')).toBe('current_non_program');
  });

  it('длинная ТД-форма с фрагментом «программного мероприятия» остаётся ТД', () => {
    expect(classifyActivity('Текущая деятельность в рамках программного мероприятия', 'Программа'))
      .toBe('current_program');
  });

  it('F пуст или мусор → null: НЕ молчаливое зачисление в program (корень Д16)', () => {
    expect(classifyActivity('', 'Программа N')).toBeNull();
    expect(classifyActivity(null, '')).toBeNull();
    expect(classifyActivity('чушь', 'X')).toBeNull();
  });

  it('согласован со срезами: td_pm ⇔ current_program, td_clean ⇔ current_non_program', () => {
    const cases: Array<[unknown, unknown]> = [
      ['Текущая деятельность', 'Программа'], ['Текущая деятельность', 'Х'],
      ['Программное мероприятие', 'П'], ['', ''],
    ];
    for (const [f, d] of cases) {
      expect(classifyActivity(f, d) === 'current_program').toBe(matchesActivityScope('td_pm', f, d));
      expect(classifyActivity(f, d) === 'current_non_program').toBe(matchesActivityScope('td_clean', f, d));
    }
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
