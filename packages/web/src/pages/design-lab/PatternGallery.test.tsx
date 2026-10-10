// @vitest-environment jsdom
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { DEFAULT_PRESET } from './presets';
import { PatternGallery } from './PatternGallery';

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('The design lab must never request live data'); }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function visit(title: string): void {
  const directory = screen.getByRole('complementary', { name: 'Каталог рецептов' });
  fireEvent.click(within(directory).getByRole('button', { name: new RegExp(title) }));
}

describe('Design Lab pattern gallery', () => {
  it('renders a real component gallery under isolated alternative theme variables', () => {
    const { container } = render(<PatternGallery preset={DEFAULT_PRESET} />);
    expect(screen.getByRole('heading', { name: 'Библиотека рабочих практик' })).toBeTruthy();
    expect(container.querySelectorAll('.dl-pat-links button')).toHaveLength(14);
    const stage = container.querySelector<HTMLElement>('.dl-pat-stage');
    expect(stage).not.toBeNull();
    expect(stage!.style.getPropertyValue('--accent')).toBe('#4a6da6');
    expect(stage!.style.getPropertyValue('--accent-ink')).toBe('#ffffff');
    expect(stage!.style.getPropertyValue('--surface-card')).not.toBe('');
    expect(stage!.style.getPropertyValue('--data-bad')).toBe(''); // preserved semantic colors
    expect(stage!.closest('.dl-pattern-gallery')).not.toBeNull();
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it('searches recipes and correctly restores the full list', () => {
    const { container } = render(<PatternGallery preset={DEFAULT_PRESET} />);
    const input = screen.getByRole('searchbox', { name: 'Найти рецепт' });
    fireEvent.change(input, { target: { value: 'подмены' } });
    expect(container.querySelectorAll('.dl-pat-links button')).toHaveLength(1);
    fireEvent.change(input, { target: { value: 'несуществующая_тема' } });
    expect(screen.getByText('Совпадений нет. Измените фильтр.')).toBeTruthy();
    fireEvent.change(input, { target: { value: '' } });
    expect(container.querySelectorAll('.dl-pat-links button')).toHaveLength(14);
  });

  it('does not leave an invisible selected recipe open after a search or zero results', () => {
    const { container } = render(<PatternGallery preset={DEFAULT_PRESET} />);
    const search = screen.getByRole('searchbox', { name: 'Найти рецепт' });
    fireEvent.change(search, { target: { value: 'подмены' } });
    expect(screen.getByRole('heading', { name: 'Изменение без подмены версии' })).toBeTruthy();
    expect(container.querySelector('.dl-pat-links button[aria-pressed="true"]')).not.toBeNull();
    fireEvent.change(search, { target: { value: 'несуществующая_тема' } });
    expect(screen.getByText('Под заданный поиск рецептов нет')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Изменение без подмены версии' })).toBeNull();
    expect(container.querySelector('.dl-pat-stage')).toBeNull();
  });

  it('does not report a destructive demo action as completed before confirmation', () => {
    render(<PatternGallery preset={DEFAULT_PRESET} />);
    visit('Действие без ложного успеха');
    expect(screen.queryByText('Строка помечена удалённой только в демо.')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Запросить удаление' }));
    expect(screen.getByRole('button', { name: 'Подтвердить в демо' })).toBeTruthy();
    expect(screen.queryByText('Строка помечена удалённой только в демо.')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Отказаться' }));
    expect(screen.getByRole('button', { name: 'Запросить удаление' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Запросить удаление' }));
    fireEvent.click(screen.getByRole('button', { name: 'Подтвердить в демо' }));
    expect(screen.getByRole('status').textContent).toContain('Строка помечена удалённой');
  });

  it('keeps one worst freshness mark and exposes the full reasoning on demand', () => {
    const { container } = render(<PatternGallery preset={DEFAULT_PRESET} />);
    visit('Один самый важный сигнал');
    expect(container.querySelectorAll('.dl-pat-stage [data-freshness]')).toHaveLength(1);
    expect(container.querySelector('.dl-pat-stage [data-freshness]')?.getAttribute('data-freshness')).toBe('stale');
    fireEvent.click(screen.getByText('Все проверки · 3'));
    expect(container.querySelectorAll('.dl-pat-stage [data-freshness]')).toHaveLength(4);
  });

  it('separates measured zero from a missing source base', () => {
    render(<PatternGallery preset={DEFAULT_PRESET} />);
    visit('Нулевое значение или нет базы');
    expect(screen.getByText('0')).toBeTruthy();
    expect(screen.getByText('Исходный лист не прочитан — число неизвестно')).toBeTruthy();
  });

  it('switches the unit only, with one stable source amount and scope', () => {
    render(<PatternGallery preset={DEFAULT_PRESET} />);
    visit('Единицы без изменения закупок');
    expect(screen.getByText('7 800')).toBeTruthy();
    fireEvent.click(screen.getByText('Миллионы'));
    expect(screen.getByText('7,8')).toBeTruthy();
    expect(screen.getByText('млн ₽')).toBeTruthy();
    expect(screen.getByText('Исходная величина: 7 800 тыс. ₽. Количество строк остаётся 3.')).toBeTruthy();
  });

  it('keeps long institution names and controls instead of cutting to an ellipsis', () => {
    render(<PatternGallery preset={DEFAULT_PRESET} />);
    visit('Длинные названия и масштаб');
    expect(screen.getByText(/Средняя общеобразовательная школа № 3 имени выдающегося исследователя Камчатского края/)).toBeTruthy();
    expect(screen.getByRole('region', { name: 'ДЕМО · организации, предметы, номера и суммы' })).toBeTruthy();
  });

  it('distinguishes a confirmed fact from inference and unavailable evidence', () => {
    const { container } = render(<PatternGallery preset={DEFAULT_PRESET} />);
    visit('Факт, предположение, не проверено');
    expect(container.querySelector('.dl-pat-stage [data-freshness]')?.getAttribute('data-freshness')).toBe('uncovered');
    fireEvent.click(screen.getByRole('button', { name: 'Подтверждено' }));
    expect(container.querySelector('.dl-pat-stage [data-freshness]')?.getAttribute('data-freshness')).toBe('verified');
    fireEvent.click(screen.getByRole('button', { name: 'Неизвестно' }));
    expect(container.querySelector('.dl-pat-stage [data-freshness]')?.getAttribute('data-freshness')).toBe('unmeasurable');
  });

  it('shows production components with compound row numbering and formula metadata', () => {
    const { container } = render(<PatternGallery preset={DEFAULT_PRESET} />);
    visit('Строка и её проблема');
    expect(screen.getByRole('table', { name: /ДЕМО · адреса/ })).toBeTruthy();
    expect(screen.getByText('173/1')).toBeTruthy();
    expect(screen.getByText('173/2')).toBeTruthy();
    expect(container.querySelector('th[data-formula]')).not.toBeNull();
    expect(container.querySelector('tr[data-signal="warn"]')).not.toBeNull();
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it('filters fictitious records with aria-pressed and never requests the server', () => {
    render(<PatternGallery preset={DEFAULT_PRESET} />);
    visit('Фильтры, не меняющие смысл данных');
    const sub = screen.getByRole('button', { name: 'УКСиМП' });
    fireEvent.click(sub);
    expect(sub.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('status').textContent).toContain('Показано 1 из 3: 173/2');
    fireEvent.click(screen.getByRole('button', { name: 'Сброс' }));
    expect(screen.getByRole('status').textContent).toContain('Показано 3 из 3');
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it('uses explicit stages for review and update; error keeps old version', () => {
    render(<PatternGallery preset={DEFAULT_PRESET} />);
    visit('Провести человека через исправление');
    fireEvent.click(screen.getByRole('button', { name: 'Открыть учебный источник' }));
    expect(screen.getByText('ДЕМО · D14 = 7 800 тыс. ₽')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Отметить шаг в демо' }));
    expect(screen.getByText('Учебный шаг выполнен')).toBeTruthy();

    visit('Изменение без подмены версии');
    fireEvent.click(screen.getByRole('button', { name: 'Смоделировать отказ' }));
    expect(screen.getByRole('alert').textContent).toContain('Сохранена прежняя версия');
    expect(screen.getByText('v1')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Прочитать изменение' }));
    expect(screen.getByText('v1')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Применить ДЕМО' }));
    expect(screen.getByText('v2')).toBeTruthy();
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it('distinguishes empty result from failed read and keeps recipe provenance links', () => {
    render(<PatternGallery preset={DEFAULT_PRESET} />);
    visit('Пустота ≠ ноль ≠ сбой');
    expect(screen.getByText('По заданному условию строк нет')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Ошибка чтения' }));
    expect(screen.getByRole('alert').textContent).toContain('Учебный источник не ответил');
    const links = screen.getAllByRole('link');
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) {
      expect(link.getAttribute('href')?.startsWith('https://github.com/gaben1488/dash/blob/main/')).toBe(true);
      expect(link.getAttribute('rel')).toContain('noopener');
    }
  });
});
