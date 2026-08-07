/**
 * Характеризационные тесты экономических метрик первого эшелона (план §2).
 *
 * Каждая метрика проверяется по четырём осям, обязательным для чисел этого
 * продукта: положительный сценарий с известным ответом, граница порога
 * (чтобы зона не «поехала» при правке констант), пустой знаменатель —
 * обязательно null, а не ноль, и классификация зон.
 */
import { describe, it, expect } from 'vitest';
import { DEPT_COLUMNS } from '@aemr/shared';
import {
  decemberOverhang,
  planningAccuracy,
  sourceExecutionGap,
  quarterCompliance,
  classifyDecemberOverhang,
  classifyPlanningAccuracy,
  planningAccuracyGrade,
  classifySourceExecutionGap,
  classifyQuarterCompliance,
  DECEMBER_OVERHANG_THRESHOLDS,
  PLANNING_ACCURACY_GRADES,
  SOURCE_GAP_THRESHOLDS,
  QUARTER_COMPLIANCE_THRESHOLDS,
} from './economic.js';

const COL = DEPT_COLUMNS;

interface RowOverrides {
  id?: string;
  method?: string;
  planQuarter?: number | string;
  planYear?: number | string;
  factQuarter?: number | string;
  factYear?: number | string;
  factDate?: string;
  planFB?: number;
  planKB?: number;
  planMB?: number;
  planTotal?: number;
  factFB?: number;
  factKB?: number;
  factMB?: number;
  factTotal?: number;
}

/** Синтетическая строка ГРБС-листа (34 колонки) — формат фикстур core-тестов. */
function makeRow(o: RowOverrides = {}): unknown[] {
  const row: unknown[] = new Array(34).fill('');
  row[COL.ID] = o.id ?? '1';
  row[COL.TYPE] = 'Текущая деятельность';
  row[COL.SUBJECT] = 'Закупка';
  row[COL.METHOD] = o.method ?? 'ЭА';
  row[COL.FB_PLAN] = o.planFB ?? 0;
  row[COL.KB_PLAN] = o.planKB ?? 0;
  row[COL.MB_PLAN] = o.planMB ?? 0;
  row[COL.TOTAL_PLAN] = o.planTotal ?? 0;
  row[COL.PLAN_DATE] = '15.01.2026';
  row[COL.PLAN_QUARTER] = o.planQuarter ?? '';
  row[COL.PLAN_YEAR] = o.planYear ?? 2026;
  row[COL.FACT_DATE] = o.factDate ?? '';
  row[COL.FACT_QUARTER] = o.factQuarter ?? '';
  row[COL.FACT_YEAR] = o.factYear ?? '';
  row[COL.FB_FACT] = o.factFB ?? 0;
  row[COL.KB_FACT] = o.factKB ?? 0;
  row[COL.MB_FACT] = o.factMB ?? 0;
  row[COL.TOTAL_FACT] = o.factTotal ?? 0;
  return row;
}

// ── 1. Индекс декабрьского навеса ────────────────────────────────────

