/**
 * Страж разбивки доли ЕП по учреждениям (режим подведов, приказ 20.08.2026).
 *
 * Проверяется ровно то, за что отвечает выборка: аппарат первой строкой,
 * алфавит дальше, каноничное учреждение без строк остаётся видимым с честным
 * «строк нет», живое учреждение вне канона не теряется, а доли не подменяют
 * отсутствие базы нулём.
 */
import { describe, expect, it } from 'vitest';
import { ORG_ITSELF_SENTINEL } from '@aemr/shared';
import { buildEpSubRows, shareOf, sumEpSubRows } from './ep-sub-view';

/** Запись учреждения в том виде, в каком её отдаёт расчёт (byMethod-срез). */
const sub = (name: string, ep: [number, number], kp: [number, number]) => ({
  name,
  byMethod: {
    ep: { planCount: ep[0], planTotal: ep[1] },
    competitive: { planCount: kp[0], planTotal: kp[1] },
  },
});

describe('buildEpSubRows', () => {
  it('ставит аппарат управления первой строкой и подписывает его по-русски', () => {
    const rows = buildEpSubRows([sub(ORG_ITSELF_SENTINEL, [2, 100], [1, 300])], []);
    expect(rows[0].key).toBe(ORG_ITSELF_SENTINEL);
    expect(rows[0].label).toBe('Аппарат управления');
    expect(rows[0].epCount).toBe(2);
    expect(rows[0].kpPlan).toBe(300);
  });

  it('выстраивает учреждения по алфавиту после аппарата', () => {
    const rows = buildEpSubRows(
      [sub('Ясень', [1, 10], [0, 0]), sub('Берёза', [1, 10], [0, 0])],
      [],
    );
    expect(rows.map((r) => r.label)).toEqual(['Аппарат управления', 'Берёза', 'Ясень']);
  });

  it('держит каноничное учреждение без строк — «строк нет», а не «организации нет»', () => {
    const rows = buildEpSubRows([sub(ORG_ITSELF_SENTINEL, [1, 10], [1, 10])], ['Школа №1']);
    const school = rows.find((r) => r.key === 'Школа №1');
    expect(school).toBeDefined();
    expect(school!.hasData).toBe(false);
    expect(school!.countShare).toBeNull();
    expect(school!.moneyShare).toBeNull();
  });

  it('не теряет живое учреждение, которого канон ещё не знает', () => {
    const rows = buildEpSubRows([sub('Новый детский сад', [3, 90], [0, 0])], ['Школа №1']);
    expect(rows.map((r) => r.key)).toContain('Новый детский сад');
    expect(rows.find((r) => r.key === 'Новый детский сад')!.hasData).toBe(true);
  });

  it('считает обе доли от своих оснований: счётную от процедур, денежную от плана', () => {
    const rows = buildEpSubRows([sub('Школа №1', [3, 250], [1, 750])], []);
    const school = rows.find((r) => r.key === 'Школа №1')!;
    expect(school.countShare).toBeCloseTo(75);
    expect(school.moneyShare).toBeCloseTo(25);
  });

  it('пустой список строк даёт одну строку аппарата без данных', () => {
    const rows = buildEpSubRows(undefined, []);
    expect(rows).toHaveLength(1);
    expect(rows[0].hasData).toBe(false);
  });

  it('строки с признаками «само управление» сливаются в аппарат, а не плодят подведы', () => {
    const rows = buildEpSubRows([sub('', [1, 10], [0, 0])], []);
    expect(rows).toHaveLength(1);
    expect(rows[0].key).toBe(ORG_ITSELF_SENTINEL);
    expect(rows[0].epCount).toBe(1);
  });
});

describe('shareOf', () => {
  it('возвращает null при неположительном целом — делить не на что', () => {
    expect(shareOf(0, 0)).toBeNull();
    expect(shareOf(5, -1)).toBeNull();
  });
});

describe('sumEpSubRows', () => {
  it('складывает разбивку и считает организации с живыми строками', () => {
    const rows = buildEpSubRows(
      [sub(ORG_ITSELF_SENTINEL, [1, 100], [1, 100]), sub('Школа №1', [2, 200], [0, 0])],
      ['Школа №2'],
    );
    const total = sumEpSubRows(rows);
    expect(total.epCount).toBe(3);
    expect(total.kpPlan).toBe(100);
    expect(total.withData).toBe(2);
  });
});
