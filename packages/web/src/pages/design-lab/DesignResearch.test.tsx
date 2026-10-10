// @vitest-environment jsdom
import * as React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { DesignResearch } from './DesignResearch';
import { DEFAULT_PRESET } from './presets';
import { ATOM_CONTRACTS } from './AtomAtlas';

afterEach(() => cleanup());
const research = () => render(<DesignResearch preset={DEFAULT_PRESET} onPresetChange={() => {}} />);

describe('Design Research: real decisions, not inert decoration', () => {
  it('shows recovered azure next to the verified bad historical alternative', () => {
    const { container } = research();
    expect(screen.getByRole('heading', { name: 'Лазурь, которую потеряли' })).toBeTruthy();
    expect(container.querySelectorAll('.dr-variant-grid button')).toHaveLength(5);
    expect(container.querySelectorAll('.dr-family-grid button')).toHaveLength(39);
    expect(container.querySelector('.dr-audit-stat')?.textContent).toContain('39подлинных пар');
    fireEvent.click(screen.getByRole('button', { name: /7 августа · исторический синий и бронза/ }));
    expect(screen.getByText(/контраст не проходит/i)).toBeTruthy();
    expect(container.querySelector('.dr-aurora-stage')?.getAttribute('data-finish')).toBe('candy');
  });

  it('allows selecting every meaningful state and finish without altering product globals', () => {
    const { container } = research();
    fireEvent.click(screen.getByRole('button', { name: 'Металлик' }));
    expect(container.querySelector('.dr-aurora-stage')?.getAttribute('data-finish')).toBe('metallic');
    fireEvent.click(screen.getByRole('button', { name: 'Недоступно' }));
    const control = container.querySelector<HTMLButtonElement>('.dr-hardware-control')!;
    expect(control.disabled).toBe(true);
    expect(control.dataset.state).toBe('disabled');
    fireEvent.click(screen.getByRole('button', { name: 'Выбрано' }));
    expect(control.disabled).toBe(false);
    expect(document.documentElement.getAttribute('data-finish')).toBeNull();
  });

  it('restores a large chart without faking a change of the data base', () => {
    const { container } = research();
    fireEvent.click(screen.getByRole('button', { name: 'Большой круг «Пульса»' }));
    expect(screen.getByRole('heading', { name: '«Пульс»: вернуть масштаб главному показателю' })).toBeTruthy();
    expect(container.querySelector('.dr-pulse-composition')?.getAttribute('data-layout')).toBe('hero');
    expect(screen.getAllByText('13 620 тыс. ₽').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: /Сейчас · малый/ }));
    expect(container.querySelector('.dr-pulse-composition')?.getAttribute('data-layout')).toBe('current');
    fireEvent.click(screen.getByRole('button', { name: /Исследовать · акцент/ }));
    expect(container.querySelector('.dr-pulse-composition')?.getAttribute('data-layout')).toBe('focus');
  });

  it('keeps department composition and the return route in the same chart', () => {
    research();
    fireEvent.click(screen.getByRole('button', { name: 'Большой круг «Пульса»' }));
    fireEvent.click(screen.getByRole('button', { name: 'Открыть состав УО' }));
    expect(screen.getByRole('heading', { name: 'Состав УО' })).toBeTruthy();
    expect(screen.getByText('5 820 тыс. ₽')).toBeTruthy();
    expect(screen.getByRole('button', { name: '← Все управления' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '← Все управления' }));
    expect(screen.getByRole('heading', { name: 'Доли по управлениям' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'млн ₽' }));
    expect(screen.getAllByText('13,62 млн ₽').length).toBeGreaterThan(0);
  });

  it('opens local contextual actions with the keyboard and actually changes the viewed scene', () => {
    research();
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    const dialog = screen.getByRole('dialog', { name: 'Поиск действий' });
    expect(dialog).toBeTruthy();
    fireEvent.click(within(dialog).getByText('Сравнить крупный круг «Пульса»'));
    expect(screen.getByRole('heading', { name: '«Пульс»: вернуть масштаб главному показателю' })).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('makes the three provenance stages distinct and reversible without using API', () => {
    research();
    fireEvent.click(screen.getByRole('button', { name: 'Механизмы' }));
    fireEvent.click(screen.getByRole('button', { name: 'Прочитать основание' }));
    expect(screen.getByText(/ДЕМО · D14 · сумма 4 200/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Подтвердить учебную проверку' }));
    expect(screen.getByRole('status').textContent).toContain('не официальное изменение');
    fireEvent.click(screen.getByRole('button', { name: 'Повторить сценарий' }));
    expect(screen.getByRole('button', { name: 'Прочитать основание' })).toBeTruthy();
  });

  it('covers all current 13 routes, without treating the three register buckets as separate data sources', () => {
    expect(ATOM_CONTRACTS).toHaveLength(13);
    expect(new Set(ATOM_CONTRACTS.map(item=>item.id)).size).toBe(13);
    const buckets=ATOM_CONTRACTS.filter(item=>['data','unfunded','yearlong'].includes(item.id));
    expect(buckets.map(item=>item.owner)).toEqual(['DataBrowser.tsx','DataBrowser.tsx','DataBrowser.tsx']);
    const { container }=research();
    fireEvent.click(screen.getByRole('button',{name:'Атомы и связи'}));
    expect(screen.getByRole('heading',{name:'Атомы интерфейса и зависимости'})).toBeTruthy();
    expect(container.querySelectorAll('.dr-atlas-list button')).toHaveLength(13);
    expect(screen.getByText('8 145')).toBeTruthy();
  });

  it('searches by user task and links the selected atom to its real source files', () => {
    const { container }=research();
    fireEvent.click(screen.getByRole('button',{name:'Атомы и связи'}));
    const search=screen.getByRole('searchbox',{name:'Поиск элемента или задачи'});
    fireEvent.change(search,{target:{value:'Мониторинг'}});
    expect(container.querySelectorAll('.dr-atlas-list button')).toHaveLength(1);
    fireEvent.click(within(screen.getByRole('complementary',{name:'Маршруты и их владельцы'}))
      .getByRole('button',{name:/Мониторинг/}));
    expect(screen.getByRole('article',{name:'Контракт раздела Мониторинг'})).toBeTruthy();
    fireEvent.click(screen.getByRole('button',{name:'Адреса исходников и проверок'}));
    const links=within(screen.getByRole('article',{name:'Контракт раздела Мониторинг'})).getAllByRole('link');
    expect(links.some(link=>link.getAttribute('href')?.includes('/pages/Monitoring.tsx'))).toBe(true);
    expect(links.some(link=>link.getAttribute('href')?.includes('/cards-map/monitoring.md'))).toBe(true);
    fireEvent.change(search,{target:{value:'нет_такого_раздела'}});
    expect(screen.getByText('По этому поиску разделов нет.')).toBeTruthy();
    expect(screen.getAllByRole('status').some(node => node.textContent?.includes('По этому поиску'))).toBe(true);
  });

});
