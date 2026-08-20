/**
 * Страж демонстрационного режима: числа демо обязаны считаться теми же
 * формулами, что и живые.
 *
 * Реестр багов 09.07.2026, пп.4–5. П.4 (знак отклонения: в одном месте
 * план−факт, в другом факт−план) закрыт волной «правда о числах» — обе
 * ветки демо теперь считают отклонение как факт−план, по-листовому. Осталась
 * та же болезнь в соседней колонке: поле spentPct считалось как
 * (план − факт) / план, а отдавалось под ключом savings_pct, который движок
 * определяет ровно наоборот — факт / план («Законтрактовано, %», колонка Q
 * листа СВОД). Законтрактованные 96 % показывались в демо как 4 %.
 */
import { describe, it, expect } from 'vitest';
import { createDemoSnapshot } from './demo-data.js';

const snapshot = createDemoSnapshot();
const cells = snapshot.officialMetrics;

/** Числовое значение демо-ячейки по ключу REPORT_MAP. */
function value(key: string): number {
  const metric = cells[key];
  expect(metric, `в демо-сетке нет ключа ${key}`).toBeDefined();
  return metric.numericValue ?? 0;
}

const BLOCKS = [
  'competitive.year', 'sole.year', 'competitive.q1',
  'grbs.uo.kp.year', 'grbs.uo.ep.year',
  'grbs.uksimp.kp.year', 'grbs.ud.kp.q1',
];

describe('демо-сетка СВОД — знак и смысл колонок совпадают с живым расчётом', () => {
  it.each(BLOCKS)('%s: «Законтрактовано, %%» = факт / план, а не наоборот', (prefix) => {
    const plan = value(`${prefix}.total_plan`);
    const fact = value(`${prefix}.total_fact`);
    expect(plan).toBeGreaterThan(0);
    expect(value(`${prefix}.savings_pct`)).toBeCloseTo(fact / plan, 9);
  });

  it.each(BLOCKS)('%s: отклонение в рублях = факт − план (знак листа)', (prefix) => {
    const plan = value(`${prefix}.total_plan`);
    const fact = value(`${prefix}.total_fact`);
    expect(value(`${prefix}.amount_dev`)).toBeCloseTo(fact - plan, 9);
  });

  it('недоосвоение показывается недоосвоением: доля меньше единицы, отклонение отрицательно', () => {
    // Демо строится с исполнением заведомо ниже плана; перевёрнутая дробь
    // давала бы долю близко к нулю и «перевыполнение» вместо недобора.
    expect(value('competitive.year.savings_pct')).toBeGreaterThan(0.5);
    expect(value('competitive.year.savings_pct')).toBeLessThan(1);
    expect(value('competitive.year.amount_dev')).toBeLessThan(0);
  });

  it('итог сводного блока равен сумме управлений: агрегат и строки считаются одинаково', () => {
    const depts = ['uo', 'uksimp', 'ud', 'udtx', 'uagzo', 'uio', 'ufbp', 'uer'];
    const sum = depts.reduce((acc, id) => acc + (cells[`grbs.${id}.kp.year.total_fact`]?.numericValue ?? 0), 0);
    expect(sum).toBeGreaterThan(0);
    expect(value('competitive.year.total_fact')).toBeCloseTo(sum, 6);
  });
});
