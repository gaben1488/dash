/**
 * Свод района из метрик ГРБС (mergeSummaryMetrics).
 *
 * Характеризационный тест: у оркестратора не было ни одного теста, а
 * свод — единственное место, где числа района рождаются суммированием
 * строковых ключей, а не проходом движка (пирамида агрегации §4.2).
 * Фиксируем контракт до дальнейшего разреза: кварталы и год складываются
 * как прежде, месяцы теперь тоже складываются, проценты пересчитываются
 * из слитых счётчиков, а не усредняются.
 */
import { describe, expect, it } from 'vitest';
import { CYRILLIC_TO_LATIN, DEPT_COLUMNS } from '@aemr/shared';
import { runPipeline } from './orchestrator.js';

const COL = DEPT_COLUMNS;

/** Строка листа ГРБС: способ, план-квартал, план-дата, деньги, факт. */
function row(o: {
  id: string;
  method: string;
  quarter: number;
  planDate: string;
  plan: number;
  factDate?: string;
  fact?: number;
}): unknown[] {
  const r: unknown[] = new Array(34).fill('');
  r[COL.ID] = o.id;
  r[COL.TYPE] = 'Текущая деятельность';
  r[COL.SUBJECT] = `Закупка ${o.id}`;
  r[COL.FB_PLAN] = o.plan;
  r[COL.TOTAL_PLAN] = o.plan;
  r[COL.METHOD] = o.method;
  r[COL.PLAN_DATE] = o.planDate;
  r[COL.PLAN_QUARTER] = o.quarter;
  r[COL.PLAN_YEAR] = 2026;
  if (o.factDate) {
    r[COL.FACT_DATE] = o.factDate;
    r[COL.FB_FACT] = o.fact ?? o.plan;
    r[COL.TOTAL_FACT] = o.fact ?? o.plan;
  }
  return r;
}

/** Шапка листа (DEPT_HEADER_ROWS строк) плюс строки данных. */
function sheet(rows: unknown[][]): unknown[][] {
  return [[], [], [], ...rows];
}

function runOn(sheetRows: Record<string, unknown[][]>) {
  return runPipeline({
    batchGetData: [],
    sheetRows,
    reportMap: [],
    rules: [],
    spreadsheetId: 'test',
  });
}

/**
 * Две книги: УО (январь, КП) и УЭР (январь + февраль, КП и ЕП).
 * Ожидание района по январю = сумма обеих книг.
 */
const SHEETS = {
  'УО': sheet([
    row({ id: 'uo-1', method: 'ЭА', quarter: 1, planDate: '15.01.2026', plan: 100, factDate: '20.01.2026', fact: 90 }),
    row({ id: 'uo-2', method: 'ЭА', quarter: 1, planDate: '20.01.2026', plan: 200 }),
  ]),
  'УЭР': sheet([
    row({ id: 'uer-1', method: 'ЭА', quarter: 1, planDate: '10.01.2026', plan: 300, factDate: '25.01.2026', fact: 280 }),
    row({ id: 'uer-2', method: 'ЕП', quarter: 1, planDate: '12.02.2026', plan: 50, factDate: '15.02.2026', fact: 50 }),
  ]),
};

function metric(snapshot: ReturnType<typeof runOn>, key: string): number | undefined {
  return snapshot.calculatedMetrics[key]?.numericValue ?? undefined;
}

describe('mergeSummaryMetrics — квартал и год', () => {
  const snap = runOn(SHEETS);

  it('счёт КП квартала района = сумма книг', () => {
    // УО: 2 строки ЭА, УЭР: 1 строка ЭА → 3.
    expect(metric(snap, 'competitive.q1.count')).toBe(3);
    expect(metric(snap, 'competitive.q1.fact_count')).toBe(2);
  });

  it('деньги КП квартала района = сумма книг', () => {
    expect(metric(snap, 'competitive.q1.total_plan')).toBe(600);
    expect(metric(snap, 'competitive.q1.total_fact')).toBe(370);
  });

  it('ЕП считается отдельным ярусом', () => {
    expect(metric(snap, 'sole.q1.count')).toBe(1);
    expect(metric(snap, 'sole.q1.total_plan')).toBe(50);
  });

  it('процент пересчитан из слитых счётчиков, а не усреднён по ГРБС', () => {
    // Усреднение дало бы (1/2 + 1/1) / 2 = 0.75; правильная свёртка 2/3.
    expect(metric(snap, 'competitive.q1.percent')).toBeCloseTo(2 / 3, 6);
  });

  it('отклонение считается в направлении листа СВОД: факт минус план', () => {
    expect(metric(snap, 'competitive.q1.deviation')).toBe(-1);
  });
});

