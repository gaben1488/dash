/**
 * Классификаторы первопричин: адреса строк-виновниц и их вклад.
 * Блок 1 плана к запуску, шаги 4–5.
 */
import { describe, expect, it } from 'vitest';
import { DEPT_COLUMNS, validateReconLine, type ReconLine } from '@aemr/shared';
import {
  classifyAfterSlice,
  classifyFactQuarterMissing,
  classifyUnfunded,
  columnLetter,
  sheetRowOf,
} from './recon-classify.js';

const COL = DEPT_COLUMNS;

function row(o: {
  plan?: number;
  fact?: number;
  year?: number | string;
  quarter?: number | string;
  factDate?: string;
  method?: string;
}): unknown[] {
  const r: unknown[] = new Array(34).fill('');
  r[COL.ID] = '1';
  r[COL.SUBJECT] = 'Закупка';
  r[COL.TOTAL_PLAN] = o.plan ?? 100;
  r[COL.METHOD] = o.method ?? 'ЭА';
  r[COL.PLAN_DATE] = '15.01.2026';
  r[COL.PLAN_QUARTER] = o.quarter ?? 1;
  r[COL.PLAN_YEAR] = o.year ?? 2026;
  r[COL.FACT_DATE] = o.factDate ?? '';
  if (o.fact !== undefined) r[COL.TOTAL_FACT] = o.fact;
  return r;
}

describe('адресация листа', () => {
  it('буква колонки: A, Z, AA, AH', () => {
    expect(columnLetter(0)).toBe('A');
    expect(columnLetter(25)).toBe('Z');
    expect(columnLetter(26)).toBe('AA');
    expect(columnLetter(33)).toBe('AH');
  });

  it('номер строки листа = индекс атома + шапка + 1', () => {
    expect(sheetRowOf(0)).toBe(4);
    expect(sheetRowOf(1477)).toBe(1481);
  });
});

describe('classifyUnfunded', () => {
  const rows = [
    row({ plan: 300, year: 2026 }),
    row({ plan: 50, year: '' }),
    row({ plan: 32_000, year: 'Х' }),
    row({ plan: 0, year: '' }), // без денег — не счётная
  ];

  it('находит строки без года плана с адресами и вкладом (деньги)', () => {
    const c = classifyUnfunded({ rows, sheet: 'УКСиМП', measure: 'planMoney' })!;
    expect(c.class).toBe('unfunded');
    expect(c.rows).toHaveLength(2);
    // Дороже — выше.
    expect(c.rows[0].delta).toBe(32_000);
    expect(c.rows[0].cell).toBe(`K${sheetRowOf(2)}`);
    expect(c.rows[1].delta).toBe(50);
    // Числа форматируются по-русски: разряд отбит неразрывным пробелом.
    expect(c.explanation.replace(/ /g, ' ')).toContain('32 050');
  });

  it('мера «количество»: вклад каждой строки = 1', () => {
    const c = classifyUnfunded({ rows, sheet: 'УКСиМП', measure: 'planCount' })!;
    expect(c.rows.map((r) => r.delta)).toEqual([1, 1]);
  });

  it('все годы проставлены — причины нет (null, не пустая причина)', () => {
    const c = classifyUnfunded({ rows: [row({ year: 2026 })], sheet: 'УО', measure: 'planMoney' });
    expect(c).toBeNull();
  });
});

describe('classifyFactQuarterMissing', () => {
  const rows = [
    row({ plan: 100, fact: 90, quarter: 1, factDate: '20.01.2026' }),
    row({ plan: 70_000, fact: 67_666.68, quarter: '', factDate: '15.03.2026' }),
    row({ plan: 100, quarter: '', factDate: '' }), // факта нет — не наш класс
  ];

  it('находит факт без планового квартала (живой случай УДТХ)', () => {
    const c = classifyFactQuarterMissing({ rows, sheet: 'УДТХ', measure: 'factMoney' })!;
    expect(c.class).toBe('factQuarterMissing');
    expect(c.rows).toHaveLength(1);
    expect(c.rows[0].delta).toBeCloseTo(67_666.68);
    expect(c.rows[0].cell).toBe(`Y${sheetRowOf(1)}`);
    expect(c.rows[0].sheet).toBe('УДТХ');
  });

  it('чужой год отсекается', () => {
    const c = classifyFactQuarterMissing({
      rows: [row({ fact: 500, quarter: '', factDate: '15.03.2025', year: 2025 })],
      sheet: 'УДТХ',
      measure: 'factMoney',
      year: 2026,
    });
    expect(c).toBeNull();
  });

  it('мера «количество фактов»: вклад 1 на строку', () => {
    const c = classifyFactQuarterMissing({ rows, sheet: 'УДТХ', measure: 'factCount' })!;
    expect(c.rows.map((r) => r.delta)).toEqual([1]);
  });
});

describe('classifyAfterSlice', () => {
  const asOfDay = Math.floor(Date.UTC(2026, 1, 19) / 86_400_000); // 19.02.2026
  const rows = [
    row({ plan: 100, fact: 90, factDate: '10.02.2026' }), // до среза
    row({ plan: 200, fact: 180, factDate: '25.02.2026' }), // после среза
  ];

  it('находит заключённое после даты среза', () => {
    const c = classifyAfterSlice({ rows, sheet: 'УО', measure: 'factMoney', asOfDay })!;
    expect(c.class).toBe('afterSlice');
    expect(c.rows).toHaveLength(1);
    expect(c.rows[0].delta).toBe(180);
    expect(c.explanation).toContain('следующей неделей');
  });

  it('без даты среза класс неприменим (живой эфир)', () => {
    expect(classifyAfterSlice({ rows, sheet: 'УО', measure: 'factMoney' })).toBeNull();
  });

  it('к плановым мерам не применяется — срез режет только факт', () => {
    expect(classifyAfterSlice({ rows, sheet: 'УО', measure: 'planMoney', asOfDay })).toBeNull();
  });
});

describe('сквозной сценарий: причина закрывает дельту и проходит инварианты', () => {
  it('расхождение лимита объясняется unfunded-строками целиком', () => {
    const rows = [row({ plan: 300, year: 2026 }), row({ plan: 590, year: '' })];
    const cause = classifyUnfunded({ rows, sheet: 'УЭР', measure: 'planMoney' })!;
    const line: ReconLine = {
      metric: 'uer.plan_total.year',
      official: 13_331,
      computed: 13_921,
      delta: 590,
      rootCauses: [{ ...cause, id: 'unfunded:УЭР', affects: [] }],
    };
    expect(validateReconLine(line)).toEqual([]);
  });
});
