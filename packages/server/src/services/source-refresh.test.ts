import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';

/**
 * Страж канона п.66 («прямой эфир»): обе стороны сверки читаются одним циклом.
 *
 * Прецедент 14.08.2026: официальные ячейки читались свежими при каждой сборке
 * снимка, а строки книг брались из кэша, наполненного при старте сервера.
 * Продукт показывал −181,9 по УКСиМП и −313,6 по УО как расхождения расчёта,
 * тогда как обе стороны были согласованы — разошлись МОМЕНТЫ чтения.
 */

const fetchDepartmentSpreadsheets = vi.fn();
const getSheetData = vi.fn();
const setDeptSheetCache = vi.fn();
const setDeptLoadMeta = vi.fn();
const setSvodGridCache = vi.fn();
const setSvodLoadFailure = vi.fn();
const invalidateCache = vi.fn();
// Прежнее чтение книг — материал живых событий: цикл берёт его ДО записи
// нового кэша, поэтому заглушка обязана отдавать пустой кэш, а не падать.
const getDeptSheetCache = vi.fn(() => ({}));

vi.mock('./google-sheets.js', () => ({
  fetchDepartmentSpreadsheets: (...a: unknown[]) => fetchDepartmentSpreadsheets(...a),
  getSheetData: (...a: unknown[]) => getSheetData(...a),
}));

vi.mock('./snapshot.js', () => ({
  setDeptSheetCache: (...a: unknown[]) => setDeptSheetCache(...a),
  setDeptLoadMeta: (...a: unknown[]) => setDeptLoadMeta(...a),
  setSvodGridCache: (...a: unknown[]) => setSvodGridCache(...a),
  setSvodLoadFailure: (...a: unknown[]) => setSvodLoadFailure(...a),
  invalidateCache: (...a: unknown[]) => invalidateCache(...a),
  getDeptSheetCache: () => getDeptSheetCache(),
}));

const log = { info: vi.fn(), warn: vi.fn() };

// Первый импорт тянет за собой расчётное ядро и базу — почти пять секунд на
// холодную. Без прогрева эта цена доставалась ПЕРВОЙ проверке файла, и она
// балансировала на пятисекундном сроке: то проходила, то падала по времени,
// не имея к самому сроку никакого отношения.
beforeAll(async () => {
  await import('./source-refresh.js');
}, 60_000);

beforeEach(() => {
  vi.clearAllMocks();
  fetchDepartmentSpreadsheets.mockResolvedValue({
    data: {
      'УКСиМП': { values: [[1], [2]], formulas: [], sheetName: 'ВСЕ' },
      'УО': { values: [[1]], formulas: [], sheetName: 'ВСЕ' },
    },
    errors: {},
  });
  getSheetData.mockResolvedValue([['СВОД']]);
});

afterEach(async () => {
  const { stopSourceAutoRefresh } = await import('./source-refresh.js');
  stopSourceAutoRefresh();
});

describe('перечитка источников одним циклом', () => {
  it('книги и лист СВОД читаются в одном вызове и кладутся в кэш', async () => {
    const { refreshAllSources } = await import('./source-refresh.js');
    const r = await refreshAllSources(log);

    expect(fetchDepartmentSpreadsheets).toHaveBeenCalledTimes(1);
    expect(getSheetData).toHaveBeenCalledTimes(1);
    expect(setDeptSheetCache).toHaveBeenCalledTimes(1);
    expect(setSvodGridCache).toHaveBeenCalledTimes(1);
    expect(r.loaded).toEqual(['УКСиМП', 'УО']);
    expect(r.svodOk).toBe(true);
  });

  it('СТРАЖ п.98б: после перечитки кэш снимка сброшен — замечания не живут старыми до 5 минут', async () => {
    // Прецедент 18.08: refreshAllSources обновлял кэш книг, но снимок с TTL 300 с
    // не инвалидировал — «внесла данные, из красного не ушло».
    const { refreshAllSources } = await import('./source-refresh.js');
    await refreshAllSources(log);

    expect(invalidateCache).toHaveBeenCalledTimes(1);
  });

  it('параллельные вызовы разделяют один цикл, а не читают книги дважды', async () => {
    const { refreshAllSources } = await import('./source-refresh.js');
    const [a, b] = await Promise.all([refreshAllSources(log), refreshAllSources(log)]);

    expect(fetchDepartmentSpreadsheets).toHaveBeenCalledTimes(1);
    expect(a.at).toBe(b.at);
  });

  it('упавшая книга удаляется из кэша, а не остаётся под видом свежей', async () => {
    fetchDepartmentSpreadsheets.mockResolvedValueOnce({
      data: { 'УО': { values: [[1]], formulas: [], sheetName: 'ВСЕ' } },
      errors: { 'УКСиМП': 'таймаут' },
    });
    const { refreshAllSources } = await import('./source-refresh.js');
    const r = await refreshAllSources(log);

    expect(r.failed).toEqual(['УКСиМП']);
    expect(setDeptSheetCache).toHaveBeenCalledWith(expect.anything(), ['УКСиМП']);
  });

  it('недоступный лист СВОД не валит цикл: книги всё равно обновлены', async () => {
    getSheetData.mockRejectedValueOnce(new Error('403'));
    const { refreshAllSources } = await import('./source-refresh.js');
    const r = await refreshAllSources(log);

    expect(r.svodOk).toBe(false);
    expect(r.loaded.length).toBe(2);
    expect(log.warn).toHaveBeenCalled();
  });

  it('отказ листа СВОД оставляет след — иначе он навсегда «ещё не читался»', async () => {
    // Маршрут здоровья не отличал «читали и не смогли» от «ещё не читали»:
    // успех клал сетку в кэш, а отказ не оставлял НИЧЕГО.
    getSheetData.mockRejectedValueOnce(
      Object.assign(new Error('Quota exceeded'), { status: 429 }),
    );
    const { refreshAllSources } = await import('./source-refresh.js');
    await refreshAllSources(log);

    expect(setSvodLoadFailure).toHaveBeenCalledWith('источник ограничил частоту обращений');
  });

  it('книги и лист СВОД читаются ОДНОВРЕМЕННО, а не одно за другим', async () => {
    // Дело не только в скорости цикла: подряд читать их значит развести
    // стороны сверки во времени ровно на длительность чтения книг, а канон
    // п.66 требует обратного — обе стороны из одного момента.
    const order: string[] = [];
    let releaseBooks: (() => void) | undefined;
    fetchDepartmentSpreadsheets.mockImplementationOnce(async () => {
      order.push('книги: начало');
      await new Promise<void>((resolve) => { releaseBooks = resolve; });
      order.push('книги: конец');
      return { data: { 'УО': { values: [[1]], formulas: [], sheetName: 'ВСЕ' } }, errors: {} };
    });
    getSheetData.mockImplementationOnce(async () => {
      // Лист СВОД начал читаться, ПОКА книги ещё не отпущены — значит его
      // чтение не ждало их окончания.
      order.push('СВОД: начало');
      releaseBooks?.();
      return [['СВОД']];
    });

    const { refreshAllSources } = await import('./source-refresh.js');
    await refreshAllSources(log);

    expect(order).toEqual(['книги: начало', 'СВОД: начало', 'книги: конец']);
  });
});

