import { describe, it, expect } from 'vitest';
import {
  classifySheet,
  isSvodFamily,
  isDepartmentSheet,
} from './sheet-classifier.js';
import { SVOD_SHEET_NAME } from './constants.js';
import { SHDYU_SHEET_NAME_CANDIDATES } from './shdyu-map.js';

describe('classifySheet — SSOT распознавания листов', () => {
  it('СВОД ТД-ПМ → svod', () => {
    expect(classifySheet('СВОД ТД-ПМ')).toEqual({ kind: 'svod' });
    expect(classifySheet(SVOD_SHEET_NAME).kind).toBe('svod');
  });

  it('«СВОД с месяцами» (ШДЮ) → shdyu_monthly, НЕ department (корень бага ШДЮ)', () => {
    expect(classifySheet('СВОД с месяцами')).toEqual({ kind: 'shdyu_monthly' });
    // именно этот лист раньше падал в department-scope из-за name === "СВОД ТД-ПМ"
    expect(isDepartmentSheet('СВОД с месяцами')).toBe(false);
    expect(isSvodFamily('СВОД с месяцами')).toBe(true);
  });

  it('legacy ШДЮ / ШДЮ старый → shdyu_monthly', () => {
    for (const n of SHDYU_SHEET_NAME_CANDIDATES) {
      expect(classifySheet(n).kind).toBe('shdyu_monthly');
    }
  });

  it('лист ГРБС по кириллическому имени → department + grbsId', () => {
    expect(classifySheet('УКСиМП')).toMatchObject({ kind: 'department', grbsId: 'УКСиМП', latinId: 'uksimp' });
    expect(classifySheet('УАГЗО')).toMatchObject({ kind: 'department', grbsId: 'УАГЗО', latinId: 'uagzo' });
    expect(classifySheet('УЭР')).toMatchObject({ kind: 'department', grbsId: 'УЭР' });
  });

  it('лист ГРБС по латинскому id → department + grbsId', () => {
    expect(classifySheet('uksimp')).toMatchObject({ kind: 'department', grbsId: 'УКСиМП' });
  });

  it('«ВСЕ» → subordinates_agg (department-семейство, но grbs из имени не выводится)', () => {
    expect(classifySheet('ВСЕ').kind).toBe('subordinates_agg');
    expect(classifySheet('Все').kind).toBe('subordinates_agg');
    expect(isDepartmentSheet('ВСЕ')).toBe(true);
    expect(classifySheet('ВСЕ').grbsId).toBeUndefined();
  });

  it('пустое / мусор → unknown', () => {
    expect(classifySheet('').kind).toBe('unknown');
    expect(classifySheet('   ').kind).toBe('unknown');
    expect(classifySheet('Лист1').kind).toBe('unknown');
  });

  it('scope-инвариант валидации: svod-правила только на svod, department — только на листах ГРБС', () => {
    // СВОД ТД-ПМ: svod-правила да, department-правила нет
    expect(isSvodFamily('СВОД ТД-ПМ')).toBe(true);
    expect(isDepartmentSheet('СВОД ТД-ПМ')).toBe(false);
    // УКСиМП/УАГЗО: department да, svod нет
    expect(isDepartmentSheet('УКСиМП')).toBe(true);
    expect(isSvodFamily('УКСиМП')).toBe(false);
    expect(isDepartmentSheet('УАГЗО')).toBe(true);
    expect(isSvodFamily('УАГЗО')).toBe(false);
  });
});
