// Юниты lib/recon/subordinates — план, факт и % исполнения подведа, итоги по
// управлению (вкладка «По подведам»); данные приходят из нетипизированного
// JSON — поля опциональны.
//
// 05.08.2026: тесты переписаны вместе с исправлением корня «неправильных
// плана и факта». Прежний контракт закреплял подмену: факт считался как
// (КП + ЕП), то есть сумма строк по способам определения поставщика, а не
// число заключённых позиций. КП и ЕП вместе покрывают весь план, поэтому
// старый тест «rowCount: 10, competitiveCount: 3, epCount: 2 → 50 %» проверял
// не исполнение, а долю строк с распознанным способом. Теперь план и факт
// берутся из квартальной базы движка, а при её отсутствии возвращается null —
// продукт показывает прочерк вместо выдуманного числа.
import { describe, expect, it } from 'vitest';
import {
  aggregateDeptSubordinates,
  subordinateCounts,
  subordinateExecCountPct,
  subordinateExecutionPct,
} from './subordinates';
import type { ReconSubordinate } from './types';

/** Квартальная база подведа: год = сумма четырёх плановых кварталов (канон движка). */
function withQuarters(
  name: string,
  q: Array<{ planCount: number; factCount: number }>,
  rest: Partial<ReconSubordinate> = {},
): ReconSubordinate {
  const zero = {
    planTotal: 0, factTotal: 0, planFB: 0, planKB: 0, planMB: 0,
    factFB: 0, factKB: 0, factMB: 0, economyTotal: 0, economyFB: 0, economyKB: 0, economyMB: 0,
  };
  const quarters: Record<string, any> = {};
  q.forEach((v, i) => {
    quarters[`q${i + 1}`] = { ...zero, planCount: v.planCount, factCount: v.factCount };
  });
  return { name, quarters, ...rest } as ReconSubordinate;
}

describe('subordinateCounts', () => {
  it('год = сумма четырёх кварталов', () => {
    const sub = withQuarters('МКУ', [
      { planCount: 5, factCount: 3 },
      { planCount: 4, factCount: 4 },
      { planCount: 3, factCount: 0 },
      { planCount: 2, factCount: 1 },
    ]);
    expect(subordinateCounts(sub)).toEqual({ planCount: 14, factCount: 8 });
  });

  it('нет квартальной базы → null, а не нули (нулей в отчёте быть не должно)', () => {
    expect(subordinateCounts({ name: 'МКУ', rowCount: 10, competitiveCount: 6 })).toBeNull();
  });
});

describe('subordinateExecCountPct', () => {
  it('готовое поле движка имеет приоритет, включая честный 0', () => {
    expect(subordinateExecCountPct({ name: 'МКУ', execCountPct: 73.5 })).toBe(73.5);
    expect(subordinateExecCountPct({ name: 'МКУ', execCountPct: 0, rowCount: 10, competitiveCount: 5 })).toBe(0);
  });

  it('без поля движка считается по кварталам', () => {
    const sub = withQuarters('МКУ', [{ planCount: 10, factCount: 3 }, { planCount: 10, factCount: 2 }]);
    expect(subordinateExecCountPct(sub)).toBe(25);
  });

  it('способы определения поставщика в расчёт исполнения НЕ идут', () => {
    // КП+ЕП покрывают весь план; раньше это давало ложные 100 %.
    expect(subordinateExecCountPct({ name: 'МКУ', rowCount: 10, competitiveCount: 6, epCount: 4 })).toBeNull();
  });

  it('план нулевой → null (нечего исполнять ≠ исполнено на 0 %)', () => {
    expect(subordinateExecCountPct(withQuarters('МКУ', [{ planCount: 0, factCount: 0 }]))).toBeNull();
  });
});

describe('subordinateExecutionPct', () => {
  it('отдаёт готовый процент по суммам, включая честный 0', () => {
    expect(subordinateExecutionPct({ name: 'МКУ', executionPct: 73.5 })).toBe(73.5);
    expect(subordinateExecutionPct({ name: 'МКУ', executionPct: 0 })).toBe(0);
  });

  it('без поля движка — null, ничего не выдумываем', () => {
    expect(subordinateExecutionPct({ name: 'МКУ', rowCount: 10, competitiveCount: 3, epCount: 2 })).toBeNull();
  });
});

describe('aggregateDeptSubordinates', () => {
  const subs: ReconSubordinate[] = [
    withQuarters('А', [{ planCount: 6, factCount: 4 }, { planCount: 4, factCount: 1 }],
      { rowCount: 10, competitiveCount: 4, epCount: 2, planTotal: 1000, factTotal: 800, economyTotal: 50 }),
    withQuarters('Б', [{ planCount: 5, factCount: 2 }],
      { rowCount: 5, competitiveCount: 1, epCount: 3, planTotal: 500, factTotal: 400, economyTotal: 25 }),
    { name: 'В' }, // битый подвед: только имя, счётных полей нет
  ];

  it('план и факт — из кварталов, способы учитываются отдельной величиной', () => {
    expect(aggregateDeptSubordinates(subs)).toEqual({
      planCount: 15,
      factCount: 7,
      methodCount: 10,
      rowCount: 15,
      planTotal: 1500,
      factTotal: 1200,
      economy: 75,
      execCountPct: +((7 / 15) * 100).toFixed(1),
      execAmountPct: 80,
    });
  });

  it('без квартальной базы у всех подведов счётчики null, деньги считаются', () => {
    const r = aggregateDeptSubordinates([
      { name: 'А', rowCount: 3, competitiveCount: 2, epCount: 1, planTotal: 100, factTotal: 40 },
    ]);
    expect(r.planCount).toBeNull();
    expect(r.factCount).toBeNull();
    expect(r.execCountPct).toBeNull();
    expect(r.methodCount).toBe(3);
    expect(r.execAmountPct).toBe(40);
  });

  it('пустой список → нули по деньгам и null по процентам, без деления на ноль', () => {
    expect(aggregateDeptSubordinates([])).toEqual({
      planCount: null, factCount: null, methodCount: 0, rowCount: 0,
      planTotal: 0, factTotal: 0, economy: 0, execCountPct: null, execAmountPct: null,
    });
  });
});
