import { describe, it, expect } from 'vitest';
import {
  buildEpJustificationDept,
  emptyEpGradeBucket,
  epClusterLabel,
  epPlanQuarter,
  epQuarterDynamics,
  mergeEpClusters,
  mergeEpGradeBuckets,
  summarizeEpGrades,
  topClustersOfGrade,
  type EpJustificationRow,
} from './ep-justification.js';

/** Причины, чьи кластеры проверены словарём ep-reason-clusters. */
const REASON = {
  monopoly: 'Монополист',
  lowestPrice: 'Заключение с ЕП по наименьшей цене',
  notWorthwhile: 'Проведение аукциона нецелесообразно',
  currentLaw: 'В соответствии с действующим законодательством',
} as const;

const row = (r: Partial<EpJustificationRow>): EpJustificationRow => ({
  method: 'ЕП',
  reason: '',
  planTotal: 0,
  quarter: null,
  ...r,
});

describe('epPlanQuarter — квартал плана из столбца O', () => {
  it('читает 1..4 числом и строкой, в том числе с запятой', () => {
    expect(epPlanQuarter(1)).toBe(1);
    expect(epPlanQuarter('3')).toBe(3);
    expect(epPlanQuarter('2,0')).toBe(2);
  });

  it('пустая и внедиапазонная ячейка — квартала нет, а не квартал первый', () => {
    expect(epPlanQuarter('')).toBeNull();
    expect(epPlanQuarter(null)).toBeNull();
    expect(epPlanQuarter('х')).toBeNull();
    expect(epPlanQuarter(0)).toBeNull();
    expect(epPlanQuarter(5)).toBeNull();
  });
});

describe('buildEpJustificationDept — разбивка ЕП по степеням', () => {
  it('разносит четыре причины по четырём степеням и считает деньги', () => {
    const d = buildEpJustificationDept([
      row({ reason: REASON.monopoly, planTotal: 100, quarter: 1 }),
      row({ reason: REASON.lowestPrice, planTotal: 200, quarter: 1 }),
      row({ reason: REASON.notWorthwhile, planTotal: 300, quarter: 2 }),
      row({ reason: REASON.currentLaw, planTotal: 400, quarter: 2 }),
    ]);
    expect(d.byGrade['lawful-exclusive']).toEqual({ rows: 1, sum: 100 });
    expect(d.byGrade['verified-benefit']).toEqual({ rows: 1, sum: 200 });
    expect(d.byGrade.discretionary).toEqual({ rows: 1, sum: 300 });
    expect(d.byGrade.unfounded).toEqual({ rows: 1, sum: 400 });
    expect(d.ep).toEqual({ rows: 4, sum: 1000 });
  });

  it('пустая графа M — «без обоснования», а не пропуск строки', () => {
    const d = buildEpJustificationDept([row({ reason: '', planTotal: 50 })]);
    expect(d.byGrade.unfounded).toEqual({ rows: 1, sum: 50 });
    expect(d.byCluster.EMPTY).toEqual({ rows: 1, sum: 50 });
  });

  it('конкурентные строки идут в знаменатель, а не в степени', () => {
    const d = buildEpJustificationDept([
      row({ method: 'ЭА', reason: '', planTotal: 700, quarter: 3 }),
      row({ reason: REASON.monopoly, planTotal: 300, quarter: 3 }),
    ]);
    expect(d.competitive).toEqual({ rows: 1, sum: 700 });
    expect(d.ep).toEqual({ rows: 1, sum: 300 });
    expect(d.quarters.q3.competitive.sum).toBe(700);
  });

  it('строка без способа (L пуста) не идёт ни в числитель, ни в знаменатель', () => {
    const d = buildEpJustificationDept([
      row({ method: '', reason: REASON.monopoly, planTotal: 999 }),
      row({ method: '   ', reason: '', planTotal: 999 }),
    ]);
    expect(d.ep).toEqual({ rows: 0, sum: 0 });
    expect(d.competitive).toEqual({ rows: 0, sum: 0 });
  });

  it('строки ЕП без квартала плана считаются отдельно и в динамику не попадают', () => {
    const d = buildEpJustificationDept([
      row({ reason: REASON.notWorthwhile, planTotal: 120, quarter: null }),
      row({ reason: REASON.notWorthwhile, planTotal: 80, quarter: 4 }),
    ]);
    expect(d.noQuarter).toEqual({ rows: 1, sum: 120 });
    expect(d.ep.sum).toBe(200);
    const inQuarters = (['q1', 'q2', 'q3', 'q4'] as const)
      .reduce((acc, q) => acc + d.quarters[q].ep.sum, 0);
    expect(inQuarters).toBe(80);
  });

  it('нечисловой план не ломает счёт: строка считается, деньги нулевые', () => {
    const d = buildEpJustificationDept([
      row({ reason: REASON.monopoly, planTotal: Number.NaN }),
    ]);
    expect(d.ep).toEqual({ rows: 1, sum: 0 });
  });
});

