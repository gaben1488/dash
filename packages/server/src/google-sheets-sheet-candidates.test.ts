import { describe, expect, it } from 'vitest';
import { departmentSheetNameCandidates } from './services/sheet-name-candidates.js';
import { sheetValuesRange } from './services/sheet-range.js';

describe('department sheet name candidates', () => {
  it('keeps the uppercase aggregate sheet first and still tolerates title case', () => {
    expect(departmentSheetNameCandidates('ВСЕ', 'УО')).toEqual(['ВСЕ', 'Все', 'УО']);
  });

  it('tolerates the legacy title-case aggregate spelling', () => {
    expect(departmentSheetNameCandidates('Все', 'УКСиМП')).toEqual(['Все', 'ВСЕ', 'УКСиМП']);
  });

  it('does not add aggregate fallbacks for a direct department sheet', () => {
    expect(departmentSheetNameCandidates('УИО', 'УИО')).toEqual(['УИО']);
  });
});

describe('Google Sheets values range builder', () => {
  it('builds an explicit A1 range for a whole sheet read', () => {
    expect(sheetValuesRange('ШДЮ')).toBe("'ШДЮ'!A:ZZ");
  });

  it('escapes apostrophes inside sheet names', () => {
    expect(sheetValuesRange("O'Brien", 'A1:C10')).toBe("'O''Brien'!A1:C10");
  });
});
