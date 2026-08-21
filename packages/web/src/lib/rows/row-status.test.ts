import { describe, expect, it } from 'vitest';
import { SIGNAL_LABELS } from '@aemr/shared';
import { KNOWN_ROW_STATUSES, rowStatusLook } from './row-status';

/**
 * Страж на дом состояний. Две копии карты «состояние → цвет» уже расходились
 * молча (таблица знала восемь подписей, карточка пять) — тест держит один дом
 * полным и не даёт вернуть выдуманный ноль вместо честной пустоты.
 */
describe('оформление состояния строки', () => {
  it('знает все состояния оси, доезжающие до экрана', () => {
    const fromDto = [
      SIGNAL_LABELS.signed,
      SIGNAL_LABELS.overdue,
      SIGNAL_LABELS.planning,
      SIGNAL_LABELS.canceled,
      SIGNAL_LABELS.notDue,
      SIGNAL_LABELS.financeDelay,
      SIGNAL_LABELS.planSoon,
      SIGNAL_LABELS.factWithoutDate,
      SIGNAL_LABELS.planYearMissing,
      'Исполнение',
      'Открыт',
      'Ошибка',
      'Служебная строка',
    ];
    const missing = fromDto.filter((label) => !KNOWN_ROW_STATUSES.includes(label));
    expect(missing).toEqual([]);
  });

  it('у каждого известного состояния есть объяснение, а не только цвет', () => {
    for (const label of KNOWN_ROW_STATUSES) {
      const look = rowStatusLook(label);
      expect(look, label).not.toBeNull();
      expect(look!.hint.length, label).toBeGreaterThan(20);
      expect(look!.tone, label).not.toBe('');
    }
  });

  it('пустое состояние — не «неизвестно», а отсутствие расчёта', () => {
    expect(rowStatusLook('')).toBeNull();
    expect(rowStatusLook(null)).toBeNull();
    expect(rowStatusLook(undefined)).toBeNull();
  });

  it('незнакомая подпись не красится наугад и признаётся в незнании', () => {
    const look = rowStatusLook('Совсем новое состояние');
    expect(look).not.toBeNull();
    expect(look!.icon).toBeNull();
    expect(look!.hint).toContain('не описано');
    expect(look!.label).toBe('Совсем новое состояние');
  });

  it('стадия «в течение года» не выдаётся за дефект', () => {
    const look = rowStatusLook(SIGNAL_LABELS.factWithoutDate);
    expect(look!.hint).toContain('стадия');
    expect(look!.tone).not.toContain('red');
  });
});
