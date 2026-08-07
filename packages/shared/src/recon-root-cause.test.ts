/**
 * Инварианты контракта первопричин (спека §1, вводная владельца 07.08):
 *  1) дельта без причины запрещена;
 *  2) причина без строк-виновниц запрещена (кроме 'unknown');
 *  3) сумма вкладов строк сходится с дельтой;
 *  4) один id причины в разных показателях = каскад, схлопывается в группу.
 */
import { describe, expect, it } from 'vitest';
import {
  groupCascades,
  ROOT_CAUSE_ACTIONS,
  ROOT_CAUSE_LABELS,
  unexplainedRemainder,
  validateReconLine,
  type ReconLine,
  type ReconLineRootCause,
} from './recon-root-cause.js';

function cause(o: Partial<ReconLineRootCause> = {}): ReconLineRootCause {
  return {
    id: o.id ?? 'unfunded:УКСиМП:1481',
    class: o.class ?? 'unfunded',
    rows: o.rows ?? [{ sheet: 'УКСиМП', row: 1481, cell: 'K1481', delta: 50 }],
    explanation: o.explanation ?? 'Строка без года плана: лист её не видит, расчёт видит.',
    affects: o.affects ?? [],
  };
}

function line(o: Partial<ReconLine> = {}): ReconLine {
  return {
    metric: o.metric ?? 'uksimp.ep.year.fact_total',
    official: o.official ?? 108_768.2,
    computed: o.computed ?? 108_818.2,
    delta: o.delta ?? 50,
    rootCauses: o.rootCauses ?? [cause()],
  };
}

describe('validateReconLine — инварианты', () => {
  it('объяснённая строка нарушений не даёт', () => {
    expect(validateReconLine(line())).toEqual([]);
  });

  it('дельта без причины — нарушение', () => {
    const v = validateReconLine(line({ rootCauses: [] }));
    expect(v).toHaveLength(1);
    expect(v[0].code).toBe('delta_without_cause');
  });

  it('нулевая дельта без причин — норма (совпадает)', () => {
    expect(validateReconLine(line({ delta: 0, official: 100, computed: 100, rootCauses: [] }))).toEqual([]);
  });

  it('дельта в пределах допуска 0,01 считается нулевой', () => {
    expect(validateReconLine(line({ delta: 0.004, rootCauses: [] }))).toEqual([]);
  });

  it('причина без строк-виновниц — нарушение', () => {
    const v = validateReconLine(line({ rootCauses: [cause({ rows: [] })] }));
    expect(v.some((x) => x.code === 'cause_without_rows')).toBe(true);
  });

  it("класс 'unknown' без строк разрешён — это честный остаток", () => {
    const v = validateReconLine(
      line({ rootCauses: [cause({ class: 'unknown', rows: [], id: 'unknown:x' })] }),
    );
    expect(v.some((x) => x.code === 'cause_without_rows')).toBe(false);
  });

  it('вклады строк не сходятся с дельтой — нарушение', () => {
    const v = validateReconLine(
      line({
        delta: 50,
        rootCauses: [cause({ rows: [{ sheet: 'УКСиМП', row: 1481, cell: 'K1481', delta: 30 }] })],
      }),
    );
    expect(v.some((x) => x.code === 'contributions_mismatch')).toBe(true);
  });

  it('несколько причин: вклады суммируются', () => {
    const v = validateReconLine(
      line({
        delta: 80,
        rootCauses: [
          cause({ id: 'a', rows: [{ sheet: 'УКСиМП', row: 1481, cell: 'K1481', delta: 50 }] }),
          cause({
            id: 'b',
            class: 'afterSlice',
            rows: [{ sheet: 'УКСиМП', row: 900, cell: 'Q900', delta: 30 }],
          }),
        ],
      }),
    );
    expect(v).toEqual([]);
  });
});

describe('unexplainedRemainder — непокрытый остаток', () => {
  it('остаток становится честной причиной unknown', () => {
    const rest = unexplainedRemainder(
      { metric: 'm', official: 0, computed: 80, delta: 80 },
      [cause({ rows: [{ sheet: 'УО', row: 5, cell: 'K5', delta: 50 }] })],
    );
    expect(rest).not.toBeNull();
    expect(rest!.class).toBe('unknown');
    expect(rest!.explanation).toContain('30.00');
  });

  it('полностью покрытая дельта остатка не даёт', () => {
    expect(
      unexplainedRemainder({ metric: 'm', official: 0, computed: 50, delta: 50 }, [cause()]),
    ).toBeNull();
  });

  it('остаток + исходные причины проходят валидацию', () => {
    const base = { metric: 'm', official: 0, computed: 80, delta: 80 };
    const causes = [cause({ rows: [{ sheet: 'УО', row: 5, cell: 'K5', delta: 50 }] })];
    const rest = unexplainedRemainder(base, causes)!;
    expect(validateReconLine({ ...base, rootCauses: [...causes, rest] })).toEqual([]);
  });
});

describe('groupCascades — каскад показывается одной причиной', () => {
  it('одна дельта в данных, три производных показателя — одна группа', () => {
    // Живой случай УКСиМП: 50 тыс. в «ЕП год итого факт» эхом идут в
    // «откл. сумм» и «потрачено %» — это ОДИН дефект, не три.
    const shared = cause({ id: 'unfunded:УКСиМП:1481', affects: ['dev', 'spent'] });
    const lines: ReconLine[] = [
      line({ metric: 'fact', delta: 50, rootCauses: [shared] }),
      line({ metric: 'dev', delta: 50, rootCauses: [shared] }),
      line({ metric: 'spent', delta: 0.00041, rootCauses: [shared] }),
    ];
    const groups = groupCascades(lines);
    expect(groups).toHaveLength(1);
    expect(groups[0].metrics).toEqual(['fact', 'dev', 'spent']);
    expect(groups[0].cause.class).toBe('unfunded');
  });

  it('разные причины — разные группы, дороже сверху', () => {
    const lines: ReconLine[] = [
      line({ metric: 'a', delta: 10, rootCauses: [cause({ id: 'small' })] }),
      line({ metric: 'b', delta: 900, rootCauses: [cause({ id: 'big', class: 'parsing' })] }),
    ];
    const groups = groupCascades(lines);
    expect(groups.map((g) => g.cause.id)).toEqual(['big', 'small']);
    expect(groups[0].totalDelta).toBe(900);
  });

  it('строк сверки нет — групп нет', () => {
    expect(groupCascades([])).toEqual([]);
  });
});

describe('словари классов', () => {
  it('у каждого класса есть подпись и рекомендация действия', () => {
    const classes = Object.keys(ROOT_CAUSE_LABELS) as (keyof typeof ROOT_CAUSE_LABELS)[];
    expect(classes).toHaveLength(8);
    for (const c of classes) {
      expect(ROOT_CAUSE_LABELS[c].length).toBeGreaterThan(0);
      expect(ROOT_CAUSE_ACTIONS[c].length).toBeGreaterThan(0);
    }
  });
});
