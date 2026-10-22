import { describe, expect, it } from 'vitest';
import { SHDYU_MONTHLY_SHEET_NAME, SVOD_SHEET_NAME } from '@aemr/shared';
import { validationModeForSource } from './source-validation.js';

describe('Объём проверки источников', () => {
  it('агрегатные книги доступны для чтения, но не получают построчные правила ГРБС', () => {
    expect(validationModeForSource(SVOD_SHEET_NAME)).toBe('access_only');
    expect(validationModeForSource(SHDYU_MONTHLY_SHEET_NAME)).toBe('access_only');
    expect(validationModeForSource('ШДЮ')).toBe('access_only');
  });

  it('книги ГРБС получают реальную проверку строк', () => {
    expect(validationModeForSource('УО')).toBe('rows');
    expect(validationModeForSource('УИО')).toBe('rows');
  });
});
