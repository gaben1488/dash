/**
 * Стражи паспорта чисел вкладки «Мониторинг».
 *
 * Проверяется не форма подписи, а обещания: книга не слушает шапку почти ни по
 * одной оси, и КАЖДОЕ такое расхождение обязано быть названо словами. Тест
 * ловит ровно тот класс регресса, ради которого паспорт заведён: ось тихо
 * «применилась» — и число получило подпись, которой не подчиняется.
 */
import { describe, expect, it } from 'vitest';
import { monitoringPerimeter, type MonitoringPerimeterFilters } from './perimeter';
import { perimeterLabel } from '../perimeter';

const EMPTY: MonitoringPerimeterFilters = {
  selectedDepartments: [],
  selectedSubordinates: [],
  selectedMethods: [],
  selectedBudgets: [],
  selectedActivities: [],
  period: 'year',
  activeMonths: [],
};

const READ_AT = '2026-08-20T09:00:00.000Z';

describe('паспорт чисел мониторинга', () => {
  it('без выбора в шапке говорит «все годы · весь год · все управления»', () => {
    const p = monitoringPerimeter(EMPTY, { readAt: READ_AT, scope: 'registry' });
    expect(p.year).toBe('all');
    expect(p.span.label).toBe('весь год');
    expect(p.orgs.kind).toBe('all');
    // Расхождений нет: читатель ничего не выбирал — и предупреждать не о чем.
    expect(p.notes).toEqual([]);
  });

  it('выбранный квартал объявляется неприменимым словами, а не молчанием', () => {
    const p = monitoringPerimeter(
      { ...EMPTY, period: 'q3' },
      { readAt: READ_AT, scope: 'registry' },
    );
    expect(p.applies.period).toBe(false);
    expect(p.span.label).toBe('весь год');
    expect(p.notes.join(' ')).toContain('но числа за весь год');
  });

  it('способ, бюджет и вид деятельности к книге не применяются — все три названы', () => {
    const p = monitoringPerimeter(
      { ...EMPTY, selectedMethods: ['single'], selectedBudgets: ['mb'], selectedActivities: ['program'] },
      { readAt: READ_AT, scope: 'registry' },
    );
    expect(p.slice.kind).toBe('all');
    const notes = p.notes.join(' ');
    expect(notes).toContain('способа закупки');
    expect(notes).toContain('бюджета');
    expect(notes).toContain('вида деятельности');
  });

  it('управление сужает реестр и НЕ сужает районные числа', () => {
    const filters = { ...EMPTY, selectedDepartments: ['УО'] };
    const registry = monitoringPerimeter(filters, { readAt: READ_AT, scope: 'registry' });
    const district = monitoringPerimeter(filters, { readAt: READ_AT, scope: 'district' });

    expect(registry.applies.departments).toBe(true);
    expect(registry.orgs.label).toBe('УО');
    expect(registry.notes.join(' ')).not.toContain('фильтр управлений');

    expect(district.applies.departments).toBe(false);
    expect(district.orgs.kind).toBe('all');
    expect(district.notes.join(' ')).toContain('посчитано по всему району');
  });

  it('выбранные подведы не выдаются за периметр числа', () => {
    const p = monitoringPerimeter(
      { ...EMPTY, selectedDepartments: ['УО'], selectedSubordinates: ['МБОУ СОШ № 1'] },
      { readAt: READ_AT, scope: 'registry' },
    );
    // Правило (з): «УО целиком», а не «УО · МБОУ СОШ № 1».
    expect(p.orgs.kind).toBe('whole');
    expect(p.orgs.label).toContain('целиком');
    expect(p.notes.join(' ')).toContain('подведомственных');
  });

  it('молчание сервера о моменте чтения звучит как незнание, а не как свежесть', () => {
    const p = monitoringPerimeter(EMPTY, { readAt: null, scope: 'district' });
    expect(p.moment.kind).toBe('unknown');
    expect(perimeterLabel(p)).toContain(p.moment.label);
  });
});
