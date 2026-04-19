import { describe, it, expect } from 'vitest';
import {
  validateInput,
  isFormulaColumn,
  isEditableColumn,
  getColumnDescription,
} from './input-control.js';

// ────────────────────────────────────────────────────────────
// isFormulaColumn
// ────────────────────────────────────────────────────────────

describe('isFormulaColumn', () => {
  it('returns true for known formula columns', () => {
    for (const col of ['K', 'O', 'P', 'R', 'S', 'T', 'Y', 'Z', 'AA', 'AB', 'AC']) {
      expect(isFormulaColumn(col)).toBe(true);
    }
  });

  it('returns false for non-formula columns', () => {
    expect(isFormulaColumn('B')).toBe(false);
    expect(isFormulaColumn('G')).toBe(false);
  });

  it('is case-insensitive', () => {
    expect(isFormulaColumn('k')).toBe(true);
    expect(isFormulaColumn('aa')).toBe(true);
  });
});

// ────────────────────────────────────────────────────────────
// isEditableColumn
// ────────────────────────────────────────────────────────────

describe('isEditableColumn', () => {
  it('returns true for editable columns', () => {
    for (const col of ['B', 'C', 'D', 'E', 'F', 'G', 'U', 'AD']) {
      expect(isEditableColumn(col)).toBe(true);
    }
  });

  it('returns false for formula columns', () => {
    expect(isEditableColumn('K')).toBe(false);
    expect(isEditableColumn('AC')).toBe(false);
  });

  it('returns false for protected columns', () => {
    expect(isEditableColumn('A')).toBe(false);
  });

  it('is case-insensitive', () => {
    expect(isEditableColumn('b')).toBe(true);
    expect(isEditableColumn('ad')).toBe(true);
  });
});

// ────────────────────────────────────────────────────────────
// getColumnDescription
// ────────────────────────────────────────────────────────────

describe('getColumnDescription', () => {
  it('returns description for known columns', () => {
    expect(getColumnDescription('A')).toBe('№ п/п');
    expect(getColumnDescription('B')).toBe('Управление (ГРБС)');
    expect(getColumnDescription('U')).toBe('Статус');
  });

  it('returns fallback for unknown columns', () => {
    expect(getColumnDescription('ZZ')).toBe('Колонка ZZ');
  });

  it('is case-insensitive', () => {
    expect(getColumnDescription('a')).toBe('№ п/п');
    expect(getColumnDescription('u')).toBe('Статус');
  });
});

// ────────────────────────────────────────────────────────────
// validateInput
// ────────────────────────────────────────────────────────────

describe('validateInput', () => {
  it('rejects formula columns', () => {
    const r = validateInput('K', 100, 5);
    expect(r.valid).toBe(false);
    expect(r.reason).toContain('формулу');
  });

  it('rejects protected columns', () => {
    const r = validateInput('A', 1, 5);
    expect(r.valid).toBe(false);
    expect(r.reason).toContain('защищена');
  });

  it('rejects header rows (rowIndex <= 3)', () => {
    const r = validateInput('B', 'test', 2);
    expect(r.valid).toBe(false);
    expect(r.reason).toContain('заголовков');
  });

  it('accepts valid text input for editable column', () => {
    const r = validateInput('B', 'Департамент X', 5);
    expect(r.valid).toBe(true);
    expect(r.normalizedValue).toBe('Департамент X');
  });

  it('accepts valid money input and normalizes', () => {
    const r = validateInput('G', '1 500', 5);
    expect(r.valid).toBe(true);
    expect(r.normalizedValue).toBe(1500);
  });

  it('rejects money value exceeding max', () => {
    const r = validateInput('G', '99 000 000 000', 5);
    expect(r.valid).toBe(false);
    expect(r.reason).toContain('10 млрд');
  });

  it('rejects negative money value', () => {
    const r = validateInput('G', '-500', 5);
    expect(r.valid).toBe(false);
  });

  it('flags normalization with requiresConfirmation', () => {
    const r = validateInput('G', '1,5 млн', 5);
    expect(r.valid).toBe(true);
    expect(r.requiresConfirmation).toBe(true);
    expect(r.normalizedValue).toBe(1500000);
  });

  it('rejects unrecognizable money values', () => {
    const r = validateInput('G', 'not a number', 5);
    expect(r.valid).toBe(false);
  });

  it('accepts null/empty input (optional field)', () => {
    const r = validateInput('B', null, 5);
    expect(r.valid).toBe(true);
  });

  it('rejects unknown columns not in any set', () => {
    const r = validateInput('ZZ', 'test', 5);
    expect(r.valid).toBe(false);
    expect(r.reason).toContain('не предусмотрена');
  });

  it('validates status column with normalization', () => {
    const r = validateInput('U', 'подписанн', 5);
    expect(r.valid).toBe(true);
    expect(r.normalizedValue).toBe('подписан');
    expect(r.requiresConfirmation).toBe(true);
  });
});
