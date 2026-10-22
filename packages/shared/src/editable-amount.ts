/**
 * One strict numeric-input contract for spreadsheet editing, client + API.
 * Explicitly does not silently truncate "12abc" to 12 or "1 234,50" to 1.
 * Values in the GRBS editors are in thousands of rubles, not rubles.
 */
export type EditableAmount = { ok: true; value: number | null } | { ok: false };
export type PercentEncoding = 'fraction' | 'points';

export function parseSheetNumber(raw: unknown): number | null {
  const parsed = parseEditableAmount(raw);
  return parsed.ok ? parsed.value : null;
}

/** Return a fraction. A literal % is explicit; bare numbers use the source contract. */
export function parsePercentage(raw: unknown, encoding: PercentEncoding): EditableAmount {
  const marked = typeof raw === 'string' && raw.trim().endsWith('%');
  const parsed = parseEditableAmount(marked ? (raw as string).trim().slice(0, -1) : raw);
  if (marked && parsed.ok && parsed.value === null) return { ok: false };
  if (!parsed.ok || parsed.value === null) return parsed;
  return { ok: true, value: marked || encoding === 'points' ? parsed.value / 100 : parsed.value };
}

export function parseEditableAmount(raw: unknown): EditableAmount {
  if (raw === null || raw === undefined || raw === '') return { ok: true, value: null };
  if (typeof raw === 'number') {
    return Number.isFinite(raw) ? { ok: true, value: raw } : { ok: false };
  }
  if (typeof raw !== 'string') return { ok: false };
  const input = raw.trim();
  if (!input) return { ok: true, value: null };
  // Russian grouping spaces, including non-breaking and narrow no-break space,
  // plus either a dot or a comma decimal separator (but not exponent/garbage).
  if (!/^[+-]?(?:\d+|\d{1,3}(?:[ \u00a0\u202f]\d{3})+)(?:[.,]\d+)?$/.test(input)) {
    return { ok: false };
  }
  const value = Number(input.replace(/[ \u00a0\u202f]/g, '').replace(',', '.'));
  return Number.isFinite(value) ? { ok: true, value } : { ok: false };
}
