import { describe, expect, it } from 'vitest';
import {
  ACTIVITY_AN4,
  ACTIVITY_F_VALUE,
  ACTIVITY_LABEL,
  ACTIVITY_SCOPES,
  classifyActivity,
  matchesActivityScope,
  parseActivityScope,
} from './activity-scope';

describe('activity-scope', () => {
  it('срезов ровно три: ВСЕ/ПМ/ТД — срез «ТД-ПМ» упразднён (канон п.30, 14.08.2026)', () => {
    // Страж класса: ни td_pm, ни производный td_clean не должны вернуться —
    // они выкидывали ТД-ПМ-строки из «ТД» и рождали ложный сигнал «ошибка
    // заполнения» (заполненная графа программы у ТД — норма).
    expect(ACTIVITY_SCOPES).toEqual(['all', 'pm', 'td']);
    expect(ACTIVITY_SCOPES).not.toContain('td_pm');
    expect(ACTIVITY_SCOPES).not.toContain('td_clean');
    expect(ACTIVITY_AN4).toEqual({ all: '*', td: 'ТД', pm: 'ПМ' });
    expect(Object.keys(ACTIVITY_LABEL).sort()).toEqual(['all', 'pm', 'td']);
  });

  it('канон п.30: ТД с заполненной графой программы (D) — обычная ТД по срезу', () => {
    const TD = 'Текущая деятельность';
    // Числа реестра: строка ТД с реальной программой в D обязана входить в
    // срез «ТД» при любом варианте фильтра — раньше срез td_clean её выкидывал.
    expect(matchesActivityScope('td', TD, 'Муниципальная программа «Развитие…»')).toBe(true);
    expect(matchesActivityScope('td', TD, 'X')).toBe(true);
    expect(matchesActivityScope('td', TD, 'Х')).toBe(true);
    expect(matchesActivityScope('td', TD, '')).toBe(true);
    expect(matchesActivityScope('td', TD, null)).toBe(true);
    // ПМ-строка в ТД не попадает — виды не смешиваются.
    expect(matchesActivityScope('td', 'Программное мероприятие', 'Программа N')).toBe(false);
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
  });

  it('parseActivityScope: AN4 / F / алиасы → ActivityScope', () => {
    expect(parseActivityScope('*')).toBe('all');
    expect(parseActivityScope('ТД')).toBe('td');
    expect(parseActivityScope('Текущая деятельность')).toBe('td');
    expect(parseActivityScope('ПМ')).toBe('pm');
    expect(parseActivityScope('Программное мероприятие')).toBe('pm');
    expect(parseActivityScope('')).toBeNull();
    expect(parseActivityScope('чушь')).toBeNull();
  });

  it('легаси-метки упразднённых срезов раскрываются как ТД, а не как null/ВСЕ (канон п.30)', () => {
    // Старые URL, снимки и атомы могут нести срез «ТД-ПМ»/«ТД чистая»:
    // строки этих срезов полностью входят в ТД, значит и метка обязана
    // разворачиваться в 'td' — иначе старая ссылка молча показала бы «ВСЕ».
    expect(parseActivityScope('ТД-ПМ')).toBe('td');
    expect(parseActivityScope('td_pm')).toBe('td');
    expect(parseActivityScope('current_program')).toBe('td');
    expect(parseActivityScope('ТД чистая')).toBe('td');
    expect(parseActivityScope('td_clean')).toBe('td');
    expect(parseActivityScope('current_non_program')).toBe('td');
  });
});

describe('classifyActivity — единый дом категории строки (Д16 + канон п.30)', () => {
  it('ПМ → program; ТД → ТД независимо от графы программы D', () => {
    expect(classifyActivity('Программное мероприятие', 'Программа N')).toBe('program');
    // Канон п.30: заполненная графа программы у ТД — норма, отдельной
    // категории 'current_program' больше не существует.
    expect(classifyActivity('Текущая деятельность', 'МП «Развитие»')).toBe('current_non_program');
    expect(classifyActivity('Текущая деятельность', 'X')).toBe('current_non_program');
    expect(classifyActivity('Текущая деятельность', '')).toBe('current_non_program');
  });

  it('страж класса: категория "current_program" не выдаётся ни для какой строки', () => {
    // Воспроизводит дефект п.30: раньше ТД-строка с программой получала
    // отдельную категорию и выпадала из «ТД» в фильтрах/метриках/сигнале
    // tdWithProgram. Значение оставлено в типе только для старых снимков.
    const rows: Array<[unknown, unknown]> = [
      ['Текущая деятельность', 'МП «Культура»'],
      ['Текущая деятельность в рамках программного мероприятия', 'Программа'],
      ['Текущая деятельность', 'Х'],
      ['Программное мероприятие', 'Программа'],
      ['', 'Программа'],
    ];
    for (const [f, d] of rows) {
      expect(classifyActivity(f, d)).not.toBe('current_program');
    }
  });

  it('длинная ТД-форма с фрагментом «программного мероприятия» остаётся ТД', () => {
    expect(classifyActivity('Текущая деятельность в рамках программного мероприятия', 'Программа'))
      .toBe('current_non_program');
  });

  it('F пуст или мусор → null: НЕ молчаливое зачисление в program (корень Д16)', () => {
    expect(classifyActivity('', 'Программа N')).toBeNull();
    expect(classifyActivity(null, '')).toBeNull();
    expect(classifyActivity('чушь', 'X')).toBeNull();
  });

  it('согласован со срезами: category ⇔ matchesActivityScope при любом D', () => {
    const cases: Array<[unknown, unknown]> = [
      ['Текущая деятельность', 'Программа'], ['Текущая деятельность', 'Х'],
      ['Программное мероприятие', 'П'], ['', ''],
    ];
    for (const [f, d] of cases) {
      expect(classifyActivity(f, d) === 'program').toBe(matchesActivityScope('pm', f, d));
      expect(classifyActivity(f, d) === 'current_non_program').toBe(matchesActivityScope('td', f, d));
    }
  });
});
