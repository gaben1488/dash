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
 *
 * СВЕЖЕСТЬ ИСТОЧНИКА (дефект Д17, «снимок недели фальсифицируется молча»).
 * Канонический периметр строк снимка — кэш собственных книг ГРБС
 * (cachedDeptSheetData в snapshot.ts). Сам снимок его НЕ перечитывает: кэш
 * наполняют только стартовый preload (app.ts) и POST /api/refresh
 * (routes/dashboard.ts). На сервере, поднятом три недели назад и никем не
 * обновлённом, четверговый cron архивировал строки трёхнедельной давности —
 * и подписывал их сегодняшней датой среза. Снимок недели — единственный
 * источник исторической правды, и молчаливая подмена в нём страшнее пропуска.
 * Поэтому тик сначала измеряет, когда книги читались на самом деле
 * (getDeptLoadMeta), и:
 *   • источник свеж — снимает как раньше;
 *   • источник устарел, но день не кончился — откладывает и говорит об этом
 *     в лог: обновление данных ещё успеет прийти, повтор через час;
 *   • источник устарел, а четверг заканчивается — снимает (неделю терять
 *     нельзя), но с честным признаком «taken-stale» и предупреждением, в
 *     котором названо, на сколько отстают книги.
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

/**
 * Порог свежести книг: чтение старше суток описывает уже другой день, а срез
 * недели обязан отвечать за свою дату. Порог заведомо мягкий — кэш книг
 * обновляется стартом сервера и ручным refresh, поэтому реальные значения
 * либо часы (кто-то работал с дашбордом), либо недели (сервер живёт сам).
 */
const SOURCE_STALE_HOURS = 24;

/**
 * Час продуктового четверга, после которого устаревший источник перестаёт быть
 * поводом ждать: до вечера обновление ещё может прийти, после — неделя дороже
 * свежести, и снимок снимается с пометкой. Раньше 18:00 отказ обратим — тик
 * повторяется каждый час, день всё ещё не в snapshotDays.
 */
const STALE_DEADLINE_HOUR = 18;

// Календарь продукта живёт в product-calendar.ts — общий дом конверсии с
// retention снимков и роутом отчёта; отсюда она только реэкспортируется.
export { productCalendarDay };

/**
 * Час суток в календаре продукта (0–23). Нужен только решению «ждать ли ещё
 * обновления источника», поэтому живёт здесь, а не в общем календаре: день
 * недели — канон продукта, час — частность этого планировщика.
 */
export function productCalendarHour(now: Date, utcOffsetHours: number): number {
  const shiftedHours = (now.getTime() + utcOffsetHours * MS_PER_HOUR) / MS_PER_HOUR;
  return ((Math.floor(shiftedHours) % 24) + 24) % 24;
}

/** Запись о чтении книги ГРБС — структурный слепок getDeptLoadMeta (snapshot.ts). */
export interface DeptReadMeta {
  loadedAt: string;
  rowCount: number;
  sheetName: string;
  error?: string;
}

/** Свежесть источника: свеж, устарел или неизвестна (книги не читались ни разу). */
export type SourceFreshnessStatus = 'fresh' | 'stale' | 'unknown';

export interface SourceFreshness {
  status: SourceFreshnessStatus;
  /** Момент чтения САМОЙ отставшей успешно прочитанной книги (ISO) или null. */
  readAt: string | null;
  /**
   * Расхождение этого чтения с моментом снимка, в часах. null, а не ноль,
   * когда успешных чтений нет: пустое множество не даёт возраста (правило
   * чисел — нулевой знаменатель отдаёт null).
   */
  ageHours: number | null;
  /** Книги без свежих строк: ошибка загрузки в последнем цикле. */
  failedDepts: string[];
  /** Сколько книг прочитано успешно. */
  readDepts: number;
}

/**
 * Свежесть источника считается по САМОЙ отставшей книге, а не по последней:
 * снимок настолько свеж, насколько свежа его худшая часть. Книга с ошибкой
 * загрузки — тоже несвежесть: её строки в кэше либо отсутствуют, либо остались
 * от прошлого цикла, и снимок про этот ГРБС говорит неправду.
 *
 * Чистая функция — вся операционная обвязка остаётся в tickWeeklySnapshot.
 */
export function assessSourceFreshness(
  now: Date,
  meta: Record<string, DeptReadMeta>,
): SourceFreshness {
  const failedDepts: string[] = [];
  let oldestMs: number | null = null;
  let readDepts = 0;

  for (const [dept, entry] of Object.entries(meta ?? {})) {
    const ms = Date.parse(entry?.loadedAt ?? '');
    // Запись с ошибкой или с нечитаемой отметкой времени успешным чтением не
    // считается: иначе неудача маскировалась бы под свежесть.
    if (entry?.error || !Number.isFinite(ms)) {
      failedDepts.push(dept);
      continue;
    }
    readDepts += 1;
    if (oldestMs === null || ms < oldestMs) oldestMs = ms;
  }

  if (oldestMs === null) {
    return { status: 'unknown', readAt: null, ageHours: null, failedDepts, readDepts };
  }

  const ageHours = (now.getTime() - oldestMs) / MS_PER_HOUR;
  const stale = ageHours > SOURCE_STALE_HOURS || failedDepts.length > 0;
  return {
    status: stale ? 'stale' : 'fresh',
    readAt: new Date(oldestMs).toISOString(),
    ageHours,
    failedDepts,
    readDepts,
  };
}

