// @vitest-environment jsdom
/**
 * Стражи блока «Из чего состоит ЕП» вкладки «Конкуренция» (канон п.98ж).
 *
 * Проверяются три обещания блока, а не его оформление:
 *   1) сокращаемый ЕП назван деньгами и объяснён — вместе с причиной, по
 *      которой остальной ЕП сокращать нечем (монополист, авария);
 *   2) когда счётных строк нет, показывается ЧЕСТНАЯ ПУСТОТА с причиной,
 *      а не нули и не пустой график;
 *   3) отказ сервера объявляется отдельно от «данных нет»: это разные
 *      новости с разными действиями.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { buildEpJustificationDept, type EpJustificationRow } from '@aemr/core';
import type { OrgScope } from '../../lib/selectors/org-scope';
import { TooltipProvider } from '../ui/tooltip';

// jsdom не знает ResizeObserver, а на нём стоит адаптивный контейнер recharts.
// Заглушка ничего не измеряет: график в тесте проверяется текстовым дублём.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal('ResizeObserver', ResizeObserverStub);

const getAnalyticsEPReasons = vi.fn();

vi.mock('../../api', () => ({
  api: {
    get getAnalyticsEPReasons() { return getAnalyticsEPReasons; },
  },
  humanizeRequestError: (e: unknown) => String((e as Error)?.message ?? e),
}));

// Периметр шапки подменяется целиком: блок обязан работать от контракта хука,
// а не от загруженного дашборда — иначе тест проверял бы загрузку, не блок.
const filtered = {
  depts: [{ id: 'uer' }],
  allDepts: [{ id: 'uer' }],
  periodResolution: { hasActiveMonths: false, coveredQuarters: [], periodKey: 'year' },
  periodKey: 'year',
};
vi.mock('../../hooks/useFilteredData', () => ({
  useFilteredData: () => filtered,
}));

const { EpJustification } = await import('./EpJustification');

afterEach(() => {
  cleanup();
  getAnalyticsEPReasons.mockReset();
});

const row = (r: Partial<EpJustificationRow>): EpJustificationRow => ({
  method: 'ЕП',
  reason: '',
  planTotal: 0,
  quarter: null,
  ...r,
});

/** Карточка живёт внутри провайдера подсказок — как и на реальной вкладке. */
const draw = (ui: ReactNode) =>
  render(<TooltipProvider delayDuration={0}>{ui}</TooltipProvider>);

/** Районный срез: управление не выбрано, оговорки режима подведов молчат. */
const districtScope: OrgScope = { mode: 'district', dept: null, subordinates: [], hasSubs: false };
/** Один ГРБС «только ГРБС»: подведы скрыл сам читатель. */
const grbsScope: OrgScope = { mode: 'grbs', dept: 'УЭР', subordinates: [], hasSubs: true };

function respond(rows: EpJustificationRow[]) {
  getAnalyticsEPReasons.mockResolvedValue({
    byDept: {},
    justification: {
      byDept: { uer: buildEpJustificationDept(rows) },
      rowsScanned: rows.length,
      readAt: '2026-08-18T00:00:00.000Z',
    },
  });
}

