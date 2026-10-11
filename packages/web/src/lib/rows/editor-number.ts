/**
 * Strict editor number grammar, aligned with rows.ts write validation.
 * Never truncate "12abc" to 12 or turn "1e309" into Infinity.
 */
export function parseEditorNumber(value: unknown): number | null | string {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : String(value);
  if (typeof value !== 'string') return String(value);
  const text = value.replace(/₽/g, '').trim().replace(/[\u00a0\u202f]/g, ' ');
  if (!text || text === '—') return null;
  if (!/^[+-]?(?:\d+|\d{1,3}(?: \d{3})+)(?:[.,]\d+)?$/.test(text)) return value;
  const num = Number(text.replace(/ /g, '').replace(',', '.'));
  return Number.isFinite(num) ? num : value;
}