describe('decemberOverhang — доля Q4 в годовом факте', () => {
  it('позитив: деньги и количество считаются по разным знаменателям', () => {
    const rows = [
      makeRow({ id: 'q1', factQuarter: 1, factYear: 2026, factDate: '10.02.2026', factTotal: 100 }),
      makeRow({ id: 'q2', factQuarter: 2, factYear: 2026, factDate: '10.05.2026', factTotal: 100 }),
      makeRow({ id: 'q3', factQuarter: 3, factYear: 2026, factDate: '10.08.2026', factTotal: 100 }),
      makeRow({ id: 'q4', factQuarter: 4, factYear: 2026, factDate: '20.12.2026', factTotal: 300 }),
    ];
    const r = decemberOverhang(rows, { year: 2026 });
    // Деньги: 300 из 600 — половина года уехала в декабрь.
    expect(r.money.numerator).toBe(300);
    expect(r.money.denominator).toBe(600);
    expect(r.money.pct).toBeCloseTo(50, 6);
    // Количество: одна процедура из четырёх — 25 %. Разные знаменатели
    // дают разные ответы; именно поэтому обе доли выдаются рядом.
    expect(r.count.pct).toBeCloseTo(25, 6);
    expect(r.zone).toBe('red');
    // Провенанс: строки числителя и знаменателя названы поимённо.
    expect(r.money.numeratorRows).toEqual([3]);
    expect(r.money.denominatorRows).toEqual([0, 1, 2, 3]);
  });

  it('квартал факта берётся из даты Q, когда столбец R пуст, и это видно в счётчике', () => {
    const rows = [
      makeRow({ id: 'a', factDate: '15.03.2026', factTotal: 100 }),
      makeRow({ id: 'b', factDate: '15.11.2026', factTotal: 100 }),
    ];
    const r = decemberOverhang(rows, { year: 2026 });
    expect(r.money.pct).toBeCloseTo(50, 6);
    expect(r.quarterFromDateCount).toBe(2);
  });

  it('факт без определимого квартала остаётся в знаменателе и помечен отдельно', () => {
    const rows = [
      makeRow({ id: 'q4', factQuarter: 4, factYear: 2026, factDate: '20.12.2026', factTotal: 100 }),
      // Дата-мусор: гейт факта её пропускает (заявленное заключение), а
      // квартал из неё не выводится — деньги реальны, привязки нет.
      makeRow({ id: 'junk', factDate: 'см. примечание', factTotal: 100 }),
    ];
    const r = decemberOverhang(rows);
    expect(r.money.denominator).toBe(200);
    expect(r.money.pct).toBeCloseTo(50, 6);
    expect(r.unattributed).toEqual({ count: 1, amount: 100, rows: [1] });
  });

  it('годовой фильтр идёт по году ФАКТА, а не плана', () => {
    const rows = [
      makeRow({ id: 'y26', planYear: 2026, factQuarter: 4, factYear: 2026, factDate: '20.12.2026', factTotal: 100 }),
      // План 2026-го, заключён в 2025-м: для года факта 2026 строки нет.
      makeRow({ id: 'y25', planYear: 2026, factQuarter: 4, factYear: 2025, factDate: '20.12.2025', factTotal: 900 }),
    ];
    const r = decemberOverhang(rows, { year: 2026 });
    expect(r.money.denominator).toBe(100);
  });

  it('срез: факт позже даты среза не засчитывается (канон factCountsOn)', () => {
    const rows = [
      makeRow({ id: 'early', factQuarter: 1, factDate: '10.02.2026', factTotal: 100 }),
      makeRow({ id: 'late', factQuarter: 4, factDate: '20.12.2026', factTotal: 100 }),
    ];
    // 01.07.2026 = 20 635-е сутки эпохи; декабрьская строка ещё не наступила.
    const asOfDay = Date.UTC(2026, 6, 1) / 86400000;
    const r = decemberOverhang(rows, { asOfDay });
    expect(r.money.denominator).toBe(100);
    expect(r.money.pct).toBe(0);
  });

  it('пустой знаменатель: года без факта → null, а не ноль', () => {
    const rows = [makeRow({ id: 'plan-only', planTotal: 500 })];
    const r = decemberOverhang(rows, { year: 2026 });
    expect(r.money.denominator).toBe(0);
    expect(r.money.pct).toBeNull();
    expect(r.count.pct).toBeNull();
    expect(r.zone).toBeNull();
  });

  it('граница порога: 35 — ещё норма, 45 — ещё жёлтый', () => {
    expect(classifyDecemberOverhang(DECEMBER_OVERHANG_THRESHOLDS.normalMaxPct)).toBe('normal');
    expect(classifyDecemberOverhang(35.01)).toBe('yellow');
    expect(classifyDecemberOverhang(DECEMBER_OVERHANG_THRESHOLDS.yellowMaxPct)).toBe('yellow');
    expect(classifyDecemberOverhang(45.01)).toBe('red');
    expect(classifyDecemberOverhang(null)).toBeNull();
  });
});

// ── 2. Точность планирования (PEFA PI-1) ─────────────────────────────

