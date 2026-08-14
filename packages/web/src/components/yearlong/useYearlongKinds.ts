/**
 * useYearlongKinds — пользовательская разметка видов стадии «в течение года».
 *
 * Канон п.83: владелец размечает вид одним кликом, продукт запоминает.
 * Стартовая разметка 46 строк живёт данными в @aemr/shared; сервер хранит
 * только ОВЕРРАЙДЫ поверх неё, и здесь они читаются один раз на приложение
 * (модульный кэш с подписчиками — Реестр, карточка строки и «Конкуренция»
 * видят одну и ту же разметку, а не три несогласованные копии).
 *
 * Отказ сервера НЕ прячет стадию: виды честно падают на стартовую разметку,
 * а ошибка отдаётся наружу текстом для плашки.
 */
import { useCallback, useEffect, useState } from 'react';
import { isYearlongKindId, type YearlongKindId } from '@aemr/shared';
import { api, humanizeRequestError } from '../../api';

export interface YearlongKindsState {
  /** Оверрайды владельца: ключ «книга:№п/п» → вид. */
  overrides: ReadonlyMap<string, YearlongKindId>;
  /** Ключи строк, чья разметка помечена «предварительная» (п.83б). */
  provisional: ReadonlySet<string>;
  /** true, пока идёт первое чтение с сервера. */
  loading: boolean;
  /** Человеческая причина отказа чтения/записи; null — всё в порядке. */
  error: string | null;
}

interface CacheShape {
  overrides: Map<string, YearlongKindId>;
  provisional: Set<string>;
  loading: boolean;
  error: string | null;
}

let cache: CacheShape = { overrides: new Map(), provisional: new Set(), loading: true, error: null };
let fetched = false;
const listeners = new Set<() => void>();

function notify(): void {
  for (const l of listeners) l();
}

function setCache(next: Partial<CacheShape>): void {
  cache = { ...cache, ...next };
  notify();
}

async function fetchOnce(): Promise<void> {
  if (fetched) return;
  fetched = true;
  try {
    const res = await api.getYearlongAnnotations();
    const overrides = new Map<string, YearlongKindId>();
    const provisional = new Set<string>();
    for (const o of res.overrides ?? []) {
      if (!isYearlongKindId(o.kind)) continue; // чужое значение в БД — молча не глотаем в типы
      const key = `${o.dept}:${o.ppNum}`;
      overrides.set(key, o.kind);
      if (o.provisional) provisional.add(key);
    }
    setCache({ overrides, provisional, loading: false, error: null });
  } catch (err) {
    setCache({ loading: false, error: humanizeRequestError(err) });
  }
}

/** Сбросить кэш (для тестов). */
export function __resetYearlongKindsCache(): void {
  cache = { overrides: new Map(), provisional: new Set(), loading: true, error: null };
  fetched = false;
}

/** Текущее состояние разметки (общий кэш) + перечитывание при первом маунте. */
export function useYearlongKinds(): YearlongKindsState & {
  /** Разметить вид строки; kind=null — снять оверрайд. Оптимистично, с откатом. */
  setKind: (dept: string, ppNum: string, kind: YearlongKindId | null, provisional?: boolean) => Promise<boolean>;
} {
  const [, force] = useState(0);

  useEffect(() => {
    const listener = () => force((n) => n + 1);
    listeners.add(listener);
    void fetchOnce();
    return () => { listeners.delete(listener); };
  }, []);

  const setKind = useCallback(
    async (dept: string, ppNum: string, kind: YearlongKindId | null, provisional?: boolean): Promise<boolean> => {
      const key = `${dept}:${ppNum}`;
      const prevOverrides = cache.overrides;
      const prevProvisional = cache.provisional;

      // Оптимистично: экран отвечает на клик сразу, сервер догоняет.
      const nextOverrides = new Map(prevOverrides);
      const nextProvisional = new Set(prevProvisional);
      if (kind === null) {
        nextOverrides.delete(key);
        nextProvisional.delete(key);
      } else {
        nextOverrides.set(key, kind);
        if (provisional) nextProvisional.add(key);
        else nextProvisional.delete(key);
      }
      setCache({ overrides: nextOverrides, provisional: nextProvisional, error: null });

      try {
        await api.putYearlongAnnotation(dept, ppNum, kind, provisional);
        return true;
      } catch (err) {
        // Откат: разметка не сохранилась — экран не должен врать, что сохранилась.
        setCache({ overrides: prevOverrides, provisional: prevProvisional, error: humanizeRequestError(err) });
        return false;
      }
    },
    [],
  );

  return {
    overrides: cache.overrides,
    provisional: cache.provisional,
    loading: cache.loading,
    error: cache.error,
    setKind,
  };
}
