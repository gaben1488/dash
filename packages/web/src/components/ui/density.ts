// ── Плотность: компактный режим против просторного.
//
//    Один и тот же экран смотрят в двух разных положениях. За рабочим
//    столом читают реестр: нужно, чтобы в высоту помещалось как можно
//    больше строк, и лишний воздух там мешает. На проекторе показывают
//    начальству: нужно, чтобы строку было видно с шести метров.
//
//    Раньше это решалось разными страницами и разными размерами шрифта,
//    прибитыми к разметке. Теперь режим — это одно слово в атрибуте
//    `data-density` на корне документа: имена токенов не меняются,
//    меняются только их числа (`--row-h`, `--cell-pad-*`, `--card-pad`).
//    Ни один компонент об этом не знает и знать не должен.

import { useCallback, useEffect, useState } from 'react';
import type { Density } from './tokens';

const STORAGE_KEY = 'aemr-density';

function readStored(): Density {
  if (typeof window === 'undefined') return 'compact';
  try {
    return window.localStorage.getItem(STORAGE_KEY) === 'comfortable' ? 'comfortable' : 'compact';
  } catch {
    // Хранилище может быть закрыто настройками браузера. Это не повод
    // падать: плотность — предпочтение, а не данные.
    return 'compact';
  }
}

/** Проставить режим на корень документа. Вынесено ради переиспользования в тестах. */
export function applyDensity(density: Density, root?: HTMLElement): void {
  const target = root ?? (typeof document !== 'undefined' ? document.documentElement : undefined);
  if (!target) return;
  // Компактный — умолчание продукта, поэтому он выражен отсутствием
  // атрибута: в разметке живёт только отклонение от нормы.
  if (density === 'compact') target.removeAttribute('data-density');
  else target.setAttribute('data-density', 'comfortable');
}

export function useDensity(): [Density, (next: Density) => void] {
  const [density, setDensity] = useState<Density>(readStored);

  useEffect(() => {
    applyDensity(density);
  }, [density]);

  const change = useCallback((next: Density) => {
    setDensity(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // см. выше: предпочтение не сохранилось — режим всё равно применён.
    }
  }, []);

  return [density, change];
}
