import { describe, it, expect } from 'vitest';
import { readingMoment, LIVE_MOMENT_LABEL, UNKNOWN_MOMENT_LABEL } from './reading-moment';

/** Опорная «сейчас» для относительных фраз — 14 августа 2026, 12:00 по месту. */
const NOW = new Date('2026-08-14T12:00:00').getTime();

/** ISO момента, отстоящего от опорной точки на заданное число минут назад. */
function minutesAgo(minutes: number): string {
  return new Date(NOW - minutes * 60_000).toISOString();
}

describe('незнание момента — не свежесть (канон п.53, болезнь П0-1 «Реестра»)', () => {
  it('сервер не назвал момент — так и написано, без «только что»', () => {
    const m = readingMoment({ readAt: null, now: NOW });
    expect(m.kind).toBe('unknown');
    expect(m.label).toBe(UNKNOWN_MOMENT_LABEL);
    expect(m.label).not.toContain('только что');
    expect(m.label).not.toContain('сейчас');
    expect(m.iso).toBeNull();
  });

  it('нечитаемый момент чтения — то же незнание, а не подставленное «сейчас»', () => {
    expect(readingMoment({ readAt: 'вчера вечером', now: NOW }).kind).toBe('unknown');
  });

  it('у незнания нет возраста: остывшим оно не считается', () => {
    expect(readingMoment({ readAt: null, now: NOW }).stale).toBe(false);
  });

  it('ось, которую вкладка не заявляла, — прежнее «на сейчас», а не незнание', () => {
    const m = readingMoment({ now: NOW });
    expect(m.kind).toBe('live');
    expect(m.label).toBe(LIVE_MOMENT_LABEL);
    expect(m.phrase).toBe('числа на текущее состояние книг');
  });
});

describe('эфир — момент чтения книг словами', () => {
  it('свежие числа держат канонический бейдж «на сейчас»', () => {
    const m = readingMoment({ readAt: minutesAgo(3), now: NOW });
    expect(m.kind).toBe('live');
    expect(m.label).toBe(LIVE_MOMENT_LABEL);
    expect(m.stale).toBe(false);
  });

  it('полная фраза называет и давность, и час — «сегодня» само по себе ничего не значит', () => {
    const m = readingMoment({ readAt: minutesAgo(3), now: NOW });
    expect(m.phrase).toBe('книги прочитаны 3 минуты назад (14.08.2026 11:57)');
  });

  it('склонения живые: одна минута, две минуты, пять минут', () => {
    expect(readingMoment({ readAt: minutesAgo(1), now: NOW }).phrase).toContain('1 минуту назад');
    expect(readingMoment({ readAt: minutesAgo(2), now: NOW }).phrase).toContain('2 минуты назад');
    expect(readingMoment({ readAt: minutesAgo(5), now: NOW }).phrase).toContain('5 минут назад');
  });

  it('остывшие числа говорят о своём возрасте уже коротким бейджем', () => {
    const m = readingMoment({ readAt: minutesAgo(180), now: NOW });
    expect(m.stale).toBe(true);
    expect(m.label).toBe('прочитано 3 часа назад');
  });

  it('порог остывания задаётся вызывающим', () => {
    expect(readingMoment({ readAt: minutesAgo(10), now: NOW, staleAfterMinutes: 5 }).stale).toBe(true);
    expect(readingMoment({ readAt: minutesAgo(10), now: NOW, staleAfterMinutes: 90 }).stale).toBe(false);
  });
});

describe('срез — архивный день (канон п.64 «г»)', () => {
  it('день среза называется, а не прячется за словом «архив»', () => {
    const m = readingMoment({ asOf: '2026-08-14' });
    expect(m.kind).toBe('snapshot');
    expect(m.label).toBe('срез на 14.08.2026');
    expect(m.phrase).toContain('не на сейчас');
  });

  it('голая дата читается местной полночью — день среза не съезжает на сутки', () => {
    expect(readingMoment({ asOf: '2026-01-01' }).label).toBe('срез на 01.01.2026');
  });

  it('срез старше момента чтения: он объявлен днём и не считается остывшим', () => {
    const m = readingMoment({ asOf: '2026-01-01', readAt: minutesAgo(5), now: NOW });
    expect(m.kind).toBe('snapshot');
    expect(m.stale).toBe(false);
  });

  it('нечитаемая дата срезом не становится', () => {
    expect(readingMoment({ asOf: 'позавчера' }).kind).toBe('live');
  });
});
