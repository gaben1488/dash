// @vitest-environment jsdom
/**
 * Стражи честности барабана ставки (канон пульс-2, пп.4–6 второго круга).
 *
 * Классы, которые сторожатся:
 *   • ЗОНА ДЕЙСТВИЯ: переключатель глобален, а зависимые числа сегодня — только
 *     суммы ожидаемой экономии Отчёта. Подсказки ОБЕИХ кнопок обязаны называть
 *     зону словами, а не врать «действует везде»;
 *   • два исхода отсутствия замера — две РАЗНЫЕ фразы: «ещё не получен»
 *     (ожидание сети) против «состоявшихся торгов за 12 месяцев нет — живой
 *     коэффициент не существует» (знание из книги);
 *   • недоступная кнопка «живой» — aria-disabled и ФОКУСИРУЕМА (не disabled):
 *     читалка слышит причину, а не натыкается на пропавший элемент;
 *   • |разница сумм| меньше копейки — «совпадает с нормативом», не «на 0 ₽
 *     больше».
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as React from 'react';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { StavkaDrum } from './Header';
import { useStore } from '../store';

// Сеть в стражах не нужна: запрос замера висит вечно, состояние ставится руками.
vi.mock('../lib/monitoring/analytics-contract', () => ({
  fetchMonitoringAnalytics: vi.fn(() => new Promise(() => {})),
}));

function liveButton(container: HTMLElement): HTMLButtonElement {
  const btn = [...container.querySelectorAll<HTMLButtonElement>('button')]
    .find((b) => (b.textContent ?? '').includes('живой'));
  if (!btn) throw new Error('кнопка «живой» не найдена');
  return btn;
}

beforeEach(() => {
  useStore.getState().resetAllFilters();
  useStore.setState({ liveStavka: null, liveStavkaAbsent: false, dashboardData: null });
});
afterEach(() => cleanup());

describe('кнопка «живой» без замера (п.6)', () => {
  it('«ещё не получен»: aria-disabled, фокусируема, причина в aria-label, нажатие ничего не делает', () => {
    const { container } = render(<StavkaDrum />);
    const btn = liveButton(container);
    expect(btn.getAttribute('aria-disabled')).toBe('true');
    // НЕ disabled: элемент остаётся в порядке обхода клавиатурой.
    expect(btn.hasAttribute('disabled')).toBe(false);
    btn.focus();
    expect(document.activeElement).toBe(btn);
    expect(btn.getAttribute('aria-label')).toContain('ещё не получен');
    fireEvent.click(btn);
    expect(useStore.getState().stavkaMode).toBe('norm');
  });

  it('«замера не существует» — отдельная фраза про 12 месяцев, не «ещё не получен»', () => {
    useStore.setState({ liveStavkaAbsent: true });
    const { container } = render(<StavkaDrum />);
    const btn = liveButton(container);
    expect(btn.getAttribute('aria-label'))
      .toMatch(/[Сс]остоявшихся торгов за 12 месяцев нет — живой коэффициент не существует/);
    expect(btn.getAttribute('aria-label')).not.toContain('ещё не получен');
    expect(btn.getAttribute('aria-disabled')).toBe('true');
  });
});

describe('зона действия ставки в подсказках (п.4)', () => {
  it('обе кнопки называют зону: суммы Отчёта, на остальных вкладках зависимых чисел нет', () => {
    useStore.setState({
      liveStavka: { pct: 9.79, q1: 5.1, q3: 12.4, count: 34, readAt: null },
    });
    const { container } = render(<StavkaDrum />);
    const buttons = [...container.querySelectorAll<HTMLButtonElement>('button')];
    expect(buttons).toHaveLength(2);
    for (const b of buttons) {
      expect(b.title).toContain('суммы ожидаемой экономии Отчёта');
      expect(b.title).toContain('на остальных вкладках зависимых чисел пока нет');
      // И нигде — вранья «действует везде».
      expect(b.title).not.toContain('действует везде');
    }
  });
});

describe('паспорт разницы на кнопках', () => {
  it('живой коэффициент, равный нормативу, — «совпадает с нормативом»', () => {
    useStore.setState({
      liveStavka: { pct: 8, q1: null, q3: null, count: 10, readAt: null },
      dashboardData: { departmentSummaries: [{ planTotal: 100000 }] } as any,
    });
    const { container } = render(<StavkaDrum />);
    expect(liveButton(container).title).toContain('совпадает с нормативом');
  });

  it('с замером кнопка живая: нажатие включает живой режим', () => {
    useStore.setState({
      liveStavka: { pct: 9.79, q1: null, q3: null, count: 10, readAt: null },
    });
    const { container } = render(<StavkaDrum />);
    const btn = liveButton(container);
    expect(btn.hasAttribute('aria-disabled')).toBe(false);
    fireEvent.click(btn);
    expect(useStore.getState().stavkaMode).toBe('live');
  });
});