describe('mergeSummaryMetrics — помесячный свод (gap №3 пирамиды)', () => {
  const snap = runOn(SHEETS);

  it('январь района складывается из книг', () => {
    // Январь: УО 2 строки ЭА (100+200), УЭР 1 строка ЭА (300).
    expect(metric(snap, 'competitive.m1.count')).toBe(3);
    expect(metric(snap, 'competitive.m1.total_plan')).toBe(600);
    expect(metric(snap, 'competitive.m1.fact_count')).toBe(2);
  });

  it('февральский ЕП виден отдельно от январского КП', () => {
    expect(metric(snap, 'sole.m2.count')).toBe(1);
    expect(metric(snap, 'sole.m2.total_plan')).toBe(50);
    // В январе ЕП не было, но сам январь существует (в нём есть КП),
    // поэтому нулевой ЕП-ключ осмыслен: «месяц посчитан, ЕП не было».
    // Отсутствие ключа означало бы «месяц не считали» — другое утверждение.
    expect(metric(snap, 'sole.m1.count')).toBe(0);
  });

  it('месяц без строк не материализуется: ноль неотличим от «не считали»', () => {
    expect(metric(snap, 'competitive.m7.count')).toBeUndefined();
    expect(metric(snap, 'sole.m12.total_plan')).toBeUndefined();
  });

  it('сумма месяцев квартала сходится с самим кварталом', () => {
    const m1 = metric(snap, 'competitive.m1.total_plan') ?? 0;
    const m2 = metric(snap, 'competitive.m2.total_plan') ?? 0;
    const m3 = metric(snap, 'competitive.m3.total_plan') ?? 0;
    expect(m1 + m2 + m3).toBe(metric(snap, 'competitive.q1.total_plan'));
  });
});

/**
 * Характеризационный замок ПЕРЕД упрощением C1 (SIMPLIFY_REGISTER_2026-06-05):
 * два одинаковых литерала `unitMap`/`periodMap` пересобирались на каждый вызов
 * `put()` и `putSummary()`. Вынос в константы модуля обязан оставить разметку
 * метрик прежней — единицу, период и печатное представление.
 */
describe('C1 — разметка единиц и периода у метрик оркестратора', () => {
  const snap = runOn(SHEETS);
  const uo = CYRILLIC_TO_LATIN['УО'];

  it('ярус ГРБС: счёт, деньги и доля получают свою единицу', () => {
    expect(snap.calculatedMetrics[`grbs.${uo}.kp.q1.count`]?.unit).toBe('count');
    expect(snap.calculatedMetrics[`grbs.${uo}.kp.q1.total_plan`]?.unit).toBe('rubles');
    expect(snap.calculatedMetrics[`grbs.${uo}.kp.q1.percent`]?.unit).toBe('percent');
  });

  it('ярус ГРБС: квартал остаётся кварталом, год становится «annual»', () => {
    expect(snap.calculatedMetrics[`grbs.${uo}.kp.q1.count`]?.period).toBe('q1');
    expect(snap.calculatedMetrics[`grbs.${uo}.kp.year.count`]?.period).toBe('annual');
  });

  it('ярус ГРБС: печатное представление зависит от единицы', () => {
    expect(snap.calculatedMetrics[`grbs.${uo}.kp.q1.total_plan`]?.displayValue).toContain('₽');
    expect(snap.calculatedMetrics[`grbs.${uo}.kp.q1.percent`]?.displayValue).toContain('%');
    expect(snap.calculatedMetrics[`grbs.${uo}.kp.q1.count`]?.displayValue).toBe('2');
  });

  it('ярус района: та же разметка на своде', () => {
    expect(snap.calculatedMetrics['competitive.q1.count']?.unit).toBe('count');
    expect(snap.calculatedMetrics['competitive.q1.count']?.period).toBe('q1');
    expect(snap.calculatedMetrics['competitive.q1.total_plan']?.unit).toBe('rubles');
    expect(snap.calculatedMetrics['competitive.year.count']?.period).toBe('annual');
  });

  it('месяц периодом не считается: в карте нет месяцев, поэтому «annual»', () => {
    // Не улучшение, а фиксация текущего поведения: месячные ключи различимы
    // по имени метрики, а поле period у них общерайонное «annual».
    expect(snap.calculatedMetrics['competitive.m1.count']?.period).toBe('annual');
  });
});
