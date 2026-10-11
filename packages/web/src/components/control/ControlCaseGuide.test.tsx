// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { Issue } from '@aemr/shared';
import { buildControlCases } from '@aemr/shared';
import { ControlCaseGuide } from './ControlCaseGuide';

afterEach(() => { cleanup(); });

const makeCase = (status: Issue['status'] = 'open') => {
  const evidence: Issue = {
    id: 'legacy-row-17', severity: 'critical', origin: 'spreadsheet_rule',
    category: 'rule:formula_mutant', checkId: 'formula_mutant',
    title: 'Ошибка расчётной формулы', description: 'Первичная проверка',
    sheet: 'ВСЕ', row: 17, rowSeq: '173/1', cell: 'K17',
    departmentId: 'uo', status,
    detectedAt: '2026-10-10T00:00:00Z', detectedBy: 'rulebook',
  };
  return buildControlCases([evidence])[0];
};

describe('ControlCaseGuide integrated workflow', () => {
  it('shows four real selectable steps with traceable evidence and no fictional closure', () => {
    const onReread = vi.fn();
    const onOpenRegistry = vi.fn();
    const onOpenEvidence = vi.fn();
    render(<ControlCaseGuide item={makeCase('resolved')}
      onClose={vi.fn()} onReread={onReread}
      onOpenRegistry={onOpenRegistry} onOpenEvidence={onOpenEvidence} />);
    expect(screen.getByText(/№ п\/п 173\/1/)).toBeTruthy();
    expect(screen.getByText(/K17/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /Доказательства/ }));
    expect(screen.getByText(/Исходных наблюдений: 1/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Показать исходное замечание/ }));
    expect(onOpenEvidence).toHaveBeenCalledWith('legacy-row-17');

    fireEvent.click(screen.getByRole('button', { name: /Действие/ }));
    expect(screen.getByText(/Автоматической записи нет/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Открыть управление в Реестре/ }));
    expect(onOpenRegistry).toHaveBeenCalledWith('uo');

    fireEvent.click(screen.getByRole('button', { name: /Перепроверка/ }));
    expect(screen.getByText(/ещё не подтверждают исправление/)).toBeTruthy();
    expect(onReread).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /Запросить новое чтение книг/ }));
    expect(onReread).toHaveBeenCalledOnce();
    expect(screen.getByText(/не считается подтверждённо закрытым/)).toBeTruthy();
  });

  it('lists every underlying finding and lets the operator inspect each one', () => {
    const original = makeCase('open').evidence[0];
    const item = buildControlCases([
      original,
      { ...original, id: 'legacy-row-17-review', status: 'resolved' },
    ])[0];
    const onOpenEvidence = vi.fn();
    render(<ControlCaseGuide item={item} onClose={vi.fn()}
      onReread={vi.fn()} onOpenRegistry={vi.fn()} onOpenEvidence={onOpenEvidence} />);

    fireEvent.click(screen.getByRole('button', { name: /Доказательства/ }));
    expect(screen.getByText(/Исходных наблюдений: 2/)).toBeTruthy();
    expect(screen.getByText(/^Открыто/)).toBeTruthy();
    expect(screen.getByText(/^Исправлено/)).toBeTruthy();
    const links = screen.getAllByRole('button', { name: /Показать исходное замечание/ });
    expect(links).toHaveLength(2);
    fireEvent.click(links[1]);
    expect(onOpenEvidence).toHaveBeenCalledWith('legacy-row-17-review');
  });

  it('lets the user close the panel without modifying an issue status', () => {
    const close = vi.fn();
    render(<ControlCaseGuide item={makeCase()} onClose={close}
      onReread={vi.fn()} onOpenRegistry={vi.fn()} onOpenEvidence={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /Закрыть разбор вопроса/ }));
    expect(close).toHaveBeenCalledOnce();
  });
});
