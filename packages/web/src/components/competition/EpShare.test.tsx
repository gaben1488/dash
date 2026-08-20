// @vitest-environment jsdom
/**
 * Страж режима подведов на карточке «Доля закупок у единственного поставщика»
 * (приказ владельца 20.08.2026).
 *
 * Проверяется поведение, а не оформление:
 *   1) районный срез — прежняя карточка, разбивки по учреждениям нет;
 *   2) один ГРБС «с подведомственными» — карточка переходит в разбивку:
 *      аппарат первой строкой, учреждение из справочника без строк остаётся
 *      видимым с честным «строк нет», периметр разбивки назван словами;
 *   3) управление без подведов — сказано словами, а не показано пусто;
 *   4) режим «только ГРБС» — оговорка «скрывает, а не вычитает».
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { ORG_ITSELF_SENTINEL } from '@aemr/shared';
import type { OrgScope } from '../../lib/selectors/org-scope';
import { TooltipProvider } from '../ui/tooltip';

vi.mock('../../api', () => ({
  api: {
    getYearlongAnnotations: () => Promise.resolve({ annotations: [] }),
    putYearlongAnnotation: () => Promise.resolve({}),
  },
  humanizeRequestError: (e: unknown) => String((e as Error)?.message ?? e),
}));

/** Срез способа у одной организации колонки C — как его отдаёт расчёт. */
const sub = (name: string, ep: [number, number], kp: [number, number]) => ({
  name,
  byMethod: {
    ep: { planCount: ep[0], planTotal: ep[1] },
    competitive: { planCount: kp[0], planTotal: kp[1] },
  },
});

const filtered = {
  depts: [{
    id: 'uer',
    quarters: { year: { epCount: 3, kpCount: 1, epPlanTotal: 300, kpPlanTotal: 700 } },
    months: {},
    subordinates: [
      sub(ORG_ITSELF_SENTINEL, [1, 100], [1, 700]),
      sub('МБУ «Ромашка»', [2, 200], [0, 0]),
    ],
  }],
  allDepts: [{ id: 'uer' }],
  periodResolution: { hasActiveMonths: false, coveredQuarters: [], periodKey: 'year' },
  periodKey: 'year',
  coveredQuarters: [],
  fullQuarters: [],
  partialMonths: [],
  useMonthLevel: false,
};
vi.mock('../../hooks/useFilteredData', () => ({
  useFilteredData: () => filtered,
}));

const { EpShare } = await import('./EpShare');

afterEach(() => cleanup());

const totals = { epCount: 3, kpCount: 1, epPlan: 300, kpPlan: 700, hasData: true };

/** Скоуп в том виде, в каком его отдаёт useOrgScope зоне страницы. */
const scope = (over: Partial<OrgScope>): OrgScope => ({
  mode: 'district', dept: null, subordinates: [], hasSubs: false, ...over,
});

const withSubs = scope({
  mode: 'withSubs',
  dept: 'УЭР',
  hasSubs: true,
  subordinates: [
    { key: ORG_ITSELF_SENTINEL, label: 'Аппарат управления', rows: [] },
    { key: 'МБУ «Ромашка»', label: 'МБУ «Ромашка»', rows: [] },
    // Организация справочника, у которой строк в выборке нет вовсе.
    { key: 'МБУ «Василёк»', label: 'МБУ «Василёк»', rows: [] },
  ],
});

const draw = (ui: ReactNode) =>
  render(<TooltipProvider delayDuration={0}>{ui}</TooltipProvider>);

describe('EpShare — режим подведов', () => {
  it('районный срез оставляет карточку прежней: разбивки по учреждениям нет', () => {
    draw(<EpShare totals={totals} orgScope={scope({})} />);
    expect(screen.queryByText(/по учреждениям/i)).toBeNull();
    expect(screen.queryByText(/Режим скрывает разбивку/)).toBeNull();
  });

  it('«с подведомственными» разворачивает долю по организациям управления', () => {
    draw(<EpShare totals={totals} orgScope={withSubs} />);

    expect(screen.getByText(/Доля закупок без торгов по учреждениям УЭР/)).toBeTruthy();
    // Аппарат подписан по-русски, сентинел наружу не выходит.
    expect(screen.getByText('Аппарат управления')).toBeTruthy();
    expect(screen.queryByText(ORG_ITSELF_SENTINEL)).toBeNull();
    expect(screen.getByText('МБУ «Ромашка»')).toBeTruthy();
    // Организация справочника без строк не пропадает — «строк нет», а не ноль.
    expect(screen.getByText('МБУ «Василёк»')).toBeTruthy();
    expect(screen.getByText(/закупок со способом определения поставщика за год нет/)).toBeTruthy();
    // Периметр разбивки назван словами: год целиком, счёт «как в листе».
    expect(screen.getByText(/за год целиком/)).toBeTruthy();
    // Со строками — 2 организации из 3.
    expect(screen.getByText(/2 учреждения из 3/)).toBeTruthy();
  });

  it('управление без подведомственных говорит об этом словами', () => {
    const solo = scope({
      mode: 'withSubs',
      dept: 'УЭР',
      hasSubs: false,
      subordinates: [{ key: ORG_ITSELF_SENTINEL, label: 'Аппарат управления', rows: [] }],
    });
    // Строки учреждений в расчёте тоже отсутствуют: остаётся один аппарат.
    filtered.depts[0].subordinates = [sub(ORG_ITSELF_SENTINEL, [1, 100], [1, 700])];
    draw(<EpShare totals={totals} orgScope={solo} />);

    expect(screen.getByText(/подведомственных учреждений нет/)).toBeTruthy();
    filtered.depts[0].subordinates = [
      sub(ORG_ITSELF_SENTINEL, [1, 100], [1, 700]),
      sub('МБУ «Ромашка»', [2, 200], [0, 0]),
    ];
  });

  it('режим «только ГРБС» объявлен словами: скрывает, а не вычитает', () => {
    draw(<EpShare totals={totals} orgScope={scope({ mode: 'grbs', dept: 'УЭР', hasSubs: true })} />);
    expect(screen.getByText(/Режим скрывает разбивку, а не вычитает их из счёта/)).toBeTruthy();
  });
});
