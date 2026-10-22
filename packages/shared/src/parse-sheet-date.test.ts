import { describe, expect, it } from 'vitest';
import { dayNumberOf, equivalentSheetDate, floorToThursday, isoOfDayNumber, mondayOfDay, parseSheetDate } from './parse-sheet-date';

it('эквивалентность представления ограничена датными колонками и не склеивает номера', () => {
  expect(equivalentSheetDate('N', '24.02.2026', 46077)).toBe(true);
  expect(equivalentSheetDate('Q', '2026-02-24', '46077')).toBe(true);
  expect(equivalentSheetDate('N', '24.02.2026', 46078)).toBe(false);
  expect(equivalentSheetDate('Q', '', 'Х')).toBe(false);
  expect(equivalentSheetDate('A', '23/1', 46045)).toBe(false);
});

describe('parseSheetDate — единый парсер даты из ячейки листа', () => {
  it('Google-serial 46023 → 2026-01-01 (НЕ год 46023)', () => {
    const d = parseSheetDate('46023');
    expect(d).not.toBeNull();
    expect(d!.getUTCFullYear()).toBe(2026);
    expect(d!.getUTCMonth()).toBe(0);
  });

  it('serial как число (не строка) тоже парсится', () => {
    expect(parseSheetDate(46100)!.getUTCFullYear()).toBe(2026);
  });

  it('дд.мм.гггг', () => {
    const d = parseSheetDate('15.03.2026');
    expect(d!.getFullYear()).toBe(2026);
    expect(d!.getMonth()).toBe(2);
    expect(d!.getDate()).toBe(15);
  });

  it('Date-объект пробрасывается', () => {
    const src = new Date(2026, 5, 1);
    expect(parseSheetDate(src)).toBe(src);
  });

  it('пусто/null/заглушки → null', () => {
    expect(parseSheetDate('')).toBeNull();
    expect(parseSheetDate(null)).toBeNull();
    expect(parseSheetDate(undefined)).toBeNull();
  });

  it('год без месяца и дня не является датой планирования или факта', () => {
    expect(parseSheetDate('2026')).toBeNull();
    expect(dayNumberOf('2026')).toBeNull();
  });

  it('несуществующие календарные даты не превращаются в март', () => {
    expect(parseSheetDate('31.02.2026')).toBeNull();
    expect(parseSheetDate('2026-02-31')).toBeNull();
    expect(parseSheetDate('29.02.2024')).not.toBeNull();
    expect(parseSheetDate('29.02.2026')).toBeNull();
  });

  it('мусор → null', () => {
    expect(parseSheetDate('не дата')).toBeNull();
    expect(parseSheetDate('2026-01-01TNOT_A_TIME')).toBeNull();
    expect(dayNumberOf('2026-01-01TNOT_A_TIME')).toBeNull();
  });
});

