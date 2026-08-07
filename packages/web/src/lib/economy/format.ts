// ── Компактные подписи осей графиков страницы «Экономия».
//
// Две причины существования файла:
//   1. Латиницы в интерфейсе быть не должно — «1.2M» и «500K» читателю района
//      ничего не говорят (канон §6.3: ни одного внутреннего обозначения).
//   2. Прежняя реализация ошибалась на три порядка: значения приходят
//      В ТЫСЯЧАХ РУБЛЕЙ (см. store.formatMoney — базовая единица «тыс. ₽»),
//      поэтому v/1e6 — это МИЛЛИАРДЫ, а подпись гласила «M» (миллионы).
//      Ось врала в тысячу раз; здесь порядок назван честно.

/**
 * Неразрывный пробел перед единицей измерения: «12,4 млн» не должно
 * разрываться переносом строки, иначе число теряет свой порядок.
 * Тот же символ Intl ставит разделителем разрядов — подписи однородны.
 */
const NBSP = '\u00A0';

/** Русский формат числа с запятой-разделителем и заданной точностью. */
function ru(value: number, digits: number): string {
  return new Intl.NumberFormat('ru-RU', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

/**
 * Подпись деления денежной оси. Вход — тысячи рублей (базовая единица данных).
 * 1 000 тыс. = 1 млн, 1 000 000 тыс. = 1 млрд.
 */
export function formatAxisMoney(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1e6) return `${ru(value / 1e6, 1)}${NBSP}млрд`;
  if (abs >= 1e3) return `${ru(value / 1e3, 1)}${NBSP}млн`;
  return `${ru(value, 0)}${NBSP}тыс.`;
}

/** Подпись деления процентной оси: «12 %». */
export function formatAxisPct(value: number): string {
  return `${ru(value, 0)}${NBSP}%`;
}

/** Доля в тексте: «12,4 %» либо честное «нет плана», когда доли не существует. */
export function formatPct(value: number | null, digits = 1): string {
  return value === null ? 'нет плана' : `${ru(value, digits)}${NBSP}%`;
}
