/**
 * Детекторы гигиены текста — канон п.98д (пакет поручений 18.08.2026) + п.95/55.
 *
 * Проверяется главное обещание модуля: находка несёт не диагноз, а ГОТОВОЕ
 * значение ячейки, которое оператор копирует и вставляет целиком. Отдельно
 * закреплены границы осторожности из постановки: маркеры отсутствия «X/х»,
 * десятичная запятая, инициалы через точку и цельно-латинские слова молчат.
 */
import { describe, it, expect } from 'vitest';
import {
  detectCellHygiene,
  detectSubordinateNameHygiene,
  hygieneFix,
  boundedLevenshtein,
  nearestCanonicalSubordinate,
  REGISTRY_DISTANCE_MAX,
  type TextHygieneKind,
} from './text-hygiene.js';

const NBSP = ' ';
const ZWSP = '​';

function kinds(findings: { kind: TextHygieneKind }[]): TextHygieneKind[] {
  return findings.map((f) => f.kind);
}

describe('детектор 1 — двойные и более пробелы', () => {
  it('двойной пробел найден, исправление — один пробел', () => {
    const [f] = detectCellHygiene('Поставка  бумаги');
    expect(f.kind).toBe('double_space');
    expect(f.fix).toBe('Поставка бумаги');
  });

  it('три пробела сводятся к одному', () => {
    expect(hygieneFix('Ремонт   кровли')).toBe('Ремонт кровли');
  });

  it('одиночные пробелы молчат', () => {
    expect(detectCellHygiene('Поставка бумаги для нужд учреждения')).toEqual([]);
  });
});

describe('детектор 2 — пробел не с той стороны знака препинания', () => {
  it('пробел перед запятой убирается', () => {
    const [f] = detectCellHygiene('Бумага , картриджи');
    expect(f.kind).toBe('space_before_punct');
    expect(f.fix).toBe('Бумага, картриджи');
  });

  it('нет пробела после запятой — пробел добавляется', () => {
    const [f] = detectCellHygiene('Бумага,картриджи');
    expect(f.kind).toBe('missing_space_after_punct');
    expect(f.fix).toBe('Бумага, картриджи');
  });

  it('нет пробела после двоеточия — пробел добавляется', () => {
    const [f] = detectCellHygiene('Предмет:поставка мебели');
    expect(f.kind).toBe('missing_space_after_punct');
    expect(f.fix).toBe('Предмет: поставка мебели');
  });

  it('десятичная запятая не трогается — «1,5 тонны» это не дефект', () => {
    expect(detectCellHygiene('Поставка 1,5 тонны угля')).toEqual([]);
    expect(hygieneFix('Поставка 1,5 тонны угля')).toBe('Поставка 1,5 тонны угля');
  });

  it('инициалы и ссылки на статьи через точку молчат (так в самом справочнике)', () => {
    expect(detectCellHygiene('МБОУ «Елизовская средняя школа №1 имени М.В.Ломоносова»')).toEqual([]);
    expect(detectCellHygiene('Закупка по п.4 ст.93 44-ФЗ')).toEqual([]);
  });
});

describe('детектор 3 — невидимые символы', () => {
  it('неразрывный пробел внутри текста найден и заменён обычным', () => {
    const found = detectCellHygiene(`Поставка${NBSP}бумаги`);
    expect(kinds(found)).toContain('invisible_char');
    expect(found[0].label).toContain('неразрывный пробел');
    expect(found[0].fix).toBe('Поставка бумаги');
  });

  it('символ нулевой ширины найден и удалён', () => {
    const found = detectCellHygiene(`Ремонт${ZWSP} кровли`);
    expect(kinds(found)).toContain('invisible_char');
    expect(found[0].fix).toBe('Ремонт кровли');
  });

  it('табуляция внутри текста найдена и заменена пробелом', () => {
    const found = detectCellHygiene('Поставка\tмебели');
    expect(kinds(found)).toContain('invisible_char');
    expect(found.find((f) => f.kind === 'invisible_char')!.label).toContain('табуляция');
    expect(found[0].fix).toBe('Поставка мебели');
  });

  it('вырезка показывает невидимый символ явно — иначе оператор его не увидит', () => {
    const [f] = detectCellHygiene(`Поставка${NBSP}бумаги`);
    expect(f.excerpt).toContain('␣');
  });
});

describe('детектор 4 — ведущие и замыкающие пробелы', () => {
  it('замыкающий пробел найден, исправление обрезано', () => {
    const [f] = detectCellHygiene('Опрессовка системы ');
    expect(f.kind).toBe('edge_space');
    expect(f.fix).toBe('Опрессовка системы');
  });

  it('ведущий пробел найден', () => {
    const found = detectCellHygiene(' Опрессовка системы');
    expect(kinds(found)).toContain('edge_space');
    expect(found[0].fix).toBe('Опрессовка системы');
  });
});

