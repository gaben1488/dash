/**
 * Тесты структурного парсера номера процедуры (канон п.74, 14.08.2026).
 * Все примеры — живые значения из дампа comments-full.jsonl (книги ГРБС,
 * снято с прода 14.08.2026) и спеки мониторинга
 * docs/superpowers/specs/2026-08-14-daily-monitoring-tab.md.
 */
import { describe, it, expect } from 'vitest';
import {
  parseProcedureRef,
  extractProcedureRefs,
  detectForeignText, explainDistortedCode,} from './procedure-ref.js';

describe('parseProcedureRef — строгий разбор ячейки AG', () => {
  it('разбирает канонические коды всех четырёх семейств (живые ячейки)', () => {
    // УЭР r30, УЭР r5, УЭР r23, УЭР r42 из дампа
    expect(parseProcedureRef('ЭА152-26')).toEqual({ code: 'ЭА152-26', family: 'ЭА', n: 152, yy: 26, lot: null });
    expect(parseProcedureRef('ЭЗК426-25')).toEqual({ code: 'ЭЗК426-25', family: 'ЭЗК', n: 426, yy: 25, lot: null });
    expect(parseProcedureRef('ЭЕП113-26')).toEqual({ code: 'ЭЕП113-26', family: 'ЭЕП', n: 113, yy: 26, lot: null });
    expect(parseProcedureRef('ЭАС258-26')).toEqual({ code: 'ЭАС258-26', family: 'ЭАС', n: 258, yy: 26, lot: null });
  });

  it('терпит пробелы внутри и вокруг кода (живая ячейка УЭР r33 «ЭЕП 180-26»)', () => {
    expect(parseProcedureRef('ЭЕП 180-26')?.code).toBe('ЭЕП180-26');
    expect(parseProcedureRef('  ЭА152-26  ')?.code).toBe('ЭА152-26');
    expect(parseProcedureRef('ЭА 152 - 26')?.code).toBe('ЭА152-26');
  });

  it('терпит регистр и латинские омоглифы А/Е/К/С', () => {
    expect(parseProcedureRef('эа152-26')?.code).toBe('ЭА152-26');
    expect(parseProcedureRef('Эзк426-25')?.code).toBe('ЭЗК426-25');
    // латинские A, C, E, K вместо кириллических
    expect(parseProcedureRef('ЭA152-26')?.code).toBe('ЭА152-26'); // латинская A
    expect(parseProcedureRef('ЭАС258-26')?.code).toBe('ЭАС258-26'); // латинская C
  });

  it('канонизирует ведущие нули номера одинаково для обеих сторон моста', () => {
    // «ЭАС06-25» (живой код УО) и гипотетическое «ЭАС6-25» — одна процедура
    expect(parseProcedureRef('ЭАС06-25')?.code).toBe('ЭАС6-25');
    expect(parseProcedureRef('ЭАС6-25')?.code).toBe('ЭАС6-25');
  });

  it('разбирает странный, но формально валидный год (живая ячейка УЭР r26 «ЭЕП110-06»)', () => {
    expect(parseProcedureRef('ЭЕП110-06')).toEqual({ code: 'ЭЕП110-06', family: 'ЭЕП', n: 110, yy: 6, lot: null });
  });

  it('разбирает код лота совместных торгов (п.121, живая ячейка УО r2101)', () => {
    expect(parseProcedureRef('ЭАС205/1-26')).toEqual({
      code: 'ЭАС205/1-26', family: 'ЭАС', n: 205, yy: 26, lot: 1,
    });
    // Лот и базовая процедура — разные ключи; мост к базе — по family+n+yy.
    expect(parseProcedureRef('ЭАС205-26')?.lot).toBeNull();
  });

  it('четыре искажённых кода из спеки мониторинга → null, БЕЗ молчаливой починки', () => {
    // потеря «Э» (УД!20; в книге ГРБС тот же код записан «ЭА427-25»)
    expect(parseProcedureRef('А427-25')).toBeNull();
    // дефис после префикса (УД!53)
    expect(parseProcedureRef('ЭЗК-120-26')).toBeNull();
    // лишняя цифра в годе (УД!62)
    expect(parseProcedureRef('ЭА146-226')).toBeNull();
    // код приклеен к предмету без пробела (УД!106)
    expect(parseProcedureRef('ЭЗК264-26Выполнение работ по благоустройству')).toBeNull();
    // вариант с косой чертой (УО!80, он же живая ячейка книги УО r2101)
  });

  it('семейство ЭК — настоящее (сверка 20.08.2026: «ЭК03-26» ×5 в книгах ГРБС)', () => {
    expect(parseProcedureRef('ЭК03-26')).toEqual({
      code: 'ЭК3-26', family: 'ЭК', n: 3, yy: 26, lot: null,
    });
  });

  it('не признаёт обрезки (живая ячейка УИО r37)', () => {
    expect(parseProcedureRef('ЭЗК 283')).toBeNull(); // нет «-год»
    expect(parseProcedureRef('№ 32615775240')).toBeNull(); // номер ЕИС — не код процедуры
  });

  it('пусто, плейсхолдеры и не-строки → null', () => {
    expect(parseProcedureRef('')).toBeNull();
    expect(parseProcedureRef('Х')).toBeNull();
    expect(parseProcedureRef(null)).toBeNull();
    expect(parseProcedureRef(undefined)).toBeNull();
    expect(parseProcedureRef(42)).toBeNull();
  });

  it('список кодов — НЕ один код: строгая форма возвращает null', () => {
    // живая ячейка УЭР r28
    expect(parseProcedureRef('ЭЕП123-26,ЭЕП124-26,ЭЕП125-26,ЭЕП128-26')).toBeNull();
  });
});