describe('EpJustification — сокращаемый ЕП на экране', () => {
  it('называет сокращаемый ЕП и объясняет, почему остальное сокращать нечем', async () => {
    respond([
      row({ reason: 'Монополист', planTotal: 600, quarter: 1 }),
      row({ reason: 'Проведение аукциона нецелесообразно', planTotal: 300, quarter: 2 }),
      row({ reason: '', planTotal: 100, quarter: 3 }),
      row({ method: 'ЭА', reason: '', planTotal: 1000, quarter: 1 }),
    ]);
    draw(<EpJustification orgScope={districtScope} />);

    await waitFor(() => expect(screen.getByText(/Сокращаемый ЕП/)).toBeTruthy());
    // Четыре степени подписаны по-русски, латинских ключей на экране нет.
    expect(screen.getByText('Безальтернативная по закону')).toBeTruthy();
    expect(screen.getByText(/Выгода подтверждена документом/)).toBeTruthy();
    expect(screen.getByText(/Решение заказчика/)).toBeTruthy();
    expect(screen.getByText(/Без обоснования/)).toBeTruthy();
    // Сокращаемое — 400 из 1000 денег ЕП: 40 % ЕП и 20 % всего плана.
    expect(screen.getByText(/40[.,]0\s*%\s*денег ЕП/)).toBeTruthy();
    expect(screen.getByText(/20[.,]0\s*%\s*всего плана периметра/)).toBeTruthy();
    // Тон — объяснение механизма, а не упрёк.
    expect(screen.getByText(/верхняя граница объёма/)).toBeTruthy();
    expect(screen.getByText(/конкурсом не заменить/)).toBeTruthy();
    // Раскрытие в Реестр по фильтру.
    expect(screen.getByRole('button', { name: /Открыть закупки без обоснования в Реестре/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Открыть все закупки без торгов в Реестре/ })).toBeTruthy();
  });

  it('динамика читается и без цвета: кварталы продублированы таблицей', async () => {
    respond([
      row({ reason: '', planTotal: 100, quarter: 1 }),
      row({ reason: 'Монополист', planTotal: 100, quarter: 3 }),
      row({ method: 'ЭА', reason: '', planTotal: 100, quarter: 3 }),
    ]);
    draw(<EpJustification orgScope={districtScope} />);

    await waitFor(() => expect(screen.getByText(/Как меняются доли по кварталам года/)).toBeTruthy());
    expect(screen.getByText('1 кв')).toBeTruthy();
    expect(screen.getByText('4 кв')).toBeTruthy();
    // Кварталы без строк не рисуют нулей, а говорят причину.
    expect(screen.getAllByText(/строк с этим кварталом плана нет/).length).toBeGreaterThan(0);
    // Снижение названо словами и двумя числами: 100 % в I квартале → 0 % в III.
    expect(screen.getByText(/сокращаемая доля/)).toBeTruthy();
    expect(screen.getByText(/упала/)).toBeTruthy();
  });

  it('строки без квартала плана не молчат: их число объявлено оговоркой', async () => {
    respond([
      row({ reason: 'Проведение аукциона нецелесообразно', planTotal: 500, quarter: null }),
      row({ reason: 'Монополист', planTotal: 500, quarter: 2 }),
    ]);
    draw(<EpJustification orgScope={districtScope} />);

    await waitFor(() => expect(screen.getByText(/не имеют квартала плана/)).toBeTruthy());
  });

  it('счётных строк нет — честная пустота с причиной, а не нули', async () => {
    respond([]);
    draw(<EpJustification orgScope={districtScope} />);

    await waitFor(() =>
      expect(screen.getByText('Закупок с определённым способом за периметр нет')).toBeTruthy(),
    );
    expect(screen.queryByText(/Сокращаемый ЕП/)).toBeNull();
  });

  it('отказ сервера объявляется отдельно и даёт повтор запроса', async () => {
    getAnalyticsEPReasons.mockRejectedValue(new Error('503 Service Unavailable'));
    draw(<EpJustification orgScope={districtScope} />);

    await waitFor(() => expect(screen.getByText('Разбор обоснований не получен')).toBeTruthy());
    expect(screen.getByRole('button', { name: /Повторить запрос/ })).toBeTruthy();
  });

  it('режим «только ГРБС» объявлен словами: разбивка скрыта, а не вычтена', async () => {
    respond([row({ reason: 'Монополист', planTotal: 500, quarter: 1 })]);
    draw(<EpJustification orgScope={grbsScope} />);

    await waitFor(() => expect(screen.getByText(/Сокращаемый ЕП/)).toBeTruthy());
    expect(screen.getByText(/Режим скрывает разбивку, а не вычитает их из счёта/)).toBeTruthy();
    expect(screen.getByText(/УЭР/)).toBeTruthy();
  });

  it('районный срез оговорки режима подведов не показывает', async () => {
    respond([row({ reason: 'Монополист', planTotal: 500, quarter: 1 })]);
    draw(<EpJustification orgScope={districtScope} />);

    await waitFor(() => expect(screen.getByText(/Сокращаемый ЕП/)).toBeTruthy());
    expect(screen.queryByText(/Режим скрывает разбивку/)).toBeNull();
    expect(screen.queryByText(/Разбивки по учреждениям/)).toBeNull();
  });
});
