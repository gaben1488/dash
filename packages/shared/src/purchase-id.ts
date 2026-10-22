/**
 * Identifier in column A of a procurement book. A number such as 12 and a
 * composite identifier such as 12/1 are different procurement addresses.
 *
 * Never coerce a string ID through parseFloat/Number: "12/1", "12/01", and
 * "12" must remain three distinct identifiers across checks and formula audits.
 */
export function purchaseIdText(value: unknown): string | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value > 0 ? String(value) : null;
  }
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text === '' ? null : text;
}

/**
 * Accepted current and legacy forms. A positive numeric spreadsheet cell
 * remains supported; new composite IDs are text with one "/" separator.
 * Do not reformat the text, strip zeroes, or split the ID into numbers.
 */
export function isPurchaseId(value: unknown): boolean {
  const text = purchaseIdText(value);
  if (text === null) return false;
  if (typeof value === 'number') return true;
  if (/^\d+(?:[.,]\d+)?$/.test(text)) {
    return Number(text.replace(',', '.')) > 0;
  }
  return /^\d*[1-9]\d*\/\d+$/.test(text);
}

/** Keep composite purchase IDs out of numeric header heuristics. */
export function isCompositePurchaseId(value: unknown): boolean {
  const text = purchaseIdText(value);
  return typeof value === 'string' && text !== null && /^\d*[1-9]\d*\/\d+$/.test(text);
}