describe('extractProcedureRefs — коды в свободном тексте', () => {
  it('вынимает список кодов из живой ячейки УЭР r21 (с пробелом внутри первого)', () => {
    const refs = extractProcedureRefs('ЭЕП 103-26, ЭЕП104-26, ЭЕП106-26,ЭЕП107-26,ЭЕП108-26');
    expect(refs.map((r) => r.code)).toEqual([
      'ЭЕП103-26', 'ЭЕП104-26', 'ЭЕП106-26', 'ЭЕП107-26', 'ЭЕП108-26',
    ]);
  });

  it('вынимает код из строки мониторинга «код + предмет» (колонка C)', () => {
    const refs = extractProcedureRefs('ЭА152-26 Выполнение работ по ремонту помещений');
    expect(refs.map((r) => r.code)).toEqual(['ЭА152-26']);
  });

  it('НЕ вынимает искажённые коды (граница не даёт откусить или дочинить)', () => {
    expect(extractProcedureRefs('А427-25')).toEqual([]);
    expect(extractProcedureRefs('ЭЗК-120-26')).toEqual([]);
    // нельзя откусить «ЭА146-22» от «ЭА146-226»
    expect(extractProcedureRefs('ЭА146-226')).toEqual([]);
    // нельзя признать приклеенный код
    expect(extractProcedureRefs('ЭЗК264-26Выполнение работ')).toEqual([]);
  });

  it('дедуплицирует по каноническому коду', () => {
    // живая ячейка УД r45: «ЭА160-26 (ЭА141-26)» — два кода, скобки — разделитель
    const refs = extractProcedureRefs('ЭА160-26 (ЭА141-26) ЭА160-26');
    expect(refs.map((r) => r.code)).toEqual(['ЭА160-26', 'ЭА141-26']);
  });
});

describe('detectForeignText — посторонний текст в колонке номера (п.74б)', () => {
  it('чистый код и списки кодов — не посторонний текст', () => {
    expect(detectForeignText('ЭА152-26')).toBeNull();
    expect(detectForeignText('ЭЕП123-26,ЭЕП124-26,ЭЕП125-26,ЭЕП128-26')).toBeNull();
    expect(detectForeignText('ЭА160-26 (ЭА141-26)')).toBeNull();
  });

  it('пусто и плейсхолдеры (канон отсутствия + точка) — не посторонний текст', () => {
    expect(detectForeignText('')).toBeNull();
    expect(detectForeignText(null)).toBeNull();
    expect(detectForeignText('Х')).toBeNull();
    expect(detectForeignText('x')).toBeNull();
    expect(detectForeignText('—')).toBeNull();
    expect(detectForeignText('.')).toBeNull();
  });

  it('текст без кода возвращается целиком (живые ячейки)', () => {
    // УЭР r8, УКСиМП r346, УО r459
    expect(detectForeignText('Не согласны, считаем экономией')).toBe('Не согласны считаем экономией');
    expect(detectForeignText('Отдел ФК и С')).toBe('Отдел ФК и С');
    expect(detectForeignText('проверить порядок сумм')).toBe('проверить порядок сумм');
  });

  it('искажённый код — тоже остаток: парсер его не признал, не чинит молча', () => {
    expect(detectForeignText('ЭЗК 283')).toBe('ЭЗК 283'); // УИО r37
    expect(detectForeignText('ЭК03-26')).toBeNull(); // УАГЗО r10 — валидный конкурс (сверка 20.08)
    expect(detectForeignText('ЭАС205/1-26')).toBeNull(); // УО r2101 — лот валиден (п.121)
  });

  it('код с припиской: остаток — только приписка (живая ячейка УИО r27)', () => {
    expect(detectForeignText('ЭА220-26 не состоялся (заявка 1 , заключили с ед. поставщиком)'))
      .toBe('не состоялся заявка 1 заключили с ед. поставщиком');
  });

  it('школьный список УО: код вынимается, приписка — остаток (УО r53)', () => {
    const rest = detectForeignText(
      'ЭАС09-25                                                          Школы: 5, 9, Пионерская, Нагорненская',
    );
    expect(rest).toBe('Школы: 5 9 Пионерская Нагорненская');
  });
});

