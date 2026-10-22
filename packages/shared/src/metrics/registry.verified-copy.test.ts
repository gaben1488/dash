import { describe, expect, it } from 'vitest';
import { METRIC_KB } from './registry.js';

describe('Метрика и русское описание используют один классификатор', () => {
  it('не относит любой неизвестный непустой способ закупки к конкурентным', () => {
    for (const key of ['competitive_count', 'comp_fact_count']) {
      const entry = METRIC_KB[key];
      expect(entry?.formula).toContain('classifyMethodGroup');
      expect(entry?.howCalc).toMatch(/неизвестн/i);
      expect(entry?.howCalc).not.toMatch(/любой, кроме «ЕП»|отличным от «ЕП»/i);
    }
  });
});