describe('summarizeEpGrades — сокращаемый ЕП и доли', () => {
  it('сокращаемый ЕП = решение заказчика + без обоснования', () => {
    const d = buildEpJustificationDept([
      row({ reason: REASON.monopoly, planTotal: 600 }),
      row({ reason: REASON.notWorthwhile, planTotal: 300 }),
      row({ reason: REASON.currentLaw, planTotal: 100 }),
      row({ method: 'ЭА', reason: '', planTotal: 1000 }),
    ]);
    const s = summarizeEpGrades(d);
    expect(s.reducible).toEqual({ rows: 2, sum: 400 });
    expect(s.reducibleShareOfEp).toBe(40);
    expect(s.reducibleShareOfAll).toBe(20);
    expect(s.epShareMoney).toBe(50);
    expect(s.epShareCount).toBe(75);
    expect(s.hasData).toBe(true);
  });

  it('пустой периметр — null-доли и честная пустота, а не нули процентов', () => {
    const s = summarizeEpGrades(emptyEpGradeBucket());
    expect(s.hasData).toBe(false);
    expect(s.epShareMoney).toBeNull();
    expect(s.reducibleShareOfEp).toBeNull();
    expect(s.reducible).toEqual({ rows: 0, sum: 0 });
  });

  it('ЕП нет, конкурентные есть — доля ЕП ноль, доля сокращаемого внутри ЕП null', () => {
    const d = buildEpJustificationDept([row({ method: 'ЭК', reason: '', planTotal: 500 })]);
    const s = summarizeEpGrades(d);
    expect(s.epShareMoney).toBe(0);
    expect(s.reducibleShareOfEp).toBeNull();
    expect(s.hasData).toBe(true);
  });
});

describe('epQuarterDynamics — снижение видно во времени', () => {
  it('доля ЕП и доля сокращаемого падают от квартала к кварталу', () => {
    const d = buildEpJustificationDept([
      // I квартал: весь объём — ЕП без обоснования.
      row({ reason: REASON.currentLaw, planTotal: 1000, quarter: 1 }),
      // II квартал: половина ушла на торги.
      row({ reason: REASON.currentLaw, planTotal: 500, quarter: 2 }),
      row({ method: 'ЭА', reason: '', planTotal: 500, quarter: 2 }),
      // III квартал: ЕП остался, но стал безальтернативным по закону.
      row({ reason: REASON.monopoly, planTotal: 250, quarter: 3 }),
      row({ method: 'ЭА', reason: '', planTotal: 750, quarter: 3 }),
    ]);
    const points = epQuarterDynamics(d.quarters);
    expect(points).toHaveLength(4);
    expect(points.map((p) => p.index)).toEqual([1, 2, 3, 4]);
    expect(points[0]!.reducibleShareOfAll).toBe(100);
    expect(points[1]!.reducibleShareOfAll).toBe(50);
    expect(points[2]!.reducibleShareOfAll).toBe(0);
    expect(points[2]!.epShareMoney).toBe(25);
    expect(points[3]!.hasData).toBe(false);
    expect(points[3]!.epShareMoney).toBeNull();
  });
});

describe('слияние периметров', () => {
  it('складывает управления по степеням и знаменателю', () => {
    const a = buildEpJustificationDept([row({ reason: REASON.monopoly, planTotal: 100 })]);
    const b = buildEpJustificationDept([
      row({ reason: REASON.notWorthwhile, planTotal: 40 }),
      row({ method: 'ЭА', reason: '', planTotal: 60 }),
    ]);
    const merged = mergeEpGradeBuckets([a, b]);
    expect(merged.ep).toEqual({ rows: 2, sum: 140 });
    expect(merged.competitive).toEqual({ rows: 1, sum: 60 });
    expect(merged.byGrade.discretionary).toEqual({ rows: 1, sum: 40 });
  });

  it('складывает словари кластеров без потери исходных объектов', () => {
    const a = buildEpJustificationDept([row({ reason: REASON.monopoly, planTotal: 10 })]);
    const b = buildEpJustificationDept([row({ reason: REASON.monopoly, planTotal: 5 })]);
    const merged = mergeEpClusters([a.byCluster, b.byCluster]);
    expect(merged.EP_MONOPOLIST).toEqual({ rows: 2, sum: 15 });
    expect(a.byCluster.EP_MONOPOLIST).toEqual({ rows: 1, sum: 10 });
  });

  it('слияние пустого списка даёт пустой свод', () => {
    expect(mergeEpGradeBuckets([]).ep).toEqual({ rows: 0, sum: 0 });
    expect(mergeEpClusters([])).toEqual({});
  });
});

describe('формулировки степени', () => {
  it('внутри степени сортирует по деньгам и подписывает по-русски', () => {
    const d = buildEpJustificationDept([
      row({ reason: REASON.currentLaw, planTotal: 10 }),
      row({ reason: '', planTotal: 90 }),
    ]);
    const top = topClustersOfGrade(d.byCluster, 'unfounded');
    expect(top[0]!.cluster).toBe('EMPTY');
    expect(top[0]!.sum).toBe(90);
    expect(top[1]!.cluster).toBe('EP_CURRENT_LAW');
    for (const t of top) expect(t.label).not.toMatch(/^EP_/);
  });

  it('срез степени не смешивает чужие кластеры и режется лимитом', () => {
    const d = buildEpJustificationDept([
      row({ reason: REASON.monopoly, planTotal: 100 }),
      row({ reason: REASON.currentLaw, planTotal: 100 }),
    ]);
    expect(topClustersOfGrade(d.byCluster, 'lawful-exclusive')).toHaveLength(1);
    expect(topClustersOfGrade(d.byCluster, 'unfounded', 0)).toHaveLength(0);
  });

  it('на экране нет латинских ключей: подпись есть у любого кластера', () => {
    expect(epClusterLabel('EMPTY')).toBe('Графа обоснования пуста');
    expect(epClusterLabel('UNMAPPED')).not.toMatch(/^EP_|UNMAPPED/);
    expect(epClusterLabel('EP_ЧЕГО-ТО-НЕТ')).not.toMatch(/^EP_/);
  });
});