describe('explainDistortedCode — диагноз нераспознанного кода (скриншот 20.08)', () => {
  it('переставленные буквы семейства: «ЭКЗ301-26» (лист «25-26», живой)', () => {
    const d = explainDistortedCode('ЭКЗ301-26 Приобретение однокомнатной квартиры');
    expect(d).not.toBeNull();
    expect(d?.raw).toBe('ЭКЗ301-26');
    expect(d?.guess).toBe('ЭЗК301-26');
    expect(d?.note).toContain('переставлены');
  });

  it('задвоенная буква: «ЭЗЗК01-26» (лист «25-26», живой; ведущий ноль снят в догадке)', () => {
    const d = explainDistortedCode('ЭЗЗК01-26 Подготовка нормативов');
    expect(d?.raw).toBe('ЭЗЗК01-26');
    expect(d?.guess).toBe('ЭЗК1-26');
    expect(d?.note).toContain('задвоена');
  });

  it('«ЭК03-26» — не искажение: семейство ЭК настоящее (сверка 20.08.2026)', () => {
    // Раньше диагност гадал «пропущена З → ЭЗК3-26». Сверка по книгам ГРБС
    // опровергла: «ЭК03-26» живёт там 5 раз, а «ЭЗК03-26» не существует нигде.
    expect(explainDistortedCode('ЭК03-26 Выполнение работ по разработке Генерального плана')).toBeNull();
    expect(extractProcedureRefs('ЭК03-26 Выполнение работ')[0]?.code).toBe('ЭК3-26');
  });

  it('пропущенная буква семейства чинится догадкой: «ЭЗ88-26» (синтетический)', () => {
    const d = explainDistortedCode('ЭЗ88-26 Поставка мебели');
    expect(d?.raw).toBe('ЭЗ88-26');
    expect(d?.guess).toBe('ЭЗК88-26');
    expect(d?.note).toContain('К');
  });

  it('потеряна «Э»: «А427-25» (спека мониторинга §5)', () => {
    const d = explainDistortedCode('А427-25');
    expect(d?.guess).toBe('ЭА427-25');
    expect(d?.note).toContain('Э');
  });

  it('лишний дефис: «ЭЗК-120-26» (спека §5)', () => {
    const d = explainDistortedCode('ЭЗК-120-26 Поставка');
    expect(d?.raw).toBe('ЭЗК-120-26');
    expect(d?.guess).toBe('ЭЗК120-26');
    expect(d?.note).toContain('дефис');
  });

  it('лишняя цифра в годе: «ЭА146-226» (спека §5; догадка по хвостовым двум)', () => {
    const d = explainDistortedCode('ЭА146-226');
    expect(d?.guess).toBe('ЭА146-26');
    expect(d?.note).toContain('годе');
  });

  it('код приклеен к предмету: «ЭЗК264-26Выполнение…» (спека §5)', () => {
    const d = explainDistortedCode('ЭЗК264-26Выполнение работ');
    expect(d?.guess).toBe('ЭЗК264-26');
    expect(d?.note).toContain('приклеен');
  });

  it('код лота — не искажение (п.121): диагност молчит, парсер читает штатно', () => {
    expect(explainDistortedCode('ЭАС205/1-26')).toBeNull();
    expect(extractProcedureRefs('ЭАС205/1-26 Поставка учебников')[0]?.code).toBe('ЭАС205/1-26');
  });

  it('текст вовсе без кода → null (честное «без кода», не выдумывает)', () => {
    expect(explainDistortedCode('Поставка бумаги для офиса')).toBeNull();
    expect(explainDistortedCode('Общий объём ассигнований')).toBeNull();
    expect(explainDistortedCode('')).toBeNull();
    expect(explainDistortedCode(null)).toBeNull();
  });

  it('валидный код диагноза не получает: чинить нечего', () => {
    // Валидный код в начале разберёт extractProcedureRefs — диагност
    // вызывается только когда кода не нашлось; но и на прямой вызов
    // с валидным кодом он не должен сочинять искажение.
    expect(explainDistortedCode('ЭА152-26 Ремонт кровли')).toBeNull();
  });

  it('чужой префикс, который не чинится одной операцией, → null (не гадает дико)', () => {
    expect(explainDistortedCode('ПРО14-26 набор')).toBeNull();
  });
});
