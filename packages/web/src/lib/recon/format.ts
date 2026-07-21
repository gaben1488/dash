// ── Числовое форматирование страницы «Сверка».
//    Извлечено move-only из pages/Recon.tsx (разрез E11-4).

/** Формат числа с нормализацией -0 и floating-point-шума (1e-14) в «0» */
export function fmtNum(n: number): string {
  if (Object.is(n, -0) || Math.abs(n) < 1e-9) return '0';
  return n.toLocaleString('ru-RU', { maximumFractionDigits: 1 });
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
