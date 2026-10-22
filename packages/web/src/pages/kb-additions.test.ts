import { describe, expect, it } from 'vitest';
import type { KBEntryData } from '@aemr/core';
import { kbCardProps } from './kb-additions';

describe('Карточки БЗ на новой базе Dash', () => {
  const entry: KBEntryData = {
    label: 'Сопоставление плана',
    formula: 'COUNT(*)',
    source: 'CalcEngine',
    unit: 'count',
    category: 'quality',
    whatIs: 'Сколько строк сверили.',
    howCalc: 'Сверяются записи действующих книг.',
    dataSource: 'Восемь книг управлений.',
    engine: 'Shared classifier -> CalcEngine',
    scopeMoment: 'Только выбранный год и восемь книг.',
    divergence: 'Некоторые строки могут отсутствовать в листовом итоге.',
    lawFull: 'Само расхождение не является нарушением.',
    related: ['plan_count'],
  };

  it('does not drop source coverage, divergence, engine or related references', () => {
    expect(kbCardProps(entry)).toMatchObject({
      whatIs: entry.whatIs,
      howCalc: entry.howCalc,
      dataSource: entry.dataSource,
      engine: entry.engine,
      scopeMoment: entry.scopeMoment,
      divergence: entry.divergence,
      lawFull: entry.lawFull,
      related: entry.related,
    });
  });

  it('does not fabricate placeholders for missing fields', () => {
    expect(kbCardProps({
      label: 'Нет описания', formula: '', source: '', unit: 'count', category: 'quality',
    })).toEqual({});
  });
});
