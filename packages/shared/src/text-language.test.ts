/**
 * Проверка русского языка — орфография и пунктуация (продолжение п.98д).
 *
 * Живые опечатки в этом файле взяты из книг закупок, а не выдуманы: операторы
 * набирают предмет и обоснование руками, и «кемонт» вместо «ремонт» —
 * настоящая строка. Ровно они и закреплены как обязательные к обнаружению.
 *
 * Вторая половина файла — обещание МОЛЧАНИЯ. Оно важнее находок: сигнал,
 * который кричит на «проведении» против «проведения», перестают читать.
 */
import { describe, it, expect } from 'vitest';
import {
  detectLanguageIssues,
  languageFix,
  suggestFromCorpus,
  differsOnlyInEnding,
  normalizeWord,
  collectWords,
  SPELL_MIN_LENGTH,
  type LanguageFinding,
} from './text-language.js';
import {
  CORPUS_CORE_WORDS,
  CORPUS_COMMON_WORDS,
  CORPUS_PROTECTED_WORDS,
  CORPUS_REJECTED_WORDS,
} from './dictionaries/corpus-words.js';

function spelling(findings: LanguageFinding[]): LanguageFinding[] {
  return findings.filter((f) => f.kind === 'spelling');
}

// ────────────────────────────────────────────────────────────
// 1. Живые опечатки из книг
// ────────────────────────────────────────────────────────────

describe('орфография — живые опечатки из книг закупок', () => {
  const LIVE: Array<[string, string]> = [
    ['кемонт', 'ремонт'],
    ['катриджей', 'картриджей'],
    ['закпки', 'закупки'],
    ['техниескому', 'техническому'],
    ['предосталению', 'предоставлению'],
    ['теплоснбжение', 'теплоснабжение'],
    ['медецинских', 'медицинских'],
    ['укремпления', 'укрепления'],
    ['хоолодное', 'холодное'],
    ['расчитке', 'расчистке'],
    ['едиственным', 'единственным'],
    ['опресовка', 'опрессовка'],
    ['подарной', 'пожарной'],
  ];

  for (const [wrong, right] of LIVE) {
    it(`«${wrong}» опознаётся как «${right}»`, () => {
      const s = suggestFromCorpus(wrong);
      expect(s?.word).toBe(right);
    });
  }

  it('опечатка внутри живой строки даёт карточку с готовым значением ячейки', () => {
    const raw = 'Кемонт кровли здания';
    const [f] = spelling(detectLanguageIssues(raw));
    expect(f.kind).toBe('spelling');
    expect(f.label).toContain('Кемонт');
    expect(f.fix).toBe('Ремонт кровли здания');
    expect(f.explanation).toContain('Ремонт');
  });

  it('заглавная буква исходного слова сохраняется в исправлении', () => {
    expect(languageFix('Катриджей для принтера')).toBe('Картриджей для принтера');
    expect(languageFix('поставка катриджей')).toBe('поставка картриджей');
  });

  it('две опечатки в одной ячейке закрываются одной вставкой', () => {
    expect(languageFix('Кемонт и опресовка системы')).toBe('Ремонт и опрессовка системы');
  });

  it('уверенность у частого соседа — высокая', () => {
    expect(suggestFromCorpus('кемонт')?.confidence).toBe('высокая');
  });
});

// ────────────────────────────────────────────────────────────
// 2. Отсев словоформ — главное обещание молчания
// ────────────────────────────────────────────────────────────

describe('отсев словоформ — падеж и число не опечатка', () => {
  const FORMS = [
    'проведении', 'проведение', 'аукционе', 'закупка', 'закупке',
    'услугами', 'оказании', 'поставке', 'системах', 'обеспечением',
    'учреждении', 'муниципальном', 'елизовском', 'районах', 'обслуживании',
    'документацией', 'помещениях', 'котельная',
  ];

  for (const form of FORMS) {
    it(`«${form}» молчит — это словоформа, а не опечатка`, () => {
      expect(suggestFromCorpus(form)).toBeNull();
      expect(spelling(detectLanguageIssues(form))).toEqual([]);
    });
  }

  it('«проведении» против «проведения» — различие только в окончании', () => {
    expect(differsOnlyInEnding('проведении', 'проведения')).toBe(true);
  });

  it('«кемонт» против «ремонт» — различие НЕ в окончании', () => {
    expect(differsOnlyInEnding('кемонт', 'ремонт')).toBe(false);
  });

  it('различие в предпоследней букве тоже считается окончанием', () => {
    expect(differsOnlyInEnding('услуги', 'услугам')).toBe(true);
  });

  it('целая фраза из словоформ не даёт ни одной находки орфографии', () => {
    const raw = 'Оказание услуг по проведению аукциона в электронной форме';
    expect(spelling(detectLanguageIssues(raw))).toEqual([]);
  });
});

