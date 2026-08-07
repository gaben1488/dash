/**
 * Юниты доказательства числа (бриф «Отчёт++», шаг 6).
 *
 * Проверяется ровно то, за что отвечает модуль: доказательство сходится с
 * доказываемым числом, честная пустота официального листа объясняется
 * причиной, а отсутствие данных не порождает пустой оверлей — кнопки
 * доказательства просто нет.
 */
import { describe, it, expect } from 'vitest';
import { productLabel } from '@aemr/shared';
import type { Report } from '@aemr/core';
import {
  officialYearMoneyProof,
  quarterPendingProof,
  svodCellProof,
  unfundedProof,
} from './proof';
import { buildGrbsSection } from './mappers';
import { makeReportFixture } from './fixture';

/** ru-RU-группировка использует неразрывные пробелы — нормализуем для сравнения. */
const norm = (s: string) => s.replace(/\s/g, ' ');

/** Секция УЭР фикстуры: 15 плановых, 6 заключённых, 9 в остатке, 1 позиция в перечне. */
const uer = buildGrbsSection(makeReportFixture().grbsBlocks[0]);
/** Секция УО фикстуры: плана на квартал нет, перечень незаключённых пуст. */
const uo = buildGrbsSection(makeReportFixture().grbsBlocks[1]);

/** Фикстура с закупками без подтверждённого финансирования (в базовой их нет). */
function reportWithUnfunded(): Report {
  return {
    ...makeReportFixture(),
    unfunded: {
      count: 3,
      total: 900,
      byDept: [
        {
          dept: 'УЭР',
          deptLabel: 'Управление экономического развития',
          count: 2,
          total: 700,
          positions: [
            { sheetRow: 41, subject: 'Ремонт кровли', subordinate: '', method: 'ЭА', planTotal: 500 },
            { sheetRow: 42, subject: '', subordinate: 'МКУ «ЦЭР»', method: 'ЕП', planTotal: 200 },
          ],
        },
        {
          dept: 'УО',
          deptLabel: 'Управление образования',
          count: 1,
          total: 200,
          positions: [
            { sheetRow: 77, subject: 'Поставка учебников', subordinate: 'МБОУ СОШ №1', method: 'ЭА', planTotal: 200 },
          ],
        },
      ],
    },
  };
}

/** Фикстура с официальным ярусом денег года листа СВОД. */
function reportWithOfficialMoney(): Report {
  return {
    ...makeReportFixture(),
    official: {
      yearMoney: {
        plan: { fb: 1000, kb: 2900, mb: 500, total: 4400, row: 44, cell: 'O44' },
        fact: { fb: 800, kb: 2350, mb: 300, total: 3450, row: 45, cell: 'O45' },
        economy: { fb: 50, kb: 100, mb: 0, total: 150, row: 46, cell: 'O46' },
      },
    },
  };
}

describe('quarterPendingProof — остаток квартала ГРБС', () => {
  const proof = quarterPendingProof(uer, 1)!;

  it('доказывает ровно то число, что напечатано на странице', () => {
    expect(proof).not.toBeNull();
    expect(proof.metricKey).toBe('pending_count');
    expect(proof.displayValue).toBe('9');
    expect(proof.origin).toBe('calc');
  });

  it('формула называет вычитание плана и факта отчётного квартала', () => {
    expect(norm(proof.formula!)).toContain('9 = 15 плановых позиций 1 кв − 6 заключённых');
  });

  it('строки-атомы несут адрес первички и плановую сумму позиции', () => {
    expect(proof.rows).toHaveLength(1);
    expect(proof.rows[0]).toMatchObject({
      sheet: 'УЭР · ВСЕ',
      row: 12,
      subject: 'Поставка учебной мебели',
      value: 610,
    });
    // Вклад строки объяснён словами — иначе «сумма» шапки оверлея читалась бы
    // как второе значение доказываемого счётчика.
    expect(norm(proof.formula!)).toContain('плановая сумма позиции: по строкам ниже это 610 тыс. руб.');
  });

  it('расхождение перечня со счётчиком названо вслух, а не подогнано', () => {
    // Перечень читается на текущий момент, счётчик — на дату среза.
    expect(norm(proof.formula!)).toContain('Строк ниже 1, а не 9');
  });

  it('перечня незаключённых нет — доказательства нет (кнопки не будет)', () => {
    expect(quarterPendingProof(uo, 1)).toBeNull();
  });
});

