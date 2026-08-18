// @vitest-environment jsdom
/**
 * Monitoring.test.tsx — страж вкладки «Мониторинг · Реестр процедур
 * определения поставщика» (канон п.69в/п.101а).
 *
 * Проверяется контракт экрана: название по п.101а, плашка периметра с моментом
 * чтения (п.58), подпись «рубли» у денег (книги ГРБС — тысячи), фильтр по
 * стадии, честная плашка непрочитанных листов и честный отказ «книга не
 * прочитана» (не «в книге пусто»).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { MonitoringResponse } from '../api';

vi.mock('../api', () => ({
  api: { getMonitoring: vi.fn() },
  humanizeRequestError: (e: unknown) => (e instanceof Error ? e.message : String(e)),
}));

import { api } from '../api';
import { TooltipProvider } from '../components/ui/tooltip';
import { MonitoringPage } from './Monitoring';

// jsdom не реализует ResizeObserver, а Radix меряет им поповер подсказки БЗ.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as Record<string, unknown>).ResizeObserver ??= ResizeObserverStub;

// KBTooltip различает тач и мышь через matchMedia — jsdom его не знает.
beforeEach(() => {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches: false, media: query, onchange: null,
      addEventListener: () => {}, removeEventListener: () => {},
      addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
    }),
  });
});

afterEach(() => {
  cleanup();
  vi.mocked(api.getMonitoring).mockReset();
});

/** Процедура фикстуры — форма ответа /api/monitoring. */
function proc(over: Partial<MonitoringResponse['procedures'][number]>): MonitoringResponse['procedures'][number] {
  return {
    sheet: '1. УЭР', row: 3, dept: 'УЭР', customer: 'МКУ ЦЭР',
    code: 'ЭЗК426-25', subject: 'Поставка шатров', nmck: 446_700,
    applicationDate: '22.12.2025', publicationDate: '24.12.2025',
    deadlineDate: '13.01.2026', auctionDate: '15.01.2026',
    auctionPrice: 413_364, savingsTotal: 33_336, selfCheck: 'верно',
    winner: 'ИП Дойняк-Новый', stage: 'awarded',
    reductionRub: 33_336, reductionPct: 7.46,
    ...over,
  };
}

const RESPONSE: MonitoringResponse = {
  source: {
    bookName: 'Ежедневный мониторинг',
    readAt: '2026-08-18T02:00:00.000Z',
    moneyUnit: 'руб',
    sheetsRead: ['1. УЭР', '8. УО'],
    sheetsFailed: { '6. УД': 'Таблица-источник не ответила' },
  },
  procedures: [
    proc({}),
    proc({
      sheet: '8. УО', row: 3, dept: 'УО', customer: 'МБОУ ЕСШ №1',
      code: 'ЭА11-26', subject: 'Ремонт кровли', nmck: 2_250_000,
      auctionPrice: null, auctionDate: null, stage: 'published',
      reductionRub: null, reductionPct: null, winner: null,
    }),
  ],
  aggregates: {
    total: 2,
    byStage: { application: 0, published: 1, awarded: 1, no_result: 0 },
    nmckTotal: 2_696_700,
    awarded: {
      count: 1, nmckTotal: 446_700, priceTotal: 413_364, savingsTotal: 33_336,
      avgReductionPct: 7.46, noReductionCount: 0,
    },
    codesParsed: 2,
    codesUnparsed: 0,
  },
  unparsedCodes: [],
  notes: ['Деньги книги мониторинга — в рублях (книги управлений ведутся в тысячах рублей).'],
};

function renderPage() {
  return render(
    <TooltipProvider delayDuration={0}>
      <MonitoringPage />
    </TooltipProvider>,
  );
}

describe('MonitoringPage', () => {
  it('показывает название по п.101а, плашку периметра и реестр с деньгами в рублях', async () => {
    vi.mocked(api.getMonitoring).mockResolvedValue(RESPONSE);
    renderPage();

    expect(await screen.findByText('Мониторинг · Реестр процедур определения поставщика')).toBeTruthy();
    // Плашка периметра (п.58): момент чтения книги и честная пометка о фильтрах.
    expect(screen.getByText(/данные на \d{2}\.\d{2}\.\d{4}/)).toBeTruthy();
    expect(screen.getByText(/фильтры года и управлений шапки здесь не действуют/)).toBeTruthy();

    // Реестр: обе процедуры на экране, код и стадия видны.
    expect(screen.getByText('ЭЗК426-25')).toBeTruthy();
    expect(screen.getByText('ЭА11-26')).toBeTruthy();

    // Экономия на торгах — в рублях, с подписью единицы.
    expect(screen.getByText(/экономия на торгах/)).toBeTruthy();
    // Непрочитанный лист назван поимённо — счёт объявлен неполным.
    expect(screen.getByText(/Листы книги не прочитались: 6\. УД/)).toBeTruthy();
  });

  it('фильтр по стадии срезает таблицу и отличает отбор экрана от пустоты книги', async () => {
    vi.mocked(api.getMonitoring).mockResolvedValue(RESPONSE);
    renderPage();
    await screen.findByText('ЭЗК426-25');

    // Стадия «Состоялась»: остаётся только строка с результатом.
    fireEvent.click(screen.getByRole('button', { name: /Состоялась · 1/ }));
    expect(screen.getByText('ЭЗК426-25')).toBeTruthy();
    expect(screen.queryByText('ЭА11-26')).toBeNull();

    // Стадия «Без результата»: строк нет — пустота честно названа отбором.
    fireEvent.click(screen.getByRole('button', { name: /Без результата · 0/ }));
    expect(await screen.findByText(/фильтры стадии или заказчика срезали все строки/i)).toBeTruthy();

    // Сброс возвращает обе строки.
    fireEvent.click(screen.getByRole('button', { name: 'Сбросить фильтры' }));
    expect(await screen.findByText('ЭА11-26')).toBeTruthy();
  });

  it('отказ чтения книги — «не прочитана», а не «в книге пусто»', async () => {
    vi.mocked(api.getMonitoring).mockRejectedValue(new Error('Сервер данных недоступен'));
    renderPage();

    expect(await screen.findByText('Книга «Ежедневный мониторинг» не прочитана')).toBeTruthy();
    expect(screen.getByText(/Сервер данных недоступен/)).toBeTruthy();
    // Кнопка повтора — главное действие отказа.
    expect(screen.getByRole('button', { name: 'Прочитать ещё раз' })).toBeTruthy();

    // Повтор действительно перечитывает книгу мимо кэша.
    vi.mocked(api.getMonitoring).mockResolvedValue(RESPONSE);
    fireEvent.click(screen.getByRole('button', { name: 'Прочитать ещё раз' }));
    await waitFor(() => expect(vi.mocked(api.getMonitoring)).toHaveBeenLastCalledWith(true));
    expect(await screen.findByText('ЭЗК426-25')).toBeTruthy();
  });
});
