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
  DEVIATION_REASONS_V2,
  DEVIATION_REASON_BY_ID,
  matchDeviationReason,
  normalizeCommentText,
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

describe('словарь причин 2.0 (канон п.75а)', () => {
  it('ровно 14 живых причин, id уникальны, каждая типизирована полностью', () => {
    expect(DEVIATION_REASONS_V2).toHaveLength(14);
    expect(new Set(DEVIATION_REASONS_V2.map((r) => r.id)).size).toBe(14);
    for (const r of DEVIATION_REASONS_V2) {
      expect(r.text.length).toBeGreaterThan(0);
      expect(['retro', 'live']).toContain(r.kind);
      expect(r.essence.length).toBeGreaterThan(0);
      expect(['управление', 'бюджетный процесс', 'поставщик', 'уполномоченный орган']).toContain(
        r.addressee,
      );
    }
  });

  it('состав по канону: 11 прежних без №10, №12 переформулирован, три новых семейства', () => {
    const texts = DEVIATION_REASONS_V2.map((r) => r.text);
    // №10 словаря 1.0 слит с №9 — отдельной причины «Уточнение потребности» нет
    expect(texts).not.toContain('Уточнение потребности закупки');
    // №12 переформулирован — старой размытой формулировки нет, новая есть
    expect(texts).not.toContain('Длительная подготовка закупочной документации');
    expect(texts).toContain(
      'Длительная подготовка документации (ТЗ, смета, обоснование НМЦК, проект контракта)',
    );
    // №7 остаётся ждать прецедента
    expect(texts).toContain('Отмена по решению ФАС');
    // три новых семейства
    expect(DEVIATION_REASON_BY_ID.get('no-funding')?.kind).toBe('live');
    expect(DEVIATION_REASON_BY_ID.get('no-funding')?.addressee).toBe('бюджетный процесс');
    expect(DEVIATION_REASON_BY_ID.get('no-funding')?.verifiable).toContain('дата переноса');
    expect(DEVIATION_REASON_BY_ID.get('cash-plan-shift')?.kind).toBe('live');
    expect(DEVIATION_REASON_BY_ID.get('late-draft-from-supplier')?.kind).toBe('live');
    expect(DEVIATION_REASON_BY_ID.get('late-draft-from-supplier')?.addressee).toBe('поставщик');
  });

  it('каждая канон-формулировка матчится сама на себя как exact', () => {
    for (const r of DEVIATION_REASONS_V2) {
      expect(matchDeviationReason(r.text)).toEqual({ id: r.id, match: 'exact' });
    }
  });

  it('«отсутствует финансирование» из дампа попадает в новое семейство no-funding', () => {
    // живые формулировки дампа 14.08: 86 + 19 + 13 ячеек трёх верхних вариантов
    expect(matchDeviationReason('Отсутствует финансирование')).toEqual({
      id: 'no-funding',
      match: 'paraphrase',
    });
    expect(
      matchDeviationReason('в связи отсутствием финансирования закупка переносится на 30.09.2026'),
    ).toEqual({ id: 'no-funding', match: 'paraphrase' });
    expect(matchDeviationReason('нет финансирования, планирование на октябрь месяц')).toEqual({
      id: 'no-funding',
      match: 'paraphrase',
    });
  });

  it('парафразы остальных семейств: кассовый план, поздний проект контракта, слитый №10', () => {
    expect(
      matchDeviationReason('приведено в соответствии с кассовым планом, перенос в связи с отпуском'),
    ).toEqual({ id: 'cash-plan-shift', match: 'paraphrase' });
    expect(matchDeviationReason('позднее получение проекта контракта от поставщика')).toEqual({
      id: 'late-draft-from-supplier',
      match: 'exact',
    });
    // формулировка №10 словаря 1.0 уходит в поглотившую её причину №9
    expect(matchDeviationReason('Уточнение потребности закупки')).toEqual({
      id: 'need-clarification',
      match: 'paraphrase',
    });
  });

  it('плейсхолдеры листа и пустота → null; нейтральный текст → null', () => {
    expect(matchDeviationReason('Х')).toBeNull();
    expect(matchDeviationReason('x')).toBeNull();
    expect(matchDeviationReason('-')).toBeNull();
    expect(matchDeviationReason('.')).toBeNull();
    expect(matchDeviationReason('')).toBeNull();
    expect(matchDeviationReason(null)).toBeNull();
    expect(matchDeviationReason(42)).toBeNull();
    // консервативность: обычный хозяйственный текст не притягивается
    expect(matchDeviationReason('необходимы для нужд учреждения')).toBeNull();
    expect(matchDeviationReason('договор заключен')).toBeNull();
  });

  it('нормализация — как в таксономии: lowercase, е вместо ё, пунктуация, пробелы', () => {
    expect(normalizeCommentText('  «ЕЩЁ»  один   текст. ')).toBe('еще один текст');
    expect(normalizeCommentText('Перенос по кассовому плану / организационным причинам')).toBe(
      'перенос по кассовому плану организационным причинам',
    );
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
