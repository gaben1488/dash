/**
 * Стражи договора вкладки «Оценка управлений».
 *
 * Проверяется не оформление, а то, что перевод ответа сервера в экранные
 * сущности не теряет и не выдумывает смысл:
 *   1. порядок строк ставит наверх управление с самым низким индексом, а
 *      неоценённые не выдаются за худших;
 *   2. нарушение нормы закона превращается в карточку из трёх частей —
 *      механизм, адрес, действие (канон п.53), а не в латинский код правила;
 *   3. адрес доходит до ячейки там, где проверка знает колонку;
 *   4. незнакомое правило получает честную заглушку, а не код на экран.
 */
import { describe, expect, it } from 'vitest';
import type { ComplianceIssue } from '@aemr/core';
import {
  BASELINE_CAVEAT,
  PERIMETER_CAVEAT,
  isGraded,
  sortScorecard,
  toDiagnosticIssues,
  fmtShare,
  type ScorecardResponse,
} from './contract';

const GRADED = (short: string, discipline: number) => ({
  grbsShort: short,
  role: 'ОПЕРАЦИОННЫЙ' as const,
  grade: 'B' as const,
  gradeScore: 72,
  gradeReasons: ['отставание от ожидания'],
  discipline,
  mode: 'ВНИМАНИЕ' as const,
  dominantFactor: 'ИСПОЛНЕНИЕ' as const,
  narrative: 'Исполнение ниже ожидания.',
  anticorruptionFlags: 0,
  topFlags: [],
  execPct: 0.42,
  epShare: 0.61,
  riskLevel: 'medium' as const,
});

describe('порядок строк оценки', () => {
  const response: ScorecardResponse = {
    uo: GRADED('УО', 71),
    uer: GRADED('УЭР', 48),
    uio: {
      grbsShort: 'УИО',
      role: 'ОПЕРАЦИОННЫЙ',
      noData: true,
      noDataReason: 'Счётных строк за период нет — оценка не выдаётся.',
    },
  };

  it('наверху управление с самым низким индексом', () => {
    const rows = sortScorecard(response);
    expect(rows.map((r) => r.entry.grbsShort)).toEqual(['УЭР', 'УО', 'УИО']);
  });

  it('неоценённое управление стоит в хвосте и остаётся без чисел', () => {
    const rows = sortScorecard(response);
    const last = rows[rows.length - 1];
    expect(isGraded(last.entry)).toBe(false);
    // У записи без базы нет ни индекса, ни грейда — подставить ноль нельзя.
    expect(last.entry).not.toHaveProperty('discipline');
    expect(last.entry).not.toHaveProperty('grade');
  });
});

describe('нарушения норм закона → карточка диагноста', () => {
  const issue: ComplianceIssue = {
    grbsId: 'uo',
    ruleCode: 'ep_contract_limit',
    severity: 'critical',
    title: 'ЕП превышает лимит 600 тыс. ₽ (строка 214)',
    description: 'Сумма контракта 1 200,0 тыс. ₽ превышает предельный размер для ЕП по п.4 ч.1 ст.93',
    article: 'ст. 93 ч.1 п.4',
    threshold: 600,
    actualValue: 1200,
    rowIndex: 214,
  };

  it('карточка несёт механизм, адрес и действие', () => {
    const [card] = toDiagnosticIssues([issue]);
    expect(card.title).toContain('единственного поставщика');
    expect(card.kbHint).toContain('600 тыс.');
    expect(card.recommendation).toContain('Исполнителю управления');
    expect(card.row).toBe(214);
  });

  it('адрес доходит до ячейки: сумма лежит в колонке «ИТОГО 1» (K)', () => {
    const [card] = toDiagnosticIssues([issue]);
    expect(card.cell).toBe('K214');
    // Управление названо кириллицей, а не латинским ключом маршрута.
    expect(card.departmentId).toBe('УО');
  });

  it('заголовок движка с рублёвым знаком и номером строки на экран не выходит', () => {
    const [card] = toDiagnosticIssues([issue]);
    expect(card.title).not.toContain('₽');
    expect(card.title).not.toContain('(строка');
  });

  it('снижение больше четверти признаётся поводом посмотреть, а не нарушением', () => {
    const [card] = toDiagnosticIssues([{ ...issue, ruleCode: 'anti_dumping', severity: 'warning' }]);
    expect(card.kbHint).toContain('начальной цены');
    expect(card.kbHint).toContain('планового лимита');
    // Ячейку не выдумываем: колонки у этой проверки нет.
    expect(card.cell).toBeUndefined();
  });

  it('незнакомое правило получает заглушку, а не латинский код', () => {
    const [card] = toDiagnosticIssues([{ ...issue, ruleCode: 'brand_new_rule' }]);
    expect(card.title).toBe('Проверка нормы закона без подписи в словаре');
    expect(card.title).not.toContain('brand_new_rule');
  });
});

describe('оговорки экрана', () => {
  it('ориентир объявлен неподтверждённым и без латинских имён полей', () => {
    expect(BASELINE_CAVEAT).toContain('Документа за ними нет');
    expect(BASELINE_CAVEAT).not.toMatch(/[A-Za-z]/);
  });

  it('периметр назван своими словами: 1 кв, год и независимость от шапки', () => {
    expect(PERIMETER_CAVEAT).toContain('1 кв');
    expect(PERIMETER_CAVEAT).toContain('фильтры шапки');
  });
});

describe('формат доли', () => {
  it('доля 0..1 печатается процентом с одним знаком', () => {
    expect(fmtShare(0.4237).replace(/\s/g, ' ')).toBe('42,4 %');
    expect(fmtShare(0).replace(/\s/g, ' ')).toBe('0 %');
  });
});
