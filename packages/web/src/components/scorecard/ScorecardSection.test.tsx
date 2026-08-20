// @vitest-environment jsdom
/**
 * Стражи вкладки «Контроль → Оценка управлений».
 *
 * Проверяются четыре обещания экрана, а не его оформление:
 *   1. оговорка о неподтверждённом ориентире стоит ДО букв грейда;
 *   2. периметр подписан свой — 1 кв и год, фильтры шапки не действуют;
 *   3. управление без счётной базы получает причину, а не грейд D и не нули;
 *   4. отказ по нарушениям закона не гасит таблицу грейдов, и наоборот.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { TooltipProvider } from '../ui/tooltip';
import { ScorecardSection } from './ScorecardSection';
import type { ComplianceResponse, ScorecardResponse } from './contract';

// jsdom не реализует ResizeObserver, а Radix меряет им стрелку подсказки.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as Record<string, unknown>).ResizeObserver ??= ResizeObserverStub;

Object.defineProperty(window, 'matchMedia', {
  configurable: true,
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }),
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const SCORECARD: ScorecardResponse = {
  uo: {
    grbsShort: 'УО',
    role: 'ОПЕРАЦИОННЫЙ',
    grade: 'C',
    gradeScore: 58,
    gradeReasons: ['отставание от ожидания', 'доля ЕП выше ориентира'],
    discipline: 46,
    mode: 'ТРЕВОГА',
    dominantFactor: 'ЕП',
    narrative: 'Доля единственного поставщика выше ориентира роли.',
    anticorruptionFlags: 4,
    topFlags: [
      { indicator: 'splitting', severity: 'high', score: 71, message: 'Три закупки одного предмета подряд.' },
      { indicator: 'ep_over_limit', severity: 'medium', rowIndex: 214, message: 'ЕП на 1 200 тыс. руб.' },
    ],
    execPct: 0.31,
    epShare: 0.68,
    riskLevel: 'high',
  },
  uer: {
    grbsShort: 'УЭР',
    role: 'ОПЕРАЦИОННЫЙ',
    grade: 'A',
    gradeScore: 92,
    gradeReasons: [],
    discipline: 88,
    mode: 'ПОХВАЛА',
    dominantFactor: 'ДИНАМИКА',
    narrative: 'Идёт по ожиданию.',
    anticorruptionFlags: 0,
    topFlags: [],
    execPct: 0.66,
    epShare: 0.32,
    riskLevel: 'low',
  },
  uio: {
    grbsShort: 'УИО',
    role: 'ОПЕРАЦИОННЫЙ',
    noData: true,
    noDataReason: 'Счётных строк за период нет — оценка не выдаётся.',
  },
};

const COMPLIANCE: ComplianceResponse = {
  totalIssues: 2,
  critical: 1,
  warnings: 1,
  issues: [
    {
      grbsId: 'uo',
      ruleCode: 'ep_contract_limit',
      severity: 'critical',
      title: 'ЕП превышает лимит 600 тыс. ₽ (строка 214)',
      description: 'Сумма контракта 1 200,0 тыс. ₽ превышает предельный размер',
      article: 'ст. 93 ч.1 п.4',
      threshold: 600,
      actualValue: 1200,
      rowIndex: 214,
    },
    {
      grbsId: 'uer',
      ruleCode: 'anti_dumping',
      severity: 'warning',
      title: 'Высокая экономия: лимит−факт 31,0% (строка 44)',
      description: 'Экономия превышает 25%',
      article: 'ст. 37',
      threshold: 0.25,
      actualValue: 0.31,
      rowIndex: 44,
    },
  ],
};

/** Ответы двух маршрутов по адресу запроса; null = отказ 503. */
function stubRoutes(scorecard: unknown | null, compliance: unknown | null) {
  const spy = vi.fn((input: RequestInfo | URL) => {
    const url = String(input);
    const body = url.includes('/analytics/compliance') ? compliance : scorecard;
    return Promise.resolve(
      new Response(JSON.stringify(body ?? { error: 'Analytics unavailable' }), {
        status: body === null ? 503 : 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
  });
  vi.stubGlobal('fetch', spy);
  return spy;
}

function renderSection() {
  return render(
    <TooltipProvider delayDuration={0}>
      <ScorecardSection />
    </TooltipProvider>,
  );
}

const flat = (): string => document.body.textContent?.replace(/\s+/g, ' ') ?? '';

describe('Оценка управлений', () => {
  it('оговорка о неподтверждённом ориентире стоит до чисел', async () => {
    stubRoutes(SCORECARD, COMPLIANCE);
    renderSection();
    // Оговорка рисуется сразу, ещё до ответа сервера: прочитанная после букв,
    // она уже не работает.
    expect(flat()).toContain('Документа за ними нет');
    await screen.findByText('УО');
    expect(flat()).toContain('не норма закона');
  });

  it('называет момент чтения и свой периметр вместо бейджа шапки', async () => {
    stubRoutes(SCORECARD, COMPLIANCE);
    renderSection();
    await screen.findByText('УО');

    expect(flat()).toContain('ответ получен');
    expect(flat()).toContain('фильтры шапки на эти числа не действуют');
  });

  it('порядок строк — по индексу возрастанием, наверху самый низкий', async () => {
    stubRoutes(SCORECARD, COMPLIANCE);
    renderSection();
    await screen.findByText('УО');

    const names = screen.getAllByRole('rowheader').map((th) => th.textContent ?? '');
    expect(names[0]).toContain('УО');
    expect(names[1]).toContain('УЭР');
    expect(names[2]).toContain('УИО');
  });

  it('управление без счётной базы получает причину, а не грейд и не нули', async () => {
    stubRoutes(SCORECARD, COMPLIANCE);
    renderSection();
    await screen.findByText('УО');

    const row = screen.getByRole('row', { name: /УИО/ });
    expect(row.textContent).toContain('оценка не выдаётся');
    // Ни одной цифры на месте оценки: ноль читался бы как «работает плохо».
    expect(row.querySelectorAll('td')).toHaveLength(1);
    expect(row.textContent).not.toMatch(/\d+\s*%/);
  });

  it('ярлыки движка переведены: «ТРЕВОГА» и «ЕП» на экран не выходят', async () => {
    stubRoutes(SCORECARD, COMPLIANCE);
    renderSection();
    await screen.findByText('УО');

    const table = screen.getByRole('table');
    expect(table.textContent).toContain('тревожно');
    expect(table.textContent).toContain('доля единственного поставщика');
    expect(table.textContent).not.toContain('ТРЕВОГА');
    expect(table.textContent).not.toContain('splitting');
  });

  it('признаки показаны словами, а их число не подменяется нулём', async () => {
    stubRoutes(SCORECARD, COMPLIANCE);
    renderSection();
    await screen.findByText('УО');

    const uo = screen.getByRole('row', { name: /УО/ });
    expect(uo.textContent).toContain('дробление закупок');
    // Четыре признака, показаны два — остаток назван, а не спрятан.
    expect(uo.textContent).toContain('и ещё 2');

    const uer = screen.getByRole('row', { name: /УЭР/ });
    expect(uer.textContent).toContain('не нашлось');
  });
});

describe('Нормы закона о закупках', () => {
  it('нарушение предъявляется классом: механизм, действие, адрес до ячейки', async () => {
    stubRoutes(SCORECARD, COMPLIANCE);
    renderSection();
    await screen.findByText('УО');

    const section = screen.getByRole('region', { name: 'Нормы закона о закупках' });
    expect(section.textContent).toContain('Разовая закупка у единственного поставщика выше предельной суммы');
    expect(section.textContent).toContain('Что делать:');
    // Заголовок движка со знаком рубля и номером строки внутри — не выходит.
    expect(section.textContent).not.toContain('₽');
  });

  it('антидемпинг признаётся посчитанным не по норме закона', async () => {
    stubRoutes(SCORECARD, COMPLIANCE);
    renderSection();
    await screen.findByText('УО');

    const section = screen.getByRole('region', { name: 'Нормы закона о закупках' });
    expect(section.textContent?.replace(/\s+/g, ' ')).toContain('снижение считается от планового лимита');
  });

  it('пустой результат проверок объясняется, а не рисуется нулём', async () => {
    stubRoutes(SCORECARD, { totalIssues: 0, critical: 0, warnings: 0, issues: [] });
    renderSection();
    await screen.findByText('УО');

    expect(flat()).toContain('не нашли ни одной строки');
  });

  it('отказ по нормам закона не гасит таблицу грейдов', async () => {
    stubRoutes(SCORECARD, null);
    renderSection();
    await screen.findByText('УО');

    expect(screen.getByRole('table')).toBeTruthy();
    expect(flat()).toContain('Нарушения норм закона не прочитаны');
    expect(flat()).toContain('Оценка выше от этого не зависит');
  });

  it('отказ по оценке объявляется причиной и кнопкой повтора', async () => {
    stubRoutes(null, COMPLIANCE);
    renderSection();

    expect(await screen.findByText(/Оценка не прочитана/)).toBeTruthy();
    expect(screen.getAllByRole('button', { name: /Прочитать ещё раз/ }).length).toBeGreaterThan(0);
  });
});
