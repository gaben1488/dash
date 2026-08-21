/**
 * useSeamlessRefresh — числа на экране обновляются сами, не сбивая работу.
 *
 * ЧТО БЫЛО. Сервер узнавал о правке в книге по уведомлению Drive и перечитывал
 * источники, а на экране это выглядело так: внизу всплывала полоса «данные
 * изменились», и пока читатель её не нажмёт, числа оставались вчерашними.
 * Нажатие звало `quickRefresh`, а тот поднимал общий признак загрузки — экран
 * уходил в заглушки, раскрытые карточки схлопывались, прокрутка прыгала
 * наверх. Обновление стоило человеку места, на котором он стоял.
 *
 * ЧТО СТАЛО. Пришло событие — данные подтягиваются САМИ, тихо: запрос идёт без
 * признака загрузки, а ответ подменяет только снимок. Ни один компонент не
 * размонтируется, поэтому целы и прокрутка, и раскрытые карточки, и выбранные
 * фильтры (фильтры вообще живут отдельно от данных и запросом не трогаются).
 * Изменившиеся строки продолжают подсвечиваться механизмом эфира (FLASH_MS).
 *
 * КОГДА ТИХО ПОДМЕНЯТЬ НЕЛЬЗЯ. Подменить числа под рукой у человека — это
 * сломать то, что он делает. Поэтому подмена откладывается, если:
 *   • курсор стоит в поле ввода (правят ячейку, набирают поиск);
 *   • выделен текст (диктуют сумму по телефону, копируют);
 *   • открыт диалог (aria-modal) — там своя работа;
 *   • вкладка скрыта — обновлять невидимое незачем, дождёмся возвращения.
 * В этом случае продукт не дёргает экран, а ПРЕДУПРЕЖДАЕТ: полоса оповещения
 * остаётся и говорит, что новые числа готовы и ждут. Как только помеха
 * исчезла, подмена происходит сама.
 *
 * ЧЕГО ЭТОТ ХУК НЕ ДЕЛАЕТ. Он не перезагружает страницу, не трогает признак
 * загрузки и не спорит с обычными путями (`fetchDashboard`, `refresh`): пока
 * идёт их запрос, тихое обновление молчит, а свой устаревший ответ выбрасывает.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { DashboardData } from '@aemr/shared';
import { api } from '../api';
import { useStore, type YearFilter } from '../store';
import { setOfficialProvenance } from '../lib/provenance-registry';
import { acknowledgeLiveEvents, getLiveState, useLiveEvents } from './useLiveEvents';

/** Почему тихая подмена сейчас невозможна. `null` — можно. */
export type SwapBlocker = 'ввод' | 'выделение' | 'диалог' | 'вкладка-скрыта' | 'идёт-загрузка';

/** Человеческое объяснение помехи — для полосы оповещения. */
export const BLOCKER_WORDS: Record<SwapBlocker, string> = {
  'ввод': 'вы сейчас что-то вводите',
  'выделение': 'на экране выделен текст',
  'диалог': 'открыто окно',
  'вкладка-скрыта': 'вкладка не на виду',
  'идёт-загрузка': 'уже идёт обновление',
};

/** Правится ли что-то прямо сейчас: поле ввода в фокусе. */
function isEditing(doc: Document): boolean {
  const active = doc.activeElement as HTMLElement | null;
  if (!active) return false;
  const tag = active.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  return active.isContentEditable === true;
}

/** Выделен ли текст. Схлопнутое выделение (просто курсор) не в счёт. */
function hasSelection(win: Window): boolean {
  const selection = win.getSelection?.();
  if (!selection || selection.isCollapsed) return false;
  return selection.toString().trim().length > 0;
}

/**
 * Можно ли сейчас подменить числа. Возвращает помеху, а не «да/нет»: полоса
 * оповещения обязана назвать причину, иначе человек видит «не обновилось» без
 * объяснения и решает, что продукт сломался.
 */
export function swapBlocker(
  doc: Document = document,
  win: Window = window,
  loading = false,
): SwapBlocker | null {
  if (loading) return 'идёт-загрузка';
  if (doc.visibilityState === 'hidden') return 'вкладка-скрыта';
  if (isEditing(doc)) return 'ввод';
  if (doc.querySelector('[aria-modal="true"], dialog[open]')) return 'диалог';
  if (hasSelection(win)) return 'выделение';
  return null;
}

/** Демо-данные сервера — тот же признак, что и в основном пути загрузки. */
function isDemoData(data: DashboardData): boolean {
  const id = (data as unknown as { snapshot?: { id?: unknown } }).snapshot?.id;
  return typeof id === 'string' && id.startsWith('demo-');
}

/**
 * Подменить снимок в хранилище, НЕ трогая признак загрузки и всё остальное.
 *
 * Возвращает `false`, если ответ устарел: пока он ехал, человек сменил год или
 * начался обычный запрос. Устаревший ответ не имеет права затирать свежие
 * числа — это то же правило, по которому живёт `fetchDashboard`.
 */
