import { describe, expect, it } from 'vitest';
import { looksLikeEconomyDisposal } from './disposal';

describe('looksLikeEconomyDisposal — безопасная подсветка (п.85/12б)', () => {
  it('ловит просьбы о перераспределении экономии', () => {
    expect(looksLikeEconomyDisposal('Просим перераспределить экономию на ремонт кровли')).toBe(true);
    expect(looksLikeEconomyDisposal('Перераспределение экономии по итогам аукциона')).toBe(true);
    expect(looksLikeEconomyDisposal('Экономию направить на закупку оборудования')).toBe(true);
    expect(looksLikeEconomyDisposal('закупка за счёт экономии по торгам')).toBe(true);
    expect(looksLikeEconomyDisposal('за счет экономии 1 кв.')).toBe(true);
    expect(looksLikeEconomyDisposal('направить сэкономленные средства на ГСМ')).toBe(true);
  });

  it('молчит на обычных комментариях — лучше пропустить, чем оболгать', () => {
    expect(looksLikeEconomyDisposal('Договор будет заключен до 01.09.2026')).toBe(false);
    expect(looksLikeEconomyDisposal('Экономия по итогам аукциона 12 %')).toBe(false);
    expect(looksLikeEconomyDisposal('нецелесообразность проведения аукциона')).toBe(false);
    expect(looksLikeEconomyDisposal('хотелки')).toBe(false);
    expect(looksLikeEconomyDisposal('')).toBe(false);
    expect(looksLikeEconomyDisposal(null)).toBe(false);
    expect(looksLikeEconomyDisposal(undefined)).toBe(false);
  });

  it('не машинный статус: короткие обрывки не подсвечиваются', () => {
    expect(looksLikeEconomyDisposal('экономия')).toBe(false);
    expect(looksLikeEconomyDisposal('Х')).toBe(false);
  });
});
