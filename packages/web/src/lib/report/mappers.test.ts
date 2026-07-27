/**
 * Юниты мапперов страницы «Отчёт»: форматтеры канона (процент с запятой,
 * «нет плана» при D = 0), интегральный KPI-ряд, view-модель секции ГРБС.
 * Калибровка — эталон отчёта 20.03.2026: УЭР Q1 = 6/15 = 40,0%.
 */
import { describe, it, expect } from 'vitest';
import {
  buildGrbsSection,
  fmtCount,
  fmtPct,
  fmtThousands,
  integralKpiRow,
} from './mappers';
import { makeReportFixture } from './fixture';

/** ru-RU-группировка использует неразрывные пробелы — нормализуем для сравнения. */
const norm = (s: string) => s.replace(/[\u00A0\u202F]/g, ' ');

describe('форматтеры канона', () => {
  it('fmtPct: один знак после запятой, запятая-разделитель', () => {
    expect(fmtPct(40)).toBe('40,0%');
    expect(fmtPct(67.5)).toBe('67,5%');
    expect(fmtPct(13.333)).toBe('13,3%');
  });

  it('fmtPct: null → «нет плана» (канон quarterExecution, не 0 и не 100)', () => {
    expect(fmtPct(null)).toBe('нет плана');
  });

  it('fmtPct: перевыполнение не капится (>100 допустимо)', () => {
    expect(fmtPct(113.33)).toBe('113,3%');
  });

  it('fmtCount/fmtThousands: округление и ru-RU-группировка', () => {
    expect(fmtCount(15)).toBe('15');
    expect(norm(fmtThousands(12345.6))).toBe('12 346');
  });
});

describe('integralKpiRow — интегральная сводка в плитки', () => {
  const tiles = integralKpiRow(makeReportFixture());

  it('13 плиток: 5 год + 5 квартал + 3 денежные', () => {
    expect(tiles).toHaveLength(13);
  });

  it('подписи только через metricKey канон-словаря', () => {
    const keys = tiles.map((t) => t.metricKey);
    expect(keys.slice(0, 5)).toEqual([
      'plan_count', 'fact_count', 'exec_count_pct', 'comp_exec_count_pct', 'ep_exec_count_pct',
    ]);
    expect(keys.slice(10)).toEqual(['plan_total', 'fact_total', 'economy_total']);
  });

  it('квартальная плитка исполнения: 6/15 → 40,0%, hero, честный бейдж Q1', () => {
    const exec = tiles[7];
    expect(exec.metricKey).toBe('exec_count_pct');
    expect(exec.value).toBe('40,0%');
    expect(exec.periodBadge).toBe('Q1');
    expect(exec.tier).toBe('hero');
  });

  it('КП/ЕП-плитки несут формулу в бейдже и source из origin', () => {
    const kpQuarter = tiles[8];
    expect(kpQuarter.metricKey).toBe('comp_exec_count_pct');
    expect(norm(kpQuarter.periodBadge)).toBe('Q1 · 4 из 10');
    expect(kpQuarter.source).toBe('calc');
  });

  it('денежные плитки: тыс. ₽, скоуп года', () => {
    const plan = tiles[10];
    expect(plan.unit).toBe('тыс. ₽');
    expect(norm(plan.value)).toBe('4 500');
    expect(plan.periodBadge).toBe('2026 · год');
  });

  it('officialKey: аналог снимков — только у исполнения КП/ЕП (год и Q1)', () => {
    expect(tiles[3].officialKey).toBe('competitive.year.percent');
    expect(tiles[4].officialKey).toBe('sole.year.percent');
    expect(tiles[8].officialKey).toBe('competitive.q1.percent');
    expect(tiles[9].officialKey).toBe('sole.q1.percent');
    // Итоги КП+ЕП и деньги: единой официальной ячейки нет — без аналога
    for (const i of [0, 1, 2, 5, 6, 7, 10, 11, 12]) {
      expect(tiles[i].officialKey).toBeUndefined();
    }
  });

  it('officialKey: в Q3 квартальные КП/ЕП без аналога (в СВОДе только Q1 и год)', () => {
    const base = makeReportFixture();
    const q3 = integralKpiRow({ ...base, period: { ...base.period, quarter: 3 as const } });
    expect(q3[8].officialKey).toBeUndefined();
    expect(q3[9].officialKey).toBeUndefined();
    // Годовые аналоги от квартала не зависят
    expect(q3[3].officialKey).toBe('competitive.year.percent');
  });
});

describe('buildGrbsSection — view-модель секции ГРБС', () => {
  const report = makeReportFixture();
  const uer = buildGrbsSection(report.grbsBlocks[0]);
  const uo = buildGrbsSection(report.grbsBlocks[1]);

  it('УЭР: исполнение 40,0%, формула «заключено 6 из 15»', () => {
    expect(uer.executionPct).toBe('40,0%');
    expect(uer.executionCaption).toBe('заключено 6 из 15');
  });

  it('УЭР: незаключённые с акцентом (счёт 9)', () => {
    expect(uer.pendingCount).toBe(9);
    expect(uer.pendingLabel).toBe('Не заключено: 9');
  });

  it('УЭР: КП/ЕП-строки квартала', () => {
    expect(uer.methodRows).toEqual([
      { methodKey: 'КП', plan: 10, fact: 4, pctText: '40,0%' },
      { methodKey: 'ЕП', plan: 5, fact: 2, pctText: '40,0%' },
    ]);
  });

  it('УЭР: сверка идёт по живому счёту — сравнимо со СВОДом, который среза не знает', () => {
    expect(uer.source).toBe('mixed');
    expect(uer.svodPairs).not.toBeNull();
    const kpFact = uer.svodPairs!.find((p) => p.metricKey === 'comp_fact_count')!;
    // Отчётное число секции — 4 (на срез), живое — 5: сверка берёт живое и сходится.
    expect(kpFact.calc).toBe(5);
    expect(kpFact.svod).toBe(5);
  });

  it('УЭР: разрыв между отчётным и живым счётом объясняется подписью', () => {
    expect(uer.svodNote).toContain('После даты среза заключено 1');
  });

  it('УО: заключений после среза нет — подписи тоже нет', () => {
    expect(uo.svodNote).toBeNull();
  });

  it('УЭР: деньги и экономия словами продукта', () => {
    expect(norm(uer.moneyLine)).toBe('Лимит 3 500 тыс. руб., факт 2 500 тыс. руб.');
    expect(norm(uer.economyLine!)).toBe('Экономия: 150 тыс. руб.');
    expect(norm(uer.yearLine)).toBe('За год: заключено 20 из 50 (40,0%), не заключено 30');
  });

  it('УО: без СВОД-листа source=calc, сверки нет', () => {
    expect(uo.source).toBe('calc');
    expect(uo.svodPairs).toBeNull();
  });

  it('УО: пустой квартал честный — «нет плана», объяснение вместо нуля', () => {
    expect(uo.executionPct).toBe('нет плана');
    expect(uo.pendingLabel).toBe('План на квартал отсутствует');
  });

  it('УО: нулевая экономия не рисуется (строка null)', () => {
    expect(uo.economyLine).toBeNull();
  });
});
