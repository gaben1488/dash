// @vitest-environment jsdom
/**
 * Страж красок полноты у КВАРТАЛОВ барабана дат (канон пульс-2, п.10; переезд
 * класса §12.3: месяцы получили три вида покрытия, кварталы остались слепыми).
 *
 * Кварталы обязаны краситься тем же словарём, что месяцы (classifyQuarter):
 *   • квартал прошёл/идёт без строк — «данных нет» (tg-month-empty);
 *   • квартал целиком в будущем — «ещё не наступил» (tg-month-future),
 *     ДАЖЕ при плановых строках: будущее побеждает счёт (§12.3);
 *   • 1–3 строки — «почти пусто» (tg-month-scarce);
 *   • и каждая краска названа словами в подписи, не только цветом.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as React from 'react';
import { cleanup, render } from '@testing-library/react';
import { TimeDrum } from './Header';
import { useStore } from '../store';

// Индекс покрытия — руками: сеть в страже не нужна, важна классификация.
// 2026: I квартал полон, во II — две строки, III пуст, IV — будущий С планом.
vi.mock('../hooks/usePeriodCoverage', () => ({
  usePeriodCoverage: () => ({
    status: 'ready',
    index: {
      weeks: {},
      months: { '2026-1': 100, '2026-2': 50, '2026-3': 30, '2026-4': 2, '2026-10': 42 },
      years: { 2026: 224 },
    },
  }),
}));

function quarterTab(container: HTMLElement, title: RegExp): HTMLButtonElement {
  const btn = [...container.querySelectorAll<HTMLButtonElement>('button.tg-quarter-tab')]
    .find((b) => title.test(b.title));
  if (!btn) {
    throw new Error(`ярлык квартала не найден: ${title}`);
  }
  return btn;
}

beforeEach(() => {
  // Продуктовое «сегодня» приколочено: 29.08.2026 — III квартал идёт,
  // IV ещё не наступил. Без этого страж ломался бы сменой календаря.
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-08-29T12:00:00+12:00'));
  useStore.getState().resetAllFilters();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  useStore.getState().resetAllFilters();
});

describe('краски полноты кварталов (classifyQuarter на ярлыках)', () => {
  it('квартал с данными — обычный вид, подпись без оговорок', () => {
    const { container } = render(<TimeDrum />);
    const q1 = quarterTab(container, /^1 квартал 2026$/);
    expect(q1.className).not.toContain('tg-month-empty');
    expect(q1.className).not.toContain('tg-month-future');
    expect(q1.className).not.toContain('tg-month-scarce');
  });

  it('«почти пусто» (2 строки) — точка scarce и счёт в подписи', () => {
    const { container } = render(<TimeDrum />);
    const q2 = quarterTab(container, /^2 квартал 2026/);
    expect(q2.className).toContain('tg-month-scarce');
    expect(q2.title).toContain('строк мало (2)');
  });

  it('идущий квартал без строк — «данных нет», приглушение', () => {
    const { container } = render(<TimeDrum />);
    const q3 = quarterTab(container, /^3 квартал 2026/);
    expect(q3.className).toContain('tg-month-empty');
    expect(q3.title).toContain('данных нет');
  });

  it('будущий квартал — «ещё не наступил» ДАЖЕ с плановыми строками (будущее побеждает счёт, §12.3)', () => {
    const { container } = render(<TimeDrum />);
    const q4 = quarterTab(container, /^4 квартал 2026/);
    expect(q4.className).toContain('tg-month-future');
    expect(q4.className).not.toContain('tg-month-empty');
    expect(q4.title).toContain('ещё не наступил');
    // Подпись и для читалки: aria-label несёт ту же оговорку.
    expect(q4.getAttribute('aria-label')).toContain('ещё не наступил');
  });
});
