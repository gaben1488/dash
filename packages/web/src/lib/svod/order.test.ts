import { describe, expect, it } from 'vitest';
import type { SvodBlock, SvodRow } from '@aemr/shared';
import { orderDeptBlocks, type SvodDeptEntry } from './order';

function row(patch: Partial<SvodRow>): SvodRow {
  return {
    planCount: 0, factCount: 0, deviationCount: 0, executionPct: null,
    planFB: 0, planKB: 0, planMB: 0, planTotal: 0,
    factFB: 0, factKB: 0, factMB: 0, factTotal: 0,
    amountDeviation: 0, spentPct: null,
    economyFB: 0, economyKB: 0, economyMB: 0, economyTotal: 0,
    ...patch,
  };
}

function entry(id: string, total: SvodRow): SvodDeptEntry {
  const block: SvodBlock = {
    kp: { year: total },
    ep: { year: total },
    total: { year: total },
  } as unknown as SvodBlock;
  return { id, block };
}

/** УО отстаёт по проценту, УЖКХ крупнее по лимиту, УКСиМП посередине. */
const УО = entry('УО', row({ executionPct: 0.42, planTotal: 120_000, factTotal: 100_000 }));
const УКСиМП = entry('УКСиМП', row({ executionPct: 0.78, planTotal: 300_000, factTotal: 250_000 }));
const УЖКХ = entry('УЖКХ', row({ executionPct: 0.91, planTotal: 900_000, factTotal: 880_000 }));
/** У управления нет плана вовсе — исполнять нечего. */
const ПУСТОЕ = entry('УФБП', row({ executionPct: null, planTotal: null, factTotal: null }));

const ALL = [УО, УКСиМП, УЖКХ, ПУСТОЕ];

describe('порядок блоков управлений «Свода»', () => {
  it('«как в реестре» возвращает исходную последовательность', () => {
    expect(orderDeptBlocks(ALL, 'registry').map((e) => e.id))
      .toEqual(['УО', 'УКСиМП', 'УЖКХ', 'УФБП']);
  });

  it('по исполнению сверху отстающие', () => {
    expect(orderDeptBlocks(ALL, 'execution').map((e) => e.id))
      .toEqual(['УО', 'УКСиМП', 'УЖКХ', 'УФБП']);
  });

  it('по лимиту сверху крупные', () => {
    expect(orderDeptBlocks(ALL, 'plan').map((e) => e.id))
      .toEqual(['УЖКХ', 'УКСиМП', 'УО', 'УФБП']);
  });

  it('по экономии сверху наибольшая разница плана и факта', () => {
    // УКСиМП 50 000, УО 20 000, УЖКХ 20 000 (равно с УО — порядок реестра).
    expect(orderDeptBlocks(ALL, 'economy').map((e) => e.id))
      .toEqual(['УКСиМП', 'УО', 'УЖКХ', 'УФБП']);
  });

  it('управление без числа уходит вниз при любом направлении, а не выдаётся за отстающее', () => {
    for (const order of ['execution', 'plan', 'economy'] as const) {
      const last = orderDeptBlocks(ALL, order).at(-1);
      expect(last?.id).toBe('УФБП');
    }
  });

  it('равные числа не переставляются местами — порядок устойчив', () => {
    const a = entry('А', row({ executionPct: 0.5, planTotal: 10, factTotal: 5 }));
    const b = entry('Б', row({ executionPct: 0.5, planTotal: 10, factTotal: 5 }));
    expect(orderDeptBlocks([a, b], 'execution').map((e) => e.id)).toEqual(['А', 'Б']);
    expect(orderDeptBlocks([b, a], 'execution').map((e) => e.id)).toEqual(['Б', 'А']);
  });

  it('исходный массив не трогается', () => {
    const source = [...ALL];
    orderDeptBlocks(source, 'plan');
    expect(source.map((e) => e.id)).toEqual(['УО', 'УКСиМП', 'УЖКХ', 'УФБП']);
  });
});