// ────────────────────────────────────────────────────────────
// 2б. Законная лексика, которой нет в корпусе района
// ────────────────────────────────────────────────────────────

describe('законные слова вне корпуса — проверка на них не ругается', () => {
  // Все до одного взяты из прогона по живым книгам: на каждом проверка
  // ошибочно предлагала частого двойника («подставка» → «поставка»).
  const LEGIT = [
    'подставка', 'знаний', 'повара', 'приведение', 'представлению',
    'значков', 'форума', 'заключить', 'показывает', 'приводит',
    'закупается', 'законном', 'объеме', 'мороженой', 'конкурентную',
  ];

  for (const word of LEGIT) {
    it(`«${word}» молчит — это законное слово, а не опечатка`, () => {
      expect(suggestFromCorpus(word)).toBeNull();
    });
  }

  it('«Всвязи» молчит: подсказка «Связи» испортила бы ячейку сильнее', () => {
    expect(suggestFromCorpus('всвязи')).toBeNull();
  });
});

describe('гигиена самого словаря', () => {
  it('опечатки, перешагнувшие порог частоты, вычтены из словаря', () => {
    // «Приобритение» встретилось 6 раз и попало в машинный список; без
    // вычитания оно узаконило бы само себя и молчало.
    for (const [wrong, right] of [
      ['приобритение', 'приобретение'],
      ['продцедура', 'процедура'],
      ['обьеме', 'объеме'],
      ['конкурентую', 'конкурентную'],
      ['мороженной', 'мороженой'],
    ] as const) {
      expect(suggestFromCorpus(wrong)?.word).toBe(right);
    }
  });

  it('каждое вычтенное слово и вправду есть в машинных списках', () => {
    // Страж от гниения: если словарь пересоберут и слово исчезнет само,
    // строка в списке вычитания станет ложью — тест это поймает.
    const machine = new Set([...CORPUS_CORE_WORDS, ...CORPUS_COMMON_WORDS]);
    for (const w of CORPUS_REJECTED_WORDS) expect(machine.has(w)).toBe(true);
  });

  it('ручные списки не пересекаются с вычтенными', () => {
    const rejected = new Set<string>(CORPUS_REJECTED_WORDS);
    for (const w of CORPUS_PROTECTED_WORDS) expect(rejected.has(w)).toBe(false);
  });
});

// ────────────────────────────────────────────────────────────
// 3. Прочие правила молчания
// ────────────────────────────────────────────────────────────

describe('правила молчания', () => {
  it('слово короче порога не проверяется', () => {
    expect(SPELL_MIN_LENGTH).toBe(6);
    expect(suggestFromCorpus('вода')).toBeNull();
    expect(suggestFromCorpus('годы')).toBeNull();
  });

  it('аббревиатура заглавными не проверяется', () => {
    expect(collectWords('НМЦК и ОКПД2 и ЕИС')).toEqual([]);
    expect(spelling(detectLanguageIssues('Определение НМЦК'))).toEqual([]);
  });

  it('обозначение с цифрами и дефисом не проверяется', () => {
    expect(collectWords('44-ФЗ')).toEqual([]);
    expect(collectWords('ГОСТ 12.4.011-89')).toEqual([]);
  });

  it('двусмысленность — молчание: соседей больше одного', () => {
    // «водоснабжени» одинаково близко к «водоснабжение» и «водоснабжения»,
    // но оба отличаются только окончанием — предлагать нечего.
    expect(suggestFromCorpus('водоснабжени')).toBeNull();
  });

  it('маркер отсутствия «X» и пустая ячейка молчат (канон п.62)', () => {
    expect(detectLanguageIssues('X')).toEqual([]);
    expect(detectLanguageIssues('х')).toEqual([]);
    expect(detectLanguageIssues('')).toEqual([]);
  });

  it('нетекст молчит', () => {
    expect(detectLanguageIssues(42)).toEqual([]);
    expect(detectLanguageIssues(null)).toEqual([]);
    expect(detectLanguageIssues(undefined)).toEqual([]);
  });

  it('«ё» и «е» — одно слово, а не опечатка', () => {
    expect(normalizeWord('Ёлочные')).toBe('елочные');
    expect(suggestFromCorpus('Ремонт')).toBeNull();
  });

  it('чистая строка не даёт находок вовсе', () => {
    expect(detectLanguageIssues('Поставка бумаги для нужд учреждения')).toEqual([]);
  });
});

