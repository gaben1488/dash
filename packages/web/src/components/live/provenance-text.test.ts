/**
 * Стражи текстов узла провенанса (канон п.133).
 *
 * Проверяется не вёрстка, а обещания: незнание не выдаётся за свежесть,
 * режим обновления называется тем, чем он является, счёт правок совпадает
 * с событиями, склонения живые.
 */
import { describe, it, expect } from 'vitest';
import type { BookChange, LiveState } from '../../hooks/useLiveEvents';
import { changeLines, newIssuesLine, provenancePill, refreshModeLine, totalChanges } from './provenance-text';

function book(over: Partial<BookChange> = {}): BookChange {
  return {
    book: 'УО',
    changedRows: 0,
    addedRows: 0,
    removedRows: 0,
    rowsTotal: 100,
    origin: 'cycle',
    at: new Date().toISOString(),
    ...over,
  };
}

function live(over: Partial<LiveState> = {}): LiveState {
  return {
    connected: false,
    lastEventAt: null,
    books: [],
    newIssues: 0,
    snapshotRebuilt: false,
    recentRows: [],
    ...over,
  };
}

describe('provenancePill', () => {
  it('без момента чтения честно говорит о незнании, а не «только что»', () => {
    const pill = provenancePill(live(), null);
    expect(pill.moment).toBe('момент чтения неизвестен');
    expect(pill.moment).not.toMatch(/только что/);
  });

  it('считает правки по всем книгам: правки + добавленные + исчезнувшие', () => {
    const pill = provenancePill(
      live({ books: [book({ changedRows: 3, addedRows: 1 }), book({ book: 'УДТХ', removedRows: 2 })] }),
      new Date().toISOString(),
    );
    expect(pill.changes).toBe(6);
    expect(pill.title).toMatch(/6 правок/);
  });

  it('без правок значка изменений нет и подсказка о них молчит', () => {
    const pill = provenancePill(live({ connected: true }), new Date().toISOString());
    expect(pill.changes).toBe(0);
    expect(pill.title).not.toMatch(/правк/);
    expect(pill.live).toBe(true);
  });
});

describe('refreshModeLine', () => {
  it('молчание сервера — «неизвестен», а не выдуманный режим', () => {
    expect(refreshModeLine(null, null, null).detail).toMatch(/неизвестен/);
  });

  it('вебхук и таймер называются раздельно, склонение минут живое', () => {
    const d = refreshModeLine(true, 21, '8:45–18:20 по Камчатке').detail;
    expect(d).toMatch(/книги сообщают о правках сами/);
    expect(d).toMatch(/каждые 21 минуту/);
    expect(d).toMatch(/рабочее окно/);
  });

  it('невыстроенный вебхук виден прямо, не умалчивается', () => {
    expect(refreshModeLine(false, 5, null).detail).toMatch(/уведомления от книг не настроены/);
    expect(refreshModeLine(false, 5, null).detail).toMatch(/каждые 5 минут/);
  });
});

describe('changeLines', () => {
  it('называет источник перечитки словами, а не кодом', () => {
    const [webhook, request, cycle] = changeLines([
      book({ changedRows: 2, origin: 'webhook' }),
      book({ book: 'УД', addedRows: 1, origin: 'request' }),
      book({ book: 'УЭР', origin: 'cycle' }),
    ]);
    expect(webhook.detail).toMatch(/книга сообщила сама/);
    expect(request.detail).toMatch(/по кнопке/);
    expect(cycle.detail).toMatch(/по таймеру/);
  });

  it('книга без изменений строк говорит об этом, а не показывает пустоту', () => {
    expect(changeLines([book()])[0].detail).toMatch(/без изменений строк/);
  });

  it('исчезнувшие строки названы отдельно от правок (п.105: удаления журнал не пишет)', () => {
    const line = changeLines([book({ changedRows: 1, removedRows: 3 })])[0].detail;
    expect(line).toMatch(/1 правка/);
    expect(line).toMatch(/3 строки исчезли/);
    expect(changeLines([book({ removedRows: 7 })])[0].detail).toMatch(/7 строк исчезло/);
  });
});

describe('newIssuesLine и totalChanges', () => {
  it('ноль замечаний — строки нет вовсе', () => {
    expect(newIssuesLine(0)).toBeNull();
    expect(newIssuesLine(-1)).toBeNull();
  });

  it('одно замечание склоняется в единственном числе', () => {
    expect(newIssuesLine(1)).toMatch(/1 замечание/);
  });

  it('пустой список книг даёт ноль правок', () => {
    expect(totalChanges([])).toBe(0);
  });
});
