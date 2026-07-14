/**
 * quarterExecution — каноническая метрика «исполнение квартального плана» (G = E/D).
 *
 * Источник семантики (реверс-инжиниринг реального отчёта 20.03.2026, подтверждено
 * пользователем + формулы листа СВОД ТД-ПМ, см. scripts/gen_audit_docx.py):
 *   D («план на квартал»)  = COUNTIFS(O = квартал; P = год)
 *   E («исполнено»)        = те же критерии + Q<>"" / Q<>"Х" / Q<>"X" (дата факта)
 *   G = E / D
 *
 * Оба счётчика атрибуцируются по ПЛАН-кварталу (столбец O); дата факта с плановой
 * НЕ сравнивается — контракт, заключённый позже планового квартала, всё равно
 * «исполнено» для квартала своего плана (накопительно на дату среза).
 * Эталон отчёта на 20.03.2026 (Q1): УЭР 6/15 = 40.00%, УКСиМП 4/30 = 13.33%.
 */
import { describe, it, expect } from 'vitest';
import { DEPT_COLUMNS } from '@aemr/shared';
import { quarterExecution, quarterExecutionFromCounts } from './quarter-execution.js';

const COL = DEPT_COLUMNS;

interface RowOverrides {
  id?: string;
  method?: string;
  planQuarter?: number | string;
  planYear?: number | string;
  planDate?: string;
  factDate?: string;
}

/** Синтетическая строка ГРБС-листа (32 колонки), формат как в фикстурах core-тестов. */
function makeRow(overrides: RowOverrides = {}): unknown[] {
  const row: unknown[] = new Array(32).fill('');
  row[COL.ID] = overrides.id ?? '1';
  row[COL.TYPE] = 'Текущая деятельность';
  row[COL.SUBJECT] = 'Закупка';
  row[COL.FB_PLAN] = 100;
  row[COL.KB_PLAN] = 200;
  row[COL.MB_PLAN] = 0;
  row[COL.TOTAL_PLAN] = 300;
  row[COL.METHOD] = overrides.method ?? 'ЭА';
  row[COL.PLAN_DATE] = overrides.planDate ?? '15.01.2026';
  row[COL.PLAN_QUARTER] = overrides.planQuarter ?? 1;
  row[COL.PLAN_YEAR] = overrides.planYear ?? 2026;
  row[COL.FACT_DATE] = overrides.factDate ?? '';
  return row;
}

/** n строк плана квартала q, из них first `withFact` — с датой факта. */
function planRows(n: number, withFact: number, q: number): unknown[][] {
  return Array.from({ length: n }, (_, i) =>
    makeRow({
      id: `q${q}-${i + 1}`,
      planQuarter: q,
      factDate: i < withFact ? '20.02.2026' : '',
    }),
  );
}

