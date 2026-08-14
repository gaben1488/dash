/**
 * comment-standards.test.ts — словари-канон владельца (п.72(г), 14.08.2026).
 * Числа и примеры — из файлов владельца (std-prichiny-otkloneniya.txt — 12 строк,
 * std-obosnovanie-ep.txt — 20 строк) и живого дампа comments-full.jsonl.
 */

import { describe, it, expect } from 'vitest';
import {
  STD_DEVIATION_REASONS,
  STD_EP_JUSTIFICATIONS,
  EA_PROCEDURE_RE,
  EIS_NOTICE_RE,
  extractProcedureNumbers,
} from './comment-standards.js';

describe('словари-канон владельца', () => {
  it('ровно 12 причин отклонения — дословно из файла владельца', () => {
    expect(STD_DEVIATION_REASONS).toHaveLength(12);
    expect(STD_DEVIATION_REASONS[0]).toBe('Позднее размещения извещения о закупке');
    expect(STD_DEVIATION_REASONS[11]).toBe('Длительная подготовка закупочной документации');
    // формулировка №5 используется в живых ячейках U (УЭР r55/r56, дамп 14.08)
    expect(STD_DEVIATION_REASONS).toContain(
      'Отклонение от срока в связи с возможным переносом дат проведения мероприятия',
    );
  });

  it('ровно 20 обоснований ЕП — дословно из файла владельца', () => {
    expect(STD_EP_JUSTIFICATIONS).toHaveLength(20);
    expect(STD_EP_JUSTIFICATIONS[0]).toBe('Разработчик ПО');
    expect(STD_EP_JUSTIFICATIONS).toContain('Монополист');
    expect(STD_EP_JUSTIFICATIONS).toContain('Распоряжения Администрации ЕМР от 03.09.2025 № 112');
    // без дублей
    expect(new Set(STD_EP_JUSTIFICATIONS).size).toBe(20);
  });
});

describe('регексы номеров процедур', () => {
  it('ЭА-формат: живые номера из эталона владельца и дампа', () => {
    // std-dop-infa.txt: ЭА152-26, ЭА43-26; дамп: AG УД r14 = «ЭА179-26»
    for (const n of ['ЭА152-26', 'ЭА43-26', 'ЭА179-26']) {
      EA_PROCEDURE_RE.lastIndex = 0;
      expect(EA_PROCEDURE_RE.test(n)).toBe(true);
    }
  });

  it('ЕИС-формат: «№ 32615775240» (эталон владельца) — да; «№ 112» (номер распоряжения) — нет', () => {
    EIS_NOTICE_RE.lastIndex = 0;
    expect(EIS_NOTICE_RE.test('№ 32615775240')).toBe(true);
    EIS_NOTICE_RE.lastIndex = 0;
    expect(EIS_NOTICE_RE.test('Распоряжения Администрации ЕМР от 03.09.2025 № 112')).toBe(false);
  });

  it('extractProcedureNumbers: живой текст УД r146 + смешанный текст, без дублей', () => {
    expect(extractProcedureNumbers('ЭА156-25 подведены итоги ЭА, ЭА156-25 повтор')).toEqual(['ЭА156-25']);
    expect(
      extractProcedureNumbers('так как была жалоба от ФАСа… № 32615775240 и аукцион ЭА167-26'),
    ).toEqual(['ЭА167-26', '№ 32615775240']);
    expect(extractProcedureNumbers(null)).toEqual([]);
    expect(extractProcedureNumbers('')).toEqual([]);
  });
});
