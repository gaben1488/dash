/**
 * Юниты мапперов страницы «Отчёт»: форматтеры канона (процент с запятой,
 * «нет плана» при D = 0), интегральный KPI-ряд, view-модель секции ГРБС.
 * Калибровка — эталон отчёта 20.03.2026: УЭР 1 кв = 6/15 = 40,0%.
 */
import { describe, it, expect } from 'vitest';
import {
  buildGrbsSection,
  fmtCount,
  fmtPct,
  fmtThousands,
  buildIntegralSummary,
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

describe('buildIntegralSummary — четыре яруса сводки', () => {
  const s = buildIntegralSummary(makeReportFixture());

  it('два героя: год и отчётный квартал, с формулой и баром', () => {
    expect(s.hero).toHaveLength(2);
    expect(s.hero.map((h) => h.metricKey)).toEqual(['exec_count_pct', 'exec_count_pct']);
    expect(s.hero[0].periodBadge).toBe('2026 · год');
    expect(s.hero[1].periodBadge).toBe('1 кв');
    // Квартал фикстуры: 6 из 15 = 40,0 % — формула дублирует процент словами,
    // бар дублирует его же визуально (канон текстового дубля).
    expect(s.hero[1].value).toBe('40,0%');
    // Формула по частям: числа несут СВОИ ключи БЗ — метрики, потерявшие
    // отдельные плитки при переплавке, сохранили свои объяснения.
    expect(s.hero[1].formula!.map((p) => p.text).join('')).toBe('заключено 6 из 15 позиций');
    expect(s.hero[1].formula!.filter((p) => p.metricKey).map((p) => p.metricKey))
      .toEqual(['fact_count', 'plan_count']);
    expect(s.hero[1].meter).toBe(40);
    // Ниже 70 % — янтарь: цвет говорит об отставании раньше сравнения чисел.
    expect(s.hero[1].accent).toBe('amber');
  });

  it('четыре плитки способов: КП/ЕП года и квартала, с цветом способа', () => {
    expect(s.methods.map((m) => m.metricKey)).toEqual([
      'comp_exec_count_pct', 'ep_exec_count_pct', 'comp_exec_count_pct', 'ep_exec_count_pct',
    ]);
    expect(s.methods[0].accent).toBe('brand');
    expect(s.methods[1].accent).toBe('violet');
    expect(s.methods[2].formula!.map((p) => p.text).join('')).toBe('4 из 10');
    expect(s.methods[2].formula!.filter((p) => p.metricKey).map((p) => p.metricKey))
      .toEqual(['comp_fact_count', 'competitive_count']);
    expect(s.methods[3].formula!.filter((p) => p.metricKey).map((p) => p.metricKey))
      .toEqual(['ep_fact_count', 'ep_count']);
  });

  it('деньги года: три плитки с составом бюджетов', () => {
    expect(s.money.map((m) => m.metricKey)).toEqual(['plan_total', 'fact_total', 'economy_total']);
    expect(s.money[0].unit).toBe('тыс. ₽');
    expect(norm(s.money[0].value)).toBe('4 500');
    expect(s.money[0].budget).toEqual({ fb: 1000, kb: 2900, mb: 600 });
    expect(s.money[2].accent).toBe('emerald');
  });

  it('officialKey: аналог снимков — только у способов года и 1 кв', () => {
    expect(s.methods[0].officialKey).toBe('competitive.year.percent');
    expect(s.methods[1].officialKey).toBe('sole.year.percent');
    expect(s.methods[2].officialKey).toBe('competitive.q1.percent');
    expect(s.methods[3].officialKey).toBe('sole.q1.percent');
    // Итог КП+ЕП и деньги: единой официальной ячейки нет — без аналога.
    for (const tile of [...s.hero, ...s.money]) expect(tile.officialKey).toBeUndefined();
  });

  it('officialKey: в 3 кв квартальные способы без аналога (в СВОДе 1 кв и год)', () => {
    const base = makeReportFixture();
    const q3 = buildIntegralSummary({ ...base, period: { ...base.period, quarter: 3 as const } });
    expect(q3.methods[2].officialKey).toBeUndefined();
    expect(q3.methods[3].officialKey).toBeUndefined();
    expect(q3.methods[0].officialKey).toBe('competitive.year.percent');
  });

  it('остаток: наш пересчёт строкой, официального листа в фикстуре нет', () => {
    expect(s.remainder).toHaveLength(1);
    expect(s.remainder[0].source).toBe('calc');
    expect(s.remainder[0].cell).toBeNull();
    expect(s.remainder[0].hint.map((p) => p.text).join('')).toBe('30 позиций без даты заключения');
    expect(s.remainder[0].hint[0].metricKey).toBe('pending_count');
    // Второй стороны нет — сравнивать не с чем, подписи расхождения тоже нет.
    expect(s.remainderDiff).toBeNull();
  });

  it('остаток: с официальным ярусом — три строки, адреса ячеек и расхождение', () => {
    const base = makeReportFixture();
    const withOfficial = buildIntegralSummary({
      ...base,
      official: {
        remainderToConclude: { fb: 100, kb: 200, mb: 300, total: 2500, row: 2, cell: 'O2' },
        calcEconomy: { fb: 10, kb: 20, mb: 30, total: 60, row: 32, cell: 'M32' },
      },
    });
    expect(withOfficial.remainder.map((r) => r.cell)).toEqual([null, 'O2', 'M32']);
    expect(withOfficial.remainder[1].source).toBe('svod');
    expect(withOfficial.remainder[2].accent).toBe('emerald');
    // Наш остаток фикстуры 3 000 против листа 2 500 — расхождение названо.
    expect(norm(withOfficial.remainderDiff!)).toContain('+500 тыс. руб.');
    expect(withOfficial.remainderDiff!).toContain('периметры могут отличаться');
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

  it('УЭР: КП/ЕП-строки квартала (pct числом — для бара с текстовым дублем)', () => {
    expect(uer.methodRows).toEqual([
      { methodKey: 'КП', plan: 10, fact: 4, pct: 40, pctText: '40,0%' },
      { methodKey: 'ЕП', plan: 5, fact: 2, pct: 40, pctText: '40,0%' },
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
