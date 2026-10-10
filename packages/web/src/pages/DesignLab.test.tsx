// @vitest-environment jsdom
/**
 * Витрина должна работать как инструмент, а не как набор красивых, но inert контролов.
 * Все данные — вымышленные; никаких запросов к backend.
 */
import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { DesignLabPage } from './DesignLab';
import { LAB_STORAGE_KEY } from './design-lab/presets';

afterEach(() => {
  cleanup();
  try { window.localStorage.clear(); } catch { /* Storage may be disabled */ }
  vi.restoreAllMocks();
});

/** Radix Tabs activates through left mouse-down (or Enter), not a bare click. */
function openTab(name: string): void {
  const tab = screen.getByRole('tab', { name });
  fireEvent.mouseDown(tab, { button: 0, ctrlKey: false });
  expect(tab.getAttribute('data-state')).toBe('active');
}

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
    openTab('Состояния');
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
    openTab('Компоновки');
    fireEvent.click(screen.getByRole('button', { name: /Разбор/ }));
    expect(container.querySelector('.dash-design-preview')?.getAttribute('data-layout')).toBe('inspection');
    expect(screen.getByRole('button', { name: '173/1' })).toBeTruthy();
    openTab('Сравнение');
    const previews = container.querySelectorAll('.dash-design-preview');
    expect(previews).toHaveLength(2);
    expect(previews[0].getAttribute('data-layout')).toBe('inspection');
    expect(previews[1].querySelector('button.dl-nav-chip:disabled')).not.toBeNull();
  });

  it('keeps summary totals consistent with organization and empty selection', () => {
    const { container } = render(<DesignLabPage onExit={() => {}} />);
    const preview = container.querySelector('.dash-design-preview')!;
    const counts = () => [...preview.querySelectorAll('.dl-summary-metrics strong')].map(n => n.textContent);
    expect(counts()).toEqual(['2', '1']);
    fireEvent.change(screen.getByLabelText('Фильтр демо-организаций'), { target: { value: 'УКСиМП' } });
    expect(preview.querySelector('.dl-big-number')?.textContent).toContain('1');
    expect(counts()).toEqual(['0', '1']);
    openTab('Состояния');
    fireEvent.click(screen.getByRole('button', { name: 'Нет данных' }));
    const emptyPreview = container.querySelector('.dash-design-preview')!;
    expect(emptyPreview.querySelector('.dl-big-number')?.textContent).toContain('0');
    expect([...emptyPreview.querySelectorAll('.dl-summary-metrics strong')].map(n => n.textContent)).toEqual(['0', '0']);
  });

  it('compares identical row sets after changing the current selection', () => {
    const { container } = render(<DesignLabPage onExit={() => {}} />);
    fireEvent.change(screen.getByLabelText('Фильтр демо-организаций'), { target: { value: 'УКСиМП' } });
    fireEvent.change(screen.getByLabelText('Поиск по демонстрационным строкам'), { target: { value: '173/2' } });
    openTab('Сравнение');
    const previews = [...container.querySelectorAll('.dash-design-preview')];
    expect(previews).toHaveLength(2);
    for (const preview of previews) {
      expect(preview.querySelector('.dl-big-number')?.textContent).toContain('1');
      expect(preview.querySelectorAll('tbody tr')).toHaveLength(1);
      expect(preview.querySelector('tbody')?.textContent).toContain('173/2');
      expect(preview.querySelector('tbody')?.textContent).not.toContain('173/1');
    }
  });

  it('shows the selected source cell, note and discussion without borrowing another row evidence', () => {
    render(<DesignLabPage onExit={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: '173/2' }));
    expect(screen.getByText('ДЕМО · Строка 173/2')).toBeTruthy();
    expect(screen.getByText('Учебный лист · D15')).toBeTruthy();
    expect(screen.getByText('D15: 7 800 тыс. ₽ (учебный пример)')).toBeTruthy();
    expect(screen.getByText('Примечаний нет')).toBeTruthy();
    expect(screen.getByText('Обсуждений нет')).toBeTruthy();
    expect(screen.queryByText('В строке 173/1 требуется открыть основание и уточнить источник суммы.')).toBeNull();
  });

  it('keeps undo available when local storage rejects restoring a deleted recipe', () => {
    render(<DesignLabPage onExit={() => {}} />);
    openTab('Код и наборы');
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    fireEvent.click(screen.getByRole('button', { name: 'Удалить набор Исходная основа' }));
    expect(screen.getByRole('button', { name: 'Вернуть удалённый набор' })).toBeTruthy();
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota exceeded'); });
    fireEvent.click(screen.getByRole('button', { name: 'Вернуть удалённый набор' }));
    expect(screen.getByRole('button', { name: 'Вернуть удалённый набор' })).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain('quota exceeded');
  });

  it('does not apply a valid imported preset when browser storage refuses the write', () => {
    const { container } = render(<DesignLabPage onExit={() => {}} />);
    openTab('Код и наборы');
    const before = container.querySelector<HTMLElement>('.dl-root')?.getAttribute('data-scheme');
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('storage offline'); });
    const imported = { version: 1, name: 'Тест', family: 'kamchatka', surface: 'ocean', finish: 'matte', layout: 'registry', section: 'Свод', mode: 'light', density: 'compact', motion: false };
    fireEvent.change(screen.getByLabelText('Или вставьте JSON'), { target: { value: JSON.stringify(imported) } });
    fireEvent.click(screen.getByRole('button', { name: 'Проверить и импортировать' }));
    expect(screen.getByRole('alert').textContent).toContain('storage offline');
    expect(container.querySelector<HTMLElement>('.dl-root')?.getAttribute('data-scheme')).toBe(before);
  });

  it('distinguishes unsaved current export from saved preset export', () => {
    render(<DesignLabPage onExit={() => {}} />);
    openTab('Код и наборы');
    expect(screen.getByRole('button', { name: 'Экспорт текущего' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Экспорт сохранённых' }).hasAttribute('disabled')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    expect(screen.getByRole('button', { name: 'Экспорт сохранённых' }).hasAttribute('disabled')).toBe(false);
  });

  it('saves a strict local recipe and rejects invalid imported data', () => {
    render(<DesignLabPage onExit={() => {}} />);
    openTab('Код и наборы');
    fireEvent.change(screen.getByLabelText('Название текущего набора'), { target: { value: 'Тестовая версия' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    expect(window.localStorage.getItem(LAB_STORAGE_KEY)).toContain('Тестовая версия');
    fireEvent.change(screen.getByLabelText('Или вставьте JSON'), { target: { value: '{"version":99,"name":"bad"}' } });
    fireEvent.click(screen.getByRole('button', { name: 'Проверить и импортировать' }));
    expect(screen.getByRole('alert').textContent).toMatch(/неизвест|состав полей/i);
    expect(window.localStorage.getItem(LAB_STORAGE_KEY)).toContain('Тестовая версия');
  });
});