describe('quarterExecution — G = E/D (канон СВОД, отчёт 20.03.2026)', () => {
  it('(а) базовый: 15 строк план Q1, 6 с фактом → 6/15 = 40.00', () => {
    const rows = planRows(15, 6, 1);
    const r = quarterExecution(rows, { quarter: 1, year: 2026 });
    expect(r.planCount).toBe(15);
    expect(r.doneCount).toBe(6);
    expect(r.pct).toBeCloseTo(40.0, 2);
  });

  it('(а) эталон УКСиМП: 4/30 → 13.33', () => {
    const rows = planRows(30, 4, 1);
    const r = quarterExecution(rows, { quarter: 1, year: 2026 });
    expect(r.planCount).toBe(30);
    expect(r.doneCount).toBe(4);
    expect(r.pct).toBeCloseTo(13.33, 2);
  });

  it('(б) строка с фактом, но с планом другого квартала — не в знаменателе (и не в числителе: атрибуция по O)', () => {
    const rows = [
      ...planRows(3, 1, 1),
      // Факт есть, но план — Q2: в метрику Q1 не входит вообще (E ⊆ D по столбцу O).
      makeRow({ id: 'q2-fact', planQuarter: 2, factDate: '10.02.2026' }),
    ];
    const r = quarterExecution(rows, { quarter: 1, year: 2026 });
    expect(r.planCount).toBe(3);
    expect(r.doneCount).toBe(1);
    expect(r.pct).toBeCloseTo(100 / 3, 2);
  });

  it('(б) строка с фактом без план-квартала (orphan) — не считается в квартале', () => {
    const rows = [
      ...planRows(2, 0, 1),
      makeRow({ id: 'orphan', planQuarter: '', factDate: '10.02.2026' }),
    ];
    const r = quarterExecution(rows, { quarter: 1, year: 2026 });
    expect(r.planCount).toBe(2);
    expect(r.doneCount).toBe(0);
    expect(r.pct).toBe(0);
  });

  it('накопительно: дата факта с плановой НЕ сравнивается — поздний факт (май) считается для Q1', () => {
    const rows = [
      makeRow({ id: 'late', planQuarter: 1, factDate: '15.05.2026' }), // заключён во 2-м кв.
      makeRow({ id: 'open', planQuarter: 1 }),
    ];
    const r = quarterExecution(rows, { quarter: 1, year: 2026 });
    expect(r.planCount).toBe(2);
    expect(r.doneCount).toBe(1);
    expect(r.pct).toBeCloseTo(50.0, 2);
  });

  it('заглушки Х/X/- в дате факта — НЕ факт (канон hasFactDate)', () => {
    const rows = [
      makeRow({ id: 'ph1', planQuarter: 1, factDate: 'Х' }),
      makeRow({ id: 'ph2', planQuarter: 1, factDate: 'X' }),
      makeRow({ id: 'ph3', planQuarter: 1, factDate: '-' }),
      makeRow({ id: 'real', planQuarter: 1, factDate: '20.02.2026' }),
    ];
    const r = quarterExecution(rows, { quarter: 1, year: 2026 });
    expect(r.planCount).toBe(4);
    expect(r.doneCount).toBe(1);
  });

  it('(в) пустой план на квартал → pct = null (честное «нет плана», не 0 и не 100)', () => {
    // Все планы — Q2; для Q1 знаменатель пуст.
    const rows = planRows(4, 2, 2);
    const r = quarterExecution(rows, { quarter: 1, year: 2026 });
    expect(r.planCount).toBe(0);
    expect(r.doneCount).toBe(0);
    expect(r.pct).toBeNull();
  });

  it('(в) пустой план остаётся null даже при наличии orphan-факта', () => {
    const rows = [makeRow({ id: 'orphan', planQuarter: '', factDate: '10.02.2026' })];
    const r = quarterExecution(rows, { quarter: 1, year: 2026 });
    expect(r.planCount).toBe(0);
    expect(r.pct).toBeNull();
  });

  it('(г) перевыполнение: формула не капит pct на 100', () => {
    // Из строк ГРБС-листа E > D не собрать: критерии E = критерии D + гейт даты
    // факта (E ⊆ D по построению COUNTIFS). Но счётчики могут приходить и из
    // готовых ячеек СВОД (двухисточниковость D1), где D и E — независимые
    // формулы/ручные правки: формула G = E/D обязана не капить.
    const r = quarterExecutionFromCounts(10, 12);
    expect(r.planCount).toBe(10);
    expect(r.doneCount).toBe(12);
    expect(r.pct).toBeCloseTo(120.0, 2);
  });

  it('(г) fromCounts: пустой план → null, не 0 и не 100', () => {
    expect(quarterExecutionFromCounts(0, 0).pct).toBeNull();
    expect(quarterExecutionFromCounts(0, 5).pct).toBeNull();
  });

  it('(д) year-фильтр: строки другого план-года не считаются', () => {
    const rows = [
      ...planRows(3, 2, 1), // 2026 (дефолт фикстуры)
      makeRow({ id: 'y25-1', planQuarter: 1, planYear: 2025, factDate: '20.02.2025' }),
      makeRow({ id: 'y25-2', planQuarter: 1, planYear: 2025 }),
    ];
    const r = quarterExecution(rows, { quarter: 1, year: 2026 });
    expect(r.planCount).toBe(3);
    expect(r.doneCount).toBe(2);
  });

  it('(д) пустой план-год не отсекается year-фильтром (канон CalcEngine: rowYear > 0)', () => {
    const rows = [
      ...planRows(2, 1, 1),
      makeRow({ id: 'no-year', planQuarter: 1, planYear: '', factDate: '20.02.2026' }),
    ];
    const r = quarterExecution(rows, { quarter: 1, year: 2026 });
    expect(r.planCount).toBe(3);
    expect(r.doneCount).toBe(2);
  });

  it('(д) без year-опции считаются все годы', () => {
    const rows = [
      ...planRows(2, 1, 1),
      makeRow({ id: 'y25', planQuarter: 1, planYear: 2025, factDate: '20.02.2025' }),
    ];
    const r = quarterExecution(rows, { quarter: 1 });
    expect(r.planCount).toBe(3);
    expect(r.doneCount).toBe(2);
  });

  it('метрика считает ВСЕ методы вместе (КП + ЕП), как колонка G сводного отчёта', () => {
    const rows = [
      makeRow({ id: 'kp', method: 'ЭА', planQuarter: 1, factDate: '20.02.2026' }),
      makeRow({ id: 'ep', method: 'ЕП', planQuarter: 1, factDate: '21.02.2026' }),
      makeRow({ id: 'ek', method: 'ЭК', planQuarter: 1 }),
    ];
    const r = quarterExecution(rows, { quarter: 1, year: 2026 });
    expect(r.planCount).toBe(3);
    expect(r.doneCount).toBe(2);
    expect(r.pct).toBeCloseTo(200 / 3, 2);
  });

  it('строки-итоги и мусор отсеиваются каноническим standardRowFilter', () => {
    const summary = makeRow({ id: 'sum', planQuarter: 1 });
    summary[COL.SUBJECT] = 'ИТОГО по управлению';
    const junk: unknown[] = new Array(32).fill(''); // пустая строка
    const rows = [...planRows(2, 1, 1), summary, junk];
    const r = quarterExecution(rows, { quarter: 1, year: 2026 });
    expect(r.planCount).toBe(2);
    expect(r.doneCount).toBe(1);
  });
});