// ────────────────────────────────────────────────────────────
// 4. Пунктуация
// ────────────────────────────────────────────────────────────

describe('пунктуация — двойные знаки', () => {
  it('две запятые подряд — высокая уверенность', () => {
    const [f] = detectLanguageIssues('Бумага,, картриджи');
    expect(f.kind).toBe('double_punct');
    expect(f.confidence).toBe('высокая');
    expect(f.fix).toBe('Бумага, картриджи');
  });

  it('две точки подряд — средняя уверенность', () => {
    const [f] = detectLanguageIssues('Поставка мебели.. в кабинет');
    expect(f.kind).toBe('double_punct');
    expect(f.confidence).toBe('средняя');
    expect(f.fix).toBe('Поставка мебели. в кабинет');
  });

  it('многоточие не трогается', () => {
    expect(detectLanguageIssues('Работы по объекту...')).toEqual([]);
  });
});

describe('пунктуация — скобки и кавычки', () => {
  it('незакрытая скобка — скобка дописывается в конец', () => {
    const [f] = detectLanguageIssues('Поставка бумаги (формат А4');
    expect(f.kind).toBe('unpaired_bracket');
    expect(f.fix).toBe('Поставка бумаги (формат А4)');
  });

  it('лишняя закрывающая скобка убирается', () => {
    const [f] = detectLanguageIssues('Поставка бумаги) формат А4');
    expect(f.kind).toBe('unpaired_bracket');
    expect(f.fix).toBe('Поставка бумаги формат А4');
  });

  it('парные скобки молчат', () => {
    expect(detectLanguageIssues('Поставка бумаги (формат А4)')).toEqual([]);
  });

  it('незакрытая ёлочка — кавычка дописывается', () => {
    const [f] = detectLanguageIssues('Услуги для МБУК «Лидер');
    expect(f.kind).toBe('unpaired_quote');
    expect(f.fix).toBe('Услуги для МБУК «Лидер»');
  });

  it('прямые кавычки заменяются на ёлочки', () => {
    const [f] = detectLanguageIssues('Услуги для МБУК "Лидер"');
    expect(f.kind).toBe('straight_quotes');
    expect(f.confidence).toBe('средняя');
    expect(f.fix).toBe('Услуги для МБУК «Лидер»');
  });

  it('одиночная прямая кавычка — непарность', () => {
    const kinds = detectLanguageIssues('Услуги для МБУК "Лидер').map((f) => f.kind);
    expect(kinds).toContain('unpaired_quote');
  });

  it('повисшая кавычка в конце строки убирается', () => {
    // Живой случай книги УО: «Фрукты и овощи"» — хвост от копирования.
    const [f] = detectLanguageIssues('Фрукты и овощи"');
    expect(f.kind).toBe('unpaired_quote');
    expect(f.fix).toBe('Фрукты и овощи');
  });

  it('открытая кавычка внутри строки закрывается в конце', () => {
    const [f] = detectLanguageIssues('Права использования системы "Saby ЭО');
    expect(f.fix).toBe('Права использования системы «Saby ЭО»');
  });
});

describe('пунктуация — дефис вместо тире', () => {
  it('промежуток годов — высокая уверенность', () => {
    const [f] = detectLanguageIssues('Работы на 2024-2025 годы');
    expect(f.kind).toBe('hyphen_between_numbers');
    expect(f.confidence).toBe('высокая');
    expect(f.fix).toBe('Работы на 2024–2025 годы');
  });

  it('обозначение по закону не трогается', () => {
    expect(detectLanguageIssues('Закупка по п.4 ч.1 ст.93 44-ФЗ')).toEqual([]);
  });

  it('номер стандарта не трогается', () => {
    expect(detectLanguageIssues('Средства защиты по ГОСТ 12.4.011-89')).toEqual([]);
  });

  it('убывающая пара — не промежуток, молчание', () => {
    expect(detectLanguageIssues('Договор 45-12 на поставку')).toEqual([]);
  });

  it('номер процедуры со знаком номера не трогается', () => {
    // Живой случай книги УО: «ЭА № ЭА 11-26» — это номер аукциона, а не
    // промежуток. Знак номера отменяет находку даже через сокращение.
    const raw = 'Расторжение по ЭА № ЭА 11-26 от 04.08.2026';
    expect(detectLanguageIssues(raw)).toEqual([]);
  });

  it('число, слипшееся с буквой, не промежуток', () => {
    // «1-4кв» — сокращённая запись кварталов, а не набор промежутка.
    expect(detectLanguageIssues('1-4кв Цыпленок-бройлер')).toEqual([]);
  });
});

