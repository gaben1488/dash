import { describe, expect, it } from 'vitest';
import { perimeterApplies, perimeterLabel } from '../perimeter';
import { EMPTY_FILTER_CONTEXT } from '../filter-context';
import { makeReportFixture } from './fixture';
import { reportPerimeter } from './perimeter';

const report = makeReportFixture();

describe('паспорт периметра секций «Отчёта»', () => {
  it('год и квартал берутся из ответа сервера, а не из шапки', () => {
    const p = reportPerimeter({ report, ctx: { ...EMPTY_FILTER_CONTEXT, year: 2025, period: 'q4' } });
    expect(p.year).toBe(report.period.year);
    expect(p.span.label).toContain(String(report.period.quarter));
  });

  it('выбранное управление не сужает документ — и об этом сказано словами', () => {
    const p = reportPerimeter({ report, ctx: { ...EMPTY_FILTER_CONTEXT, grbs: ['УО'] } });
    expect(perimeterApplies(p, 'departments')).toBe(false);
    expect(p.orgs.label).toBe('все управления');
    expect(p.notes.join(' ')).toContain('фильтр управлений');
  });

  it('способ и бюджет объявлены неприменимыми, а не замолчаны', () => {
    const p = reportPerimeter({
      report,
      ctx: { ...EMPTY_FILTER_CONTEXT, methods: ['ЕП'], budgets: ['fb'] },
    });
    const notes = p.notes.join(' ');
    expect(notes).toContain('способа закупки');
    expect(notes).toContain('бюджета');
    expect(p.slice.kind).toBe('all');
  });

  it('без выбора в шапке пометок нет — молчание тут честно', () => {
    const p = reportPerimeter({ report, ctx: EMPTY_FILTER_CONTEXT });
    expect(p.notes).toEqual([]);
    expect(perimeterLabel(p)).toContain('все управления');
  });

  it('годовой блок объявляет неприменимым и период — квартал его не сужает', () => {
    const p = reportPerimeter({
      report,
      ctx: { ...EMPTY_FILTER_CONTEXT, period: 'q1' },
      wholeYear: true,
    });
    expect(p.span.label).toBe('весь год');
    expect(perimeterApplies(p, 'period')).toBe(false);
  });
});
