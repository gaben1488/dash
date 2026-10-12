// @vitest-environment jsdom
import * as React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, within } from '@testing-library/react';
import { Header, NAV_ITEMS } from './Header';
import { useStore } from '../store';
vi.mock('../hooks/useLiveEvents', () => ({ useLiveEvents: () => ({newIssues: 0, history: [], connected: false, books: [], recentRows: []}) }));
vi.mock('../hooks/usePeriodCoverage', () => ({usePeriodCoverage: () => ({status: 'ready', index: {weeks: {}, months: {}, years: {}}})}));
vi.mock('../lib/monitoring/analytics-contract', () => ({fetchMonitoringAnalytics: vi.fn(() => new Promise(() => {}))}));
beforeEach(() => {useStore.getState().resetAllFilters(); useStore.setState({page: 'dashboard', error: null, isDemo: false, loading: false, bucketCounts: null});});
afterEach(cleanup);
it('changes the header dawn palette with the page without changing organisation filters', () => {
 const view=render(<Header />);const header=view.container.querySelector('header')!;
 const first=header.style.getPropertyValue('--hdr-sky');expect(first).not.toBe('');
 useStore.setState({selectedDepartments:new Set(['uksimp'])});
 act(()=>useStore.setState({page:'economy'}));
 expect(header.style.getPropertyValue('--hdr-sky')).not.toBe(first);
 expect(useStore.getState().selectedDepartments.has('uksimp')).toBe(true);
});
it('opens the unified journal and switches to source evidence', () => {
 const view=render(<Header />);
 fireEvent.click(view.getByRole('button',{name:/Журнал обновлений/}));
 expect(view.getByRole('dialog',{name:'Провенанс: откуда числа и что изменилось'})).toBeTruthy();
 fireEvent.click(view.getByRole('tab',{name:'Источники'}));
 expect(view.getByText('Момент чтения:')).toBeTruthy();
});
it('keeps navigation and calendar together with working filters in their own lower row', () => {
 useStore.setState({page:'data'});
 const view=render(<Header />);
 const primary=view.getByRole('group',{name:'Навигация и период'});
 const filters=view.getByRole('group',{name:'Фильтры закупок'});
 expect(within(primary).getByRole('navigation',{name:'Навигация'})).toBeTruthy();
 expect(within(primary).getByRole('group',{name:'Период'})).toBeTruthy();
 expect(within(primary).queryByRole('group',{name:'Способ закупки'})).toBeNull();
 const single=within(filters).getByRole('button',{name:'Единственный поставщик, статья 93 44-ФЗ'});
 fireEvent.click(single);
 expect(single.getAttribute('aria-pressed')).toBe('true');
 expect(useStore.getState().selectedMethods.has('single')).toBe(true);
 fireEvent.click(within(filters).getByRole('button',{name:'Все способы закупки'}));
 expect(useStore.getState().selectedMethods.size).toBe(0);
 expect(view.getByRole('button',{name:/Журнал обновлений/})).toBeTruthy();
});
it('browses the original navigation drum without changing the selected page', () => {
 useStore.setState({page: 'monitoring'});
 const view=render(<Header />);const nav=view.getByRole('navigation',{name:'Навигация'});
 const centered=()=>nav.querySelector('.np-group-center')?.getAttribute('aria-label');
 expect(centered()).toBe('Реестры');
 fireEvent.wheel(nav,{deltaY:80});expect(centered()).toBe('Разборы');
 expect(useStore.getState().page).toBe('monitoring');
 fireEvent.keyDown(nav,{key:'End'});expect(centered()).toBe('Надзор');
 fireEvent.keyDown(nav,{key:'Home'});expect(centered()).toBe('Обзор');
 fireEvent.wheel(nav,{deltaY:80,ctrlKey:true});expect(centered()).toBe('Обзор');
});
it('brings keyboard focus and external navigation into the center of the drum', () => {
 const view=render(<Header />);const nav=view.getByRole('navigation',{name:'Навигация'});
 act(()=>within(nav).getByRole('button',{name:'Система'}).focus());
 expect(nav.querySelector('.np-group-center')?.getAttribute('aria-label')).toBe('Надзор');
 act(()=>useStore.setState({page:'report'}));
 expect(nav.querySelector('.np-group-center')?.getAttribute('aria-label')).toBe('Обзор');
 expect(document.activeElement).toBe(within(nav).getByRole('button',{name:'Отчёт'}));
});
it('exposes bounded touch controls for every group without selecting a page', () => {
 const view=render(<Header />);const nav=view.getByRole('navigation',{name:'Навигация'});
 const next=within(nav).getByRole('button',{name:'Следующая группа разделов'});
 const previous=within(nav).getByRole('button',{name:'Предыдущая группа разделов'});
 expect(previous.hasAttribute('disabled')).toBe(true);
 for(let i=0;i<3;i++)fireEvent.click(next);
 expect(nav.querySelector('.np-group-center')?.getAttribute('aria-label')).toBe('Надзор');
 expect(next.hasAttribute('disabled')).toBe(true);
 expect(useStore.getState().page).toBe('dashboard');
});
it('retains all thirteen functional routes, current state and native keyboard focus', () => {
 const view = render(<Header />); const nav = view.getByRole('navigation', {name: 'Навигация'});
 expect(nav.querySelectorAll('.np-btn')).toHaveLength(13);
 for (const item of NAV_ITEMS) {
  const button = within(nav).getByRole('button', {name: item.label});
  button.focus(); expect(document.activeElement).toBe(button);
  fireEvent.click(button); expect(useStore.getState().page).toBe(item.id);
  expect(button.getAttribute('aria-current')).toBe('page');
 }
});
it('adopts original glass material on navigation and the filter corner without replacing drums or shield', () => {
 const {container} = render(<Header />);
 expect(container.querySelector('nav.nav-pills-wrap')?.classList.contains('hdr-liquid-surface')).toBe(true);
 expect(container.querySelector('.hdr-ugol')?.classList.contains('hdr-liquid-surface')).toBe(true);
 expect(container.querySelector('.shield-svg')).not.toBeNull();
 expect(container.querySelector('.tg-drum')).not.toBeNull();
 expect(container.querySelector('.wr-drum')).not.toBeNull();
});
it('does not invent zero bucket counts when the authoritative source is unavailable', () => {
 const view=render(<Header />);
 const nav=view.getByRole('navigation', {name:'Навигация'});
 expect(nav.querySelectorAll('.np-count')).toHaveLength(0);
});
it('shows authoritative bucket counts and an active filter corner without changing sources', () => {
 useStore.setState({bucketCounts: {unfunded: 7, yearlong: 12}, selectedMethods: new Set(['single'])});
 const view=render(<Header />);const nav=view.getByRole('navigation', {name:'Навигация'});
 expect(within(nav).getByRole('button', {name:/Не обеспеченные.*7 строк/}).textContent).toContain('7');
 expect(within(nav).getByRole('button', {name:/В течение года.*12 строк/}).textContent).toContain('12');
 expect(view.container.querySelector('.hdr-ugol')?.textContent).not.toBe('');
});

