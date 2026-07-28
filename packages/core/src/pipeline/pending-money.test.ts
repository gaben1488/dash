/**
 * Остаток в плановых деньгах: метрики pending_* движка.
 *
 * Прямой запрос ГРБС-специалиста (27.07): «сколько в плановых деньгах по
 * оставшимся процедурам с разбивкой по бюджетам». В ручном отчёте это
 * строка вида «Остаток незаключенных договоров … 90 на общую сумму
 * 421 474,29 тыс. руб. (ФБ — 68 878,04, КБ — 121 605,66, МБ — 230 990,58)».
 *
 * Главное, что здесь закрепляется: остаток считается по ПЛАНОВЫМ столбцам
 * незаключённых строк, а НЕ как «план минус факт». Факт — цена контракта,
 * она ниже плана, и разность дала бы экономию, а не остаток работ.
 */
import { describe, it, expect } from 'vitest';
import { DEPT_COLUMNS, dayNumberOf } from '@aemr/shared';
import { CalcEngine, getValue, standardRowFilter } from './calc-engine.js';

const COL = DEPT_COLUMNS;
const ENGINE = new CalcEngine();

/** Строка листа ГРБС: план по трём бюджетам, факт — если задана дата. */
function row(opts: {
  id: string;
  method: string;
  quarter: number;
  fb: number; kb: number; mb: number;
  factDate?: string;
  factTotal?: number;
}): unknown[] {
  const r: unknown[] = new Array(33).fill('');
  r[COL.ID] = opts.id;
  r[COL.TYPE] = 'Текущая деятельность';
  r[COL.SUBJECT] = `Закупка ${opts.id}`;
  r[COL.METHOD] = opts.method;
  r[COL.PLAN_DATE] = '15.01.2026';
  r[COL.PLAN_QUARTER] = opts.quarter;
  r[COL.PLAN_YEAR] = 2026;
  r[COL.FB_PLAN] = opts.fb;
  r[COL.KB_PLAN] = opts.kb;
  r[COL.MB_PLAN] = opts.mb;
  r[COL.TOTAL_PLAN] = opts.fb + opts.kb + opts.mb;
  if (opts.factDate !== undefined) {
    r[COL.FACT_DATE] = opts.factDate;
    r[COL.TOTAL_FACT] = opts.factTotal ?? 0;
  }
  return r;
}

const HEADERS = [new Array(33).fill('h'), new Array(33).fill('h'), new Array(33).fill('h')];

describe('pending_* — остаток в плановых деньгах', () => {
  const rows = [
    ...HEADERS,
    // Заключены: в остаток не идут, хотя их план — 100 + 200
    row({ id: 'a', method: 'ЭА', quarter: 1, fb: 100, kb: 0, mb: 0, factDate: '10.02.2026', factTotal: 90 }),
    row({ id: 'b', method: 'ЕП', quarter: 1, fb: 0, kb: 200, mb: 0, factDate: '11.02.2026', factTotal: 150 }),
    // Не заключены: их плановые суммы и есть остаток
    row({ id: 'c', method: 'ЭА', quarter: 2, fb: 10, kb: 20, mb: 30 }),
    row({ id: 'd', method: 'ЕП', quarter: 2, fb: 1, kb: 2, mb: 3 }),
    row({ id: 'e', method: 'ЭА', quarter: 3, fb: 0, kb: 0, mb: 500 }),
  ];
  const g = ENGINE.compute(rows, standardRowFilter, 0, 2026);

  it('считает по плановым столбцам незаключённых, а не как план минус факт', () => {
    // План минус факт дал бы (100+200+60+6+500) − (90+150) = 626 — это не остаток.
    expect(getValue(g, 'pending_total')).toBe(60 + 6 + 500);
    expect(getValue(g, 'pending_count')).toBe(3);
  });

  it('разбивка по бюджетам сходится с итогом', () => {
    const fb = getValue(g, 'pending_fb');
    const kb = getValue(g, 'pending_kb');
    const mb = getValue(g, 'pending_mb');
    expect(fb).toBe(10 + 1);
    expect(kb).toBe(20 + 2);
    expect(mb).toBe(30 + 3 + 500);
    expect(fb + kb + mb).toBe(getValue(g, 'pending_total'));
  });

  it('остаток + факт-строки = все строки плана (ничего не потеряно)', () => {
    expect(getValue(g, 'pending_count') + getValue(g, 'fact_count')).toBe(getValue(g, 'plan_count'));
  });

  it('режется по кварталам: во 2 квартале остаток 66, в 3 — 500', () => {
    expect(getValue(g, 'pending_total', 'q2')).toBe(66);
    expect(getValue(g, 'pending_total', 'q3')).toBe(500);
    expect(getValue(g, 'pending_count', 'q1')).toBe(0);
  });

  it('режется по способам: КП и ЕП раздельно', () => {
    expect(getValue(g, 'pending_total', 'q2.competitive')).toBe(60);
    expect(getValue(g, 'pending_total', 'q2.ep')).toBe(6);
  });

  it('дата факта позже среза = ещё не заключено (та же граница, что у факта)', () => {
    const late = [
      ...HEADERS,
      row({ id: 'x', method: 'ЭА', quarter: 1, fb: 0, kb: 0, mb: 700, factDate: '20.03.2026', factTotal: 650 }),
    ];
    // Срез 01.03.2026 — заключение 20.03 в него не входит.
    const asOfDay = dayNumberOf('2026-03-01')!;
    const gated = ENGINE.compute(late, standardRowFilter, 0, 2026, { asOfDay });
    expect(gated && getValue(gated, 'pending_total')).toBe(700);
    expect(getValue(gated, 'fact_count')).toBe(0);
    // Без среза та же строка — уже заключена, остатка нет.
    const live = ENGINE.compute(late, standardRowFilter, 0, 2026);
    expect(getValue(live, 'pending_total')).toBe(0);
    expect(getValue(live, 'fact_count')).toBe(1);
  });

  it('заглушка «Х» в дате факта — не заключено (канон hasFactDate)', () => {
    const stub = [
      ...HEADERS,
      row({ id: 'y', method: 'ЕП', quarter: 1, fb: 0, kb: 0, mb: 42, factDate: 'Х' }),
    ];
    const gs = ENGINE.compute(stub, standardRowFilter, 0, 2026);
    expect(getValue(gs, 'pending_total')).toBe(42);
    expect(getValue(gs, 'fact_count')).toBe(0);
  });
});