/** Часы с одним знаком после запятой — по-русски, с запятой. */
function formatHours(hours: number): string {
  return hours.toFixed(1).replace('.', ',');
}

/**
 * Свежесть словами и числами — одна строка для лога. Числа названы явно
 * (сколько книг, когда читались, насколько отстают), чтобы дежурному не
 * приходилось лезть в базу за смыслом предупреждения.
 */
export function describeSourceFreshness(freshness: SourceFreshness): string {
  const failed = freshness.failedDepts.length > 0
    ? ` Без свежих строк: ${freshness.failedDepts.join(', ')}.`
    : '';

  if (freshness.status === 'unknown') {
    return 'книги ГРБС не читались ни разу за жизнь процесса — свежесть источника неизвестна.' + failed;
  }

  const age = freshness.ageHours === null ? '?' : formatHours(freshness.ageHours);
  const head =
    `самая отставшая из ${freshness.readDepts} прочитанных книг ГРБС снята ${age} ч назад ` +
    `(${freshness.readAt}), порог свежести — ${SOURCE_STALE_HOURS} ч.`;
  return head + failed;
}

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

/**
 * Итог тика. `taken-stale` и `deferred` появились с Д17: снимок, снятый по
 * устаревшему источнику, — не то же самое, что снимок недели, и звать их одним
 * словом значило бы повторить ту же молчаливую подмену на уровне контракта.
 */
export type TickOutcome = 'taken' | 'taken-stale' | 'deferred' | 'skipped' | 'failed';

/** Зависимости тика — инжектируются, чтобы тик тестировался без часов, БД и Google. */
export interface WeeklySnapshotDeps {
  now: () => Date;
  utcOffsetHours: number;
  listSnapshotDays: (nowDay: number) => number[] | Promise<number[]>;
  /** Существующий путь снятия снимка; от результата нужен только id (демо-детектор). */
  refresh: () => Promise<{ id: string }>;
  /** Мета чтения книг ГРБС — источник признака свежести (snapshot.getDeptLoadMeta). */
  sourceMeta: () => Record<string, DeptReadMeta> | Promise<Record<string, DeptReadMeta>>;
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
    // Часы снимаются ОДИН раз: день, час и возраст источника обязаны описывать
    // один момент. Три вызова now() на границе суток дали бы тик, у которого
    // день ещё четверг, а час — уже пятничный.
    const now = deps.now();
    const nowDay = productCalendarDay(now, deps.utcOffsetHours);
    if (!shouldTakeWeeklySnapshot(nowDay, await deps.listSnapshotDays(nowDay))) {
      return 'skipped';
    }

    // Свежесть меряется ДО снятия. Замер после вернул бы более выгодную
    // картину: конкурентный /api/refresh, пришедший в момент пайплайна, уже
    // обновил бы мету, а строки в снимок попали бы прежние — ровно та
    // подмена, которую этот гейт закрывает.
    const freshness = assessSourceFreshness(now, await deps.sourceMeta());
    const dayLabel = `день ${nowDay}, ${isoOfDayNumber(nowDay)}`;

    if (freshness.status !== 'fresh') {
      const hour = productCalendarHour(now, deps.utcOffsetHours);
      if (hour < STALE_DEADLINE_HOUR) {
        deps.log.warn(
          `Еженедельный снимок четверга (${dayLabel}) отложен: ${describeSourceFreshness(freshness)} ` +
          `Обновление источника (POST /api/refresh) до ${STALE_DEADLINE_HOUR}:00 ещё спасёт срез; ` +
          'повтор следующим тиком.',
        );
        return 'deferred';
      }
    }

    const snapshot = await deps.refresh();
    if (snapshot.id.startsWith('demo-')) {
      // Google недоступен: createSnapshot упал в демо-фолбэк, который в БД не
      // сохраняется — честно признаём, что снимок не снят, и ждём повтора.
      deps.log.warn(
        `Еженедельный снимок четверга (${dayLabel}) не снят: ` +
        'источник недоступен, сработал демо-фолбэк. Повтор следующим тиком.',
      );
      return 'failed';
    }

    if (freshness.status !== 'fresh') {
      // Вечер четверга: ждать больше нечего, а неделя без снимка — дыра в
      // единственной исторической правде. Снимаем, но признак несём наружу
      // и в лог: числа этой недели нельзя читать как состояние книг на дату.
      deps.log.warn(
        `Еженедельный снимок четверга (${dayLabel}) снят ПО УСТАРЕВШЕМУ ИСТОЧНИКУ: ${snapshot.id}. ` +
        `${describeSourceFreshness(freshness)} ` +
        'Неделя сохранена, чтобы не потерять срез, но состоянием книг на эту дату он не является.',
      );
      return 'taken-stale';
    }

    deps.log.info(
      `Еженедельный снимок четверга снят (${dayLabel}): ${snapshot.id}. ` +
      `Источник свеж: ${describeSourceFreshness(freshness)}`,
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
    sourceMeta: async () => (await import('./snapshot.js')).getDeptLoadMeta(),
    log,
  };
  void tickWeeklySnapshot(deps);
  const timer = setInterval(() => {
    void tickWeeklySnapshot(deps);
  }, TICK_INTERVAL_MS);
  timer.unref();
  return () => clearInterval(timer);
}
