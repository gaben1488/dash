import { describe, it, expect } from 'vitest';
import {
  normalizeCell,
  normalizeMoney,
  normalizeDate,
  normalizeStatus,
  normalizeNumber,
  normalizeReason,
  detectFieldType,
  applyTextNormalization,
  type FieldType,
} from './normalizer-rules.js';

// ────────────────────────────────────────────────────────────
// detectFieldType
// ────────────────────────────────────────────────────────────

describe('detectFieldType (канон столбцов dept-листа)', () => {
  it('money — суммы плана/факта/экономии (H/I/J/K/T/V/W/X/Y/Z/AA/AB/AC)', () => {
    for (const col of ['H', 'I', 'J', 'K', 'T', 'V', 'W', 'X', 'Y', 'Z', 'AA', 'AB', 'AC']) {
      expect(detectFieldType(col)).toBe('money' as FieldType);
    }
  });

  it('date — только даты плана (N) и факта (Q), НЕ квартал/год O/P', () => {
    expect(detectFieldType('N')).toBe('date');
    expect(detectFieldType('Q')).toBe('date');
  });

  it('number — №, квартал/год плана и факта (A/O/P/R/S)', () => {
    for (const col of ['A', 'O', 'P', 'R', 'S']) {
      expect(detectFieldType(col)).toBe('number' as FieldType);
    }
  });

  it('status для U', () => {
    expect(detectFieldType('U')).toBe('status');
  });

  it('text — программа/подпрограмма/предмет (D/E/G), рег.№/подвед/тип/способ (B/C/F/L)', () => {
    for (const col of ['B', 'C', 'D', 'E', 'F', 'G', 'L']) {
      expect(detectFieldType(col)).toBe('text' as FieldType);
    }
    expect(detectFieldType('ZZ')).toBe('text');
  });

  it('is case-insensitive', () => {
    expect(detectFieldType('h')).toBe('money');
    expect(detectFieldType('d')).toBe('text');
    expect(detectFieldType('n')).toBe('date');
  });
});

// ────────────────────────────────────────────────────────────
// normalizeMoney
// ────────────────────────────────────────────────────────────

describe('normalizeMoney', () => {
  it('returns null for null/undefined', () => {
    expect(normalizeMoney(null).normalized).toBeNull();
    expect(normalizeMoney(undefined).normalized).toBeNull();
  });

  it('passes through numbers unchanged', () => {
    const r = normalizeMoney(1250000);
    expect(r.normalized).toBe(1250000);
    expect(r.changed).toBe(false);
  });

  it('parses "1 234 567,89" → 1234567.89', () => {
    const r = normalizeMoney('1 234 567,89');
    expect(r.normalized).toBeCloseTo(1234567.89);
  });

  it('handles "млн" multiplier', () => {
    const r = normalizeMoney('1,25 млн');
    expect(r.normalized).toBe(1250000);
    expect(r.rule).toContain('multiplier');
  });

  it('handles "тыс" multiplier', () => {
    const r = normalizeMoney('1250,0 тыс');
    expect(r.normalized).toBe(1250000);
  });

  it('handles "млрд" multiplier', () => {
    const r = normalizeMoney('2,5 млрд');
    expect(r.normalized).toBe(2500000000);
  });

  it('strips "руб" and "₽"', () => {
    const r = normalizeMoney('500 руб.');
    expect(r.normalized).toBe(500);
  });

  it('returns null for empty patterns', () => {
    expect(normalizeMoney('').normalized).toBeNull();
    expect(normalizeMoney('-').normalized).toBeNull();
    expect(normalizeMoney('н/д').normalized).toBeNull();
  });

  it('returns null for unparseable strings', () => {
    const r = normalizeMoney('abc');
    expect(r.normalized).toBeNull();
    expect(r.rule).toBe('invalid_money');
  });
});

// ────────────────────────────────────────────────────────────
// normalizeDate
// ────────────────────────────────────────────────────────────

describe('normalizeDate', () => {
  it('returns null for null/undefined', () => {
    expect(normalizeDate(null).normalized).toBeNull();
    expect(normalizeDate(undefined).normalized).toBeNull();
  });

  it('passes through ISO format unchanged', () => {
    const r = normalizeDate('2026-03-15');
    expect(r.normalized).toBe('2026-03-15');
    expect(r.changed).toBe(false);
  });

  it('converts Russian dd.mm.yyyy to ISO', () => {
    const r = normalizeDate('15.03.2026');
    expect(r.normalized).toBe('2026-03-15');
    expect(r.rule).toBe('date_ru_to_iso');
  });

  it('converts short year dd.mm.yy (yy<=50 → 20xx)', () => {
    const r = normalizeDate('15.03.26');
    expect(r.normalized).toBe('2026-03-15');
  });

  it('converts short year dd.mm.yy (yy>50 → 19xx)', () => {
    const r = normalizeDate('15.03.95');
    expect(r.normalized).toBe('1995-03-15');
  });

  it('returns null for empty patterns', () => {
    expect(normalizeDate('-').normalized).toBeNull();
    expect(normalizeDate('н/д').normalized).toBeNull();
  });

  it('handles unknown format gracefully', () => {
    const r = normalizeDate('some random text');
    expect(r.rule).toBe('date_unknown_format');
  });
});

