/**
 * week-regression.test.ts — доказательство, что расчёт воспроизводит РУЧНОЙ отчёт.
 *
 * Три архивные недели (08.05, 29.05, 26.06.2026): книги ГРБС той недели против
 * чисел отчёта, который человек написал по этим же книгам. Фикстуры собирает
 * `scripts/extract-week-fixture.mts` из папок
 * `E:\на отправку в drive\Отчеты по закупкам\Отчет по закупкам <дата>\`.
 *
 * Канон правил счёта: docs/superpowers/specs/2026-07-29-report-calculation-rules.md.
 * Тест — исполняемая форма §6.5 («восемь пар книги→отчёт — готовая фикстура»).
 *
 * ЧТО СОШЛОСЬ ЗНАК В ЗНАК (три недели, обе методики, восемь ГРБС):
 *   план кварталов — счётчики и деньги в трёхсрезе ФБ/КБ/МБ;
 *   план года как сумма кварталов — счётчики и деньги;
 *   факт и его деньги — при счёте «на сейчас» (см. РАСХОЖДЕНИЕ 1);
 *   исполнение квартала по каждому ГРБС — план, исполнено, годовой план;
 *   остаток незаключённых процедур и его плановые деньги;
 *   годовой ярус buildReport — план года равен сумме кварталов (канон §2).
 *
 * ЧТО НЕ СОШЛОСЬ — одно расхождение методик (гейт среза против «на сейчас») и
 * один пробел продукта (расчётной экономии по остатку в ядре нет). Оба с
 * установленной причиной, оба зафиксированы отдельными тестами ниже вместе с
 * числом. Ни одно число здесь не подогнано под ответ: расхождение объявлено,
 * а не спрятано.
 */

import { describe, expect, it } from 'vitest';
import w0805 from './__fixtures__/week-08.05.2026.json';
import w2905 from './__fixtures__/week-29.05.2026.json';
import w2606 from './__fixtures__/week-26.06.2026.json';
import {
  CalcEngine,
  getValue,
  standardRowFilter,
  type GroupedResults,
  type RawRow,
} from '../pipeline/calc-engine.js';
import { buildReport } from './build-report.js';

// ── Фикстура ─────────────────────────────────────────────────────────

interface ManualMoney {
  count: number;
  total: number;
  fb: number;
  kb: number;
  mb: number;
}

interface WeekFixture {
  date: string;
  year: number;
  /** Отчётный квартал недели (из даты папки). */
  quarter: number;
  asOfDay: number;
  /** Индексы колонок книги, попавшие в фикстуру (0-based, канон DEPT_COLUMNS). */
  columns: number[];
  audit: Record<
    string,
    { sheet: string; sheetRows: number; kept: number; noMethod: number; otherYear: number; blankYear: number }
  >;
  manual: {
    kp: {
      year: ManualMoney;
      quarters: Record<string, ManualMoney>;
      fact: ManualMoney;
      remainderCount: number;
      calcEconomyTotal: number;
    };
    ep: { year: ManualMoney; quarters: Record<string, ManualMoney>; fact: ManualMoney };
    quarterExecByDept: Record<
      string,
      Array<{ dept: string; pct: number; planCount: number; doneCount: number; yearPlanCount: number }>
    >;
    districtExecPct: Record<string, number>;
  };
  rowsByDept: Record<string, Array<Array<string | number | null>>>;
}

/** Ширина строки книги (A..AF) — фикстура хранит только значимые колонки. */
const ROW_WIDTH = 32;

/** Компактная строка фикстуры → строка-атом полной ширины, как её ждёт движок. */
function expandRows(fx: WeekFixture): Record<string, RawRow[]> {
  const out: Record<string, RawRow[]> = {};
  for (const [dept, rows] of Object.entries(fx.rowsByDept)) {
    out[dept] = rows.map((r) => {
      const full: unknown[] = new Array(ROW_WIDTH).fill(null);
      fx.columns.forEach((c, i) => {
        full[c] = r[i];
      });
      return full;
    });
  }
  return out;
}

// ── Счёт ─────────────────────────────────────────────────────────────

