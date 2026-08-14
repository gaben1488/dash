import { describe, it, expect } from 'vitest';
import { causeContribution, unexplainedRemainder, type ReconLineRootCause } from '@aemr/shared';

/**
 * Страж арифметики разбора (канон п.64, прецедент 14.08.2026).
 *
 * Карточка сверки печатала «Не объяснено −3152,07 из −181,85»: остаток в
 * семнадцать раз больше самой разницы. Причина — наблюдения (разнонаправленные
 * отклонения, спорные способы, отменённые) складывались в общий счёт наравне с
 * настоящими вкладчиками. Разбор обязан сходиться: вклады плюс остаток равны
 * разнице ровно, а наблюдения в арифметику не входят.
 */

function cause(part: Partial<ReconLineRootCause>): ReconLineRootCause {
  return {
    id: 'x',
    class: 'unfunded',
    rows: [],
    affects: [],
    explanation: '',
    ...part,
  } as ReconLineRootCause;
}

describe('арифметика разбора расхождения', () => {
  it('наблюдение не имеет вклада, каким бы крупным ни было', () => {
    const observation = cause({
      class: 'sign',
      kind: 'observation',
      rows: [
        { sheet: 'УКСиМП', row: 444, cell: 'Y444', delta: 400 },
        { sheet: 'УКСиМП', row: 633, cell: 'Y633', delta: 150 },
      ],
    });
    expect(causeContribution(observation)).toBe(0);
  });

  it('вклады и остаток сходятся с разницей ровно', () => {
    const delta = -181.85;
    const causes: ReconLineRootCause[] = [
      cause({ class: 'parsing', rows: [{ sheet: 'УКСиМП', row: 206, cell: 'Y206', delta: -50 }] }),
      cause({ class: 'sign', kind: 'observation', rows: [{ sheet: 'УКСиМП', row: 444, cell: 'Y444', delta: 558.89 }] }),
    ];
    const rest = unexplainedRemainder(
      { metric: 'fact_total', official: 0, computed: delta, delta },
      causes,
    );
    const covered = causes.reduce((s, c) => s + causeContribution(c), 0);
    expect(covered).toBe(-50);
    expect(rest).not.toBeNull();
    expect(covered + (rest?.delta ?? 0)).toBeCloseTo(delta, 6);
  });

  it('остаток не может быть больше разницы по модулю, когда вкладчик один и меньше её', () => {
    const delta = -181.85;
    const causes = [cause({ class: 'parsing', rows: [{ sheet: 'У', row: 1, cell: 'Y1', delta: -50 }] })];
    const rest = unexplainedRemainder({ metric: 'm', official: 0, computed: delta, delta }, causes);
    expect(Math.abs(rest?.delta ?? 0)).toBeLessThanOrEqual(Math.abs(delta));
  });

  it('текст остатка говорит, сколько разобрано, а не только сколько нет', () => {
    const delta = -181.85;
    const rest = unexplainedRemainder({ metric: 'm', official: 0, computed: delta, delta }, []);
    expect(rest?.explanation).toContain('Разобрано');
    expect(rest?.explanation).toContain('остаток');
  });
});
