import { describe, expect, it } from 'vitest';
import { dayNumberOf, parseSheetDate } from './parse-sheet-date';

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

  it('число вне serial-диапазона (год 2026) НЕ трактуется как serial', () => {
    // 2026 < 40000 → не serial; new Date('2026') = год 2026 (не serial-конверсия)
    const d = parseSheetDate('2026');
    expect(d).not.toBeNull();
    expect(d!.getUTCFullYear()).toBe(2026);
  });

  it('мусор → null', () => {
    expect(parseSheetDate('не дата')).toBeNull();
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
