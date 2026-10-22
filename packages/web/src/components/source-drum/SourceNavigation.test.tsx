// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { SourceNavigation, SOURCE_NAV_ROUTES } from './SourceNavigation';

afterEach(() => cleanup());

function setup(activePage: (typeof SOURCE_NAV_ROUTES)[number] = 'dashboard') {
  const setPage = vi.fn();
  const view = render(<SourceNavigation activePage={activePage} setPage={setPage} />);
  const group = () => view.container.querySelector('.vkladki-stroka--centr .vkladki-imya-gruppy')?.textContent?.trim();
  const next = () => fireEvent.click(view.getByRole('button', { name: 'Следующие группы' }));
  const previous = () => fireEvent.click(view.getByRole('button', { name: 'Предыдущие группы' }));
  const visible = () => [...view.container.querySelectorAll('.vkladki-stroka[aria-hidden="false"]')];
  return { ...view, setPage, group, next, previous, visible };
}

describe('оригинальный навигационный барабан — циклическое пролистывание', () => {
  it('проходит все четыре группы вперёд, возвращается к началу и не теряет три ряда', () => {
    const ui = setup();
    expect(ui.group()).toBe('Обзор');
    for (const expected of ['Реестры', 'Разборы', 'Надзор', 'Обзор', 'Реестры']) {
      ui.next();
      expect(ui.group()).toBe(expected);
      expect(ui.visible()).toHaveLength(3);
      expect(ui.container.querySelectorAll('input[name="razdel"]')).toHaveLength(13);
    }
    expect(ui.setPage).not.toHaveBeenCalled();
  });

  it('прокручивает в обратную сторону через границу без тупика', () => {
    const ui = setup();
    for (const expected of ['Надзор', 'Разборы', 'Реестры', 'Обзор', 'Надзор']) {
      ui.previous();
      expect(ui.group()).toBe(expected);
      expect(ui.visible()).toHaveLength(3);
    }
  });

  it('мышь, клавиатура, Home/End работают с той же кольцевой моделью', () => {
    const ui = setup();
    const drum = ui.getByRole('group', { name: 'Барабан разделов' });
    fireEvent.wheel(drum, { deltaY: -90 });
    expect(ui.group()).toBe('Надзор');
    fireEvent.keyDown(drum, { key: 'PageDown' });
    expect(ui.group()).toBe('Обзор');
    fireEvent.keyDown(drum, { key: 'End' });
    expect(ui.group()).toBe('Надзор');
    fireEvent.keyDown(drum, { key: 'ArrowDown' });
    expect(ui.group()).toBe('Обзор');
    fireEvent.keyDown(drum, { key: 'Home' });
    expect(ui.group()).toBe('Обзор');
  });

  it('после оборотов сохраняет 13 уникальных маршрутов и внешнюю синхронизацию страницы', () => {
    const ui = setup();
    for (let i = 0; i < 7; i++) ui.next();
    const inputs = [...ui.container.querySelectorAll<HTMLInputElement>('input[name="razdel"]')];
    expect(inputs.map(input => input.dataset.route).sort()).toEqual([...SOURCE_NAV_ROUTES].sort());
    const quality = ui.container.querySelector<HTMLInputElement>('input[data-route="quality"]')!;
    quality.checked = true;
    fireEvent.change(quality);
    expect(ui.setPage).toHaveBeenCalledWith('quality');
    ui.rerender(<SourceNavigation activePage="quality" setPage={ui.setPage} />);
    expect(ui.group()).toBe('Надзор');
    expect(quality.checked).toBe(true);
    expect(quality.getAttribute('aria-current')).toBe('page');
    expect(ui.visible()).toHaveLength(3);
  });
});
