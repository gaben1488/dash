/**
 * row-timeline.test.ts — таймлайн строки по всей истории (канон п.75в).
 *
 * Проверяет: карту «буква → вид события», дифф частичных наблюдений,
 * СТРУКТУРНЫЙ вывод просрочки (п.27 — без чтения текста), сортировку,
 * дедуп по (at, kind, cell) и честную подпись глубины истории.
 */

import { describe, expect, it } from 'vitest';
import { dayNumberOf } from '@aemr/shared';
import { buildRowTimeline, type RowObservation } from './row-timeline.js';

const DAY_2026_06_10 = dayNumberOf('10.06.2026')!;

/** Наблюдение с полным набором отслеживаемых ячеек. */
function obs(at: string, cells: Record<string, unknown>, source: RowObservation['source'] = 'снимок'): RowObservation {
  return { at, source, cells };
}

describe('buildRowTimeline — журнал правок', () => {
  it('буквы N/Q/L/K/AF дают канонические виды; чужая строка и чужая буква — отсев', () => {
    const t = buildRowTimeline({
      rowKey: 'УЭР:4',
      sheetRow: 4,
      journal: [
        { cell: 'N4', oldValue: '01.06.2026', newValue: '15.06.2026', atMs: Date.UTC(2026, 7, 6, 10, 0, 0) },
        { cell: 'Q4', oldValue: 'Х', newValue: '20.06.2026', atMs: Date.UTC(2026, 7, 6, 11, 0, 0) },
        { cell: 'L4', oldValue: 'ЭА', newValue: 'ЕП', atMs: Date.UTC(2026, 7, 6, 12, 0, 0) },
        { cell: 'K4', oldValue: '100,5', newValue: '200', atMs: Date.UTC(2026, 7, 6, 13, 0, 0) },
        { cell: 'AF4', oldValue: '', newValue: 'журнал исполнения', atMs: Date.UTC(2026, 7, 6, 14, 0, 0) },
        // Чужая строка листа — не наш таймлайн.
        { cell: 'N5', oldValue: 'a', newValue: 'b', atMs: Date.UTC(2026, 7, 6, 15, 0, 0) },
        // Буква вне канона видов (предмет) — вид не выдумывается.
        { cell: 'G4', oldValue: 'Столы', newValue: 'Стулья', atMs: Date.UTC(2026, 7, 6, 16, 0, 0) },
      ],
      observations: [],
      asOfDay: DAY_2026_06_10,
    });

    const kinds = t.events.map((e) => e.kind);
    expect(kinds).toEqual([
      'plan_date_changed', 'fact_date_set', 'method_changed', 'sum_changed', 'comment_changed',
    ]);
    expect(t.events.every((e) => e.source === 'журнал')).toBe(true);
    // Даты нормализованы к ISO, деньги — к каноническому числу.
    expect(t.events[0]).toMatchObject({ from: '2026-06-01', to: '2026-06-15', cell: 'N4' });
    expect(t.events[3]).toMatchObject({ from: '100.5', to: '200', cell: 'K4' });
  });
});

