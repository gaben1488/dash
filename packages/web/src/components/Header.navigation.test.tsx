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
