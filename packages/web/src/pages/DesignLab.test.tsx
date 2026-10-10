// @vitest-environment jsdom
/**
 * Витрина должна работать как инструмент, а не как набор красивых, но inert контролов.
 * Все данные — вымышленные; никаких запросов к backend.
 */
import * as React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { DesignLabPage } from './DesignLab';
import { LAB_STORAGE_KEY } from './design-lab/presets';

afterEach(() => {
  cleanup();
  try { window.localStorage.clear(); } catch { /* Storage may be disabled */ }
});

describe('DesignLab (isolated developer showroom)', () => {
  it('opens on palettes and updates the exact original planet colors', () => {
    const { container } = render(<DesignLabPage onExit={() => {}} />);
    expect(screen.getByRole('heading', { name: 'Дизайн-лаборатория' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Палитры' })).toBeTruthy();
    const preview = container.querySelector<HTMLElement>('.dash-design-preview');
    expect(preview).not.toBeNull();
    expect(preview!.style.getPropertyValue('--dl-top')).toBe('#4a6da6'); // Реестр → Плеяды
    fireEvent.change(screen.getByLabelText('Раздел для проверки'), { target: { value: 'Контроль' } });
    expect(preview!.style.getPropertyValue('--dl-top')).toBe('#883527'); // Контроль → Марс
    fireEvent.change(screen.getByLabelText('Семейство вкладок'), { target: { value: 'minerals' } });
    expect(preview!.style.getPropertyValue('--dl-top')).toBe('#8f2438'); // Контроль → рубин
  });

  it('filters demonstrative records but never erases their compound numbers', () => {
    render(<DesignLabPage onExit={() => {}} />);
    fireEvent.change(screen.getByLabelText('Поиск по демонстрационным строкам'), { target: { value: '173/1' } });
    expect(screen.getByRole('button', { name: '173/1' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '173/2' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '173/1' }));
    expect(screen.getByText('ДЕМО · Строка 173/1')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Сброс' }));
    expect(screen.getByRole('button', { name: '173/2' })).toBeTruthy();
  });

  it('distinguishes waiting/error from ready and does not auto-apply detected updates', () => {
    render(<DesignLabPage onExit={() => {}} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Состояния' }));
    fireEvent.click(screen.getByRole('button', { name: 'Ошибка' }));
    expect(screen.getByRole('alert').textContent).toContain('Новую версию не удалось прочитать');
    expect(screen.getByText('Учебная версия v1 активна')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
    fireEvent.click(screen.getByRole('button', { name: 'Прочитал' }));
    expect(screen.getByText('Учебная версия v1 активна')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Применить ДЕМО' }));
    expect(screen.getByText('Учебная версия v2 применена')).toBeTruthy();
  });

  it('switches layout without dropping the working table, and compares two versions', () => {
    const { container } = render(<DesignLabPage onExit={() => {}} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Компоновки' }));
    fireEvent.click(screen.getByRole('button', { name: /Разбор/ }));
    expect(container.querySelector('.dash-design-preview')?.getAttribute('data-layout')).toBe('inspection');
    expect(screen.getByRole('button', { name: '173/1' })).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: 'Сравнение' }));
    const previews = container.querySelectorAll('.dash-design-preview');
    expect(previews).toHaveLength(2);
    expect(previews[0].getAttribute('data-layout')).toBe('inspection');
    expect(previews[1].querySelector('button.dl-nav-chip:disabled')).not.toBeNull();
  });

  it('saves a strict local recipe and rejects invalid imported data', () => {
    render(<DesignLabPage onExit={() => {}} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Код и наборы' }));
    fireEvent.change(screen.getByLabelText('Название текущего набора'), { target: { value: 'Тестовая версия' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    expect(window.localStorage.getItem(LAB_STORAGE_KEY)).toContain('Тестовая версия');
    fireEvent.change(screen.getByLabelText('Или вставьте JSON'), { target: { value: '{"version":99,"name":"bad"}' } });
    fireEvent.click(screen.getByRole('button', { name: 'Проверить и импортировать' }));
    expect(screen.getByRole('alert').textContent).toMatch(/неизвест|состав полей/i);
    expect(window.localStorage.getItem(LAB_STORAGE_KEY)).toContain('Тестовая версия');
  });
});
