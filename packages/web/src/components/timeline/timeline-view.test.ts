/**
 * Характеризация чистой витрины таймлайна: события → элементы показа.
 * Правила, за которые тест отвечает:
 *   - snapshot_observed в ленту не попадает;
 *   - «просрочка с заключением позже плана» даёт два элемента (начало + снятие);
 *   - якорь плановой даты вставляется и сортируется по своей дате;
 *   - значения форматируются по роли колонки (даты, деньги, тексты);
 *   - фраза дней склоняется по-русски.
 */
import { describe, expect, it } from 'vitest';
import type { RowTimeline } from '@aemr/core';
import { buildTimelineDisplay, daysPhrase, formatDateRu } from './timeline-view';

function base(overrides: Partial<RowTimeline> = {}): RowTimeline {
  return {
    rowKey: 'УО:178',
    plannedDate: null,
    events: [],
    historySince: null,
    historyNote: 'нет истории',
    // null — история не резалась по границе чужой закупки (канон п.117).
    identityCutAt: null,
    ...overrides,
  };
}

describe('buildTimelineDisplay', () => {
  it('отбрасывает snapshot_observed: сам факт наблюдения — не изменение', () => {
    const items = buildTimelineDisplay(base({
      events: [
        { at: '2026-08-01T00:00:00.000Z', kind: 'snapshot_observed', source: 'снимок' },
        { at: '2026-08-02T00:00:00.000Z', kind: 'method_changed', from: 'ЭА', to: 'ЕП', source: 'снимок', cell: 'L178' },
      ],
    }));
    expect(items).toHaveLength(1);
    expect(items[0].kind).toBe('method_changed');
    expect(items[0].detail).toBe('ЭА → ЕП');
  });

  it('просрочка, закрытая заключением, даёт красное начало и зелёное снятие', () => {
    const items = buildTimelineDisplay(base({
      events: [{
        at: '2026-06-16', kind: 'overdue_started',
        from: '2026-06-15', to: '2026-07-01', source: 'снимок', cell: 'N178',
      }],
    }));
    expect(items.map((i) => i.kind)).toEqual(['overdue_started', 'overdue_cleared']);
    expect(items[0].emphasis).toBe(true);
    expect(items[0].accent).toBe('red');
    expect(items[1].accent).toBe('emerald');
    expect(items[1].dateLabel).toBe('01.07.2026');
  });

  it('якорь плановой даты встаёт на линию по своей дате, раньше событий того же дня', () => {
    const items = buildTimelineDisplay(base({
      plannedDate: '2026-06-15',
      events: [
        { at: '2026-05-01T10:00:00.000Z', kind: 'plan_date_changed', from: '', to: '2026-06-15', source: 'журнал', cell: 'N178' },
        { at: '2026-06-15', kind: 'fact_date_set', from: '', to: '2026-06-15', source: 'снимок', cell: 'Q178' },
      ],
    }));
    expect(items.map((i) => i.kind)).toEqual(['plan_date_changed', 'plan_anchor', 'fact_date_set']);
    expect(items[1].title).toBe('Плановая дата заключения');
  });

  it('деньги подписываются ролью колонки и форматируются с разрядами', () => {
    const items = buildTimelineDisplay(base({
      events: [{
        at: '2026-08-02T00:00:00.000Z', kind: 'sum_changed',
        from: '1200', to: '1350.5', source: 'журнал', cell: 'K178',
      }],
    }));
    expect(items[0].title).toBe('Изменена сумма: план, итого');
    expect(items[0].detail).toContain('тыс. руб.');
    expect(items[0].detail).toContain('→');
  });

  it('пустое «было» у заключения читается как появление заключения', () => {
    const items = buildTimelineDisplay(base({
      events: [{
        at: '2026-08-02', kind: 'fact_date_set',
        from: '', to: '2026-08-01', source: 'снимок', cell: 'Q178',
      }],
    }));
    expect(items[0].title).toBe('Появилось заключение контракта');
    expect(items[0].detail).toBe('пусто → 01.08.2026');
  });

  it('время показывается только у записей журнала', () => {
    const items = buildTimelineDisplay(base({
      events: [
        { at: '2026-08-02T03:15:00.000Z', kind: 'comment_changed', from: 'а', to: 'б', source: 'журнал', cell: 'AE178' },
        { at: '2026-08-03T03:15:00.000Z', kind: 'comment_changed', from: 'б', to: 'в', source: 'снимок', cell: 'AE178' },
      ],
    }));
    expect(items[0].timeLabel).not.toBeNull();
    expect(items[1].timeLabel).toBeNull();
  });
});

describe('daysPhrase', () => {
  it('склоняет дни и различает просрочку, сегодня и будущее', () => {
    expect(daysPhrase(-12)).toBe('просрочено 12 дней');
    expect(daysPhrase(-1)).toBe('просрочено 1 день');
    expect(daysPhrase(0)).toBe('плановая дата сегодня');
    expect(daysPhrase(3)).toBe('через 3 дня');
    expect(daysPhrase(14)).toBe('через 14 дней');
  });
});

describe('formatDateRu', () => {
  it('ISO → дд.мм.гггг; не-ISO возвращается как есть', () => {
    expect(formatDateRu('2026-08-14')).toBe('14.08.2026');
    expect(formatDateRu('2026-08-14T10:00:00.000Z')).toBe('14.08.2026');
    expect(formatDateRu('до конца года')).toBe('до конца года');
  });
});