describe('planningAccuracy — PEFA PI-1', () => {
  it('позитив: агрегат сходится, а медиана показывает разброс строк', () => {
    const rows = [
      makeRow({ id: 'a', planTotal: 100, factTotal: 95, factDate: '10.02.2026' }),
      makeRow({ id: 'b', planTotal: 100, factTotal: 105, factDate: '10.03.2026' }),
    ];
    const r = planningAccuracy(rows, { year: 2026 });
    expect(r.planTotal).toBe(200);
    expect(r.factTotal).toBe(200);
    // Ошибки строк погасили друг друга: сумма сошлась случайно.
    expect(r.aggregate.pct).toBeCloseTo(0, 6);
    expect(r.grade).toBe('A');
    // Медиана этого не прощает: каждая строка промахнулась на 5 %.
    expect(r.medianPct).toBeCloseTo(5, 6);
    expect(r.medianRowCount).toBe(2);
  });

  it('знак отклонения выдаётся отдельно от его величины', () => {
    const rows = [makeRow({ id: 'a', planTotal: 100, factTotal: 80, factDate: '10.02.2026' })];
    const r = planningAccuracy(rows, { year: 2026 });
    expect(r.aggregate.pct).toBeCloseTo(20, 6);
    expect(r.signedPct).toBeCloseTo(-20, 6);
    expect(r.grade).toBe('D');
    expect(r.zone).toBe('red');
  });

  it('незаключённые строки по умолчанию вне периметра, с includePending — внутри', () => {
    const rows = [
      makeRow({ id: 'done', planTotal: 100, factTotal: 100, factDate: '10.02.2026' }),
      makeRow({ id: 'pending', planTotal: 100 }),
    ];
    const byDefault = planningAccuracy(rows, { year: 2026 });
    expect(byDefault.planTotal).toBe(100);
    expect(byDefault.aggregate.pct).toBeCloseTo(0, 6);
    expect(byDefault.pendingRows).toEqual([1]);

    const yearEnd = planningAccuracy(rows, { year: 2026, includePending: true });
    expect(yearEnd.planTotal).toBe(200);
    expect(yearEnd.factTotal).toBe(100);
    expect(yearEnd.aggregate.pct).toBeCloseTo(50, 6);
    expect(yearEnd.grade).toBe('D');
  });

  it('строка с нулевым планом не делится: в медиану не идёт, названа отдельно', () => {
    const rows = [
      makeRow({ id: 'a', planTotal: 100, factTotal: 90, factDate: '10.02.2026' }),
      makeRow({ id: 'zero-plan', planTotal: 0, factTotal: 50, factDate: '11.02.2026' }),
    ];
    const r = planningAccuracy(rows, { year: 2026 });
    expect(r.zeroPlanRows).toEqual([1]);
    expect(r.medianRowCount).toBe(1);
    expect(r.medianPct).toBeCloseTo(10, 6);
    // В агрегат внеплановые деньги входят: они потрачены.
    expect(r.factTotal).toBe(140);
  });

  it('план читается с фолбэком K → H+I+J, как plan_total движка', () => {
    const rows = [
      makeRow({ id: 'a', planFB: 30, planKB: 70, planTotal: 0, factTotal: 100, factDate: '10.02.2026' }),
    ];
    const r = planningAccuracy(rows, { year: 2026 });
    expect(r.planTotal).toBe(100);
    expect(r.aggregate.pct).toBeCloseTo(0, 6);
  });

  it('пустой знаменатель: нет плановых денег → null, а не ноль', () => {
    const rows = [makeRow({ id: 'a', planTotal: 0, factTotal: 0, factDate: '10.02.2026' })];
    const r = planningAccuracy(rows, { year: 2026 });
    expect(r.planTotal).toBe(0);
    expect(r.aggregate.pct).toBeNull();
    expect(r.signedPct).toBeNull();
    expect(r.medianPct).toBeNull();
    expect(r.grade).toBeNull();
    expect(r.zone).toBeNull();
  });

  it('граница порога: 5 — ещё A, 10 — ещё B, 15 — ещё C', () => {
    expect(planningAccuracyGrade(PLANNING_ACCURACY_GRADES.A)).toBe('A');
    expect(planningAccuracyGrade(5.01)).toBe('B');
    expect(planningAccuracyGrade(PLANNING_ACCURACY_GRADES.B)).toBe('B');
    expect(planningAccuracyGrade(10.01)).toBe('C');
    expect(planningAccuracyGrade(PLANNING_ACCURACY_GRADES.C)).toBe('C');
    expect(planningAccuracyGrade(15.01)).toBe('D');
    expect(planningAccuracyGrade(null)).toBeNull();
  });

  it('классификация зон: A и B — норма, C — жёлтый, D — красный', () => {
    expect(classifyPlanningAccuracy(3)).toBe('normal');
    expect(classifyPlanningAccuracy(9)).toBe('normal');
    expect(classifyPlanningAccuracy(12)).toBe('yellow');
    expect(classifyPlanningAccuracy(20)).toBe('red');
    expect(classifyPlanningAccuracy(null)).toBeNull();
  });

  it('граница порога на живых строках: отклонение ровно 5 % даёт A', () => {
    const rows = [makeRow({ id: 'a', planTotal: 100, factTotal: 105, factDate: '10.02.2026' })];
    const r = planningAccuracy(rows, { year: 2026 });
    expect(r.aggregate.pct).toBeCloseTo(5, 6);
    expect(r.grade).toBe('A');
    expect(r.zone).toBe('normal');
  });
});

// ── 3. Разрыв освоения по источникам ─────────────────────────────────

