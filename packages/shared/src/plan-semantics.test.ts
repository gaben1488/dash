/**
 * Страж подписи плановой суммы (канон п.102, показания владельца 18.08.2026).
 *
 * Проверяется не «код работает», а то, что продукт не соврёт молча:
 *   • ни одно из восьми управлений не осталось без ответа на вопрос «что
 *     означает здесь план»;
 *   • периметр, где НМЦК соседствует с лимитами, ОБЯЗАН отдать предупреждение
 *     раньше, чем читатель построит вывод на сумме разнородных чисел;
 *   • одиночное управление получает свою подпись, а не общую заглушку.
 *
 * Таблица ожиданий ниже выписана из п.102 дословно, поэтому смена практики в
 * управлении (например, ответ УИО) обязана править карту и эту таблицу вместе.
 */
import { describe, it, expect } from 'vitest';
import {
  ALL_DEPT_IDS,
  ALL_LATIN_IDS,
  DEPARTMENT_REGISTRY,
  type LatinDeptId,
} from './department-registry.js';
import {
  PLAN_SEMANTICS_BY_DEPT,
  PLAN_SEMANTICS_KIND_TEXT,
  PLAN_SEMANTICS_SOURCE,
  planSemanticsFor,
  summarizePlanSemantics,
  type PlanSemanticsConfidence,
  type PlanSemanticsKind,
} from './plan-semantics.js';

/** Показания п.102: управление → природа величины и твёрдость знания. */
const CANON: ReadonlyArray<{
  latin: LatinDeptId;
  kind: PlanSemanticsKind;
  confidence: PlanSemanticsConfidence;
}> = [
  { latin: 'uagzo', kind: 'nmck', confidence: 'confirmed' }, // «подтверждено стопроцентно»
  { latin: 'ud', kind: 'nmck', confidence: 'confirmed' }, // «подтверждено стопроцентно»
  { latin: 'uksimp', kind: 'nmck-minus-taken', confidence: 'confirmed' }, // нюанс культуры: правят вниз
  { latin: 'uo', kind: 'nmck', confidence: 'mostly' }, // «в основном тоже НМЦК»
  { latin: 'uer', kind: 'nmck', confidence: 'mostly' }, // «в основном тоже НМЦК»
  { latin: 'udtx', kind: 'redistributed-limit', confidence: 'confirmed' }, // слова специалиста
  { latin: 'uio', kind: 'unknown', confidence: 'unknown' }, // владелец ждёт ответа
  { latin: 'ufbp', kind: 'unknown', confidence: 'unknown' }, // владелец ждёт ответа
];

describe('карта семантики плановой суммы', () => {
  it('покрывает все восемь управлений реестра — ни одного без ответа', () => {
    expect(Object.keys(PLAN_SEMANTICS_BY_DEPT).sort()).toEqual([...ALL_LATIN_IDS].sort());
    expect(ALL_LATIN_IDS).toHaveLength(8);
    for (const latin of ALL_LATIN_IDS) {
      const s = PLAN_SEMANTICS_BY_DEPT[latin];
      expect(s, `нет записи для ${latin}`).toBeDefined();
      expect(s.label.length).toBeGreaterThan(0);
      expect(s.explain.length).toBeGreaterThan(0);
      expect(s.source).toBe(PLAN_SEMANTICS_SOURCE);
    }
  });

  it('совпадает с показаниями п.102 по каждому управлению', () => {
    expect(CANON).toHaveLength(ALL_LATIN_IDS.length);
    for (const { latin, kind, confidence } of CANON) {
      const s = PLAN_SEMANTICS_BY_DEPT[latin];
      expect(s.kind, `природа плана ${latin}`).toBe(kind);
      expect(s.confidence, `твёрдость знания ${latin}`).toBe(confidence);
      expect(s.label).toBe(PLAN_SEMANTICS_KIND_TEXT[kind].label);
    }
  });

  it('у «в основном» подтверждённых оговорка про отдельные строки видна в объяснении', () => {
    expect(PLAN_SEMANTICS_BY_DEPT.uo.explain).toContain('преобладающей');
    expect(PLAN_SEMANTICS_BY_DEPT.uagzo.explain).not.toContain('преобладающей');
  });

  it('находит семантику по любой форме ключа, а незнакомый ключ не роняет экран', () => {
    for (const d of DEPARTMENT_REGISTRY) {
      expect(planSemanticsFor(d.id)).toBe(PLAN_SEMANTICS_BY_DEPT[d.latinId]);
      expect(planSemanticsFor(d.latinId)).toBe(PLAN_SEMANTICS_BY_DEPT[d.latinId]);
    }
    expect(planSemanticsFor('УМВД').kind).toBe('unknown');
  });
});

