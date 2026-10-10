/** Проверка пользовательских значений ДО обращения к Google Sheets.
 * Текст разбирается целиком: parseFloat('12abc') и Infinity недопустимы.
 * Значение в источнике остаётся в тысячах рублей — без конвертации единиц.
 */
export function parseWritableMoney(raw: unknown): number | null {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  if (typeof raw !== 'string') return null;
  const text = raw.trim().replace(/[\u00a0\u202f]/g, ' ');
  // Непрерывное число или корректные трёхзначные группы с пробелами.
  if (!/^[+-]?(?:\d+(?:[.,]\d+)?|\d{1,3}(?: \d{3})+(?:[.,]\d+)?)$/.test(text)) return null;
  const amount = Number(text.replace(/ /g, '').replace(',', '.'));
  return Number.isFinite(amount) ? amount : null;
}

/** Запись даты не должна превращать несуществующий день в следующий месяц.
 * Принимаем точный гражданский день в привычной форме или YYYY-MM-DD.
 * Пустая строка — осознанное очищение поля.
 */
export function isWritableDate(raw: unknown): boolean {
  if (typeof raw !== 'string') return false;
  const text = raw.trim();
  if (!text) return true;
  const ru = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(text);
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!ru && !iso) return false;
  const year = Number(ru ? ru[3] : iso![1]);
  const month = Number(ru ? ru[2] : iso![2]);
  const day = Number(ru ? ru[1] : iso![3]);
  if (year < 100 || month < 1 || month > 12 || day < 1 || day > 31) return false;
  const actual = new Date(Date.UTC(year, month - 1, day));
  return actual.getUTCFullYear() === year
    && actual.getUTCMonth() + 1 === month
    && actual.getUTCDate() === day;
}