const ENGINE = new CalcEngine();
const QUARTERS = [1, 2, 3, 4];
/**
 * Допуск по деньгам. Единственная законная разница здесь — округление ручного
 * отчёта до копейки: он печатает два знака, а расчёт суммирует тысячи строк,
 * поэтому |расчёт − отчёт| ≤ 0,005 тыс. руб. по построению. Замерено на всех
 * трёх неделях по 168 сверкам: максимум 0,0050 — ровно предел округления.
 * Держим 1 знак (|разница| < 0,05): десятикратный запас над округлением и
 * при этом гейт ловит любой снос от полусотни рублей. Более широкий допуск
 * пропустил бы настоящее расхождение молча.
 */
const MONEY_DIGITS = 1;

type Method = 'competitive' | 'ep';
const PLAN_COUNT: Record<Method, string> = { competitive: 'competitive_count', ep: 'ep_count' };
const FACT_COUNT: Record<Method, string> = { competitive: 'comp_fact_count', ep: 'ep_fact_count' };

/** Сумма метрики по всем ГРБС района в заданной группе. */
function district(all: GroupedResults[], metric: string, group?: string): number {
  return all.reduce((s, g) => s + getValue(g, metric, group), 0);
}

/** Деньги трёхсреза + итого как их печатает отчёт (итого = ФБ+КБ+МБ). */
function money(all: GroupedResults[], prefix: 'plan' | 'fact' | 'pending', group?: string): ManualMoney {
  const fb = district(all, `${prefix}_fb`, group);
  const kb = district(all, `${prefix}_kb`, group);
  const mb = district(all, `${prefix}_mb`, group);
  return { count: 0, fb, kb, mb, total: fb + kb + mb };
}

/** Сумма по четырём кварталам — «год» ручного отчёта (канон §2). */
function overQuarters(all: GroupedResults[], metric: string, method: Method): number {
  return QUARTERS.reduce((s, q) => s + district(all, metric, `q${q}.${method}`), 0);
}

function moneyOverQuarters(
  all: GroupedResults[],
  prefix: 'plan' | 'fact' | 'pending',
  method: Method,
): ManualMoney {
  return QUARTERS.reduce<ManualMoney>(
    (acc, q) => {
      const m = money(all, prefix, `q${q}.${method}`);
      return { count: 0, fb: acc.fb + m.fb, kb: acc.kb + m.kb, mb: acc.mb + m.mb, total: acc.total + m.total };
    },
    { count: 0, fb: 0, kb: 0, mb: 0, total: 0 },
  );
}

function expectMoney(actual: ManualMoney, expected: ManualMoney, label: string): void {
  expect(actual.fb, `${label}: ФБ`).toBeCloseTo(expected.fb, MONEY_DIGITS);
  expect(actual.kb, `${label}: КБ`).toBeCloseTo(expected.kb, MONEY_DIGITS);
  expect(actual.mb, `${label}: МБ`).toBeCloseTo(expected.mb, MONEY_DIGITS);
  expect(actual.total, `${label}: итого`).toBeCloseTo(expected.total, MONEY_DIGITS);
}

const WEEKS: WeekFixture[] = [w0805, w2905, w2606];

/**
 * Измеренная потеря факта от гейта среза — процедуры и тыс. руб. по каждой
 * неделе и способу (см. РАСХОЖДЕНИЕ 1). Прибито числом, а не выведено из
 * данных: расхождение, вычисленное из тех же данных, с которыми сверяется,
 * подтверждает само себя и молча уползёт при первом же сдвиге семантики среза.
 */
const SLICE_LOSS: Record<string, Record<Method, { count: number; money: number }>> = {
  '08.05.2026': { competitive: { count: 0, money: 0 }, ep: { count: 9, money: 1772.04 } },
  '29.05.2026': { competitive: { count: 1, money: 40 }, ep: { count: 10, money: 1785.04 } },
  '26.06.2026': { competitive: { count: 0, money: 0 }, ep: { count: 0, money: 0 } },
};

