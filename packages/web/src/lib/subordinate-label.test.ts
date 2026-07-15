import { describe, it, expect } from 'vitest';
import { ORG_ITSELF_SENTINEL } from '@aemr/shared';
import { subordinateLabel, ORG_ITSELF_LABEL } from './subordinate-label';

describe('subordinateLabel (D15: ноль сырых ключей в видимом UI)', () => {
  it('прячет сырой ключ _org_itself за русской подписью', () => {
    expect(subordinateLabel('_org_itself')).toBe(ORG_ITSELF_LABEL);
    expect(subordinateLabel(ORG_ITSELF_SENTINEL)).toBe('Аппарат управления');
  });

  it('обычные имена подведов не трогает', () => {
    expect(subordinateLabel('МБОУ «Елизовская СОШ №9»')).toBe('МБОУ «Елизовская СОШ №9»');
    expect(subordinateLabel('')).toBe('');
  });

  it('рейтинг подведов: после маппинга подписей _org_itself не виден', () => {
    // Модель данных «Рейтинг подведомственных» (Analytics.tsx, topSubordinates):
    // ключи сохраняются для сортировки/навигации, подпись — через subordinateLabel.
    const topSubordinates = [
      { name: '_org_itself', dept: 'УО', planTotal: 100 },
      { name: 'МКУ "ЦБ УО"', dept: 'УО', planTotal: 50 },
    ];
    const visibleCells = topSubordinates.map(s => subordinateLabel(s.name));
    expect(visibleCells.join(' ')).not.toContain('_org_itself');
    expect(visibleCells).toEqual(['Аппарат управления', 'МКУ "ЦБ УО"']);
  });
});
