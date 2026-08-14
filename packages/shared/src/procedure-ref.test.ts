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
  detectForeignText,
} from './procedure-ref.js';

describe('parseProcedureRef — строгий разбор ячейки AG', () => {
  it('разбирает канонические коды всех четырёх семейств (живые ячейки)', () => {
    // УЭР r30, УЭР r5, УЭР r23, УЭР r42 из дампа
    expect(parseProcedureRef('ЭА152-26')).toEqual({ code: 'ЭА152-26', family: 'ЭА', n: 152, yy: 26 });
    expect(parseProcedureRef('ЭЗК426-25')).toEqual({ code: 'ЭЗК426-25', family: 'ЭЗК', n: 426, yy: 25 });
    expect(parseProcedureRef('ЭЕП113-26')).toEqual({ code: 'ЭЕП113-26', family: 'ЭЕП', n: 113, yy: 26 });
    expect(parseProcedureRef('ЭАС258-26')).toEqual({ code: 'ЭАС258-26', family: 'ЭАС', n: 258, yy: 26 });
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
    expect(parseProcedureRef('ЭЕП110-06')).toEqual({ code: 'ЭЕП110-06', family: 'ЭЕП', n: 110, yy: 6 });
  });

  it('пять искажённых кодов из спеки мониторинга → null, БЕЗ молчаливой починки', () => {
    // потеря «Э» (УД!20; в книге ГРБС тот же код записан «ЭА427-25»)
    expect(parseProcedureRef('А427-25')).toBeNull();
    // дефис после префикса (УД!53)
    expect(parseProcedureRef('ЭЗК-120-26')).toBeNull();
    // лишняя цифра в годе (УД!62)
    expect(parseProcedureRef('ЭА146-226')).toBeNull();
    // код приклеен к предмету без пробела (УД!106)
    expect(parseProcedureRef('ЭЗК264-26Выполнение работ по благоустройству')).toBeNull();
    // вариант с косой чертой (УО!80, он же живая ячейка книги УО r2101)
    expect(parseProcedureRef('ЭАС205/1-26')).toBeNull();
  });

  it('не признаёт чужие семейства и обрезки (живые ячейки УАГЗО r10, УИО r37)', () => {
    expect(parseProcedureRef('ЭК03-26')).toBeNull(); // семейства ЭК в каноне нет
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
    expect(extractProcedureRefs('ЭАС205/1-26')).toEqual([]);
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
    expect(detectForeignText('ЭК03-26')).toBe('ЭК03-26'); // УАГЗО r10
    expect(detectForeignText('ЭАС205/1-26')).toBe('ЭАС205/1-26'); // УО r2101
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
