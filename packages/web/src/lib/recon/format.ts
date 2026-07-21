// ── Числовое форматирование страницы «Сверка».
//    Извлечено move-only из pages/Recon.tsx (разрез E11-4).

/** Формат числа: -0 и floating-point-шум (<1e-9) → «0»; малые ОСМЫСЛЕННЫЕ
 *  значения не маскируются под ноль — добираем знаки до первой значащей цифры. */
export function fmtNum(n: number): string {
  if (Object.is(n, -0) || Math.abs(n) < 1e-9) return '0';
  const rounded = n.toLocaleString('ru-RU', { maximumFractionDigits: 1 });
  if (rounded === '0' || rounded === '-0') {
    return n.toLocaleString('ru-RU', { maximumSignificantDigits: 2 });
  }
  return rounded;
}

/** Формат процента; шум < 1e-9 → «0%» */
export function fmtPct(n: number): string {
  if (Math.abs(n) < 1e-9) return '0%';
  return `${n.toFixed(1)}%`;
}

/** Эффективный ноль (только floating-point-шум, НЕ округление) */
export function isZero(n: number): boolean {
  return Object.is(n, -0) || Math.abs(n) < 1e-9;
}