describe('buildRowTimeline — дифф наблюдений', () => {
  it('изменение плановой даты и суммы между снимками даёт события источника «снимок»', () => {
    const t = buildRowTimeline({
      rowKey: 'УО:10',
      sheetRow: 10,
      journal: [],
      observations: [
        obs('2026-05-01T00:00:00.000Z', { N: '01.06.2026', Q: 'Х', K: 100 }),
        obs('2026-05-08T00:00:00.000Z', { N: '15.06.2026', Q: 'Х', K: 150 }),
      ],
      asOfDay: dayNumberOf('01.06.2026')!,
    });
    const planChange = t.events.find((e) => e.kind === 'plan_date_changed');
    expect(planChange).toMatchObject({
      from: '2026-06-01', to: '2026-06-15', source: 'снимок', cell: 'N10',
      at: '2026-05-08T00:00:00.000Z',
    });
    const sumChange = t.events.find((e) => e.kind === 'sum_changed');
    expect(sumChange).toMatchObject({ from: '100', to: '150', cell: 'K10' });
    // Каждое наблюдение видно как факт наблюдения.
    expect(t.events.filter((e) => e.kind === 'snapshot_observed')).toHaveLength(2);
  });

  it('serial и «дд.мм.гггг» одной даты — НЕ изменение (нормализация дат)', () => {
    const serial = 46094; // = какой-то день 2026 года; главное — сравнить сам с собой строкой
    const iso = (() => {
      const day = dayNumberOf(serial)!;
      // isoOfDayNumber недоступен здесь напрямую — переведём через известный канон:
      return new Date(day * 86400000).toISOString().slice(0, 10);
    })();
    const ru = `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;
    const t = buildRowTimeline({
      rowKey: 'УО:10',
      sheetRow: 10,
      journal: [],
      observations: [
        obs('2026-05-01T00:00:00.000Z', { N: serial }),
        obs('2026-05-08T00:00:00.000Z', { N: ru }),
      ],
      asOfDay: 0,
    });
    expect(t.events.filter((e) => e.kind === 'plan_date_changed')).toHaveLength(0);
  });

  it('частичное наблюдение (срез недели без U/AE/AF) не рождает ложных правок комментария', () => {
    const t = buildRowTimeline({
      rowKey: 'УО:10',
      sheetRow: 10,
      journal: [],
      observations: [
        // Срез недели: буквы U нет вовсе (не пустая — неизвестная).
        obs('2026-05-08', { N: '01.06.2026', K: 100 }, 'срез недели'),
        obs('2026-08-01T00:00:00.000Z', { N: '01.06.2026', K: 100, U: 'причина' }),
      ],
      asOfDay: 0,
    });
    expect(t.events.filter((e) => e.kind === 'comment_changed')).toHaveLength(0);
  });
});

describe('buildRowTimeline — просрочка структурно (канон п.27)', () => {
  it('плановая дата прошла, заключения нет → overdue_started днём после плана', () => {
    const t = buildRowTimeline({
      rowKey: 'УО:10',
      sheetRow: 10,
      journal: [],
      observations: [obs('2026-06-10T00:00:00.000Z', { N: '01.06.2026', Q: 'Х' })],
      asOfDay: DAY_2026_06_10,
    });
    const overdue = t.events.find((e) => e.kind === 'overdue_started');
    expect(overdue).toMatchObject({ at: '2026-06-02', from: '2026-06-01', cell: 'N10' });
    expect(overdue?.to).toBeUndefined();
  });

  it('заключили позже плана → просрочка была и закрыта датой заключения (to)', () => {
    const t = buildRowTimeline({
      rowKey: 'УО:10',
      sheetRow: 10,
      journal: [],
      observations: [obs('2026-06-10T00:00:00.000Z', { N: '01.06.2026', Q: '05.06.2026' })],
      asOfDay: DAY_2026_06_10,
    });
    const overdue = t.events.find((e) => e.kind === 'overdue_started');
    expect(overdue).toMatchObject({ at: '2026-06-02', from: '2026-06-01', to: '2026-06-05' });
  });

  it('текст «не заключен» в комментарии просрочку НЕ рождает — только структура дат', () => {
    const t = buildRowTimeline({
      rowKey: 'УО:10',
      sheetRow: 10,
      journal: [],
      observations: [obs('2026-06-10T00:00:00.000Z', {
        N: '01.07.2026', Q: 'Х', AF: 'контракт не заключен, просрочено всё',
      })],
      asOfDay: DAY_2026_06_10, // плановая дата ещё впереди
    });
    expect(t.events.filter((e) => e.kind === 'overdue_started')).toHaveLength(0);
  });
});

describe('buildRowTimeline — порядок, дедуп, честная глубина', () => {
  it('события отсортированы по времени; дубль (at, kind, cell) схлопнут', () => {
    const t = buildRowTimeline({
      rowKey: 'УО:10',
      sheetRow: 10,
      journal: [
        { cell: 'N10', oldValue: '01.06.2026', newValue: '15.06.2026', atMs: Date.UTC(2026, 5, 3, 12, 0, 0) },
        // Тот же момент, та же ячейка — дубль повторного чтения журнала.
        { cell: 'N10', oldValue: '01.06.2026', newValue: '15.06.2026', atMs: Date.UTC(2026, 5, 3, 12, 0, 0) },
      ],
      observations: [
        obs('2026-05-08', { N: '01.06.2026' }, 'срез недели'),
        obs('2026-06-10T00:00:00.000Z', { N: '15.06.2026', Q: 'Х' }),
      ],
      asOfDay: DAY_2026_06_10,
    });
    const at = t.events.map((e) => Date.parse(e.at));
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    expect(t.events.filter((e) => e.kind === 'plan_date_changed' && e.source === 'журнал')).toHaveLength(1);
  });

  it('единственное наблюдение без журнала — истории нет, и это сказано вслух', () => {
    const t = buildRowTimeline({
      rowKey: 'УО:10',
      sheetRow: 10,
      journal: [],
      observations: [obs('2026-08-14T00:00:00.000Z', { N: '01.09.2026', Q: 'Х' })],
      asOfDay: 0,
    });
    expect(t.historySince).toBeNull();
    expect(t.historyNote).toContain('Истории по этой строке нет');
  });

  it('глубина истории = самый ранний из журнала и наблюдений', () => {
    const t = buildRowTimeline({
      rowKey: 'УО:10',
      sheetRow: 10,
      journal: [
        { cell: 'L10', oldValue: 'ЭА', newValue: 'ЕП', atMs: Date.UTC(2026, 7, 6, 9, 0, 0) },
      ],
      observations: [
        obs('2026-05-08', { N: '01.06.2026' }, 'срез недели'),
        obs('2026-08-14T00:00:00.000Z', { N: '01.06.2026', Q: 'Х' }),
      ],
      asOfDay: 0,
    });
    expect(t.historySince).toBe('2026-05-08');
    expect(t.historyNote).toContain('История ведётся с 2026-05-08');
    expect(t.historyNote).toContain('срезов недель — 1');
  });

  it('плановая дата берётся из последнего наблюдения', () => {
    const t = buildRowTimeline({
      rowKey: 'УО:10',
      sheetRow: 10,
      journal: [],
      observations: [
        obs('2026-05-08', { N: '01.06.2026' }, 'срез недели'),
        obs('2026-08-14T00:00:00.000Z', { N: '15.09.2026', Q: 'Х' }),
      ],
      asOfDay: 0,
    });
    expect(t.plannedDate).toBe('2026-09-15');
  });
});
