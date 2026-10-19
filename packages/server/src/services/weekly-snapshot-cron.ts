/**
 * Недельный контроль: четверг после 18:00 в календаре продукта.
 * Таймер выровнен по часам; утренний снимок не заменяет вечерний контроль.
 * Перед сохранением принудительно читаются книги, формулы, СВОД и мониторинг.
 * Неполное чтение или устаревший кэш блокируют контроль, повтор — следующим
 * тиком четверга. Фактическое время чтения сохраняется: поздний запуск не
 * восстанавливает состояние Google на 18:00 и не должен датироваться задним числом.
 */
// snapshot.js импортируется ЛЕНИВО (внутри функций): статический импорт тянул
// в этот модуль весь тяжёлый граф (googleapis, drizzle, @aemr/core) — тесты
// чистых функций платили за него ~25 с на холодном кэше.
import { isoOfDayNumber, DAYS_PER_WEEK, weeklyCutoffMs } from '@aemr/shared';
import { productCalendarDay } from './product-calendar.js';
import { config, DEPARTMENT_SPREADSHEETS } from '../config.js';

const MS_PER_HOUR = 3_600_000;

/** Тик раз в час: сутки не проскочить, а холостой тик дешёв (один SELECT метаданных). */
const TICK_INTERVAL_MS = MS_PER_HOUR;

/** Горизонт дедупликации — ~10 недель: старше в решении «снимать ли сегодня» не участвует. */
const DEDUP_WINDOW_DAYS = 70;

/**
 * Порог свежести книг: чтение старше суток описывает уже другой день, а срез
 * недели обязан отвечать за свою дату. Порог заведомо мягкий — кэш книг
 * обновляется стартом сервера и ручным refresh, поэтому реальные значения
 * либо часы (кто-то работал с дашбордом), либо недели (сервер живёт сам).
 */
const SOURCE_STALE_HOURS = 24;

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
 * toISOString. Контроль учитывается только после вечерней границы этого дня.
 */
export async function collectSnapshotDays(nowDay: number, utcOffsetHours: number): Promise<number[]> {
  const { iterateWeeklySnapshotHistory } = await import('./snapshot.js');
  const { verifiedBaselineRows } = await import('./weekly-control-validation.js');
  const days = new Set<number>();
  for (const row of iterateWeeklySnapshotHistory()) {
    const ms = Date.parse(row.createdAt);
    if (!Number.isFinite(ms)) continue;
    const day = productCalendarDay(new Date(ms), utcOffsetHours);
    if (day < nowDay - DEDUP_WINDOW_DAYS) break;
    if (day > nowDay || day % DAYS_PER_WEEK !== 0 || days.has(day)
        || ms < weeklyCutoffMs(day, utcOffsetHours)) continue;
    if (verifiedBaselineRows(row).error === null) days.add(day);
  }
  return [...days];
}

/** Неполный или устаревший контроль считается неудачей, а не снятым срезом. */
export type TickOutcome = 'taken' | 'skipped' | 'failed';

/** Зависимости тика — инжектируются, чтобы тик тестировался без часов, БД и Google. */
export interface WeeklySourceRefresh {
  loaded: string[];
  failed: string[];
  svodOk: boolean;
  formulaBooks: string[];
  expectedBooks: number;
}

export interface WeeklyMonitoringCapture {
  readAt: string;
  version: number;
  sheets: Record<string, unknown[][]>;
  failed: Record<string, string>;
  expectedSheets: number;
}

export interface WeeklySnapshotDeps {
  now: () => Date;
  utcOffsetHours: number;
  listSnapshotDays: (nowDay: number) => number[] | Promise<number[]>;
  /**
   * Перед срезом принудительно перечитать все книги, СВОД и формулы.
   * Недельная история не имеет права зависеть от обычного TTL-кэша.
   */
  prepareSources: () => Promise<WeeklySourceRefresh>;
  prepareMonitoring: () => Promise<WeeklyMonitoringCapture>;
  /** Существующий путь снятия снимка; createdAt нужен против фолбэка на старую БД. */
  refresh: () => Promise<{ id: string; createdAt: string }>;
  sealContext: (snapshotId: string, monitoring: WeeklyMonitoringCapture) => Promise<boolean>;
  /** Мета чтения книг ГРБС — контроль, что принудительный цикл действительно обновил кэш. */
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
    const cutoff = weeklyCutoffMs(nowDay, deps.utcOffsetHours);
    if (nowDay % DAYS_PER_WEEK !== 0 || now.getTime() < cutoff) return 'skipped';
    if (!shouldTakeWeeklySnapshot(nowDay, await deps.listSnapshotDays(nowDay))) {
      return 'skipped';
    }

    const dayLabel = `день ${nowDay}, ${isoOfDayNumber(nowDay)}`;

