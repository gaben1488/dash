import { describe, expect, it } from 'vitest';
import { METRIC_KB } from './registry.js';

describe('Словесные определения КП совпадают с канонической классификацией', () => {
  it('не включает все неизвестные непустые способы по правилу «всё кроме ЕП»', () => {
    expect(METRIC_KB.competitive_count.formula).toContain('classifyMethodGroup');
    expect(METRIC_KB.competitive_count.howCalc).toMatch(/неизвестн/i);
    expect(METRIC_KB.competitive_count.howCalc).not.toContain('любой, кроме «ЕП»');
    expect(METRIC_KB.comp_fact_count.howCalc).toMatch(/неизвестн/i);
    expect(METRIC_KB.comp_fact_count.howCalc).not.toContain('отличным от «ЕП»');
  });
});
