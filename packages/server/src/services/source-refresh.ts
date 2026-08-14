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
import { setDeptSheetCache, setDeptLoadMeta, setSvodGridCache } from './snapshot.js';
import { SVOD_SHEET_NAME } from '@aemr/shared';

export interface SourceRefreshResult {
  loaded: string[];
  failed: string[];
  svodOk: boolean;
  at: string;
}

/** Идёт ли перечитка прямо сейчас — параллельные вызовы ждут общий промис. */
let inFlight: Promise<SourceRefreshResult> | null = null;

/**
 * Прочитать книги ГРБС и лист СВОД одним циклом и обновить кэши.
 * Ошибка отдельной книги не валит цикл: упавшая книга УДАЛЯЕТСЯ из кэша, а не
 * остаётся под видом свежих данных.
 */
export function refreshAllSources(log?: {
  info: (msg: string) => void;
  warn: (msg: string) => void;
}): Promise<SourceRefreshResult> {
  if (inFlight) return inFlight;

  inFlight = (async () => {
    const { data, errors } = await fetchDepartmentSpreadsheets(DEPARTMENT_SPREADSHEETS);
    setDeptSheetCache(data, Object.keys(errors));

    let svodOk = false;
    try {
      setSvodGridCache(await getSheetData(SVOD_SHEET_NAME));
      svodOk = true;
    } catch (err) {
      log?.warn(`Лист СВОД не прочитан в этом цикле: ${(err as Error).message}`);
    }

    const at = new Date().toISOString();
    const loadMeta: Record<string, { loadedAt: string; rowCount: number; sheetName: string; error?: string }> = {};
    for (const [name, result] of Object.entries(data)) {
      loadMeta[name] = { loadedAt: at, rowCount: result.values.length, sheetName: result.sheetName };
    }
    for (const [name, errMsg] of Object.entries(errors)) {
      loadMeta[name] = { loadedAt: at, rowCount: 0, sheetName: name, error: errMsg };
    }
    setDeptLoadMeta(loadMeta);

    return { loaded: Object.keys(data), failed: Object.keys(errors), svodOk, at };
  })().finally(() => {
    inFlight = null;
  });

  return inFlight;
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
