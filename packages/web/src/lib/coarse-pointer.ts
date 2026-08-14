/**
 * Определение координатного устройства (тач без наведения мыши) — директива
 * владельца п.73а (интервью 14.08.2026): на смартфоне подсказки базы знаний
 * обязаны открываться тапом, потому что наведения там не существует.
 *
 * Правило одно на всю систему: медиазапрос «основной указатель не умеет
 * наводиться ИЛИ он грубый (палец)». Ноутбук с тачскрином остаётся
 * hover-устройством (его основной указатель — мышь), телефон и планшет
 * попадают в координатный режим.
 */
import { useSyncExternalStore } from 'react';

export const COARSE_POINTER_QUERY = '(hover: none), (pointer: coarse)';

/** Узкий контракт matchMedia — ровно то, что нужно проверке (тестируемо без DOM). */
export type MediaMatcher = (query: string) => Pick<MediaQueryList, 'matches'>;

/**
 * Чистая проверка «это координатное устройство?» — принимает matchMedia явно,
 * чтобы страж-тест мог подставить тач-заглушку без браузера.
 */
export function evaluateCoarsePointer(matchMediaFn: MediaMatcher | undefined | null): boolean {
  if (typeof matchMediaFn !== 'function') return false;
  try {
    return matchMediaFn(COARSE_POINTER_QUERY).matches;
  } catch {
    // Сломанный matchMedia (старый WebView) — честный фолбэк на hover-поведение.
    return false;
  }
}

function subscribe(onChange: () => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return () => {};
  }
  const mql = window.matchMedia(COARSE_POINTER_QUERY);
  // addEventListener есть везде, где нам важно; addListener — страховка WebView.
  if (typeof mql.addEventListener === 'function') {
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }
  mql.addListener(onChange);
  return () => mql.removeListener(onChange);
}

function getSnapshot(): boolean {
  if (typeof window === 'undefined') return false;
  return evaluateCoarsePointer(
    typeof window.matchMedia === 'function' ? window.matchMedia.bind(window) : undefined,
  );
}

/** Реактивный флаг координатного устройства (пересчитывается при докинге планшета). */
export function useCoarsePointer(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}