describe('unfundedProof — закупки без подтверждённого финансирования', () => {
  const report = reportWithUnfunded();

  it('районный итог: строки всех управлений, сумма вкладов сходится с итогом', () => {
    const proof = unfundedProof(report)!;
    // Заголовок оверлея берётся из канон-словаря по этому ключу — «Без
    // подтверждённого финансирования», как называет строки сама проекция.
    expect(proof.metricKey).toBe('lifecycle_stage_no_funding');
    expect(productLabel(proof.metricKey)).toBe('Без подтверждённого финансирования');
    expect(norm(proof.displayValue)).toBe('900 тыс. руб.');
    expect(proof.rows).toHaveLength(3);
    expect(proof.rows.reduce((s, r) => s + r.value, 0)).toBe(900);
    expect(norm(proof.formula!)).toContain('900 тыс. руб. = сумма плановых сумм 3 позиций');
    // Сходится — фраз о расхождении быть не должно.
    expect(proof.formula!).not.toContain('к показанному итогу');
  });

  it('строка без наименования показывается честной подписью, подвед сохраняется', () => {
    const proof = unfundedProof(report)!;
    expect(proof.rows[1]).toMatchObject({
      sheet: 'УЭР · ВСЕ',
      row: 42,
      subject: 'Без наименования',
      subordinate: 'МКУ «ЦЭР»',
    });
    expect(proof.rows[2].sheet).toBe('УО · ВСЕ');
  });

  it('доказательство одного управления берёт только его строки', () => {
    const proof = unfundedProof(report, 'УО')!;
    expect(proof.rows).toHaveLength(1);
    expect(norm(proof.displayValue)).toBe('200 тыс. руб.');
    expect(norm(proof.formula!)).toContain('200 тыс. руб. = сумма плановых сумм 1 позиций');
  });

  it('расхождение атомов с объявленным итогом называется, а не скрывается', () => {
    const broken = reportWithUnfunded();
    broken.unfunded!.total = 1000; // проекция объявила больше, чем дают строки
    const proof = unfundedProof(broken)!;
    expect(norm(proof.displayValue)).toBe('1 000 тыс. руб.');
    expect(norm(proof.formula!)).toContain('Строки ниже дают 900 тыс. руб. — −100 к показанному итогу');
  });

  it('таких закупок нет — доказательства нет', () => {
    expect(unfundedProof(makeReportFixture())).toBeNull();
    expect(unfundedProof(reportWithUnfunded(), 'УДТХ')).toBeNull();
  });
});

describe('svodCellProof — официальное число листа', () => {
  it('честная пустота: строк нет, причина названа, ячейка показана', () => {
    const proof = svodCellProof({
      metricKey: 'plan_total',
      value: 4400,
      cell: 'O44',
      sheetRow: 44,
      money: true,
    })!;
    expect(proof.origin).toBe('svod');
    expect(proof.rows).toEqual([]);
    expect(proof.svodCell).toBe('O44');
    expect(proof.emptyReason).toContain('взято целиком');
    expect(norm(proof.formula!)).toContain('ячейка O44 (строка 44)');
  });

  it('наш пересчёт называется рядом как вторая сторона сверки', () => {
    const diverged = svodCellProof({
      metricKey: 'plan_total', value: 4400, cell: 'O44', calc: 4500, money: true,
    })!;
    expect(norm(diverged.formula!)).toContain('Наш пересчёт из строк книг: 4 500 тыс. руб. — +100 к листу');

    const same = svodCellProof({
      metricKey: 'plan_total', value: 4400, cell: 'O44', calc: 4400, money: true,
    })!;
    expect(norm(same.formula!)).toContain('сходится: 4 400 тыс. руб.');
  });

  it('счётчик печатается без денежной единицы', () => {
    const proof = svodCellProof({ metricKey: 'competitive_count', value: 10, cell: 'D268' })!;
    expect(proof.displayValue).toBe('10');
    expect(proof.formula).not.toContain('тыс. руб.');
  });

  it('адреса ячейки нет — доказательства нет', () => {
    expect(svodCellProof({ metricKey: 'plan_total', value: 4400 })).toBeNull();
    expect(svodCellProof({ metricKey: 'plan_total', value: 4400, cell: '' })).toBeNull();
  });
});

describe('officialYearMoneyProof — деньги года из листа СВОД', () => {
  it('лимит года: официал листа против нашего пересчёта', () => {
    const proof = officialYearMoneyProof(reportWithOfficialMoney(), 'plan_total')!;
    expect(proof.origin).toBe('svod');
    expect(norm(proof.displayValue)).toBe('4 400 тыс. руб.');
    expect(proof.svodCell).toBe('O44');
    // Пересчёт фикстуры — 4 500, лист — 4 400: расхождение обязано прозвучать.
    expect(norm(proof.formula!)).toContain('+100 к листу');
  });

  it('сошедшийся показатель говорит о сходимости прямо', () => {
    const proof = officialYearMoneyProof(reportWithOfficialMoney(), 'economy_total')!;
    expect(norm(proof.formula!)).toContain('сходится: 150 тыс. руб.');
  });

  it('яруса листа нет — доказательства нет (плитка без кнопки)', () => {
    expect(officialYearMoneyProof(makeReportFixture(), 'plan_total')).toBeNull();
  });

  it('неденежный показатель этого доказательства не имеет', () => {
    expect(officialYearMoneyProof(reportWithOfficialMoney(), 'exec_count_pct')).toBeNull();
  });
});
