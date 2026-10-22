// @vitest-environment jsdom
/**
 * Страж тап-аналога наведения (директива п.73а): на координатном устройстве
 * подсказка базы знаний открывается КЛИКОМ-ТАПОМ по метрике (Popover-поведение),
 * а на устройстве с мышью клик её не открывает — там работает наведение.
 *
 * jsdom не знает matchMedia — тач-устройство подставляется заглушкой.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { TooltipProvider } from './tooltip';
import { KBTooltip } from './kb-tooltip';
import { COARSE_POINTER_QUERY } from '../../lib/coarse-pointer';

// jsdom не реализует ResizeObserver, а Radix меряет им стрелку поповера.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as Record<string, unknown>).ResizeObserver ??= ResizeObserverStub;

/** Заглушка matchMedia: coarse=true — «телефон», false — «настольная мышь». */
function stubMatchMedia(coarse: boolean) {
  const mql = (query: string) => ({
    matches: coarse && query === COARSE_POINTER_QUERY,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  });
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: mql,
  });
}

function renderMetric() {
  return render(
    <TooltipProvider delayDuration={0}>
      <KBTooltip whatIs="Доля заключённых контрактов от плановых строк периода.">
        <span>86,6 %</span>
      </KBTooltip>
    </TooltipProvider>,
  );
}

const KB_TEXT = /Доля заключённых контрактов/;

describe('KBTooltip на координатном устройстве (тач)', () => {
  beforeEach(() => stubMatchMedia(true));
  afterEach(() => cleanup());

  it('тап по метрике открывает ту же подсказку БЗ', () => {
    renderMetric();
    expect(screen.queryByText(KB_TEXT)).toBeNull();
    fireEvent.click(screen.getByText('86,6 %'));
    expect(screen.getByText(KB_TEXT)).toBeTruthy();
  });

  it('повторный тап по метрике закрывает подсказку (долгое нажатие не нужно)', () => {
    renderMetric();
    const trigger = screen.getByText('86,6 %');
    fireEvent.click(trigger);
    expect(screen.getByText(KB_TEXT)).toBeTruthy();
    fireEvent.click(trigger);
    expect(screen.queryByText(KB_TEXT)).toBeNull();
  });

  it('наведение и тап не перегружают карточку порогами, примерами и техническим происхождением', () => {
    render(
      <TooltipProvider delayDuration={0}>
        <KBTooltip
          description="Контроль КП" whatIs="Доля распознанных конкурентных закупок."
          thresholdsFull="Порог выбирается по периоду." example="Десять из двадцати."
          dataSource="Восемь книг ГРБС." divergence="Неизвестный способ исключается."
        ><span>50 %</span></KBTooltip>
      </TooltipProvider>,
    );
    fireEvent.click(screen.getByText('50 %'));
    expect(screen.getByText(/Доля распознанных/)).toBeTruthy();
    expect(screen.queryByText(/Порог выбирается/)).toBeNull();
    expect(screen.queryByText(/Десять из двадцати/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Подробнее' }));
    expect(screen.getByText(/Порог выбирается/)).toBeTruthy();
    expect(screen.getByText(/Неизвестный способ исключается/)).toBeTruthy();
  });

  it('не делает всплывающую заглушку из одного заголовка', () => {
    render(
      <TooltipProvider delayDuration={0}>
        <KBTooltip description="Пояснение не готово"><span>Показатель</span></KBTooltip>
      </TooltipProvider>,
    );
    fireEvent.click(screen.getByText('Показатель'));
    expect(screen.queryByText('Пояснение не готово')).toBeNull();
  });

  it('краткое подтверждённое описание источника показывается и в неполной карточке', () => {
    render(
      <TooltipProvider delayDuration={0}>
        <KBTooltip dataSource="Книга управления, лист ВСЕ."><span>Источник</span></KBTooltip>
      </TooltipProvider>,
    );
    fireEvent.click(screen.getByText('Источник'));
    expect(screen.getByText(/Книга управления, лист ВСЕ/)).toBeTruthy();
  });

  it('триггер доступен с клавиатуры (tabIndex)', () => {
    renderMetric();
    const trigger = screen.getByText('86,6 %').closest('span[tabindex]');
    expect(trigger).not.toBeNull();
  });
});

describe('KBTooltip на устройстве с мышью', () => {
  beforeEach(() => stubMatchMedia(false));
  afterEach(() => cleanup());

  it('клик подсказку не открывает — там работает наведение (Radix Tooltip)', () => {
    renderMetric();
    fireEvent.click(screen.getByText('86,6 %'));
    expect(screen.queryByText(KB_TEXT)).toBeNull();
  });
});