describe('sourceExecutionGap — расхождение освоения ФБ/КБ/МБ', () => {
  it('позитив: максимальная попарная разница и её адрес', () => {
    const rows = [
      makeRow({
        id: 'a',
        planFB: 100, planKB: 100, planMB: 100,
        factFB: 50, factKB: 90, factMB: 70,
        factDate: '10.02.2026',
      }),
    ];
    const r = sourceExecutionGap(rows, { year: 2026 });
    expect(r.bySource['ФБ'].pct).toBeCloseTo(50, 6);
    expect(r.bySource['КБ'].pct).toBeCloseTo(90, 6);
    expect(r.bySource['МБ'].pct).toBeCloseTo(70, 6);
    expect(r.gapPp).toBeCloseTo(40, 6);
    expect(r.widestPair).toEqual(['ФБ', 'КБ']);
    expect(r.zone).toBe('red');
  });

  it('план без факта: источник освоен на ноль — это ноль, а не пустота', () => {
    const rows = [
      makeRow({ id: 'a', planFB: 100, planMB: 100, factMB: 100, factDate: '10.02.2026' }),
    ];
    const r = sourceExecutionGap(rows, { year: 2026 });
    expect(r.bySource['ФБ'].pct).toBe(0);
    expect(r.bySource['МБ'].pct).toBeCloseTo(100, 6);
    expect(r.gapPp).toBeCloseTo(100, 6);
  });

  it('источник без плана: pct = null, в сравнении не участвует', () => {
    const rows = [
      makeRow({
        id: 'a',
        planFB: 1000, planKB: 1000, planMB: 0,
        factFB: 500, factKB: 550,
        factDate: '10.02.2026',
      }),
    ];
    const r = sourceExecutionGap(rows, { year: 2026 });
    expect(r.bySource['МБ'].pct).toBeNull();
    expect(r.sourcesWithoutPlan).toEqual(['МБ']);
    // Граница: ровно 5 п.п. — уже жёлтая зона («меньше 5» — норма).
    expect(r.gapPp).toBeCloseTo(SOURCE_GAP_THRESHOLDS.normalMaxPp, 6);
    expect(r.zone).toBe('yellow');
    expect(r.widestPair).toEqual(['ФБ', 'КБ']);
  });

  it('пустой знаменатель: сравнивать нечего → gapPp null, а не ноль', () => {
    const onlyOneSource = [makeRow({ id: 'a', planMB: 100, factMB: 40, factDate: '10.02.2026' })];
    const r1 = sourceExecutionGap(onlyOneSource, { year: 2026 });
    expect(r1.bySource['МБ'].pct).toBeCloseTo(40, 6);
    expect(r1.gapPp).toBeNull();
    expect(r1.widestPair).toBeNull();
    expect(r1.zone).toBeNull();

    const r2 = sourceExecutionGap([], { year: 2026 });
    expect(r2.bySource['ФБ'].pct).toBeNull();
    expect(r2.gapPp).toBeNull();
    expect(r2.zone).toBeNull();
  });

  it('граница порога: 5 п.п. — жёлтый, 10 п.п. — ещё жёлтый, выше — красный', () => {
    expect(classifySourceExecutionGap(4.99)).toBe('normal');
    expect(classifySourceExecutionGap(SOURCE_GAP_THRESHOLDS.normalMaxPp)).toBe('yellow');
    expect(classifySourceExecutionGap(SOURCE_GAP_THRESHOLDS.yellowMaxPp)).toBe('yellow');
    expect(classifySourceExecutionGap(10.01)).toBe('red');
    expect(classifySourceExecutionGap(null)).toBeNull();
  });
});

// ── 4. Соблюдение планового квартала ─────────────────────────────────