// ────────────────────────────────────────────────────────────
// normalizeStatus
// ────────────────────────────────────────────────────────────

describe('normalizeStatus', () => {
  it('returns null for null/undefined', () => {
    expect(normalizeStatus(null).normalized).toBeNull();
  });

  it('normalizes typo "подписанн" → "подписан"', () => {
    const r = normalizeStatus('подписанн');
    expect(r.normalized).toBe('подписан');
    expect(r.changed).toBe(true);
  });

  it('normalizes synonym "заключен" → "подписан"', () => {
    expect(normalizeStatus('заключен').normalized).toBe('подписан');
  });

  it('normalizes "в разработке" → "планируется"', () => {
    expect(normalizeStatus('в разработке').normalized).toBe('планируется');
  });

  it('normalizes "снята" → "отменена"', () => {
    expect(normalizeStatus('снята').normalized).toBe('отменена');
  });

  it('returns as-is for unknown status', () => {
    const r = normalizeStatus('неизвестный статус');
    expect(r.normalized).toBe('неизвестный статус');
    expect(r.changed).toBe(false);
  });

  it('returns null for empty patterns', () => {
    expect(normalizeStatus('-').normalized).toBeNull();
    expect(normalizeStatus('н/д').normalized).toBeNull();
  });
});

// ────────────────────────────────────────────────────────────
// normalizeNumber
// ────────────────────────────────────────────────────────────

describe('normalizeNumber', () => {
  it('returns null for null/undefined', () => {
    expect(normalizeNumber(null).normalized).toBeNull();
  });

  it('passes through numbers unchanged', () => {
    const r = normalizeNumber(42);
    expect(r.normalized).toBe(42);
    expect(r.changed).toBe(false);
  });

  it('parses string number with comma', () => {
    const r = normalizeNumber('1 250,5');
    expect(r.normalized).toBeCloseTo(1250.5);
  });

  it('converts percentage to decimal', () => {
    const r = normalizeNumber('75%');
    expect(r.normalized).toBe(0.75);
    expect(r.rule).toBe('percent_to_decimal');
    expect(r.fieldType).toBe('percent');
  });

  it('returns null for unparseable strings', () => {
    expect(normalizeNumber('abc').normalized).toBeNull();
  });

  it('handles empty patterns', () => {
    expect(normalizeNumber('').normalized).toBeNull();
    expect(normalizeNumber('н/д').normalized).toBeNull();
  });
});

// ────────────────────────────────────────────────────────────
// normalizeCell
// ────────────────────────────────────────────────────────────

describe('normalizeCell', () => {
  it('delegates to normalizeMoney for money columns', () => {
    const r = normalizeCell('H', '1 500');
    expect(r.fieldType).toBe('money');
    expect(r.normalized).toBe(1500);
  });

  it('delegates to normalizeDate for date columns', () => {
    const r = normalizeCell('N', '15.03.2026');
    expect(r.fieldType).toBe('date');
    expect(r.normalized).toBe('2026-03-15');
  });

  it('delegates to normalizeStatus for status column U', () => {
    const r = normalizeCell('U', 'заключен');
    expect(r.fieldType).toBe('status');
    expect(r.normalized).toBe('подписан');
  });

  it('handles null/undefined for text columns', () => {
    const r = normalizeCell('B', null);
    expect(r.normalized).toBeNull();
  });

  it('trims text and detects empty patterns for text columns', () => {
    const r = normalizeCell('B', 'н/д');
    expect(r.normalized).toBeNull();
    expect(r.fieldType).toBe('empty');
  });

  it('trims whitespace on text columns', () => {
    const r = normalizeCell('B', '  hello  ');
    expect(r.normalized).toBe('hello');
  });
});

// ────────────────────────────────────────────────────────────
// applyTextNormalization
// ────────────────────────────────────────────────────────────

describe('applyTextNormalization', () => {
  it('collapses double spaces', () => {
    const r = applyTextNormalization('hello   world');
    expect(r.cleaned).toBe('hello world');
    expect(r.appliedRules).toContain('text_double_space');
  });

  it('trims leading/trailing whitespace', () => {
    const r = applyTextNormalization('  hello  ');
    expect(r.cleaned).toBe('hello');
    expect(r.appliedRules).toContain('text_trailing_space');
  });

  it('normalizes fancy quotes', () => {
    const r = applyTextNormalization('«hello»');
    expect(r.cleaned).toBe('"hello"');
    expect(r.appliedRules).toContain('text_quotes_normalize');
  });

  it('returns empty appliedRules when no changes needed', () => {
    const r = applyTextNormalization('clean text');
    expect(r.cleaned).toBe('clean text');
    expect(r.appliedRules).toHaveLength(0);
  });
});

// ────────────────────────────────────────────────────────────
// normalizeReason
// ────────────────────────────────────────────────────────────

describe('normalizeReason', () => {
  it('maps known variant to template', () => {
    const r = normalizeReason('нет предложений');
    expect(r.normalized).toBe('отсутствие предложений');
    expect(r.rule).toBe('reason_template');
  });

  it('returns as-is for unknown reasons', () => {
    const r = normalizeReason('неизвестная причина');
    expect(r.normalized).toBe('неизвестная причина');
    expect(r.changed).toBe(false);
  });

  it('returns null for empty patterns', () => {
    expect(normalizeReason('-').normalized).toBeNull();
  });
});