describe.each(WEEKS)('неделя $date: расчёт против ручного отчёта', (fx) => {
  const rowsByDept = expandRows(fx);
  const depts = Object.keys(rowsByDept);

  /**
   * Два прохода одного движка над одними строками.
   *  - `sliced` — с гейтом среза (asOfDay): наша отчётная семантика,
   *    «накопительно на дату среза»;
   *  - `live`   — без гейта, «на сейчас»: так считает лист СВОД и, как
   *    выяснилось на этих же неделях, так считал автор ручного отчёта.
   */
  const sliced = depts.map((d) =>
    ENGINE.compute(rowsByDept[d], standardRowFilter, 0, fx.year, { asOfDay: fx.asOfDay }),
  );
  const live = depts.map((d) => ENGINE.compute(rowsByDept[d], standardRowFilter, 0, fx.year));
  const slicedByDept = new Map(depts.map((d, i) => [d, sliced[i]]));

  const report = buildReport(
    { rowsByDept },
    { year: fx.year, quarter: fx.quarter as 1 | 2 | 3 | 4, asOfDay: fx.asOfDay },
  );

  // ── Периметр фикстуры ──────────────────────────────────────────────

  it('фикстура ничего не потеряла: строк без способа в периметре нет', () => {
    // Пустой способ движок относит к КОНКУРЕНТНЫМ (наследие формул СВОД:
    // КП определён отрицанием L<>"ЕП"). Была бы хоть одна такая содержательная
    // строка — фикстура молча срезала бы план, и совпадения ниже ничего бы не
    // доказывали. На всех трёх неделях таких строк ноль.
    for (const [dept, a] of Object.entries(fx.audit)) {
      expect(a.noMethod, `${dept}: содержательные строки без способа`).toBe(0);
    }
  });

  // ── План: кварталы ─────────────────────────────────────────────────

  const METHODS: Array<[string, Method, 'kp' | 'ep']> = [
    ['конкурентные', 'competitive', 'kp'],
    ['единственный поставщик', 'ep', 'ep'],
  ];

  describe.each(METHODS)('%s', (_label, method, manualKey) => {
    const manual = fx.manual[manualKey];

    it.each(QUARTERS)('план %i квартала — процедуры и деньги', (q) => {
      const expected = manual.quarters[`q${q}`];
      expect(expected, `в ручном отчёте нет ${q} квартала`).toBeDefined();
      expect(district(sliced, PLAN_COUNT[method], `q${q}.${method}`)).toBe(expected.count);
      expectMoney(money(sliced, 'plan', `q${q}.${method}`), expected, `план q${q}`);
    });

    it('план года = сумма четырёх кварталов (канон §2)', () => {
      // Строка попадает в план года, только если у неё есть плановый квартал.
      // Ручной отчёт печатает год именно так: 140+125+107+24 = 396 на 26.06.
      expect(overQuarters(sliced, PLAN_COUNT[method], method)).toBe(manual.year.count);
      expectMoney(moneyOverQuarters(sliced, 'plan', method), manual.year, 'план года');
    });

    it('факт года — процедуры и деньги (счёт «на сейчас», как в отчёте)', () => {
      expect(overQuarters(live, FACT_COUNT[method], method)).toBe(manual.fact.count);
      expectMoney(moneyOverQuarters(live, 'fact', method), manual.fact, 'факт года');
    });
  });

  // ── Остаток ────────────────────────────────────────────────────────

  it('остаток незаключённых конкурентных процедур до конца года', () => {
    // Канон §4: остаток — строки БЕЗ факта, а не «план − факт» в деньгах.
    // По счётчикам обе дороги обязаны сходиться, и сходятся.
    const pending = overQuarters(live, 'pending_count', 'competitive');
    expect(pending).toBe(fx.manual.kp.remainderCount);
    expect(
      overQuarters(live, PLAN_COUNT.competitive, 'competitive') -
        overQuarters(live, FACT_COUNT.competitive, 'competitive'),
    ).toBe(fx.manual.kp.remainderCount);
  });

  // ── Исполнение ─────────────────────────────────────────────────────

  it('общее исполнение плана квартала по району (проценты отчёта)', () => {
    for (const [qk, expected] of Object.entries(fx.manual.districtExecPct)) {
      const plan = district(sliced, PLAN_COUNT.competitive, `${qk}.competitive`);
      const done = district(sliced, FACT_COUNT.competitive, `${qk}.competitive`);
      expect(Number(((done / plan) * 100).toFixed(2)), `исполнение ${qk}`).toBe(expected);
    }
  });

  it('исполнение квартала по каждому ГРБС — план, исполнено, план года', () => {
    for (const [qk, list] of Object.entries(fx.manual.quarterExecByDept)) {
      for (const e of list) {
        const g = slicedByDept.get(e.dept);
        expect(g, `нет книги ГРБС ${e.dept}`).toBeDefined();
        const grp = `${qk}.competitive`;
        expect(getValue(g!, PLAN_COUNT.competitive, grp), `${e.dept} ${qk} план`).toBe(e.planCount);
        expect(getValue(g!, FACT_COUNT.competitive, grp), `${e.dept} ${qk} исполнено`).toBe(e.doneCount);
        // Годовой план ГРБС в отчёте — тоже сумма кварталов, не общий счёт строк.
        const yearByQuarters = QUARTERS.reduce(
          (s, q) => s + getValue(g!, PLAN_COUNT.competitive, `q${q}.competitive`),
          0,
        );
        expect(yearByQuarters, `${e.dept} план года`).toBe(e.yearPlanCount);
      }
    }
  });

  // ── buildReport на отчётном квартале ───────────────────────────────

  it('buildReport: квартальные счётчики блоков ГРБС = ручной отчёт', () => {
    const list = fx.manual.quarterExecByDept[`q${fx.quarter}`] ?? [];
    for (const e of list) {
      const block = report.grbsBlocks.find((b) => b.dept === e.dept);
      expect(block, `нет блока ${e.dept}`).toBeDefined();
      expect(block!.quarter.methods.kp.planCount, `${e.dept} план`).toBe(e.planCount);
      expect(block!.quarter.methods.kp.doneCount, `${e.dept} исполнено`).toBe(e.doneCount);
    }
    // Интеграл шапки — сумма блоков, и он же равен квартальному плану отчёта.
    expect(report.integralSummary.quarter.kp.planCount).toBe(
      fx.manual.kp.quarters[`q${fx.quarter}`].count,
    );
    expect(report.integralSummary.quarter.ep.planCount).toBe(
      fx.manual.ep.quarters[`q${fx.quarter}`].count,
    );
  });

  // ── РАСХОЖДЕНИЕ 1: гейт среза против «на сейчас» ───────────────────

  it('РАСХОЖДЕНИЕ 1: факт на дату среза ниже факта ручного отчёта ровно на процедуры, заключённые позже среза', () => {
    // Причина установлена: ручной отчёт (как и формулы листа СВОД) дату
    // заключения НИ С ЧЕМ не сравнивает — считает «на сейчас», на момент
    // чтения книги. Наш отчёт обещает «накопительно на дату среза» и
    // отбрасывает контракты с датой позже. На архивных книгах такие строки
    // остались, отсюда разница. Обе стороны считают ВЕРНО, семантики разные.
    //
    // Величина расхождения — в таблице SLICE_LOSS, не в этом комментарии.
    for (const method of ['competitive', 'ep'] as Method[]) {
      const expectedLoss = SLICE_LOSS[fx.date][method];
      expect(
        overQuarters(live, FACT_COUNT[method], method) - overQuarters(sliced, FACT_COUNT[method], method),
        `${method}: процедуры, ушедшие с гейтом среза`,
      ).toBe(expectedLoss.count);
      expect(
        moneyOverQuarters(live, 'fact', method).total - moneyOverQuarters(sliced, 'fact', method).total,
        `${method}: деньги, ушедшие с гейтом среза`,
      ).toBeCloseTo(expectedLoss.money, MONEY_DIGITS);
      // Ручной отчёт совпадает с «на сейчас», а срезанный счёт ниже ровно на это.
      const manual = method === 'competitive' ? fx.manual.kp : fx.manual.ep;
      expect(overQuarters(sliced, FACT_COUNT[method], method)).toBe(
        manual.fact.count - expectedLoss.count,
      );
    }
    // Зеркало того же расхождения в остатке: 29.05 наш остаток КП — 246
    // против 245 в отчёте, ровно на ту одну процедуру, что заключена позже среза.
    expect(overQuarters(sliced, 'pending_count', 'competitive')).toBe(
      fx.manual.kp.remainderCount + SLICE_LOSS[fx.date].competitive.count,
    );
  });

  // ── Годовой ярус buildReport: требование квартала соблюдено ────────

  it('buildReport: год = сумма кварталов, строки без планового квартала в план не идут', () => {
    // Канон §2: строка входит в план года, только если у неё есть плановый
    // квартал O ∈ {1..4}. Ручной отчёт печатает год именно так.
    //
    // Здесь была измеренная поломка: годовой ярус брал НЕГРУППИРОВАННЫЙ итог
    // движка и тянул строки без квартала — на 26.06 годовой план выходил 475
    // конкурентных вместо 396, и завышенный знаменатель врал в «исполнении
    // годового плана». Починено в `sumOverQuarters` (build-report.ts).
    // Тест держит починку: вернётся негруппированный итог — год разойдётся с
    // ручным отчётом ровно на строки без квартала, и это станет видно сразу.
    expect(report.integralSummary.year.kp.planCount, 'план года КП').toBe(fx.manual.kp.year.count);
    expect(report.integralSummary.year.ep.planCount, 'план года ЕП').toBe(fx.manual.ep.year.count);

    // Сколько строк отсекается требованием квартала — не ноль ни на одной
    // неделе, иначе совпадение выше не доказывало бы ничего (в этих книгах
    // «нет квартала» и «нет планового года» совпадают строка в строку).
    const blankYear = Object.values(fx.audit).reduce((s, a) => s + a.blankYear, 0);
    expect(blankYear, 'строк без планового квартала в периметре').toBeGreaterThan(0);

    // Тот же квартальный ярус у годового остатка — без него остаток тянул бы
    // те же бесквартальные строки.
    const pendingByQuarters =
      overQuarters(sliced, 'pending_count', 'competitive') + overQuarters(sliced, 'pending_count', 'ep');
    expect(report.integralSummary.pending.year.count, 'остаток года').toBe(pendingByQuarters);
  });

  // ── ПРОБЕЛ: расчётная экономия по остатку ──────────────────────────

  it('ПРОБЕЛ: расчётной экономии по остатку в ядре нет — число ручного отчёта не воспроизводится', () => {
    // Ручной отчёт печатает «Расчетная экономия по оставшимся незаключенным N
    // конкурентным процедурам составляет X тыс. руб.». Метрики в CalcEngine
    // для неё нет: правила счёта §5 восстановили лишь гипотезу (доля экономии
    // по каждому ГРБС), и та даёт −3,5 % на 26.06 (39 941,56 против 41 401,03).
    // Пока заказчик не назвал формулу, число в фикстуре — единственный якорь.
    expect(fx.manual.kp.calcEconomyTotal).toBeGreaterThan(0);
    expect(report.official?.calcEconomy).toBeUndefined();
  });
});

// ── Якорь канона: остаток в плановых деньгах на 26.06 ────────────────

it('остаток 26.06 в плановых деньгах = числа правил счёта §4', () => {
  // Единственное место, где ручной отчёт даёт остаток только счётчиком, а
  // деньги остатка зафиксированы канон-спекой. Проверяем их отдельно, чтобы
  // §4 не осталась словами.
  const fx = w2606 as WeekFixture;
  const rowsByDept = expandRows(fx);
  const all = Object.values(rowsByDept).map((rows) =>
    ENGINE.compute(rows, standardRowFilter, 0, fx.year, { asOfDay: fx.asOfDay }),
  );
  const pending = moneyOverQuarters(all, 'pending', 'competitive');
  expect(overQuarters(all, 'pending_count', 'competitive')).toBe(140);
  expectMoney(pending, { count: 140, fb: 64350.7, kb: 153791.43, mb: 247039.75, total: 465181.88 }, 'остаток §4');
});
