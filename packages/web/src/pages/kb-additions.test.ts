import { describe, expect, it } from 'vitest';
import type { KBEntryData } from '@aemr/core';
import { kbCardProps } from './kb-additions';

describe('Карточка БЗ из единой записи', () => {
  const source: KBEntryData = {
    label: 'Показатель',
    unit: 'count',
    category: 'quality',
    formula: 'COUNT(rows)',
    source: 'reader',
    whatIs: 'Сколько проверенных строк.',
    howCalc: 'Считаются только строки действующего источника.',
    dataSource: 'Книга управления, графа предмета закупки.',
    engine: 'Shared classifier → metric',
    scopeMoment: 'Восемь книг на момент чтения.',
    divergence: 'Свод может исключать строки без квартала.',
    lawFull: 'Проверка не является юридическим заключением.',
    related: ['plan_count'],
  };

  it('не теряет охват, расхождение и происхождение при передаче на страницу', () => {
    expect(kbCardProps(source)).toMatchObject({
      whatIs: source.whatIs,
      howCalc: source.howCalc,
      dataSource: source.dataSource,
      engine: source.engine,
      scopeMoment: source.scopeMoment,
      divergence: source.divergence,
      lawFull: source.lawFull,
      related: source.related,
    });
  });

  it('не сочиняет текст для пустых необязательных полей', () => {
    const empty: KBEntryData = {
      label: 'Не готово',
      formula: '',
      source: '',
      unit: 'count',
      category: 'quality',
    };
    expect(kbCardProps(empty)).toEqual({});
  });
});
