// Юниты lib/recon/subordinates — % исполнения подведа и итоги по управлению
// (вкладка «По подведам»); данные приходят из нетипизированного JSON — поля опциональны.
import { describe, expect, it } from 'vitest';
import { aggregateDeptSubordinates, subordinateExecutionPct } from './subordinates';
import type { ReconSubordinate } from './types';

describe('subordinateExecutionPct', () => {
  it('готовое поле API имеет приоритет, включая честный 0', () => {
    expect(subordinateExecutionPct({ name: 'МКУ', executionPct: 73.5, rowCount: 10, competitiveCount: 1 })).toBe(73.5);
    expect(subordinateExecutionPct({ name: 'МКУ', executionPct: 0, rowCount: 10, competitiveCount: 5 })).toBe(0);
  });

  it('без поля API — (КП+ЕП)/план-строки в процентах', () => {
    expect(subordinateExecutionPct({ name: 'МКУ', rowCount: 10, competitiveCount: 3, epCount: 2 })).toBe(50);
    expect(subordinateExecutionPct({ name: 'МКУ', rowCount: 4, epCount: 1 })).toBe(25);
  });

  it('нет план-строк (0 или поле отсутствует) → 0, без деления на ноль', () => {
    expect(subordinateExecutionPct({ name: 'МКУ', rowCount: 0, competitiveCount: 3 })).toBe(0);
    expect(subordinateExecutionPct({ name: 'МКУ' })).toBe(0);
  });
});

describe('aggregateDeptSubordinates', () => {
  const subs: ReconSubordinate[] = [
    { name: 'А', rowCount: 10, competitiveCount: 4, epCount: 2, planTotal: 1000, factTotal: 800, economyTotal: 50 },
    { name: 'Б', rowCount: 5, competitiveCount: 1, epCount: 3, planTotal: 500, factTotal: 400, economyTotal: 25 },
    { name: 'В' }, // битый подвед: только имя, все счётные поля отсутствуют
  ];

  it('итоги = сумма подведов, отсутствующие поля считаются нулями', () => {
    expect(aggregateDeptSubordinates(subs)).toEqual({
      planCount: 15,
      factCount: 10,
      planTotal: 1500,
      factTotal: 1200,
      economy: 75,
      execPct: (10 / 15) * 100,
    });
  });

  it('пустой список → нули и 0% без деления на ноль', () => {
    expect(aggregateDeptSubordinates([])).toEqual({
      planCount: 0, factCount: 0, planTotal: 0, factTotal: 0, economy: 0, execPct: 0,
    });
  });
});
