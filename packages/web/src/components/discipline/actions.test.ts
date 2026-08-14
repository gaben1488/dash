/**
 * Тесты сборщика «списка дел» вкладки «Дисциплина».
 *
 * Стражи канона:
 *  - п.71: класс «факт без даты заключения» подписан стадией «Закупки,
 *    проводимые в течение года» и не зовётся ошибкой;
 *  - п.53: у каждого дела есть механизм и действие (карточка из трёх частей);
 *  - деньги эффекта берутся из строк (план либо факт по смыслу дела), итог по
 *    уникальным строкам не двоит строку из двух дел.
 */
import { describe, it, expect } from 'vitest';
import {
  buildDisciplineActions,
  DISCIPLINE_ACTIONS,
  moneyToneClass,
  type DisciplineRow,
} from './actions';

const row = (over: Partial<DisciplineRow>): DisciplineRow => ({
  dept: 'uer',
  signals: [],
  planSum: 0,
  factSum: 0,
  ...over,
});

describe('buildDisciplineActions', () => {
  it('группирует по действию и суммирует деньги класса', () => {
    const rows: DisciplineRow[] = [
      row({ signals: ['planYearMissing'], planSum: 100 }),
      row({ signals: ['planYearMissing'], planSum: 250, dept: 'uo' }),
      row({ signals: ['factWithoutDate'], factSum: 40 }),
    ];
    const s = buildDisciplineActions(rows);
    expect(s.totalActions).toBe(2);

    const unfunded = s.actions.find((a) => a.def.signal === 'planYearMissing')!;
    expect(unfunded.rows).toBe(2);
    expect(unfunded.money).toBe(350);

    const yearRound = s.actions.find((a) => a.def.signal === 'factWithoutDate')!;
    expect(yearRound.rows).toBe(1);
    // Эффект «в течение года» считается фактом, не планом.
    expect(yearRound.money).toBe(40);
  });

  it('раскладывает вклад по управлениям по убыванию денег', () => {
    const rows: DisciplineRow[] = [
      row({ signals: ['planYearMissing'], planSum: 10, dept: 'uer' }),
      row({ signals: ['planYearMissing'], planSum: 500, dept: 'uo' }),
      row({ signals: ['planYearMissing'], planSum: 20, dept: 'uer' }),
    ];
    const s = buildDisciplineActions(rows);
    const shares = s.actions[0].byDept;
    expect(shares.map((d) => d.dept)).toEqual(['uo', 'uer']);
    expect(shares[0]).toMatchObject({ rows: 1, money: 500 });
    expect(shares[1]).toMatchObject({ rows: 2, money: 30 });
  });

  it('сортирует дела по деньгам эффекта, а не по порядку объявления', () => {
    const rows: DisciplineRow[] = [
      row({ signals: ['planYearMissing'], planSum: 5 }),
      row({ signals: ['factQuarterMissing'], factSum: 9000 }),
    ];
    const s = buildDisciplineActions(rows);
    expect(s.actions[0].def.signal).toBe('factQuarterMissing');
  });

  it('итог по уникальным строкам: строка в двух делах считается один раз', () => {
    const rows: DisciplineRow[] = [
      // Одна строка: P пуст И бюджеты не разбиты — два дела, одна строка.
      row({ signals: ['planYearMissing', 'budgetSourceMissing'], planSum: 100 }),
    ];
    const s = buildDisciplineActions(rows);
    expect(s.totalActions).toBe(2);
    expect(s.totalRows).toBe(1);
    expect(s.totalMoney).toBe(100); // не 200
  });

  it('строки без признаков дел в итоги не входят', () => {
    const rows: DisciplineRow[] = [
      row({ signals: ['signed'], planSum: 999, factSum: 999 }),
      row({ signals: [], planSum: 5 }),
      row({}),
    ];
    const s = buildDisciplineActions(rows);
    expect(s.totalActions).toBe(0);
    expect(s.totalRows).toBe(0);
    expect(s.totalMoney).toBe(0);
  });

  it('нечисловые и отрицательные суммы не ломают деньги эффекта', () => {
    const rows: DisciplineRow[] = [
      row({ signals: ['planYearMissing'], planSum: Number.NaN }),
      row({ signals: ['planYearMissing'], planSum: -50 }),
      row({ signals: ['planYearMissing'], planSum: 70 }),
    ];
    const s = buildDisciplineActions(rows);
    expect(s.actions[0].money).toBe(70);
    expect(s.actions[0].rows).toBe(3);
  });
});

describe('канон п.71 — «Закупки, проводимые в течение года»', () => {
  it('класс factWithoutDate подписан стадией-каноном и не зовётся ошибкой', () => {
    const def = DISCIPLINE_ACTIONS.find((d) => d.signal === 'factWithoutDate')!;
    expect(def.stage).toBe('Закупки, проводимые в течение года');
    const texts = `${def.title(3)} ${def.mechanism} ${def.action} ${def.moneyLabel}`;
    expect(texts.toLowerCase()).not.toContain('ошибк');
    expect(def.mechanism).toContain('законная стадия');
  });

  it('у остальных дел подписи стадии нет — стадия только у п.71', () => {
    for (const def of DISCIPLINE_ACTIONS) {
      if (def.signal === 'factWithoutDate') continue;
      expect(def.stage, def.signal).toBeUndefined();
    }
  });
});

describe('канон п.53 — карточка из трёх частей', () => {
  it('каждое дело несёт механизм и действие, тексты без латинских ключей', () => {
    for (const def of DISCIPLINE_ACTIONS) {
      expect(def.mechanism.length, def.signal).toBeGreaterThan(20);
      expect(def.action.length, def.signal).toBeGreaterThan(10);
      const visible = `${def.title(2)} ${def.mechanism} ${def.action} ${def.moneyLabel}`;
      // Внутренние camelCase-ключи не должны утекать в видимый текст.
      expect(visible).not.toMatch(/[a-z][A-Z]/);
    }
  });

  it('заголовок склоняет счёт строк по-русски', () => {
    const unfunded = DISCIPLINE_ACTIONS.find((d) => d.signal === 'planYearMissing')!;
    expect(unfunded.title(1)).toContain('1 строке');
    expect(unfunded.title(5)).toContain('5 строках');
    expect(unfunded.title(21)).toContain('21 строке');
  });
});

describe('moneyToneClass — цвет только у денег', () => {
  it('растёт по порогам и не даёт красного мелочи', () => {
    expect(moneyToneClass(100)).toContain('zinc');
    expect(moneyToneClass(6_000)).toContain('amber');
    expect(moneyToneClass(80_000)).toContain('rose');
  });
});
