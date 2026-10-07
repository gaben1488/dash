// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { normalizeMonitoring } from '../../lib/monitoring/contract';
import { WorkQueue } from './WorkQueue';

afterEach(cleanup);

it('показывает дату заявки отдельно от незаданного срока и открывает её процедуру', () => {
  const procedure = { sheet: 'Рабочий реестр процедур', row: 3, dept: 'УО', code: 'ЭА100-26',
    customer: 'Синтетический заказчик', subject: 'Синтетический предмет', stage: 'application',
    applicationDate: { iso: '2026-09-01' } };
  const data = normalizeMonitoring({ procedures: [procedure], work: { asOf: '2026-10-07', active: [
    { procedure, action: 'Разместить извещение', referenceDate: null, daysToDate: null },
  ], closed: [] } });
  const onOpen = vi.fn();
  render(<WorkQueue queue={data.work} procedures={data.procedures} readAtLabel="Прочитано сегодня" onOpen={onOpen} />);
  expect(screen.getAllByText('Срок не задан').length).toBeGreaterThan(0);
  expect(screen.getByText('Заявка поступила 01.09.2026')).toBeTruthy();
  expect(screen.queryByText(/Дата ориентира — дата заявки/u)).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'ЭА100-26' }));
  expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ code: 'ЭА100-26' }));
  fireEvent.click(screen.getByRole('button', { name: /Проверки закрытых/u }));
  expect(screen.getByText('В выбранном срезе очередь пуста.')).toBeTruthy();
});

it('закрытые проверки сохраняют выбранный срез и не занимают место колонками неприменимых сроков', () => {
  const own = { sheet: 'Рабочий реестр процедур', row: 3, dept: 'УО', code: 'ЭА100-26',
    customer: 'Синтетический заказчик', subject: 'Синтетический предмет', stage: 'awarded', qualityNote: 'Проверить: ИНН — S' };
  const other = { ...own, row: 4, dept: 'УЭР', code: 'ЭА101-26' };
  const data = normalizeMonitoring({ procedures: [own], work: { asOf: '2026-10-07', active: [], closed:
    [own, other].map((procedure) => ({ procedure, action: 'Уточнить поставщика и ИНН', referenceDate: null, daysToDate: null })) } });
  render(<WorkQueue queue={data.work} procedures={data.procedures} readAtLabel="Прочитано сегодня" onOpen={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: /Проверки закрытых 1/u }));
  expect(screen.getByRole('table', { name: 'Проверки закрытых процедур' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'ЭА100-26' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'ЭА101-26' })).toBeNull();
  expect(screen.queryByRole('columnheader', { name: 'Дата ориентира' })).toBeNull();
  expect(screen.queryByRole('columnheader', { name: 'Дней к дате' })).toBeNull();
});
