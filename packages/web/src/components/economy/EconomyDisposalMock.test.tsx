// @vitest-environment jsdom
/**
 * Страж макета «Распоряжение экономией» (канон п.101д, вопрос 72).
 * Макет существует ради скриншота владельцу, поэтому проверяются обещания
 * честности: пометка «макет» видна, все пять статусов названы и объяснены,
 * доли складываются в целое, а кнопка заявки честно неактивна — счёт и
 * действия появятся только после решения владельца.
 */
import { afterEach, describe, expect, it } from 'vitest';
import * as React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { DISPOSAL_MOCK, EconomyDisposalMock } from './EconomyDisposalMock';

const formatMoney = (v: number) => `${(v / 1_000_000).toFixed(1).replace('.', ',')} млн ₽`;

afterEach(() => cleanup());

describe('EconomyDisposalMock — макет статусов свободной экономии', () => {
  it('показывает пометку макета, все пять статусов и их суммы', () => {
    render(<EconomyDisposalMock formatMoney={formatMoney} />);

    // Честность: читатель обязан видеть, что блок — макет и ждёт решения
    // владельца (формулировка плашки — дословно из приказа 20.08).
    expect(screen.getByText(/макет, ждёт решения/i)).toBeTruthy();

    // Все пять статусов из постановки вопроса 72 названы и объяснены суммой.
    expect(DISPOSAL_MOCK).toHaveLength(5);
    for (const row of DISPOSAL_MOCK) {
      expect(screen.getByText(row.label)).toBeTruthy();
      expect(screen.getAllByText(formatMoney(row.amount)).length).toBeGreaterThan(0);
    }
  });

  it('доли статусов в стек-баре складываются в 100 %', () => {
    render(<EconomyDisposalMock formatMoney={formatMoney} />);
    const bar = screen.getByRole('img');
    const widths = Array.from(bar.querySelectorAll('div')).map(
      seg => parseFloat((seg as HTMLElement).style.width),
    );
    expect(widths).toHaveLength(5);
    expect(widths.reduce((s, w) => s + w, 0)).toBeCloseTo(100, 6);
    // Ни один сегмент не схлопнут в ноль — иначе статус пропал бы с полосы.
    for (const w of widths) expect(w).toBeGreaterThan(0);
  });

  it('кнопка «подать заявку» неактивна, тултип объясняет почему', () => {
    render(<EconomyDisposalMock formatMoney={formatMoney} />);
    const btn = screen.getByRole('button', { name: /подать заявку на перераспределение/i }) as HTMLButtonElement;
    // Заглушка до решения владельца (п.99/69): честный disabled, не имитация.
    expect(btn.disabled).toBe(true);
    // Тултип живёт на обёртке: disabled-кнопка в части браузеров title не кажет.
    const wrapper = btn.closest('span[title]');
    expect(wrapper?.getAttribute('title')).toMatch(/решения владельца/i);
  });
});
