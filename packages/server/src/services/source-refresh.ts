/**
 * source-refresh.ts — ОДИН цикл чтения всех источников.
 *
 * Зачем отдельный модуль: раньше книги ГРБС читались только при старте и по
 * ручному обновлению, а официальные ячейки — при каждой пересборке снимка.
 * Стороны сверки оказывались из разных моментов времени, и продукт показывал
 * расхождения там, где данные согласованы (14.08.2026: УКСиМП −181,9 и УО
 * −313,6 — обе стороны были правы). Канон п.66: обе стороны читаются одним
 * циклом, а сервер обновляет источники сам.
 */

import { config, DEPARTMENT_SPREADSHEETS } from '../config.js';
import { fetchDepartmentSpreadsheets, getSheetData } from './google-sheets.js';
import {
  setDeptSheetCache,
  setDeptLoadMeta,
  setSvodGridCache,
  setSvodLoadFailure,
  invalidateCache,
  getDeptSheetCache,
} from './snapshot.js';
import { SVOD_SHEET_NAME } from '@aemr/shared';
import { publishLiveEvent, type RefreshOrigin } from './event-bus.js';
import { diffBook, isSilent } from './live-diff.js';
import { classifySourceFailure } from './source-failure.js';
import { logSnapshotChange } from './source-log.js';

export interface SourceRefreshResult {
  loaded: string[];
  failed: string[];
  svodOk: boolean;
  at: string;
}

/** Идёт ли перечитка прямо сейчас — параллельные вызовы ждут общий промис. */
let inFlight: Promise<SourceRefreshResult> | null = null;

/**
 * Объявить в прямом эфире, что изменилось в книгах за этот цикл.
 *
 * Молчание — законный итог: книги перечитаны, всё совпало — событий нет.
 * Раньше эфир не отличался от тишины вовсе (числа менялись только после того,
 * как читатель сам обновит страницу), и это ровно то, что здесь чинится.
 */
function publishBookChanges(
  before: Record<string, { values: unknown[][] }>,
  after: Record<string, { values: unknown[][] }>,
  origin: RefreshOrigin,
): void {
  for (const [book, reading] of Object.entries(after)) {
    const diff = diffBook(book, before[book], reading);
    if (isSilent(diff)) continue;
    publishLiveEvent({
      kind: 'book-updated',
      book,
      changedRows: diff.changedRows,
      addedRows: diff.addedRows,
      removedRows: diff.removedRows,
      rowsTotal: diff.rowsTotal,
      origin,
    });
    for (const row of diff.rows) publishLiveEvent(row);
  }
}

/**
 * Прочитать книги ГРБС и лист СВОД одним циклом и обновить кэши.
 * Ошибка отдельной книги не валит цикл: упавшая книга УДАЛЯЕТСЯ из кэша, а не
 * остаётся под видом свежих данных.
 */
