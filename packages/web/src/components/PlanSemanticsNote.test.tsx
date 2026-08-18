// @vitest-environment jsdom
/**
 * Страж сноски о природе плановой суммы (канон п.102).
 *
 * Сноска существует ради одного: сводное плановое число не должно молчать о
 * том, что складывает НМЦК одних управлений с лимитами других. Поэтому тест
 * проверяет не вёрстку, а обещание — при смешанном периметре предупреждение
 * доходит до экрана, при одиночном управлении читатель видит именно его
 * величину, а пустой фильтр (он же «все восемь») считается как весь периметр.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { PlanSemanticsNote } from './PlanSemanticsNote';
import { useStore } from '../store';

function selectDepts(ids: string[]) {
  useStore.setState({ selectedDepartments: new Set(ids) });
}

beforeEach(() => selectDepts([]));
afterEach(() => {
  cleanup();
  selectDepts([]);
});

describe('PlanSemanticsNote', () => {
  it('одиночное управление подписано своей величиной', () => {
    selectDepts(['УДТХ']);
    render(<PlanSemanticsNote />);
    const note = screen.getByTestId('plan-semantics-note');
    expect(note.textContent).toContain('распределяемый лимит');
    expect(note.getAttribute('title')).toContain('УДТХ');
    expect(note.getAttribute('title')).toContain('переносят на следующую');
    expect(note.getAttribute('title')).not.toContain('складывает НМЦК');
  });

  it('смешанный периметр предупреждает о разнородной сумме прямо на экране', () => {
    selectDepts(['УАГЗО', 'УДТХ']);
    render(<PlanSemanticsNote />);
    const note = screen.getByTestId('plan-semantics-note');
    expect(note.textContent).toContain('План собран из разных величин');
    expect(note.getAttribute('title')).toContain('складывает НМЦК одних управлений с лимитами других');
  });

  it('пустой фильтр управлений читается как весь периметр, а не как молчание', () => {
    selectDepts([]);
    render(<PlanSemanticsNote />);
    const note = screen.getByTestId('plan-semantics-note');
    expect(note.textContent).toContain('План собран из разных величин');
    expect(note.getAttribute('title')).toContain('УИО');
  });

  it('латинская форма ключа управления понимается наравне с кириллической', () => {
    selectDepts(['uagzo']);
    render(<PlanSemanticsNote />);
    expect(screen.getByTestId('plan-semantics-note').textContent).toContain('НМЦК по заявке');
  });
});
