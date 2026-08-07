/**
 * Классификаторы первопричин: адреса строк-виновниц и их вклад.
 * Блок 1 плана к запуску, шаги 4–5.
 */
import { describe, expect, it } from 'vitest';
import { DEPT_COLUMNS, validateReconLine, type ReconLine } from '@aemr/shared';
import {
  classifyAfterSlice,
  classifyCancelled,
  classifyFactQuarterMissing,
  classifyMethod,
  classifyParsing,
  classifySign,
  classifyUnfunded,
  columnLetter,
  sheetRowOf,
} from './recon-classify.js';

const COL = DEPT_COLUMNS;

function row(o: {
  plan?: number | string;
  fact?: number | string;
  year?: number | string;
  quarter?: number | string;
  factDate?: string;
  method?: string;
  /** Вид деятельности (F): держит строку в счётных, когда способ нераспознан. */
  type?: string;
  /** Плановая тройка бюджетов — ФБ, КБ, МБ. */
  planParts?: [number, number, number];
  /** Фактическая тройка бюджетов. */
  factParts?: [number, number, number];
  /** Причина отклонения — свободный текст, где живёт пометка об отмене. */
  reason?: string;
  /** Комментарий ГРБС — второй дом пометки об отмене. */
  comment?: string;
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
  if (o.type !== undefined) r[COL.TYPE] = o.type;
  if (o.planParts) {
    [r[COL.FB_PLAN], r[COL.KB_PLAN], r[COL.MB_PLAN]] = o.planParts;
  }
  if (o.factParts) {
    [r[COL.FB_FACT], r[COL.KB_FACT], r[COL.MB_FACT]] = o.factParts;
  }
  if (o.reason !== undefined) r[COL.DEVIATION_REASON] = o.reason;
  if (o.comment !== undefined) r[COL.COMMENT_GRBS] = o.comment;
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
    expect(c.explanation.replace(/\s/g, ' ')).toContain('32 050');
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

describe('classifySign', () => {
  const rows = [
    // Перерасход: факт выше плана — направление обратно общему расхождению.
    row({ plan: 100, fact: 150, factDate: '20.02.2026' }),
    // Экономия: направление совпадает с общим расхождением, не наш класс.
    row({ plan: 400, fact: 300, factDate: '20.02.2026' }),
    // Контракт не заключён: отклонения у строки нет вовсе.
    row({ plan: 900, factDate: '' }),
  ];

  it('находит строки, чьё отклонение идёт против общего расхождения', () => {
    const c = classifySign({ rows, sheet: 'УЖКХ', measure: 'factMoney', delta: -200 })!;
    expect(c.class).toBe('sign');
    expect(c.rows).toHaveLength(1);
    expect(c.rows[0].delta).toBe(50);
    expect(c.rows[0].cell).toBe(`Y${sheetRowOf(0)}`);
    expect(c.rows[0].sheet).toBe('УЖКХ');
    // Направление названо словами с обеих сторон: и общее, и построчное.
    expect(c.explanation).toContain('расчёт ниже официального числа');
    expect(c.explanation).toContain('перерасход');
  });

  it('все отклонения сонаправлены общей дельте — причины нет', () => {
    const c = classifySign({
      rows: [row({ plan: 400, fact: 300, factDate: '20.02.2026' })],
      sheet: 'УЖКХ',
      measure: 'factMoney',
      delta: -200,
    });
    expect(c).toBeNull();
  });

  it('без общей дельты направление неопределимо', () => {
    expect(classifySign({ rows, sheet: 'УЖКХ', measure: 'factMoney' })).toBeNull();
  });

  it('к счёту процедур не применяется: у количества направления нет', () => {
    expect(classifySign({ rows, sheet: 'УЖКХ', measure: 'factCount', delta: -2 })).toBeNull();
  });
});

describe('classifyMethod', () => {
  const rows = [
    row({ plan: 500, method: 'ЭА' }),
    // Непустой нераспознанный код: лист держит строку в конкурентных, мы теряем.
    row({ plan: 700, method: 'ЗК', type: 'Текущая деятельность', planParts: [0, 0, 700] }),
    // Пустой способ: обе стороны читают одинаково, вклад нулевой.
    row({ plan: 300, method: '', type: 'Текущая деятельность', planParts: [0, 0, 300] }),
  ];

  it('нераспознанный способ даёт вклад, пустой — показан с нулём', () => {
    const c = classifyMethod({ rows, sheet: 'УО', measure: 'planMoney' })!;
    expect(c.class).toBe('method');
    expect(c.rows).toHaveLength(2);
    expect(c.rows[0].delta).toBe(700);
    expect(c.rows[0].cell).toBe(`K${sheetRowOf(1)}`);
    expect(c.rows[1].delta).toBe(0);
    expect(c.rows[1].cell).toBe(`K${sheetRowOf(2)}`);
    expect(c.explanation).toContain('нераспознанным способом: 1');
    expect(c.explanation).toContain('пустым способом: 1');
  });

  it('вклад класса равен сумме только нераспознанных строк', () => {
    const c = classifyMethod({ rows, sheet: 'УО', measure: 'planMoney' })!;
    expect(c.rows.reduce((s, r) => s + r.delta, 0)).toBe(700);
  });

  it('канонические коды и их синонимы причиной не считаются', () => {
    const c = classifyMethod({
      rows: [row({ method: 'ЕП' }), row({ method: 'ЭА (МЭП)' }), row({ method: 'эзк' })],
      sheet: 'УО',
      measure: 'planMoney',
    });
    expect(c).toBeNull();
  });
});

describe('classifyCancelled', () => {
  const rows = [
    row({ plan: 1_200, reason: 'Закупка отменена заказчиком' }),
    row({ plan: 800, comment: 'Аукцион не состоялся' }),
    row({ plan: 640, comment: 'Контракт аннулирован' }),
    row({ plan: 0, reason: 'Отменено' }), // план обнулён — источники сходятся
    row({ plan: 400, reason: 'Х' }), // обычная строка
  ];

  it('находит отменённые строки с непогашенным планом, дороже выше', () => {
    const c = classifyCancelled({ rows, sheet: 'УДТХ', measure: 'planMoney' })!;
    expect(c.class).toBe('cancelled');
    expect(c.rows.map((r) => r.delta)).toEqual([1_200, 800, 640]);
    expect(c.rows[0].cell).toBe(`K${sheetRowOf(0)}`);
    expect(c.rows[1].cell).toBe(`K${sheetRowOf(1)}`);
    expect(c.explanation.replace(/\s/g, ' ')).toContain('2 640');
  });

  it('пометок об отмене нет — причины нет', () => {
    const c = classifyCancelled({ rows: [row({ plan: 400, reason: 'Х' })], sheet: 'УДТХ', measure: 'planMoney' });
    expect(c).toBeNull();
  });

  it('мера «количество»: вклад каждой строки — единица', () => {
    const c = classifyCancelled({ rows, sheet: 'УДТХ', measure: 'planCount' })!;
    expect(c.rows.map((r) => r.delta)).toEqual([1, 1, 1]);
  });
});

describe('classifyParsing', () => {
  const rows = [
    row({ plan: 1_000, planParts: [0, 400, 600] }), // итог сходится с источниками
    row({ plan: 1_000, planParts: [0, 400, 500] }), // итог больше источников на 100
    row({ plan: 'н/д', planParts: [0, 0, 250], type: 'Текущая деятельность' }), // число не читается
  ];

  it('находит расхождение итога с источниками и нечитаемое число', () => {
    const c = classifyParsing({ rows, sheet: 'УЭР', measure: 'planMoney' })!;
    expect(c.class).toBe('parsing');
    expect(c.rows).toHaveLength(2);
    // Дороже выше: нечитаемая строка расходится на 250, вторая — на 100.
    expect(c.rows[0].delta).toBe(-250);
    expect(c.rows[0].cell).toBe(`K${sheetRowOf(2)}`);
    expect(c.rows[1].delta).toBe(100);
    expect(c.rows[1].cell).toBe(`K${sheetRowOf(1)}`);
    expect(c.explanation).toContain('с нечитаемым числом 1');
  });

  it('фактическая мера сверяет фактический итог с фактической тройкой', () => {
    const c = classifyParsing({
      rows: [
        row({
          plan: 1_000,
          planParts: [0, 500, 500],
          fact: 900,
          factParts: [0, 400, 400],
          factDate: '10.02.2026',
        }),
      ],
      sheet: 'УЭР',
      measure: 'factMoney',
    })!;
    expect(c.rows).toHaveLength(1);
    expect(c.rows[0].delta).toBe(100);
    expect(c.rows[0].cell).toBe(`Y${sheetRowOf(0)}`);
  });

  it('заглушка «Х» — осознанная пустота, а не дефект чтения', () => {
    const c = classifyParsing({
      rows: [row({ plan: 1_000, planParts: [0, 400, 600], fact: 'Х' })],
      sheet: 'УЭР',
      measure: 'factMoney',
    });
    expect(c).toBeNull();
  });

  it('итоги сходятся с источниками — причины нет', () => {
    const c = classifyParsing({
      rows: [row({ plan: 1_000, planParts: [0, 400, 600] })],
      sheet: 'УЭР',
      measure: 'planMoney',
    });
    expect(c).toBeNull();
  });

  it('мера «количество»: строка, прочитанная по-разному, — одна единица', () => {
    const c = classifyParsing({ rows, sheet: 'УЭР', measure: 'planCount' })!;
    expect(c.rows.map((r) => r.delta)).toEqual([1, 1]);
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

  it('отменённые строки объясняют расхождение плана целиком', () => {
    const rows = [
      row({ plan: 1_200, reason: 'Закупка отменена заказчиком' }),
      row({ plan: 500 }),
    ];
    const cause = classifyCancelled({ rows, sheet: 'УДТХ', measure: 'planMoney' })!;
    const line: ReconLine = {
      metric: 'udth.plan_total.year',
      official: 8_000,
      computed: 9_200,
      delta: 1_200,
      rootCauses: [{ ...cause, id: 'cancelled:УДТХ', affects: [] }],
    };
    expect(validateReconLine(line)).toEqual([]);
  });
});