describe('рабочее окно опроса (канон п.87/20: 8:45–18:20 по Камчатке)', () => {
  it('границы окна включительны, ночь и раннее утро — вне окна', async () => {
    const { isWithinWorkHours } = await import('./source-refresh.js');
    const kamchatka = 12;
    // 8:45 по Камчатке = 20:45 UTC предыдущего дня
    expect(isWithinWorkHours(new Date(Date.UTC(2026, 7, 13, 20, 45)), kamchatka)).toBe(true);
    // 18:20 включительно
    expect(isWithinWorkHours(new Date(Date.UTC(2026, 7, 14, 6, 20)), kamchatka)).toBe(true);
    // 18:21 — уже вне
    expect(isWithinWorkHours(new Date(Date.UTC(2026, 7, 14, 6, 21)), kamchatka)).toBe(false);
    // 8:44 — ещё вне
    expect(isWithinWorkHours(new Date(Date.UTC(2026, 7, 13, 20, 44)), kamchatka)).toBe(false);
    // полночь по Камчатке
    expect(isWithinWorkHours(new Date(Date.UTC(2026, 7, 14, 12, 0)), kamchatka)).toBe(false);
  });
});

/**
 * Живые события (канон п.66 «прямой эфир»): цикл перечитки обязан объявлять,
 * что изменилось, — и обязан молчать, когда не изменилось ничего.
 */
describe('перечитка объявляет изменения в прямом эфире', () => {
  const header = [['шапка'], ['шапка'], ['шапка']];

  it('изменившаяся книга даёт событие «книга обновлена» и подробность по строке', async () => {
    const { subscribeLiveEvents, resetLiveEventBus } = await import('./event-bus.js');
    resetLiveEventBus();
    getDeptSheetCache.mockReturnValueOnce({
      'УО': { values: [...header, ['155', 'УО АЕМР', '', '', '', '', 'Опрессовка']] },
    });
    fetchDepartmentSpreadsheets.mockResolvedValueOnce({
      data: {
        'УО': { values: [...header, ['155', 'УО АЕМР', '', '', '', '', 'Опрессовка систем']], formulas: [], sheetName: 'ВСЕ' },
      },
      errors: {},
    });

    const heard: any[] = [];
    subscribeLiveEvents((e) => heard.push(e.event));
    const { refreshAllSources } = await import('./source-refresh.js');
    await refreshAllSources(log, 'webhook');

    expect(heard.map((e) => e.kind)).toEqual(['book-updated', 'row-changed']);
    expect(heard[0]).toMatchObject({ book: 'УО', changedRows: 1, origin: 'webhook' });
    expect(heard[1]).toMatchObject({ book: 'УО', column: 'G', before: 'Опрессовка', after: 'Опрессовка систем' });
    resetLiveEventBus();
  });

  it('книга без изменений событий не порождает — тишина, а не спам', async () => {
    const { subscribeLiveEvents, resetLiveEventBus } = await import('./event-bus.js');
    resetLiveEventBus();
    const same = [...header, ['155', 'УО АЕМР']];
    getDeptSheetCache.mockReturnValueOnce({ 'УО': { values: same } });
    fetchDepartmentSpreadsheets.mockResolvedValueOnce({
      data: { 'УО': { values: same, formulas: [], sheetName: 'ВСЕ' } },
      errors: {},
    });

    const heard: unknown[] = [];
    subscribeLiveEvents((e) => heard.push(e));
    const { refreshAllSources } = await import('./source-refresh.js');
    await refreshAllSources(log);

    expect(heard).toEqual([]);
    resetLiveEventBus();
  });
});