describe('детектор 5 — смешение латиницы и кириллицы в слове', () => {
  it('латинская B в «ЛBС» найдена, исправление — кириллическое имя', () => {
    const found = detectCellHygiene('МБУ ДО СШОР по ЛBС');
    const mixed = found.find((f) => f.kind === 'mixed_alphabet');
    expect(mixed).toBeDefined();
    expect(mixed!.label).toContain('латинские буквы');
    expect(mixed!.fix).toBe('МБУ ДО СШОР по ЛВС');
  });

  it('цельно-латинское слово не трогается — Windows это не дефект', () => {
    expect(detectCellHygiene('Поставка лицензий Windows')).toEqual([]);
  });

  it('цельно-кириллическое слово не трогается', () => {
    expect(detectCellHygiene('Поставка канцелярских товаров')).toEqual([]);
  });

  it('слово преимущественно латинское чинится в латиницу', () => {
    expect(hygieneFix('Мicrosoft')).toBe('Microsoft');
  });
});

describe('маркеры отсутствия и не-текст — молчание (канон п.62, isAbsentCell)', () => {
  it('«х»-маркеры любого алфавита и регистра не трогаются', () => {
    for (const marker of ['X', 'x', 'Х', 'х', '-', '—', ' х ']) {
      expect(detectCellHygiene(marker), marker).toEqual([]);
      expect(detectSubordinateNameHygiene(marker), marker).toEqual([]);
    }
  });

  it('пустая ячейка, число и null молчат', () => {
    expect(detectCellHygiene('')).toEqual([]);
    expect(detectCellHygiene(100)).toEqual([]);
    expect(detectCellHygiene(null)).toEqual([]);
    expect(detectCellHygiene(undefined)).toEqual([]);
  });
});

describe('несколько дефектов в одной ячейке — один общий fix', () => {
  it('вставка любой находки закрывает все дефекты ячейки сразу', () => {
    const found = detectCellHygiene(` Бумага ,${NBSP}картриджи  и  ЛBС `);
    expect(found.length).toBeGreaterThan(3);
    const fixes = new Set(found.map((f) => f.fix));
    expect(fixes.size).toBe(1);
    expect([...fixes][0]).toBe('Бумага, картриджи и ЛВС');
  });
});

describe('расстояние Левенштейна с потолком', () => {
  it('равные строки — ноль, одна правка — единица', () => {
    expect(boundedLevenshtein('ЛВС', 'ЛВС', 2)).toBe(0);
    expect(boundedLevenshtein('ЛВС', 'ЛBС', 2)).toBe(1);
  });

  it('за потолком — null, а не большое число', () => {
    expect(boundedLevenshtein('ЕДМШ', 'совершенно другое имя', 2)).toBeNull();
    expect(REGISTRY_DISTANCE_MAX).toBe(2);
  });
});

describe('детектор 6 — отступление имени подведа от справочника', () => {
  it('живой кейс «Жар-Птица»: № без пробела → канон справочника целиком', () => {
    const [f] = detectSubordinateNameHygiene('МБДОУ ДС №3 «Жар-Птица»');
    expect(f.kind).toBe('registry_mismatch');
    expect(f.fix).toBe('МБДОУ ДС № 3 «Жар-Птица»');
  });

  it('тот же кейс с кавычками-лапками: нормализация кавычек не мешает найти канон', () => {
    const [f] = detectSubordinateNameHygiene('МБДОУ ДС №3 „Жар-Птица“');
    expect(f.kind).toBe('registry_mismatch');
    expect(f.fix).toBe('МБДОУ ДС № 3 «Жар-Птица»');
  });

  it('латинская B в «СШОР по ЛBС» правится дословным именем справочника', () => {
    const [f] = detectSubordinateNameHygiene('МБУ ДО СШОР по ЛBС');
    expect(f.kind).toBe('registry_mismatch');
    expect(f.fix).toBe('МБУ ДО СШОР по ЛВС');
  });

  it('дословное имя справочника молчит — вид кавычек и «№» правит владелец, не сигнал', () => {
    expect(detectSubordinateNameHygiene('МБДОУ ДС № 3 «Жар-Птица»')).toEqual([]);
    expect(detectSubordinateNameHygiene('МБУ ДО "КДМШ"')).toEqual([]);
    expect(detectSubordinateNameHygiene('МБУ ДО СШОР ЕДИНОБОРСТВ "КРЕЧЕТ"')).toEqual([]);
  });

  it('каноничное имя с краевым пробелом — только обрезка, имя не переписывается', () => {
    const [f] = detectSubordinateNameHygiene(' МБДОУ ДС № 3 «Жар-Птица» ');
    expect(f.kind).toBe('edge_space');
    expect(f.fix).toBe('МБДОУ ДС № 3 «Жар-Птица»');
  });

  it('имя вне справочника и вне потолка не подменяется — только механика', () => {
    const found = detectSubordinateNameHygiene('ООО  «Подрядчик»');
    expect(kinds(found)).toEqual(['double_space']);
    expect(found[0].fix).toBe('ООО «Подрядчик»');
  });

  it('двусмысленность молчит: два канона на одном расстоянии — угадывать нельзя', () => {
    // «ЕДМШ» и «ЕДХШ» различаются одной буквой: у «ЕДШ» оба канона в одном шаге.
    expect(nearestCanonicalSubordinate('МБУ ДО «ЕДШ»')).toBeNull();
    expect(detectSubordinateNameHygiene('МБУ ДО «ЕДШ»')).toEqual([]);
  });

  it('nearestCanonicalSubordinate на каноничном имени возвращает null (нет находки)', () => {
    expect(nearestCanonicalSubordinate('МБУ ДО «ЕДМШ»')).toBeNull();
  });
});