export function refreshAllSources(log?: {
  info: (msg: string) => void;
  warn: (msg: string) => void;
}, origin: RefreshOrigin = 'cycle'): Promise<SourceRefreshResult> {
  if (inFlight) return inFlight;

  inFlight = (async () => {
    // Прежнее чтение книг — материал для ответа «что именно поменялось»
    // (шина живых событий). Ссылка снимается ДО записи нового кэша: запись
    // подставляет новый объект, прежний остаётся целым.
    const before = getDeptSheetCache();

    // Книги управлений и лист СВОД читаются ОДНОВРЕМЕННО, а не одно за другим.
    // Дело не только в скорости цикла (лист СВОД перестал ждать окончания
    // восьми книг): читать их подряд значит разносить стороны сверки во
    // времени ровно на длительность чтения книг, а канон п.66 требует
    // обратного — обе стороны из одного момента. Отказ одной стороны не должен
    // уносить другую, поэтому лист СВОД ловит свой отказ внутри себя.
    const startedAt = Date.now();
    const [{ data, errors }, svodOk] = await Promise.all([
      fetchDepartmentSpreadsheets(DEPARTMENT_SPREADSHEETS),
      getSheetData(SVOD_SHEET_NAME)
        .then((values) => {
          setSvodGridCache(values);
          return true;
        })
        .catch((err: unknown) => {
          const reason = classifySourceFailure((err as Error)?.message ?? String(err));
          // След отказа переживает цикл: без него маршрут здоровья не отличал
          // «читали и не смогли» от «ещё не читали».
          setSvodLoadFailure(reason);
          log?.warn(`Лист СВОД не прочитан в этом цикле: ${reason}`);
          return false;
        }),
    ]);
    setDeptSheetCache(data, Object.keys(errors));
    publishBookChanges(before, data, origin);

    const at = new Date().toISOString();
    const loadMeta: Record<string, { loadedAt: string; rowCount: number; sheetName: string; error?: string }> = {};
    for (const [name, result] of Object.entries(data)) {
      loadMeta[name] = { loadedAt: at, rowCount: result.values.length, sheetName: result.sheetName };
    }
    for (const [name, errMsg] of Object.entries(errors)) {
      loadMeta[name] = { loadedAt: at, rowCount: 0, sheetName: name, error: errMsg };
    }
    setDeptLoadMeta(loadMeta);

    // Итог цикла в журнал сервера — с числами, а не «источники обновлены».
    // Вопрос «почему в отчёте столько закупок» решается сложением строк по
    // книгам, а вопрос «почему меньше, чем вчера» — списком не ответивших.
    const rowsTotal = Object.values(data).reduce((sum, r) => sum + r.values.length, 0);
    logSnapshotChange(
      `Цикл чтения источников за ${Date.now() - startedAt} мс: книг прочитано ${Object.keys(data).length}`
      + ` (строк ${rowsTotal})`
      + (Object.keys(errors).length > 0 ? `, не прочитано: ${Object.keys(errors).join(', ')}` : '')
      + (svodOk ? ', лист СВОД прочитан' : ', лист СВОД не прочитан'),
      {
        ms: Date.now() - startedAt,
        books: Object.keys(data).length,
        rows: rowsTotal,
        failed: Object.keys(errors).length,
        svodOk,
        origin,
      },
    );

    // П.98б («внесла данные, из красного не ушло»): свежие книги обязаны сразу
    // попасть в снимок — без сброса кэш снимка (TTL 300 с) держал старые
    // замечания до 5 минут после вебхука. Пересборка дедуплицирована
    // inFlightLoads, шторма пересчётов сброс не создаёт.
    invalidateCache();

    return { loaded: Object.keys(data), failed: Object.keys(errors), svodOk, at };
  })().finally(() => {
    inFlight = null;
  });

  return inFlight;
}

/**
 * Рабочее окно опроса — решение владельца 14.08 (канон п.87/20): книги правят
 * в рабочее время, ночью и в выходные опрос жжёт квоту впустую. Окно задано
 * по Камчатке (продуктовый пояс, config.weeklySnapshot.utcOffsetHours);
 * вебхук-каналы работают всегда — они бесплатны и точны.
 */
const WORK_START_MIN = 8 * 60 + 45;
const WORK_END_MIN = 18 * 60 + 20;

export function isWithinWorkHours(now: Date, utcOffsetHours: number): boolean {
  const localMin = (now.getUTCHours() * 60 + now.getUTCMinutes() + utcOffsetHours * 60 + 24 * 60) % (24 * 60);
  return localMin >= WORK_START_MIN && localMin <= WORK_END_MIN;
}

let timer: ReturnType<typeof setInterval> | null = null;

/**
 * Запустить самообновление источников. Период — `cache.autoRefreshMinutes`
 * (0 выключает). Тик не наслаивается сам на себя: пока идёт предыдущая
 * перечитка, следующая ждёт её промис.
 */
export function startSourceAutoRefresh(log: {
  info: (msg: string) => void;
  warn: (msg: string) => void;
}): void {
  const minutes = config.cache.autoRefreshMinutes;
  if (minutes <= 0 || timer) return;

  timer = setInterval(() => {
    if (!isWithinWorkHours(new Date(), config.weeklySnapshot.utcOffsetHours)) return;
    void refreshAllSources(log)
      .then((r) => {
        log.info(
          `Источники обновлены: книг ${r.loaded.length}` +
          `${r.failed.length > 0 ? `, не прочитано: ${r.failed.join(', ')}` : ''}` +
          `${r.svodOk ? '' : ', лист СВОД недоступен'}`,
        );
      })
      .catch((err: unknown) => {
        log.warn(`Автообновление источников не удалось: ${(err as Error).message}`);
      });
  }, minutes * 60_000);

  // Таймер не держит процесс: сервер должен уметь завершаться штатно.
  timer.unref?.();
  log.info(`Автообновление источников включено: каждые ${minutes} мин`);
}

export function stopSourceAutoRefresh(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
