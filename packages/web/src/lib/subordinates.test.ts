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

  it('разные кавычки и пробелы в справочнике и живой книге — одна позиция', () => {
    const data = mergeSubordinates(
      { 'УКСиМП': ['МБУ ДО "КДМШ"', 'МБУ ДО "НДШИ"'], 'УО': ['МБОУ «Елизовская средняя школа №3»'] },
      { 'УКСиМП': ['МБУ ДО «КДМШ»', 'МБУ ДО «НДШИ»'], 'УО': ['МБОУ «Елизовская средняя школа № 3»'] },
    );
    expect(data['УКСиМП']).toEqual(['МБУ ДО «КДМШ»', 'МБУ ДО «НДШИ»']);
    expect(data['УО']).toEqual(['МБОУ «Елизовская средняя школа № 3»']);
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

  it('миграция R→E: все 5 контуров с подведами читают текущие имена без вторых пунктов', () => {
    const live: Record<string, string[]> = {
      'УКСиМП': [
        'МБУ ДО КДМШ', 'МБУ ДО НДШИ', 'МБУ ДО РДМШ',
        'МБУ ДО ДШИ п. Термальный', 'МБУ ДО ЕДМШ',
        'МБУ ДО ЕДХШ', 'МБУК ЕРКМ', 'МБУК ЕРЗ',
        'МКУ ЦБАХО', 'Совместные закупки (УКСиМП)',
      ],
      'УО': [
        'МАДОУ "Детский сад № 1 "Ласточка"',
        'МБДОУ "Детский сад № 9 "Звездочка"',
        'МБДОУ № 36', 'МБОУ "ЕСШ № 3"',
        'УО (Администрирование)', 'УО (Опека)', 'Совместные закупки (УО)',
      ],
      'УАГЗО': ['МКУ "Елизовское РУС"'],
      'УД': ['МКУ "ЕДДС ЕМР"'],
      'УЭР': ['МКУ "ЦЭР"'],
    };
    for (const [dept, names] of Object.entries(live)) {
      const fallback = SUBORDINATES_FALLBACK[dept] ?? [];
      for (const name of names) expect(fallback, `${dept}: ${name}`).toContain(name);
      const merged = mergeSubordinates({ [dept]: fallback }, { [dept]: names })[dept];
      expect(merged).toHaveLength(fallback.length);
    }
    expect(SUBORDINATES_FALLBACK['УО']).toHaveLength(46);
    expect(SUBORDINATES_FALLBACK['УКСиМП']).toHaveLength(21);
  });

  it('историческое имя и текущее R→E равны по явно проверенному алиасу, не по нестрогому сходству', () => {
    const cases: [string, string, string][] = [
      ['УО', 'МАДОУ ДС № 1 «Ласточка»', 'МАДОУ "Детский сад № 1 "Ласточка"'],
      ['УКСиМП', 'МБУ ДО «КДМШ»', 'МБУ ДО КДМШ'],
      ['УКСиМП', 'МБУК «Елизовский районный зоопарк»', 'МБУК ЕРЗ'],
      ['УД', 'МКУ «ЕДДС»', 'МКУ "ЕДДС ЕМР"'],
      ['УАГЗО', 'МКУ «Елизовское РУС»', 'МКУ "Елизовское РУС"'],
    ];
    for (const [dept, historical, current] of cases) {
      const merged = mergeSubordinates(
        { [dept]: [current] }, { [dept]: [historical, current] },
      )[dept];
      expect(merged, dept).toHaveLength(1);
      expect(merged[0], dept).toBe(current);
    }
    // МАДОУ и МБДОУ не эквивалентны — запрещено объединять разные ОПФ.
    const distinctLegalForms = mergeSubordinates(
      { 'УО': ['МАДОУ "Детский сад № 1 "Ласточка"'] },
      { 'УО': ['МБДОУ ДС № 1 «Ласточка»'] },
    );
    expect(distinctLegalForms['УО']).toHaveLength(2);

    const distinct = mergeSubordinates(
      { 'УКСиМП': ['МБУ ДО КДМШ'] },
      { 'УКСиМП': ['МБУ ДО РДМШ'] },
    );
    expect(distinct['УКСиМП']).toHaveLength(2);
  });
});
