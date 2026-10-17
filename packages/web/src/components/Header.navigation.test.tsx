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
it('uses both actual dawn colors and its foreground inside the shield',()=>{
 const view=render(<Header/>);
 for(const page of ['dashboard','report','svod','data','unfunded','yearlong','monitoring','economy','competition','discipline','quality','analytics','settings'] as const){
  act(()=>useStore.setState({page}));
  const header=view.container.querySelector('header')!;
  const stops=header.querySelectorAll('#shield-fill stop');
  expect(stops[0]?.getAttribute('stop-color')).toBe(header.style.getPropertyValue('--hdr-sky'));
  expect(stops[1]?.getAttribute('stop-color')).toBe(header.style.getPropertyValue('--hdr-horizon'));
  expect(stops[0]?.getAttribute('stop-opacity')).toBe('1');
  expect(stops[1]?.getAttribute('stop-opacity')).toBe('1');
 }
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
it('loops touch controls through both boundaries with three unique visible rows', () => {
 const view=render(<Header />);const nav=view.getByRole('navigation',{name:'Навигация'});
 const next=within(nav).getByRole('button',{name:'Следующая группа разделов'});
 const previous=within(nav).getByRole('button',{name:'Предыдущая группа разделов'});
 const check=(name:string)=>{
  expect(nav.querySelector('.np-group-center')?.getAttribute('aria-label')).toBe(name);
  const visible=nav.querySelectorAll('.np-group-top,.np-group-center,.np-group-bottom');
  expect(visible).toHaveLength(3);
  expect(new Set([...visible].map(row=>row.getAttribute('aria-label'))).size).toBe(3);
  expect(nav.querySelectorAll('.np-btn')).toHaveLength(13);
  expect(next.hasAttribute('disabled')).toBe(false);
  expect(previous.hasAttribute('disabled')).toBe(false);
  expect(useStore.getState().page).toBe('dashboard');
 };
 check('Обзор');
 for(let cycle=0;cycle<3;cycle++){
  for(const name of ['Реестры','Разборы','Надзор','Обзор']){fireEvent.click(next);check(name);}
  for(const name of ['Надзор','Разборы','Реестры','Обзор']){fireEvent.click(previous);check(name);}
 }
});
it('uses the same cycle for wheel and keyboard while Home and End keep their meaning',()=>{
 const view=render(<Header/>);const nav=view.getByRole('navigation',{name:'Навигация'});
 const center=()=>nav.querySelector('.np-group-center')?.getAttribute('aria-label');
 fireEvent.wheel(nav,{deltaY:-80});expect(center()).toBe('Надзор');
 fireEvent.keyDown(nav,{key:'PageDown'});expect(center()).toBe('Обзор');
 fireEvent.keyDown(nav,{key:'ArrowUp'});expect(center()).toBe('Надзор');
 fireEvent.keyDown(nav,{key:'ArrowDown'});expect(center()).toBe('Обзор');
 fireEvent.keyDown(nav,{key:'End'});expect(center()).toBe('Надзор');
 fireEvent.wheel(nav,{deltaY:80});expect(center()).toBe('Обзор');
 fireEvent.keyDown(nav,{key:'Home'});expect(center()).toBe('Обзор');
 fireEvent.wheel(nav,{deltaY:-80,ctrlKey:true});expect(center()).toBe('Обзор');
 fireEvent.wheel(nav,{deltaY:-80,shiftKey:true});expect(center()).toBe('Обзор');
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

it('does not leave an empty glass filter rail on the System page',()=>{
 useStore.setState({page:'settings'});
 const view=render(<Header/>);
 expect(view.queryByRole('group',{name:'Фильтры закупок'})).toBeNull();
 expect(view.getByRole('button',{name:'Включить светлую тему'})).toBeTruthy();
});

it('uses the thirteen planetary dawn pairs requested on 17 October',()=>{
 const expected=[['dashboard', '#5b99f8', '#9d8150'], ['report', '#555378', '#805d29'], ['svod', '#35479b', '#62507a'], ['data', '#365a8c', '#46657b'], ['unfunded', '#655065', '#765d40'], ['yearlong', '#275c7a', '#3e6b5d'], ['monitoring', '#3e5f78', '#496373'], ['economy', '#286c69', '#496b56'], ['competition', '#62507c', '#905331'], ['discipline', '#59515f', '#715c40'], ['quality', '#613f59', '#8c4c3f'], ['analytics', '#514482', '#665b7e'], ['settings', '#4d515b', '#655e54']] as const;
 const view=render(<Header/>);const header=view.container.querySelector('header')!;
 for(const [page,sky,horizon] of expected){act(()=>useStore.setState({page}));expect(header.style.getPropertyValue('--hdr-sky')).toBe(sky);expect(header.style.getPropertyValue('--hdr-horizon')).toBe(horizon);}
});
