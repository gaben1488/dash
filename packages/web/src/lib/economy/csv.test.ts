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
    deptOnly: false,
    ...partial,
  };
}

describe('buildEconomyCsv', () => {
  it('начинается с BOM и заголовка из 18 колонок без сокращений-жаргона', () => {
    const csv = buildEconomyCsv([row()]);
    expect(csv.startsWith('﻿')).toBe(true);
    const header = csv.slice(1).split('\n')[0];
    expect(header.split(';')).toHaveLength(18);
    expect(header.startsWith('Управление;Лимит;Факт;Экономия;Официальный итог СВОД;Доля экономии, %')).toBe(true);
    expect(header).toContain('Экономия ФБ');
    expect(header).toContain('Экономия свыше 25 %');
    expect(header).toContain('Расхождения');
  });

  it('строка управления: суммы и доли с запятой (русский Excel), флаги Да/Нет', () => {
    const line = buildEconomyCsv([row()]).split('\n')[1];
    const cells = line.split(';');
    expect(cells).toHaveLength(18);
    expect(cells[0]).toBe('УЭР');
    // Точка вместо запятой заставила бы русский Excel считать число текстом.
    expect(cells[1]).toBe('1000,00');
    expect(cells[4]).toBe('101,50'); // официальный итог СВОД
    expect(cells[5]).toBe('10,0');
    expect(cells[6]).toBe('600,00'); // лимит ФБ
    expect(cells[15]).toBe('Нет');
    expect(cells[16]).toBe('2');
    expect(cells[17]).toBe('1');
  });

  it('официальный итог пуст, когда его нет; превышение 25 % — «Да»', () => {
    const cells = buildEconomyCsv([row({ economyOfficial: null, highEconomy: true })]).split('\n')[1].split(';');
    expect(cells[4]).toBe('');
    expect(cells[15]).toBe('Да');
  });

  it('нет лимита → ячейка доли пустая, а не «0,0»', () => {
    const cells = buildEconomyCsv([row({ limit: 0, pct: null })]).split('\n')[1].split(';');
    expect(cells[5]).toBe('');
  });

  it('строки подведомственных: отступ, человекочитаемый аппарат, 18 полей', () => {
    const lines = buildEconomyCsv([row()]).split('\n');
    expect(lines).toHaveLength(4); // заголовок + управление + 2 подведа
    const orgLine = lines[2].split(';');
    expect(orgLine[0]).toBe(`  ${ORG_ITSELF_LABEL}`);
    expect(orgLine).toHaveLength(18);
    expect(orgLine[1]).toBe('500,00');
    expect(orgLine[4]).toBe(''); // у подведа нет официального итога
    expect(orgLine[5]).toBe('10,0');
    const subLine = lines[3].split(';');
    expect(subLine[0]).toBe('  Школа 1');
    expect(subLine[6]).toBe(''); // бюджет-колонки подведов пустые
  });

  it('имя с точкой с запятой или кавычкой экранируется и не рвёт колонки', () => {
    const csv = buildEconomyCsv([row({
      subordinates: [{ name: 'МБОУ «Школа №1»; корпус 2', planTotal: 1, factTotal: 1, economy: 0, pct: 0, budget }],
    })]);
    const subLine = csv.split('\n')[2];
    expect(subLine.startsWith('"  МБОУ «Школа №1»; корпус 2"')).toBe(true);
  });
});

describe('economyCsvFilename', () => {
  it('имя файла на языке читателя, без латиницы', () => {
    expect(economyCsvFilename(new Date('2026-07-23T10:00:00Z'))).toBe('Экономия_2026-07-23.csv');
  });
});
