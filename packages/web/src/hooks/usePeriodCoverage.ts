import { useEffect, useSyncExternalStore } from 'react';
import { api } from '../api';
import { useStore } from '../store';
import { collectAllPages } from '../lib/rows/collect-pages';
import { buildCoverageIndex, EMPTY_COVERAGE, type CoverageIndex } from '../lib/period-coverage';

/**
 * usePeriodCoverage — по каким периодам в книгах ЕСТЬ строки (недели, месяцы,
 * годы). Питает краски полноты барабанов шапки: неделя/месяц без строк
 * приглушены, будущее — свой вид (см. lib/period-coverage.ts).
 *
 * Почему построчная загрузка, а не dashboardData: агрегаты d.months дают
 * только месяцы ОДНОГО загруженного года, а неделям нужны сами даты строк
 * (план — графа N, факт — графа Q). Общего хука со строками в приложении нет
 * (построчные данные живут локально в Реестре), поэтому покрытие грузит их
 * само — ОДИН раз на вкладку, без фильтра года (все годы одним заходом),
 * с кэшем на уровне модуля, как у useLiveEvents.
 *
 * Цена и защита от неё:
 *   - загрузка стартует с задержкой (COVERAGE_DELAY_MS) — сначала пусть
 *     доедет дашборд, краски полноты не гонка;
 *   - до готовности индекса хук отвечает «неизвестно», и барабаны выглядят
 *     ровно как раньше — никакой регрессии на медленной сети;
 *   - если не доехало НИ ОДНОЙ строки, это считается сбоем, а не пустотой:
 *     статус 'failed', вид барабанов не меняется (сбой сети не должен
 *     красить весь год в «данных нет»).
 */

export interface PeriodCoverageState {
  status: 'idle' | 'loading' | 'ready' | 'failed';
  index: CoverageIndex;
}

/** Пауза перед загрузкой: дашборд и счётчики корзин идут первыми. */
const COVERAGE_DELAY_MS = 1500;
const ROWS_PER_REQUEST = 1000;

let state: PeriodCoverageState = { status: 'idle', index: EMPTY_COVERAGE };
const listeners = new Set<() => void>();
let startTimer: ReturnType<typeof setTimeout> | null = null;

function setState(next: PeriodCoverageState): void {
  state = next;
  for (const l of listeners) l();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

async function loadCoverage(): Promise<void> {
  try {
    const depts = Object.keys(useStore.getState().subordinatesMap);
    const perDept = await Promise.all(depts.map((dept) =>
      collectAllPages<Record<string, unknown>>((page) =>
        api.getRows(dept, {
          limit: String(ROWS_PER_REQUEST),
          ...(page > 1 ? { page: String(page) } : {}),
        }),
      ).catch(() => [] as Record<string, unknown>[]),
    ));
    const rows = perDept.flat();
    if (rows.length === 0) {
      // Ноль строк из ВСЕХ книг — это сбой (сеть/сервер), а не пустой год.
      setState({ status: 'failed', index: EMPTY_COVERAGE });
      return;
    }
    setState({ status: 'ready', index: buildCoverageIndex(rows) });
  } catch {
    setState({ status: 'failed', index: EMPTY_COVERAGE });
  }
}

/** Запустить загрузку индекса (однократно на вкладку, с паузой). */
export function ensurePeriodCoverage(): void {
  if (state.status !== 'idle' || startTimer !== null) return;
  startTimer = setTimeout(() => {
    startTimer = null;
    if (state.status !== 'idle') return;
    setState({ status: 'loading', index: EMPTY_COVERAGE });
    void loadCoverage();
  }, COVERAGE_DELAY_MS);
}

/** Сброс модульного состояния — только для тестов. */
export function resetPeriodCoverage(): void {
  if (startTimer !== null) { clearTimeout(startTimer); startTimer = null; }
  state = { status: 'idle', index: EMPTY_COVERAGE };
}

/**
 * Подписка на индекс покрытия. Монтирование первого потребителя запускает
 * загрузку; дальше все читают один модульный кэш.
 */
export function usePeriodCoverage(): PeriodCoverageState {
  const snapshot = useSyncExternalStore(subscribe, () => state, () => state);
  useEffect(() => { ensurePeriodCoverage(); }, []);
  return snapshot;
}