describe('dayNumberOf — TZ-инвариантный номер календарных суток', () => {
  // serial того же дня, что и «13.07.2026»: дни от Unix-эпохи + смещение 25569 (1899-12-30)
  const SERIAL_2026_07_13 = Date.UTC(2026, 6, 13) / 86400000 + 25569;

  it('(а) serial и «дд.мм.гггг» одного дня → одинаковый номер', () => {
    const fromRu = dayNumberOf('13.07.2026');
    const fromSerial = dayNumberOf(String(SERIAL_2026_07_13));
    expect(fromRu).not.toBeNull();
    expect(fromSerial).toBe(fromRu);
    // serial как число (не строка) — тоже
    expect(dayNumberOf(SERIAL_2026_07_13)).toBe(fromRu);
  });

  it('(б) соседние дни → разница ровно 1 (в любой TZ)', () => {
    expect(dayNumberOf('14.07.2026')! - dayNumberOf('13.07.2026')!).toBe(1);
    expect(dayNumberOf(SERIAL_2026_07_13 + 1)! - dayNumberOf(SERIAL_2026_07_13)!).toBe(1);
    // граница месяца и года
    expect(dayNumberOf('01.08.2026')! - dayNumberOf('31.07.2026')!).toBe(1);
    expect(dayNumberOf('01.01.2027')! - dayNumberOf('31.12.2026')!).toBe(1);
  });

  it('(в) ISO-строка того же дня → тот же номер', () => {
    expect(dayNumberOf('2026-07-13')).toBe(dayNumberOf('13.07.2026'));
    // полная ISO-строка со временем — время суток не влияет на номер суток
    expect(dayNumberOf('2026-07-13T23:59:59Z')).toBe(dayNumberOf('13.07.2026'));
  });

  it('время в Google serial остаётся в исходных календарных сутках', () => {
    const serial = 46023; // 01.01.2026
    expect(dayNumberOf(serial + 0.75)).toBe(dayNumberOf(serial));
    expect(dayNumberOf(serial + 0.99999)).toBe(dayNumberOf(serial));
    expect(dayNumberOf(serial + 1)).toBe(dayNumberOf(serial)! + 1);
  });

  it('некорректные даты не становятся другим днём', () => {
    for (const s of ['31.02.2026', '2026-02-31', '29.02.2026', '2026-13-01']) {
      expect(dayNumberOf(s)).toBeNull();
    }
    expect(dayNumberOf('29.02.2024')).not.toBeNull();
  });

  it('(г) null/мусор → null', () => {
    expect(dayNumberOf(null)).toBeNull();
    expect(dayNumberOf(undefined)).toBeNull();
    expect(dayNumberOf('')).toBeNull();
    expect(dayNumberOf('не дата')).toBeNull();
    // число вне serial-диапазона — не serial и не дата
    expect(dayNumberOf(12345)).toBeNull();
  });

  it('Date-объект → номер по локальным компонентам (совпадает с «дд.мм.гггг»)', () => {
    expect(dayNumberOf(new Date(2026, 6, 13))).toBe(dayNumberOf('13.07.2026'));
    // время суток внутри локального дня не влияет
    expect(dayNumberOf(new Date(2026, 6, 13, 23, 41))).toBe(dayNumberOf('13.07.2026'));
    expect(dayNumberOf(new Date(NaN))).toBeNull();
  });

  it('паритет с parseSheetDate: serial 46023 = 01.01.2026', () => {
    expect(dayNumberOf('46023')).toBe(dayNumberOf('01.01.2026'));
  });
});

describe('недельная арифметика (день 0 эпохи — четверг)', () => {
  it('floorToThursday: четверг неподвижен, будни флорятся к прошедшему четвергу', () => {
    const thu = dayNumberOf('23.07.2026')!; // четверг
    expect(thu % 7).toBe(0);
    expect(floorToThursday(thu)).toBe(thu);
    expect(floorToThursday(dayNumberOf('24.07.2026')!)).toBe(thu); // пятница
    expect(floorToThursday(dayNumberOf('29.07.2026')!)).toBe(thu); // среда следующей недели
  });

  it('mondayOfDay: любой день недели пн..вс -> её понедельник; понедельник неподвижен', () => {
    const mon = dayNumberOf('20.07.2026')!; // понедельник
    expect(mondayOfDay(mon)).toBe(mon);
    expect(mondayOfDay(dayNumberOf('23.07.2026')!)).toBe(mon); // четверг
    expect(mondayOfDay(dayNumberOf('26.07.2026')!)).toBe(mon); // воскресенье
    expect(mondayOfDay(dayNumberOf('27.07.2026')!)).toBe(mon + 7); // следующий понедельник
  });

  it('isoOfDayNumber: обратен dayNumberOf для ISO-дат', () => {
    expect(isoOfDayNumber(dayNumberOf('2026-07-23')!)).toBe('2026-07-23');
    expect(isoOfDayNumber(0)).toBe('1970-01-01');
  });
});

describe('строгий ISO-ввод: даты не допускают произвольный текст', () => {
  it('не принимает текст после корректной даты и невозможное время', () => {
    for (const bad of ['2026-02-28 comment', '2026-02-28T25:61:00Z', '2026-02-28T12:00:00Zjunk']) {
      expect(parseSheetDate(bad), bad).toBeNull();
      expect(dayNumberOf(bad), bad).toBeNull();
    }
  });
  it('сохраняет часовой пояс и обычные ISO-даты', () => {
    expect(dayNumberOf('2026-10-22T23:59:59+12:00')).toBe(dayNumberOf('22.10.2026'));
    expect(dayNumberOf('2026-10-22')).toBe(dayNumberOf('22.10.2026'));
  });
});

it('civil years 0001 and 0099 keep their year across date forms and ISO readback', () => {
  for (const year of ['0001', '0099']) {
    const iso = year + '-12-31';
    const ru = '31.12.' + year;
    const day = dayNumberOf(iso);
    expect(day).not.toBeNull();
    expect(dayNumberOf(ru)).toBe(day);
    expect(isoOfDayNumber(day!)).toBe(iso);
  }
  const local = new Date(0);
  local.setFullYear(99, 11, 31);
  expect(dayNumberOf(local)).toBe(dayNumberOf('0099-12-31'));
});