describe('пунктуация — точка в конце наименования', () => {
  it('точка в конце убирается — но только у наименования', () => {
    const [f] = detectLanguageIssues('Поставка канцелярских товаров.', 'наименование');
    expect(f.kind).toBe('trailing_period');
    expect(f.confidence).toBe('средняя');
    expect(f.fix).toBe('Поставка канцелярских товаров');
  });

  it('в обосновании точка законна — молчание по умолчанию', () => {
    expect(detectLanguageIssues('Заключение с ЕП по наименьшей цене.')).toEqual([]);
  });

  it('связный текст из нескольких предложений не трогается', () => {
    const raw = 'Ремонт кровли. Замена покрытия по смете.';
    expect(detectLanguageIssues(raw, 'наименование')).toEqual([]);
  });

  it('сокращение с точкой не считается концом наименования', () => {
    expect(detectLanguageIssues('Поставка бумаги и т.д.', 'наименование')).toEqual([]);
  });

  it('оборванное слово с точкой не трогается: «Охрана лиценз.»', () => {
    // Живой случай книги УО: «лиценз.» — обрыв «лицензированная», точка там
    // не лишняя. Хвост вне словаря — молчим.
    expect(detectLanguageIssues('Охрана лиценз.', 'наименование')).toEqual([]);
  });

  it('наименование без точки молчит', () => {
    expect(detectLanguageIssues('Поставка канцелярских товаров', 'наименование')).toEqual([]);
  });
});

// ────────────────────────────────────────────────────────────
// 5. Обещания карточки
// ────────────────────────────────────────────────────────────

describe('карточка находки', () => {
  it('низкой уверенности в выдаче нет вовсе', () => {
    const all = [
      ...detectLanguageIssues('Кемонт кровли'),
      ...detectLanguageIssues('Бумага,, картриджи'),
      ...detectLanguageIssues('Работы на 2024-2025 годы'),
    ];
    expect(all.length).toBeGreaterThan(0);
    for (const f of all) expect(['высокая', 'средняя']).toContain(f.confidence);
  });

  it('находки идут от высокой уверенности к средней', () => {
    const fs = detectLanguageIssues('Кемонт кровли на 2024-2025 годы.', 'наименование');
    const order = fs.map((f) => f.confidence);
    expect(order.indexOf('высокая')).toBeLessThan(order.lastIndexOf('средняя'));
  });

  it('карточка высокой уверенности не тащит за собой догадку средней', () => {
    const fs = detectLanguageIssues('Кемонт кровли.', 'наименование');
    const high = fs.find((f) => f.confidence === 'высокая');
    const mid = fs.find((f) => f.confidence === 'средняя');
    // Высокая правит только опечатку, точку в конце оставляет человеку.
    expect(high?.fix).toBe('Ремонт кровли.');
    expect(mid?.fix).toBe('Ремонт кровли');
  });

  it('исправление закрывает и механическую гигиену разом', () => {
    expect(languageFix('Кемонт  кровли ,  здания')).toBe('Ремонт кровли, здания');
  });

  it('готовое значение всегда отличается от исходного', () => {
    // Карточка «вставьте то же самое» — не действие, а издевательство (п.53).
    const cells = [
      'Фрукты и овощи"', 'Кемонт кровли', 'Бумага,, картриджи',
      'Поставка бумаги (формат А4', 'Работы на 2024-2025 годы',
      'Поставка канцелярских товаров.', 'Услуги для МБУК "Лидер"',
    ];
    for (const raw of cells) {
      for (const f of detectLanguageIssues(raw, 'наименование')) {
        expect(f.fix).not.toBe(raw);
      }
    }
  });

  it('у каждой находки есть адрес внутри ячейки и объяснение по-русски', () => {
    for (const f of detectLanguageIssues('Поставка катриджей для принтера.')) {
      expect(f.excerpt.length).toBeGreaterThan(0);
      expect(f.explanation.length).toBeGreaterThan(20);
      expect(f.label).not.toMatch(/[A-Za-z]/);
    }
  });
});
