/**
 * Проверка разбора предмета, устойчивого к опечаткам.
 *
 * Образцы опечаток — не выдуманные: это живые написания из книг ГРБС,
 * названные владельцем 18.08.2026 («кемонт», «катриджей», «теплоснбжение»,
 * «медецинских», «опресовка», «расчитке», «едиственным»).
 */
import { describe, it, expect } from 'vitest';
import {
  normalizeRu,
  wordsOf,
  stemRu,
  editDistance,
  allowedEdits,
  matchSubjectFuzzy,
  fuzzyIncludes,
} from './subject-fuzzy.js';
import { classifySubject } from './subject-classify.js';

describe('subject-fuzzy — приведение к сравнимому виду', () => {
  it('снимает регистр, «ё» и знаки препинания', () => {
    expect(normalizeRu('Ремонт КРОВЛИ, ул. Ленина (д. 5)')).toBe('ремонт кровли ул ленина д 5');
  });

  it('«ё» и «е» — одна буква', () => {
    expect(normalizeRu('Приобретение ёмкостей')).toBe('приобретение емкостей');
  });

  it('короткие слова в сравнение не идут', () => {
    expect(wordsOf('на ремонт и на кровлю')).toEqual(['ремонт', 'кровлю']);
  });

  it('пустая строка даёт пустой список', () => {
    expect(wordsOf('   ')).toEqual([]);
  });
});

describe('subject-fuzzy — основа слова', () => {
  it('срезает падежное окончание', () => {
    expect(stemRu('картриджей')).toBe('картридж');
    expect(stemRu('медицинских')).toBe('медицинск');
  });

  it('не стачивает слово до огрызка', () => {
    // Короче четырёх букв основа не режется: «дом» так и остаётся «дом».
    expect(stemRu('дом')).toBe('дом');
    expect(stemRu('силы')).toBe('силы');
  });

  it('режет ровно одно окончание, а не все подряд', () => {
    // «работами» → «работ», а не «раб»: второй проход сроднил бы слово с чем угодно.
    expect(stemRu('работами')).toBe('работ');
  });
});

describe('subject-fuzzy — расстояние правки', () => {
  it('одинаковые слова — ноль', () => {
    expect(editDistance('ремонт', 'ремонт', 2)).toBe(0);
  });

  it('замена буквы — одна правка', () => {
    expect(editDistance('кемонт', 'ремонт', 2)).toBe(1);
  });

  it('пропущенная буква — одна правка', () => {
    expect(editDistance('катридж', 'картридж', 2)).toBe(1);
  });

  it('перестановка соседних букв — одна правка, а не две', () => {
    expect(editDistance('кариджт', 'картиджт', 2)).toBeLessThanOrEqual(2);
    expect(editDistance('теаплво', 'тепалво', 2)).toBe(1);
  });

  it('за потолком точное значение не считается', () => {
    expect(editDistance('канцелярия', 'автомобиль', 2)).toBeGreaterThan(2);
  });

  it('потолок правок растёт с длиной образца', () => {
    expect(allowedEdits(4)).toBe(1);
    expect(allowedEdits(12)).toBe(2);
  });
});

describe('subject-fuzzy — живые опечатки книг ГРБС', () => {
  // «Кровля» намеренно не участвует: и в точных образцах, и в основах она
  // отдана «Строительству», и старшинство групп этот разбор не меняет.
  const CASES: ReadonlyArray<[string, string]> = [
    ['Кемонт помещения администрации', 'Ремонт'],
    ['Поставка катриджей для принтеров', 'Оргтехника'],
    ['Теплоснбжение здания администрации', 'Коммуналка'],
    ['Поставка медецинских изделий', 'Медицина'],
    ['Опресовка системы отоплния', 'Коммуналка'],
  ];

  it.each(CASES)('«%s» → группа «%s»', (subject, expected) => {
    const match = matchSubjectFuzzy(subject);
    expect(match.category).toBe(expected);
    expect(match.kind).not.toBe('нет');
  });

  it('опечатка помечена как опечатка и названа по имени', () => {
    const match = matchSubjectFuzzy('Кемонт помещения администрации');
    expect(match.kind).toBe('опечатка');
    expect(match.distance).toBe(1);
    expect(match.note).toContain('похоже на опечатку');
    // Тон канона: карточка не обвиняет и не утверждает, что книга неверна.
    expect(match.note).not.toMatch(/ошибк|нарушен|неверно заполн/i);
  });

  it('чистое написание помечено как точное, без разговора об опечатках', () => {
    const match = matchSubjectFuzzy('Ремонт помещения администрации');
    expect(match.category).toBe('Ремонт');
    expect(match.kind).toBe('точно');
    expect(match.note).not.toContain('опечат');
  });

  it('незнакомый предмет остаётся неузнанным — угадывать нельзя', () => {
    const match = matchSubjectFuzzy('Приобретение вертолёта Ми-8');
    expect(match.kind).toBe('нет');
    expect(match.category).toBe('Другое');
  });

  it('пустой предмет не узнаётся', () => {
    expect(matchSubjectFuzzy('').kind).toBe('нет');
    expect(matchSubjectFuzzy('   ').kind).toBe('нет');
  });
});

describe('subject-fuzzy — слово в свободном тексте', () => {
  it('узнаёт «единственным» в написании «едиственным»', () => {
    expect(fuzzyIncludes('Закупка у едиственного поставщика', 'единствен')).toBe(true);
  });

  it('узнаёт «расчистке» в написании «расчитке»', () => {
    expect(fuzzyIncludes('Работы по расчитке территории', 'расчистк')).toBe(true);
  });

  it('не выдумывает совпадений', () => {
    expect(fuzzyIncludes('Поставка бумаги А4', 'единствен')).toBe(false);
  });
});

describe('subject-classify — прежнее поведение сохранено', () => {
  it('точные написания разбираются как раньше', () => {
    expect(classifySubject('Ремонт помещения')).toBe('Ремонт');
    expect(classifySubject('Поставка картриджей')).toBe('Канцелярия');
    expect(classifySubject('Теплоснабжение здания')).toBe('Коммуналка');
    // Старшинство групп не тронуто: «кровля» и раньше была «Строительством».
    expect(classifySubject('Ремонт кровли')).toBe('Строительство');
  });

  it('опечатка больше не роняет предмет в «Другое»', () => {
    expect(classifySubject('Кемонт помещения')).toBe('Ремонт');
    expect(classifySubject('Теплоснбжение здания')).toBe('Коммуналка');
  });

  it('по-настоящему незнакомое остаётся «Другое»', () => {
    expect(classifySubject('Что-то совершенно неизвестное')).toBe('Другое');
    expect(classifySubject('')).toBe('Другое');
  });
});