    // Канонический недельный снимок сам читает источник. Никакого вечернего
    // "снимем устаревшее, чтобы не потерять неделю": неполный срез хуже честного
    // пропуска, потому что потом выглядит как историческая первичка.
    const prepared = await deps.prepareSources();
    const formulaSet = new Set(prepared.formulaBooks);
    const completeRead = prepared.expectedBooks > 0
      && prepared.loaded.length === prepared.expectedBooks
      && prepared.failed.length === 0
      && prepared.svodOk
      && prepared.loaded.every((book) => formulaSet.has(book));
    if (!completeRead) {
      deps.log.warn(
        `Еженедельный снимок четверга (${dayLabel}) не снят: принудительное чтение источников неполно. `
        + `Книг прочитано: ${prepared.loaded.length}/${prepared.expectedBooks}; не прочитано: ${prepared.failed.length}; `
        + `формулы прочитаны: ${prepared.formulaBooks.length}; СВОД: ${prepared.svodOk ? 'прочитан' : 'не прочитан'}. `
        + 'Текущие или устаревшие данные вместо недельного среза не сохранялись; повтор следующим тиком.',
      );
      return 'failed';
    }

    // Перепроверяем мету после принудительного цикла: если источник формально
    // ответил, но кэш не получил свежую отметку, snapshot не считается годным.
    const freshness = assessSourceFreshness(now, await deps.sourceMeta());
    if (freshness.status !== 'fresh' || !(Date.parse(freshness.readAt ?? '') >= cutoff)) {
      deps.log.warn(
        `Еженедельный снимок четверга (${dayLabel}) не снят: после принудительного чтения `
        + `свежесть не подтверждена — ${describeSourceFreshness(freshness)} Повтор следующим тиком.`,
      );
      return 'failed';
    }

    const monitoring = await deps.prepareMonitoring();
    if (Object.keys(monitoring.failed).length > 0
        || monitoring.expectedSheets < 1
        || Object.keys(monitoring.sheets).length !== monitoring.expectedSheets
        || !(Date.parse(monitoring.readAt) >= cutoff)) {
      deps.log.warn(
        `Еженедельный снимок четверга (${dayLabel}) не снят: реестр процедур прочитан неполно `
        + `(${Object.keys(monitoring.sheets).length}/${monitoring.expectedSheets} листов). `
        + 'Текущие данные вместо пропавших листов не подставлялись; повтор следующим тиком.',
      );
      return 'failed';
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

    const snapshotMs = Date.parse(snapshot.createdAt);
    if (!Number.isFinite(snapshotMs)
        || snapshotMs < cutoff
        || productCalendarDay(new Date(snapshotMs), deps.utcOffsetHours) !== nowDay) {
      deps.log.warn(
        `Еженедельный снимок четверга (${dayLabel}) не снят: сборка вернула не новый срез, `
        + 'а сохранённый ранее snapshot. Текущей неделей он не помечен.',
      );
      return 'failed';
    }
    if (!await deps.sealContext(snapshot.id, monitoring)) {
      deps.log.warn(
        `Еженедельный снимок четверга (${dayLabel}) не завершён: полный контекст таблиц не сохранён. `
        + 'Этот snapshot не считается недельным и будет повторён следующим тиком.',
      );
      return 'failed';
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
    prepareSources: async () => {
      const { refreshAllSources } = await import('./source-refresh.js');
      const result = await refreshAllSources(log, 'cycle', {
        fresh: true, askDrive: false, withFormulas: true,
      });
      return { ...result, expectedBooks: Object.keys(DEPARTMENT_SPREADSHEETS).length };
    },
    prepareMonitoring: async () => {
      const [{ getMonitoringBook }, { MONITORING_DATA_SHEETS }] = await Promise.all([
        import('./monitoring.js'), import('@aemr/core'),
      ]);
      const book = await getMonitoringBook(true);
      return { ...book, expectedSheets: MONITORING_DATA_SHEETS.length };
    },
    refresh: async () => (await import('./snapshot.js')).getSnapshot(true),
    sealContext: async (snapshotId, monitoring) =>
      (await import('./snapshot.js')).sealWeeklyTableContext(snapshotId, monitoring),
    sourceMeta: async () => (await import('./snapshot.js')).getDeptLoadMeta(),
    log,
  };
  void tickWeeklySnapshot(deps);
  let timer: ReturnType<typeof setTimeout>;
  const schedule = () => {
    timer = setTimeout(() => {
      schedule();
      void tickWeeklySnapshot(deps);
    }, TICK_INTERVAL_MS - Date.now() % TICK_INTERVAL_MS);
    timer.unref();
  };
  schedule();
  return () => clearTimeout(timer);
}