export function applySnapshotSilently(data: DashboardData, expectedYear: YearFilter): boolean {
  const state = useStore.getState();
  if (state.loading) return false;
  if (state.year !== expectedYear) return false;

  const snapshot = (data as unknown as {
    snapshot?: { officialMetrics?: unknown; spreadsheetId?: string };
  }).snapshot;
  setOfficialProvenance(
    snapshot?.officialMetrics as never,
    snapshot?.spreadsheetId,
  );
  useStore.setState({
    dashboardData: data,
    dataYear: data.year ?? new Date().getFullYear(),
    lastRefreshed: data.lastRefreshed,
    isDemo: isDemoData(data),
    // Признак загрузки НЕ трогается — ради этого всё и затевалось: страницы
    // рисуют заглушки именно по нему, а заглушка уносит и прокрутку, и
    // раскрытые карточки.
  });
  return true;
}

/** Сколько ждём после события, прежде чем идти за числами. */
export const SETTLE_MS = 700;

export interface SeamlessRefreshState {
  /** Идёт ли тихое обновление прямо сейчас (для скромного значка, не заглушки). */
  updating: boolean;
  /** Помеха, из-за которой новые числа ждут; `null` — ничего не ждёт. */
  waitingBecause: SwapBlocker | null;
  /** Не удалось обновить: на экране прежние числа, и об этом надо сказать. */
  failed: boolean;
  /** Применить немедленно — по нажатию человека, поверх любой помехи. */
  applyNow: () => void;
}

/** Есть ли в эфире неотработанные новости. */
function hasPendingNews(): boolean {
  const s = getLiveState();
  return s.books.length > 0 || s.newIssues > 0 || s.snapshotRebuilt;
}

/**
 * Тихое обновление данных по живым событиям.
 *
 * `enabled: false` выключает хук целиком (тесты, экраны без эфира).
 */
export function useSeamlessRefresh(enabled = true): SeamlessRefreshState {
  const live = useLiveEvents(enabled);
  const [updating, setUpdating] = useState(false);
  const [waitingBecause, setWaitingBecause] = useState<SwapBlocker | null>(null);
  const [failed, setFailed] = useState(false);
  /** Номер последнего тихого запроса — устаревший ответ выбрасывается. */
  const seq = useRef(0);
  const inFlight = useRef(false);

  const pull = useCallback(async (force: boolean) => {
    if (inFlight.current) return;
    const loading = useStore.getState().loading;
    // Даже по нажатию человека нельзя лезть поверх идущей загрузки: два ответа
    // на одни и те же данные — это гонка, а не забота.
    if (loading) {
      setWaitingBecause('идёт-загрузка');
      return;
    }
    if (!force) {
      const blocker = swapBlocker(document, window, false);
      if (blocker) {
        setWaitingBecause(blocker);
        return;
      }
    }

    const mine = ++seq.current;
    inFlight.current = true;
    setUpdating(true);
    const year = useStore.getState().year;
    try {
      // `refresh: false` — сервер уже перечитал источники по уведомлению; звать
      // его перечитывать ещё раз значит платить за ту же правку дважды.
      const data = await api.getDashboard(false, year);
      if (mine !== seq.current) return;
      if (applySnapshotSilently(data, year)) {
        acknowledgeLiveEvents();
        setWaitingBecause(null);
        setFailed(false);
      }
    } catch {
      // Числа на экране остаются прежними — это честнее пустого экрана.
      // Полоса оповещения не гаснет: человек должен знать, что новые данные
      // есть, а показать их не вышло.
      if (mine === seq.current) setFailed(true);
    } finally {
      if (mine === seq.current) {
        inFlight.current = false;
        setUpdating(false);
      }
    }
  }, []);

  // Событие пришло — ждём, пока серия правок уляжется, и идём за числами.
  useEffect(() => {
    if (!enabled || !live.hasNews) return;
    const timer = setTimeout(() => void pull(false), SETTLE_MS);
    return () => clearTimeout(timer);
  }, [enabled, live.hasNews, live.lastEventAt, pull]);

  // Помеха исчезла — новые числа встают на место сами, без нажатия.
  useEffect(() => {
    if (!enabled || waitingBecause === null) return;
    const retry = (): void => {
      if (!hasPendingNews()) {
        setWaitingBecause(null);
        return;
      }
      if (swapBlocker(document, window, useStore.getState().loading) === null) void pull(false);
    };
    document.addEventListener('visibilitychange', retry);
    document.addEventListener('focusout', retry);
    document.addEventListener('selectionchange', retry);
    // Страховка на случай, когда помеха ушла без единого события (окно закрылось
    // перерисовкой, загрузка кончилась): раз в пару секунд смотрим сами.
    const timer = setInterval(retry, 2_000);
    return () => {
      document.removeEventListener('visibilitychange', retry);
      document.removeEventListener('focusout', retry);
      document.removeEventListener('selectionchange', retry);
      clearInterval(timer);
    };
  }, [enabled, waitingBecause, pull]);

  const applyNow = useCallback(() => void pull(true), [pull]);

  return { updating, waitingBecause, failed, applyNow };
}