describe('quarterCompliance — факт-квартал против план-квартала', () => {
  it('позитив: доля «в срок» и средний сдвиг', () => {
    const rows = [
      makeRow({ id: '1', planQuarter: 1, factQuarter: 1, factYear: 2026, factDate: '10.02.2026' }),
      makeRow({ id: '2', planQuarter: 2, factQuarter: 1, factYear: 2026, factDate: '10.02.2026' }),
      makeRow({ id: '3', planQuarter: 2, factQuarter: 2, factYear: 2026, factDate: '10.05.2026' }),
      makeRow({ id: '4', planQuarter: 3, factQuarter: 3, factYear: 2026, factDate: '10.08.2026' }),
      makeRow({ id: '5', planQuarter: 3, factQuarter: 4, factYear: 2026, factDate: '10.11.2026' }),
    ];
    const r = quarterCompliance(rows, { year: 2026 });
    expect(r.onTime.numerator).toBe(4);
    expect(r.onTime.denominator).toBe(5);
    expect(r.onTime.pct).toBeCloseTo(80, 6);
    // Сдвиги: 0, −1, 0, 0, +1 → в среднем ноль.
    expect(r.meanShiftQuarters).toBeCloseTo(0, 6);
    expect(r.zone).toBe('normal');
  });

  it('переход через год: план 4 кв, факт январь следующего — опоздание, а не опережение', () => {
    const rows = [
      makeRow({
        id: 'late',
        planQuarter: 4, planYear: 2026,
        factQuarter: 1, factYear: 2027, factDate: '15.01.2027',
      }),
    ];
    const r = quarterCompliance(rows, { year: 2026 });
    expect(r.meanShiftQuarters).toBeCloseTo(1, 6);
    expect(r.onTime.pct).toBe(0);
    expect(r.zone).toBe('red');
  });

  it('год факта неизвестен: сравнение в предположении одного года, счётчик это фиксирует', () => {
    const rows = [
      // Дата-мусор + пустой S: год не выводится, но квартал факта проставлен.
      makeRow({ id: 'a', planQuarter: 2, planYear: 2026, factQuarter: 2, factDate: 'см. примечание' }),
    ];
    const r = quarterCompliance(rows, { year: 2026 });
    expect(r.assumedSameYearCount).toBe(1);
    expect(r.onTime.pct).toBeCloseTo(100, 6);
    expect(r.meanShiftQuarters).toBe(0);
  });

  it('средний сдвиг в целый квартал делает зону красной при любой доле «в срок»', () => {
    const rows = [
      ...Array.from({ length: 9 }, (_, i) =>
        makeRow({ id: `ok${i}`, planQuarter: 1, factQuarter: 1, factYear: 2026, factDate: '10.02.2026' }),
      ),
      makeRow({
        id: 'very-late',
        planQuarter: 1, planYear: 2026,
        factQuarter: 1, factYear: 2029, factDate: '10.02.2029',
      }),
    ];
    const r = quarterCompliance(rows, { year: 2026 });
    expect(r.onTime.pct).toBeCloseTo(90, 6);
    expect(r.meanShiftQuarters).toBeCloseTo(1.2, 6);
    expect(r.zone).toBe('red');
  });

  it('факт без определимого квартала плана — вне знаменателя, назван отдельно', () => {
    const rows = [
      makeRow({ id: 'ok', planQuarter: 1, factQuarter: 1, factYear: 2026, factDate: '10.02.2026' }),
      makeRow({ id: 'no-plan-q', planQuarter: '', factQuarter: 2, factYear: 2026, factDate: '10.05.2026' }),
    ];
    const r = quarterCompliance(rows, { year: 2026 });
    expect(r.onTime.denominator).toBe(1);
    expect(r.unattributedRows).toEqual([1]);
  });

  it('квартал факта из даты Q, когда R пуст', () => {
    const rows = [
      makeRow({ id: 'a', planQuarter: 1, factDate: '10.02.2026' }),
      makeRow({ id: 'b', planQuarter: 1, factDate: '10.08.2026' }),
    ];
    const r = quarterCompliance(rows, { year: 2026 });
    expect(r.quarterFromDateCount).toBe(2);
    expect(r.onTime.pct).toBeCloseTo(50, 6);
    expect(r.meanShiftQuarters).toBeCloseTo(1, 6);
  });

  it('пустой знаменатель: нет заключённых строк → null, а не ноль', () => {
    const rows = [makeRow({ id: 'pending', planQuarter: 1, planTotal: 100 })];
    const r = quarterCompliance(rows, { year: 2026 });
    expect(r.onTime.denominator).toBe(0);
    expect(r.onTime.pct).toBeNull();
    expect(r.meanShiftQuarters).toBeNull();
    expect(r.zone).toBeNull();
  });

  it('граница порога: 80 % — ещё норма, 60 % — ещё жёлтый', () => {
    const t = QUARTER_COMPLIANCE_THRESHOLDS;
    expect(classifyQuarterCompliance(t.normalMinPct, 0)).toBe('normal');
    expect(classifyQuarterCompliance(79.99, 0)).toBe('yellow');
    expect(classifyQuarterCompliance(t.yellowMinPct, 0)).toBe('yellow');
    expect(classifyQuarterCompliance(59.99, 0)).toBe('red');
    expect(classifyQuarterCompliance(95, t.redMeanShiftQuarters)).toBe('red');
    expect(classifyQuarterCompliance(95, 0.99)).toBe('normal');
    expect(classifyQuarterCompliance(null, null)).toBeNull();
  });
});