it('keeps theme immediately before the filter instrument in the lower right group',()=>{
 const view=render(<Header/>);const tools=view.getByRole('group',{name:'Фильтры и оформление'});
 expect(within(tools).getByRole('button',{name:/Фильтры линейки:/})).toBeTruthy();
 expect(within(tools).getByRole('button',{name:/Включить .* тему/})).toBeTruthy();
 expect(tools.closest('.hbar-secondary')).toBeTruthy();
 expect(tools.closest('.hbar-primary')).toBeNull();
 const theme=within(tools).getByRole('button',{name:/Включить .* тему/});
 const filter=within(tools).getByRole('button',{name:/Фильтры линейки:/});
 expect(theme.compareDocumentPosition(filter) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
 expect(view.getByRole('group',{name:'Фильтры закупок'}).compareDocumentPosition(tools) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

it('uses the free upper-right position for the update journal',()=>{
 const view=render(<Header/>);
 const journal=view.getByRole('button',{name:/Журнал обновлений/});
 expect(journal.closest('.hbar-primary')).toBeTruthy();
});

it('preserves all approved thirteen dawn pairs when centralising page themes',()=>{
 const expected=[['dashboard','#5b99f8','#e5d3a9'],['report','#f4c46b','#e6cda7'],['svod','#75bfd4','#e6d4ba'],['data','#75bfd4','#e6d4ba'],['unfunded','#efd195','#e5c39c'],['yearlong','#b7b6e2','#ded0bc'],['monitoring','#8dcce4','#e1d1b8'],['economy','#a0d8bc','#e5c5a2'],['competition','#a4dccc','#ddd6bc'],['discipline','#dfb294','#dfc1a6'],['quality','#de9d8c','#e1b78f'],['analytics','#b8a3e3','#dec4b4'],['settings','#b8c4d4','#ded2c2']] as const;
 const view=render(<Header/>);const header=view.container.querySelector('header')!;
 for(const [page,sky,horizon] of expected){act(()=>useStore.setState({page}));expect(header.style.getPropertyValue('--hdr-sky')).toBe(sky);expect(header.style.getPropertyValue('--hdr-horizon')).toBe(horizon);}
});
