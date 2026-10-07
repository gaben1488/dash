// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { TooltipProvider } from '../ui/tooltip';
import { normalizeMonitoring } from '../../lib/monitoring/contract';
import { RegistryTable } from './RegistryTable';

afterEach(() => { cleanup(); window.localStorage.clear(); });

function fixture(count = 1) {
  return normalizeMonitoring({ procedures: Array.from({ length: count }, (_, i) => ({
    sheet: 'Рабочий реестр процедур', row: i + 3, code: `ЭА${100 + i}-26`,
    sourceCode: i === 0 ? 'ЭАС06-25' : `ЭА${100 + i}-26`, dept: 'УО',
    customer: 'Заказчик', subject: 'Полный предмет закупки', stage: 'awarded',
    result: 'Состоялась', requiredAction: 'Распределить экономию',
    qualityNote: 'Неполно: Экономия не разложена — N:P', nmck: 100, auctionPrice: 90,
  })) }).procedures;
}

it('рабочий вид показывает семь колонок и действие, полный вид сохраняет даты и бюджеты', () => {
  const rows = fixture();
  const onOpen = vi.fn();
  render(<TooltipProvider><RegistryTable rows={rows} sortKey="row" sortDir="asc"
    onSort={vi.fn()} onOpenProcedure={onOpen} compact /></TooltipProvider>);
  const table = screen.getByRole('table');
  expect(within(table).getAllByRole('columnheader')).toHaveLength(7);
  expect(within(table).getByText('Распределить экономию')).toBeTruthy();
  fireEvent.click(within(table).getByRole('button', { name: 'Открыть процедуру ЭАС06-25' }));
  expect(onOpen).toHaveBeenCalledWith(rows[0]);
  fireEvent.click(screen.getByRole('button', { name: 'Все колонки' }));
  expect(within(screen.getByRole('table')).getByText('Экономия, руб.')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Сроки' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Рабочий вид' }));
  expect(within(screen.getByRole('table')).getAllByRole('columnheader')).toHaveLength(7);
});

it('порция ограничивает только показ и позволяет открыть последнюю процедуру отбора', () => {
  const rows = fixture(51);
  const onOpen = vi.fn();
  render(<TooltipProvider><RegistryTable rows={rows} sortKey="row" sortDir="asc"
    onSort={vi.fn()} onOpenProcedure={onOpen} compact /></TooltipProvider>);
  expect(within(screen.getByRole('table')).getAllByRole('row')).toHaveLength(51);
  fireEvent.click(screen.getByRole('button', { name: /показать ещё 1/u }));
  expect(within(screen.getByRole('table')).getAllByRole('row')).toHaveLength(52);
  fireEvent.click(within(screen.getByRole('table')).getByRole('button', { name: 'Открыть процедуру ЭА150-26' }));
  expect(onOpen).toHaveBeenCalledWith(rows[50]);
});
