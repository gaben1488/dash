/**
 * Страж перевода «периметра шапки» в периметр разбора обоснований ЕП.
 *
 * Проверяется ровно то, что делает выборка и чего не делает ядро: отбор
 * управлений в обеих формах ключа ГРБС, квартальная сетка вместо месячной,
 * годовой периметр по умолчанию и честная пустота, когда управлений
 * периметра в ответе сервера нет.
 */
import { describe, expect, it } from 'vitest';
import { buildEpJustificationDept, type EpJustificationRow } from '@aemr/core';
import { reducibleTrend, selectEpGradeView } from './ep-grade-view';

const row = (r: Partial<EpJustificationRow>): EpJustificationRow => ({
  method: 'ЕП',
  reason: '',
  planTotal: 0,
  quarter: null,
  ...r,
});

/** Формулировки с проверенными кластерами словаря обоснований. */
const MONOPOLY = 'Монополист';
const NOT_WORTHWHILE = 'Проведение аукциона нецелесообразно';

const byDept = {
  uer: buildEpJustificationDept([
    row({ reason: MONOPOLY, planTotal: 100, quarter: 1 }),
    row({ reason: NOT_WORTHWHILE, planTotal: 100, quarter: 2 }),
    row({ method: 'ЭА', reason: '', planTotal: 200, quarter: 2 }),
    row({ reason: NOT_WORTHWHILE, planTotal: 40, quarter: null }),
  ]),
  uio: buildEpJustificationDept([
    row({ reason: NOT_WORTHWHILE, planTotal: 300, quarter: 1 }),
  ]),
};

const perimeter = (over: Partial<Parameters<typeof selectEpGradeView>[1]> = {}) => ({
  deptKeys: [] as string[],
  periodKeys: ['year'],
  hasActiveMonths: false,
  ...over,
});

describe('selectEpGradeView — периметр шапки → периметр разбора', () => {
  it('без отбора управлений складывает все и берёт год целиком', () => {
    const v = selectEpGradeView(byDept, perimeter());
    expect(v.wholeYear).toBe(true);
    expect(v.summary.ep.sum).toBe(540);
    expect(v.summary.competitive.sum).toBe(200);
    expect(v.summary.reducible.sum).toBe(440);
    // Строка без квартала плана в годовой итог входит.
    expect(v.noQuarter).toEqual({ rows: 1, sum: 40 });
  });

  it('отбор управления работает и кириллицей, и латиницей', () => {
    const lat = selectEpGradeView(byDept, perimeter({ deptKeys: ['uio'] }));
    const cyr = selectEpGradeView(byDept, perimeter({ deptKeys: ['УИО'] }));
    expect(lat.summary.ep.sum).toBe(300);
    expect(cyr.summary.ep.sum).toBe(300);
    expect(lat.summary.competitive.sum).toBe(0);
  });

  it('выбранный квартал сужает разбор и отбрасывает строки без квартала', () => {
    const v = selectEpGradeView(byDept, perimeter({ periodKeys: ['q1'] }));
    expect(v.wholeYear).toBe(false);
    expect(v.summary.ep.sum).toBe(400);
    expect(v.summary.reducible.sum).toBe(300);
    // 40 тыс. без квартала в квартальный итог не вошли, но названы отдельно.
    expect(v.noQuarter.sum).toBe(40);
  });

  it('выбор отдельных месяцев округляется до кварталов и объявляется', () => {
    const v = selectEpGradeView(byDept, perimeter({ periodKeys: ['q1', 'q2'], hasActiveMonths: true }));
    expect(v.roundedToQuarters).toBe(true);
    expect(v.summary.ep.sum).toBe(500);
  });

  it('динамика всегда годовая: четыре квартала независимо от выбора периода', () => {
    const v = selectEpGradeView(byDept, perimeter({ periodKeys: ['q1'] }));
    expect(v.dynamics).toHaveLength(4);
    expect(v.dynamics[1]!.ep.sum).toBe(100);
    expect(v.dynamics[1]!.epShareMoney).toBeCloseTo(33.3, 1);
    expect(v.dynamics[3]!.hasData).toBe(false);
  });

  it('ни одного управления периметра в ответе — честная пустота, а не нули', () => {
    const v = selectEpGradeView(byDept, perimeter({ deptKeys: ['УО'] }));
    expect(v.noDeptsMatched).toBe(true);
    expect(v.summary.hasData).toBe(false);
    expect(v.summary.epShareMoney).toBeNull();
    expect(v.dynamics).toHaveLength(4);
  });

  it('ответа сервера ещё нет — та же честная пустота', () => {
    const v = selectEpGradeView(null, perimeter());
    expect(v.noDeptsMatched).toBe(true);
    expect(v.summary.hasData).toBe(false);
    expect(v.clusters).toEqual({});
  });
});

describe('reducibleTrend — направление снижения', () => {
  it('сравнивает первый и последний квартал С ДАННЫМИ', () => {
    const v = selectEpGradeView(
      {
        uer: buildEpJustificationDept([
          row({ reason: NOT_WORTHWHILE, planTotal: 100, quarter: 1 }),
          row({ reason: NOT_WORTHWHILE, planTotal: 25, quarter: 3 }),
          row({ method: 'ЭА', reason: '', planTotal: 75, quarter: 3 }),
        ]),
      },
      perimeter(),
    );
    const t = reducibleTrend(v.dynamics);
    expect(t).not.toBeNull();
    expect(t!.first.index).toBe(1);
    expect(t!.last.index).toBe(3);
    expect(t!.deltaPp).toBe(-75);
  });

  it('меньше двух кварталов с данными — сравнивать нечего, не выдумываем', () => {
    const v = selectEpGradeView(
      { uer: buildEpJustificationDept([row({ reason: MONOPOLY, planTotal: 10, quarter: 2 })]) },
      perimeter(),
    );
    expect(reducibleTrend(v.dynamics)).toBeNull();
  });
});