describe('сводная подпись периметра', () => {
  it('одиночное управление получает свою подпись без предупреждения о смешении', () => {
    const udtx = summarizePlanSemantics(['УДТХ']);
    expect(udtx.mixed).toBe(false);
    expect(udtx.warning).toBeNull();
    expect(udtx.kinds).toEqual(['redistributed-limit']);
    expect(udtx.label).toContain('распределяемый лимит');
    expect(udtx.explain).toContain('УДТХ');
    expect(udtx.explain).toContain('снимают с этой строки');

    const uagzo = summarizePlanSemantics(['uagzo']);
    expect(uagzo.kinds).toEqual(['nmck']);
    expect(uagzo.label).toContain('НМЦК по заявке');
    expect(uagzo.warning).toBeNull();
    expect(uagzo.hasUnknown).toBe(false);
  });

  it('смешанный периметр (НМЦК + лимиты) предупреждает о разнородной сумме', () => {
    const s = summarizePlanSemantics(['УАГЗО', 'УДТХ']);
    expect(s.mixed).toBe(true);
    expect(s.warning).toContain('складывает НМЦК одних управлений с лимитами других');
    expect(s.warning).toContain('УАГЗО');
    expect(s.warning).toContain('УДТХ');
    expect(s.label).toBe('План собран из разных величин');
    expect(s.explain).toContain(s.warning!);
  });

  it('смешение НМЦК с «НМЦК минус изъятое» предупреждает о занижении разности', () => {
    const s = summarizePlanSemantics(['УАГЗО', 'УКСиМП']);
    expect(s.mixed).toBe(true);
    expect(s.warning).toContain('задним числом');
    expect(s.warning).toContain('УКСиМП');
    expect(s.warning).not.toContain('лимитами других');
  });

  it('неподтверждённые управления называются отдельной оговоркой', () => {
    const s = summarizePlanSemantics(['УИО', 'УФБП']);
    expect(s.mixed).toBe(false); // одна природа — «не подтверждена», складывать пока нечего с чем
    expect(s.hasUnknown).toBe(true);
    expect(s.unknownNote).toContain('УИО');
    expect(s.unknownNote).toContain('УФБП');
    expect(s.warning).toBeNull();
  });

  it('весь периметр из восьми управлений — и смешение, и оговорка о неизвестных', () => {
    const s = summarizePlanSemantics([...ALL_DEPT_IDS]);
    expect(s.mixed).toBe(true);
    expect(s.hasUnknown).toBe(true);
    expect(s.warning).toContain('складывает НМЦК одних управлений с лимитами других');
    expect(s.unknownNote).not.toBeNull();
    expect(s.kinds).toEqual(['nmck', 'nmck-minus-taken', 'redistributed-limit', 'unknown']);
    // Управления внутри группы перечисляются в порядке реестра, а не как пришли.
    expect(s.groups[0].depts).toEqual(['УЭР', 'УАГЗО', 'УД', 'УО']);
    expect(s.explain).toContain(PLAN_SEMANTICS_SOURCE);
  });

  it('повторы и незнакомые ключи периметр не искажают', () => {
    const once = summarizePlanSemantics(['УДТХ']);
    const noisy = summarizePlanSemantics(['УДТХ', 'udtx', 'УДТХ', 'НЕТ ТАКОГО']);
    expect(noisy.groups).toEqual(once.groups);
    expect(noisy.explain).toBe(once.explain);
  });

  it('пустой периметр не выдумывает подпись', () => {
    const s = summarizePlanSemantics([]);
    expect(s.kinds).toEqual([]);
    expect(s.mixed).toBe(false);
    expect(s.warning).toBeNull();
    expect(s.label).toBe('Управления не выбраны');
  });
});
