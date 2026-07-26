/**
 * Четверг-cron: еженедельный снимок снимается сам, идемпотентно.
 *
 * Зачем: отчёт прошлых недель строится из снимка той недели (одна ось недели,
 * дизайн-док 2026-07-23 §4 R2; роут routes/report.ts). Снимки сохраняются при
 * каждом force-refresh (createSnapshot → saveSnapshot), но полагаться на то,
 * что в четверг кто-то откроет дашборд, нельзя — этот планировщик гарантирует
 * хотя бы один снимок каждый четверг.
 *
 * Минимализм сознательный: setInterval раз в час + unref, никаких cron-библиотек.
 * Снятие снимка — существующий путь getSnapshot(true) (полный пайплайн +
 * saveSnapshot), собственного чтения источников здесь нет.
 *
 * Календарь: срез — ЧЕТВЕРГ (день 0 эпохи 1970-01-01 — четверг, поэтому
 * «четверг» = номер суток % 7 === 0; арифметика недель — @aemr/shared/
 * parse-sheet-date). Прод-сервер живёт в UTC, пользователь — на Камчатке
 * (UTC+12, DST нет): «четверг Камчатки» на UTC-сервере начинается в среду
 * 12:00 UTC, поэтому день считается не по календарю машины, а по фиксированному
 * смещению config.weeklySnapshot.utcOffsetHours.
 */
// snapshot.js импортируется ЛЕНИВО (внутри функций): статический импорт тянул
// в этот модуль весь тяжёлый граф (googleapis, drizzle, @aemr/core) — тесты
// чистых функций платили за него ~25 с на холодном кэше.
import { isoOfDayNumber } from '@aemr/shared';
import { productCalendarDay } from './product-calendar.js';
import { config } from '../config.js';

const MS_PER_HOUR = 3_600_000;

/** Тик раз в час: сутки не проскочить, а холостой тик дешёв (один SELECT метаданных). */
const TICK_INTERVAL_MS = MS_PER_HOUR;

/** Горизонт дедупликации — ~10 недель: старше в решении «снимать ли сегодня» не участвует. */
const DEDUP_WINDOW_DAYS = 70;

/**
 * Сколько последних строк истории читаем (метаданные, без data-JSON). Для
 * решения важен только сегодняшний день, а свежие строки идут первыми —
 * лимита с запасом достаточно даже при частых сохранениях в день среза.
 */
const HISTORY_SCAN_LIMIT = 500;

// Календарь продукта живёт в product-calendar.ts — общий дом конверсии с
// retention снимков и роутом отчёта; отсюда она только реэкспортируется.
export { productCalendarDay };

/**
 * Решение «снимать ли еженедельный снимок»: сегодня четверг по календарю
 * продукта (номер суток % 7 === 0 — день 0 эпохи четверг) И снимка с этим
 * номером суток ещё нет. Чистая функция — вся операционная обвязка (часы,
 * БД, пайплайн) остаётся в tickWeeklySnapshot.
 */
export function shouldTakeWeeklySnapshot(nowDay: number, snapshotDays: readonly number[]): boolean {
  return nowDay % 7 === 0 && !snapshotDays.includes(nowDay);
}

/**
 * Дни существующих снимков за последние ~10 недель — из метаданных истории
 * (getSnapshotHistory, data-JSON не разбирается). createdAt хранится UTC-строкой
 * toISOString, поэтому день снимка считается тем же productCalendarDay: снимок,
 * снятый в четверг 04:00 Камчатки (= среда 16:00 UTC), дедупится с четвергом.
 */
export async function collectSnapshotDays(nowDay: number, utcOffsetHours: number): Promise<number[]> {
  const { getSnapshotHistory } = await import('./snapshot.js');
  const days = new Set<number>();
  for (const row of getSnapshotHistory(HISTORY_SCAN_LIMIT)) {
    const ms = Date.parse(row.createdAt);
    if (Number.isNaN(ms)) continue;
    const day = productCalendarDay(new Date(ms), utcOffsetHours);
    if (day >= nowDay - DEDUP_WINDOW_DAYS) days.add(day);
  }
  return [...days];
}

export type TickOutcome = 'taken' | 'skipped' | 'failed';

/** Зависимости тика — инжектируются, чтобы тик тестировался без часов, БД и Google. */
export interface WeeklySnapshotDeps {
  now: () => Date;
  utcOffsetHours: number;
  listSnapshotDays: (nowDay: number) => number[] | Promise<number[]>;
  /** Существующий путь снятия снимка; от результата нужен только id (демо-детектор). */
  refresh: () => Promise<{ id: string }>;
  log: {
    info(msg: string): void;
    warn(msg: string): void;
    error(obj: unknown, msg?: string): void;
  };
}

/**
 * Один тик планировщика. Никогда не бросает: ошибка тика — лог и «failed»,
 * процесс сервера жив, следующий тик через час попробует снова (день всё ещё
 * не в snapshotDays — идемпотентность сама даёт повтор).
 */
export async function tickWeeklySnapshot(deps: WeeklySnapshotDeps): Promise<TickOutcome> {
  try {
    const nowDay = productCalendarDay(deps.now(), deps.utcOffsetHours);
    if (!shouldTakeWeeklySnapshot(nowDay, await deps.listSnapshotDays(nowDay))) {
      return 'skipped';
    }
    const snapshot = await deps.refresh();
    if (snapshot.id.startsWith('demo-')) {
      // Google недоступен: createSnapshot упал в демо-фолбэк, который в БД не
      // сохраняется — честно признаём, что снимок не снят, и ждём повтора.
      deps.log.warn(
        `Еженедельный снимок четверга (день ${nowDay}, ${isoOfDayNumber(nowDay)}) не снят: ` +
        'источник недоступен, сработал демо-фолбэк. Повтор следующим тиком.',
      );
      return 'failed';
    }
    deps.log.info(
      `Еженедельный снимок четверга снят (день ${nowDay}, ${isoOfDayNumber(nowDay)}): ${snapshot.id}.`,
    );
    return 'taken';
  } catch (err) {
    deps.log.error({ err }, 'Тик еженедельного снимка упал — повтор следующим тиком.');
    return 'failed';
  }
}

/**
 * Запуск планировщика (app.ts, за флагом config.weeklySnapshot.enabled —
 * в NODE_ENV=test выключен). Первый тик — сразу: рестарт сервера в четверг
 * не ждёт до часа, а конкурентный стартовый preload не страшен — getSnapshot
 * дедупит параллельные force-refresh через in-flight memo. Возвращает stop
 * для onClose-хука; unref не даёт таймеру держать процесс при завершении.
 */
export function startWeeklySnapshotCron(log: WeeklySnapshotDeps['log']): () => void {
  const deps: WeeklySnapshotDeps = {
    now: () => new Date(),
    utcOffsetHours: config.weeklySnapshot.utcOffsetHours,
    listSnapshotDays: (nowDay) => collectSnapshotDays(nowDay, config.weeklySnapshot.utcOffsetHours),
    refresh: async () => (await import('./snapshot.js')).getSnapshot(true),
    log,
  };
  void tickWeeklySnapshot(deps);
  const timer = setInterval(() => {
    void tickWeeklySnapshot(deps);
  }, TICK_INTERVAL_MS);
  timer.unref();
  return () => clearInterval(timer);
}
