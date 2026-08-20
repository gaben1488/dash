/**
 * row-timeline.test.ts — таймлайн строки по всей истории (канон п.75в).
 *
 * Проверяет: карту «буква → вид события», дифф частичных наблюдений,
 * СТРУКТУРНЫЙ вывод просрочки (п.27 — без чтения текста), сортировку,
 * дедуп по (at, kind, cell) и честную подпись глубины истории.
 */

import { describe, expect, it } from 'vitest';
import { dayNumberOf } from '@aemr/shared';
import { buildRowTimeline, sheetNumber, type RowObservation } from './row-timeline.js';

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
        // Смена предмета РАНЬШЕ всех правок: с п.117 она режет историю до
        // себя; правки ниже — уже эпоха текущего жильца строки. Заодно
        // проверяется, что буква G сама вида события не порождает.
        { cell: 'G4', oldValue: 'Столы', newValue: 'Стулья', atMs: Date.UTC(2026, 7, 6, 9, 0, 0) },
        { cell: 'N4', oldValue: '01.06.2026', newValue: '15.06.2026', atMs: Date.UTC(2026, 7, 6, 10, 0, 0) },
        { cell: 'Q4', oldValue: 'Х', newValue: '20.06.2026', atMs: Date.UTC(2026, 7, 6, 11, 0, 0) },
        { cell: 'L4', oldValue: 'ЭА', newValue: 'ЕП', atMs: Date.UTC(2026, 7, 6, 12, 0, 0) },
        { cell: 'K4', oldValue: '100,5', newValue: '200', atMs: Date.UTC(2026, 7, 6, 13, 0, 0) },
        { cell: 'AF4', oldValue: '', newValue: 'журнал исполнения', atMs: Date.UTC(2026, 7, 6, 14, 0, 0) },
        // Чужая строка листа — не наш таймлайн.
        { cell: 'N5', oldValue: 'a', newValue: 'b', atMs: Date.UTC(2026, 7, 6, 15, 0, 0) },
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

describe('buildRowTimeline — отсечка чужой истории (п.117)', () => {
  const cut = Date.parse('2026-08-10T12:00:00.000Z');

  it('правки до смены предмета на строке — чужие: в таймлайн не входят, отсечка названа', () => {
    const t = buildRowTimeline({
      rowKey: 'УО:178',
      sheetRow: 178,
      journal: [
        // Эпоха прежнего жильца строки: правка плановой даты чужой закупки.
        { cell: 'N178', oldValue: '01.07.2026', newValue: '10.07.2026', atMs: cut - 86_400_000 },
        // Смена жильца: предмет строки сменился целиком.
        { cell: 'G178', oldValue: 'Поставка угля для котельной', newValue: 'Ремонт кровли школы № 7', atMs: cut },
        // Наша эпоха: правка плановой даты текущей закупки.
        { cell: 'N178', oldValue: '10.08.2026', newValue: '30.08.2026', atMs: cut + 86_400_000 },
      ],
      observations: [],
      asOfDay: 0,
    });
    expect(t.identityCutAt).toBe('2026-08-10T12:00:00.000Z');
    const planEdits = t.events.filter((e) => e.kind === 'plan_date_changed');
    expect(planEdits).toHaveLength(1);
    expect(planEdits[0].to).toBe('2026-08-30');
    expect(t.historyNote).toContain('другая закупка');
    expect(t.historyNote).toContain('Поставка угля');
  });

  it('правка хвоста формулировки предмета — НЕ смена жильца: история цела', () => {
    const t = buildRowTimeline({
      rowKey: 'УО:20',
      sheetRow: 20,
      journal: [
        { cell: 'N20', oldValue: '01.07.2026', newValue: '10.07.2026', atMs: cut - 86_400_000 },
        { cell: 'G20', oldValue: 'Ремонт кровли школы №7', newValue: 'Ремонт кровли школы № 7 (корпус Б)', atMs: cut },
      ],
      observations: [],
      asOfDay: 0,
    });
    expect(t.identityCutAt).toBeNull();
    expect(t.events.filter((e) => e.kind === 'plan_date_changed')).toHaveLength(1);
  });

  it('наблюдения до отсечки — чужие: дифф через границу смены жильца не строится', () => {
    const t = buildRowTimeline({
      rowKey: 'УО:30',
      sheetRow: 30,
      journal: [
        { cell: 'G30', oldValue: 'Поставка мебели', newValue: 'Приобретение автобуса', atMs: cut },
      ],
      observations: [
        obs('2026-08-01T00:00:00.000Z', { K: '5 000,0' }),
        obs('2026-08-14T00:00:00.000Z', { K: '12 000,0' }),
      ],
      asOfDay: 0,
    });
    // Дифф «5 000 → 12 000» был бы сравнением двух РАЗНЫХ закупок.
    expect(t.events.filter((e) => e.kind === 'sum_changed')).toHaveLength(0);
  });

  it('пустая сторона правки предмета не режет: резать можно только по увиденной смене', () => {
    const t = buildRowTimeline({
      rowKey: 'УО:40',
      sheetRow: 40,
      journal: [
        { cell: 'N40', oldValue: '01.07.2026', newValue: '10.07.2026', atMs: cut - 86_400_000 },
        // Предмет ВПИСАН в пустую ячейку — это заполнение, не смена жильца.
        { cell: 'G40', oldValue: '', newValue: 'Поставка бумаги', atMs: cut },
      ],
      observations: [],
      asOfDay: 0,
    });
    expect(t.identityCutAt).toBeNull();
    expect(t.events.filter((e) => e.kind === 'plan_date_changed')).toHaveLength(1);
  });
});

describe('sheetNumber — единая null-коэрция ядра (чистка 20.08.2026, зона В)', () => {
  // К этой функции сведены копии normalize.ts, normalizer-rules.ts и
  // signals.ts (toNumber = sheetNumber(v) ?? NaN) — контракт ниже держит
  // всех четверых потребителей разом. Семантика: «мусор -> null», не ноль.
  it('операторский формат: пробелы тысяч и запятая-десятичная', () => {
    expect(sheetNumber('2 250 000,00')).toBe(2250000);
    expect(sheetNumber('1 234,56')).toBe(1234.56); // неразрывный пробел листа
    expect(sheetNumber('100,5')).toBe(100.5);
  });

  it('числа проходят как есть, нефинитное -> null', () => {
    expect(sheetNumber(684)).toBe(684);
    expect(sheetNumber(0)).toBe(0);
    expect(sheetNumber(Number.POSITIVE_INFINITY)).toBeNull();
    expect(sheetNumber(Number.NaN)).toBeNull();
  });

  it('пустота и мусор -> null (НЕ ноль: «пусто» и «0» — разные факты)', () => {
    expect(sheetNumber('')).toBeNull();
    expect(sheetNumber('   ')).toBeNull();
    expect(sheetNumber(null)).toBeNull();
    expect(sheetNumber(undefined)).toBeNull();
    expect(sheetNumber('Х')).toBeNull(); //плейсхолдер операторов
    expect(sheetNumber('по мере необходимости')).toBeNull();
  });

  it('характеризация parseFloat: числовой ПРЕФИКС читается (наследие всех копий)', () => {
    // Так вели себя ВСЕ исходные копии (parseFloat): «684.0 руб» -> 684.
    // Фиксируем как контракт, чтобы смена реализации не изменила поведение молча.
    expect(sheetNumber('684.0 руб')).toBe(684);
  });
});
