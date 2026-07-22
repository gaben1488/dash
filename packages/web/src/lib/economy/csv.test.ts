import { describe, expect, it } from 'vitest';
import { ORG_ITSELF_LABEL } from '../subordinate-label';
import { buildEconomyCsv, economyCsvFilename } from './csv';
import { ORG_ITSELF } from './types';
import type { BudgetData, DeptEconomy } from './types';

const budget: BudgetData = {
  planFB: 600, planKB: 300, planMB: 100,
  factFB: 540, factKB: 270, factMB: 90,
  economyFB: 60, economyKB: 30, economyMB: 10,
};

function row(partial: Partial<DeptEconomy> = {}): DeptEconomy {
  return {
    dept: 'УЭР', deptId: 'УЭР',
    limit: 1000, price: 900, economy: 100, economyOfficial: 101.5,
    pct: 10, highEconomy: false, conflicts: 2,
    budget,
    subordinates: [
      { name: ORG_ITSELF, planTotal: 500, factTotal: 450, economy: 50, pct: 10, budget },
      { name: 'Школа 1', planTotal: 400, factTotal: 350, economy: 50, pct: 12.5, budget },
    ],
    realSubCount: 1,
    ...partial,
  };
}

describe('buildEconomyCsv', () => {
  it('начинается с BOM и заголовка из 18 колонок', () => {
    const csv = buildEconomyCsv([row()]);
    expect(csv.startsWith('﻿')).toBe(true);
    const header = csv.slice(1).split('\n')[0];
    expect(header.split(';')).toHaveLength(18);
    expect(header.startsWith('Управление;Лимит;Факт;Экономия;СВОД;%')).toBe(true);
  });

  it('строка ГРБС: суммы .toFixed(2), проценты .toFixed(1), флаги Да/Нет', () => {
    const line = buildEconomyCsv([row()]).split('\n')[1];
    const cells = line.split(';');
    expect(cells).toHaveLength(18);
    expect(cells[0]).toBe('УЭР');
    expect(cells[1]).toBe('1000.00');
    expect(cells[4]).toBe('101.50'); // СВОД — официальный итог
    expect(cells[5]).toBe('10.0');
    expect(cells[6]).toBe('600.00'); // Лимит ФБ
    expect(cells[15]).toBe('Нет');
    expect(cells[16]).toBe('2');
    expect(cells[17]).toBe('1');
  });

  it('СВОД пуст, когда официального итога нет; >25% — «Да»', () => {
    const cells = buildEconomyCsv([row({ economyOfficial: null, highEconomy: true })]).split('\n')[1].split(';');
    expect(cells[4]).toBe('');
    expect(cells[15]).toBe('Да');
  });

  it('строки подведов: отступ, человекочитаемый ORG_ITSELF, 18 полей', () => {
    const lines = buildEconomyCsv([row()]).split('\n');
    expect(lines).toHaveLength(4); // заголовок + ГРБС + 2 подведа
    const orgLine = lines[2].split(';');
    expect(orgLine[0]).toBe(`  ${ORG_ITSELF_LABEL}`);
    expect(orgLine).toHaveLength(18);
    expect(orgLine[1]).toBe('500.00');
    expect(orgLine[4]).toBe(''); // у подведа нет колонки СВОД
    expect(orgLine[5]).toBe('10.0');
    const subLine = lines[3].split(';');
    expect(subLine[0]).toBe('  Школа 1');
    expect(subLine[6]).toBe(''); // бюджет-колонки подведов пустые
  });
});

describe('economyCsvFilename', () => {
  it('economy_YYYY-MM-DD.csv', () => {
    expect(economyCsvFilename(new Date('2026-07-23T10:00:00Z'))).toBe('economy_2026-07-23.csv');
  });
});
