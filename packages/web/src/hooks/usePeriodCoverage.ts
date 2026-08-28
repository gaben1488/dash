import { useEffect, useSyncExternalStore } from 'react';
import { api } from '../api';
import { useStore } from '../store';
import { collectAllPages } from '../lib/rows/collect-pages';
import {
  buildCoverageIndex,
  EMPTY_COVERAGE,
  summarizeBookLoads,
  type BookLoadResult,
  type CoverageIndex,
  type CoverageStatus,
} from '../lib/period-coverage';

/**
 * usePeriodCoverage — по каким периодам в книгах ЕСТЬ строки (недели, месяцы,
 * годы). Питает краски полноты барабанов шапки: неделя/месяц без строк
 * приглушены, будущее — свой вид (см. lib/period-coverage.ts).
 *
 * Почему построчная загрузка, а не dashboardData: агрегаты d.months дают
 * только месяцы ОДНОГО загруженного года, а неделям нужны сами даты строк
 * (план — графа N, факт — графа Q). Общего хука со строками в приложении нет
 * (построчные данные живут локально в Реестре), поэтому покрытие грузит их
 * само — один раз на вкладку, без фильтра года (все годы одним заходом),
 * с кэшем на уровне модуля, как у useLiveEvents.
 *
 * Цена и защита от неё:
 *   - загрузка стартует с задержкой (COVERAGE_DELAY_MS) — сначала пусть
 *     доедет дашборд, краски полноты не гонка;
 *   - до готовности индекса хук отвечает «неизвестно», и барабаны выглядят
 *     ровно как раньше — никакой регрессии на медленной сети;
 *   - успех считается ПО-КНИЖНО (находка 28.08: отказ книги глотался как
 *     пустота): все книги целиком → 'ready'; хоть одна не далась целиком →
 *     'partial' — доехавшее в индексе, но пустота периодов не доказана
 *     (classifyPeriodByStatus красит их обычным видом, не приглушением);
 *     не доехало ничего → 'failed', вид барабанов не меняется;
 *   - после 'failed' индекс не хоронится навсегда: следующий зов
 *     ensurePeriodCoverage повторяет загрузку, но не чаще RETRY_PAUSE_MS;
 *   - invalidatePeriodCoverage() сбрасывает индекс к 'idle' — вешается
 *     потребителем на события эфира (сам хук useLiveEvents не трогает).
 */

export interface PeriodCoverageState {
  status: CoverageStatus;
  index: CoverageIndex;
}

/** Пауза перед загрузкой: дашборд и счётчики корзин идут первыми. */
const COVERAGE_DELAY_MS = 1500;
const ROWS_PER_REQUEST = 1000;
/** Пауза перед повтором после сбоя: не долбить упавший сервер чаще раза в минуту. */
const RETRY_PAUSE_MS = 60_000;

let state: PeriodCoverageState = { status: 'idle', index: EMPTY_COVERAGE };
const listeners = new Set<() => void>();
let startTimer: ReturnType<typeof setTimeout> | null = null;
/** Момент старта последней загрузки — от него отсчитывается пауза повтора. */
let lastAttemptAt = 0;
/** Поколение загрузки: сброс индекса делает ответ в полёте чужим. */
let loadGeneration = 0;

function setState(next: PeriodCoverageState): void {
  state = next;
  for (const l of listeners) l();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

async function loadCoverage(): Promise<void> {
  const generation = loadGeneration;
  lastAttemptAt = Date.now();
  try {
    const depts = Object.keys(useStore.getState().subordinatesMap);
    const books: BookLoadResult[] = await Promise.all(depts.map(async (dept) => {
      let wholeBook = true;
      const rows = await collectAllPages<Record<string, unknown>>(
        (page) => api.getRows(dept, {
          limit: String(ROWS_PER_REQUEST),
          ...(page > 1 ? { page: String(page) } : {}),
        }),
        { onPageError: () => { wholeBook = false; } },
      );
      return { ok: wholeBook, rows };
    }));
    if (generation !== loadGeneration) return; // индекс сброшен, пока грузились
    const { status, rows } = summarizeBookLoads(books);
    setState(status === 'failed'
      ? { status: 'failed', index: EMPTY_COVERAGE }
      : { status, index: buildCoverageIndex(rows) });
  } catch {
    if (generation !== loadGeneration) return;
    setState({ status: 'failed', index: EMPTY_COVERAGE });
  }
}

/**
 * Запустить загрузку индекса: однократно на вкладку (с паузой — дашборд идёт
 * первым), а после сбоя — повтор при следующем зове, но не чаще RETRY_PAUSE_MS
 * от старта последней попытки.
 */
export function ensurePeriodCoverage(): void {
  if (state.status === 'failed') {
    if (Date.now() - lastAttemptAt < RETRY_PAUSE_MS) return;
    setState({ status: 'loading', index: EMPTY_COVERAGE });
    void loadCoverage();
    return;
  }
  if (state.status !== 'idle' || startTimer !== null) return;
  startTimer = setTimeout(() => {
    startTimer = null;
    if (state.status !== 'idle') return;
    setState({ status: 'loading', index: EMPTY_COVERAGE });
    void loadCoverage();
  }, COVERAGE_DELAY_MS);
}

/**
 * Сбросить индекс к 'idle' — покрытие устарело (правка в книгах, событие
 * эфира). Ответ загрузки в полёте после сброса игнорируется. Сам хук за
 * эфиром не следит (useLiveEvents — чужой дом): потребитель вешает этот
 * сброс на события сам; следующий ensurePeriodCoverage загрузит заново.
 */
export function invalidatePeriodCoverage(): void {
  loadGeneration += 1;
  if (startTimer !== null) { clearTimeout(startTimer); startTimer = null; }
  lastAttemptAt = 0;
  setState({ status: 'idle', index: EMPTY_COVERAGE });
}

/** Сброс модульного состояния — только для тестов. */
export function resetPeriodCoverage(): void {
  invalidatePeriodCoverage();
}

/** Снимок состояния без подписки — для кода вне React (и стражей). */
export function getPeriodCoverageState(): PeriodCoverageState {
  return state;
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
