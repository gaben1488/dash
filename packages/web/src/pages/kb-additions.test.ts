import { describe, expect, it } from 'vitest';
import { kbCardProps } from './kb-additions';

describe('передача карточки базы знаний в единый компонент', () => {
  it('не теряет периметр, время, расхождение и проверяемое происхождение', () => {
    const original = {
      label: 'КП', unit: 'count', category: 'quality',
      formula: 'COUNT', source: 'shared classifier',
      whatIs: 'Счёт КП', howCalc: 'По распознанному способу', dataSource: 'Восемь книг',
      engine: 'Общий классификатор', scopeMoment: 'Все восемь книг на дату чтения',
      divergence: 'Свод исключает строки без квартала', lawFull: 'Нормативная оговорка',
      related: ['plan_count'],
    } as Parameters<typeof kbCardProps>[0];
    expect(kbCardProps(original)).toMatchObject({
      scopeMoment: original.scopeMoment, divergence: original.divergence,
      engine: original.engine, lawFull: original.lawFull, related: original.related,
    });
  });

  it('не придумывает заполнение отсутствующим полям', () => {
    const original = {
      label: 'КП', unit: 'count', category: 'quality',
      formula: '', source: '',
    } as Parameters<typeof kbCardProps>[0];
    expect(kbCardProps(original)).toEqual({});
  });
});
